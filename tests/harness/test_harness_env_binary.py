"""Tests for harness_env.py — model config, clean_env, and binary lookup."""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from harness_env import clean_env, configured_model, find_claude_binary


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
