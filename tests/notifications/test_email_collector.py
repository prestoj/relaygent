"""Tests for email_collector.py — cache-based email notification collector."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


os.environ.setdefault("RELAYGENT_DATA_DIR", "/tmp/relaygent-test-email-col")

import pytest

import notif_config as config
import db as notif_db
import email_collector as ec


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "reminders.db"))
    notif_db.init_db()
    cache = tmp_path / "email-cache.json"
    ack = tmp_path / "ack_ts"
    monkeypatch.setattr(ec, "CACHE_FILE", str(cache))
    monkeypatch.setattr(ec, "_ACK_FILE", str(ack))
    return cache, ack


@pytest.fixture()
def client():
    config.app.config["TESTING"] = True
    with config.app.test_client() as c:
        yield c


class TestGetAckTs:
    def test_returns_zero_when_no_file(self):
        assert ec._get_ack_ts() == 0.0

    def test_reads_timestamp_from_file(self, _isolated):
        _, ack = _isolated
        ack.parent.mkdir(parents=True, exist_ok=True)
        ack.write_text("1234.567")
        assert ec._get_ack_ts() == 1234.567

    def test_returns_zero_on_bad_content(self, _isolated):
        _, ack = _isolated
        ack.parent.mkdir(parents=True, exist_ok=True)
        ack.write_text("not-a-number")
        assert ec._get_ack_ts() == 0.0


class TestAdvanceAck:
    def test_writes_timestamp(self, _isolated):
        _, ack = _isolated
        ec._advance_ack(9999.123)
        assert float(ack.read_text().strip()) == pytest.approx(9999.123, abs=0.01)

    def test_creates_parent_dirs(self, _isolated, tmp_path):
        deep_ack = tmp_path / "deep" / "nested" / "ack"
        ec._ACK_FILE = str(deep_ack)
        ec._advance_ack(42.0)
        assert float(deep_ack.read_text().strip()) == pytest.approx(42.0)


class TestCollect:
    def test_no_cache_file(self):
        notifications = []
        ec.collect(notifications)
        assert notifications == []

    def test_empty_cache(self, _isolated):
        cache, _ = _isolated
        cache.write_text(json.dumps({"emails": []}))
        notifications = []
        ec.collect(notifications)
        assert notifications == []

    def test_collects_new_emails(self, _isolated):
        cache, _ = _isolated
        cache.write_text(json.dumps({"emails": [
            {"from": "alice@test.com", "subject": "Hello", "received_at": 100},
            {"from": "bob@test.com", "subject": "Hi", "received_at": 200},
        ]}))
        notifications = []
        ec.collect(notifications)
        assert len(notifications) == 1
        assert notifications[0]["type"] == "email"
        assert notifications[0]["source"] == "email"
        assert notifications[0]["count"] == 2

    def test_skips_already_acked_emails(self, _isolated):
        cache, ack = _isolated
        ack.parent.mkdir(parents=True, exist_ok=True)
        ack.write_text("150.0")
        cache.write_text(json.dumps({"emails": [
            {"from": "old@test.com", "subject": "Old", "received_at": 100},
            {"from": "new@test.com", "subject": "New", "received_at": 200},
        ]}))
        notifications = []
        ec.collect(notifications)
        assert len(notifications) == 1
        assert notifications[0]["count"] == 1
        assert notifications[0]["previews"][0]["from"] == "new@test.com"

    def test_collect_does_not_advance_ack(self, _isolated):
        """collect() surfaces but must NOT advance the watermark — that's the
        consume-ack's job (hook/endpoint). A background poll reaching no agent
        turn must never advance, else the mail is silently dropped."""
        cache, _ = _isolated
        cache.write_text(json.dumps({"emails": [
            {"from": "a@b.com", "subject": "X", "received_at": 500},
        ]}))
        ec.collect([])
        assert ec._get_ack_ts() == 0.0

    def test_collect_surfaces_ack_ts_watermark(self, _isolated):
        """The notification carries the exact watermark (max over ALL unacked,
        not just the 5 previewed) for the consumer to advance to."""
        cache, _ = _isolated
        cache.write_text(json.dumps({"emails": [
            {"from": "a@b.com", "subject": "X", "received_at": 300},
            {"from": "c@d.com", "subject": "Y", "received_at": 700},
        ]}))
        notifications = []
        ec.collect(notifications)
        assert notifications[0]["ack_ts"] == 700

    def test_resurfaces_until_acked(self, _isolated):
        """Un-acked mail re-surfaces on every collect (consume-gated, like chat
        staying unread) and stops only once the watermark is advanced."""
        cache, _ = _isolated
        cache.write_text(json.dumps({"emails": [
            {"from": "a@b.com", "subject": "X", "received_at": 100},
        ]}))
        first = []
        ec.collect(first)
        assert len(first) == 1
        second = []  # no intervening ack → still surfaces
        ec.collect(second)
        assert len(second) == 1
        ec._advance_ack(first[0]["ack_ts"])  # consume-ack to surfaced watermark
        third = []
        ec.collect(third)
        assert third == []

    def test_dedup_key_uses_message_id(self, _isolated):
        """Same received_at (one poll batch), distinct ids → distinct dedup keys,
        so SleepManager can't collapse a batch to one fingerprint."""
        cache, _ = _isolated
        cache.write_text(json.dumps({"emails": [
            {"id": "msg-aaa", "from": "a@b.com", "subject": "X", "received_at": 100},
            {"id": "msg-bbb", "from": "c@d.com", "subject": "Y", "received_at": 100},
        ]}))
        notifications = []
        ec.collect(notifications)
        msgs = notifications[0]["messages"]
        assert {m["dedup"] for m in msgs} == {"msg-aaa", "msg-bbb"}

    def test_dedup_key_falls_back_without_id(self, _isolated):
        cache, _ = _isolated
        cache.write_text(json.dumps({"emails": [
            {"from": "a@b.com", "subject": "X", "received_at": 100},
        ]}))
        notifications = []
        ec.collect(notifications)
        assert notifications[0]["messages"][0]["dedup"] == "100:a@b.com:X"

    def test_previews_capped_at_5(self, _isolated):
        cache, _ = _isolated
        emails = [{"from": f"u{i}@t.com", "subject": f"S{i}", "received_at": i + 1}
                  for i in range(10)]
        cache.write_text(json.dumps({"emails": emails}))
        notifications = []
        ec.collect(notifications)
        assert len(notifications[0]["previews"]) == 5
        assert notifications[0]["count"] == 10

    def test_malformed_cache_json(self, _isolated):
        cache, _ = _isolated
        cache.write_text("NOT JSON")
        notifications = []
        ec.collect(notifications)
        assert notifications == []

    def test_missing_received_at_defaults_to_zero(self, _isolated):
        cache, _ = _isolated
        cache.write_text(json.dumps({"emails": [
            {"from": "x@y.com", "subject": "Z"},
        ]}))
        notifications = []
        ec.collect(notifications)
        assert notifications == []  # 0 <= ack_ts (0), so filtered


class TestAckEmailEndpoint:
    def test_ack_email_advances_timestamp(self, client):
        before = time.time()
        resp = client.post("/notifications/ack-email")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "ok"
        assert ec._get_ack_ts() >= before
