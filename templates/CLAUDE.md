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

## Communication

- **Owner**: hub chat (`mcp__hub-chat__*`) — check unread messages at session start
- **Slack**: `mcp__slack__*` tools if configured

## Tools Available

Computer-use (screenshot, click, type) via Hammerspoon MCP (Mac) or linux-server.py (Linux).

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
