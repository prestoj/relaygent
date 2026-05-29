"""Tests for notif_logger.py — notification history dedup keying."""
from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-db")

import pytest
import notif_config as config
import db as notif_db
import notif_logger


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "test.db"))
    notif_db.init_db()
    return tmp_path


def _task(desc, fired_at):
    return {
        "type": "task", "description": desc, "overdue": "first run",
        "fired_at": fired_at,
        "timestamp": f"task-{desc}-{fired_at}",
    }


class TestTaskDedup:
    def test_distinct_firings_each_logged(self):
        """Each cron/freq firing is a distinct history event (regression:
        the old key was task-{hash(desc)}, collapsing all firings to one row)."""
        notif_logger.log_notifications([_task("Review book", "2026-05-29 06:30")])
        notif_logger.log_notifications([_task("Review book", "2026-05-29 12:30")])
        hist = notif_db.get_notification_history()
        tasks = [h for h in hist if h["type"] == "task"]
        assert len(tasks) == 2

    def test_same_firing_deduped(self):
        """The sticky window re-emits one firing repeatedly — those must dedup."""
        for _ in range(3):
            notif_logger.log_notifications([_task("Review book", "2026-05-29 06:30")])
        tasks = [h for h in notif_db.get_notification_history() if h["type"] == "task"]
        assert len(tasks) == 1

    def test_key_stable_without_timestamp_field(self):
        """Falls back to a deterministic key built from fired_at when the
        notification lacks an explicit `timestamp`."""
        n = {"type": "task", "description": "X", "fired_at": "2026-05-29 06:30"}
        notif_logger.log_notifications([n])
        notif_logger.log_notifications([n])
        tasks = [h for h in notif_db.get_notification_history() if h["type"] == "task"]
        assert len(tasks) == 1


class TestMessageHistory:
    def test_slack_messages_logged_from_channels(self):
        """Slack nests messages under channels[]; regression: the flat
        messages[] path logged nothing for Slack, so history was empty."""
        n = {"type": "message", "source": "slack", "count": 2, "channels": [
            {"id": "C1", "name": "general", "unread": 2, "messages": [
                {"user": "U1", "text": "hi", "ts": "1780095000.1"},
                {"user": "U2", "text": "yo", "ts": "1780095001.2"},
            ]},
        ]}
        notif_logger.log_notifications([n])
        rows = [h for h in notif_db.get_notification_history()
                if h["type"] == "message" and h["source"] == "slack"]
        assert len(rows) == 2
        assert {r["summary"] for r in rows} == {"hi", "yo"}

    def test_slack_same_ts_deduped(self):
        n = {"type": "message", "source": "slack", "count": 1, "channels": [
            {"id": "C1", "name": "g", "messages": [{"text": "hi", "ts": "1.0"}]}]}
        notif_logger.log_notifications([n])
        notif_logger.log_notifications([n])
        rows = [h for h in notif_db.get_notification_history() if h["source"] == "slack"]
        assert len(rows) == 1

    def test_flat_messages_logged_with_source(self):
        """GitHub/chat carry a flat messages[] with content+timestamp."""
        n = {"type": "message", "source": "github", "count": 1,
             "messages": [{"content": "[PR] repo: x (review requested)", "timestamp": "t1"}]}
        notif_logger.log_notifications([n])
        rows = [h for h in notif_db.get_notification_history() if h["source"] == "github"]
        assert len(rows) == 1
        assert rows[0]["summary"].startswith("[PR]")


class TestEmailHistory:
    def test_each_email_logged_distinctly(self):
        """Regression: the whole batch keyed on an absent top-level id →
        constant key `email-` + empty content, collapsing to one row."""
        n = {"type": "email", "source": "email", "count": 2, "messages": [
            {"from": "a@x.com", "subject": "Hi", "received_at": 100, "dedup": "m1"},
            {"from": "b@x.com", "subject": "Yo", "received_at": 100, "dedup": "m2"},
        ]}
        notif_logger.log_notifications([n])
        rows = [h for h in notif_db.get_notification_history() if h["type"] == "email"]
        assert len(rows) == 2
        assert any("a@x.com: Hi" in r["summary"] for r in rows)

    def test_email_dedup_key_fallback_without_id(self):
        n = {"type": "email", "source": "email", "count": 1, "messages": [
            {"from": "a@x.com", "subject": "Hi", "received_at": 100}]}
        notif_logger.log_notifications([n])
        notif_logger.log_notifications([n])
        rows = [h for h in notif_db.get_notification_history() if h["type"] == "email"]
        assert len(rows) == 1


class TestUnknownTypeDedupStable:
    def test_unknown_type_key_is_deterministic(self):
        """Fallback key must be stable (regression: hash() is PYTHONHASHSEED-
        randomized, so identical payloads got different keys across restarts)."""
        n = {"type": "weird", "payload": 1}
        notif_logger.log_notifications([n])
        notif_logger.log_notifications([dict(n)])  # identical payload again
        rows = [h for h in notif_db.get_notification_history() if h["type"] == "weird"]
        assert len(rows) == 1
