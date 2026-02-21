"""Relaygent Notifications — database helpers."""

import contextlib
import os
import sqlite3

import notif_config


@contextlib.contextmanager
def get_db():
    """Yield a SQLite connection that is closed when the context exits."""
    db_path = notif_config.DB_PATH
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trigger_time TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                fired INTEGER DEFAULT 0,
                recurrence TEXT DEFAULT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notification_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                type TEXT NOT NULL,
                source TEXT NOT NULL,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,
                dedup_key TEXT UNIQUE
            )
        """)
        with contextlib.suppress(sqlite3.OperationalError):
            conn.execute(
                "ALTER TABLE reminders ADD COLUMN recurrence TEXT DEFAULT NULL"
            )
        conn.commit()


def log_notification(notif_type, source, summary, content_json, dedup_key):
    """Log a notification to history. Silently skips duplicates."""
    with get_db() as conn:
        try:
            conn.execute(
                "INSERT OR IGNORE INTO notification_log "
                "(type, source, summary, content, dedup_key) "
                "VALUES (?, ?, ?, ?, ?)",
                (notif_type, source, summary, content_json, dedup_key),
            )
            conn.commit()
        except sqlite3.Error:
            pass


def get_notification_history(limit=50, offset=0):
    """Return recent notification log entries, newest first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, timestamp, type, source, summary, content "
            "FROM notification_log ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]


def prune_notification_log(max_age_days=7):
    """Delete notification log entries older than max_age_days."""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM notification_log WHERE timestamp < datetime('now', ?)",
            (f"-{max_age_days} days",),
        )
        conn.commit()
