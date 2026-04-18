"""Tests for retire_requested() — marker-file based retire signal."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from jsonl_checks import retire_requested, clear_retire_marker


@pytest.fixture
def marker_at(tmp_path):
    """Patch RETIRE_MARKER to a per-test path so tests don't race real /tmp."""
    path = tmp_path / "retire-marker.json"
    with patch("jsonl_checks.RETIRE_MARKER", path):
        yield path


class TestRetireRequested:
    def test_false_when_marker_missing(self, marker_at):
        assert not marker_at.exists()
        assert retire_requested() is False

    def test_true_when_marker_present(self, marker_at):
        marker_at.write_text('{"ts": 1}')
        assert retire_requested() is True

    def test_survives_trailing_text_or_tool_calls(self, marker_at):
        """The whole point of the marker-file approach: retire intent persists
        regardless of what Claude says/does after calling retire."""
        marker_at.write_text('{"ts": 1}')
        # Simulate many subsequent assistant messages — marker is file-based,
        # so JSONL content is irrelevant. Still True.
        assert retire_requested() is True
        assert retire_requested("any-session-id", Path("/nonexistent/ws")) is True


class TestClearRetireMarker:
    def test_removes_file(self, marker_at):
        marker_at.write_text('{"ts": 1}')
        clear_retire_marker()
        assert not marker_at.exists()

    def test_noop_when_file_missing(self, marker_at):
        # Should not raise
        clear_retire_marker()
        clear_retire_marker()
        assert not marker_at.exists()
