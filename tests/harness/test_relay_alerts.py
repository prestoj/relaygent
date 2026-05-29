"""Tests for relay_alerts — Slack alert delivery must not fail silently."""
from __future__ import annotations

import json

import pytest

import relay_alerts


class _FakeResp:
    """Minimal context-manager response (Slack always returns HTTP 200)."""
    def __init__(self, payload):
        self._p = json.dumps(payload).encode()

    def read(self):
        return self._p

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _home_with_token(tmp_path, monkeypatch, channel="C0AG77MFLAU", token="xoxb-test"):
    slack = tmp_path / ".relaygent" / "slack"
    slack.mkdir(parents=True)
    (slack / "token.json").write_text(json.dumps({"token": token}))
    (tmp_path / ".relaygent" / "config.json").write_text(
        json.dumps({"slack": {"alert_channel": channel}})
    )
    monkeypatch.setattr(relay_alerts.Path, "home", staticmethod(lambda: tmp_path))
    return tmp_path


class TestSendSlackAlert:
    def test_logs_when_slack_returns_ok_false(self, tmp_path, monkeypatch):
        """Slack returns 200 with ok=false on channel_not_found/invalid_auth/etc.
        Regression: that was treated as success and the alert vanished silently."""
        _home_with_token(tmp_path, monkeypatch, channel="general")
        logs: list[str] = []
        monkeypatch.setattr(relay_alerts, "log", logs.append)
        monkeypatch.setattr(relay_alerts.urllib.request, "urlopen",
                            lambda *a, **k: _FakeResp({"ok": False, "error": "channel_not_found"}))
        relay_alerts.send_slack_alert("crash!")
        assert any("NOT delivered" in m and "channel_not_found" in m for m in logs)

    def test_silent_on_ok_true(self, tmp_path, monkeypatch):
        _home_with_token(tmp_path, monkeypatch)
        logs: list[str] = []
        monkeypatch.setattr(relay_alerts, "log", logs.append)
        monkeypatch.setattr(relay_alerts.urllib.request, "urlopen",
                            lambda *a, **k: _FakeResp({"ok": True}))
        relay_alerts.send_slack_alert("crash!")
        assert not any("NOT delivered" in m for m in logs)

    def test_skips_without_token(self, tmp_path, monkeypatch):
        slack = tmp_path / ".relaygent" / "slack"
        slack.mkdir(parents=True)
        (slack / "token.json").write_text(json.dumps({"token": ""}))
        monkeypatch.setattr(relay_alerts.Path, "home", staticmethod(lambda: tmp_path))
        called: list[int] = []
        monkeypatch.setattr(relay_alerts.urllib.request, "urlopen",
                            lambda *a, **k: called.append(1))
        relay_alerts.send_slack_alert("crash!")
        assert called == []  # no token → no API call attempted
