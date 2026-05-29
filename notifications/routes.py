"""Relaygent Notifications — notification aggregation and health routes."""

import json
import logging
import os
import ssl
import urllib.request
from datetime import datetime, timedelta

from notif_config import app
from db import get_db, get_notification_history
from flask import jsonify, request
from reminders import is_recurring_reminder_due
from notif_logger import log_notifications
import tasks_collector
import collector_registry

logger = logging.getLogger(__name__)

HUB_HOST = os.environ.get("RELAYGENT_HUB_HOST", "127.0.0.1")
HUB_PORT = os.environ.get("RELAYGENT_HUB_PORT", "8080")
_HUB_PROTO = "http"
try:
    _cfg = json.loads(open(os.path.expanduser("~/.relaygent/config.json")).read())
    if _cfg.get("hub", {}).get("tls", {}).get("cert"):
        _HUB_PROTO = "https"
except Exception:
    pass
_SSL_CTX = ssl.create_default_context() if _HUB_PROTO == "http" else ssl._create_unverified_context()


@app.route("/notifications/pending", methods=["GET"])
def get_notifications():
    """Unified endpoint: return all pending notifications.

    Query params:
        fast=1 — only check fast local sources (DB reminders + hub chat).
                 Skips slow external APIs (Slack, email). Used by the
                 notification-poller daemon which polls every 1s.
    """
    fast_mode = request.args.get("fast") == "1"
    skip_sources = set(request.args.get("skip", "").split(",")) - {""}
    notifications = []
    try:
        _collect_due_reminders(notifications)
    except Exception:
        logger.exception("Failed to collect due reminders")
    try:
        _collect_chat_messages(notifications)
    except Exception:
        logger.exception("Failed to collect chat messages")
    try:
        tasks_collector.collect(notifications)
    except Exception:
        logger.exception("Failed to collect due tasks")
    for c in _COLLECTORS:
        if c.name in skip_sources or (fast_mode and not c.fast):
            continue
        try:
            c.fn(notifications)
        except Exception:
            logger.exception("Failed in collector %s (%s)", c.name, c.source)
    log_notifications(notifications)
    return jsonify(notifications)


STICKY_WINDOW_SEC = 5  # Keep due reminders queryable this long so the poller's
                       # cache stays populated → hook catches them after a tool use


def _collect_due_reminders(notifications):
    """Add due reminders (one-off and recurring) to notifications list.

    One-off reminders stay returned (and `fired=0`) for STICKY_WINDOW_SEC
    after their trigger_time, so the notification poller's cache holds them
    long enough for the PostToolUse hook to inject them into an active
    Claude turn. Hook-side dedup (`/tmp/relaygent-reminder-seen.json`)
    prevents repeat injections.
    """
    now = datetime.now()
    now_iso = now.isoformat()
    fire_cutoff_iso = (now - timedelta(seconds=STICKY_WINDOW_SEC)).isoformat()
    stale_cutoff_iso = (now - timedelta(hours=1)).isoformat()

    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, trigger_time, message, created_at, recurrence "
            "FROM reminders WHERE fired = 0 ORDER BY trigger_time"
        ).fetchall()

        for r in rows:
            # Per-row guard: a single malformed reminder (e.g. a bad `recurrence`
            # cron expr → croniter raises, or an unparseable trigger_time) must
            # not abort the whole poll and silently drop every *other* due
            # reminder. Log it and keep going.
            try:
                if r["recurrence"]:
                    is_due, prev_occ = is_recurring_reminder_due(
                        r["recurrence"], r["trigger_time"]
                    )
                    if is_due:
                        conn.execute(
                            "UPDATE reminders SET trigger_time = ? WHERE id = ?",
                            (prev_occ, r["id"]),
                        )
                        conn.commit()
                        notifications.append({
                            "type": "reminder", "id": r["id"], "message": r["message"],
                            "trigger_time": prev_occ, "created_at": r["created_at"],
                        })
                elif r["trigger_time"] <= now_iso:
                    # Past the sticky window → mark fired=1 and stop returning.
                    if r["trigger_time"] <= fire_cutoff_iso:
                        conn.execute(
                            "UPDATE reminders SET fired = 1 WHERE id = ?", (r["id"],)
                        )
                        conn.commit()
                        if r["trigger_time"] < stale_cutoff_iso:
                            continue  # Too old to bother delivering
                    notifications.append({
                        "type": "reminder", "id": r["id"], "message": r["message"],
                        "trigger_time": r["trigger_time"], "created_at": r["created_at"],
                    })
            except Exception:
                logger.exception("Skipping malformed reminder row (id=%s)",
                                 r["id"] if "id" in r.keys() else "?")


def _collect_chat_messages(notifications):
    """Check hub chat for unread messages."""
    try:
        url = f"{_HUB_PROTO}://{HUB_HOST}:{HUB_PORT}/api/chat?mode=unread"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=2, context=_SSL_CTX) as resp:
            data = json.loads(resp.read().decode())
        if data.get("count", 0) > 0:
            messages = []
            for m in data.get("messages", []):
                messages.append({
                    "timestamp": m.get("created_at", ""),
                    "content": m.get("content", ""),
                })
            notifications.append({
                "type": "message",
                "source": "chat",
                "count": data["count"],
                "messages": messages,
            })
    except (urllib.error.URLError, json.JSONDecodeError, OSError):
        logger.warning("Failed to check hub chat for unread messages", exc_info=True)


_COLLECTORS = collector_registry.discover()
logger.info(
    "Loaded %d notification collectors: %s",
    len(_COLLECTORS),
    ", ".join(f"{c.name}({'fast' if c.fast else 'slow'})" for c in _COLLECTORS),
)


@app.route("/notifications/history", methods=["GET"])
def notification_history():
    """Return notification history, newest first."""
    limit = min(int(request.args.get("limit", 50)), 200)
    offset = int(request.args.get("offset", 0))
    entries = get_notification_history(limit, offset)
    return jsonify({"entries": entries, "limit": limit, "offset": offset})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})
