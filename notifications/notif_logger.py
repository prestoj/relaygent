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
            msgs = n.get("messages", [])
            for m in msgs:
                log_notification(
                    "message", source, m.get("content", "")[:200],
                    json.dumps(m), f"chat-{m.get('timestamp', '')}")
        elif ntype == "slack":
            for m in n.get("messages", [n]):
                ts = m.get("ts", m.get("timestamp", ""))
                log_notification(
                    "slack", n.get("channel_name", "slack"),
                    m.get("text", "")[:200], json.dumps(m), f"slack-{ts}")
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
        elif ntype in ("email", "github", "linear"):
            key = n.get("id", n.get("url", ""))
            log_notification(
                ntype, ntype, n.get("title", n.get("message", ""))[:200],
                json.dumps(n), f"{ntype}-{key}")
        else:
            digest = hashlib.sha1(
                json.dumps(n, sort_keys=True).encode()).hexdigest()[:16]
            log_notification(
                ntype, ntype, str(n)[:200], json.dumps(n), f"{ntype}-{digest}")
    try:
        prune_notification_log()
    except Exception:
        logger.debug("Failed to prune notification log", exc_info=True)
