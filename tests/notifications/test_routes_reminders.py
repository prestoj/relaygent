"""Tests for routes.py reminder collection and reminders.py CRUD/recurring logic."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "notifications"))
os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-routes-rem")

import pytest
import notif_config as config
import db as notif_db
import reminders as rem_mod
import routes as routes_mod


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "reminders.db"))
    notif_db.init_db()


@pytest.fixture()
def client():
    config.app.config["TESTING"] = True
    with config.app.test_client() as c:
        yield c


# --- _collect_due_reminders ---

class TestCollectDueReminders:
    def test_no_reminders_returns_empty(self):
        notifs = []
        routes_mod._collect_due_reminders(notifs)
        assert notifs == []

    def test_due_oneoff_fires_and_marks_fired(self):
        past = (datetime.now() - timedelta(minutes=5)).isoformat()
        with notif_db.get_db() as conn:
            conn.execute(
                "INSERT INTO reminders (trigger_time, message) VALUES (?, ?)",
                (past, "overdue task"),
            )
            conn.commit()
        notifs = []
        routes_mod._collect_due_reminders(notifs)
        assert len(notifs) == 1
        assert notifs[0]["type"] == "reminder"
        assert notifs[0]["message"] == "overdue task"
        # Verify it was marked fired
        with notif_db.get_db() as conn:
            row = conn.execute("SELECT fired FROM reminders WHERE id=1").fetchone()
            assert row["fired"] == 1

    def test_future_oneoff_not_collected(self):
        future = (datetime.now() + timedelta(hours=1)).isoformat()
        with notif_db.get_db() as conn:
            conn.execute(
                "INSERT INTO reminders (trigger_time, message) VALUES (?, ?)",
                (future, "not yet"),
            )
            conn.commit()
        notifs = []
        routes_mod._collect_due_reminders(notifs)
        assert notifs == []

    def test_stale_oneoff_skipped(self):
        stale = (datetime.now() - timedelta(hours=2)).isoformat()
        with notif_db.get_db() as conn:
            conn.execute(
                "INSERT INTO reminders (trigger_time, message) VALUES (?, ?)",
                (stale, "too old"),
            )
            conn.commit()
        notifs = []
        routes_mod._collect_due_reminders(notifs)
        # Should be marked fired but NOT added to notifications (stale)
        assert notifs == []
        with notif_db.get_db() as conn:
            row = conn.execute("SELECT fired FROM reminders WHERE id=1").fetchone()
            assert row["fired"] == 1

    def test_already_fired_not_collected(self):
        past = (datetime.now() - timedelta(minutes=5)).isoformat()
        with notif_db.get_db() as conn:
            conn.execute(
                "INSERT INTO reminders (trigger_time, message, fired) VALUES (?, ?, 1)",
                (past, "already done"),
            )
            conn.commit()
        notifs = []
        routes_mod._collect_due_reminders(notifs)
        assert notifs == []


# --- Health endpoint ---

class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"


# --- Reminder CRUD ---

class TestCreateReminder:
    def test_create_valid(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "2099-06-01T09:00:00",
            "message": "Test reminder",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert "id" in data
        assert data["status"] == "created"

    def test_create_missing_fields(self, client):
        resp = client.post("/reminder", json={"message": "no time"})
        assert resp.status_code == 400

    def test_create_invalid_time(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "not-a-date",
            "message": "bad time",
        })
        assert resp.status_code == 400

    def test_create_message_too_long(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "2099-06-01T09:00:00",
            "message": "x" * 2001,
        })
        assert resp.status_code == 400

    def test_create_with_recurrence(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "2099-06-01T09:00:00",
            "message": "recurring",
            "recurrence": "0 9 * * *",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["recurrence"] == "0 9 * * *"

    def test_create_invalid_recurrence(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "2099-06-01T09:00:00",
            "message": "bad cron",
            "recurrence": "not a cron",
        })
        assert resp.status_code == 400

    def test_create_empty_body(self, client):
        resp = client.post("/reminder", data="",
                           content_type="application/json")
        assert resp.status_code == 400


# --- is_recurring_reminder_due ---

class TestIsRecurringReminderDue:
    def test_never_fired_is_due(self):
        # A cron that fires every minute — should be due
        is_due, prev = rem_mod.is_recurring_reminder_due("* * * * *", "")
        assert is_due is True
        assert prev != ""

    def test_recently_fired_not_due(self):
        # Fire now, then check — should not be due again
        is_due1, prev1 = rem_mod.is_recurring_reminder_due("* * * * *", "")
        is_due2, _ = rem_mod.is_recurring_reminder_due("* * * * *", prev1)
        assert is_due2 is False

    def test_old_fire_is_due_again(self):
        old = (datetime.now() - timedelta(hours=2)).isoformat()
        is_due, _ = rem_mod.is_recurring_reminder_due("* * * * *", old)
        assert is_due is True


# --- _validate_iso / _validate_cron ---

class TestValidation:
    def test_valid_iso(self):
        assert rem_mod._validate_iso("2026-01-01T00:00:00") is True

    def test_invalid_iso(self):
        assert rem_mod._validate_iso("not-a-date") is False
        assert rem_mod._validate_iso(None) is False

    def test_valid_cron(self):
        assert rem_mod._validate_cron("0 9 * * *") is True

    def test_invalid_cron(self):
        assert rem_mod._validate_cron("not a cron") is False
