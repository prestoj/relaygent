"""Environment setup and prompt building for the relay harness."""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from config import PROMPT_FILE, log

_HARNESS = Path(__file__).parent
CONTEXT_PCT_FILE = Path("/tmp/relaygent-context-pct")

# Claude Code internal env vars that break nested launches
_CLAUDE_INTERNAL = {
    "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
}

# Common binary directories not in LaunchAgent/systemd PATH
_EXTRA_PATH_DIRS = [
    str(Path.home() / ".local" / "bin"),
    str(Path.home() / ".claude" / "local" / "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
]


def configured_model() -> str | None:
    """Read model from config, or None for default."""
    try:
        return json.loads((Path.home() / ".relaygent" / "config.json").read_text()).get("model")
    except (OSError, json.JSONDecodeError, KeyError):
        return None


def _run_orient() -> str:
    """Run orient.sh and return stripped output, or empty string on failure."""
    orient = _HARNESS / "scripts" / "orient.sh"
    if not orient.exists():
        return ""
    try:
        result = subprocess.run(
            ["bash", str(orient)], capture_output=True, text=True, timeout=15,
            cwd=str(_HARNESS.parent),
        )
        if result.returncode != 0:
            return ""
        # Strip ANSI escape codes for clean prompt injection
        return re.sub(r"\x1b\[[0-9;]*m", "", result.stdout).strip()
    except (subprocess.SubprocessError, OSError) as e:
        log(f"Orient pre-compute failed: {e}")
        return ""


def build_prompt() -> bytes:
    """Return PROMPT.md bytes with config substitutions, orient, and MEMORY.md appended."""
    prompt = PROMPT_FILE.read_bytes()
    try:
        cfg = json.loads((Path.home() / ".relaygent" / "config.json").read_text())
        kb = Path(cfg["paths"]["kb"])
        prompt = prompt.replace(b"{KB_DIR}", str(kb).encode())
        prompt = prompt.replace(b"{HUB_PORT}", str(cfg.get("hub", {}).get("port", 8080)).encode())
        mem = (kb / "MEMORY.md").read_text().strip()
        if mem:
            prompt += b"\n\n<memory>\n" + mem.encode() + b"\n</memory>\n"
    except (OSError, json.JSONDecodeError, KeyError):
        pass
    orient_output = _run_orient()
    if orient_output:
        prompt += b"\n\n<orient>\n" + orient_output.encode() + b"\n</orient>\n"
    return prompt


def _augmented_path() -> str:
    """Return PATH with common binary directories appended (for LaunchAgent/systemd)."""
    current = os.environ.get("PATH", "")
    extra = ":".join(d for d in _EXTRA_PATH_DIRS if d not in current)
    return f"{current}:{extra}" if extra and current else (current or extra)


def clean_env() -> dict:
    """Return env without Claude Code internals, with augmented PATH."""
    env = {k: v for k, v in os.environ.items() if k not in _CLAUDE_INTERNAL}
    env["PATH"] = _augmented_path()
    return env


def find_claude_binary() -> str | None:
    """Find the claude CLI binary. Checks env, config, PATH, common locations."""
    override = os.environ.get("CLAUDE_BIN")
    if override and os.path.isfile(override) and os.access(override, os.X_OK):
        return override
    try:
        cfg = json.loads((Path.home() / ".relaygent" / "config.json").read_text())
        cfg_path = cfg.get("claude_path")
        if cfg_path and os.path.isfile(cfg_path) and os.access(cfg_path, os.X_OK):
            return cfg_path
    except (OSError, json.JSONDecodeError, KeyError):
        pass
    return shutil.which("claude", path=_augmented_path())


def ensure_settings() -> Path:
    """Generate settings.json from template, substituting RELAYGENT_DIR."""
    tmpl = _HARNESS / "settings.json.template"
    dest = _HARNESS / "settings.json"
    if tmpl.exists() and (not dest.exists() or tmpl.stat().st_mtime > dest.stat().st_mtime):
        dest.write_text(tmpl.read_text().replace("RELAYGENT_DIR", str(_HARNESS.parent)))
    return dest
