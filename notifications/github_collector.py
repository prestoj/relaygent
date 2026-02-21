"""GitHub notification collector — checks for PR reviews, comments, mentions."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time

from notif_config import app
from flask import jsonify

logger = logging.getLogger(__name__)

_LAST_CHECK_FILE = os.path.join(
    os.path.expanduser("~"), ".relaygent", "github", ".last_check_ts"
)

# Notification reasons that are worth waking the agent for
_WAKE_REASONS = {
    "review_requested", "author", "comment", "mention",
    "assign", "ci_activity", "approval_requested",
}


def _gh_available():
    """Check if gh CLI is installed and authenticated."""
    try:
        result = subprocess.run(
            ["gh", "auth", "status"],
            capture_output=True, timeout=5,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.SubprocessError):
        return False


def _gh_api(endpoint, params=None):
    """Call GitHub API via gh CLI. Returns parsed JSON or None."""
    cmd = ["gh", "api", endpoint]
    if params:
        for k, v in params.items():
            cmd.extend(["-f", f"{k}={v}"])
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            logger.debug("gh api %s failed: %s", endpoint, result.stderr.strip()[:200])
            return None
        return json.loads(result.stdout)
    except (subprocess.SubprocessError, json.JSONDecodeError) as e:
        logger.warning("gh api %s error: %s", endpoint, e)
        return None


def _load_last_check():
    """Read last check timestamp. Returns ISO string or None."""
    try:
        if os.path.exists(_LAST_CHECK_FILE):
            with open(_LAST_CHECK_FILE) as f:
                return f.read().strip() or None
    except OSError:
        pass
    return None


def _save_last_check():
    """Save current time as last check timestamp."""
    try:
        os.makedirs(os.path.dirname(_LAST_CHECK_FILE), exist_ok=True)
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with open(_LAST_CHECK_FILE, "w") as f:
            f.write(ts)
    except OSError as e:
        logger.warning("Failed to write GitHub last-check: %s", e)


def _format_notification(notif):
    """Format a GitHub notification into a compact summary."""
    subject = notif.get("subject", {})
    repo = notif.get("repository", {}).get("full_name", "")
    title = subject.get("title", "")
    ntype = subject.get("type", "")
    reason = notif.get("reason", "")

    type_label = {"PullRequest": "PR", "Issue": "issue"}.get(ntype, ntype)
    reason_label = {
        "review_requested": "review requested",
        "author": "update on your PR",
        "comment": "new comment",
        "mention": "you were mentioned",
        "assign": "assigned to you",
        "ci_activity": "CI update",
        "approval_requested": "approval requested",
    }.get(reason, reason)

    return f"[{type_label}] {repo}: {title} ({reason_label})"


def collect(notifications):
    """Check GitHub for unread notifications since last check."""
    if not _gh_available():
        return

    last_check = _load_last_check()
    params = {}
    if last_check:
        params["since"] = last_check

    data = _gh_api("notifications", params)
    if not data or not isinstance(data, list):
        _save_last_check()
        return

    # Filter for actionable notifications
    relevant = [
        n for n in data
        if n.get("reason") in _WAKE_REASONS and n.get("unread", True)
    ]

    if not relevant:
        _save_last_check()
        return

    messages = []
    for n in relevant[:10]:  # Cap at 10 to avoid flooding
        messages.append({
            "timestamp": n.get("updated_at", ""),
            "content": _format_notification(n),
        })

    notifications.append({
        "type": "message",
        "source": "github",
        "count": len(relevant),
        "messages": messages,
    })
    _save_last_check()


def ack():
    """Mark all GitHub notifications as read."""
    try:
        subprocess.run(
            ["gh", "api", "-X", "PUT", "notifications"],
            capture_output=True, timeout=10,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        pass


@app.route("/notifications/ack-github", methods=["POST"])
def ack_github():
    """HTTP endpoint — called by harness after wake."""
    ack()
    return jsonify({"status": "ok"})
