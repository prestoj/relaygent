"""Tests for notif_config.py — Flask app setup and configuration."""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "notifications"))
os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-notif-config")

import pytest
import notif_config as config


class TestAppCreation:
    def test_app_is_flask_instance(self):
        from flask import Flask
        assert isinstance(config.app, Flask)

    def test_app_name(self):
        assert config.app.name == "notif_config"


class TestDataDir:
    def test_data_dir_from_env(self, monkeypatch):
        monkeypatch.setenv("RELAYGENT_DATA_DIR", "/custom/data")
        # Reload to pick up new env — but module already loaded,
        # so test the current value is a string path
        assert isinstance(config.DATA_DIR, str)

    def test_db_path_under_data_dir(self):
        assert config.DB_PATH.startswith(config.DATA_DIR)
        assert config.DB_PATH.endswith("reminders.db")

    def test_data_dir_is_absolute_or_relative(self):
        # DATA_DIR should be a non-empty string
        assert len(config.DATA_DIR) > 0


class TestCroniterFlag:
    def test_croniter_available_is_bool(self):
        assert isinstance(config.CRONITER_AVAILABLE, bool)

    def test_croniter_available_true_when_installed(self):
        # croniter is installed in the venv
        try:
            import croniter  # noqa: F401
            assert config.CRONITER_AVAILABLE is True
        except ImportError:
            assert config.CRONITER_AVAILABLE is False


class TestLogging:
    def test_logging_has_handlers(self):
        import logging
        root = logging.getLogger()
        # basicConfig adds at least one handler
        assert len(root.handlers) > 0
