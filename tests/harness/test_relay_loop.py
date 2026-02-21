"""Tests for relay_loop.py — pure decision logic, no mocking needed."""
from __future__ import annotations

import sys
import uuid
from pathlib import Path

import pytest

from config import INCOMPLETE_BASE_DELAY, MAX_INCOMPLETE_RETRIES, MAX_RETRIES
from process import ClaudeResult
from relay_loop import Action, ErrorResult, LoopState, handle_error


def _result(**kwargs) -> ClaudeResult:
    defaults = dict(exit_code=0, hung=False, timed_out=False,
                    no_output=False, incomplete=False, context_too_large=False,
                    rate_limited=False, context_pct=0.0)
    return ClaudeResult(**{**defaults, **kwargs})


class TestLoopState:
    def test_new_session_generates_uuid(self):
        state = LoopState(session_id="old")
        state.new_session()
        assert state.session_id != "old"
        uuid.UUID(state.session_id)  # validates format

    def test_new_session_resets_established(self):
        state = LoopState(session_id="x", session_established=True, resume_reason="test")
        state.new_session()
        assert not state.session_established
        assert state.resume_reason == ""

    def test_reset_counters(self):
        state = LoopState(session_id="x", crash_count=3, incomplete_count=2, no_output_count=1)
        state.reset_counters()
        assert state.crash_count == 0
        assert state.incomplete_count == 0
        assert state.no_output_count == 0

    def test_reset_counters_preserves_idle(self):
        state = LoopState(session_id="x", idle_continuation_count=5)
        state.reset_counters()
        assert state.idle_continuation_count == 5


class TestHandleErrorCleanExit:
    def test_returns_none_on_clean_exit(self):
        state = LoopState(session_id="x")
        assert handle_error(_result(exit_code=0), state) is None

    def test_state_unchanged_on_clean_exit(self):
        state = LoopState(session_id="x", session_established=True)
        handle_error(_result(exit_code=0), state)
        assert state.session_established is True
        assert state.session_id == "x"


class TestHandleErrorHung:
    def test_hung_returns_continue(self):
        state = LoopState(session_id="x")
        err = handle_error(_result(hung=True), state)
        assert err.action == Action.CONTINUE
        assert err.delay == 15
        assert err.status == "crashed"

    def test_hung_sets_resume_state(self):
        state = LoopState(session_id="x", session_established=False)
        handle_error(_result(hung=True), state)
        assert state.session_established is True
        assert "API error" in state.resume_reason


class TestHandleErrorRateLimited:
    def test_rate_limited_returns_continue(self):
        state = LoopState(session_id="x")
        err = handle_error(_result(rate_limited=True), state)
        assert err.action == Action.CONTINUE
        assert err.delay == 60
        assert err.status == "rate_limited"

    def test_rate_limited_no_state_mutation(self):
        state = LoopState(session_id="x", crash_count=1)
        handle_error(_result(rate_limited=True), state)
        assert state.crash_count == 1  # unchanged


class TestHandleErrorNoOutput:
    def test_first_no_output_on_fresh(self):
        state = LoopState(session_id="x", session_established=False)
        err = handle_error(_result(no_output=True), state)
        assert err.action == Action.CONTINUE
        assert err.delay == INCOMPLETE_BASE_DELAY
        assert state.session_established is True
        assert "output" in state.resume_reason.lower()

    def test_no_output_on_resume_starts_fresh(self):
        state = LoopState(session_id="old", session_established=True)
        err = handle_error(_result(no_output=True), state)
        assert err.action == Action.CONTINUE
        assert state.session_id != "old"
        assert state.session_established is False

    def test_no_output_gives_up_after_max(self):
        state = LoopState(session_id="x", no_output_count=MAX_INCOMPLETE_RETRIES)
        err = handle_error(_result(no_output=True), state)
        assert err.action == Action.BREAK
        assert err.should_notify is True

    def test_no_output_exponential_backoff(self):
        state = LoopState(session_id="x", no_output_count=2)
        err = handle_error(_result(no_output=True), state)
        expected_delay = min(INCOMPLETE_BASE_DELAY * (2 ** 2), 60)
        assert err.delay == expected_delay


class TestHandleErrorContextTooLarge:
    def test_context_too_large_starts_fresh(self):
        state = LoopState(session_id="old", session_established=True, incomplete_count=3)
        err = handle_error(_result(context_too_large=True), state)
        assert err.action == Action.CONTINUE
        assert state.session_id != "old"
        assert state.session_established is False
        assert state.incomplete_count == 0

    def test_context_too_large_delay(self):
        state = LoopState(session_id="x")
        err = handle_error(_result(context_too_large=True), state)
        assert err.delay == 5


class TestHandleErrorIncomplete:
    def test_first_incomplete_resumes(self):
        state = LoopState(session_id="x")
        err = handle_error(_result(incomplete=True), state)
        assert err.action == Action.CONTINUE
        assert state.session_established is True
        assert state.resume_reason == "Continue where you left off."
        assert state.incomplete_count == 1

    def test_incomplete_exceeds_max_starts_fresh(self):
        state = LoopState(session_id="old", incomplete_count=MAX_INCOMPLETE_RETRIES)
        err = handle_error(_result(incomplete=True), state)
        assert err.action == Action.CONTINUE
        assert state.session_id != "old"
        assert state.session_established is False
        assert state.incomplete_count == 0

    def test_incomplete_exponential_backoff(self):
        state = LoopState(session_id="x", incomplete_count=1)
        err = handle_error(_result(incomplete=True), state)
        expected = min(INCOMPLETE_BASE_DELAY * (2 ** 1), 60)
        assert err.delay == expected


class TestHandleErrorCrash:
    def test_first_crash_retries(self):
        state = LoopState(session_id="old")
        err = handle_error(_result(exit_code=1), state)
        assert err.action == Action.CONTINUE
        assert err.delay == 15
        assert err.status == "crashed"
        assert state.crash_count == 1
        assert state.session_id != "old"

    def test_crash_gives_up_after_max(self):
        state = LoopState(session_id="x", crash_count=MAX_RETRIES)
        err = handle_error(_result(exit_code=1), state)
        assert err.action == Action.BREAK
        assert err.should_notify is True
        assert err.notify_args == (MAX_RETRIES + 1, 1)

    def test_crash_does_not_give_up_at_max(self):
        """At exactly MAX_RETRIES, should still retry (gives up at > MAX_RETRIES)."""
        state = LoopState(session_id="x", crash_count=MAX_RETRIES - 1)
        err = handle_error(_result(exit_code=1), state)
        assert err.action == Action.CONTINUE


class TestErrorResultDefaults:
    def test_defaults_are_safe(self):
        err = ErrorResult(Action.CONTINUE)
        assert err.delay == 0
        assert err.status is None
        assert err.log_msg == ""
        assert err.should_notify is False
        assert err.notify_args == ()
