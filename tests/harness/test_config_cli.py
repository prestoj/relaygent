"""Tests for harness/scripts/config.py (CLI config command)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent.parent / "harness" / "scripts" / "config.py"


def run_config(config_path: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), config_path, *args],
        capture_output=True, text=True, timeout=10)


def make_config(tmp_path: Path, data: dict) -> Path:
    p = tmp_path / "config.json"
    p.write_text(json.dumps(data, indent=2))
    return p


class TestList:
    def test_shows_all_keys(self, tmp_path):
        cfg = make_config(tmp_path, {"agent": {"name": "test"}, "hub": {"port": 8080}})
        r = run_config(str(cfg))
        assert r.returncode == 0
        assert "agent:" in r.stdout
        assert "name: test" in r.stdout
        assert "port: 8080" in r.stdout

    def test_masks_password(self, tmp_path):
        cfg = make_config(tmp_path, {"hub": {"passwordHash": "abcd1234efgh5678"}})
        r = run_config(str(cfg))
        assert "abcd1234efgh5678" not in r.stdout
        assert "abcd...5678" in r.stdout

    def test_masks_secret(self, tmp_path):
        cfg = make_config(tmp_path, {"hub": {"sessionSecret": "longsecretsecret"}})
        r = run_config(str(cfg))
        assert "longsecretsecret" not in r.stdout
        assert "long...cret" in r.stdout

    def test_shows_arrays(self, tmp_path):
        cfg = make_config(tmp_path, {"fleet": [{"name": "a", "url": "http://a"}]})
        r = run_config(str(cfg))
        assert "fleet:" in r.stdout
        assert "- " in r.stdout


class TestGet:
    def test_scalar(self, tmp_path):
        cfg = make_config(tmp_path, {"hub": {"port": 8080}})
        r = run_config(str(cfg), "get", "hub.port")
        assert r.stdout.strip() == "8080"

    def test_string(self, tmp_path):
        cfg = make_config(tmp_path, {"agent": {"name": "test-agent"}})
        r = run_config(str(cfg), "get", "agent.name")
        assert r.stdout.strip() == "test-agent"

    def test_nested_dict(self, tmp_path):
        cfg = make_config(tmp_path, {"paths": {"repo": "/a", "kb": "/b"}})
        r = run_config(str(cfg), "get", "paths")
        assert "repo: /a" in r.stdout
        assert "kb: /b" in r.stdout

    def test_missing_key(self, tmp_path):
        cfg = make_config(tmp_path, {"hub": {"port": 8080}})
        r = run_config(str(cfg), "get", "nonexistent")
        assert r.returncode == 1
        assert "Key not found" in r.stderr

    def test_shorthand(self, tmp_path):
        cfg = make_config(tmp_path, {"hub": {"port": 9090}})
        r = run_config(str(cfg), "hub.port")
        assert r.stdout.strip() == "9090"

    def test_boolean(self, tmp_path):
        cfg = make_config(tmp_path, {"docker": True})
        r = run_config(str(cfg), "get", "docker")
        assert r.stdout.strip() == "true"


class TestSet:
    def test_set_string(self, tmp_path):
        cfg = make_config(tmp_path, {"agent": {"name": "old"}})
        r = run_config(str(cfg), "set", "agent.name", "new")
        assert r.returncode == 0
        data = json.loads(cfg.read_text())
        assert data["agent"]["name"] == "new"

    def test_set_number(self, tmp_path):
        cfg = make_config(tmp_path, {"hub": {"port": 8080}})
        r = run_config(str(cfg), "set", "hub.port", "9090")
        assert r.returncode == 0
        data = json.loads(cfg.read_text())
        assert data["hub"]["port"] == 9090

    def test_set_boolean(self, tmp_path):
        cfg = make_config(tmp_path, {})
        r = run_config(str(cfg), "set", "docker", "true")
        assert r.returncode == 0
        data = json.loads(cfg.read_text())
        assert data["docker"] is True

    def test_set_creates_nested(self, tmp_path):
        cfg = make_config(tmp_path, {})
        r = run_config(str(cfg), "set", "a.b.c", "deep")
        assert r.returncode == 0
        data = json.loads(cfg.read_text())
        assert data["a"]["b"]["c"] == "deep"

    def test_creates_backup(self, tmp_path):
        cfg = make_config(tmp_path, {"x": 1})
        run_config(str(cfg), "set", "x", "2")
        bak = tmp_path / "config.json.bak"
        assert bak.exists()
        assert json.loads(bak.read_text())["x"] == 1


class TestUnset:
    def test_removes_key(self, tmp_path):
        cfg = make_config(tmp_path, {"a": 1, "b": 2})
        r = run_config(str(cfg), "unset", "a")
        assert r.returncode == 0
        data = json.loads(cfg.read_text())
        assert "a" not in data
        assert data["b"] == 2

    def test_removes_nested(self, tmp_path):
        cfg = make_config(tmp_path, {"hub": {"port": 8080, "tls": {}}})
        r = run_config(str(cfg), "unset", "hub.tls")
        assert r.returncode == 0
        data = json.loads(cfg.read_text())
        assert "tls" not in data["hub"]
        assert data["hub"]["port"] == 8080

    def test_missing_key_fails(self, tmp_path):
        cfg = make_config(tmp_path, {"a": 1})
        r = run_config(str(cfg), "unset", "nonexistent")
        assert r.returncode == 1


class TestPath:
    def test_prints_path(self, tmp_path):
        r = run_config("/some/path/config.json", "path")
        assert r.stdout.strip() == "/some/path/config.json"
        assert r.returncode == 0


class TestMissingConfig:
    def test_missing_file(self, tmp_path):
        r = run_config(str(tmp_path / "nope.json"))
        assert r.returncode == 1
        assert "Config not found" in r.stderr
