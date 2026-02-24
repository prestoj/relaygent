#!/usr/bin/env python3
"""KB lint — check knowledge base health (broken links, orphans, oversize)."""
from __future__ import annotations

import os
import re
import sys

CYAN = "\033[0;36m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
RED = "\033[0;31m"
NC = "\033[0m"

MAX_LINES = 200
META_FILES = {
    "HANDOFF", "INTENT", "MEMORY", "tasks", "projects", "curiosities", "machine"
}
WIKI_LINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


def main():
    kb_dir = sys.argv[1]
    print(f"{CYAN}KB Lint{NC} — {kb_dir}\n")

    # Collect all topics
    topics = {}  # basename (no .md) -> filepath
    for root, _dirs, files in os.walk(kb_dir):
        for fname in files:
            if not fname.endswith(".md"):
                continue
            fpath = os.path.join(root, fname)
            base = fname[:-3]  # strip .md
            topics[base] = fpath
            topics[base.lower()] = fpath  # also index lowercase

    incoming = {base: 0 for base in topics}
    broken_links = []
    oversize = []
    no_frontmatter = []
    total_links = 0

    for base, fpath in sorted(topics.items()):
        if base != os.path.basename(fpath)[:-3]:
            continue  # skip lowercase duplicates

        with open(fpath, "r", errors="replace") as f:
            content = f.read()
        lines = content.splitlines()

        # Check size
        if len(lines) > MAX_LINES:
            oversize.append((os.path.basename(fpath), len(lines)))

        # Check frontmatter
        if not lines or lines[0].strip() != "---":
            no_frontmatter.append(os.path.basename(fpath))

        # Check wiki-links
        for match in WIKI_LINK_RE.finditer(content):
            link = match.group(1).strip()
            total_links += 1
            # Try exact, lowercase, hyphens-for-spaces
            candidates = [link, link.lower(), link.lower().replace(" ", "-")]
            found = False
            for c in candidates:
                if c in topics:
                    key = os.path.basename(topics[c])[:-3]
                    incoming[key] = incoming.get(key, 0) + 1
                    found = True
                    break
            if not found:
                broken_links.append(f"[[{link}]] in {os.path.basename(fpath)}")

    # Find orphans (no incoming links, excluding meta files)
    orphans = sorted(
        f"{t}.md" for t, count in incoming.items()
        if count == 0 and t not in META_FILES
        and t == os.path.basename(topics.get(t, ""))[:-3]  # skip lowercase dupes
    )

    # Report
    errors = len(broken_links)
    warnings = len(oversize) + len(no_frontmatter)

    if broken_links:
        print(f"  {RED}Broken links ({len(broken_links)}):{NC}")
        for bl in broken_links:
            print(f"    - {bl}")
        print()

    if oversize:
        print(f"  {YELLOW}Oversize files (>{MAX_LINES} lines):{NC}")
        for name, count in oversize:
            print(f"    - {name} ({count} lines)")
        print()

    if no_frontmatter:
        print(f"  {YELLOW}Missing frontmatter:{NC}")
        for nf in no_frontmatter:
            print(f"    - {nf}")
        print()

    if orphans:
        shown = orphans[:15]
        print(f"  {YELLOW}Orphan topics (no incoming links, {len(orphans)}):{NC}")
        for o in shown:
            print(f"    - {o}")
        if len(orphans) > 15:
            print(f"    ... and {len(orphans) - 15} more")
        print()

    # Summary
    topic_count = len({
        os.path.basename(v)[:-3] for v in topics.values()
    })
    print(f"  {CYAN}Summary:{NC}")
    print(f"    Topics:         {topic_count}")
    print(f"    Wiki-links:     {total_links}")
    print(f"    Broken links:   {len(broken_links)}")
    print(f"    Oversize:       {len(oversize)}")
    print(f"    No frontmatter: {len(no_frontmatter)}")
    print(f"    Orphans:        {len(orphans)}")
    print()

    if errors == 0 and warnings == 0:
        print(f"  {GREEN}KB is healthy — no issues found.{NC}")
    elif errors == 0:
        print(f"  {YELLOW}{warnings} warnings — no critical issues.{NC}")
    else:
        print(f"  {RED}{errors} errors, {warnings} warnings.{NC}")
        sys.exit(1)


if __name__ == "__main__":
    main()
