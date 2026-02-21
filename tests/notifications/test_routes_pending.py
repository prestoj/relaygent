"""Tests for /notifications/pending route — fast mode, skip param, chat collection."""
from __future__ import annotations

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Thread
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "notifications"))
os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-routes-pending")

import pytest
import notif_config as config
import db as notif_db
import routes as routes_mod


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "reminders.db"))
    notif_db.init_db()


@pytest.fixture()
def client():
    config.app.config["TESTING"] = True
    with config.app.test_client() as c:
        yield c


class TestFastMode:
    def test_fast_skips_slow_collectors(self, client, monkeypatch):
        called = []
        monkeypatch.setattr(routes_mod, "_slow_collectors",
                            [("test_src", lambda n: called.append("called"))])
        monkeypatch.setattr(routes_mod, "_collect_chat_messages", lambda n: None)
        client.get("/notifications/pending?fast=1")
        assert called == []

    def test_non_fast_runs_slow_collectors(self, client, monkeypatch):
        called = []
        monkeypatch.setattr(routes_mod, "_slow_collectors",
                            [("test_src", lambda n: called.append("called"))])
        monkeypatch.setattr(routes_mod, "_collect_chat_messages", lambda n: None)
        client.get("/notifications/pending")
        assert called == ["called"]


class TestSkipParam:
    def test_skip_excludes_named_source(self, client, monkeypatch):
        called = []
        monkeypatch.setattr(routes_mod, "_slow_collectors", [
            ("slack", lambda n: called.append("slack")),
            ("email", lambda n: called.append("email")),
        ])
        monkeypatch.setattr(routes_mod, "_collect_chat_messages", lambda n: None)
        client.get("/notifications/pending?skip=slack")
        assert "slack" not in called
        assert "email" in called

    def test_skip_multiple_sources(self, client, monkeypatch):
        called = []
        monkeypatch.setattr(routes_mod, "_slow_collectors", [
            ("slack", lambda n: called.append("slack")),
            ("email", lambda n: called.append("email")),
        ])
        monkeypatch.setattr(routes_mod, "_collect_chat_messages", lambda n: None)
        client.get("/notifications/pending?skip=slack,email")
        assert called == []

    def test_skip_empty_string_ignored(self, client, monkeypatch):
        called = []
        monkeypatch.setattr(routes_mod, "_slow_collectors",
                            [("email", lambda n: called.append("email"))])
        monkeypatch.setattr(routes_mod, "_collect_chat_messages", lambda n: None)
        client.get("/notifications/pending?skip=")
        assert "email" in called


class TestChatCollection:
    def test_chat_unreachable_does_not_crash(self, client, monkeypatch):
        monkeypatch.setattr(routes_mod, "_slow_collectors", [])
        monkeypatch.setenv("RELAYGENT_HUB_PORT", "19999")
        resp = client.get("/notifications/pending?fast=1")
        assert resp.status_code == 200

    def test_chat_messages_added_when_unread(self, client, monkeypatch):
        monkeypatch.setattr(routes_mod, "_slow_collectors", [])

        chat_data = {"count": 2, "messages": [
            {"created_at": "2026-01-01T12:00:00", "content": "hello"},
            {"created_at": "2026-01-01T12:01:00", "content": "world"},
        ]}

        class FakeHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps(chat_data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        srv = HTTPServer(("127.0.0.1", 0), FakeHandler)
        port = srv.server_address[1]
        t = Thread(target=srv.handle_request, daemon=True)
        t.start()

        monkeypatch.setenv("RELAYGENT_HUB_HOST", "127.0.0.1")
        monkeypatch.setenv("RELAYGENT_HUB_PORT", str(port))
        # Reload the URL constants in routes_mod
        monkeypatch.setattr(routes_mod, "HUB_PORT", str(port))
        monkeypatch.setattr(routes_mod, "HUB_HOST", "127.0.0.1")

        resp = client.get("/notifications/pending?fast=1")
        data = resp.get_json()
        chat_notifs = [n for n in data if n.get("source") == "chat"]
        assert len(chat_notifs) == 1
        assert chat_notifs[0]["count"] == 2
        assert len(chat_notifs[0]["messages"]) == 2

    def test_chat_zero_count_not_added(self, client, monkeypatch):
        monkeypatch.setattr(routes_mod, "_slow_collectors", [])

        class FakeHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps({"count": 0, "messages": []}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        srv = HTTPServer(("127.0.0.1", 0), FakeHandler)
        port = srv.server_address[1]
        Thread(target=srv.handle_request, daemon=True).start()

        monkeypatch.setattr(routes_mod, "HUB_PORT", str(port))
        monkeypatch.setattr(routes_mod, "HUB_HOST", "127.0.0.1")

        resp = client.get("/notifications/pending?fast=1")
        data = resp.get_json()
        assert not any(n.get("source") == "chat" for n in data)


class TestCollectorException:
    def test_failing_slow_collector_does_not_crash(self, client, monkeypatch):
        def boom(n):
            raise RuntimeError("collector exploded")

        monkeypatch.setattr(routes_mod, "_slow_collectors", [("boom", boom)])
        monkeypatch.setattr(routes_mod, "_collect_chat_messages", lambda n: None)
        resp = client.get("/notifications/pending")
        assert resp.status_code == 200
