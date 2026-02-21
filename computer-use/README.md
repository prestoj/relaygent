# Computer-Use

Gives the agent eyes and hands on the desktop — screenshots, clicks, keyboard input, browser control, and accessibility tree inspection. Like notifications, this directory has two runtimes by design.

## Architecture

| File | Runtime | Role |
|------|---------|------|
| `linux-server.py` | Python | HTTP server on port 8097 — screenshot capture, input injection, a11y tree via pyatspi2 |
| `linux_display.py` | Python | Display setup (Xvfb :99), Chrome launch flags, screen config |
| `linux_input.py` | Python | Keyboard/mouse input via xdotool |
| `linux_a11y.py` | Python | Accessibility tree queries via pyatspi2 |
| `mcp-server.mjs` | Node.js | MCP server — bridges Claude to the Python backend via HTTP |
| `browser-tools.mjs` | Node.js | CDP-based browser automation (click, type, navigate, eval) |
| `browser-exprs.mjs` | Node.js | Reusable JS expressions for browser interaction |
| `cdp.mjs` | Node.js | Chrome DevTools Protocol client |
| `hammerspoon.mjs` | Node.js | macOS path — forwards computer-use calls to Hammerspoon |
| `start-desktop.sh` | Shell | Starts GNOME on Xvfb :99 and launches linux-server.py |

## Why two runtimes?

- **Python** owns the low-level OS interface: screenshot capture (PIL/scrot), input injection (xdotool), and accessibility tree (pyatspi2) — all Python-native libraries with no good JS equivalents.
- **Node.js** owns the MCP layer and browser automation: the MCP SDK is JS-first, and CDP (Chrome DevTools Protocol) is best handled in JS.

The MCP server (Node.js) calls the Python backend over HTTP (`localhost:8097`) for OS-level operations, and talks directly to Chrome via CDP for browser operations.

## Starting (Linux)

```bash
bash computer-use/start-desktop.sh   # starts Xvfb + GNOME + linux-server.py
```

On macOS, Hammerspoon replaces the Python backend — the MCP server forwards calls to the Hammerspoon HTTP server instead.
