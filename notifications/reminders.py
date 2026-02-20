"""Relaygent Notifications — reminder routes and recurring logic."""

from datetime import datetime

from notif_config import CRONITER_AVAILABLE, app
from db import get_db
from flask import jsonify, request

if CRONITER_AVAILABLE:
    from croniter import croniter


MAX_MESSAGE_LEN = 2000


def _validate_iso(value):
    """Validate that value is a parseable ISO datetime string."""
    try:
        datetime.fromisoformat(value)
        return True
    except (ValueError, TypeError):
        return False


def _validate_cron(value):
    """Validate that value is a valid cron expression."""
    if not CRONITER_AVAILABLE:
        return True  # Can't validate without croniter, allow it
    try:
        croniter(value)
        return True
    except (ValueError, TypeError, KeyError):
        return False


@app.route("/reminder", methods=["POST"])
def create_reminder():
    """Create a new reminder. JSON: {trigger_time, message, recurrence?}"""
    data = request.get_json()
    if not data or "trigger_time" not in data or "message" not in data:
        return jsonify({"error": "trigger_time and message required"}), 400

    trigger_time = data["trigger_time"]
    message = data["message"]
    recurrence = data.get("recurrence")

    if not isinstance(trigger_time, str) or not _validate_iso(trigger_time):
        return jsonify({"error": "trigger_time must be valid ISO datetime"}), 400
    if not isinstance(message, str) or len(message) > MAX_MESSAGE_LEN:
        return jsonify({"error": f"message must be string, max {MAX_MESSAGE_LEN} chars"}), 400
    if recurrence is not None:
        if not isinstance(recurrence, str) or not _validate_cron(recurrence):
            return jsonify({"error": "recurrence must be valid cron expression"}), 400

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO reminders (trigger_time, message, recurrence) "
            "VALUES (?, ?, ?)",
            (trigger_time, message, recurrence),
        )
        conn.commit()
        reminder_id = cursor.lastrowid

    result = {"id": reminder_id, "status": "created"}
    if recurrence:
        result["recurrence"] = recurrence
    return jsonify(result), 201


@app.route("/upcoming", methods=["GET"])
def list_reminders():
    """List unfired reminders (used by hub dashboard)."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, trigger_time, message, created_at, recurrence "
            "FROM reminders WHERE fired = 0 ORDER BY trigger_time"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/reminder/<int:reminder_id>", methods=["DELETE"])
def delete_reminder(reminder_id):
    """Cancel a reminder by id."""
    with get_db() as conn:
        cur = conn.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))
        conn.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})


def is_recurring_reminder_due(recurrence, last_trigger_time):
    """Check if recurring reminder should fire now.

    Compares most recent cron occurrence against last_trigger_time.
    If the last occurrence is newer than when we last fired, it's due.
    No time window — reminders can't be missed due to polling gaps.

    Returns (is_due, prev_occurrence_iso).
    """
    if not CRONITER_AVAILABLE:
        return False, ""

    now = datetime.now()
    cron = croniter(recurrence, now)
    prev_occurrence = cron.get_prev(datetime)

    # Only fire if this occurrence hasn't been fired yet
    if last_trigger_time:
        last_trigger_dt = datetime.fromisoformat(last_trigger_time)
        if last_trigger_dt >= prev_occurrence:
            return False, ""

    return True, prev_occurrence.isoformat()
