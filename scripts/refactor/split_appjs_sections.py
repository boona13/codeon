#!/usr/bin/env python3
"""
Split renderer/app.js into multiple ordered section files based on banner headings,
update renderer/index.html to load those section scripts (in order) where app.js used to be,
and replace renderer/app.js with a tiny bootstrap file.

Goal: shrink app.js safely while preserving execution order and runtime behavior.

Heuristics:
- Recognizes 3-line banners:
    // ============================================================================
    // TITLE
    // ============================================================================
  Uses the first delimiter line as a section boundary, title is the middle line.
- Recognizes single-line banners like:
    // ============ ATTACHMENT HANDLING ============
  Uses that line as a section boundary, title is extracted from between '=' groups.

It preserves the original code verbatim inside section files and does NOT rewrite identifiers.

Usage:
  python3 scripts/refactor/split_appjs_sections.py

Options:
  --in renderer/app.js
  --index renderer/index.html
  --out-dir renderer/app/sections
  --dry-run
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import re
import shutil
from dataclasses import dataclass
from typing import List, Optional, Tuple


DELIM_RE = re.compile(r"^\s*//\s*=+\s*$")
SINGLE_BANNER_RE = re.compile(r"^\s*//\s*=+\s*[^=].*[^=]\s*=+\s*$")


def now_stamp() -> str:
    return _dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def backup_file(src_path: str, backups_dir: str) -> str:
    os.makedirs(backups_dir, exist_ok=True)
    base = os.path.basename(src_path)
    dst_path = os.path.join(backups_dir, f"{base}.{now_stamp()}.bak")
    shutil.copy2(src_path, dst_path)
    return dst_path


def slugify(title: str) -> str:
    t = title.strip()
    t = re.sub(r"[^\w\s-]+", "", t, flags=re.UNICODE)
    t = t.strip().lower()
    t = re.sub(r"[\s_]+", "-", t)
    t = re.sub(r"-{2,}", "-", t)
    return t or "section"


@dataclass
class Boundary:
    start_index: int  # 0-based line index
    title: str


def extract_title_from_comment_line(line: str) -> str:
    s = line.strip()
    s = re.sub(r"^\s*//\s*", "", s)
    return s.strip()


def extract_title_from_single_banner(line: str) -> str:
    # remove leading //, then trim = and whitespace
    s = re.sub(r"^\s*//\s*", "", line.strip())
    s = s.strip()
    s = s.strip("= ").strip()
    return s or "section"


def find_boundaries(lines: List[str]) -> List[Boundary]:
    boundaries: List[Boundary] = [Boundary(0, "preamble")]

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]

        # 3-line banner
        if i + 2 < n and DELIM_RE.match(line) and DELIM_RE.match(lines[i + 2]):
            title_line = lines[i + 1]
            if not DELIM_RE.match(title_line):
                title = extract_title_from_comment_line(title_line)
                # avoid duplicate boundary at 0
                if i != 0:
                    boundaries.append(Boundary(i, title))
                i += 3
                continue

        # 1-line banner (e.g. "=========== ATTACHMENT HANDLING ===========")
        if SINGLE_BANNER_RE.match(line):
            title = extract_title_from_single_banner(line)
            if i != 0:
                boundaries.append(Boundary(i, title))
            i += 1
            continue

        i += 1

    # Deduplicate boundaries by start_index, keep first title
    seen = set()
    uniq: List[Boundary] = []
    for b in boundaries:
        if b.start_index in seen:
            continue
        seen.add(b.start_index)
        uniq.append(b)

    uniq.sort(key=lambda b: b.start_index)
    return uniq


def slice_sections(lines: List[str], boundaries: List[Boundary]) -> List[Tuple[Boundary, List[str]]]:
    sections: List[Tuple[Boundary, List[str]]] = []
    for idx, b in enumerate(boundaries):
        start = b.start_index
        end = boundaries[idx + 1].start_index if idx + 1 < len(boundaries) else len(lines)
        chunk = lines[start:end]
        sections.append((b, chunk))
    return sections


def replace_appjs_script_tag(index_html: str, new_script_tags: str) -> str:
    # Be strict: replace the first occurrence of the exact canonical tag.
    marker = '<script src="app.js"></script>'
    pos = index_html.find(marker)
    if pos < 0:
        raise ValueError('Could not find <script src="app.js"></script> in renderer/index.html')
    return index_html.replace(marker, new_script_tags, 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_file", default="renderer/app.js")
    ap.add_argument("--index", dest="index_file", default="renderer/index.html")
    ap.add_argument("--out-dir", dest="out_dir", default="renderer/app/sections")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    in_path = os.path.join(repo_root, args.in_file)
    index_path = os.path.join(repo_root, args.index_file)
    out_dir = os.path.join(repo_root, args.out_dir)
    backups_dir = os.path.join(repo_root, "renderer", "_backups")

    app_text = read_text(in_path)
    lines = app_text.splitlines(keepends=True)

    boundaries = find_boundaries(lines)
    sections = slice_sections(lines, boundaries)

    # Build script tags list
    script_lines: List[str] = []
    script_lines.append("  <!-- MAIN APP (split from monolith renderer/app.js; preserve order) -->\n")
    for i, (b, _chunk) in enumerate(sections):
        slug = slugify(b.title)
        filename = f"{i:04d}-{slug}.js"
        rel_src = f"app/sections/{filename}"
        script_lines.append(f'  <script src="{rel_src}"></script>\n')
    script_lines.append("  <!-- Thin bootstrap (kept for compatibility; intentionally tiny) -->\n")
    script_lines.append('  <script src="app.js"></script>')
    new_script_tags = "".join(script_lines)

    # Write section files
    planned_files: List[str] = []
    for i, (b, chunk) in enumerate(sections):
        slug = slugify(b.title)
        filename = f"{i:04d}-{slug}.js"
        out_path = os.path.join(out_dir, filename)
        planned_files.append(out_path)
        # Preserve verbatim content
        content = "".join(chunk)
        if not content.endswith("\n"):
            content += "\n"
        if not args.dry_run:
            write_text(out_path, content)

    # Update index.html
    index_text = read_text(index_path)
    next_index_text = replace_appjs_script_tag(index_text, new_script_tags)

    # Replace app.js with tiny bootstrap
    bootstrap = (
        "// Codeon - App bootstrap\n"
        "// NOTE: The monolithic renderer/app.js was split into ordered scripts under renderer/app/sections/.\n"
        "// Those scripts are loaded from renderer/index.html.\n"
        "// This file is intentionally kept tiny (integration glue only).\n"
        "\n"
        "(function () {\n"
        "  'use strict';\n"
        "  // Reserved for future thin integration glue.\n"
        "})();\n"
    )

    if args.dry_run:
        print("DRY RUN")
        print(f"- Would backup: {in_path} and {index_path} into {backups_dir}")
        print(f"- Would write {len(planned_files)} section files into {out_dir}")
        print(f"- Would replace <script src=\"app.js\"></script> in index.html with section script tags + bootstrap app.js")
        print(f"- Would replace renderer/app.js with bootstrap (~10 lines)")
        return 0

    # Backups
    app_bak = backup_file(in_path, backups_dir)
    idx_bak = backup_file(index_path, backups_dir)

    # Writes
    write_text(index_path, next_index_text)
    write_text(in_path, bootstrap)

    print("OK")
    print(f"- Backed up app.js    -> {app_bak}")
    print(f"- Backed up index.html-> {idx_bak}")
    print(f"- Wrote sections      -> {out_dir} ({len(planned_files)} files)")
    print(f"- Updated index.html  -> {index_path}")
    print(f"- Replaced app.js     -> {in_path} (bootstrap)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


