# Notifications

The notifications service wakes the sleeping agent when something needs its attention. It has two runtimes coexisting in this directory by design — Python for the HTTP server and collectors, Node.js for the MCP interface and Slack real-time listener.

## Architecture

| File | Runtime | Role |
|------|---------|------|
| `server.py` | Python | Flask HTTP server — `/health`, `/notify`, `/upcoming`, `/reminders` |
| `routes.py` | Python | Route handlers for the Flask server |
| `db.py` | Python | SQLite persistence for reminders and notifications |
| `reminders.py` | Python | Reminder scheduling and due-check logic |
| `slack_collector.py` | Python | HTTP fallback: polls Slack channels for unread messages |
| `email_collector.py` | Python | Polls Gmail for unread messages |
| `tasks_collector.py` | Python | Checks KB tasks.md for due items |
| `notif_config.py` | Python | Shared config (ports, paths) |
| `slack-socket-listener.mjs` | Node.js | Long-running Socket Mode WebSocket — receives Slack events in real-time, writes to `/tmp/relaygent-slack-socket-cache.json` |
| `mcp-server.mjs` | Node.js | MCP server exposing reminder tools to Claude (`set_reminder`, `list_reminders`, etc.) |
| `mcp-tools.mjs` | Node.js | MCP tool definitions |

## Why two runtimes?

- **Python** is used for the core service because it's already required for the harness, has good Flask/SQLite support, and the collectors share state via the DB.
- **Node.js** is used for Slack Socket Mode because the official Slack SDK for real-time WebSocket connections is JS-first, and for the MCP server because all MCP servers in this project use the JS SDK.

The two runtimes don't share memory — they communicate via the HTTP server (Python) and a JSON cache file (`/tmp/relaygent-slack-socket-cache.json`).

## Starting

The notifications service is started by `relaygent start` and runs on port 8083 by default. The Slack socket listener is started separately by the `check-notifications` hook.
