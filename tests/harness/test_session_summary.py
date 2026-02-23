"""Tests for session summary generation."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from session_summary import SUMMARY_FILE, generate_summary, save_summary


def _assistant_entry(tools=None, input_tokens=1000, output_tokens=500):
    """Build a fake assistant JSONL entry."""
    content = []
    for name, inp in (tools or []):
        content.append({"type": "tool_use", "name": name, "input": inp})
    content.append({"type": "text", "text": "Some output"})
    return {
        "type": "assistant",
        "message": {
            "content": content,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            },
        },
    }


@pytest.fixture
def tmp_jsonl(tmp_path):
    """Create a fake JSONL session in expected location."""
    session_id = "test-summary-session"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    slug = str(workspace).replace("/", "-")
    project_dir = tmp_path / ".claude" / "projects" / slug
    project_dir.mkdir(parents=True)
    jsonl_path = project_dir / f"{session_id}.jsonl"

    def write_entries(entries):
        jsonl_path.write_text(
            "\n".join(json.dumps(e) for e in entries) + "\n"
        )

    with patch("jsonl_checks.Path.home", return_value=tmp_path):
        yield session_id, workspace, jsonl_path, write_entries


class TestGenerateSummary:
    def test_basic_summary(self, tmp_jsonl):
        sid, ws, _, write = tmp_jsonl
        write([
            _assistant_entry([("Read", {"file_path": "/foo.py"})]),
            _assistant_entry([
                ("Edit", {"file_path": "/foo.py", "old_string": "a", "new_string": "b"}),
                ("Bash", {"command": "echo hi"}),
            ]),
            _assistant_entry([("Read", {"file_path": "/bar.js"})], 5000, 2000),
        ])
        result = generate_summary(sid, ws)
        assert result is not None
        assert result["turns"] == 3
        assert result["tools"]["Read"] == 2
        assert result["tools"]["Edit"] == 1
        assert result["tools"]["Bash"] == 1
        assert "/foo.py" in result["files_modified"]
        assert "/bar.js" in result["files_modified"]
        assert result["context_pct"] > 0
        assert result["session_id"] == sid

    def test_no_jsonl_returns_none(self, tmp_jsonl):
        sid, ws, _, _ = tmp_jsonl
        assert generate_summary("nonexistent", ws) is None

    def test_empty_jsonl(self, tmp_jsonl):
        sid, ws, jsonl_path, _ = tmp_jsonl
        jsonl_path.write_text("")
        assert generate_summary(sid, ws) is None

    def test_no_assistant_entries(self, tmp_jsonl):
        sid, ws, _, write = tmp_jsonl
        write([{"type": "user", "message": {"content": "hello"}}])
        assert generate_summary(sid, ws) is None

    def test_write_tool_tracked(self, tmp_jsonl):
        sid, ws, _, write = tmp_jsonl
        write([
            _assistant_entry([("Write", {"file_path": "/new.py", "content": "x"})]),
        ])
        result = generate_summary(sid, ws)
        assert "/new.py" in result["files_modified"]
        assert result["tools"]["Write"] == 1

    def test_top_10_tools(self, tmp_jsonl):
        sid, ws, _, write = tmp_jsonl
        tools = [(f"Tool{i}", {}) for i in range(15)]
        write([_assistant_entry(tools)])
        result = generate_summary(sid, ws)
        assert len(result["tools"]) <= 10


class TestGitTracking:
    def test_counts_git_commits(self, tmp_jsonl):
        sid, ws, _, write = tmp_jsonl
        write([
            _assistant_entry([("Bash", {"command": "git commit -m 'fix bug'"})]),
            _assistant_entry([("Bash", {"command": "git add . && git commit -m 'add feature'"})]),
            _assistant_entry([("Read", {"file_path": "/tmp/foo"})]),
        ])
        result = generate_summary(sid, ws)
        assert result["git_commits"] == 2

    def test_extracts_pr_titles(self, tmp_jsonl):
        sid, ws, _, write = tmp_jsonl
        write([
            _assistant_entry([("Bash", {"command": "gh pr create --title 'fix: screenshot' --body 'x'"})]),
            _assistant_entry([("Bash", {"command": 'gh pr create --title "feat: zoom" --body "y"'})]),
        ])
        result = generate_summary(sid, ws)
        assert result["prs_created"] == ["fix: screenshot", "feat: zoom"]

    def test_extracts_pr_merges(self, tmp_jsonl):
        sid, ws, _, write = tmp_jsonl
        write([
            _assistant_entry([("Bash", {"command": "gh pr merge 518 --squash --delete-branch"})]),
            _assistant_entry([("Bash", {"command": "gh pr merge 519 --squash"})]),
        ])
        result = generate_summary(sid, ws)
        assert result["prs_merged"] == [518, 519]

    def test_no_git_activity(self, tmp_jsonl):
        sid, ws, _, write = tmp_jsonl
        write([_assistant_entry([("Read", {"file_path": "/tmp/foo"})])])
        result = generate_summary(sid, ws)
        assert result["git_commits"] == 0
        assert result["prs_created"] == []
        assert result["prs_merged"] == []

    def test_mixed_activity(self, tmp_jsonl):
        sid, ws, _, write = tmp_jsonl
        write([
            _assistant_entry([("Bash", {"command": "git commit -m 'initial'"})]),
            _assistant_entry([("Bash", {"command": "gh pr create --title 'my PR' --body 'x'"})]),
            _assistant_entry([("Bash", {"command": "gh pr merge 42 --squash"})]),
            _assistant_entry([("Read", {"file_path": "/tmp/file"})]),
        ])
        result = generate_summary(sid, ws)
        assert result["git_commits"] == 1
        assert result["prs_created"] == ["my PR"]
        assert result["prs_merged"] == [42]
        assert result["turns"] == 4


class TestSaveSummary:
    def test_saves_to_file(self, tmp_jsonl, tmp_path):
        sid, ws, _, write = tmp_jsonl
        write([_assistant_entry([("Read", {"file_path": "/x.py"})])])
        with patch("session_summary.SUMMARY_FILE", tmp_path / "summary.json"), \
             patch("session_summary.SUMMARIES_DIR", tmp_path / "summaries"):
            save_summary(sid, ws)
        assert (tmp_path / "summary.json").exists()
        data = json.loads((tmp_path / "summary.json").read_text())
        assert data["turns"] == 1

    def test_saves_per_session(self, tmp_jsonl, tmp_path):
        sid, ws, _, write = tmp_jsonl
        write([_assistant_entry([("Bash", {"command": "git commit -m 'test'"})])])
        sdir = tmp_path / "summaries"
        with patch("session_summary.SUMMARY_FILE", tmp_path / "summary.json"), \
             patch("session_summary.SUMMARIES_DIR", sdir):
            save_summary(sid, ws)
        per_session = sdir / f"{sid}.json"
        assert per_session.exists()
        data = json.loads(per_session.read_text())
        assert data["session_id"] == sid
        assert data["git_commits"] == 1

    def test_no_jsonl_no_file(self, tmp_jsonl, tmp_path):
        _, ws, _, _ = tmp_jsonl
        with patch("session_summary.SUMMARY_FILE", tmp_path / "summary.json"), \
             patch("session_summary.SUMMARIES_DIR", tmp_path / "summaries"):
            save_summary("nonexistent", ws)
        assert not (tmp_path / "summary.json").exists()
        assert not (tmp_path / "summaries").exists()
