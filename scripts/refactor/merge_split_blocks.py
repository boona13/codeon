#!/usr/bin/env python3
"""
Merge "split by top-level statements" blocks back into cohesive feature files.

We currently have patterns in renderer/index.html like:
  <!-- X (split by top-level statements; preserve order) -->
  <script src="...modules/.../*.js"></script>
  ...
  <!-- Thin stub (kept at some/path.js) -->
  <script src="some/path.js"></script>

This script:
- Finds each such block
- Concatenates the referenced module scripts (in the same order)
- Overwrites the stub target file with the merged content
- Rewrites index.html to replace the whole block with a single <script src="stubTarget"></script>
- Removes now-unused renderer/**/modules/** directories if they become empty
- Creates backups in renderer/_backups/

Usage:
  python3 scripts/refactor/merge_split_blocks.py
  python3 scripts/refactor/merge_split_blocks.py --dry-run
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import re
import shutil
from typing import List, Tuple


SPLIT_HDR_RE = re.compile(r"split by top-level statements;\s*preserve order", re.IGNORECASE)
SCRIPT_SRC_RE = re.compile(r'<script\s+src="([^"]+)"\s*>\s*</script>')


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


def safe_rmdir_if_empty(path: str) -> bool:
    try:
        if not os.path.isdir(path):
            return False
        if os.listdir(path):
            return False
        os.rmdir(path)
        return True
    except OSError:
        return False


def merge_files(abs_paths: List[str]) -> str:
    parts: List[str] = []
    for p in abs_paths:
        t = read_text(p)
        # ensure clean separation and trailing newline
        if t and not t.endswith("\n"):
            t += "\n"
        parts.append(t)
    merged = "\n".join([p.rstrip("\n") for p in parts]).rstrip("\n") + "\n"
    return merged


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    renderer_dir = os.path.join(repo_root, "renderer")
    index_path = os.path.join(renderer_dir, "index.html")
    backups_dir = os.path.join(renderer_dir, "_backups")

    index_text = read_text(index_path)
    lines = index_text.splitlines(keepends=True)

    out_lines: List[str] = []
    i = 0
    merged_blocks = 0
    touched_targets: List[str] = []
    removed_modules_dirs: List[str] = []

    # Pre-backup index once if we will write.
    did_backup_index = False

    while i < len(lines):
        line = lines[i]
        if "<!--" in line and SPLIT_HDR_RE.search(line):
            # Start of a split block
            hdr_line = line
            j = i + 1
            module_srcs: List[str] = []

            # Collect module scripts until "Thin stub" marker
            while j < len(lines) and "Thin stub" not in lines[j]:
                m = SCRIPT_SRC_RE.search(lines[j])
                if m:
                    src = m.group(1)
                    # skip the stub itself (shouldn't appear before Thin stub)
                    module_srcs.append(src)
                j += 1

            if j >= len(lines):
                # malformed; just pass through
                out_lines.append(lines[i])
                i += 1
                continue

            thin_stub_line = lines[j]
            # Next non-empty line should be the stub script tag
            k = j + 1
            while k < len(lines) and lines[k].strip() == "":
                k += 1
            if k >= len(lines):
                out_lines.append(lines[i])
                i += 1
                continue
            m_stub = SCRIPT_SRC_RE.search(lines[k])
            if not m_stub:
                out_lines.append(lines[i])
                i += 1
                continue
            stub_src = m_stub.group(1)

            # Compute abs paths for module files
            module_abs = [os.path.join(renderer_dir, s) for s in module_srcs]
            stub_abs = os.path.join(renderer_dir, stub_src)

            # Sanity: module srcs should exist
            missing = [p for p in module_abs if not os.path.exists(p)]
            if missing:
                # pass through to avoid breaking
                out_lines.append(lines[i])
                i += 1
                continue

            merged_blocks += 1

            # Replace block with a single script tag for the stub target (same spot)
            out_lines.append(f"  <!-- {stub_src} (merged; order preserved) -->\n")
            out_lines.append(f'  <script src="{stub_src}"></script>\n')

            if not args.dry_run:
                if not did_backup_index:
                    backup_file(index_path, backups_dir)
                    did_backup_index = True

                # Backup and overwrite the stub file with merged contents
                if os.path.exists(stub_abs):
                    backup_file(stub_abs, backups_dir)
                merged_text = merge_files(module_abs)
                write_text(stub_abs, merged_text)
                touched_targets.append(stub_abs)

                # Delete module files
                for p in module_abs:
                    try:
                        os.remove(p)
                    except OSError:
                        pass

                # Try to remove empty modules dirs (walk up)
                for p in module_abs:
                    d = os.path.dirname(p)
                    # remove deepest first; walk up until renderer root or non-empty
                    while True:
                        rel = os.path.relpath(d, renderer_dir).replace("\\", "/")
                        if rel == ".":
                            break
                        if "/modules" not in f"/{rel}/" and not rel.endswith("modules"):
                            break
                        if safe_rmdir_if_empty(d):
                            removed_modules_dirs.append(d)
                        parent = os.path.dirname(d)
                        if parent == d:
                            break
                        d = parent

            # Advance past the entire block:
            # i points to hdr; j points to Thin stub; k points to stub script tag
            i = k + 1
            continue

        out_lines.append(line)
        i += 1

    if args.dry_run:
        print("DRY RUN")
        print(f"- Would merge blocks: {merged_blocks}")
        return 0

    if merged_blocks > 0:
        write_text(index_path, "".join(out_lines))

    print("OK")
    print(f"- Merged blocks: {merged_blocks}")
    if merged_blocks:
        print(f"- Updated index.html: {index_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


