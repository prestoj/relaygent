"""Tests for context_too_large handling in RelayRunner."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from process import ClaudeResult
from relay import RelayRunner


def _result(**kwargs) -> ClaudeResult:
    defaults = dict(exit_code=0, hung=False, timed_out=False,
                    no_output=False, incomplete=False, context_pct=0.0,
                    context_too_large=False)
    return ClaudeResult(**{**defaults, **kwargs})


@pytest.fixture
def runner(tmp_path):
    with (
        patch("relay.acquire_lock", return_value=3),
        patch("relay.startup_init"),
        patch("relay.commit_kb"),
        patch("relay.cleanup_context_file"),
        patch("relay.notify_crash"),
        patch("relay.rotate_log"),
        patch("relay.get_workspace_dir", return_value=tmp_path),
        patch("relay.cleanup_old_workspaces"),
        patch("relay.set_status"),
        patch("relay.should_sleep", return_value=True),
        patch("relay.time.sleep"),
    ):
        r = RelayRunner()
        r.timer = MagicMock()
        r.timer.start_time = 0
        r.timer.remaining.return_value = 3600
        r.timer.has_successor_time.return_value = False
        r.timer.is_expired.return_value = False
        r.sleep_mgr = MagicMock()
        r.sleep_mgr.run_wake_cycle.return_value = None
        yield r, tmp_path


def _run_with_results(runner, results):
    r, _ = runner
    result_iter = iter(results)

    def next_result(*_):
        try:
            return next(result_iter)
        except StopIteration:
            r.timer.is_expired.return_value = True
            return _result()

    with (
        patch("relay.ClaudeProcess") as MockCP,
        patch("relay.uuid.uuid4", return_value="test-uuid"),
    ):
        mock_claude = MagicMock()
        MockCP.return_value = mock_claude
        mock_claude.start_fresh.return_value = 0
        mock_claude.resume.return_value = 0
        mock_claude.monitor.side_effect = next_result
        r.claude = mock_claude
        return r.run()


class TestContextTooLarge:
    def test_context_too_large_starts_fresh_not_resume(self, runner):
        """context_too_large should start a fresh session, not resume."""
        r, _ = runner
        results = [
            _result(context_too_large=True),
            _result(exit_code=0),
        ]
        _run_with_results(runner, results)
        # First call should be start_fresh, second after context_too_large also start_fresh
        assert r.claude.start_fresh.call_count == 2
        assert r.claude.resume.call_count == 0

    def test_context_too_large_resets_incomplete_count(self, runner):
        """context_too_large should reset incomplete_count to prevent premature fresh-start."""
        r, _ = runner
        results = [
            _result(incomplete=True),
            _result(incomplete=True),
            _result(context_too_large=True),
            _result(exit_code=0),
        ]
        # Should not give up due to incomplete count (context_too_large resets it)
        exit_code = _run_with_results(runner, results)
        assert exit_code == 0

    def test_context_too_large_does_not_resume(self, runner):
        """After context_too_large, next loop iteration must call start_fresh."""
        r, _ = runner
        results = [_result(context_too_large=True)]
        _run_with_results(runner, results)
        r.claude.resume.assert_not_called()
