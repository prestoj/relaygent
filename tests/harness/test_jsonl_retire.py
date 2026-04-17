"""Tests for retire_requested() in jsonl_checks."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from jsonl_checks import retire_requested


@pytest.fixture
def tmp_jsonl(tmp_path):
    session_id = "test-session-retire"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    slug = str(workspace).replace("/", "-")
    project_dir = tmp_path / ".claude" / "projects" / slug
    project_dir.mkdir(parents=True)
    jsonl_path = project_dir / f"{session_id}.jsonl"

    def write_entries(entries):
        jsonl_path.write_text("\n".join(json.dumps(e) for e in entries) + "\n")

    with patch("jsonl_checks.Path.home", return_value=tmp_path):
        yield session_id, workspace, write_entries


class TestRetireRequested:
    def test_false_if_no_jsonl(self, tmp_path):
        with patch("jsonl_checks.Path.home", return_value=tmp_path):
            assert retire_requested("no-such-session", tmp_path / "ws") is False

    def test_true_on_retire_tool_call(self, tmp_jsonl):
        sid, ws, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "name": "mcp__relaygent-notifications__retire", "input": {}}
            ]}},
        ])
        assert retire_requested(sid, ws) is True

    def test_true_on_bare_retire_name(self, tmp_jsonl):
        sid, ws, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "name": "retire", "input": {}}
            ]}},
        ])
        assert retire_requested(sid, ws) is True

    def test_false_on_sleep_tool_call(self, tmp_jsonl):
        sid, ws, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "name": "mcp__relaygent-notifications__sleep", "input": {}}
            ]}},
        ])
        assert retire_requested(sid, ws) is False

    def test_false_when_last_assistant_is_text_only(self, tmp_jsonl):
        sid, ws, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {"content": [
                {"type": "text", "text": "Goodnight."}
            ]}},
        ])
        assert retire_requested(sid, ws) is False

    def test_only_looks_at_most_recent_assistant_message(self, tmp_jsonl):
        """Old retire calls in earlier turns should not trigger."""
        sid, ws, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "name": "retire", "input": {}}
            ]}},
            {"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "tu_1"}
            ]}},
            {"type": "assistant", "message": {"content": [
                {"type": "text", "text": "Something else."}
            ]}},
        ])
        assert retire_requested(sid, ws) is False
