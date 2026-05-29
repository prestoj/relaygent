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


class TestUnknownTypeDedupStable:
    def test_unknown_type_key_is_deterministic(self):
        """Fallback key must be stable (regression: hash() is PYTHONHASHSEED-
        randomized, so identical payloads got different keys across restarts)."""
        n = {"type": "weird", "payload": 1}
        notif_logger.log_notifications([n])
        notif_logger.log_notifications([dict(n)])  # identical payload again
        rows = [h for h in notif_db.get_notification_history() if h["type"] == "weird"]
        assert len(rows) == 1
