"""Tests for harness_env.py — environment setup and prompt building."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from harness_env import build_prompt, clean_env, configured_model, ensure_settings, find_claude_binary


class TestConfiguredModel:
    def test_returns_model_from_config(self, tmp_path, monkeypatch):
        cfg = {"model": "claude-sonnet-4-5-20250929"}
        config_dir = tmp_path / ".relaygent"
        config_dir.mkdir()
        (config_dir / "config.json").write_text(json.dumps(cfg))
        monkeypatch.setenv("HOME", str(tmp_path))
        assert configured_model() == "claude-sonnet-4-5-20250929"

    def test_returns_none_when_no_model(self, tmp_path, monkeypatch):
        config_dir = tmp_path / ".relaygent"
        config_dir.mkdir()
        (config_dir / "config.json").write_text("{}")
        monkeypatch.setenv("HOME", str(tmp_path))
        assert configured_model() is None

    def test_returns_none_when_config_missing(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path))
        assert configured_model() is None

    def test_returns_none_on_invalid_json(self, tmp_path, monkeypatch):
        config_dir = tmp_path / ".relaygent"
        config_dir.mkdir()
        (config_dir / "config.json").write_text("not json")
        monkeypatch.setenv("HOME", str(tmp_path))
        assert configured_model() is None


class TestCleanEnv:
    def test_removes_claude_internal_vars(self, monkeypatch):
        monkeypatch.setenv("CLAUDECODE", "1")
        monkeypatch.setenv("CLAUDE_CODE_ENTRYPOINT", "test")
        monkeypatch.setenv("PATH", "/usr/bin")
        env = clean_env()
        assert "CLAUDECODE" not in env
        assert "CLAUDE_CODE_ENTRYPOINT" not in env
        assert "PATH" in env

    def test_preserves_non_internal_vars(self, monkeypatch):
        monkeypatch.setenv("MY_VAR", "hello")
        monkeypatch.delenv("CLAUDECODE", raising=False)
        env = clean_env()
        assert env["MY_VAR"] == "hello"

    def test_augments_path(self, monkeypatch):
        monkeypatch.setenv("PATH", "/usr/bin")
        env = clean_env()
        assert env["PATH"].startswith("/usr/bin:")
        assert "/usr/local/bin" in env["PATH"]


class TestFindClaudeBinary:
    def test_finds_via_env_override(self, tmp_path, monkeypatch):
        fake = tmp_path / "claude"
        fake.write_text("#!/bin/sh\n"); fake.chmod(0o755)
        monkeypatch.setenv("CLAUDE_BIN", str(fake))
        assert find_claude_binary() == str(fake)

    def test_finds_via_config(self, tmp_path, monkeypatch):
        monkeypatch.delenv("CLAUDE_BIN", raising=False)
        fake = tmp_path / "claude"
        fake.write_text("#!/bin/sh\n"); fake.chmod(0o755)
        cfg_dir = tmp_path / ".relaygent"; cfg_dir.mkdir()
        (cfg_dir / "config.json").write_text(json.dumps({"claude_path": str(fake)}))
        monkeypatch.setenv("HOME", str(tmp_path))
        assert find_claude_binary() == str(fake)

    def test_returns_none_when_missing(self, tmp_path, monkeypatch):
        monkeypatch.delenv("CLAUDE_BIN", raising=False)
        monkeypatch.setenv("HOME", str(tmp_path))
        monkeypatch.setenv("PATH", str(tmp_path))  # empty dir
        with patch("harness_env._EXTRA_PATH_DIRS", []):
            assert find_claude_binary() is None


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
