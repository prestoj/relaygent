"""Tests for harness_env.py — settings generation and prompt building."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from harness_env import build_prompt, ensure_settings


class TestEnsureSettings:
    def test_generates_settings_from_template(self, tmp_path, monkeypatch):
        harness_dir = tmp_path / "harness"
        harness_dir.mkdir()
        tmpl = harness_dir / "settings.json.template"
        tmpl.write_text('{"dir": "RELAYGENT_DIR/data"}')
        dest = harness_dir / "settings.json"

        with patch("harness_env._HARNESS", harness_dir):
            result = ensure_settings()
            assert result == dest
            content = dest.read_text()
            assert "RELAYGENT_DIR" not in content
            assert str(harness_dir.parent) in content

    def test_skips_when_dest_newer_than_template(self, tmp_path):
        harness_dir = tmp_path / "harness"
        harness_dir.mkdir()
        tmpl = harness_dir / "settings.json.template"
        tmpl.write_text('{"dir": "RELAYGENT_DIR"}')
        dest = harness_dir / "settings.json"
        dest.write_text('{"dir": "already-generated"}')
        # Make dest newer than template
        import time
        time.sleep(0.05)
        dest.write_text('{"dir": "already-generated"}')

        with patch("harness_env._HARNESS", harness_dir):
            ensure_settings()
            assert dest.read_text() == '{"dir": "already-generated"}'

    def test_returns_dest_path_when_no_template(self, tmp_path):
        harness_dir = tmp_path / "harness"
        harness_dir.mkdir()

        with patch("harness_env._HARNESS", harness_dir):
            result = ensure_settings()
            assert result == harness_dir / "settings.json"


class TestBuildPrompt:
    def test_returns_prompt_bytes(self, tmp_path, monkeypatch):
        harness_dir = tmp_path / "harness"
        harness_dir.mkdir()
        prompt_file = harness_dir / "PROMPT.md"
        prompt_file.write_text("Hello {KB_DIR} port {HUB_PORT}")

        config_dir = tmp_path / ".relaygent"
        config_dir.mkdir()
        kb_dir = tmp_path / "kb"
        kb_dir.mkdir()
        (kb_dir / "MEMORY.md").write_text("remember this")
        cfg = {"paths": {"kb": str(kb_dir)}, "hub": {"port": 9090}}
        (config_dir / "config.json").write_text(json.dumps(cfg))

        monkeypatch.setenv("HOME", str(tmp_path))
        with patch("harness_env.PROMPT_FILE", prompt_file), \
             patch("harness_env._run_orient", return_value=""):
            result = build_prompt()
            assert isinstance(result, bytes)
            assert str(kb_dir).encode() in result
            assert b"9090" in result
            assert b"remember this" in result
            assert b"<memory>" in result

    def test_prompt_without_config(self, tmp_path, monkeypatch):
        harness_dir = tmp_path / "harness"
        harness_dir.mkdir()
        prompt_file = harness_dir / "PROMPT.md"
        prompt_file.write_text("plain prompt")

        monkeypatch.setenv("HOME", str(tmp_path))
        with patch("harness_env.PROMPT_FILE", prompt_file), \
             patch("harness_env._run_orient", return_value=""):
            result = build_prompt()
            assert result == b"plain prompt"

    def test_prompt_with_orient_output(self, tmp_path, monkeypatch):
        harness_dir = tmp_path / "harness"
        harness_dir.mkdir()
        prompt_file = harness_dir / "PROMPT.md"
        prompt_file.write_text("base")

        monkeypatch.setenv("HOME", str(tmp_path))
        with patch("harness_env.PROMPT_FILE", prompt_file), \
             patch("harness_env._run_orient", return_value="status: running"):
            result = build_prompt()
            assert b"<orient>" in result
            assert b"status: running" in result

    def test_prompt_without_memory(self, tmp_path, monkeypatch):
        harness_dir = tmp_path / "harness"
        harness_dir.mkdir()
        prompt_file = harness_dir / "PROMPT.md"
        prompt_file.write_text("Hello {KB_DIR}")

        config_dir = tmp_path / ".relaygent"
        config_dir.mkdir()
        kb_dir = tmp_path / "kb"
        kb_dir.mkdir()
        # MEMORY.md is empty
        (kb_dir / "MEMORY.md").write_text("")
        cfg = {"paths": {"kb": str(kb_dir)}}
        (config_dir / "config.json").write_text(json.dumps(cfg))

        monkeypatch.setenv("HOME", str(tmp_path))
        with patch("harness_env.PROMPT_FILE", prompt_file), \
             patch("harness_env._run_orient", return_value=""):
            result = build_prompt()
            assert b"<memory>" not in result
