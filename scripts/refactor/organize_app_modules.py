#!/usr/bin/env python3
"""
Organize the generated renderer/app/sections/*.js files into a cleaner folder layout,
and update renderer/index.html script tags accordingly (preserving order).

This is a filesystem move + path rewrite only: contents remain unchanged.

Usage:
  python3 scripts/refactor/organize_app_modules.py
  python3 scripts/refactor/organize_app_modules.py --dry-run
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import re
import shutil
from typing import Dict, List, Tuple


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


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


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
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    renderer_dir = os.path.join(repo_root, "renderer")
    backups_dir = os.path.join(renderer_dir, "_backups")
    index_path = os.path.join(renderer_dir, "index.html")

    # Mapping: old relative src -> new relative src
    mapping: List[Tuple[str, str]] = [
        ("app/sections/0000-preamble.js", "app/core/preamble.js"),
        ("app/sections/0001-file-explorer-state-vs-code-like-interactions.js", "app/explorer/explorer-state.js"),
        ("app/sections/0002-agents-sub-agents-v1-project-scoped-claudeagentsmd.js", "app/agents/agents-state.js"),
        ("app/sections/0003-skills-v1-project-scoped-claudeskillsskillmd-attach-to-next-message.js", "app/skills/skills-state.js"),
        ("app/sections/0004-console-log-tasks-todo-tool-ui-state.js", "app/console/console-state.js"),
        ("app/sections/0005-problems-monaco-diagnostics-curated-low-risk-integration.js", "app/problems/problems-panel.js"),
        ("app/sections/0006-agents-skills-library-ui-to-createmanage-without-touching-hidden-folders.js", "app/agents/agents-skills-library-ui.js"),
        ("app/sections/0007-codeon-style-chat-persistence-workspace-scoped-bounded-debounced.js", "state/chat-persistence.js"),
        ("app/sections/0008-stream-journal-workspace-storage-high-frequency-small-payload.js", "state/stream-journal.js"),
        ("app/sections/0009-editor-tabs-vs-code-like-multi-file-editing.js", "app/editor/editor-tabs.js"),
        ("app/sections/0010-per-session-run-state-tab-isolation.js", "state/session-run-state.js"),
        ("app/sections/0011-claude-auth-gate-project-open-first-run-ux.js", "ui/modals/claude-auth-gate.js"),
        ("app/sections/0012-git-operations-global-mutex.js", "git/git-operations.js"),
        ("app/sections/0013-agent-execution-timeline-aet-renderer-ui-per-session.js", "aet/aet-session-ui.js"),
        ("app/sections/0014-sticky-prompts-cursor-style-turn-based-containment-sticky-user-prompt.js", "app/chat/sticky-prompts.js"),
        ("app/sections/0015-attachment-handling.js", "app/chat/attachments.js"),
        ("app/sections/0016-chat-status-banner-one-line-live-what-is-the-agent-doing.js", "app/chat/chat-status-banner.js"),
        ("app/sections/0017-welcome-screen-recent-projects.js", "app/welcome/welcome-screen.js"),
    ]

    # Move files on disk
    for old_rel, new_rel in mapping:
        old_abs = os.path.join(renderer_dir, old_rel)
        new_abs = os.path.join(renderer_dir, new_rel)
        if not os.path.exists(old_abs):
            raise FileNotFoundError(f"Missing source file: {old_abs}")
        ensure_dir(os.path.dirname(new_abs))
        if args.dry_run:
            print(f"DRY RUN move: {old_rel} -> {new_rel}")
        else:
            # Overwrite if exists (shouldn't), but keep it safe by backing up old dest first.
            if os.path.exists(new_abs):
                backup_file(new_abs, backups_dir)
                os.remove(new_abs)
            shutil.move(old_abs, new_abs)

    # Update index.html paths
    index_text = read_text(index_path)
    next_index_text = index_text
    for old_rel, new_rel in mapping:
        # Replace exact src attribute values to avoid accidental replacements.
        next_index_text = next_index_text.replace(f'src="{old_rel}"', f'src="{new_rel}"')

    if next_index_text == index_text:
        raise RuntimeError("No changes were applied to index.html (unexpected).")

    if args.dry_run:
        print("DRY RUN update: renderer/index.html script src rewrites")
    else:
        backup_file(index_path, backups_dir)
        write_text(index_path, next_index_text)

    # Clean up empty sections dir (and possibly app dir if empty; app won't be empty)
    sections_dir = os.path.join(renderer_dir, "app", "sections")
    removed_sections = False
    if not args.dry_run:
        removed_sections = safe_rmdir_if_empty(sections_dir)

    print("OK")
    if removed_sections:
        print(f"- Removed empty dir: {sections_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


