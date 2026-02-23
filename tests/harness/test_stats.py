"""Tests for harness/scripts/stats.py session statistics."""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "harness" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import stats


def _api_response(total=2, today_count=1, today_tokens=500000, today_min=30,
                  all_tokens=1500000, avg_min=45, first="2026-02-18 10:00",
                  sessions=None):
    return {
        "total": total,
        "today": {
            "count": today_count,
            "tokens": today_tokens,
            "durationMin": today_min,
            "sessions": sessions or [{"time": "2026-02-22 10:00", "durationMin": 30,
                                       "tokens": 500000, "tools": 50, "summary": "Build X"}],
        },
        "allTime": {
            "tokens": all_tokens,
            "avgDurationMin": avg_min,
            "firstSession": first,
        },
    }


class TestFormatters:
    def test_fmt_dur_minutes(self):
        assert stats.fmt_dur(45) == "45m"

    def test_fmt_dur_hours(self):
        assert stats.fmt_dur(125) == "2h 05m"

    def test_fmt_dur_zero(self):
        assert stats.fmt_dur(0) == "<1m"

    def test_fmt_dur_none(self):
        assert stats.fmt_dur(None) == "<1m"

    def test_fmt_tokens_millions(self):
        assert stats.fmt_tokens(2500000) == "2.5M"

    def test_fmt_tokens_thousands(self):
        assert stats.fmt_tokens(50000) == "50K"

    def test_fmt_tokens_small(self):
        assert stats.fmt_tokens(500) == "500"

    def test_fmt_tokens_zero(self):
        assert stats.fmt_tokens(0) == "0"


class TestFetchStats:
    def test_returns_none_on_connection_error(self):
        with patch.object(stats, "_hub_port", return_value=19999):
            assert stats._fetch_stats() is None

    def test_hub_port_default(self, tmp_path):
        cfg = tmp_path / "config.json"
        cfg.write_text('{"hub": {"port": 9999}}')
        with patch.dict("os.environ", {"RELAYGENT_CONFIG": str(cfg)}):
            # Re-import not needed — _hub_port reads env at call time
            assert stats._hub_port() == 9999

    def test_hub_port_fallback(self, tmp_path):
        cfg = tmp_path / "nonexistent.json"
        with patch.dict("os.environ", {"RELAYGENT_CONFIG": str(cfg)}):
            assert stats._hub_port() == 8080


class TestPrintStats:
    def test_no_data(self, capsys):
        with patch.object(stats, "_fetch_stats", return_value=None):
            stats.print_stats()
        out = capsys.readouterr().out
        assert "No session data" in out

    def test_empty_total(self, capsys):
        with patch.object(stats, "_fetch_stats", return_value={"total": 0}):
            stats.print_stats()
        out = capsys.readouterr().out
        assert "No session data" in out

    def test_with_sessions(self, tmp_path, capsys):
        status = tmp_path / "relay-status.json"
        status.write_text(json.dumps({"status": "working", "goal": "Test"}))
        data = _api_response(total=2, all_tokens=1500000, avg_min=52)
        with patch.object(stats, "_fetch_stats", return_value=data), \
             patch.object(stats, "STATUS_FILE", status), \
             patch.object(stats, "PCT_FILE", tmp_path / "no-pct"):
            stats.print_stats()
        out = capsys.readouterr().out
        assert "2 sessions" in out
        assert "1.5M" in out
        assert "52m" in out
        assert "working" in out

    def test_today_timeline(self, tmp_path, capsys):
        data = _api_response(today_count=2, sessions=[
            {"time": "2026-02-22 10:00", "durationMin": 30, "tokens": 500000,
             "tools": 50, "summary": "Build X"},
            {"time": "2026-02-22 12:00", "durationMin": 45, "tokens": 800000,
             "tools": 30, "summary": None},
        ])
        with patch.object(stats, "_fetch_stats", return_value=data), \
             patch.object(stats, "STATUS_FILE", tmp_path / "no-status"), \
             patch.object(stats, "PCT_FILE", tmp_path / "no-pct"):
            stats.print_stats()
        out = capsys.readouterr().out
        assert "Sessions: 2" in out
        assert "Build X" in out
