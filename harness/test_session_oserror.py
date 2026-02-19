"""Tests for OSError retry cap in run_wake_cycle."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent))

from session import SleepManager, SleepResult
from process import ClaudeResult


def _cr(**kw):
    defaults = dict(exit_code=0, hung=False, timed_out=False,
                    no_output=False, incomplete=False, context_pct=0.0)
    return ClaudeResult(**{**defaults, **kw})


def _timer(expired=False):
    t = MagicMock()
    t.is_expired.return_value = expired
    t.remaining.return_value = 3600
    return t


class TestRunWakeCycleOSError:
    def test_retries_oserror_via_sleep_wake_again(self):
        """OSError on resume causes re-sleep; if woken again, resumes successfully."""
        timer = _timer()
        mgr = SleepManager(timer)
        claude = MagicMock()
        # First resume raises, second succeeds
        claude.resume.side_effect = [OSError("disk full"), 0]
        claude.monitor.return_value = _cr()
        # Wake twice: first triggers the OSError, second allows successful resume
        wake_results = [
            SleepResult(woken=True, wake_message="ping"),   # first wake → OSError
            SleepResult(woken=True, wake_message="ping"),   # retry wake → success
            SleepResult(woken=False),                       # done
        ]
        with patch.object(mgr, "auto_sleep_and_wake", side_effect=wake_results), \
             patch("session.log"), patch("session.time.sleep"):
            mgr.run_wake_cycle(claude)
        assert claude.resume.call_count == 2

    def test_gives_up_after_max_oserror_retries(self):
        """After MAX_INCOMPLETE_RETRIES+1 OSErrors, run_wake_cycle returns None."""
        timer = _timer()
        mgr = SleepManager(timer)
        claude = MagicMock()
        claude.resume.side_effect = OSError("persistent error")
        # Always wake so the loop keeps trying
        always_wake = SleepResult(woken=True, wake_message="ping")
        with patch.object(mgr, "auto_sleep_and_wake", return_value=always_wake), \
             patch("session.log"), patch("session.time.sleep"):
            result = mgr.run_wake_cycle(claude)
        assert result is None

    def test_not_woken_returns_none(self):
        """If auto_sleep_and_wake returns not-woken, returns None immediately."""
        timer = _timer()
        mgr = SleepManager(timer)
        claude = MagicMock()
        with patch.object(mgr, "auto_sleep_and_wake",
                          return_value=SleepResult(woken=False)), \
             patch("session.log"), patch("session.time.sleep"):
            result = mgr.run_wake_cycle(claude)
        assert result is None
        claude.resume.assert_not_called()
