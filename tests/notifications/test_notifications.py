"""Tests for notifications — DB, reminders, recurring logic, endpoints."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path


os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-notif")

import pytest

# Import all modules upfront so routes are registered before any requests
import notif_config as config  # noqa: E402
import db as notif_db  # noqa: E402
import reminders as rem_mod  # noqa: E402
import routes as routes_mod  # noqa: E402
import tasks_collector as tc_mod  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "reminders.db"))
    notif_db.init_db()


@pytest.fixture()
def client():
    config.app.config["TESTING"] = True
    with config.app.test_client() as c:
        yield c


class TestDatabase:
    def test_init_creates_table(self):
        with notif_db.get_db() as conn:
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        names = [r["name"] for r in rows]
        assert "reminders" in names

    def test_get_db_row_factory(self):
        with notif_db.get_db() as conn:
            conn.execute(
                "INSERT INTO reminders (trigger_time, message) VALUES (?, ?)",
                ("2026-01-01T00:00:00", "test"),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM reminders").fetchone()
        assert row["message"] == "test"


class TestReminderCreate:
    """POST /reminder creates a one-off reminder."""

    def test_create(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "2026-12-31T23:59:00",
            "message": "sleep timeout",
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["status"] == "created"
        assert "id" in data

    def test_create_missing_fields(self, client):
        resp = client.post("/reminder", json={"message": "no time"})
        assert resp.status_code == 400

    def test_create_invalid_time(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "not-a-date", "message": "bad",
        })
        assert resp.status_code == 400

    def test_create_message_too_long(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "2026-12-31T00:00:00",
            "message": "x" * 2001,
        })
        assert resp.status_code == 400


class TestRecurringLogic:
    def test_due_when_stale(self):
        old = (datetime.now() - timedelta(hours=1)).isoformat()
        is_due, prev = rem_mod.is_recurring_reminder_due("* * * * *", old)
        assert is_due is True
        assert prev

    def test_not_due_when_fresh(self):
        future = (datetime.now() + timedelta(hours=1)).isoformat()
        is_due, _ = rem_mod.is_recurring_reminder_due("* * * * *", future)
        assert is_due is False


class TestNotificationsEndpoint:
    def test_health(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"

    def test_pending_fast_with_due(self, client):
        past = (datetime.now() - timedelta(minutes=1)).isoformat()
        client.post("/reminder", json={
            "trigger_time": past, "message": "due now",
        })
        resp = client.get("/notifications/pending?fast=1")
        data = resp.get_json()
        assert isinstance(data, list)
        reminders = [n for n in data if n["type"] == "reminder"]
        assert len(reminders) >= 1

    def test_pending_fast_empty(self, client, monkeypatch):
        monkeypatch.setattr(routes_mod, "_collect_chat_messages", lambda n: None)
        resp = client.get("/notifications/pending?fast=1")
        assert resp.get_json() == []


class TestSlackCollectorHelpers:
    def test_ack_creates_timestamp_file(self, tmp_path, monkeypatch):
        import slack_collector
        ts_file = str(tmp_path / ".last_check_ts")
        monkeypatch.setattr(slack_collector, "_LAST_CHECK_FILE", ts_file)
        slack_collector.ack()
        assert os.path.exists(ts_file)
        assert float(open(ts_file).read().strip()) > 0

    def test_collect_skips_without_token(self, tmp_path, monkeypatch):
        import slack_collector
        monkeypatch.setattr(
            slack_collector, "SLACK_TOKEN_PATH",
            str(tmp_path / "nonexistent.json"),
        )
        notifications = []
        slack_collector.collect(notifications)
        assert notifications == []


class TestTasksCollector:
    def test_parse_recurring(self):
        t = tc_mod._parse_task_line("- [ ] Check it | type: recurring | freq: daily | last: 2026-02-01 00:00")
        assert t["description"] == "Check it" and t["freq"] == "daily"

    def test_parse_invalid(self):
        assert tc_mod._parse_task_line("## Section header") is None

    def test_collect_overdue(self, tmp_path, monkeypatch):
        monkeypatch.setattr(tc_mod, "NOTIFIED_FILE", tmp_path / "n.json")
        monkeypatch.setenv("RELAYGENT_KB_DIR", str(tmp_path))
        (tmp_path / "tasks.md").write_text(
            "- [ ] Old task | type: recurring | freq: daily | last: 2026-01-01 00:00\n"
        )
        notifications = []
        tc_mod.collect(notifications)
        assert any(n["type"] == "task" for n in notifications)

    def test_collect_not_yet_due(self, tmp_path, monkeypatch):
        monkeypatch.setattr(tc_mod, "NOTIFIED_FILE", tmp_path / "n.json")
        monkeypatch.setenv("RELAYGENT_KB_DIR", str(tmp_path))
        future = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d %H:%M")
        (tmp_path / "tasks.md").write_text(
            f"- [ ] Future task | type: recurring | freq: daily | last: {future}\n"
        )
        notifications = []
        tc_mod.collect(notifications)
        assert not any(n["type"] == "task" for n in notifications)


class TestRoutesEdgeCases:
    def test_stale_reminder_excluded(self, client):
        stale = (datetime.now() - timedelta(hours=2)).isoformat()
        client.post("/reminder", json={"trigger_time": stale, "message": "too old"})
        data = client.get("/notifications/pending?fast=1").get_json()
        assert all(n.get("message") != "too old" for n in data if n["type"] == "reminder")

    def test_ack_slack_endpoint(self, client):
        assert client.post("/notifications/ack-slack").get_json()["status"] == "ok"


class TestReminderRecurrence:
    def test_create_with_recurrence(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "2026-12-31T00:00:00",
            "message": "weekly check",
            "recurrence": "0 9 * * 1",
        })
        assert resp.status_code == 201 and resp.get_json().get("recurrence") == "0 9 * * 1"

    def test_create_invalid_recurrence(self, client):
        resp = client.post("/reminder", json={
            "trigger_time": "2026-12-31T00:00:00",
            "message": "bad cron",
            "recurrence": "not-a-cron",
        })
        assert resp.status_code == 400
