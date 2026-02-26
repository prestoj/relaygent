"""Tests for automatic disk cleanup at startup."""
from collections import namedtuple
from unittest.mock import patch

import relay_utils

DiskUsage = namedtuple("DiskUsage", ["total", "used", "free"])


class TestCheckDiskAndCleanup:
    def test_skips_when_disk_ok(self):
        """No cleanup when disk is under 90%."""
        with patch("shutil.disk_usage", return_value=DiskUsage(100, 80, 20)), \
             patch("subprocess.run") as mock_run:
            relay_utils.check_disk_and_cleanup()
        mock_run.assert_not_called()

    def test_runs_cleanup_when_disk_full(self, tmp_path, monkeypatch):
        """Runs cleanup.sh when disk > 90%."""
        fake_script = tmp_path / "cleanup.sh"
        fake_script.write_text("#!/bin/bash\necho 'Freed ~100MB'")
        monkeypatch.setattr(relay_utils, "SCRIPT_DIR", tmp_path.parent)
        (tmp_path.parent / "scripts").mkdir(exist_ok=True)
        real_script = tmp_path.parent / "scripts" / "cleanup.sh"
        real_script.write_text("#!/bin/bash\necho 'Freed ~100MB'")

        with patch("shutil.disk_usage", return_value=DiskUsage(100, 95, 5)), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = type("R", (), {"stdout": "Freed ~100MB\n", "returncode": 0})()
            relay_utils.check_disk_and_cleanup()
        mock_run.assert_called_once()
        args = mock_run.call_args
        assert "cleanup.sh" in str(args)

    def test_handles_missing_script(self, tmp_path, monkeypatch):
        """Gracefully handles missing cleanup.sh."""
        monkeypatch.setattr(relay_utils, "SCRIPT_DIR", tmp_path)
        with patch("shutil.disk_usage", return_value=DiskUsage(100, 95, 5)):
            # Should not raise
            relay_utils.check_disk_and_cleanup()

    def test_handles_cleanup_failure(self, tmp_path, monkeypatch):
        """Gracefully handles cleanup.sh errors."""
        scripts_dir = tmp_path / "scripts"
        scripts_dir.mkdir()
        (scripts_dir / "cleanup.sh").write_text("#!/bin/bash\nexit 1")
        monkeypatch.setattr(relay_utils, "SCRIPT_DIR", tmp_path)

        with patch("shutil.disk_usage", return_value=DiskUsage(100, 95, 5)), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = type("R", (), {"stdout": "", "returncode": 1})()
            relay_utils.check_disk_and_cleanup()  # Should not raise
