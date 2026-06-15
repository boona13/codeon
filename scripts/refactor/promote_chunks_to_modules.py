#!/usr/bin/env python3
"""
Promote runtime "chunk" scripts into "module" scripts:
- Move files from renderer/**/chunks/** -> renderer/**/modules/**
- Strip numeric chunk prefixes like 0005- from filenames
- Rewrite renderer/index.html <script src="..."> paths accordingly
- Remove empty chunks directories

This is a filesystem/path refactor only; file contents are unchanged.
Script order in index.html is preserved.

Usage:
  python3 scripts/refactor/promote_chunks_to_modules.py
  python3 scripts/refactor/promote_chunks_to_modules.py --dry-run
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import re
import shutil
from typing import Dict, List, Tuple


CHUNK_PREFIX_RE = re.compile(r"^\d{4}-")


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


def rel_norm(path: str) -> str:
    return path.replace("\\", "/")


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


def compute_mapping(renderer_dir: str) -> List[Tuple[str, str]]:
    """
    Returns list of (old_rel, new_rel) relative to renderer_dir.
    """
    mapping: List[Tuple[str, str]] = []
    for dirpath, dirnames, filenames in os.walk(renderer_dir):
        # only descend into chunks directories or their parents; but simplest: walk all and match paths
        for fn in filenames:
            if not fn.endswith(".js"):
                continue
            abs_path = os.path.join(dirpath, fn)
            rel_path = rel_norm(os.path.relpath(abs_path, renderer_dir))
            if "/chunks/" not in f"/{rel_path}":
                continue

            # replace /chunks/ with /modules/
            new_rel_dir = rel_norm(os.path.dirname(rel_path)).replace("/chunks", "/modules")
            base = os.path.basename(rel_path)
            new_base = CHUNK_PREFIX_RE.sub("", base)
            if new_base == "":
                new_base = base
            new_rel = rel_norm(os.path.join(new_rel_dir, new_base))
            mapping.append((rel_path, new_rel))
    # deterministic order
    mapping.sort()
    return mapping


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    renderer_dir = os.path.join(repo_root, "renderer")
    index_path = os.path.join(renderer_dir, "index.html")
    backups_dir = os.path.join(renderer_dir, "_backups")

    mapping = compute_mapping(renderer_dir)
    if not mapping:
        print("Nothing to do (no renderer/**/chunks/**/*.js found).")
        return 0

    # Rewrite index.html first (in memory) so we can validate all replacements occur
    index_text = read_text(index_path)
    next_index = index_text
    replaced = 0

    for old_rel, new_rel in mapping:
        old_src = old_rel
        new_src = new_rel
        if f'src="{old_src}"' in next_index:
            next_index = next_index.replace(f'src="{old_src}"', f'src="{new_src}"')
            replaced += 1

    if args.dry_run:
        print("DRY RUN")
        print(f"- Would move {len(mapping)} files from chunks -> modules")
        print(f"- Would rewrite {replaced} script src occurrences in renderer/index.html")
        return 0

    # Backup index.html once
    backup_file(index_path, backups_dir)
    write_text(index_path, next_index)

    # Move files
    for old_rel, new_rel in mapping:
        old_abs = os.path.join(renderer_dir, old_rel)
        new_abs = os.path.join(renderer_dir, new_rel)
        os.makedirs(os.path.dirname(new_abs), exist_ok=True)
        if os.path.exists(new_abs):
            # keep safe: backup existing and overwrite
            backup_file(new_abs, backups_dir)
            os.remove(new_abs)
        shutil.move(old_abs, new_abs)

    # Remove empty chunks dirs bottom-up
    chunks_dirs: List[str] = []
    for old_rel, _new_rel in mapping:
        d = os.path.join(renderer_dir, os.path.dirname(old_rel))
        # walk upwards while directory ends with /chunks or contains /chunks/ structure
        while True:
            dn = rel_norm(os.path.relpath(d, renderer_dir))
            if dn == ".":
                break
            if dn.endswith("chunks") or "/chunks/" in f"/{dn}/":
                chunks_dirs.append(d)
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent

    # unique and sort deepest first
    uniq_dirs = sorted(set(chunks_dirs), key=lambda p: p.count(os.sep), reverse=True)
    removed = 0
    for d in uniq_dirs:
        if safe_rmdir_if_empty(d):
            removed += 1

    print("OK")
    print(f"- Moved files: {len(mapping)}")
    print(f"- Updated index.html: {index_path}")
    print(f"- Removed empty chunk dirs: {removed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


