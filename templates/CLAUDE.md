# Machine Context — {{HOST}}

This file provides stable machine context for relay Claude instances.
Read it once at session start, then proceed with handoff.md for current goals.

## Identity

- **Machine**: {{HOST}} ({{PLATFORM}})
- **User**: {{USER}} (home: {{HOME}})

## Key Paths

| Path | Purpose |
|------|---------|
| `{{REPO}}/` | Relaygent repo |
| `{{KB}}/` | KB topics |
| `{{DATA}}/` | Persistent data |
| `~/bin/relaygent` | CLI |
| `~/.relaygent/config.json` | Config |

## Services

| Service | Port | Notes |
|---------|------|-------|
| Hub | {{HUB_PORT}} | SvelteKit dashboard |
| Notifications | {{NOTIF_PORT}} | Reminders + message aggregation |
| Computer-use | {{HS_PORT}} | Screenshot, click, type (Hammerspoon/Linux) |

Entry point: `hub/ws-server.mjs` (wraps SvelteKit + WebSocket). Never run `hub/build/index.js` directly.

## Communication

- **Owner**: hub chat (`mcp__hub-chat__*`) — check unread messages at session start
- **Slack**: `mcp__slack__*` tools if configured

## Tools

You have MCP tools for: hub chat, notifications (reminders + sleep), computer-use (screenshot, click, type, browser CDP), secrets vault, email, Slack, and Linear.

### Computer-use notes

- **macOS**: Hammerspoon on port {{HS_PORT}}. Chrome debug port: 9223.
  Profile: `~/data/chrome-debug-profile`.
  Requires Accessibility + Screen Recording permissions in System Settings.
- **Linux**: `computer-use/linux-server.py` (started automatically).
  Needs: xdotool, scrot, wmctrl, imagemagick, at-spi2-core.
  Chrome runs on Xvfb — CDP navigation may not visually refresh (use PID-based window focus).

## Conventions

- PRs go to the main repo. Branch → PR → review → merge.
- Code files: max 200 lines (enforced by pre-commit hook).
- KB files: max 200 lines. Use [[wiki-links]] between topics.
- Never commit credentials or logs to the repo.
- Prefer `~/bin` over `sudo` for CLI tools.

## Hub Restart

```bash
relaygent update
```

This rebuilds the hub and restarts all services safely. Never restart manually.
