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

# Local consume watermark, advanced by the notification hook on consume (a turn
# saw the notif), NOT here on surface. Mirrors email's `.email_ack_ts`. See
# [[github-consume-gating-design]] / [[notifications-delivery-model]]. The old
# `.last_check_ts` (surface-advanced) caused at-most-once loss: a notif surfaced
# on a background poll no turn ever saw moved `since` past it → dropped next poll.
_CONSUMED_FILE = os.path.join(
    os.path.expanduser("~"), ".relaygent", "github", ".consumed_ts"
)

# First-poll lookback floor (no watermark yet) — bounds the initial API response.
_INITIAL_LOOKBACK_S = 7 * 24 * 3600

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


def _load_consumed():
    """Read the consume watermark (max updated_at a turn has seen). ISO-Z or None.

    Written ONLY by the notification hook on consume — never advanced here.
    """
    try:
        with open(_CONSUMED_FILE) as f:
            return f.read().strip() or None
    except OSError:
        return None


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
    """Surface unread GitHub notifications newer than the consume watermark.

    Gates SOLELY on the local consume watermark (`updated_at > consumed`), NOT on
    the remote `unread` flag. The wake-ack (`ack()` below, called on wake before
    any turn consumes) does a remote mark-ALL-read, so an `unread` sub-filter would
    drop anything acked-but-not-yet-consumed (e.g. items past the [:10] cap, or
    arriving between poll and wake-ack). The local watermark is the only gate; the
    remote read-state is now cosmetic. See [[github-consume-gating-design]].
    """
    if not _gh_available():
        return

    consumed = _load_consumed()
    # `since` bounds the API response. Use the watermark if we have one, else a
    # rolling lookback floor so the first poll isn't unbounded.
    since = consumed or time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - _INITIAL_LOOKBACK_S)
    )

    data = _gh_api("notifications", {"since": since})
    if data is None:
        # Transient API error (gh failure/timeout/bad JSON). Retry next poll.
        return
    if not isinstance(data, list):
        return

    # Actionable AND strictly newer than what a turn has already consumed.
    # ISO-8601-Z strings compare lexicographically == chronologically.
    relevant = [
        n for n in data
        if n.get("reason") in _WAKE_REASONS
        and (not consumed or n.get("updated_at", "") > consumed)
    ]
    if not relevant:
        return

    messages = []
    ack_ts = ""
    for n in relevant[:10]:  # Cap at 10 to avoid flooding
        updated = n.get("updated_at") or ""
        # Per-message dedup key: prefer updated_at; fall back to the thread id if
        # a thread ever lacks it (note 2) so distinct threads never collapse to
        # one empty-string key in the SleepManager's _extract_timestamps.
        messages.append({
            "timestamp": updated or ("id:" + str(n.get("id", ""))),
            "content": _format_notification(n),
        })
        # Watermark advances on REAL ISO timestamps only — never the id fallback
        # (an "id:..." string sorts above ISO dates and would freeze the gate).
        if updated > ack_ts:
            ack_ts = updated

    notifications.append({
        "type": "message",
        "source": "github",
        "count": len(relevant),
        "messages": messages,
        # Max updated_at surfaced this batch → the hook advances `.consumed_ts`
        # to this on consume (PostToolUse). Persist nothing forward from here.
        "ack_ts": ack_ts,
    })


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
