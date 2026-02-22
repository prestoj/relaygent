"""Tests for process.py — Claude subprocess management."""
from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from config import Timer
from process import ClaudeProcess, ClaudeResult
from harness_env import clean_env, configured_model, _CLAUDE_INTERNAL


class TestClaudeResult:
    def test_defaults(self):
        r = ClaudeResult(exit_code=0)
        assert not r.hung and not r.timed_out and not r.no_output
        assert not r.incomplete and r.context_pct == 0.0

    def test_all_flags(self):
        r = ClaudeResult(exit_code=1, hung=True, timed_out=True,
                         no_output=True, incomplete=True, context_pct=87.5)
        assert r.hung and r.timed_out and r.no_output
        assert r.incomplete and r.context_pct == 87.5


class TestClaudeProcessInit:
    def test_creates_with_session_id(self, tmp_path):
        t = Timer()
        p = ClaudeProcess("test-session", t, tmp_path)
        assert p.session_id == "test-session"
        assert p.timer is t
        assert p.workspace == tmp_path
        assert p.process is None

    def test_context_warning_starts_false(self, tmp_path):
        p = ClaudeProcess("s", Timer(), tmp_path)
        assert not p._context_warning_sent


class TestGetLogLines:
    def test_counts_lines(self, tmp_path, monkeypatch):
        import process as proc_mod
        log_file = tmp_path / "test.log"
        log_file.write_text("line1\nline2\nline3\n")
        monkeypatch.setattr(proc_mod, "LOG_FILE", log_file)
        p = ClaudeProcess("s", Timer(), tmp_path)
        assert p._get_log_lines() == 3

    def test_returns_zero_for_missing(self, tmp_path, monkeypatch):
        import process as proc_mod
        monkeypatch.setattr(proc_mod, "LOG_FILE", tmp_path / "nope.log")
        p = ClaudeProcess("s", Timer(), tmp_path)
        assert p._get_log_lines() == 0


class TestCheckForHang:
    @pytest.fixture(autouse=True)
    def log_file(self, tmp_path, monkeypatch):
        import process as proc_mod
        f = tmp_path / "test.log"
        monkeypatch.setattr(proc_mod, "LOG_FILE", f)
        self._tmp = tmp_path
        return f

    def _proc(self): return ClaudeProcess("s", Timer(), self._tmp)

    def test_detects_no_messages_returned(self, log_file):
        log_file.write_text("Starting...\nNo messages returned\n")
        assert self._proc()._check_for_hang(0) is True

    def test_detects_api_error(self, log_file):
        log_file.write_text("Starting...\nAPI Error: 500\n")
        assert self._proc()._check_for_hang(0) is True

    def test_no_hang_for_normal_output(self, log_file):
        log_file.write_text("Starting...\nProcessing...\nDone\n")
        assert self._proc()._check_for_hang(0) is False

    def test_respects_log_start_offset(self, log_file):
        log_file.write_text("No messages returned\nOK\n")
        assert self._proc()._check_for_hang(1) is False  # skip line 0

    def test_no_false_positive_when_pattern_mid_line(self, log_file):
        log_file.write_text('Claude said "No messages returned from the server"\n')
        assert self._proc()._check_for_hang(0) is False


class TestGetContextFill:
    def test_reads_from_pct_file(self, tmp_path, monkeypatch):
        import process
        pct_file = tmp_path / "ctx-pct"
        pct_file.write_text("72.5")
        monkeypatch.setattr(process, "CONTEXT_PCT_FILE", pct_file)
        p = ClaudeProcess("s", Timer(), tmp_path)
        assert p.get_context_fill() == 72.5

    def test_falls_back_to_jsonl(self, tmp_path, monkeypatch):
        import process
        pct_file = tmp_path / "ctx-pct"
        # File doesn't exist — should fall back
        monkeypatch.setattr(process, "CONTEXT_PCT_FILE", pct_file)
        monkeypatch.setattr(process, "get_context_fill_from_jsonl",
                            lambda sid, ws: 45.0)
        p = ClaudeProcess("s", Timer(), tmp_path)
        assert p.get_context_fill() == 45.0

    def test_falls_back_on_zero_pct(self, tmp_path, monkeypatch):
        import process
        pct_file = tmp_path / "ctx-pct"
        pct_file.write_text("0")
        monkeypatch.setattr(process, "CONTEXT_PCT_FILE", pct_file)
        monkeypatch.setattr(process, "get_context_fill_from_jsonl",
                            lambda sid, ws: 33.0)
        p = ClaudeProcess("s", Timer(), tmp_path)
        assert p.get_context_fill() == 33.0


class TestTerminate:
    def test_noop_when_no_process(self, tmp_path):
        p = ClaudeProcess("s", Timer(), tmp_path)
        p._terminate()  # Should not raise

    def test_noop_when_already_exited(self, tmp_path):
        p = ClaudeProcess("s", Timer(), tmp_path)
        mock_proc = MagicMock()
        mock_proc.poll.return_value = 0  # Already exited
        p.process = mock_proc
        p._terminate()
        mock_proc.terminate.assert_not_called()

    def test_terminates_running_process(self, tmp_path):
        p = ClaudeProcess("s", Timer(), tmp_path)
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None  # Still running
        mock_proc.wait.return_value = None
        p.process = mock_proc
        p._terminate()
        mock_proc.terminate.assert_called_once()

    def test_kills_on_timeout(self, tmp_path):
        p = ClaudeProcess("s", Timer(), tmp_path)
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_proc.wait.side_effect = [
            subprocess.TimeoutExpired("claude", 5), None
        ]
        p.process = mock_proc
        p._terminate()
        mock_proc.kill.assert_called_once()


class TestConfiguredModel:
    def test_reads_model_from_config(self, tmp_path, monkeypatch):
        import json
        config = tmp_path / ".relaygent" / "config.json"
        config.parent.mkdir(parents=True)
        config.write_text(json.dumps({"model": "claude-sonnet-4-6"}))
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        assert configured_model() == "claude-sonnet-4-6"

    def test_returns_none_when_no_config(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        assert configured_model() is None

    def test_returns_none_when_no_model_key(self, tmp_path, monkeypatch):
        import json
        config = tmp_path / ".relaygent" / "config.json"
        config.parent.mkdir(parents=True)
        config.write_text(json.dumps({"other": "value"}))
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        assert configured_model() is None

    def test_returns_none_on_malformed_json(self, tmp_path, monkeypatch):
        config = tmp_path / ".relaygent" / "config.json"
        config.parent.mkdir(parents=True)
        config.write_text("NOT JSON")
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        assert configured_model() is None


class TestModelArgs:
    def test_returns_model_args_when_set(self, tmp_path):
        p = ClaudeProcess("s", Timer(), tmp_path)
        with patch("process.configured_model", return_value="claude-opus-4-6"):
            assert p._model_args() == ["--model", "claude-opus-4-6"]

    def test_returns_empty_when_no_model(self, tmp_path):
        p = ClaudeProcess("s", Timer(), tmp_path)
        with patch("process.configured_model", return_value=None):
            assert p._model_args() == []

class TestCleanEnv:
    def test_strips_internal_vars(self, monkeypatch):
        for v in _CLAUDE_INTERNAL: monkeypatch.setenv(v, "1")
        assert not any(v in clean_env() for v in _CLAUDE_INTERNAL)
    def test_preserves_normal_vars(self, monkeypatch):
        monkeypatch.setenv("HOME", "/home/claude"); monkeypatch.setenv("PATH", "/usr/bin")
        env = clean_env()
        assert env["HOME"] == "/home/claude"
        assert env["PATH"].startswith("/usr/bin")
        # PATH should be augmented with common binary dirs
        assert "/usr/local/bin" in env["PATH"]
