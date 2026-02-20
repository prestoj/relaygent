"""Tests for relay_hub.py — hub build staleness check and auto-rebuild."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from relay_hub import check_and_rebuild_hub


def _make_git_result(head: str) -> MagicMock:
    r = MagicMock()
    r.stdout = head
    r.returncode = 0
    return r


class TestCheckAndRebuildHub:
    @pytest.fixture(autouse=True)
    def patch_repo_dir(self, tmp_path, monkeypatch):
        monkeypatch.setattr("relay_hub.REPO_DIR", tmp_path)
        self.repo = tmp_path
        (tmp_path / "data").mkdir()
        (tmp_path / "hub").mkdir()
        (tmp_path / "logs").mkdir()

    def _git_run(self, head="abc1234"):
        r = MagicMock(); r.stdout = head; r.returncode = 0; return r

    def _build_run(self, rc=0):
        r = MagicMock(); r.returncode = rc; r.stderr = b""; return r

    def test_skips_when_build_is_current(self, capsys):
        commit_file = self.repo / "data" / "hub-build-commit"
        commit_file.write_text("abc1234")
        with patch("relay_hub.subprocess.run", return_value=self._git_run("abc1234")) as mock_run:
            check_and_rebuild_hub()
        # Only git rev-parse should be called, not npm build
        calls = [str(c) for c in mock_run.call_args_list]
        assert not any("npm" in c for c in calls)
        assert "skipping" in capsys.readouterr().out

    def test_rebuilds_when_no_commit_file(self):
        proc = MagicMock(); proc.pid = 9999
        with patch("relay_hub.subprocess.run", side_effect=[
            self._git_run("newhead"), self._build_run(0)
        ]), patch("relay_hub.subprocess.Popen", return_value=proc):
            check_and_rebuild_hub()
        commit_file = self.repo / "data" / "hub-build-commit"
        assert commit_file.read_text().strip() == "newhead"

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
        commit_file = self.repo / "data" / "hub-build-commit"
        assert not commit_file.exists()
        assert "failed" in capsys.readouterr().out

    def test_reads_port_from_config(self, tmp_path):
        import json
        cfg_dir = tmp_path / ".relaygent"
        cfg_dir.mkdir()
        (cfg_dir / "config.json").write_text(json.dumps({
            "hub": {"port": 9090}, "paths": {"kb": str(tmp_path)}
        }))
        proc = MagicMock(); proc.pid = 1234
        with patch("relay_hub.Path.home", return_value=tmp_path), \
             patch("relay_hub.subprocess.run", side_effect=[
                 self._git_run("abc"), self._build_run(0)
             ]), patch("relay_hub.subprocess.Popen", return_value=proc) as mock_popen:
            check_and_rebuild_hub()
        env = mock_popen.call_args[1]["env"]
        assert env["PORT"] == "9090"

    def test_writes_pid_after_restart(self):
        proc = MagicMock(); proc.pid = 5678
        with patch("relay_hub.subprocess.run", side_effect=[
            self._git_run("abc"), self._build_run(0)
        ]), patch("relay_hub.subprocess.Popen", return_value=proc):
            check_and_rebuild_hub()
        pid_file = Path.home() / ".relaygent" / "hub.pid"
        assert "5678" in pid_file.read_text()
