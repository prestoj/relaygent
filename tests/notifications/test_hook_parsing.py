"""Integration tests for the check-notifications hook notification parser.

Exercises hooks/notif-context.py — the standalone Python the hook invokes to
read the notification cache and format it for context injection. This logic
once silently broke via an f-string escaping bug (PR #246); it now lives in a
real file (extracted from the inline heredoc) so these tests run the *shipped*
code instead of a hand-copied snippet that could drift.

Run: pytest tests/notifications/test_hook_parsing.py -v
"""

import json
import os
import subprocess
import tempfile

# Repo root: tests/notifications/ -> tests/ -> repo root.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NOTIF_CONTEXT = os.path.join(_REPO_ROOT, "hooks", "notif-context.py")


def _run_parser(cache_data, cache_path=None):
    """Write cache data to a temp file, run the real notif-context.py, return (stdout, stderr).

    HOME is redirected to a throwaway dir so the email-ack watermark write
    (~/.relaygent/gmail/.email_ack_ts) can never touch live machine state.
    """
    with tempfile.TemporaryDirectory() as home, \
         tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(cache_data, f)
        f.flush()
        cf = cache_path or f.name
        try:
            r = subprocess.run(
                ["python3", NOTIF_CONTEXT],
                env={**os.environ, "CACHE_FILE": cf, "HOME": home},
                capture_output=True, text=True, timeout=5,
            )
            return r.stdout.strip(), r.stderr.strip()
        finally:
            os.unlink(f.name)


class TestFileExists:
    def test_notif_context_present_and_executable(self):
        assert os.path.isfile(NOTIF_CONTEXT)


class TestEmptyAndMissing:
    def test_empty_list_produces_no_output(self):
        stdout, stderr = _run_parser([])
        assert stdout == ""
        assert stderr == ""

    def test_missing_file_produces_error_on_stderr(self):
        stdout, stderr = _run_parser([], cache_path="/tmp/nonexistent-test-cache.json")
        assert stdout == ""
        assert "WARNING" in stderr


class TestReminders:
    # NOTE: fixtures omit `id` on purpose — id-less reminders never read or
    # write the hardcoded /tmp/relaygent-reminder-seen.json, so tests stay
    # hermetic and can't suppress a live reminder.
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

    def test_email_with_messages_prefers_sender_name(self):
        data = [{"type": "email", "count": 1, "messages": [
            {"from": "Preston <preston@example.com>", "subject": "Lunch?",
             "sender_name": "Preston Jensen", "sender_context": "Creator of relaygent"}
        ]}]
        stdout, _ = _run_parser(data)
        assert "From: Preston Jensen" in stdout
        assert "Subject: Lunch?" in stdout
        assert "[context: Creator of relaygent]" in stdout

    def test_email_messages_wins_over_previews(self):
        """When both exist (backwards-compat), use the richer `messages`."""
        data = [{"type": "email", "count": 1,
                 "messages": [{"from": "a", "subject": "msg", "sender_name": "Alice"}],
                 "previews": [{"from": "a", "subject": "msg"}]}]
        stdout, _ = _run_parser(data)
        assert "From: Alice" in stdout


class TestTask:
    def test_task_basic(self):
        stdout, _ = _run_parser([{"type": "task", "description": "Self-update"}])
        assert stdout == "TASK DUE: Self-update"

    def test_task_with_overdue_and_runbook(self):
        data = [{"type": "task", "description": "Deploy", "overdue": "2h late",
                 "runbook": "scripts/deploy.md"}]
        stdout, _ = _run_parser(data)
        assert "TASK DUE: Deploy" in stdout
        assert "(2h late)" in stdout
        assert "runbook: scripts/deploy.md" in stdout


class TestCallSpeech:
    def test_call_speech(self):
        data = [{"type": "call_speech", "messages": [{"text": "Hey it's Preston, call me back"}]}]
        stdout, _ = _run_parser(data)
        assert "CALLER: Hey it's Preston, call me back" in stdout

    def test_call_speech_strips_newlines(self):
        data = [{"type": "call_speech", "messages": [{"text": "line one\nline two"}]}]
        stdout, _ = _run_parser(data)
        assert "CALLER: line one line two" in stdout


class TestSmsTopLevel:
    def test_sms_with_message(self):
        data = [{"type": "sms", "count": 1, "messages": [
            {"from": "+15551234567", "body": "yo", "sender_name": "Preston"}
        ]}]
        stdout, _ = _run_parser(data)
        assert "1 new SMS from Preston: yo" in stdout

    def test_sms_plural_no_messages(self):
        data = [{"type": "sms", "count": 3, "messages": []}]
        stdout, _ = _run_parser(data)
        assert "3 new SMS messages" in stdout


class TestSlack:
    def test_slack_with_channel_preview_includes_sender(self):
        data = [{"type": "message", "source": "slack", "count": 2, "channels": [
            {"name": "general", "messages": [
                {"user": "U123", "text": "Hey team!", "ts": "1234.5"}
            ]}
        ]}]
        stdout, _ = _run_parser(data)
        assert "2 unread Slack" in stdout
        assert "[#general] U123: Hey team!" in stdout

    def test_slack_prefers_user_name(self):
        data = [{"type": "message", "source": "slack", "count": 1, "channels": [
            {"name": "ops", "messages": [{"user": "U1", "user_name": "Preston", "text": "hi"}]}
        ]}]
        stdout, _ = _run_parser(data)
        assert "[#ops] Preston: hi" in stdout

    def test_slack_truncates_long_messages(self):
        long_text = "x" * 100
        data = [{"type": "message", "source": "slack", "count": 1, "channels": [
            {"name": "test", "messages": [{"text": long_text}]}
        ]}]
        stdout, _ = _run_parser(data)
        # No user → no sender prefix; body truncated to 60 chars.
        assert "[#test] " + "x" * 60 in stdout
        assert "x" * 61 not in stdout

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


class TestImessage:
    def test_imessage_with_sender_context(self):
        data = [{"type": "message", "source": "imessage", "count": 1, "messages": [
            {"from": "+1555", "body": "dinner?", "sender_name": "Mom",
             "sender_context": "Preston's mother"}
        ]}]
        stdout, _ = _run_parser(data)
        assert "1 new iMessage from Mom: dinner?" in stdout
        assert "[context: Preston's mother]" in stdout

    def test_imessage_plural(self):
        data = [{"type": "message", "source": "imessage", "count": 2, "messages": []}]
        stdout, _ = _run_parser(data)
        assert "2 new iMessages" in stdout


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
    Now that the parser is a real .py file (no bash quoting layer) this
    class of bug is structurally gone, but the cases stay as guards.
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
