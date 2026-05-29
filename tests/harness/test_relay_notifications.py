"""Tests for relay_notifications.py — notifications service health check + auto-start."""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from relay_notifications import ensure_notifications_running


class TestEnsureNotificationsRunning:
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path, monkeypatch):
        monkeypatch.setattr("relay_notifications.REPO_DIR", tmp_path)
        self.repo = tmp_path
        self.home = tmp_path / "home"
        self.home.mkdir()
        (self.home / ".relaygent").mkdir()
        for d in ("data", "logs", "notifications"):
            (tmp_path / d).mkdir()
        # A server.py must exist for the start path to fire.
        (tmp_path / "notifications" / "server.py").write_text("# stub\n")
        monkeypatch.setattr("relay_notifications.Path.home", lambda: self.home)
        # Default to Linux so the auto-start path is exercised; darwin test overrides.
        monkeypatch.setattr("relay_notifications.sys.platform", "linux")
        # Hermetic: a real relay run sets these in the environment; clear them so
        # the config/default branches are what's under test (not the leaked values).
        for var in ("RELAYGENT_NOTIFICATIONS_PORT", "RELAYGENT_KB_DIR", "RELAYGENT_DATA_DIR"):
            monkeypatch.delenv(var, raising=False)

    def test_skips_on_darwin(self, monkeypatch):
        monkeypatch.setattr("relay_notifications.sys.platform", "darwin")
        with patch("relay_notifications._is_healthy", return_value=False) as health, \
             patch("relay_notifications.subprocess.Popen") as popen:
            ensure_notifications_running()
        health.assert_not_called()
        popen.assert_not_called()

    def test_noop_when_healthy(self):
        with patch("relay_notifications._is_healthy", return_value=True), \
             patch("relay_notifications.subprocess.Popen") as popen:
            ensure_notifications_running()
        popen.assert_not_called()

    def test_starts_when_unhealthy(self):
        proc = MagicMock(); proc.pid = 4242
        with patch("relay_notifications._is_healthy", return_value=False), \
             patch("relay_notifications.subprocess.Popen", return_value=proc) as popen:
            ensure_notifications_running()
        popen.assert_called_once()
        # Detached so it survives relay restarts.
        assert popen.call_args[1]["start_new_session"] is True
        env = popen.call_args[1]["env"]
        assert env["RELAYGENT_NOTIFICATIONS_PORT"] == "8083"
        assert env["RELAYGENT_KB_DIR"] == str(self.repo / "knowledge" / "topics")
        assert env["RELAYGENT_DATA_DIR"] == str(self.repo / "data")
        # PID recorded for future management.
        assert "4242" in (self.home / ".relaygent" / "notifications.pid").read_text()

    def test_skips_when_server_missing(self):
        (self.repo / "notifications" / "server.py").unlink()
        with patch("relay_notifications._is_healthy", return_value=False), \
             patch("relay_notifications.subprocess.Popen") as popen:
            ensure_notifications_running()
        popen.assert_not_called()

    def test_reads_port_from_config(self):
        (self.home / ".relaygent" / "config.json").write_text(
            json.dumps({"services": {"notifications": {"port": 9099}}}))
        proc = MagicMock(); proc.pid = 1
        with patch("relay_notifications._is_healthy", return_value=False) as health, \
             patch("relay_notifications.subprocess.Popen", return_value=proc) as popen:
            ensure_notifications_running()
        health.assert_called_once_with("9099")
        assert popen.call_args[1]["env"]["RELAYGENT_NOTIFICATIONS_PORT"] == "9099"

    def test_uses_venv_python_when_present(self):
        venv = self.repo / "notifications" / ".venv" / "bin"
        venv.mkdir(parents=True)
        (venv / "python3").write_text("")
        proc = MagicMock(); proc.pid = 1
        with patch("relay_notifications._is_healthy", return_value=False), \
             patch("relay_notifications.subprocess.Popen", return_value=proc) as popen:
            ensure_notifications_running()
        assert popen.call_args[0][0][0] == str(venv / "python3")

    def test_handles_popen_oserror_gracefully(self):
        with patch("relay_notifications._is_healthy", return_value=False), \
             patch("relay_notifications.subprocess.Popen", side_effect=OSError("boom")):
            ensure_notifications_running()  # Should not raise
        assert not (self.home / ".relaygent" / "notifications.pid").exists()
