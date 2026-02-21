"""Tests for linear_collector.py — Linear notification collector."""
from __future__ import annotations

import json
import os
import time
from unittest.mock import patch

os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-linear-col")

import pytest

import notif_config as config
import db as notif_db
import linear_collector as lc


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "reminders.db"))
    notif_db.init_db()
    key_file = tmp_path / "api-key"
    key_file.write_text("lin_api_test_key_123")
    last_check = tmp_path / ".last_check_ts"
    monkeypatch.setattr(lc, "_KEY_PATH", str(key_file))
    monkeypatch.setattr(lc, "_LAST_CHECK_FILE", str(last_check))
    return key_file, last_check


@pytest.fixture()
def client():
    config.app.config["TESTING"] = True
    with config.app.test_client() as c:
        yield c


def _fake_graphql_response(nodes):
    """Build a fake _graphql return value with notification nodes."""
    return {"notifications": {"nodes": nodes}}


def _make_notif(ntype="issueAssignedToYou", identifier="REL-1", title="Test issue",
                comment=None, notif_id="notif-1"):
    n = {
        "id": notif_id, "type": ntype, "readAt": None,
        "createdAt": "2026-02-21T04:00:00Z",
        "issue": {"identifier": identifier, "title": title,
                  "state": {"name": "Todo"}, "assignee": {"name": "agent-two"}},
    }
    if comment:
        n["comment"] = comment
    return n


class TestGetApiKey:
    def test_reads_key(self, _isolated):
        assert lc._get_api_key() == "lin_api_test_key_123"

    def test_returns_none_missing_file(self, _isolated, monkeypatch):
        monkeypatch.setattr(lc, "_KEY_PATH", "/nonexistent/path")
        assert lc._get_api_key() is None

    def test_returns_none_empty_file(self, _isolated):
        key_file, _ = _isolated
        key_file.write_text("")
        assert lc._get_api_key() is None


class TestLastCheck:
    def test_load_returns_none_when_no_file(self):
        assert lc._load_last_check() is None

    def test_save_and_load(self, _isolated):
        lc._save_last_check()
        result = lc._load_last_check()
        assert result is not None
        assert "T" in result  # ISO format

    def test_save_creates_dirs(self, tmp_path, monkeypatch):
        deep = tmp_path / "deep" / "nested" / ".last_check_ts"
        monkeypatch.setattr(lc, "_LAST_CHECK_FILE", str(deep))
        lc._save_last_check()
        assert deep.exists()


class TestFormatNotification:
    def test_basic_assignment(self):
        n = _make_notif("issueAssignedToYou", "REL-5", "Fix the bug")
        result = lc._format_notification(n)
        assert "[Linear]" in result
        assert "REL-5" in result
        assert "Fix the bug" in result
        assert "assigned to you" in result

    def test_comment_notification(self):
        n = _make_notif("issueNewComment", "REL-3", "Add feature",
                        comment={"body": "Looks good to me!", "createdAt": "2026-02-21",
                                 "user": {"name": "Alice"}})
        result = lc._format_notification(n)
        assert "new comment" in result
        assert "Alice" in result
        assert "Looks good" in result

    def test_unknown_type_uses_raw(self):
        n = _make_notif("someNewType", "REL-1", "Test")
        result = lc._format_notification(n)
        assert "someNewType" in result


class TestCollect:
    def test_skips_when_no_api_key(self, monkeypatch):
        monkeypatch.setattr(lc, "_KEY_PATH", "/nonexistent")
        notifications = []
        lc.collect(notifications)
        assert notifications == []

    @patch.object(lc, "_graphql")
    def test_no_notifications(self, mock_gql):
        mock_gql.return_value = _fake_graphql_response([])
        notifications = []
        lc.collect(notifications)
        assert notifications == []

    @patch.object(lc, "_graphql")
    def test_collects_assignment(self, mock_gql):
        mock_gql.return_value = _fake_graphql_response([
            _make_notif("issueAssignedToYou", "REL-10", "Deploy feature"),
        ])
        notifications = []
        lc.collect(notifications)
        assert len(notifications) == 1
        assert notifications[0]["source"] == "linear"
        assert notifications[0]["count"] == 1
        assert "REL-10" in notifications[0]["messages"][0]["content"]

    @patch.object(lc, "_graphql")
    def test_filters_non_wake_types(self, mock_gql):
        mock_gql.return_value = _fake_graphql_response([
            _make_notif("issueSubscription", "REL-1", "Ignored"),
        ])
        notifications = []
        lc.collect(notifications)
        assert notifications == []

    @patch.object(lc, "_graphql")
    def test_caps_at_10_messages(self, mock_gql):
        nodes = [_make_notif(notif_id=f"n-{i}") for i in range(15)]
        mock_gql.return_value = _fake_graphql_response(nodes)
        notifications = []
        lc.collect(notifications)
        assert len(notifications[0]["messages"]) == 10
        assert notifications[0]["count"] == 15

    @patch.object(lc, "_graphql")
    def test_saves_last_check(self, mock_gql):
        mock_gql.return_value = _fake_graphql_response([])
        lc.collect([])
        assert lc._load_last_check() is not None

    @patch.object(lc, "_graphql")
    def test_passes_last_check_as_variable(self, mock_gql, _isolated):
        _, last_check = _isolated
        last_check.write_text("2026-02-20T00:00:00Z")
        mock_gql.return_value = _fake_graphql_response([])
        lc.collect([])
        call_vars = mock_gql.call_args[0][1]
        assert call_vars.get("createdAfter") == "2026-02-20T00:00:00Z"

    @patch.object(lc, "_graphql")
    def test_api_failure_still_saves_last_check(self, mock_gql):
        mock_gql.return_value = None
        lc.collect([])
        assert lc._load_last_check() is not None


class TestAckEndpoint:
    @patch.object(lc, "_graphql")
    def test_ack_skips_no_key(self, mock_gql, client, monkeypatch):
        monkeypatch.setattr(lc, "_KEY_PATH", "/nonexistent")
        resp = client.post("/notifications/ack-linear")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "skipped"
        mock_gql.assert_not_called()

    @patch.object(lc, "_mark_read_ids")
    @patch.object(lc, "_graphql")
    def test_ack_marks_notifications_read(self, mock_gql, mock_mark, client):
        mock_gql.return_value = _fake_graphql_response([
            _make_notif(notif_id="n-abc"),
            _make_notif(notif_id="n-def"),
        ])
        resp = client.post("/notifications/ack-linear")
        assert resp.status_code == 200
        mock_mark.assert_called_once_with(["n-abc", "n-def"])
