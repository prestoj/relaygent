"""Tests for relay utility functions."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from relay_utils import cleanup_context_file, commit_kb, notify_crash, rotate_log


class TestRotateLog:
    def test_rotates_oversized_log(self, tmp_path, monkeypatch):
        log_file = tmp_path / "test.log"
        monkeypatch.setattr("relay_utils.LOG_FILE", log_file)
        monkeypatch.setattr("relay_utils.LOG_MAX_SIZE", 100)
        monkeypatch.setattr("relay_utils.LOG_TRUNCATE_SIZE", 50)

        # Write 200 bytes of log lines
        lines = [f"[2026-02-16] Log line {i:03d}\n" for i in range(10)]
        log_file.write_text("".join(lines))
        original_size = log_file.stat().st_size
        assert original_size > 100

        rotate_log()
        new_size = log_file.stat().st_size
        assert new_size < original_size
        assert new_size <= 50

        # Content should start at a complete line
        content = log_file.read_text()
        assert not content.startswith("\n")
        assert content.endswith("\n")

    def test_no_rotation_for_small_log(self, tmp_path, monkeypatch):
        log_file = tmp_path / "small.log"
        monkeypatch.setattr("relay_utils.LOG_FILE", log_file)
        monkeypatch.setattr("relay_utils.LOG_MAX_SIZE", 10000)

        log_file.write_text("Small log\n")
        original = log_file.read_text()

        rotate_log()
        assert log_file.read_text() == original

    def test_no_error_for_missing_log(self, tmp_path, monkeypatch):
        log_file = tmp_path / "missing.log"
        monkeypatch.setattr("relay_utils.LOG_FILE", log_file)
        # Should not raise
        rotate_log()


class TestCleanupContextFile:
    def test_removes_context_file(self, tmp_path):
        pct_file = tmp_path / "relaygent-context-pct"
        pct_file.write_text("85.3")

        with patch("relay_utils.Path", return_value=pct_file):
            cleanup_context_file()
        assert not pct_file.exists()

    def test_no_error_if_missing(self, tmp_path):
        pct_file = tmp_path / "nonexistent"
        with patch("relay_utils.Path", return_value=pct_file):
            cleanup_context_file()  # Should not raise


class TestNotifyCrash:
    def test_logs_crash_message(self, capsys):
        with patch("relay_utils._send_chat_alert"):
            notify_crash(3, 1)
        out = capsys.readouterr().out
        assert "3" in out
        assert "1" in out

    def test_sends_chat_alert(self):
        with patch("relay_utils._send_chat_alert") as mock_alert:
            notify_crash(2, 137)
        mock_alert.assert_called_once()
        msg = mock_alert.call_args[0][0]
        assert "2" in msg
        assert "137" in msg

    def test_send_chat_alert_swallows_network_errors(self):
        """_send_chat_alert catches URLError/OSError so hub being down won't crash relay."""
        import urllib.error
        with patch("urllib.request.urlopen",
                   side_effect=urllib.error.URLError("connection refused")):
            # Should not raise — hub being down is non-fatal
            from relay_utils import _send_chat_alert
            _send_chat_alert("test alert")


class TestCommitKb:
    def test_runs_commit_script_when_present(self, tmp_path, monkeypatch):
        commit_script = tmp_path / "knowledge" / "commit.sh"
        commit_script.parent.mkdir(parents=True)
        commit_script.write_text("#!/bin/bash\nexit 0\n")
        commit_script.chmod(0o755)
        monkeypatch.setattr("relay_utils.REPO_DIR", tmp_path)

        with patch("relay_utils.subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            commit_kb()
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert str(commit_script) in args[0]

    def test_skips_if_script_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr("relay_utils.REPO_DIR", tmp_path)
        with patch("relay_utils.subprocess.run") as mock_run:
            commit_kb()
        mock_run.assert_not_called()

    def test_skips_if_not_executable(self, tmp_path, monkeypatch):
        commit_script = tmp_path / "knowledge" / "commit.sh"
        commit_script.parent.mkdir(parents=True)
        commit_script.write_text("#!/bin/bash\nexit 0\n")
        commit_script.chmod(0o644)  # not executable
        monkeypatch.setattr("relay_utils.REPO_DIR", tmp_path)

        with patch("relay_utils.subprocess.run") as mock_run:
            commit_kb()
        mock_run.assert_not_called()
