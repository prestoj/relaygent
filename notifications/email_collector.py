"""Email notification collector — reads cache written by email-poller.mjs.

The poller writes non-automated emails to a JSON cache file. This module
reads that cache and surfaces unacked emails as notifications. Auto-advances
the ack timestamp when emails are returned so they fire exactly once.
"""
from __future__ import annotations

import json
import logging
import os
import time

from notif_config import app
from flask import jsonify

logger = logging.getLogger(__name__)

CACHE_FILE = os.environ.get("RELAYGENT_EMAIL_CACHE", "/tmp/relaygent-email-cache.json")
_ACK_FILE = os.path.join(os.path.expanduser("~"), ".relaygent", "gmail", ".email_ack_ts")


def _get_ack_ts() -> float:
    try:
        if os.path.exists(_ACK_FILE):
            return float(open(_ACK_FILE).read().strip())
    except (OSError, ValueError):
        pass
    return 0.0


def _advance_ack(ts: float) -> None:
    try:
        os.makedirs(os.path.dirname(_ACK_FILE), exist_ok=True)
        with open(_ACK_FILE, "w") as f:
            f.write(f"{ts:.3f}")
    except OSError as e:
        logger.warning("Failed to write email ack: %s", e)


def collect(notifications: list) -> None:
    """Add unacked emails from the poller cache to notifications."""
    try:
        if not os.path.exists(CACHE_FILE):
            return
        with open(CACHE_FILE) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return

    ack_ts = _get_ack_ts()
    emails = [e for e in data.get("emails", []) if e.get("received_at", 0) > ack_ts]
    if not emails:
        return

    max_ts = max(e.get("received_at", 0) for e in emails)
    _advance_ack(max_ts)

    notifications.append({
        "type": "email",
        "source": "email",
        "count": len(emails),
        "previews": [
            {"from": e.get("from", "?"), "subject": e.get("subject", "(no subject)")}
            for e in emails[:5]
        ],
    })


@app.route("/notifications/ack-email", methods=["POST"])
def ack_email():
    """HTTP endpoint — manually advance email ack to now."""
    _advance_ack(time.time())
    return jsonify({"status": "ok"})
