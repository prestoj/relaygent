"""Environment setup and prompt building for the relay harness."""
import json
import os
import re
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


def clean_env() -> dict:
    """Return env without Claude Code internals so nested launches don't fail."""
    return {k: v for k, v in os.environ.items() if k not in _CLAUDE_INTERNAL}


def ensure_settings() -> Path:
    """Generate settings.json from template, substituting RELAYGENT_DIR."""
    tmpl = _HARNESS / "settings.json.template"
    dest = _HARNESS / "settings.json"
    if tmpl.exists() and (not dest.exists() or tmpl.stat().st_mtime > dest.stat().st_mtime):
        dest.write_text(tmpl.read_text().replace("RELAYGENT_DIR", str(_HARNESS.parent)))
    return dest
