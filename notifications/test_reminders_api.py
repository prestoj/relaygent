"""Tests for GET /upcoming and DELETE /reminder/<id> endpoints."""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-remapi")

import pytest

import notif_config as config  # noqa: E402
import db as notif_db  # noqa: E402
import reminders  # noqa: E402, F401 — registers /upcoming + /reminder routes
import routes  # noqa: E402, F401 — registers /notifications/pending + /health


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "reminders.db"))
    notif_db.init_db()


@pytest.fixture()
def client():
    config.app.config["TESTING"] = True
    with config.app.test_client() as c:
        yield c


class TestUpcomingEndpoint:
    def test_empty(self, client):
        resp = client.get("/upcoming")
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_lists_created_reminders(self, client):
        client.post("/reminder", json={
            "trigger_time": "2099-01-01T00:00:00", "message": "far future",
        })
        resp = client.get("/upcoming")
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]["message"] == "far future"
        assert "id" in data[0] and "trigger_time" in data[0]

    def test_multiple_sorted_by_time(self, client):
        client.post("/reminder", json={"trigger_time": "2099-06-01T00:00:00", "message": "second"})
        client.post("/reminder", json={"trigger_time": "2099-01-01T00:00:00", "message": "first"})
        data = client.get("/upcoming").get_json()
        assert len(data) == 2
        assert data[0]["message"] == "first"


class TestDeleteReminderEndpoint:
    def test_delete_existing(self, client):
        r = client.post("/reminder", json={
            "trigger_time": "2099-01-01T00:00:00", "message": "to delete",
        })
        rid = r.get_json()["id"]
        resp = client.delete(f"/reminder/{rid}")
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_delete_removes_from_upcoming(self, client):
        r = client.post("/reminder", json={
            "trigger_time": "2099-01-01T00:00:00", "message": "gone",
        })
        rid = r.get_json()["id"]
        client.delete(f"/reminder/{rid}")
        upcoming = client.get("/upcoming").get_json()
        assert all(x["id"] != rid for x in upcoming)

    def test_delete_nonexistent(self, client):
        resp = client.delete("/reminder/99999")
        assert resp.status_code == 404
        assert "not found" in resp.get_json()["error"]
