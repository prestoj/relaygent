"""Tests for idle continuation limit in RelayRunner.

The `last_output_is_idle` path resumes Claude with "keep doing useful work"
when it exits with short output. Without a limit, this can loop forever if
Claude keeps giving brief responses. MAX_IDLE_CONTINUATIONS (3) caps this.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch


from config import MAX_IDLE_CONTINUATIONS
from process import ClaudeResult
from relay import RelayRunner


def _result(**kwargs) -> ClaudeResult:
    defaults = dict(exit_code=0, hung=False, timed_out=False,
                    no_output=False, incomplete=False, context_pct=0.0,
                    context_too_large=False)
    return ClaudeResult(**{**defaults, **kwargs})


def _make_runner(tmp_path, idle_side_effect):
    """Build a RelayRunner with last_output_is_idle controlled by a list."""
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
        patch("relay.last_output_is_idle", side_effect=idle_side_effect),
        patch("relay.run_wake_cycle", return_value=None) as wake_mock,
    ):
        r = RelayRunner()
        r.timer = MagicMock()
        r.timer.start_time = 0
        r.timer.remaining.return_value = 3600
        r.timer.has_successor_time.return_value = False
        r.timer.is_expired.return_value = False
        r.sleep_mgr = MagicMock()
        r._wake_cycle_mock = wake_mock
        yield r


def _run(r, results):
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
        return r.run(), mock_claude


class TestIdleContinuationLimit:
    def test_idle_within_limit_resumes_not_sleeps(self, tmp_path):
        """Up to MAX_IDLE_CONTINUATIONS idle exits → resume, not sleep cycle."""
        # All MAX_IDLE_CONTINUATIONS idle, then non-idle to break loop
        idle_seq = [True] * MAX_IDLE_CONTINUATIONS + [False]
        gen = _make_runner(tmp_path, idle_seq)
        r = next(gen)
        results = [_result()] * (MAX_IDLE_CONTINUATIONS + 1)
        _, mock_claude = _run(r, results)
        # Should have resumed MAX_IDLE_CONTINUATIONS times (not gone to sleep)
        assert mock_claude.resume.call_count >= MAX_IDLE_CONTINUATIONS
        r._wake_cycle_mock.assert_called_once()  # only on the non-idle

    def test_idle_exceeds_limit_goes_to_sleep(self, tmp_path):
        """More than MAX_IDLE_CONTINUATIONS consecutive idle exits → sleep cycle."""
        # All idle — should hit limit and go to sleep cycle
        idle_seq = [True] * (MAX_IDLE_CONTINUATIONS + 1)
        gen = _make_runner(tmp_path, idle_seq)
        r = next(gen)
        results = [_result()] * (MAX_IDLE_CONTINUATIONS + 2)
        _, mock_claude = _run(r, results)
        # Sleep cycle must have been called after limit exceeded
        r._wake_cycle_mock.assert_called()

    def test_idle_count_resets_after_non_idle(self, tmp_path):
        """Non-idle output resets idle counter — can go through MAX_IDLE_CONTINUATIONS again."""
        # idle x MAX, non-idle (sleep), then idle x MAX again (should resume all, not sleep early)
        idle_seq = ([True] * MAX_IDLE_CONTINUATIONS   # first batch → resume each time
                    + [False]                          # non-idle → sleep cycle
                    + [True] * MAX_IDLE_CONTINUATIONS  # second batch → resume again
                    + [False])                         # final non-idle → sleep
        gen = _make_runner(tmp_path, idle_seq)
        r = next(gen)
        # Provide enough results; sleep_mgr returns None so loop breaks after first sleep
        results = [_result()] * (MAX_IDLE_CONTINUATIONS * 2 + 4)
        _, mock_claude = _run(r, results)
        # At least MAX_IDLE_CONTINUATIONS resumes happened
        assert mock_claude.resume.call_count >= MAX_IDLE_CONTINUATIONS

    def test_idle_resume_message_contains_handoff_hint(self, tmp_path):
        """Resume message on idle path mentions handoff so Claude knows what to do."""
        idle_seq = [True, False]
        gen = _make_runner(tmp_path, idle_seq)
        r = next(gen)
        results = [_result(), _result()]
        _, mock_claude = _run(r, results)
        msgs = [c.args[0] for c in mock_claude.resume.call_args_list]
        assert any("handoff" in m.lower() or "useful work" in m.lower() for m in msgs)
