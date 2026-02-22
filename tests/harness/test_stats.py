"""Tests for harness/scripts/stats.py session statistics."""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "harness" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import stats


def _make_cache(tmp_path, entries):
    """Create a session-stats-cache.json with given session entries."""
    cache = {}
    for i, e in enumerate(entries):
        path = f"/fake/project/{i}.jsonl"
        cache[path] = {"mtimeMs": 1000, "size": 5000, "stats": e}
    cache_file = tmp_path / "session-stats-cache.json"
    cache_file.write_text(json.dumps(cache))
    return cache_file


def _session(start="2026-02-20T10:00:00Z", dur=30, tokens=500000, output=1000,
             tools_total=50, tools=None, turns=10, goal=None):
    return {
        "start": start, "durationMin": dur, "totalTokens": tokens,
        "outputTokens": output, "toolCalls": tools_total,
        "tools": tools or {"Bash": 20, "Read": 15, "Edit": 15},
        "turns": turns, "handoffGoal": goal, "textBlocks": 5,
    }


class TestLoadSessions:
    def test_loads_from_cache(self, tmp_path):
        cache = _make_cache(tmp_path, [_session(), _session(start="2026-02-20T11:00:00Z")])
        with patch.object(stats, "CACHE_FILE", cache):
            sessions = stats.load_sessions()
        assert len(sessions) == 2
        assert sessions[0]["start"] < sessions[1]["start"]

    def test_empty_cache(self, tmp_path):
        cache = tmp_path / "session-stats-cache.json"
        cache.write_text("{}")
        with patch.object(stats, "CACHE_FILE", cache):
            assert stats.load_sessions() == []

    def test_missing_cache(self, tmp_path):
        cache = tmp_path / "nonexistent.json"
        with patch.object(stats, "CACHE_FILE", cache):
            assert stats.load_sessions() == []

    def test_corrupt_cache(self, tmp_path):
        cache = tmp_path / "session-stats-cache.json"
        cache.write_text("not json")
        with patch.object(stats, "CACHE_FILE", cache):
            assert stats.load_sessions() == []

    def test_skips_entries_without_start(self, tmp_path):
        cache = _make_cache(tmp_path, [_session(), {"durationMin": 5}])
        with patch.object(stats, "CACHE_FILE", cache):
            assert len(stats.load_sessions()) == 1

    def test_session_fields(self, tmp_path):
        cache = _make_cache(tmp_path, [_session(tokens=1000000, goal="Build X")])
        with patch.object(stats, "CACHE_FILE", cache):
            s = stats.load_sessions()[0]
        assert s["tokens"] == 1000000
        assert s["goal"] == "Build X"
        assert s["dur_min"] == 30
        assert s["tools_total"] == 50


class TestFormatters:
    def test_fmt_dur_minutes(self):
        assert stats.fmt_dur(45) == "45m"

    def test_fmt_dur_hours(self):
        assert stats.fmt_dur(125) == "2h 05m"

    def test_fmt_dur_zero(self):
        assert stats.fmt_dur(0) == "<1m"

    def test_fmt_tokens_millions(self):
        assert stats.fmt_tokens(2500000) == "2.5M"

    def test_fmt_tokens_thousands(self):
        assert stats.fmt_tokens(50000) == "50K"

    def test_fmt_tokens_small(self):
        assert stats.fmt_tokens(500) == "500"


class TestPrintStats:
    def test_no_data(self, tmp_path, capsys):
        cache = tmp_path / "nonexistent.json"
        with patch.object(stats, "CACHE_FILE", cache):
            stats.print_stats()
        out = capsys.readouterr().out
        assert "No session data" in out

    def test_with_sessions(self, tmp_path, capsys):
        cache = _make_cache(tmp_path, [
            _session(start="2026-02-20T10:00:00Z", dur=60, tokens=1000000),
            _session(start="2026-02-20T12:00:00Z", dur=45, tokens=500000),
        ])
        status = tmp_path / "relay-status.json"
        status.write_text(json.dumps({"status": "working", "goal": "Test"}))
        with patch.object(stats, "CACHE_FILE", cache), \
             patch.object(stats, "STATUS_FILE", status), \
             patch.object(stats, "PCT_FILE", tmp_path / "no-pct"):
            stats.print_stats()
        out = capsys.readouterr().out
        assert "2 sessions" in out
        assert "1h 45m" in out  # total run time
        assert "1.5M" in out  # total tokens
