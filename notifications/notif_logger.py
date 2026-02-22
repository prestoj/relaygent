"""Notification history logger — converts notifications to log entries."""

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
            log_notification(
                "task", "task", summary,
                json.dumps(n), f"task-{hash(desc)}")
        elif ntype in ("email", "github", "linear"):
            key = n.get("id", n.get("url", ""))
            log_notification(
                ntype, ntype, n.get("title", n.get("message", ""))[:200],
                json.dumps(n), f"{ntype}-{key}")
        else:
            log_notification(
                ntype, ntype, str(n)[:200],
                json.dumps(n), f"{ntype}-{hash(json.dumps(n, sort_keys=True))}")
    try:
        prune_notification_log()
    except Exception:
        logger.debug("Failed to prune notification log", exc_info=True)
