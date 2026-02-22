"""Relay notification helpers — chat and Slack alerts."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from config import log


def notify_crash(crash_count: int, exit_code: int) -> None:
    """Alert the user about repeated crashes via hub chat + Slack + log."""
    msg = (f"Relay crashed {crash_count} times (exit code {exit_code}). "
           f"Manual intervention may be needed.")
    log(f"CRASH ALERT: {msg}")
    send_chat_alert(msg)
    send_slack_alert(f":rotating_light: *Relay crash alert*: {msg}")


def notify_lifecycle(event: str, detail: str = "") -> None:
    """Lightweight hub chat notification for session lifecycle events."""
    msg = f"[relay] {event}" + (f" — {detail}" if detail else "")
    send_chat_alert(msg)


def send_chat_alert(message: str) -> None:
    """Best-effort alert to the user via hub chat."""
    hub_port = os.environ.get("RELAYGENT_HUB_PORT", "8080")
    url = f"http://127.0.0.1:{hub_port}/api/chat"
    try:
        data = json.dumps({"content": message, "role": "assistant"}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5)
    except (urllib.error.URLError, OSError) as e:
        log(f"Chat alert failed (hub may be down): {e}")


def send_slack_alert(message: str) -> None:
    """Best-effort alert via Slack — posts to channel from config, or #general."""
    token_file = Path.home() / ".relaygent" / "slack" / "token.json"
    config_file = Path.home() / ".relaygent" / "config.json"
    try:
        token = json.loads(token_file.read_text()).get("token", "")
        if not token:
            return
        config = json.loads(config_file.read_text()) if config_file.exists() else {}
        channel = config.get("slack", {}).get("alert_channel", "general")
        params = urllib.parse.urlencode({"token": token, "channel": channel, "text": message}).encode()
        req = urllib.request.Request("https://slack.com/api/chat.postMessage", data=params,
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        urllib.request.urlopen(req, timeout=5)
    except (urllib.error.URLError, OSError):
        log("Slack alert failed (token or network issue)")
