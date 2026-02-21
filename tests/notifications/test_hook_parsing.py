"""Integration tests for check-notifications hook notification parsing.

Tests the Python snippet embedded in hooks/check-notifications that reads
the notification cache and formats it for context injection. This is the
logic that silently broke via an f-string escaping bug (PR #246).

Run: pytest tests/notifications/test_hook_parsing.py -v
"""

import json
import os
import subprocess
import tempfile

import pytest

# The Python snippet from check-notifications (lines 104-142), parameterized
# by CACHE_FILE env var. We extract it here so we can test it in isolation.
PARSE_SCRIPT = r"""
import json, os
try:
    with open(os.environ['CACHE_FILE']) as f: data = json.load(f)
    parts = []
    for n in data:
        if n.get('type') == 'reminder':
            parts.append('REMINDER DUE: "' + n.get('message', '') + '"')
        elif n.get('type') == 'email':
            count = n.get('count', 0)
            noun = 'email' if count == 1 else 'emails'
            previews = n.get('previews', [])
            if previews:
                prev = previews[0]
                parts.append(f'{count} new {noun}: From: {prev.get("from","?")} Subject: {prev.get("subject","")}')
            else:
                parts.append(f'{count} new {noun}')
        elif n.get('type') == 'message':
            count = n.get('count', 0)
            src = n.get('source', 'chat')
            if src == 'slack':
                channels = n.get('channels', [])
                previews = []
                for ch in channels[:3]:
                    msgs = ch.get('messages', [])
                    if msgs:
                        m = msgs[-1]
                        txt = (m.get('text') or '')[:60].replace('\n',' ')
                        ch_name = ch.get('name') or '?'
                        previews.append('[#' + ch_name + '] ' + txt)
                summary = str(count) + ' unread Slack' + (': ' + ' | '.join(previews) if previews else ' message(s)')
                parts.append(summary)
            else:
                parts.append(f'{count} unread chat message(s) — check with read_messages')
    if parts:
        print(' | '.join(parts))
except Exception as e:
    import sys; print(f'WARNING: notification cache parse error: {e}', file=sys.stderr)
"""


def _run_parser(cache_data):
    """Write cache data to temp file, run the parser, return stdout."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(cache_data, f)
        f.flush()
        try:
            r = subprocess.run(
                ["python3", "-c", PARSE_SCRIPT],
                env={**os.environ, "CACHE_FILE": f.name},
                capture_output=True, text=True, timeout=5,
            )
            return r.stdout.strip(), r.stderr.strip()
        finally:
            os.unlink(f.name)


class TestEmptyAndMissing:
    def test_empty_list_produces_no_output(self):
        stdout, stderr = _run_parser([])
        assert stdout == ""
        assert stderr == ""

    def test_missing_file_produces_error_on_stderr(self):
        r = subprocess.run(
            ["python3", "-c", PARSE_SCRIPT],
            env={**os.environ, "CACHE_FILE": "/tmp/nonexistent-test-cache.json"},
            capture_output=True, text=True, timeout=5,
        )
        assert r.stdout.strip() == ""
        assert "WARNING" in r.stderr


class TestReminders:
    def test_single_reminder(self):
        stdout, _ = _run_parser([{"type": "reminder", "message": "Stand up meeting"}])
        assert stdout == 'REMINDER DUE: "Stand up meeting"'

    def test_multiple_reminders(self):
        data = [
            {"type": "reminder", "message": "First"},
            {"type": "reminder", "message": "Second"},
        ]
        stdout, _ = _run_parser(data)
        assert 'REMINDER DUE: "First"' in stdout
        assert 'REMINDER DUE: "Second"' in stdout
        assert " | " in stdout


class TestEmail:
    def test_single_email_with_preview(self):
        data = [{"type": "email", "count": 1, "previews": [
            {"from": "alice@example.com", "subject": "Hello"}
        ]}]
        stdout, _ = _run_parser(data)
        assert "1 new email" in stdout
        assert "From: alice@example.com" in stdout
        assert "Subject: Hello" in stdout

    def test_multiple_emails(self):
        data = [{"type": "email", "count": 3, "previews": [
            {"from": "bob@test.com", "subject": "Meeting"}
        ]}]
        stdout, _ = _run_parser(data)
        assert "3 new emails" in stdout

    def test_email_without_previews(self):
        data = [{"type": "email", "count": 2, "previews": []}]
        stdout, _ = _run_parser(data)
        assert "2 new emails" in stdout
        assert "From:" not in stdout

    def test_email_with_missing_fields(self):
        data = [{"type": "email", "count": 1, "previews": [{}]}]
        stdout, stderr = _run_parser(data)
        assert "1 new email" in stdout
        assert "From: ?" in stdout
        assert stderr == ""


class TestSlack:
    def test_slack_with_channel_preview(self):
        data = [{"type": "message", "source": "slack", "count": 2, "channels": [
            {"name": "general", "messages": [
                {"user": "U123", "text": "Hey team!", "ts": "1234.5"}
            ]}
        ]}]
        stdout, _ = _run_parser(data)
        assert "2 unread Slack" in stdout
        assert "[#general] Hey team!" in stdout

    def test_slack_truncates_long_messages(self):
        long_text = "x" * 100
        data = [{"type": "message", "source": "slack", "count": 1, "channels": [
            {"name": "test", "messages": [{"text": long_text}]}
        ]}]
        stdout, _ = _run_parser(data)
        assert len("[#test] " + "x" * 60) >= len(stdout.split("Slack: ")[1])

    def test_slack_multiple_channels(self):
        data = [{"type": "message", "source": "slack", "count": 5, "channels": [
            {"name": "general", "messages": [{"text": "msg1"}]},
            {"name": "random", "messages": [{"text": "msg2"}]},
        ]}]
        stdout, _ = _run_parser(data)
        assert "[#general]" in stdout
        assert "[#random]" in stdout
        assert " | " in stdout

    def test_slack_no_channels(self):
        data = [{"type": "message", "source": "slack", "count": 1, "channels": []}]
        stdout, _ = _run_parser(data)
        assert "1 unread Slack message(s)" in stdout


class TestChat:
    def test_chat_messages(self):
        data = [{"type": "message", "source": "chat", "count": 3}]
        stdout, _ = _run_parser(data)
        assert "3 unread chat message(s)" in stdout


class TestMixed:
    def test_reminder_plus_slack_plus_email(self):
        data = [
            {"type": "reminder", "message": "Deploy"},
            {"type": "message", "source": "slack", "count": 1, "channels": [
                {"name": "ops", "messages": [{"text": "Ready"}]}
            ]},
            {"type": "email", "count": 2, "previews": [
                {"from": "ci@build.com", "subject": "Build passed"}
            ]},
        ]
        stdout, stderr = _run_parser(data)
        assert 'REMINDER DUE: "Deploy"' in stdout
        assert "1 unread Slack" in stdout
        assert "2 new emails" in stdout
        assert stderr == ""
        # All parts joined with |
        assert stdout.count(" | ") == 2


class TestFStringEscaping:
    """Regression tests for the f-string escaping bug (PR #246).

    The original bug: dict.get("key","default") inside an f-string
    inside a bash double-quoted python3 -c "..." string. The unescaped
    quotes broke Python parsing, silently killing ALL notifications.
    """
    def test_email_fstring_with_missing_from(self):
        data = [{"type": "email", "count": 1, "previews": [{"subject": "Test"}]}]
        stdout, stderr = _run_parser(data)
        assert "From: ?" in stdout
        assert stderr == ""

    def test_email_fstring_with_missing_subject(self):
        data = [{"type": "email", "count": 1, "previews": [{"from": "a@b.com"}]}]
        stdout, stderr = _run_parser(data)
        assert "From: a@b.com" in stdout
        assert stderr == ""
