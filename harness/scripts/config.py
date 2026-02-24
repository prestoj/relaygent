#!/usr/bin/env python3
"""Relaygent config CLI — view and modify config.json."""
from __future__ import annotations
import json, sys, os, shutil


def mask(key: str, val):
    """Mask sensitive values for display."""
    if any(s in key.lower() for s in ("password", "secret", "token", "apikey", "api-key")):
        if isinstance(val, str) and len(val) > 4:
            return val[:4] + "..." + val[-4:]
        return "****"
    return val


def fmt_value(key: str, val, indent: int = 0) -> list[str]:
    """Format a value for display, returning lines."""
    pad = "  " * indent
    if isinstance(val, dict):
        lines = [f"{pad}{key}:"]
        for k, v in val.items():
            lines.extend(fmt_value(k, v, indent + 1))
        return lines
    if isinstance(val, list):
        if not val:
            return [f"{pad}{key}: []"]
        lines = [f"{pad}{key}:"]
        for i, item in enumerate(val):
            if isinstance(item, dict):
                lines.append(f"{pad}  - {json.dumps(item)}")
            else:
                lines.append(f"{pad}  - {item}")
        return lines
    displayed = mask(key, val)
    if isinstance(displayed, str):
        return [f"{pad}{key}: {displayed}"]
    return [f"{pad}{key}: {json.dumps(displayed)}"]


def show_all(cfg: dict) -> None:
    """Pretty-print all config with sensitive masking."""
    for key, val in cfg.items():
        for line in fmt_value(key, val, indent=0):
            print(line)


def get_key(cfg: dict, key: str):
    """Get a nested value using dot notation."""
    parts = key.split(".")
    cur = cfg
    for p in parts:
        if not isinstance(cur, dict) or p not in cur:
            print(f"Key not found: {key}", file=sys.stderr)
            sys.exit(1)
        cur = cur[p]
    if isinstance(cur, (dict, list)):
        for line in fmt_value(parts[-1], cur, indent=0):
            print(line)
    elif isinstance(cur, str):
        print(cur)
    else:
        print(json.dumps(cur))


def parse_value(val: str):
    """Parse a string value into the appropriate Python type."""
    if val.lower() == "true":
        return True
    if val.lower() == "false":
        return False
    if val.lower() == "null":
        return None
    try:
        return int(val)
    except ValueError:
        pass
    try:
        return float(val)
    except ValueError:
        pass
    # Try JSON (for arrays/objects)
    if val.startswith(("[", "{")):
        try:
            return json.loads(val)
        except json.JSONDecodeError:
            pass
    return val


def set_key(cfg: dict, key: str, val_str: str) -> dict:
    """Set a nested value using dot notation."""
    parts = key.split(".")
    cur = cfg
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = parse_value(val_str)
    return cfg


def unset_key(cfg: dict, key: str) -> dict:
    """Remove a nested key using dot notation."""
    parts = key.split(".")
    cur = cfg
    for p in parts[:-1]:
        if not isinstance(cur, dict) or p not in cur:
            print(f"Key not found: {key}", file=sys.stderr)
            sys.exit(1)
        cur = cur[p]
    if parts[-1] not in cur:
        print(f"Key not found: {key}", file=sys.stderr)
        sys.exit(1)
    del cur[parts[-1]]
    return cfg


def save_config(path: str, cfg: dict) -> None:
    """Save config with backup."""
    backup = path + ".bak"
    if os.path.exists(path):
        shutil.copy2(path, backup)
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")


def main():
    if len(sys.argv) < 2:
        print("Usage: config.py <config_path> [get|set|unset|path] [key] [value]", file=sys.stderr)
        sys.exit(1)

    config_path = sys.argv[1]
    action = sys.argv[2] if len(sys.argv) > 2 else "list"

    if action == "path":
        print(config_path)
        return

    if not os.path.exists(config_path):
        print(f"Config not found: {config_path}", file=sys.stderr)
        print("Run: relaygent setup", file=sys.stderr)
        sys.exit(1)

    with open(config_path) as f:
        cfg = json.load(f)

    if action in ("list", "show"):
        show_all(cfg)
    elif action == "get":
        if len(sys.argv) < 4:
            print("Usage: relaygent config get <key>", file=sys.stderr)
            sys.exit(1)
        get_key(cfg, sys.argv[3])
    elif action == "set":
        if len(sys.argv) < 5:
            print("Usage: relaygent config set <key> <value>", file=sys.stderr)
            sys.exit(1)
        cfg = set_key(cfg, sys.argv[3], " ".join(sys.argv[4:]))
        save_config(config_path, cfg)
        print(f"Set {sys.argv[3]} = {parse_value(' '.join(sys.argv[4:]))}")
    elif action == "unset":
        if len(sys.argv) < 4:
            print("Usage: relaygent config unset <key>", file=sys.stderr)
            sys.exit(1)
        cfg = unset_key(cfg, sys.argv[3])
        save_config(config_path, cfg)
        print(f"Removed {sys.argv[3]}")
    else:
        # Treat as key for get shorthand: `relaygent config hub.port`
        get_key(cfg, action)


if __name__ == "__main__":
    main()
