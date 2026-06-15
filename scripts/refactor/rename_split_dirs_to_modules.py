#!/usr/bin/env python3
"""
Rename renderer/**/_split/** folders produced by split-hoist-runtime into renderer/**/modules/**,
and rewrite renderer/index.html accordingly.

Usage:
  python3 scripts/refactor/rename_split_dirs_to_modules.py
"""

from __future__ import annotations

import datetime as _dt
import os
import shutil


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


def main() -> int:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    renderer_dir = os.path.join(repo_root, "renderer")
    index_path = os.path.join(renderer_dir, "index.html")
    backups_dir = os.path.join(renderer_dir, "_backups")

    # Move folders on disk
    moves = []
    for dirpath, dirnames, _filenames in os.walk(renderer_dir):
        for d in list(dirnames):
            if d != "_split":
                continue
            split_abs = os.path.join(dirpath, d)
            # move each child folder under _split into modules/
            try:
                children = [c for c in os.listdir(split_abs) if os.path.isdir(os.path.join(split_abs, c))]
            except OSError:
                children = []
            for child in children:
                src = os.path.join(split_abs, child)
                dst = os.path.join(dirpath, "modules", child)
                moves.append((src, dst))

    # deterministic
    moves.sort()

    for src, dst in moves:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.exists(dst):
            backup_file(dst, backups_dir)
            shutil.rmtree(dst)
        shutil.move(src, dst)

    # Remove empty _split dirs
    removed = 0
    for dirpath, dirnames, _filenames in os.walk(renderer_dir, topdown=False):
        if os.path.basename(dirpath) == "_split":
            if safe_rmdir_if_empty(dirpath):
                removed += 1

    # Rewrite index.html
    index_text = read_text(index_path)
    next_index = index_text.replace("/_split/", "/modules/")
    if next_index != index_text:
        backup_file(index_path, backups_dir)
        write_text(index_path, next_index)

    print("OK")
    print(f"- Moved folders: {len(moves)}")
    print(f"- Removed empty _split dirs: {removed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


