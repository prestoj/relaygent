"""Tests for tasks.py — recurring task management."""
from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

# Load tasks.py as a module
_spec = importlib.util.spec_from_file_location(
    "tasks_mod",
    Path(__file__).resolve().parent.parent.parent / "harness" / "scripts" / "tasks.py",
)
tasks_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tasks_mod)


TASK_TEMPLATE = """\
---
title: Task Queue
---

## Recurring

- [ ] Review KB | type: recurring | freq: 3d | last: {kb_last}
- [ ] Commit KB | type: recurring | freq: 12h | last: {commit_last}
- [ ] Check hub | type: recurring | freq: daily | last: {hub_last}

## One-off

- [ ] Fix the bug | type: one-off
"""


@pytest.fixture()
def tasks_file(tmp_path):
    """Create a tasks.md file with configurable timestamps."""
    def _make(kb_last="2026-02-20 10:00", commit_last="2026-02-25 12:00",
              hub_last="2026-02-25 08:00"):
        content = TASK_TEMPLATE.format(
            kb_last=kb_last, commit_last=commit_last, hub_last=hub_last
        )
        p = tmp_path / "tasks.md"
        p.write_text(content)
        return str(p)
    return _make


class TestParseTasks:
    def test_parses_recurring_tasks(self, tasks_file):
        path = tasks_file()
        tasks = tasks_mod.parse_tasks(path)
        assert len(tasks) == 3
        assert tasks[0]["desc"] == "Review KB"
        assert tasks[0]["freq"] == "3d"
        assert tasks[0]["type"] == "recurring"

    def test_parses_last_timestamp(self, tasks_file):
        path = tasks_file(kb_last="2026-02-20 10:00")
        tasks = tasks_mod.parse_tasks(path)
        kb_task = [t for t in tasks if "Review KB" in t["desc"]][0]
        assert kb_task["last"] == datetime(2026, 2, 20, 10, 0)

    def test_computes_due_date(self, tasks_file):
        path = tasks_file(kb_last="2026-02-20 10:00")
        tasks = tasks_mod.parse_tasks(path)
        kb_task = [t for t in tasks if "Review KB" in t["desc"]][0]
        assert kb_task["due"] == datetime(2026, 2, 23, 10, 0)  # 3 days later

    def test_12h_frequency(self, tasks_file):
        path = tasks_file(commit_last="2026-02-25 12:00")
        tasks = tasks_mod.parse_tasks(path)
        commit_task = [t for t in tasks if "Commit KB" in t["desc"]][0]
        assert commit_task["due"] == datetime(2026, 2, 26, 0, 0)  # 12h later


class TestMarkDone:
    def test_updates_timestamp(self, tasks_file):
        path = tasks_file(kb_last="2026-02-20 10:00")
        tasks = tasks_mod.parse_tasks(path)
        tasks_mod.mark_done(path, tasks, "Review KB")
        updated = tasks_mod.parse_tasks(path)
        kb_task = [t for t in updated if "Review KB" in t["desc"]][0]
        # Should be updated to roughly now
        assert kb_task["last"].date() == datetime.now().date()

    def test_no_match_exits(self, tasks_file):
        path = tasks_file()
        tasks = tasks_mod.parse_tasks(path)
        with pytest.raises(SystemExit):
            tasks_mod.mark_done(path, tasks, "nonexistent task xyz")

    def test_case_insensitive_match(self, tasks_file):
        path = tasks_file(hub_last="2026-02-20 08:00")
        tasks = tasks_mod.parse_tasks(path)
        tasks_mod.mark_done(path, tasks, "check hub")
        updated = tasks_mod.parse_tasks(path)
        hub_task = [t for t in updated if "Check hub" in t["desc"]][0]
        assert hub_task["last"].date() == datetime.now().date()

    def test_ambiguous_match_exits(self, tasks_file):
        path = tasks_file()
        tasks = tasks_mod.parse_tasks(path)
        # "KB" matches both "Review KB" and "Commit KB"
        with pytest.raises(SystemExit):
            tasks_mod.mark_done(path, tasks, "KB")

    def test_other_tasks_unchanged(self, tasks_file):
        path = tasks_file(kb_last="2026-02-20 10:00", hub_last="2026-02-24 08:00")
        tasks = tasks_mod.parse_tasks(path)
        tasks_mod.mark_done(path, tasks, "Review KB")
        updated = tasks_mod.parse_tasks(path)
        hub_task = [t for t in updated if "Check hub" in t["desc"]][0]
        assert hub_task["last"] == datetime(2026, 2, 24, 8, 0)  # unchanged
