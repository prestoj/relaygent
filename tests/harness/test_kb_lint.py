"""Tests for kb-lint.py — KB health checking."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

# Load kb-lint.py as a module (it has a hyphen in the filename)
_spec = importlib.util.spec_from_file_location(
    "kb_lint",
    Path(__file__).resolve().parent.parent.parent / "harness" / "scripts" / "kb-lint.py",
)
kb_lint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kb_lint)


@pytest.fixture()
def kb(tmp_path):
    """Create a minimal KB directory with some topic files."""
    kb_dir = tmp_path / "topics"
    kb_dir.mkdir()
    return kb_dir


def _write_topic(kb_dir, name, content="---\ntitle: Test\n---\n\nContent."):
    """Helper to write a topic file."""
    path = kb_dir / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


class TestBrokenLinks:
    def test_valid_link_not_broken(self, kb, capsys):
        _write_topic(kb, "alpha.md", "---\ntitle: A\n---\n\nSee [[beta]].")
        _write_topic(kb, "beta.md")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Broken links (" not in out  # section header only when > 0
        assert "Broken links:   0" in out

    def test_broken_link_detected(self, kb, capsys):
        _write_topic(kb, "alpha.md", "---\ntitle: A\n---\n\nSee [[nonexistent]].")
        sys.argv = ["kb-lint", str(kb)]
        with pytest.raises(SystemExit):
            kb_lint.main()
        out = capsys.readouterr().out
        assert "[[nonexistent]] in alpha.md" in out
        assert "Broken links:   1" in out

    def test_subdirectory_link_resolves(self, kb, capsys):
        _write_topic(kb, "index.md", "---\ntitle: I\n---\n\nSee [[sub/deep]].")
        _write_topic(kb, "sub/deep.md")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Broken links:   0" in out

    def test_case_insensitive_link(self, kb, capsys):
        _write_topic(kb, "Alpha.md", "---\ntitle: A\n---\n\nContent.")
        _write_topic(kb, "ref.md", "---\ntitle: R\n---\n\nSee [[alpha]].")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Broken links:   0" in out


class TestOversize:
    def test_oversize_detected(self, kb, capsys):
        lines = ["---", "title: Big", "---"] + ["line"] * 200
        _write_topic(kb, "big.md", "\n".join(lines))
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Oversize" in out
        assert "big.md" in out

    def test_under_limit_ok(self, kb, capsys):
        _write_topic(kb, "small.md")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Oversize files" not in out


class TestFrontmatter:
    def test_missing_frontmatter_detected(self, kb, capsys):
        _write_topic(kb, "bad.md", "No frontmatter here.")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Missing frontmatter" in out
        assert "bad.md" in out

    def test_valid_frontmatter_ok(self, kb, capsys):
        _write_topic(kb, "good.md")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Missing frontmatter" not in out


class TestOrphans:
    def test_orphan_detected(self, kb, capsys):
        _write_topic(kb, "lonely.md")
        _write_topic(kb, "other.md")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Orphan" in out

    def test_linked_topic_not_orphan(self, kb, capsys):
        _write_topic(kb, "a.md", "---\ntitle: A\n---\n\nSee [[b]].")
        _write_topic(kb, "b.md", "---\ntitle: B\n---\n\nSee [[a]].")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Orphan topics" not in out  # section header only when > 0

    def test_meta_files_excluded_from_orphans(self, kb, capsys):
        _write_topic(kb, "HANDOFF.md")
        _write_topic(kb, "tasks.md")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "Orphan topics" not in out


class TestHealthy:
    def test_healthy_kb(self, kb, capsys):
        _write_topic(kb, "a.md", "---\ntitle: A\n---\n\nSee [[b]].")
        _write_topic(kb, "b.md", "---\ntitle: B\n---\n\nSee [[a]].")
        sys.argv = ["kb-lint", str(kb)]
        kb_lint.main()
        out = capsys.readouterr().out
        assert "KB is healthy" in out
