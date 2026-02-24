"""Linear notification acknowledgment — mark notifications as read."""
from __future__ import annotations

import time

from notif_config import app
from flask import jsonify
from linear_collector import _graphql, _NOTIF_QUERY


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
    from linear_collector import _get_api_key
    if not _get_api_key():
        return jsonify({"status": "skipped", "reason": "no api key"})
    data = _graphql(_NOTIF_QUERY, {})
    if data:
        nodes = data.get("notifications", {}).get("nodes", [])
        ids = [n["id"] for n in nodes if n.get("id")]
        if ids:
            _mark_read_ids(ids)
    return jsonify({"status": "ok"})
