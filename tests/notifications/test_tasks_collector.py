"""Tests for tasks_collector.py — overdue recurring task notifications."""
from __future__ import annotations

import json, os, sys
from datetime import datetime, timedelta
from pathlib import Path

os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-tasks-col")

import pytest
import notif_config as config
import tasks_collector as tc


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(tc, "NOTIFIED_FILE", tmp_path / "task-notified.json")
    monkeypatch.setenv("RELAYGENT_KB_DIR", str(tmp_path / "kb"))
    (tmp_path / "kb").mkdir()
    return tmp_path


def _write_tasks(tmp_path, lines):
    (tmp_path / "kb" / "tasks.md").write_text("\n".join(lines))


def _collect(tmp_path=None, lines=None):
    if tmp_path and lines:
        _write_tasks(tmp_path, lines)
    notifs = []
    tc.collect(notifs)
    return notifs


class TestFreqMs:
    def test_known_frequencies(self):
        assert tc._freq_ms("6h") == 6 * 3600000
        assert tc._freq_ms("12h") == 12 * 3600000
        assert tc._freq_ms("daily") == 24 * 3600000
        assert tc._freq_ms("2d") == 48 * 3600000
        assert tc._freq_ms("weekly") == 168 * 3600000
        assert tc._freq_ms("monthly") == 720 * 3600000

    def test_unknown_freq_defaults_to_daily(self):
        assert tc._freq_ms("bogus") == 24 * 3600000
        assert tc._freq_ms("") == 24 * 3600000


class TestParseTaskLine:
    def test_unchecked_oneoff(self):
        r = tc._parse_task_line("- [ ] Fix the bug")
        assert r is not None and r["description"] == "Fix the bug"
        assert r["type"] == "one-off"

    def test_checked_oneoff(self):
        r = tc._parse_task_line("- [x] Done task")
        assert r is not None and r["description"] == "Done task"

    def test_recurring_with_meta(self):
        line = "- [ ] Check logs | type: recurring | freq: daily | last: 2026-02-01T10:00:00"
        r = tc._parse_task_line(line)
        assert r["description"] == "Check logs"
        assert r["type"] == "recurring" and r["freq"] == "daily"
        assert r["last"] == "2026-02-01T10:00:00"

    def test_non_task_line_returns_none(self):
        assert tc._parse_task_line("## Section header") is None
        assert tc._parse_task_line("some random text") is None
        assert tc._parse_task_line("") is None

    def test_missing_meta_defaults(self):
        r = tc._parse_task_line("- [ ] Simple task")
        assert r["type"] == "one-off" and r["freq"] == "" and r["last"] == ""

    def test_uppercase_x(self):
        assert tc._parse_task_line("- [X] Done task") is not None


class TestNotifiedPersistence:
    def test_load_returns_empty_when_no_file(self):
        assert tc._load_notified() == {}

    def test_save_and_load_roundtrip(self, _isolated):
        data = {"Check logs": 1000000.0, "Backup": 2000000.0}
        tc._save_notified(data)
        assert tc._load_notified() == data

    def test_load_returns_empty_on_corrupt_json(self, _isolated):
        tc.NOTIFIED_FILE.write_text("not valid json{{{")
        assert tc._load_notified() == {}

    def test_save_uses_atomic_rename(self, _isolated):
        tc._save_notified({"a": 1})
        assert tc.NOTIFIED_FILE.exists()
        assert not Path(str(tc.NOTIFIED_FILE) + ".tmp").exists()


class TestCollect:
    def test_no_kb_dir_does_nothing(self, monkeypatch):
        monkeypatch.delenv("RELAYGENT_KB_DIR", raising=False)
        assert _collect() == []

    def test_missing_tasks_file_does_nothing(self, _isolated):
        assert _collect() == []

    def test_oneoff_tasks_ignored(self, _isolated):
        assert _collect(_isolated, ["- [ ] Fix bug | type: one-off"]) == []

    def test_recurring_no_freq_ignored(self, _isolated):
        assert _collect(_isolated, ["- [ ] No freq | type: recurring"]) == []

    def test_overdue_never_last_triggers(self, _isolated):
        notifs = _collect(_isolated, [
            "- [ ] Check logs | type: recurring | freq: daily | last: never"
        ])
        assert len(notifs) == 1
        assert notifs[0]["description"] == "Check logs"
        assert notifs[0]["type"] == "task" and notifs[0]["freq"] == "daily"

    def test_overdue_old_last_triggers(self, _isolated):
        old = (datetime.now() - timedelta(days=3)).isoformat()
        notifs = _collect(_isolated, [
            f"- [ ] Backup | type: recurring | freq: daily | last: {old}"
        ])
        assert len(notifs) == 1 and notifs[0]["description"] == "Backup"

    def test_not_overdue_skipped(self, _isolated):
        recent = (datetime.now() - timedelta(hours=1)).isoformat()
        assert _collect(_isolated, [
            f"- [ ] Backup | type: recurring | freq: daily | last: {recent}"
        ]) == []

    def test_dedup_within_freq_period(self, _isolated):
        _write_tasks(_isolated, [
            "- [ ] Check logs | type: recurring | freq: daily | last: never"
        ])
        assert len(_collect()) == 1
        assert _collect() == []  # second call deduped

    def test_overdue_string_minutes(self, _isolated):
        t = (datetime.now() - timedelta(days=1, minutes=30)).isoformat()
        notifs = _collect(_isolated, [
            f"- [ ] Task | type: recurring | freq: daily | last: {t}"
        ])
        assert len(notifs) == 1 and "m overdue" in notifs[0]["overdue"]

    def test_overdue_string_hours(self, _isolated):
        t = (datetime.now() - timedelta(days=1, hours=5)).isoformat()
        notifs = _collect(_isolated, [
            f"- [ ] Task | type: recurring | freq: daily | last: {t}"
        ])
        assert len(notifs) == 1 and "h overdue" in notifs[0]["overdue"]

    def test_overdue_string_days(self, _isolated):
        t = (datetime.now() - timedelta(days=10)).isoformat()
        notifs = _collect(_isolated, [
            f"- [ ] Task | type: recurring | freq: daily | last: {t}"
        ])
        assert len(notifs) == 1 and "d overdue" in notifs[0]["overdue"]

    def test_multiple_tasks_multiple_notifs(self, _isolated):
        notifs = _collect(_isolated, [
            "- [ ] Task A | type: recurring | freq: daily | last: never",
            "- [ ] Task B | type: recurring | freq: 6h | last: never",
            "- [ ] Task C | type: one-off",
        ])
        descs = [n["description"] for n in notifs]
        assert "Task A" in descs and "Task B" in descs
        assert "Task C" not in descs

    def test_bad_last_date_skipped(self, _isolated):
        assert _collect(_isolated, [
            "- [ ] Task | type: recurring | freq: daily | last: not-a-date"
        ]) == []

    def test_saves_notified_file_on_update(self, _isolated):
        _collect(_isolated, [
            "- [ ] Check logs | type: recurring | freq: daily | last: never"
        ])
        assert tc.NOTIFIED_FILE.exists()
        assert "Check logs" in json.loads(tc.NOTIFIED_FILE.read_text())

    def test_empty_tasks_file(self, _isolated):
        assert _collect(_isolated, [""]) == []
