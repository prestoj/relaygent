"""Tests for relay utility functions."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


from relay_utils import acquire_lock, cleanup_context_file, commit_kb, kill_orphaned_claudes, notify_crash, pull_latest, rotate_log


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
        with patch("relay_utils._send_chat_alert"), patch("relay_utils._send_slack_alert"):
            notify_crash(3, 1)
        out = capsys.readouterr().out
        assert "3" in out
        assert "1" in out

    def test_sends_chat_and_slack_alerts(self):
        with patch("relay_utils._send_chat_alert") as mc, patch("relay_utils._send_slack_alert") as ms:
            notify_crash(2, 137)
        mc.assert_called_once(); ms.assert_called_once()
        assert "2" in mc.call_args[0][0] and "137" in mc.call_args[0][0]

    def test_send_slack_alert_swallows_network_errors(self):
        import urllib.error
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            from relay_utils import _send_slack_alert
            _send_slack_alert("test")  # Should not raise

    def test_send_chat_alert_swallows_network_errors(self):
        import urllib.error
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            from relay_utils import _send_chat_alert
            _send_chat_alert("test alert")  # Should not raise


def _make_commit_script(tmp_path, mode=0o755):
    s = tmp_path / "knowledge" / "commit.sh"
    s.parent.mkdir(parents=True, exist_ok=True)
    s.write_text("#!/bin/bash\nexit 0\n"); s.chmod(mode)
    return s

class TestCommitKb:
    def test_runs_commit_script_when_present(self, tmp_path, monkeypatch):
        script = _make_commit_script(tmp_path)
        monkeypatch.setattr("relay_utils.REPO_DIR", tmp_path)
        with patch("relay_utils.subprocess.run") as m:
            m.return_value.returncode = 0; commit_kb()
        m.assert_called_once()
        assert str(script) in m.call_args[0][0][0]

    def test_skips_if_script_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr("relay_utils.REPO_DIR", tmp_path)
        with patch("relay_utils.subprocess.run") as m: commit_kb()
        m.assert_not_called()

    def test_skips_if_not_executable(self, tmp_path, monkeypatch):
        _make_commit_script(tmp_path, mode=0o644)
        monkeypatch.setattr("relay_utils.REPO_DIR", tmp_path)
        with patch("relay_utils.subprocess.run") as m: commit_kb()
        m.assert_not_called()

    def test_logs_failure_on_nonzero_exit(self, tmp_path, monkeypatch):
        _make_commit_script(tmp_path)
        monkeypatch.setattr("relay_utils.REPO_DIR", tmp_path)
        with patch("relay_utils.subprocess.run") as m, patch("relay_utils.log") as ml:
            m.return_value.returncode = 1; m.return_value.stderr = b"push failed"
            commit_kb()
        assert "failed" in " ".join(str(c) for c in ml.call_args_list).lower()


class TestAcquireLock:
    def test_acquires_lock_and_writes_pid(self, tmp_path, monkeypatch):
        lock_file = tmp_path / ".relay.lock"
        monkeypatch.setattr("relay_utils.LOCK_FILE", lock_file)
        fd = acquire_lock()
        assert fd >= 0
        content = lock_file.read_text()
        assert str(os.getpid()) in content
        os.close(fd)

    def test_exits_if_already_locked(self, tmp_path, monkeypatch):
        lock_file = tmp_path / ".relay.lock"
        monkeypatch.setattr("relay_utils.LOCK_FILE", lock_file)
        fd1 = acquire_lock()
        with pytest.raises(SystemExit):
            acquire_lock()
        os.close(fd1)


class TestKillOrphanedClaudes:
    def test_sends_sigterm_to_matched_pids(self, monkeypatch):
        mock_run = MagicMock()
        mock_run.returncode = 0
        mock_run.stdout = "12345\n"
        monkeypatch.setattr("relay_utils.subprocess.run", lambda *a, **kw: mock_run)
        with patch("relay_utils.os.kill") as mock_kill:
            kill_orphaned_claudes()
        mock_kill.assert_called_once_with(12345, __import__("signal").SIGTERM)

    def test_no_error_when_no_orphans(self, monkeypatch):
        mock_run = MagicMock()
        mock_run.returncode = 1
        mock_run.stdout = ""
        monkeypatch.setattr("relay_utils.subprocess.run", lambda *a, **kw: mock_run)
        kill_orphaned_claudes()  # Should not raise

    def test_handles_vanished_process(self, monkeypatch):
        mock_run = MagicMock()
        mock_run.returncode = 0
        mock_run.stdout = "99999\n"
        monkeypatch.setattr("relay_utils.subprocess.run", lambda *a, **kw: mock_run)
        with patch("relay_utils.os.kill", side_effect=ProcessLookupError):
            kill_orphaned_claudes()  # Should not raise


class TestPullLatest:
    def test_calls_git_pull_ff_only(self, monkeypatch):
        mock_run = MagicMock(); mock_run.returncode = 0; mock_run.stdout = "Already up to date."
        monkeypatch.setattr("relay_utils.subprocess.run", mock_run)
        pull_latest()
        args = mock_run.call_args[0][0]
        assert "pull" in args and "--ff-only" in args

    def test_swallows_subprocess_error(self, monkeypatch):
        import subprocess
        monkeypatch.setattr("relay_utils.subprocess.run", MagicMock(side_effect=subprocess.TimeoutExpired("git", 30)))
        pull_latest()  # Should not raise
