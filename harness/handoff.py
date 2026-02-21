"""Handoff validation and goal extraction for HANDOFF.md."""

import re
from pathlib import Path

from config import REPO_DIR, log

HANDOFF_PATH = REPO_DIR / "knowledge" / "topics" / "HANDOFF.md"

REQUIRED_SECTIONS = [
    "MAIN GOAL",
    "Current State",
    "What Was Done",
]


def _strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter (--- ... ---) from markdown."""
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            return text[end + 3:].lstrip("\n")
    return text


def _extract_sections(text: str) -> dict[str, str]:
    """Extract markdown sections (## headings) into a dict."""
    sections: dict[str, str] = {}
    current_heading = None
    current_lines: list[str] = []

    for line in text.split("\n"):
        m = re.match(r"^##\s+(.+)", line)
        if m:
            if current_heading is not None:
                sections[current_heading] = "\n".join(current_lines).strip()
            current_heading = m.group(1).strip()
            current_lines = []
        elif current_heading is not None:
            current_lines.append(line)

    if current_heading is not None:
        sections[current_heading] = "\n".join(current_lines).strip()

    return sections


def extract_goal(text: str) -> str | None:
    """Extract the main goal from HANDOFF.md content.

    Looks for a ## heading containing 'MAIN GOAL' and returns
    the first non-empty content line (stripped of markdown formatting).
    """
    body = _strip_frontmatter(text)
    for line in body.split("\n"):
        if re.match(r"^##\s+.*MAIN GOAL", line, re.IGNORECASE):
            # Grab the first non-empty line after the heading, stop at next section
            idx = body.index(line) + len(line)
            for subsequent in body[idx:].split("\n"):
                if re.match(r"^##\s+", subsequent):
                    break  # Hit next section — goal is empty
                cleaned = subsequent.strip()
                cleaned = re.sub(r"^[*#\- ]+", "", cleaned)
                cleaned = cleaned.replace("**", "").replace("*", "").strip()
                if cleaned:
                    return cleaned[:150]
    return None


def validate_handoff(path: Path | None = None) -> tuple[list[str], str | None]:
    """Validate HANDOFF.md and extract the main goal.

    Returns (warnings, goal) where warnings is a list of issues found
    and goal is the extracted main goal string (or None).
    """
    path = path or HANDOFF_PATH
    warnings: list[str] = []

    if not path.exists():
        return ["HANDOFF.md not found"], None

    try:
        text = path.read_text()
    except OSError as e:
        return [f"Could not read HANDOFF.md: {e}"], None

    if len(text.strip()) < 50:
        warnings.append("HANDOFF.md is very short (< 50 chars)")

    body = _strip_frontmatter(text)
    sections = _extract_sections(body)
    section_names = list(sections.keys())

    for required in REQUIRED_SECTIONS:
        found = any(required.lower() in name.lower() for name in section_names)
        if not found:
            warnings.append(f"Missing section: {required}")

    goal = extract_goal(text)
    if goal is None:
        warnings.append("Could not extract MAIN GOAL — section may be empty")
    elif len(goal) < 10:
        warnings.append(f"MAIN GOAL is very short ({len(goal)} chars)")

    return warnings, goal


def validate_and_log(path: Path | None = None) -> str | None:
    """Validate handoff and log any warnings. Returns the goal."""
    warnings, goal = validate_handoff(path)
    if warnings:
        for w in warnings:
            log(f"Handoff warning: {w}")
    else:
        log("Handoff validated OK")
    if goal:
        log(f"Handoff goal: {goal[:80]}{'...' if len(goal) > 80 else ''}")
    return goal
