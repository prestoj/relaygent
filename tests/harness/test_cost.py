"""Tests for relaygent cost command."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

# Add scripts dir to path for direct imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "harness" / "scripts"))
from cost import calc_cost, fmt_tokens, model_tier, parse_usage


def _make_jsonl(tmpdir: Path, model: str = "claude-opus-4-6", input_t: int = 100,
                cache_write: int = 5000, cache_read: int = 50000, output_t: int = 200) -> str:
    """Create a minimal JSONL session file with known token usage."""
    fp = tmpdir / "test-session.jsonl"
    entries = [
        {"type": "system", "timestamp": "2026-02-23T10:00:00Z"},
        {"type": "assistant", "timestamp": "2026-02-23T10:01:00Z", "message": {
            "model": model, "content": [{"type": "text", "text": "Hello"}],
            "usage": {"input_tokens": input_t, "cache_creation_input_tokens": cache_write,
                      "cache_read_input_tokens": cache_read, "output_tokens": output_t}}},
        {"type": "assistant", "timestamp": "2026-02-23T10:02:00Z", "message": {
            "model": model, "content": [{"type": "text", "text": "Done"}],
            "usage": {"input_tokens": input_t, "cache_creation_input_tokens": cache_write,
                      "cache_read_input_tokens": cache_read, "output_tokens": output_t}}},
    ]
    fp.write_text("\n".join(json.dumps(e) for e in entries))
    return str(fp)


class TestModelTier:
    def test_opus(self):
        assert model_tier("claude-opus-4-6") == "opus"

    def test_sonnet(self):
        assert model_tier("claude-sonnet-4-6") == "sonnet"

    def test_haiku(self):
        assert model_tier("claude-haiku-4-5-20251001") == "haiku"

    def test_none_defaults_sonnet(self):
        assert model_tier(None) == "sonnet"

    def test_unknown_defaults_sonnet(self):
        assert model_tier("some-future-model") == "sonnet"


class TestFmtTokens:
    def test_millions(self):
        assert fmt_tokens(1_500_000) == "1.5M"

    def test_thousands(self):
        assert fmt_tokens(45_000) == "45K"

    def test_small(self):
        assert fmt_tokens(500) == "500"


class TestParseUsage:
    def test_basic_parse(self, tmp_path):
        fp = _make_jsonl(tmp_path)
        result = parse_usage(fp)
        totals = result["totals"]
        assert "opus" in totals
        # Two turns, each with 100 input tokens
        assert totals["opus"]["input"] == 200
        assert totals["opus"]["cache_write"] == 10000
        assert totals["opus"]["cache_read"] == 100000
        assert totals["opus"]["output"] == 400

    def test_timestamps(self, tmp_path):
        fp = _make_jsonl(tmp_path)
        result = parse_usage(fp)
        assert result["start"] == "2026-02-23T10:00:00Z"
        assert result["end"] == "2026-02-23T10:02:00Z"

    def test_multi_model(self, tmp_path):
        fp = tmp_path / "multi.jsonl"
        entries = [
            {"type": "assistant", "timestamp": "2026-02-23T10:00:00Z", "message": {
                "model": "claude-opus-4-6", "content": [],
                "usage": {"input_tokens": 100, "cache_creation_input_tokens": 0,
                          "cache_read_input_tokens": 0, "output_tokens": 50}}},
            {"type": "assistant", "timestamp": "2026-02-23T10:01:00Z", "message": {
                "model": "claude-sonnet-4-6", "content": [],
                "usage": {"input_tokens": 200, "cache_creation_input_tokens": 0,
                          "cache_read_input_tokens": 0, "output_tokens": 100}}},
        ]
        fp.write_text("\n".join(json.dumps(e) for e in entries))
        result = parse_usage(str(fp))
        assert "opus" in result["totals"]
        assert "sonnet" in result["totals"]
        assert result["totals"]["opus"]["input"] == 100
        assert result["totals"]["sonnet"]["input"] == 200

    def test_empty_file(self, tmp_path):
        fp = tmp_path / "empty.jsonl"
        fp.write_text("")
        result = parse_usage(str(fp))
        assert result["totals"] == {}


class TestCalcCost:
    def test_opus_cost(self):
        totals = {"opus": {"input": 1_000_000, "cache_write": 0, "cache_read": 0, "output": 0}}
        # $15 per million input tokens
        assert calc_cost(totals) == 15.0

    def test_opus_output(self):
        totals = {"opus": {"input": 0, "cache_write": 0, "cache_read": 0, "output": 1_000_000}}
        assert calc_cost(totals) == 75.0

    def test_opus_cache_write(self):
        totals = {"opus": {"input": 0, "cache_write": 1_000_000, "cache_read": 0, "output": 0}}
        assert calc_cost(totals) == 18.75

    def test_opus_cache_read(self):
        totals = {"opus": {"input": 0, "cache_write": 0, "cache_read": 1_000_000, "output": 0}}
        assert calc_cost(totals) == 1.50

    def test_sonnet_input(self):
        totals = {"sonnet": {"input": 1_000_000, "cache_write": 0, "cache_read": 0, "output": 0}}
        assert calc_cost(totals) == 3.0

    def test_mixed_tiers(self):
        totals = {
            "opus": {"input": 1_000_000, "cache_write": 0, "cache_read": 0, "output": 0},
            "sonnet": {"input": 1_000_000, "cache_write": 0, "cache_read": 0, "output": 0},
        }
        assert calc_cost(totals) == 18.0  # 15 + 3

    def test_zero_tokens(self):
        assert calc_cost({}) == 0.0


class TestCLI:
    def test_help(self):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parent.parent.parent / "harness" / "scripts" / "cost.py"), "--help"],
            capture_output=True, text=True)
        assert result.returncode == 0
        assert "Usage:" in result.stdout

    def test_no_sessions(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path))
        (tmp_path / ".claude" / "projects").mkdir(parents=True)
        (tmp_path / ".relaygent").mkdir()
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parent.parent.parent / "harness" / "scripts" / "cost.py"),
             "-d", "1"],
            capture_output=True, text=True, env={**os.environ, "HOME": str(tmp_path)})
        assert "No sessions" in result.stdout
