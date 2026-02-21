#!/bin/bash
# Manage MCP server registrations in ~/.claude.json
set -euo pipefail

CLAUDE_JSON="$HOME/.claude.json"

usage() {
    echo "Usage: relaygent mcp [list|add|remove]"
    echo ""
    echo "Commands:"
    echo "  list                          Show registered MCP servers"
    echo "  add <name> <command> [args]   Register a new MCP server"
    echo "  remove <name>                 Unregister an MCP server"
    echo ""
    echo "Examples:"
    echo "  relaygent mcp list"
    echo "  relaygent mcp add jira node /path/to/jira-mcp.mjs"
    echo "  relaygent mcp remove jira"
}

ensure_claude_json() {
    if [ ! -f "$CLAUDE_JSON" ]; then
        echo '{"mcpServers":{}}' > "$CLAUDE_JSON"
    fi
}

cmd_list() {
    ensure_claude_json
    python3 - "$CLAUDE_JSON" <<'PYEOF'
import json, sys, os
try:
    config = json.load(open(sys.argv[1]))
except (json.JSONDecodeError, FileNotFoundError):
    print("No MCP servers configured."); sys.exit(0)
servers = config.get("mcpServers", {})
if not servers:
    print("No MCP servers configured."); sys.exit(0)
# Categorize: built-in vs custom
builtin = {"hub-chat", "relaygent-notifications", "computer-use",
           "secrets", "email", "slack", "linear"}
print(f"\033[0;34m{len(servers)} MCP server(s) registered:\033[0m\n")
for name, cfg in sorted(servers.items()):
    cmd = cfg.get("command", "?")
    args = cfg.get("args", [])
    env_keys = list(cfg.get("env", {}).keys())
    tag = "" if name in builtin else " \033[0;33m(custom)\033[0m"
    arg_str = " ".join(os.path.basename(a) for a in args[:2])
    detail = f"{cmd} {arg_str}".strip()
    if env_keys:
        detail += f" (env: {', '.join(env_keys)})"
    print(f"  \033[1m{name}\033[0m{tag}")
    print(f"    {detail}")
PYEOF
}

cmd_add() {
    local name="${1:-}"
    local command="${2:-}"
    shift 2 2>/dev/null || true
    local args=("$@")

    if [ -z "$name" ] || [ -z "$command" ]; then
        echo "Error: name and command are required"
        echo "Usage: relaygent mcp add <name> <command> [args...]"
        exit 1
    fi

    ensure_claude_json
    python3 - "$CLAUDE_JSON" "$name" "$command" "${args[@]}" <<'PYEOF'
import json, sys
config_path = sys.argv[1]
name = sys.argv[2]
command = sys.argv[3]
args = sys.argv[4:]
try:
    config = json.load(open(config_path))
except (json.JSONDecodeError, FileNotFoundError):
    config = {}
if "mcpServers" not in config:
    config["mcpServers"] = {}
existing = name in config["mcpServers"]
entry = {"command": command}
if args:
    entry["args"] = args
config["mcpServers"][name] = entry
with open(config_path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
action = "Updated" if existing else "Added"
print(f"{action} MCP server '\033[1m{name}\033[0m': {command} {' '.join(args)}")
print(f"\nRestart your Claude Code session to pick up the change.")
PYEOF
}

cmd_remove() {
    local name="${1:-}"
    if [ -z "$name" ]; then
        echo "Error: name is required"
        echo "Usage: relaygent mcp remove <name>"
        exit 1
    fi

    ensure_claude_json
    python3 - "$CLAUDE_JSON" "$name" <<'PYEOF'
import json, sys
config_path = sys.argv[1]
name = sys.argv[2]
try:
    config = json.load(open(config_path))
except (json.JSONDecodeError, FileNotFoundError):
    print(f"No config found."); sys.exit(1)
servers = config.get("mcpServers", {})
if name not in servers:
    print(f"MCP server '{name}' not found.")
    print(f"Registered: {', '.join(sorted(servers.keys())) or 'none'}")
    sys.exit(1)
del config["mcpServers"][name]
with open(config_path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
print(f"Removed MCP server '\033[1m{name}\033[0m'.")
print(f"\nRestart your Claude Code session to pick up the change.")
PYEOF
}

case "${1:-list}" in
    list|ls) cmd_list ;;
    add) shift; cmd_add "$@" ;;
    remove|rm) shift; cmd_remove "$@" ;;
    -h|--help|help) usage ;;
    *) echo "Unknown command: $1"; usage; exit 1 ;;
esac
