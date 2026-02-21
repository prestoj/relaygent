"""Tests for sleep/wake handling (session.py)."""
from __future__ import annotations
import json, os, sys, time
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest

from session import SleepManager, SleepResult, MAX_CACHE_STALE, _is_sleep_timeout_reminder

@pytest.fixture
def timer():
    t = MagicMock()
    t.is_expired.return_value = False
    return t

@pytest.fixture
def mgr(timer):
    return SleepManager(timer)

@pytest.fixture
def cache_file(tmp_path, monkeypatch):
    cache = tmp_path / "cache.json"
    monkeypatch.setattr("session.NOTIFICATIONS_CACHE", str(cache))
    return cache


def msg_notif(ts="t1", content="hi"):
    return [{"type": "message", "messages": [{"timestamp": ts, "content": content}]}]


class TestExtractTimestamps:
    def test_chat_message_timestamps(self, mgr):
        assert mgr._extract_timestamps({"messages": [{"timestamp": "t1"}, {"timestamp": "t2"}]}) == {"t1", "t2"}

    def test_reminder_id(self, mgr):
        assert "reminder-42" in mgr._extract_timestamps({"type": "reminder", "id": 42})

    def test_slack_channel_dedup(self, mgr):
        assert "slack-C123-3" in mgr._extract_timestamps({"source": "slack", "channels": [{"id": "C123", "unread": 3}]})

    def test_slack_unread_count_change(self, mgr):
        mk = lambda n: {"source": "slack", "channels": [{"id": "C1", "unread": n}]}
        assert mgr._extract_timestamps(mk(2)) != mgr._extract_timestamps(mk(3))

    def test_fallback_for_no_keys(self, mgr):
        assert mgr._extract_timestamps({"type": "unknown", "source": "test", "count": 1}) == {"unknown-test-1"}

    def test_empty_notif_with_type(self, mgr):
        assert len(mgr._extract_timestamps({"type": "system"})) == 1


class TestCheckNotifications:
    def test_returns_new_notifications(self, mgr, cache_file):
        cache_file.write_text(json.dumps(msg_notif()))
        result = mgr._check_notifications()
        assert len(result) == 1 and result[0]["type"] == "message"

    def test_dedup_same_notification(self, mgr, cache_file):
        cache_file.write_text(json.dumps(msg_notif()))
        assert len(mgr._check_notifications()) == 1
        assert len(mgr._check_notifications()) == 0

    def test_new_message_after_dedup(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps(msg_notif("t1", "first")))
        mgr._check_notifications()
        cache_file.write_text(json.dumps(msg_notif("t2", "second")))
        assert len(mgr._check_notifications()) == 1

    def test_missing_cache_file(self, mgr, cache_file):
        assert mgr._check_notifications() == []

    def test_malformed_json(self, mgr, cache_file):
        cache_file.write_text("NOT JSON")
        assert mgr._check_notifications() == []


class TestSlackDedupPersistence:
    def test_slack_keys_persist_across_sleep(self, timer, cache_file):
        """Slack dedup keys must NOT be cleared on sleep — prevents phantom wake loop."""
        mgr = SleepManager(timer)
        notif = [{"source": "slack", "channels": [{"id": "C1", "unread": 1}]}]
        cache_file.write_text(json.dumps(notif))
        with patch("session.set_status"), patch("session.log"):
            mgr._wait_for_wake()
        cache_file.write_text(json.dumps(notif))
        assert len(mgr._check_notifications()) == 0


class TestWaitForWake:
    def test_wakes_on_notification(self, timer, cache_file):
        cache_file.write_text(json.dumps(msg_notif()))
        with patch("session.set_status"), patch("session.log"):
            woken, notifs = SleepManager(timer)._wait_for_wake()
        assert woken and len(notifs) == 1

    def test_returns_false_on_timer_expiry(self, timer, cache_file):
        timer.is_expired.return_value = True
        cache_file.write_text("[]")
        with patch("session.set_status"), patch("session.log"), patch("session.time.sleep"):
            woken, notifs = SleepManager(timer)._wait_for_wake()
        assert not woken and notifs == []

    def test_force_wake_on_stale_cache(self, timer, cache_file):
        cache_file.write_text("[]")
        os.utime(str(cache_file), (0, time.time() - MAX_CACHE_STALE - 10))
        with patch("session.set_status"), patch("session.log"):
            woken, notifs = SleepManager(timer)._wait_for_wake()
        assert woken and notifs[0]["type"] == "system"

    def test_force_wake_on_missing_cache(self, timer, cache_file, monkeypatch):
        monkeypatch.setattr("session.NOTIFICATIONS_CACHE", str(cache_file) + ".gone")
        mgr = SleepManager(timer)
        mgr._cache_missing_since = time.time() - MAX_CACHE_STALE - 1
        with patch("session.set_status"), patch("session.log"), patch("session.time.sleep"):
            woken, notifs = mgr._wait_for_wake()
        assert woken and notifs[0]["type"] == "system"

    def test_sleep_timeout_reminder_does_not_wake(self, timer, cache_file):
        """Sleep-timeout reminders are silently skipped; real notifications still wake."""
        responses = iter([[{"type": "reminder", "id": 99, "message": "Sleep timeout (30 min)"}],
                          [{"type": "message", "messages": [{"timestamp": "t2", "content": "hi"}]}]])
        def fake_check(self):
            r = next(responses)
            if r[0]["type"] == "reminder": self._seen_timestamps.add("reminder-99")
            return r
        cache_file.write_text("[]")
        with patch.object(SleepManager, "_check_notifications", fake_check), \
             patch("session.set_status"), patch("session.log"), patch("session.time.sleep"):
            woken, notifs = SleepManager(timer)._wait_for_wake()
        assert woken and notifs[0]["type"] == "message"


class TestIsSleepTimeoutReminder:
    def test_matches(self):
        assert _is_sleep_timeout_reminder({"type": "reminder", "message": "Sleep timeout (30 min)"})
        assert _is_sleep_timeout_reminder({"type": "reminder", "message": "Sleep timeout (5 min)"})
        assert not _is_sleep_timeout_reminder({"type": "reminder", "message": "Check server logs"})
        assert not _is_sleep_timeout_reminder({"type": "message", "message": "Sleep timeout (30 min)"})


class TestAutoSleepAndWake:
    def test_returns_not_woken_if_expired(self, timer):
        timer.is_expired.return_value = True
        assert SleepManager(timer).auto_sleep_and_wake().woken is False

    def test_returns_wake_message(self, timer, cache_file):
        cache_file.write_text(json.dumps(msg_notif("t1", "hello")))
        with patch("session.set_status"), patch("session.log"):
            result = SleepManager(timer).auto_sleep_and_wake()
        assert result.woken and "hello" in result.wake_message

    def test_acks_slack_on_slack_notification(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps([{"source": "slack", "channels": [{"id": "C1", "unread": 1}]}]))
        with patch("session.set_status"), patch("session.log"), \
             patch.object(mgr, "_ack_notification") as ack:
            mgr.auto_sleep_and_wake()
        ack.assert_called_once_with("ack-slack")

    def test_no_ack_for_non_slack(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps(msg_notif()))
        with patch("session.set_status"), patch("session.log"), \
             patch.object(mgr, "_ack_notification") as ack:
            mgr.auto_sleep_and_wake()
        ack.assert_not_called()


def _cr(**kw):
    from process import ClaudeResult
    return ClaudeResult(**{"exit_code": 0, "hung": False, "timed_out": False,
                           "no_output": False, "incomplete": False, "context_pct": 0.0, **kw})


class TestRunWakeCycle:
    def test_returns_none_when_not_woken(self, timer):
        from wake_cycle import run_wake_cycle
        mgr = SleepManager(timer)
        with patch.object(mgr, "auto_sleep_and_wake", return_value=SleepResult(woken=False)), \
             patch("wake_cycle.log"):
            assert run_wake_cycle(mgr, MagicMock()) is None

    def test_returns_claude_result_on_context_fill(self, timer):
        from wake_cycle import run_wake_cycle
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.return_value = _cr(context_pct=90.0)
        mgr = SleepManager(timer)
        with patch.object(mgr, "auto_sleep_and_wake", return_value=SleepResult(woken=True, wake_message="ping")), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            result = run_wake_cycle(mgr, claude)
        assert result is not None and result.context_pct == 90.0

    def test_retries_hung_wake_then_succeeds(self, timer):
        from wake_cycle import run_wake_cycle
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.side_effect = [_cr(hung=True), _cr(exit_code=0)]
        mgr = SleepManager(timer)
        with patch.object(mgr, "auto_sleep_and_wake", side_effect=[
                SleepResult(woken=True, wake_message="ping"), SleepResult(woken=False)]), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            run_wake_cycle(mgr, claude)
        assert claude.monitor.call_count == 2
