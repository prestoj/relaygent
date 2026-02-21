"""Tests for build_prompt() and ensure_settings() in harness_env.py."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest



def _make_config(tmp_path, kb_dir=None, extras=None):
    cfg = {"paths": {"kb": str(kb_dir or tmp_path / "kb")}}
    if extras:
        cfg.update(extras)
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    (home / ".relaygent").mkdir(exist_ok=True)
    (home / ".relaygent" / "config.json").write_text(json.dumps(cfg))
    return home


class TestBuildPrompt:
    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path):
        self.tmp = tmp_path
        self.prompt_file = tmp_path / "PROMPT.md"
        self.prompt_file.write_bytes(b"Hello {KB_DIR} world")

    def _call(self, home, kb_dir=None, memory_content=None):
        from harness_env import build_prompt
        if kb_dir is None:
            kb_dir = self.tmp / "kb"
        kb_dir = Path(kb_dir)
        kb_dir.mkdir(parents=True, exist_ok=True)
        if memory_content is not None:
            (kb_dir / "MEMORY.md").write_text(memory_content)
        with patch("harness_env.PROMPT_FILE", self.prompt_file), \
             patch("harness_env.Path.home", return_value=home):
            return build_prompt()

    def test_substitutes_kb_dir(self, tmp_path):
        home = _make_config(tmp_path)
        kb = tmp_path / "kb"
        result = self._call(home, kb_dir=kb)
        assert str(kb).encode() in result
        assert b"{KB_DIR}" not in result

    def test_substitutes_hub_port(self, tmp_path):
        home = _make_config(tmp_path, extras={"hub": {"port": 9090}})
        self.prompt_file.write_bytes(b"Web UI at http://localhost:{HUB_PORT}/kb")
        result = self._call(home)
        assert b"9090" in result
        assert b"{HUB_PORT}" not in result

    def test_hub_port_defaults_to_8080(self, tmp_path):
        home = _make_config(tmp_path)  # no hub.port in config
        self.prompt_file.write_bytes(b"Web UI at http://localhost:{HUB_PORT}/kb")
        result = self._call(home)
        assert b"8080" in result

    def test_appends_memory_when_present(self, tmp_path):
        home = _make_config(tmp_path)
        kb = tmp_path / "kb"
        result = self._call(home, kb_dir=kb, memory_content="Remember this.")
        assert b"<memory>" in result
        assert b"Remember this." in result
        assert b"</memory>" in result

    def test_no_memory_tag_when_memory_empty(self, tmp_path):
        home = _make_config(tmp_path)
        kb = tmp_path / "kb"
        result = self._call(home, kb_dir=kb, memory_content="")
        assert b"<memory>" not in result

    def test_no_memory_tag_when_memory_missing(self, tmp_path):
        home = _make_config(tmp_path)
        result = self._call(home)
        assert b"<memory>" not in result

    def test_returns_raw_prompt_when_no_config(self, tmp_path):
        home = tmp_path / "home"
        home.mkdir()
        (home / ".relaygent").mkdir()
        with patch("harness_env.PROMPT_FILE", self.prompt_file), \
             patch("harness_env.Path.home", return_value=home):
            from harness_env import build_prompt
            result = build_prompt()
        assert result == b"Hello {KB_DIR} world"

    def test_returns_bytes(self, tmp_path):
        home = _make_config(tmp_path)
        result = self._call(home)
        assert isinstance(result, bytes)

    def test_memory_whitespace_only_not_appended(self, tmp_path):
        home = _make_config(tmp_path)
        kb = tmp_path / "kb"
        result = self._call(home, kb_dir=kb, memory_content="   \n  ")
        assert b"<memory>" not in result


class TestEnsureSettings:
    def test_creates_settings_from_template(self, tmp_path):
        from harness_env import ensure_settings
        harness = tmp_path / "harness"
        harness.mkdir()
        tmpl = harness / "settings.json.template"
        tmpl.write_text('{"dir": "RELAYGENT_DIR/x"}')
        dest = harness / "settings.json"
        with patch("harness_env._HARNESS", harness):
            result = ensure_settings()
        assert result == dest
        assert str(tmp_path.parent) in dest.read_text() or "RELAYGENT_DIR" not in dest.read_text()

    def test_skips_when_no_template(self, tmp_path):
        from harness_env import ensure_settings
        harness = tmp_path / "harness"
        harness.mkdir()
        with patch("harness_env._HARNESS", harness):
            result = ensure_settings()
        assert not (harness / "settings.json").exists()

    def test_does_not_overwrite_newer_dest(self, tmp_path):
        import time
        from harness_env import ensure_settings
        harness = tmp_path / "harness"
        harness.mkdir()
        tmpl = harness / "settings.json.template"
        tmpl.write_text('{"new": true}')
        dest = harness / "settings.json"
        dest.write_text('{"old": true}')
        # Make dest newer than template
        future = time.time() + 10
        import os
        os.utime(dest, (future, future))
        with patch("harness_env._HARNESS", harness):
            ensure_settings()
        assert '"old": true' in dest.read_text()
