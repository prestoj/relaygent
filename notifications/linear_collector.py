"""Linear notification collector — checks for issue assignments, comments, mentions."""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.request

from notif_config import app
from flask import jsonify

logger = logging.getLogger(__name__)

_KEY_PATH = os.path.join(os.path.expanduser("~"), ".relaygent", "linear", "api-key")
_LAST_CHECK_FILE = os.path.join(
    os.path.expanduser("~"), ".relaygent", "linear", ".last_check_ts"
)
_API_URL = "https://api.linear.app/graphql"

# Notification types worth waking the agent for
_WAKE_TYPES = {
    "issueAssignedToYou",
    "issueNewComment",
    "issueMention",
    "issueStatusChanged",
    "issuePriorityChanged",
}

_NOTIF_QUERY = """
query($createdAfter: DateTime) {
  notifications(
    filter: { readAt: { null: true }, createdAt: { gte: $createdAfter } }
    first: 20
    orderBy: createdAt
  ) {
    nodes {
      id type readAt createdAt
      ... on IssueNotification {
        issue { identifier title state { name } assignee { name } }
        comment { body createdAt user { name } }
      }
    }
  }
}
"""


def _get_api_key():
    """Read Linear API key from file."""
    try:
        with open(_KEY_PATH) as f:
            return f.read().strip() or None
    except OSError:
        return None


def _graphql(query, variables=None):
    """Execute a Linear GraphQL query. Returns parsed data or None."""
    key = _get_api_key()
    if not key:
        return None
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        _API_URL, data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        if data.get("errors"):
            logger.warning("Linear API error: %s", data["errors"][0].get("message"))
            return None
        return data.get("data")
    except (urllib.error.URLError, json.JSONDecodeError, OSError) as e:
        logger.warning("Linear API request failed: %s", e)
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
        logger.warning("Failed to write Linear last-check: %s", e)


def _format_notification(notif):
    """Format a Linear notification into a compact summary."""
    ntype = notif.get("type", "")
    issue = notif.get("issue", {})
    identifier = issue.get("identifier", "?")
    title = issue.get("title", "")
    comment = notif.get("comment")

    type_labels = {
        "issueAssignedToYou": "assigned to you",
        "issueNewComment": "new comment",
        "issueMention": "you were mentioned",
        "issueStatusChanged": "status changed",
        "issuePriorityChanged": "priority changed",
    }
    label = type_labels.get(ntype, ntype)

    msg = f"[Linear] {identifier}: {title} ({label})"
    if comment and comment.get("body"):
        author = comment.get("user", {}).get("name", "someone")
        snippet = comment["body"][:100].replace("\n", " ")
        msg += f" — {author}: {snippet}"
    return msg


def collect(notifications):
    """Check Linear for unread notifications since last check."""
    if not _get_api_key():
        return

    last_check = _load_last_check()
    variables = {}
    if last_check:
        variables["createdAfter"] = last_check

    data = _graphql(_NOTIF_QUERY, variables)
    if not data:
        _save_last_check()
        return

    nodes = data.get("notifications", {}).get("nodes", [])
    relevant = [n for n in nodes if n.get("type") in _WAKE_TYPES]

    if not relevant:
        _save_last_check()
        return

    messages = []
    for n in relevant[:10]:
        messages.append({
            "timestamp": n.get("createdAt", ""),
            "content": _format_notification(n),
        })

    notifications.append({
        "type": "message",
        "source": "linear",
        "count": len(relevant),
        "messages": messages,
    })
    _save_last_check()


def _mark_read_ids(notif_ids):
    """Mark specific Linear notifications as read."""
    mutation = """
    mutation($id: String!) {
        notificationUpdate(id: $id, input: { readAt: "%s" }) {
            notification { id }
        }
    }
    """ % time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for nid in notif_ids[:20]:
        _graphql(mutation, {"id": nid})


@app.route("/notifications/ack-linear", methods=["POST"])
def ack_linear():
    """HTTP endpoint — mark recent Linear notifications as read."""
    if not _get_api_key():
        return jsonify({"status": "skipped", "reason": "no api key"})
    data = _graphql(_NOTIF_QUERY, {})
    if data:
        nodes = data.get("notifications", {}).get("nodes", [])
        ids = [n["id"] for n in nodes if n.get("id")]
        if ids:
            _mark_read_ids(ids)
    return jsonify({"status": "ok"})
