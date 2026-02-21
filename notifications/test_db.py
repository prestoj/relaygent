"""Tests for db.py — SQLite database helpers and schema init."""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-db")

import pytest
import notif_config as config
import db as notif_db


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test-reminders.db")
    monkeypatch.setattr(config, "DB_PATH", db_path)
    return tmp_path, db_path


class TestGetDb:
    def test_creates_db_file(self, _isolated):
        _, db_path = _isolated
        with notif_db.get_db() as conn:
            conn.execute("SELECT 1")
        assert Path(db_path).exists()

    def test_creates_parent_dirs(self, tmp_path):
        deep = tmp_path / "a" / "b" / "c" / "test.db"
        config.DB_PATH = str(deep)
        with notif_db.get_db() as conn:
            conn.execute("SELECT 1")
        assert deep.exists()

    def test_connection_closed_after_context(self, _isolated):
        with notif_db.get_db() as conn:
            conn.execute("SELECT 1")
        with pytest.raises(Exception):
            conn.execute("SELECT 1")

    def test_row_factory_is_row(self, _isolated):
        with notif_db.get_db() as conn:
            assert conn.row_factory is sqlite3.Row

    def test_wal_mode_enabled(self, _isolated):
        with notif_db.get_db() as conn:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            assert mode == "wal"


class TestInitDb:
    def test_creates_reminders_table(self, _isolated):
        notif_db.init_db()
        with notif_db.get_db() as conn:
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='reminders'"
            ).fetchall()
            assert len(rows) == 1

    def test_reminders_table_columns(self, _isolated):
        notif_db.init_db()
        with notif_db.get_db() as conn:
            info = conn.execute("PRAGMA table_info(reminders)").fetchall()
            col_names = {row[1] for row in info}
            assert "id" in col_names
            assert "trigger_time" in col_names
            assert "message" in col_names
            assert "created_at" in col_names
            assert "fired" in col_names
            assert "recurrence" in col_names

    def test_idempotent(self, _isolated):
        notif_db.init_db()
        notif_db.init_db()  # should not raise
        with notif_db.get_db() as conn:
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='reminders'"
            ).fetchall()
            assert len(rows) == 1

    def test_insert_and_read_reminder(self, _isolated):
        notif_db.init_db()
        with notif_db.get_db() as conn:
            conn.execute(
                "INSERT INTO reminders (trigger_time, message) VALUES (?, ?)",
                ("2026-03-01T09:00:00", "Test reminder"),
            )
            conn.commit()
        with notif_db.get_db() as conn:
            row = conn.execute("SELECT * FROM reminders WHERE id=1").fetchone()
            assert row["trigger_time"] == "2026-03-01T09:00:00"
            assert row["message"] == "Test reminder"
            assert row["fired"] == 0
            assert row["recurrence"] is None

    def test_recurrence_column_works(self, _isolated):
        notif_db.init_db()
        with notif_db.get_db() as conn:
            conn.execute(
                "INSERT INTO reminders (trigger_time, message, recurrence) VALUES (?, ?, ?)",
                ("2026-03-01T09:00:00", "Daily check", "0 9 * * *"),
            )
            conn.commit()
            row = conn.execute("SELECT recurrence FROM reminders WHERE id=1").fetchone()
            assert row["recurrence"] == "0 9 * * *"
