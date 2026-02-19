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
        with contextlib.suppress(sqlite3.OperationalError):
            conn.execute(
                "ALTER TABLE reminders ADD COLUMN recurrence TEXT DEFAULT NULL"
            )
        conn.commit()
