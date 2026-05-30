"""Tests for relay_hub.py — hub build staleness check and auto-rebuild."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


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

    def test_skips_when_build_is_current_and_healthy(self, capsys):
        commit_file = self.repo / "data" / "hub-build-commit"
        commit_file.write_text("abc1234")
        with patch("relay_hub.subprocess.run", return_value=self._git_run("abc1234")) as mock_run, \
             patch("relay_hub._hub_healthy", return_value=True), \
             patch("relay_hub.subprocess.Popen") as mock_popen:
            check_and_rebuild_hub()
        calls = [str(c) for c in mock_run.call_args_list]
        assert not any("npm" in c for c in calls)
        mock_popen.assert_not_called()  # healthy hub: no restart
        assert "skipping" in capsys.readouterr().out

    def test_revives_hub_when_build_current_but_down(self, capsys):
        # Build is current (no rebuild), but the hub isn't responding — e.g. it
        # died with a relay/cgroup restart. Should restart the hub, not rebuild.
        (self.repo / "data" / "hub-build-commit").write_text("abc1234")
        proc = MagicMock(); proc.pid = 4321
        with patch("relay_hub.subprocess.run", return_value=self._git_run("abc1234")) as mock_run, \
             patch("relay_hub._hub_healthy", return_value=False), \
             patch("relay_hub.subprocess.Popen", return_value=proc) as mock_popen:
            check_and_rebuild_hub()
        calls = [str(c) for c in mock_run.call_args_list]
        assert not any("npm" in c for c in calls)  # no rebuild
        mock_popen.assert_called_once()  # hub restarted
        out = capsys.readouterr().out
        assert "not responding" in out
        assert "4321" in (self.home / ".relaygent" / "hub.pid").read_text()

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


class TestLinuxSIGTERM:
    """Linux-specific: SIGTERM to old hub pid before rebuild."""

    @pytest.fixture(autouse=True)
    def setup(self, tmp_path, monkeypatch):
        monkeypatch.setattr("relay_hub.REPO_DIR", tmp_path)
        self.repo = tmp_path
        self.home = tmp_path / "home"; self.home.mkdir()
        (self.home / ".relaygent").mkdir()
        for d in ("data", "hub", "logs"): (tmp_path / d).mkdir()
        monkeypatch.setattr("relay_hub.Path.home", lambda: self.home)
        monkeypatch.setattr("relay_hub._hub_uses_launchagent", lambda: False)
        monkeypatch.setattr("relay_hub.time.sleep", lambda _: None)

    def _git_run(self, head="abc"):
        r = MagicMock(); r.stdout = head; r.returncode = 0; return r

    def _build_run(self, rc=0):
        r = MagicMock(); r.returncode = rc; r.stderr = b""; return r

    def test_sigterm_sent_to_old_pid(self):
        (self.home / ".relaygent" / "hub.pid").write_text("1234\n")
        proc = MagicMock(); proc.pid = 9999
        with patch("relay_hub.subprocess.run", side_effect=[self._git_run(), self._build_run()]), \
             patch("relay_hub.subprocess.Popen", return_value=proc), \
             patch("relay_hub.os.kill") as mock_kill:
            check_and_rebuild_hub()
        mock_kill.assert_any_call(1234, __import__("signal").SIGTERM)

    def test_handles_dead_process_gracefully(self):
        pid_file = self.home / ".relaygent" / "hub.pid"
        pid_file.write_text("9999\n")
        proc = MagicMock(); proc.pid = 1111
        with patch("relay_hub.subprocess.run", side_effect=[self._git_run(), self._build_run()]), \
             patch("relay_hub.subprocess.Popen", return_value=proc), \
             patch("relay_hub.os.kill", side_effect=ProcessLookupError):
            check_and_rebuild_hub()  # Should not raise
        assert "1111" in (self.home / ".relaygent" / "hub.pid").read_text()

    def test_restarts_hub_on_build_failure(self):
        """Hub should restart even on build failure to serve old build."""
        r = MagicMock(); r.returncode = 1; r.stderr = b"err"
        proc = MagicMock(); proc.pid = 2222
        with patch("relay_hub.subprocess.run", side_effect=[self._git_run(), r]), \
             patch("relay_hub.subprocess.Popen", return_value=proc) as mock_popen:
            check_and_rebuild_hub()
        mock_popen.assert_called_once()
        assert not (self.repo / "data" / "hub-build-commit").exists()


class TestRebuildLockAndCache:
    """The rebuild lock (serializing against the 5-min autobuild) and the
    .svelte-kit cache clear that together prevent the stale-manifest 500."""

    @pytest.fixture(autouse=True)
    def setup(self, tmp_path, monkeypatch):
        monkeypatch.setattr("relay_hub.REPO_DIR", tmp_path)
        self.repo = tmp_path
        self.home = tmp_path / "home"; self.home.mkdir()
        (self.home / ".relaygent").mkdir()
        for d in ("data", "hub", "logs"): (tmp_path / d).mkdir()
        monkeypatch.setattr("relay_hub.Path.home", lambda: self.home)
        monkeypatch.setattr("relay_hub._hub_uses_launchagent", lambda: False)
        monkeypatch.setattr("relay_hub.time.sleep", lambda _: None)
        self.lock = self.home / ".relaygent" / "hub-rebuild.lock"

    def _git_run(self, head="newhead"):
        r = MagicMock(); r.stdout = head; r.returncode = 0; return r

    def _build_run(self, rc=0):
        r = MagicMock(); r.returncode = rc; r.stderr = b""; return r

    def test_clears_svelte_kit_before_build(self):
        cache = self.repo / "hub" / ".svelte-kit"
        cache.mkdir(); (cache / "stale.js").write_text("old")
        proc = MagicMock(); proc.pid = 1
        with patch("relay_hub.subprocess.run", side_effect=[self._git_run(), self._build_run()]), \
             patch("relay_hub.subprocess.Popen", return_value=proc):
            check_and_rebuild_hub()
        assert not cache.exists()  # stale cache removed before the (mocked) build

    def test_releases_lock_after_successful_rebuild(self):
        proc = MagicMock(); proc.pid = 1
        with patch("relay_hub.subprocess.run", side_effect=[self._git_run(), self._build_run()]), \
             patch("relay_hub.subprocess.Popen", return_value=proc):
            check_and_rebuild_hub()
        assert not self.lock.exists()  # lock released in finally

    def test_releases_lock_even_on_build_failure(self):
        r = MagicMock(); r.returncode = 1; r.stderr = b"err"
        proc = MagicMock(); proc.pid = 1
        with patch("relay_hub.subprocess.run", side_effect=[self._git_run(), r]), \
             patch("relay_hub.subprocess.Popen", return_value=proc):
            check_and_rebuild_hub()
        assert not self.lock.exists()  # a failed build must not wedge future rebuilds

    def test_skips_rebuild_when_lock_held(self, capsys):
        # Simulate the autobuild holding the lock: a fresh (non-stale) lock dir.
        self.lock.mkdir()
        proc = MagicMock(); proc.pid = 7
        with patch("relay_hub.subprocess.run", return_value=self._git_run()) as mock_run, \
             patch("relay_hub._hub_healthy", return_value=False), \
             patch("relay_hub.subprocess.Popen", return_value=proc) as mock_popen:
            check_and_rebuild_hub()
        calls = [str(c) for c in mock_run.call_args_list]
        assert not any("npm" in c for c in calls)   # did NOT rebuild
        mock_popen.assert_called_once()              # but ensured the hub is running
        assert "already in progress" in capsys.readouterr().out
        assert self.lock.exists()                    # someone else's lock left intact

    def test_steals_stale_lock(self):
        import os, time as _t
        self.lock.mkdir()
        old = _t.time() - 600  # older than _LOCK_STALE_SECS
        os.utime(self.lock, (old, old))
        proc = MagicMock(); proc.pid = 1
        with patch("relay_hub.subprocess.run", side_effect=[self._git_run(), self._build_run()]) as mock_run, \
             patch("relay_hub.subprocess.Popen", return_value=proc):
            check_and_rebuild_hub()
        calls = [str(c) for c in mock_run.call_args_list]
        assert any("npm" in c for c in calls)  # stale lock stolen → rebuild proceeded
        assert (self.repo / "data" / "hub-build-commit").read_text().strip() == "newhead"
