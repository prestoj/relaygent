"""Tests for handoff validation and goal extraction."""

from pathlib import Path

from handoff import extract_goal, validate_handoff


GOOD_HANDOFF = """\
---
title: Handoff
created: 2026-02-16
updated: 2026-02-21
tags: [meta, continuity]
---

## MAIN GOAL FOR NEXT CLAUDE

**Continue finding and fixing friction points.** Preston said "small improvements, go ahead".

## Current State

- Main branch up to date
- Hub rebuilt

## What Was Done This Session

- Fixed button styling
- Reviewed PRs
"""

MISSING_GOAL = """\
---
title: Handoff
---

## Current State

- All good

## What Was Done This Session

- Nothing much
"""

EMPTY_GOAL = """\
## MAIN GOAL FOR NEXT CLAUDE

## Current State

- Fine
"""

MINIMAL = """\
## MAIN GOAL FOR NEXT CLAUDE

**Do stuff.**

## Current State

OK

## What Was Done

Things
"""

SHORT_CONTENT = "Hello"


class TestExtractGoal:
    def test_extracts_from_good_handoff(self):
        goal = extract_goal(GOOD_HANDOFF)
        assert goal is not None
        assert "friction points" in goal

    def test_strips_bold_markers(self):
        goal = extract_goal(GOOD_HANDOFF)
        assert "**" not in goal

    def test_returns_none_when_no_goal_section(self):
        goal = extract_goal(MISSING_GOAL)
        assert goal is None

    def test_returns_none_when_goal_empty(self):
        goal = extract_goal(EMPTY_GOAL)
        assert goal is None

    def test_truncates_long_goals(self):
        long_goal = "## MAIN GOAL FOR NEXT CLAUDE\n\n**" + "x" * 200 + "**\n"
        goal = extract_goal(long_goal)
        assert goal is not None
        assert len(goal) <= 150

    def test_handles_no_frontmatter(self):
        goal = extract_goal(MINIMAL)
        assert goal is not None
        assert "Do stuff" in goal


class TestValidateHandoff:
    def test_good_handoff_no_warnings(self, tmp_path):
        f = tmp_path / "HANDOFF.md"
        f.write_text(GOOD_HANDOFF)
        warnings, goal = validate_handoff(f)
        assert warnings == []
        assert goal is not None

    def test_missing_file(self, tmp_path):
        f = tmp_path / "HANDOFF.md"
        warnings, goal = validate_handoff(f)
        assert any("not found" in w for w in warnings)
        assert goal is None

    def test_missing_goal_section(self, tmp_path):
        f = tmp_path / "HANDOFF.md"
        f.write_text(MISSING_GOAL)
        warnings, goal = validate_handoff(f)
        assert any("MAIN GOAL" in w for w in warnings)

    def test_missing_required_sections(self, tmp_path):
        f = tmp_path / "HANDOFF.md"
        f.write_text("## MAIN GOAL FOR NEXT CLAUDE\n\n**Do things.**\n")
        warnings, goal = validate_handoff(f)
        assert any("Current State" in w for w in warnings)
        assert any("What Was Done" in w for w in warnings)
        assert goal is not None

    def test_short_content_warning(self, tmp_path):
        f = tmp_path / "HANDOFF.md"
        f.write_text(SHORT_CONTENT)
        warnings, goal = validate_handoff(f)
        assert any("very short" in w for w in warnings)

    def test_empty_goal_warning(self, tmp_path):
        f = tmp_path / "HANDOFF.md"
        f.write_text(EMPTY_GOAL)
        warnings, goal = validate_handoff(f)
        assert any("empty" in w.lower() or "MAIN GOAL" in w for w in warnings)

    def test_returns_goal_with_warnings(self, tmp_path):
        f = tmp_path / "HANDOFF.md"
        f.write_text("## MAIN GOAL FOR NEXT CLAUDE\n\n**Do things.**\n")
        warnings, goal = validate_handoff(f)
        assert len(warnings) > 0  # Missing sections
        assert goal == "Do things."
