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

    def test_sticky_reemits_within_window_stable_timestamp(self, _isolated):
        """Within the sticky window the firing re-emits on each poll (keeps the
        poller cache populated, mirroring _cron_task); the stable `timestamp`
        is what the wake loop + history logger dedup on, so the user isn't
        spammed. (Previously freq emitted once then deduped, so a single-poll
        firing could be missed entirely.)"""
        _write_tasks(_isolated, [
            "- [ ] Check logs | type: recurring | freq: daily | last: never"
        ])
        n1 = _collect()
        n2 = _collect()
        assert len(n1) == 1 and len(n2) == 1
        assert n1[0]["timestamp"] == n2[0]["timestamp"]  # same firing

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


def _freq(now, notified, last="never", freq="daily", desc="T"):
    from unittest.mock import patch
    t = {"description": desc, "type": "recurring", "freq": freq,
         "cron": "", "last": last}
    with patch.object(tc, "_rewrite_last") as rw:
        result = tc._freq_task(t, "/tmp/ignored.md", notified, now,
                               now.timestamp() * 1000)
    return result, rw


class TestFreqStickyWindow:
    """Regression: a freq task emitted for a single poll then advanced `last:`,
    so a firing could be missed. They now mirror _cron_task's sticky window."""

    def test_first_run_emits_and_sets_sticky(self):
        now = datetime(2026, 5, 29, 9, 0, 0)
        notified = {}
        (fire_dt, emit), rw = _freq(now, notified)
        assert emit is True and fire_dt == now
        assert isinstance(notified["T"], dict)
        assert notified["T"]["fired_at"] == "2026-05-29 09:00"
        rw.assert_not_called()  # last: not advanced during the window

    def test_reemits_within_window_with_pinned_firing(self):
        now = datetime(2026, 5, 29, 9, 0, 0)
        notified = {}
        _freq(now, notified)
        later = now + timedelta(seconds=60)  # still inside the 300s window
        (fire_dt, emit), rw = _freq(later, notified, last="never")
        assert emit is True and fire_dt == now  # pinned, not `later`
        rw.assert_not_called()

    def test_advances_and_stops_after_window(self):
        now = datetime(2026, 5, 29, 9, 0, 0)
        notified = {}
        _freq(now, notified)
        after = now + timedelta(seconds=tc.STICKY_SECONDS + 1)
        (fire_dt, emit), rw = _freq(after, notified, last="never")
        assert emit is False and fire_dt is None
        rw.assert_called_once()       # last: advanced once
        assert "T" not in notified    # sticky cleared

    def test_not_due_does_not_emit(self):
        now = datetime(2026, 5, 29, 9, 0, 0)
        last = (now - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M")
        (fire_dt, emit), _ = _freq(now, {}, last=last, freq="daily")
        assert emit is False and fire_dt is None

    def test_due_after_interval_emits(self):
        now = datetime(2026, 5, 29, 9, 0, 0)
        last = (now - timedelta(days=2)).strftime("%Y-%m-%d %H:%M")
        (fire_dt, emit), _ = _freq(now, {}, last=last, freq="daily")
        assert emit is True

    def test_legacy_int_sticky_tolerated(self):
        """Older NOTIFIED_FILE entries stored an int; must not crash."""
        now = datetime(2026, 5, 29, 9, 0, 0)
        notified = {"T": 1716900000000}
        (fire_dt, emit), _ = _freq(now, notified, last="never")
        assert emit is True and isinstance(notified["T"], dict)
