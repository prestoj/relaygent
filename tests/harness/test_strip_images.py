"""Tests for strip_old_images JSONL image pruning."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest


from jsonl_checks import strip_old_images


def _img_entry(i):
    return {"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": f"t{i}", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "DATA" * 10}},
            {"type": "text", "text": "Screenshot: 1920x1080px"},
        ]}
    ]}}


def _text_entry(i):
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": f"Response {i}"}]}}


@pytest.fixture
def session(tmp_path):
    session_id = "strip-test-session"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    slug = str(workspace).replace("/", "-").replace(".", "-")
    project_dir = tmp_path / ".claude" / "projects" / slug
    project_dir.mkdir(parents=True)
    jsonl_path = project_dir / f"{session_id}.jsonl"

    def write(entries):
        jsonl_path.write_text("\n".join(json.dumps(e) for e in entries) + "\n")

    def read():
        return [json.loads(l) for l in jsonl_path.read_text().splitlines() if l.strip()]

    with patch("jsonl_checks.Path.home", return_value=tmp_path):
        yield session_id, workspace, write, read


class TestStripOldImages:
    def test_strips_old_keeps_last(self, session):
        sid, ws, write, read = session
        write([_img_entry(i) for i in range(10)])
        with patch("jsonl_checks.Path.home", return_value=ws.parent.parent):
            pass  # already patched via fixture
        stripped = strip_old_images(sid, ws, keep_last=3)
        assert stripped == 7
        entries = read()
        placeholders = sum(
            1 for e in entries
            for item in e.get("message", {}).get("content", []) or []
            if isinstance(item, dict) and item.get("type") == "tool_result"
            for s in item.get("content", []) or []
            if isinstance(s, dict) and s.get("type") == "text" and s.get("text") == "[screenshot removed]"
        )
        real_imgs = sum(
            1 for e in entries
            for item in e.get("message", {}).get("content", []) or []
            if isinstance(item, dict) and item.get("type") == "tool_result"
            for s in item.get("content", []) or []
            if isinstance(s, dict) and s.get("type") == "image"
        )
        assert placeholders == 7
        assert real_imgs == 3

    def test_no_strip_when_few_images(self, session):
        sid, ws, write, read = session
        write([_img_entry(i) for i in range(3)])
        stripped = strip_old_images(sid, ws, keep_last=5)
        assert stripped == 0

    def test_preserves_text_in_tool_result(self, session):
        sid, ws, write, read = session
        write([_img_entry(i) for i in range(8)])
        strip_old_images(sid, ws, keep_last=3)
        entries = read()
        # Every tool_result should still have the text sub-item
        for e in entries:
            for item in e.get("message", {}).get("content", []) or []:
                if not isinstance(item, dict) or item.get("type") != "tool_result": continue
                texts = [s for s in item.get("content", []) or [] if isinstance(s, dict) and s.get("type") == "text"]
                assert len(texts) >= 1

    def test_text_entries_untouched(self, session):
        sid, ws, write, read = session
        entries = []
        for i in range(5):
            entries.append(_img_entry(i))
            entries.append(_text_entry(i))
        write(entries)
        strip_old_images(sid, ws, keep_last=2)
        result = read()
        assistant_texts = [
            e["message"]["content"][0]["text"]
            for e in result if e.get("type") == "assistant"
        ]
        assert assistant_texts == [f"Response {i}" for i in range(5)]

    def test_missing_session_returns_zero(self, session):
        sid, ws, write, read = session
        # Don't write any file
        stripped = strip_old_images("nonexistent-id", ws, keep_last=5)
        assert stripped == 0

    def test_empty_file_returns_zero(self, session):
        sid, ws, write, read = session
        write([])
        stripped = strip_old_images(sid, ws, keep_last=5)
        assert stripped == 0
