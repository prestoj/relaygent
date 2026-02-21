"""Tests for notification_log — persistent notification history."""
from __future__ import annotations

import json
import os

os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-notiflog")

import pytest
import notif_config as config
import db as notif_db


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr(config, "DB_PATH", db_path)
    notif_db.init_db()
    return tmp_path, db_path


class TestNotificationLogTable:
    def test_table_created(self, _isolated):
        with notif_db.get_db() as conn:
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='notification_log'"
            ).fetchall()
            assert len(rows) == 1

    def test_table_columns(self, _isolated):
        with notif_db.get_db() as conn:
            info = conn.execute("PRAGMA table_info(notification_log)").fetchall()
            col_names = {row[1] for row in info}
            assert {"id", "timestamp", "type", "source", "summary", "content", "dedup_key"} <= col_names


class TestLogNotification:
    def test_inserts_entry(self, _isolated):
        notif_db.log_notification("reminder", "reminder", "Test msg", '{"id": 1}', "rem-1")
        entries = notif_db.get_notification_history()
        assert len(entries) == 1
        assert entries[0]["type"] == "reminder"
        assert entries[0]["source"] == "reminder"
        assert entries[0]["summary"] == "Test msg"

    def test_dedup_key_prevents_duplicates(self, _isolated):
        notif_db.log_notification("slack", "general", "Hi", "{}", "slack-123")
        notif_db.log_notification("slack", "general", "Hi", "{}", "slack-123")
        entries = notif_db.get_notification_history()
        assert len(entries) == 1

    def test_different_dedup_keys_both_stored(self, _isolated):
        notif_db.log_notification("slack", "general", "Msg 1", "{}", "slack-1")
        notif_db.log_notification("slack", "general", "Msg 2", "{}", "slack-2")
        entries = notif_db.get_notification_history()
        assert len(entries) == 2

    def test_content_stored_as_json(self, _isolated):
        payload = {"id": 42, "text": "hello"}
        notif_db.log_notification("email", "email", "hello", json.dumps(payload), "email-42")
        entries = notif_db.get_notification_history()
        parsed = json.loads(entries[0]["content"])
        assert parsed["id"] == 42


class TestGetNotificationHistory:
    def test_returns_newest_first(self, _isolated):
        notif_db.log_notification("a", "a", "first", "{}", "k-1")
        notif_db.log_notification("b", "b", "second", "{}", "k-2")
        entries = notif_db.get_notification_history()
        assert entries[0]["summary"] == "second"
        assert entries[1]["summary"] == "first"

    def test_limit(self, _isolated):
        for i in range(10):
            notif_db.log_notification("t", "s", f"msg-{i}", "{}", f"k-{i}")
        entries = notif_db.get_notification_history(limit=3)
        assert len(entries) == 3

    def test_offset(self, _isolated):
        for i in range(5):
            notif_db.log_notification("t", "s", f"msg-{i}", "{}", f"k-{i}")
        entries = notif_db.get_notification_history(limit=2, offset=2)
        assert len(entries) == 2
        assert entries[0]["summary"] == "msg-2"

    def test_empty_when_no_entries(self, _isolated):
        entries = notif_db.get_notification_history()
        assert entries == []


class TestPruneNotificationLog:
    def test_prune_removes_old_entries(self, _isolated):
        with notif_db.get_db() as conn:
            conn.execute(
                "INSERT INTO notification_log (timestamp, type, source, summary, content, dedup_key) "
                "VALUES (datetime('now', '-10 days'), 'old', 'old', 'old', '{}', 'old-1')"
            )
            conn.commit()
        notif_db.log_notification("new", "new", "new", "{}", "new-1")
        notif_db.prune_notification_log(max_age_days=7)
        entries = notif_db.get_notification_history()
        assert len(entries) == 1
        assert entries[0]["summary"] == "new"

    def test_prune_keeps_recent_entries(self, _isolated):
        notif_db.log_notification("recent", "recent", "recent", "{}", "r-1")
        notif_db.prune_notification_log(max_age_days=7)
        entries = notif_db.get_notification_history()
        assert len(entries) == 1
