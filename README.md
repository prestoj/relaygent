# Relaygent

**[relaygent.ai](https://relaygent.ai)**

An autonomous AI agent that runs continuously on your Mac or Linux machine (or its own). It can see your screen, click, type, read and write files, run commands, and hand off to itself indefinitely — no human in the loop required.

Built as a wrapper around [Claude Code](https://docs.anthropic.com/en/docs/claude-code). When one session fills its context window, it writes a detailed briefing and a fresh session picks up exactly where it left off. The result is an agent that runs for hours, days, or weeks — building software, managing systems, and evolving its own knowledge base over time.

You get a live web dashboard to watch it work, a chat interface to talk to it, and full computer control via Hammerspoon.

> **⚠️ WARNING: This gives Claude FULL, UNSUPERVISED control of your machine.**
>
> Relaygent can read and write any file, run any command, control your screen, access your browser, and operate continuously for days or weeks without human intervention. There is no sandbox. You can turn the system off with `relaygent stop`, but the agent has the ability to edit this command too.
>
> **Only run this on a machine you are comfortable giving Claude unrestricted access to.** A dedicated VM, a spare machine, or a fresh cloud instance is strongly recommended. DO NOT RUN THIS on a machine with sensitive credentials, personal data, or anything you cannot afford to lose or have exposed.
>
> If you don't know what you're doing, DO NOT USE THIS.

## Quick Start

```bash
git clone https://github.com/prestoj/relaygent.git
cd relaygent
./setup.sh
```

Setup handles everything: dependency installation, hub build, Hammerspoon configuration, and Claude CLI authentication. After setup:

```bash
relaygent start          # Launch the agent + dashboard + services
relaygent stop           # Stop everything
relaygent status         # Check what's running
relaygent restart        # Restart all services
relaygent logs           # Tail service logs
relaygent orient         # Quick system status snapshot
relaygent check          # Diagnose configuration and service health
relaygent update         # Pull latest code and rebuild hub
relaygent health         # Check all services in one shot
relaygent set-password   # Set/remove dashboard authentication
relaygent archive-linear # Archive old completed Linear issues
```

Open `http://localhost:8080` to watch your agent work.

## What It Does

**Runs autonomously.** The relay harness starts a Claude Code session, monitors it, and when context fills to ~85%, the agent writes a handoff and a successor session continues seamlessly. No manual intervention needed.

**Controls your screen.** The agent can take screenshots, click buttons, type text, scroll, read accessibility trees, launch apps, and navigate browsers. On macOS this uses Hammerspoon; on Linux it uses xdotool, scrot, and AT-SPI2. You can watch it live on the dashboard.

**Remembers everything.** A git-tracked knowledge base persists across sessions. The agent reads its predecessor's notes, updates them, and leaves better ones for the next session. Topics link together with wiki-links.

**Sleeps and wakes.** Between active work, the agent sleeps at zero token cost. When you send a chat message, a reminder fires, or a notification arrives — it wakes up and gets to work.

**Stays aligned.** You write an intent file describing your priorities. The agent reads it every session but can never edit it. You stay in control of *what* it works on.

## Requirements

- **macOS or Linux** (Ubuntu 22.04+ recommended for Linux)
- **Node.js 20+**
- **Python 3.9+**
- **Claude Code** (`npm install -g @anthropic-ai/claude-code`) with an active subscription

**macOS extras:** Hammerspoon (setup installs it via Homebrew and guides you through Accessibility + Screen Recording permissions).

**Linux extras:** `sudo apt install xdotool scrot wmctrl imagemagick python3-pyatspi at-spi2-core`

## The Dashboard

A SvelteKit web app at `http://localhost:8080` with live updates via WebSocket:

- **Activity Feed** — every tool call the agent makes, in real time, with expandable details
- **Screen** — collapsible live view of what the agent sees (via Hammerspoon screenshots)
- **Knowledge Base** — browse, create, edit, and delete the agent's long-term memory (Markdown + wiki-links)
- **Tasks** — manage recurring and one-off tasks; add tasks directly from the dashboard
- **Sessions** — browsable history grouped by date, with stats, tool breakdown, and search
- **Current Tasks** — live Linear integration showing what the agent is working on
- **Intent** — your priorities file, visible to the agent, editable only by you
- **Context Bar** — how full the current session's context window is
- **Authentication** — optional password protection via `relaygent set-password`

## How the Relay Works

1. The harness starts a Claude Code session with a system prompt
2. Claude works autonomously — reading files, writing code, running commands, using the screen
3. A **PostToolUse hook** fires after every tool call, injecting current time, notifications, and context usage
4. At ~85% context, the agent wraps up: writes a handoff, updates persistent state, commits the KB
5. The harness spawns a **successor session** that reads the handoff and continues immediately
6. Between tasks, the agent **sleeps** — the harness polls for notifications and resumes the session when one arrives

## Hooks & Notifications

The agent stays aware of the outside world through a **PostToolUse hook** — a shell script that runs after every single tool call Claude makes. This is the agent's peripheral nervous system:

- **Current time** — injected every tool call so the agent always knows what time it is
- **Context tracking** — reads the session's JSONL to calculate context window fill %. At 85%, it injects a wrap-up warning telling the agent to write its handoff
- **Chat messages** — checks for unread messages from you. If you send a message via the dashboard, the agent sees it on its next tool call
- **Reminders** — the agent can set reminders for itself via MCP tools. When a reminder fires, the hook surfaces it

A background **notification poller** daemon runs alongside the agent, polling the notifications API every second and caching results to a temp file. The hook reads from this cache (instant, no HTTP call) rather than hitting the API directly — so it adds zero latency to tool calls.

When the agent sleeps, the harness takes over: it polls for pending notifications and resumes the Claude session when something arrives. The agent wakes up with the notification content injected as a message.

## Computer Use

The agent interacts with your screen through 33 MCP tools:

- **Screenshots** — full screen or cropped regions, returned as inline images
- **Click / Type / Scroll** — precise input events with modifier key support
- **Accessibility tree** — find UI elements by role or title, click them programmatically
- **App management** — launch, focus, and list windows
- **Browser** — 14 tools via Chrome DevTools Protocol: navigate, click, type, fill forms, hover, select, scroll, wait, read text, evaluate JS
- **AppleScript** — run arbitrary AppleScript (macOS only)

On macOS, these are backed by Hammerspoon. On Linux, they use xdotool (input), scrot + ImageMagick (screenshots), wmctrl (windows), and pyatspi2 (accessibility). The MCP server is the same on both — it talks to a platform-specific HTTP backend on port 8097.

Every action auto-returns a screenshot so the agent sees the result immediately.

## Knowledge Base

The agent maintains a git-tracked knowledge base that grows over time:

| File | Purpose |
|------|---------|
| `MEMORY.md` | Persistent memory — accumulates across sessions, auto-injected into every prompt |
| `HANDOFF.md` | Briefing from the previous session (rewritten from scratch each handoff) |
| `INTENT.md` | Your priorities — the agent reads this but never edits it |
| `tasks.md` | Recurring and one-off task queue |
| `curiosities.md` | Open questions to explore when idle |

Create additional topic files as needed. The agent links them together with `[[wiki-links]]`.

## Email & Secrets

**Secrets.** Credentials are stored in `~/.relaygent/secrets.json` with `chmod 600` file permissions — the same approach used by gh, aws, gcloud, and docker. No encryption, no master password. The agent accesses secrets through MCP tools (`secrets_get`, `secrets_set`, `secrets_list`, `secrets_delete`).

**Gmail integration.** Each agent gets its own email address as identity. The `email` MCP provides 6 tools: `search_emails`, `read_email`, `send_email`, `draft_email`, `modify_email`, and `list_email_labels`. OAuth2 credentials are stored at `~/.relaygent/gmail/`.

**Setup flow:**
1. During `./setup.sh`, you optionally provide an email and password
2. Secrets are stored in `~/.relaygent/secrets.json` (file-permission protected)
3. Gmail OAuth is completed on the agent's first session (it visits the auth URL via computer-use)

**Google Cloud setup** (required for Gmail): Create an OAuth2 client in [Google Cloud Console](https://console.cloud.google.com/), download the keys JSON, and save it as `~/.relaygent/gmail/gcp-oauth.keys.json`. The agent completes the OAuth flow automatically.

## Architecture

```
relaygent/
├── harness/          # Relay runner — session lifecycle, sleep/wake, handoff
├── hub/              # SvelteKit dashboard + chat + KB (Node.js)
├── computer-use/     # MCP server wrapping Hammerspoon (19 tools)
├── hammerspoon/      # Lua scripts for screen control (copied to ~/.hammerspoon)
├── notifications/    # Reminder + wake trigger service (Python/Flask + MCP)
├── linear/           # Linear MCP server + auto-archive script
├── email/            # Gmail MCP server (OAuth2, 6 tools)
├── slack/            # Slack MCP server + Socket Mode listener
├── secrets/          # Credential store (dotfile JSON + MCP)
├── hooks/            # PostToolUse hook (time, notifications, context tracking)
├── templates/        # Starter KB files for new installations
├── setup/            # Interactive onboarding (setup.mjs + helpers)
├── scripts/          # Pre-commit hook (200-line file limit enforcement)
└── bin/relaygent     # CLI (start/stop/status/restart/logs/orient/check/health)
```

## License

MIT
