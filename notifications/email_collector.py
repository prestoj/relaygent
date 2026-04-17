"""Email notification collector — reads cache written by email-poller.mjs.

The poller writes non-automated emails to a JSON cache file. This module
reads that cache and surfaces unacked emails as notifications. Auto-advances
the ack timestamp when emails are returned so they fire exactly once.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import time

from notif_config import app
from flask import jsonify

logger = logging.getLogger(__name__)

CACHE_FILE = os.environ.get("RELAYGENT_EMAIL_CACHE", "/tmp/relaygent-email-cache.json")
_ACK_FILE = os.path.join(os.path.expanduser("~"), ".relaygent", "gmail", ".email_ack_ts")
_CONTACT_LOOKUP = os.path.expanduser("~/bin/contact-lookup")
_EMAIL_RE = re.compile(r"<([^>]+)>")


def _extract_email(addr: str) -> str:
    """Extract `user@host` from either 'Name <user@host>' or bare 'user@host'."""
    if not addr: return ""
    m = _EMAIL_RE.search(addr)
    return (m.group(1) if m else addr).strip().lower()


def _lookup(email_addr: str) -> tuple[str | None, str | None]:
    """Resolve an email address to (name, notes) via contact-lookup."""
    if not email_addr or not os.path.exists(_CONTACT_LOOKUP):
        return None, None
    try:
        r = subprocess.run(
            [_CONTACT_LOOKUP, "--context", email_addr],
            capture_output=True, text=True, timeout=3,
        )
        out = r.stdout.strip()
        if not out: return None, None
        parts = out.split("---", 1)
        name = parts[0].strip() or None
        notes = parts[1].strip() if len(parts) > 1 else None
        return name, notes
    except (subprocess.TimeoutExpired, OSError):
        return None, None


def _get_ack_ts() -> float:
    try:
        if os.path.exists(_ACK_FILE):
            with open(_ACK_FILE) as f: return float(f.read().strip())
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

    resolved: dict[str, tuple[str | None, str | None]] = {}
    def _resolve(from_addr: str) -> tuple[str | None, str | None]:
        email = _extract_email(from_addr)
        if email not in resolved:
            resolved[email] = _lookup(email)
        return resolved[email]

    def _shape(e: dict) -> dict:
        name, notes = _resolve(e.get("from", ""))
        out = {
            "from": e.get("from", "?"),
            "subject": e.get("subject", "(no subject)"),
            "received_at": e.get("received_at", 0),
            # `timestamp` is what SleepManager uses for dedup fingerprints.
            # Without it every email burst hashes to "email-email-N" and
            # subsequent same-count bursts get dropped forever.
            "timestamp": e.get("received_at", 0),
        }
        if name:
            out["sender_name"] = name
            if notes:
                out["sender_context"] = " ".join(notes.split())[:240]
        return out

    messages = [_shape(e) for e in emails[:5]]

    notifications.append({
        "type": "email",
        "source": "email",
        "count": len(emails),
        "messages": messages,
        # `previews` kept for backwards-compat with any consumer still
        # reading the old shape; new code should use `messages`.
        "previews": [{"from": m["from"], "subject": m["subject"]} for m in messages],
    })


@app.route("/notifications/ack-email", methods=["POST"])
def ack_email():
    """HTTP endpoint — manually advance email ack to now."""
    _advance_ack(time.time())
    return jsonify({"status": "ok"})
