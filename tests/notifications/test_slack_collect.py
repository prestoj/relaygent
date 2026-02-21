"""Tests for slack_collector.collect() — message filtering and aggregation."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "notifications"))
os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-slack-col2")

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
    token_file.write_text(json.dumps({"access_token": "xoxp-test"}))
    return token_file, last_check


def _api(responses):
    """Mock _slack_api returning canned responses keyed by method."""
    def fake(token, method, params=None, _retries=2):
        return responses.get(method)
    return fake


BASE = {
    "auth.test": {"ok": True, "user_id": "U_SELF"},
    "conversations.list": {"ok": True, "channels": [{"id": "C1", "name": "general"}]},
}


def _hist(*msgs):
    return {"ok": True, "messages": list(msgs)}


def _msg(user, text, ts, subtype=None):
    m = {"user": user, "text": text, "ts": ts}
    if subtype:
        m["subtype"] = subtype
    return m


class TestCollectBasic:
    def test_no_channels_returns_nothing(self):
        with patch.object(sc, "_slack_api", _api({
            **BASE,
            "conversations.list": {"ok": True, "channels": []},
        })):
            notifs = []
            sc.collect(notifs)
            assert notifs == []

    def test_collects_unread_messages(self):
        with patch.object(sc, "_slack_api", _api({
            **BASE,
            "conversations.history": _hist(_msg("U_OTHER", "hello", "100.000000")),
        })):
            notifs = []
            sc.collect(notifs)
            assert len(notifs) == 1
            assert notifs[0]["type"] == "message"
            assert notifs[0]["source"] == "slack"
            assert notifs[0]["count"] == 1
            assert notifs[0]["channels"][0]["name"] == "general"

    def test_api_failure_returns_nothing(self):
        with patch.object(sc, "_slack_api", return_value=None):
            notifs = []
            sc.collect(notifs)
            assert notifs == []


class TestCollectFiltering:
    def test_filters_own_messages(self):
        with patch.object(sc, "_slack_api", _api({
            **BASE,
            "conversations.history": _hist(_msg("U_SELF", "mine", "100.000000")),
        })):
            notifs = []
            sc.collect(notifs)
            assert notifs == []

    def test_filters_channel_join_subtype(self):
        with patch.object(sc, "_slack_api", _api({
            **BASE,
            "conversations.history": _hist(
                _msg("U_OTHER", "joined", "100.000000", subtype="channel_join")
            ),
        })):
            notifs = []
            sc.collect(notifs)
            assert notifs == []

    def test_respects_last_check_timestamp(self, _isolated):
        _, last_check = _isolated
        last_check.write_text("150.000000")

        def fake(token, method, params=None, _retries=2):
            if method == "auth.test":
                return {"ok": True, "user_id": "U_SELF"}
            if method == "conversations.list":
                return {"ok": True, "channels": [{"id": "C1", "name": "g"}]}
            if method == "conversations.history":
                assert params["oldest"] == "150.000000"
                return _hist(_msg("U_A", "new", "200.000000"))
            return None

        with patch.object(sc, "_slack_api", fake):
            notifs = []
            sc.collect(notifs)
            assert notifs[0]["count"] == 1


class TestCollectAggregation:
    def test_multiple_channels_aggregated(self):
        def fake(token, method, params=None, _retries=2):
            if method == "auth.test":
                return {"ok": True, "user_id": "U_SELF"}
            if method == "conversations.list":
                return {"ok": True, "channels": [
                    {"id": "C1", "name": "general"},
                    {"id": "C2", "name": "random"},
                    {"id": "C3", "name": "quiet"},
                ]}
            if method == "conversations.history":
                ch = params["channel"]
                if ch == "C1":
                    return _hist(_msg("U_A", "hi", "10.000000"))
                if ch == "C2":
                    return _hist(_msg("U_B", "hey", "20.000000"),
                                 _msg("U_C", "yo", "30.000000"))
                return {"ok": True, "messages": []}
            return None

        with patch.object(sc, "_slack_api", fake):
            notifs = []
            sc.collect(notifs)
            assert notifs[0]["count"] == 3
            assert len(notifs[0]["channels"]) == 2  # C3 excluded (empty)

    def test_previews_chronological_order(self):
        with patch.object(sc, "_slack_api", _api({
            **BASE,
            "conversations.history": _hist(
                _msg("U_A", "third", "30.000000"),
                _msg("U_A", "second", "20.000000"),
                _msg("U_A", "first", "10.000000"),
            ),
        })):
            notifs = []
            sc.collect(notifs)
            msgs = notifs[0]["channels"][0]["messages"]
            assert [m["text"] for m in msgs] == ["first", "second", "third"]

    def test_previews_capped_at_5(self):
        with patch.object(sc, "_slack_api", _api({
            **BASE,
            "conversations.history": {"ok": True, "messages": [
                _msg("U_A", f"m{i}", f"{10 - i}.000000") for i in range(10)
            ]},
        })):
            notifs = []
            sc.collect(notifs)
            assert len(notifs[0]["channels"][0]["messages"]) == 5
