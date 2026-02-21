"""Tests for wake_cycle.py — covers retry loops, timeouts, and crash recovery."""

from unittest.mock import MagicMock, patch

from process import ClaudeResult
from session import SleepManager, SleepResult


def _cr(**kw):
    defaults = dict(exit_code=0, hung=False, timed_out=False,
                    no_output=False, incomplete=False, context_pct=0.0,
                    context_too_large=False, rate_limited=False)
    return ClaudeResult(**{**defaults, **kw})


def _timer(expired=False):
    t = MagicMock()
    t.is_expired.return_value = expired
    t.remaining.return_value = 3600
    return t


def _wake(msg="ping"):
    return SleepResult(woken=True, wake_message=msg)


class TestTimedOut:
    def test_monitor_timed_out_returns_none(self):
        """If monitor returns timed_out, wake cycle returns None."""
        from wake_cycle import run_wake_cycle
        mgr = SleepManager(_timer())
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.return_value = _cr(timed_out=True)
        with patch.object(mgr, "auto_sleep_and_wake", return_value=_wake()), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            result = run_wake_cycle(mgr, claude)
        assert result is None


class TestIncompleteRetryLoop:
    def test_incomplete_retries_then_succeeds(self):
        """Incomplete result retries and eventually succeeds."""
        from wake_cycle import run_wake_cycle
        mgr = SleepManager(_timer())
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.side_effect = [
            _cr(incomplete=True),   # first: incomplete
            _cr(context_pct=50.0),  # second: success
        ]
        with patch.object(mgr, "auto_sleep_and_wake", side_effect=[
                _wake(), SleepResult(woken=False)]), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            run_wake_cycle(mgr, claude)
        assert claude.monitor.call_count == 2

    def test_no_output_retries_then_succeeds(self):
        """no_output result retries and eventually succeeds."""
        from wake_cycle import run_wake_cycle
        mgr = SleepManager(_timer())
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.side_effect = [
            _cr(no_output=True),
            _cr(context_pct=50.0),
        ]
        with patch.object(mgr, "auto_sleep_and_wake", side_effect=[
                _wake(), SleepResult(woken=False)]), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            run_wake_cycle(mgr, claude)
        assert claude.monitor.call_count == 2

    def test_timer_expired_during_retry_returns_none(self):
        """If timer expires during incomplete retry loop, returns None."""
        from wake_cycle import run_wake_cycle
        timer = _timer()
        timer.is_expired.side_effect = [False, True]  # expires on retry check
        mgr = SleepManager(timer)
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.return_value = _cr(incomplete=True)
        with patch.object(mgr, "auto_sleep_and_wake", return_value=_wake()), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            result = run_wake_cycle(mgr, claude)
        assert result is None

    def test_exceeds_max_retries_breaks_loop(self):
        """After MAX_INCOMPLETE_RETRIES wake retries, gives up."""
        from wake_cycle import run_wake_cycle
        mgr = SleepManager(_timer())
        claude = MagicMock()
        claude.resume.return_value = 0
        # Always return incomplete — should hit the retry limit
        claude.monitor.return_value = _cr(incomplete=True)
        with patch.object(mgr, "auto_sleep_and_wake", side_effect=[
                _wake(), SleepResult(woken=False)]), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            run_wake_cycle(mgr, claude)
        # Should have retried MAX_INCOMPLETE_RETRIES times + the initial call
        from config import MAX_INCOMPLETE_RETRIES
        assert claude.monitor.call_count == MAX_INCOMPLETE_RETRIES + 1

    def test_timed_out_during_retry_returns_none(self):
        """If monitor returns timed_out during retry, returns None."""
        from wake_cycle import run_wake_cycle
        mgr = SleepManager(_timer())
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.side_effect = [
            _cr(incomplete=True),
            _cr(timed_out=True),
        ]
        with patch.object(mgr, "auto_sleep_and_wake", return_value=_wake()), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            result = run_wake_cycle(mgr, claude)
        assert result is None


class TestContextTooLarge:
    def test_returns_result_for_fresh_session(self):
        """context_too_large returns the result so caller can spawn fresh."""
        from wake_cycle import run_wake_cycle
        mgr = SleepManager(_timer())
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.return_value = _cr(context_too_large=True)
        with patch.object(mgr, "auto_sleep_and_wake", return_value=_wake()), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            result = run_wake_cycle(mgr, claude)
        assert result is not None
        assert result.context_too_large


class TestCrashDuringWake:
    def test_crash_resumes_with_crash_message(self):
        """Non-zero exit code during wake triggers a resume with crash message."""
        from wake_cycle import run_wake_cycle
        mgr = SleepManager(_timer())
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.side_effect = [
            _cr(exit_code=1),       # crash
            _cr(context_pct=50.0),  # recovery
        ]
        with patch.object(mgr, "auto_sleep_and_wake", side_effect=[
                _wake(), SleepResult(woken=False)]), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            run_wake_cycle(mgr, claude)
        # Should have resumed twice: initial + crash recovery
        assert claude.resume.call_count == 2
        crash_msg = claude.resume.call_args_list[1][0][0]
        assert "crashed" in crash_msg.lower()

    def test_oserror_during_wake_retry_breaks(self):
        """OSError during wake incomplete retry breaks the retry loop."""
        from wake_cycle import run_wake_cycle
        mgr = SleepManager(_timer())
        claude = MagicMock()
        claude.resume.side_effect = [0, OSError("disk full")]
        claude.monitor.return_value = _cr(incomplete=True)
        with patch.object(mgr, "auto_sleep_and_wake", side_effect=[
                _wake(), SleepResult(woken=False)]), \
             patch("wake_cycle.log"), patch("wake_cycle.time.sleep"):
            run_wake_cycle(mgr, claude)
        assert claude.resume.call_count == 2
