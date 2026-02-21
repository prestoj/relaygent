"""Environment setup and prompt building for the relay harness."""
import json
import os
from pathlib import Path

from config import PROMPT_FILE

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


def build_prompt() -> bytes:
    """Return PROMPT.md bytes with config substitutions and MEMORY.md appended."""
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
