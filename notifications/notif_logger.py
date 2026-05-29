"""Notification history logger — converts notifications to log entries."""

import hashlib
import json
import logging

from db import log_notification, prune_notification_log

logger = logging.getLogger(__name__)


def log_notifications(notifications):
    """Persist non-empty notifications to the history log."""
    if not notifications:
        return
    for n in notifications:
        ntype = n.get("type", "unknown")
        if ntype == "reminder":
            log_notification(
                "reminder", "reminder", n.get("message", "")[:200],
                json.dumps(n), f"reminder-{n.get('id', '')}")
        elif ntype == "message":
            source = n.get("source", "chat")
            if n.get("channels"):
                # Slack and any channel-shaped source nest their messages under
                # channels[] — the flat messages[] below is empty for them, so
                # without this Slack history was never logged at all. Key per
                # message on channel+ts. (The old `type == "slack"` branch was
                # dead: the collector emits type "message", source "slack".)
                for ch in n["channels"]:
                    cid = ch.get("id", ch.get("name", ""))
                    for m in ch.get("messages", []):
                        log_notification(
                            "message", source, m.get("text", "")[:200],
                            json.dumps(m), f"{source}-{cid}-{m.get('ts', '')}")
            else:
                # chat / GitHub: flat messages[] carrying content + timestamp.
                for m in n.get("messages", []):
                    log_notification(
                        "message", source, m.get("content", "")[:200],
                        json.dumps(m), f"{source}-{m.get('timestamp', '')}")
        elif ntype == "task":
            desc = n.get("description", "")[:200]
            overdue = n.get("overdue", "")
            summary = f"{desc} ({overdue})" if overdue else desc
            # Dedup on the firing time, not just the description: each cron/freq
            # firing is a distinct history event. The task notification already
            # carries a stable key in `timestamp` (task-<desc>-<fired_at>); fall
            # back to building it from fired_at. (hash(desc) was wrong twice over:
            # it collapsed every repeat firing to one row, and str hashing is
            # PYTHONHASHSEED-randomized so keys weren't stable across restarts.)
            key = n.get("timestamp") or f"task-{desc}-{n.get('fired_at', '')}"
            log_notification("task", "task", summary, json.dumps(n), key)
        elif ntype == "email":
            # Email carries per-message previews; the old code keyed the whole
            # batch on a non-existent top-level id → constant key `email-` with
            # empty content, collapsing all email history to one row. Log one row
            # per mail, keyed on the stable dedup id (Gmail msg id; #745) with a
            # received_at/from/subject fallback for entries that predate it.
            for m in n.get("messages") or n.get("previews") or []:
                key = m.get("dedup") or (
                    f"{m.get('received_at', '')}-{m.get('from', '')}-{m.get('subject', '')}")
                summary = f"{m.get('from', '')}: {m.get('subject', '')}".strip(": ")
                log_notification(
                    "email", "email", summary[:200], json.dumps(m), f"email-{key}")
        else:
            digest = hashlib.sha1(
                json.dumps(n, sort_keys=True).encode()).hexdigest()[:16]
            log_notification(
                ntype, ntype, str(n)[:200], json.dumps(n), f"{ntype}-{digest}")
    try:
        prune_notification_log()
    except Exception:
        logger.debug("Failed to prune notification log", exc_info=True)
