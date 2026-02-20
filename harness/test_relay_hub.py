"""Tests for relay_hub.py — hub build staleness check and auto-rebuild."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from relay_hub import check_and_rebuild_hub


class TestCheckAndRebuildHub:
    @pytest.fixture(autouse=True)
    def patch_repo_dir(self, tmp_path, monkeypatch):
        monkeypatch.setattr("relay_hub.REPO_DIR", tmp_path)
        self.repo = tmp_path
        self.home = tmp_path / "home"
        self.home.mkdir()
        (self.home / ".relaygent").mkdir()
        (tmp_path / "data").mkdir()
        (tmp_path / "hub").mkdir()
        (tmp_path / "logs").mkdir()
        monkeypatch.setattr("relay_hub.Path.home", lambda: self.home)
        # All tests in this class use the non-LaunchAgent path
        monkeypatch.setattr("relay_hub._hub_uses_launchagent", lambda: False)

    def _git_run(self, head="abc1234"):
        r = MagicMock(); r.stdout = head; r.returncode = 0; return r

    def _build_run(self, rc=0):
        r = MagicMock(); r.returncode = rc; r.stderr = b""; return r

    def test_skips_when_build_is_current(self, capsys):
        commit_file = self.repo / "data" / "hub-build-commit"
        commit_file.write_text("abc1234")
        with patch("relay_hub.subprocess.run", return_value=self._git_run("abc1234")) as mock_run:
            check_and_rebuild_hub()
        calls = [str(c) for c in mock_run.call_args_list]
        assert not any("npm" in c for c in calls)
        assert "skipping" in capsys.readouterr().out

    def test_rebuilds_when_no_commit_file(self):
        proc = MagicMock(); proc.pid = 9999
        with patch("relay_hub.subprocess.run", side_effect=[
            self._git_run("newhead"), self._build_run(0)
        ]), patch("relay_hub.subprocess.Popen", return_value=proc):
            check_and_rebuild_hub()
        assert (self.repo / "data" / "hub-build-commit").read_text().strip() == "newhead"

    def test_rebuilds_when_commit_differs(self):
        (self.repo / "data" / "hub-build-commit").write_text("oldhead")
        proc = MagicMock(); proc.pid = 9999
        with patch("relay_hub.subprocess.run", side_effect=[
            self._git_run("newhead"), self._build_run(0)
        ]), patch("relay_hub.subprocess.Popen", return_value=proc):
            check_and_rebuild_hub()
        assert (self.repo / "data" / "hub-build-commit").read_text().strip() == "newhead"

    def test_skips_when_git_returns_empty(self):
        with patch("relay_hub.subprocess.run", return_value=self._git_run("")) as mock_run:
            check_and_rebuild_hub()
        calls = [str(c) for c in mock_run.call_args_list]
        assert not any("npm" in c for c in calls)

    def test_skips_when_git_raises(self):
        with patch("relay_hub.subprocess.run", side_effect=OSError("no git")):
            check_and_rebuild_hub()  # Should not raise

    def test_logs_and_returns_on_build_failure(self, capsys):
        r = MagicMock(); r.returncode = 1; r.stderr = b"build error"
        with patch("relay_hub.subprocess.run", side_effect=[self._git_run("newhead"), r]):
            check_and_rebuild_hub()
        assert not (self.repo / "data" / "hub-build-commit").exists()
        assert "failed" in capsys.readouterr().out

    def test_reads_port_from_config(self):
        import json
        (self.home / ".relaygent" / "config.json").write_text(json.dumps({
            "hub": {"port": 9090}, "paths": {"kb": str(self.repo)}
        }))
        proc = MagicMock(); proc.pid = 1234
        with patch("relay_hub.subprocess.run", side_effect=[
            self._git_run("abc"), self._build_run(0)
        ]), patch("relay_hub.subprocess.Popen", return_value=proc) as mock_popen:
            check_and_rebuild_hub()
        assert mock_popen.call_args[1]["env"]["PORT"] == "9090"

    def test_writes_pid_after_restart(self):
        proc = MagicMock(); proc.pid = 5678
        with patch("relay_hub.subprocess.run", side_effect=[
            self._git_run("abc"), self._build_run(0)
        ]), patch("relay_hub.subprocess.Popen", return_value=proc):
            check_and_rebuild_hub()
        pid_file = self.home / ".relaygent" / "hub.pid"
        assert "5678" in pid_file.read_text()


class TestLaunchAgentPath:
    @pytest.fixture(autouse=True)
    def patch_repo_dir(self, tmp_path, monkeypatch):
        monkeypatch.setattr("relay_hub.REPO_DIR", tmp_path)
        self.repo = tmp_path
        self.home = tmp_path / "home"
        self.home.mkdir()
        (self.home / ".relaygent").mkdir()
        (tmp_path / "data").mkdir()
        (tmp_path / "hub").mkdir()
        (tmp_path / "logs").mkdir()
        monkeypatch.setattr("relay_hub.Path.home", lambda: self.home)

    def _git_run(self, head="abc1234"):
        r = MagicMock(); r.stdout = head; r.returncode = 0; return r

    def _build_run(self, rc=0):
        r = MagicMock(); r.returncode = rc; r.stderr = b""; return r

    @patch("relay_hub._hub_uses_launchagent", return_value=True)
    @patch("relay_hub.time.sleep")
    def test_uses_launchctl_stop_start(self, mock_sleep, mock_la):
        with patch("relay_hub.subprocess.run", side_effect=[
            self._git_run("newhead"), self._build_run(0)
        ]), patch("relay_hub._launchctl") as mock_lc, \
           patch("relay_hub.subprocess.Popen") as mock_popen:
            check_and_rebuild_hub()
        assert mock_lc.call_args_list[0][0] == ("stop", "com.relaygent.hub")
        assert mock_lc.call_args_list[1][0] == ("start", "com.relaygent.hub")
        mock_popen.assert_not_called()

    @patch("relay_hub._hub_uses_launchagent", return_value=True)
    @patch("relay_hub.time.sleep")
    def test_launchagent_restarts_hub_on_build_failure(self, mock_sleep, mock_la, capsys):
        r = MagicMock(); r.returncode = 1; r.stderr = b"err"
        with patch("relay_hub.subprocess.run", side_effect=[self._git_run("newhead"), r]), \
             patch("relay_hub._launchctl") as mock_lc:
            check_and_rebuild_hub()
        # Should stop, fail build, then start again to restore old build
        calls = [c[0] for c in mock_lc.call_args_list]
        assert ("stop", "com.relaygent.hub") in calls
        assert ("start", "com.relaygent.hub") in calls
        assert "failed" in capsys.readouterr().out

    @patch("relay_hub._hub_uses_launchagent", return_value=True)
    @patch("relay_hub.time.sleep")
    def test_launchagent_does_not_write_pid_file(self, mock_sleep, mock_la):
        with patch("relay_hub.subprocess.run", side_effect=[
            self._git_run("abc"), self._build_run(0)
        ]), patch("relay_hub._launchctl"):
            check_and_rebuild_hub()
        assert not (self.home / ".relaygent" / "hub.pid").exists()
