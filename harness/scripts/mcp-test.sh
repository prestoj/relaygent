#!/bin/bash
# Test MCP server registrations by sending JSON-RPC initialize
set -euo pipefail

CLAUDE_JSON="${1:-$HOME/.claude.json}"
FILTER="${2:-}"

if [ ! -f "$CLAUDE_JSON" ]; then
    echo "No MCP servers configured."
    exit 1
fi

python3 - "$CLAUDE_JSON" "$FILTER" <<'PYEOF'
import json, os, select, subprocess, sys
config_path = sys.argv[1]
filter_name = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else ""
try: config = json.load(open(config_path))
except: print("No MCP servers configured."); sys.exit(1)
servers = config.get("mcpServers", {})
if filter_name:
    if filter_name not in servers: print(f"MCP server '{filter_name}' not found."); sys.exit(1)
    servers = {filter_name: servers[filter_name]}
ok = fail = 0
INIT = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}\n'
for name, cfg in sorted(servers.items()):
    cmd, args = cfg.get("command", ""), cfg.get("args", [])
    env = {**os.environ, **cfg.get("env", {})}
    if subprocess.run(["which", cmd], capture_output=True).returncode != 0:
        print(f"  \033[0;31m✗\033[0m {name}: command '{cmd}' not found"); fail += 1; continue
    try:
        p = subprocess.Popen([cmd]+args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        p.stdin.write(INIT.encode()); p.stdin.flush()
        if select.select([p.stdout], [], [], 5)[0]:
            line = p.stdout.readline().decode(errors="replace")
            status = "\033[0;32m✓\033[0m" if "jsonrpc" in line else "\033[1;33m?\033[0m"
            label = "responds" if "jsonrpc" in line else "started (unexpected response)"
        else: status, label = "\033[1;33m?\033[0m", "started (no response in 5s)"
        print(f"  {status} {name}: {label}"); ok += 1
    except Exception as e: print(f"  \033[0;31m✗\033[0m {name}: {e}"); fail += 1
    finally:
        try: p.kill(); p.wait(timeout=2)
        except: pass
print(f"\n{ok+fail} tested: {ok} ok, {fail} failed"); sys.exit(1 if fail else 0)
PYEOF
