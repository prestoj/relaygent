"""Tests for slack_collector.py — token loading, ack, endpoint, API errors."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-slack-col")

import pytest
import notif_config as config
import db as notif_db
import slack_collector as sc


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "reminders.db"))
    notif_db.init_db()
    token_dir = tmp_path / ".relaygent" / "slack"
    token_dir.mkdir(parents=True)
    token_file = token_dir / "token.json"
    last_check = token_dir / ".last_check_ts"
    monkeypatch.setattr(sc, "SLACK_TOKEN_PATH", str(token_file))
    monkeypatch.setattr(sc, "_LAST_CHECK_FILE", str(last_check))
    monkeypatch.setattr(sc, "_SELF_UID", None)
    return token_file, last_check


@pytest.fixture()
def client():
    config.app.config["TESTING"] = True
    with config.app.test_client() as c:
        yield c


def _write_token(token_file, token="xoxp-test-token"):
    token_file.write_text(json.dumps({"access_token": token}))


class TestLoadToken:
    def test_returns_none_when_no_file(self):
        assert sc._load_token() is None

    def test_returns_token_from_file(self, _isolated):
        token_file, _ = _isolated
        _write_token(token_file, "xoxp-abc-123")
        assert sc._load_token() == "xoxp-abc-123"

    def test_returns_none_on_bad_json(self, _isolated):
        token_file, _ = _isolated
        token_file.write_text("not json")
        assert sc._load_token() is None

    def test_returns_none_on_missing_key(self, _isolated):
        token_file, _ = _isolated
        token_file.write_text(json.dumps({"other_key": "value"}))
        assert sc._load_token() is None


class TestAck:
    def test_writes_timestamp(self, _isolated):
        _, last_check = _isolated
        before = time.time()
        sc.ack()
        assert float(last_check.read_text().strip()) >= before

    def test_creates_parent_dirs(self, tmp_path, monkeypatch):
        deep_path = tmp_path / "deep" / "nested" / ".last_check_ts"
        monkeypatch.setattr(sc, "_LAST_CHECK_FILE", str(deep_path))
        sc.ack()
        assert float(deep_path.read_text().strip()) > 0


class TestCollectNoToken:
    def test_no_token_file_does_nothing(self):
        assert sc.collect([]) is None
        assert [] == []


class TestAckSlackEndpoint:
    def test_ack_endpoint_writes_timestamp(self, client, _isolated):
        _, last_check = _isolated
        before = time.time()
        resp = client.post("/notifications/ack-slack")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"
        assert float(last_check.read_text().strip()) >= before


class TestSlackApi:
    def test_rate_limit_retry(self):
        call_count = 0

        def fake_urlopen(req, timeout=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise sc.urllib.error.HTTPError(
                    req.full_url, 429, "Rate Limited", {"Retry-After": "0"}, None
                )
            resp = MagicMock()
            resp.read.return_value = json.dumps({"ok": True, "val": "ok"}).encode()
            resp.__enter__ = lambda s: s
            resp.__exit__ = lambda s, *a: None
            return resp

        with patch.object(sc.urllib.request, "urlopen", fake_urlopen):
            result = sc._slack_api("token", "auth.test")
            assert result is not None and result["val"] == "ok"
            assert call_count == 2

    def test_network_error_returns_none(self):
        with patch.object(sc.urllib.request, "urlopen",
                          side_effect=sc.urllib.error.URLError("refused")):
            assert sc._slack_api("token", "auth.test") is None
