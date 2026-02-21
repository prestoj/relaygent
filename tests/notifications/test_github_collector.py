"""Tests for github_collector.py — GitHub notification collector."""
from __future__ import annotations

import json
import os
import subprocess
from unittest.mock import patch, MagicMock

os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-gh-col")

import pytest

import notif_config as config
import db as notif_db
import github_collector as gc


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "reminders.db"))
    notif_db.init_db()
    last_check = tmp_path / ".last_check_ts"
    monkeypatch.setattr(gc, "_LAST_CHECK_FILE", str(last_check))
    return last_check


@pytest.fixture()
def client():
    config.app.config["TESTING"] = True
    with config.app.test_client() as c:
        yield c


def _make_notif(reason="review_requested", ntype="PullRequest",
                repo="prestoj/relaygent", title="Fix tests",
                unread=True, updated_at="2026-02-21T04:00:00Z"):
    return {
        "reason": reason,
        "unread": unread,
        "updated_at": updated_at,
        "subject": {"title": title, "type": ntype},
        "repository": {"full_name": repo},
    }


class TestGhAvailable:
    @patch("github_collector.subprocess.run")
    def test_returns_true_when_auth_ok(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        assert gc._gh_available() is True

    @patch("github_collector.subprocess.run")
    def test_returns_false_when_auth_fails(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1)
        assert gc._gh_available() is False

    @patch("github_collector.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_false_when_gh_missing(self, mock_run):
        assert gc._gh_available() is False

    @patch("github_collector.subprocess.run", side_effect=subprocess.TimeoutExpired("gh", 5))
    def test_returns_false_on_timeout(self, mock_run):
        assert gc._gh_available() is False


class TestGhApi:
    @patch("github_collector.subprocess.run")
    def test_returns_parsed_json(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0, stdout='[{"id": 1}]',
        )
        result = gc._gh_api("notifications")
        assert result == [{"id": 1}]

    @patch("github_collector.subprocess.run")
    def test_passes_params(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0, stdout="[]",
        )
        gc._gh_api("notifications", {"since": "2026-01-01"})
        cmd = mock_run.call_args[0][0]
        assert "-f" in cmd
        assert "since=2026-01-01" in cmd

    @patch("github_collector.subprocess.run")
    def test_returns_none_on_failure(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=1, stderr="not found",
        )
        assert gc._gh_api("notifications") is None

    @patch("github_collector.subprocess.run")
    def test_returns_none_on_bad_json(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0, stdout="not json",
        )
        assert gc._gh_api("notifications") is None

    @patch("github_collector.subprocess.run", side_effect=subprocess.TimeoutExpired("gh", 10))
    def test_returns_none_on_timeout(self, mock_run):
        assert gc._gh_api("notifications") is None


class TestLastCheck:
    def test_load_returns_none_when_no_file(self):
        assert gc._load_last_check() is None

    def test_save_and_load(self):
        gc._save_last_check()
        result = gc._load_last_check()
        assert result is not None
        assert "T" in result  # ISO format

    def test_save_creates_dirs(self, tmp_path, monkeypatch):
        deep = tmp_path / "deep" / "nested" / ".last_check_ts"
        monkeypatch.setattr(gc, "_LAST_CHECK_FILE", str(deep))
        gc._save_last_check()
        assert deep.exists()

    def test_load_returns_none_on_empty_file(self, _isolated):
        _isolated.write_text("")
        assert gc._load_last_check() is None


class TestFormatNotification:
    def test_pr_review_requested(self):
        n = _make_notif("review_requested", "PullRequest", "prestoj/relaygent", "Add tests")
        result = gc._format_notification(n)
        assert "[PR]" in result
        assert "prestoj/relaygent" in result
        assert "Add tests" in result
        assert "review requested" in result

    def test_issue_comment(self):
        n = _make_notif("comment", "Issue", "org/repo", "Bug report")
        result = gc._format_notification(n)
        assert "[issue]" in result
        assert "new comment" in result

    def test_mention(self):
        n = _make_notif("mention", "PullRequest", "org/repo", "Feature PR")
        result = gc._format_notification(n)
        assert "you were mentioned" in result

    def test_assign(self):
        n = _make_notif("assign", "Issue", "org/repo", "New task")
        result = gc._format_notification(n)
        assert "assigned to you" in result

    def test_unknown_type_uses_raw(self):
        n = _make_notif("review_requested", "Discussion", "org/repo", "Thread")
        result = gc._format_notification(n)
        assert "Discussion" in result

    def test_unknown_reason_uses_raw(self):
        n = _make_notif("team_mention", "PullRequest", "org/repo", "PR")
        result = gc._format_notification(n)
        assert "team_mention" in result


class TestCollect:
    @patch.object(gc, "_gh_available", return_value=False)
    def test_skips_when_gh_unavailable(self, mock_avail):
        notifications = []
        gc.collect(notifications)
        assert notifications == []

    @patch.object(gc, "_gh_api", return_value=[])
    @patch.object(gc, "_gh_available", return_value=True)
    def test_no_notifications(self, mock_avail, mock_api):
        notifications = []
        gc.collect(notifications)
        assert notifications == []

    @patch.object(gc, "_gh_api", return_value=None)
    @patch.object(gc, "_gh_available", return_value=True)
    def test_api_failure_still_saves_last_check(self, mock_avail, mock_api):
        gc.collect([])
        assert gc._load_last_check() is not None

    @patch.object(gc, "_gh_api")
    @patch.object(gc, "_gh_available", return_value=True)
    def test_collects_review_requested(self, mock_avail, mock_api):
        mock_api.return_value = [
            _make_notif("review_requested", "PullRequest", "org/repo", "PR title"),
        ]
        notifications = []
        gc.collect(notifications)
        assert len(notifications) == 1
        assert notifications[0]["source"] == "github"
        assert notifications[0]["count"] == 1
        assert "PR title" in notifications[0]["messages"][0]["content"]

    @patch.object(gc, "_gh_api")
    @patch.object(gc, "_gh_available", return_value=True)
    def test_filters_non_wake_reasons(self, mock_avail, mock_api):
        mock_api.return_value = [
            _make_notif("subscribed", "PullRequest", "org/repo", "Ignored"),
        ]
        notifications = []
        gc.collect(notifications)
        assert notifications == []

    @patch.object(gc, "_gh_api")
    @patch.object(gc, "_gh_available", return_value=True)
    def test_filters_read_notifications(self, mock_avail, mock_api):
        mock_api.return_value = [
            _make_notif("review_requested", unread=False),
        ]
        notifications = []
        gc.collect(notifications)
        assert notifications == []

    @patch.object(gc, "_gh_api")
    @patch.object(gc, "_gh_available", return_value=True)
    def test_caps_at_10_messages(self, mock_avail, mock_api):
        mock_api.return_value = [_make_notif() for _ in range(15)]
        notifications = []
        gc.collect(notifications)
        assert len(notifications[0]["messages"]) == 10
        assert notifications[0]["count"] == 15

    @patch.object(gc, "_gh_api")
    @patch.object(gc, "_gh_available", return_value=True)
    def test_passes_since_param(self, mock_avail, mock_api, _isolated):
        _isolated.write_text("2026-02-20T00:00:00Z")
        mock_api.return_value = []
        gc.collect([])
        call_params = mock_api.call_args[0][1]
        assert call_params.get("since") == "2026-02-20T00:00:00Z"

    @patch.object(gc, "_gh_api")
    @patch.object(gc, "_gh_available", return_value=True)
    def test_saves_last_check_after_collect(self, mock_avail, mock_api):
        mock_api.return_value = [_make_notif()]
        gc.collect([])
        assert gc._load_last_check() is not None


class TestAckEndpoint:
    @patch("github_collector.subprocess.run")
    def test_ack_calls_gh_api(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        gc.ack()
        cmd = mock_run.call_args[0][0]
        assert "notifications" in cmd
        assert "-X" in cmd
        assert "PUT" in cmd

    @patch("github_collector.subprocess.run", side_effect=FileNotFoundError)
    def test_ack_handles_missing_gh(self, mock_run):
        gc.ack()  # Should not raise

    @patch("github_collector.subprocess.run")
    def test_ack_endpoint(self, mock_run, client):
        mock_run.return_value = MagicMock(returncode=0)
        resp = client.post("/notifications/ack-github")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"
