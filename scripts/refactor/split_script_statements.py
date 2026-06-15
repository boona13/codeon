#!/usr/bin/env python3
"""
Python wrapper for scripts/refactor/split-script-statements.js

Usage (example):
  python3 scripts/refactor/split_script_statements.py \
    --target renderer/app/editor/editor-tabs.js \
    --script-src app/editor/editor-tabs.js \
    --out-dir renderer/app/editor/chunks \
    --max-lines 450
"""

import argparse
import os
import subprocess
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True)
    ap.add_argument("--index", default="renderer/index.html")
    ap.add_argument("--script-src", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--max-lines", default="450")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    node_script = os.path.join(repo_root, "scripts", "refactor", "split-script-statements.js")

    cmd = [
        "node",
        node_script,
        "--target",
        args.target,
        "--index",
        args.index,
        "--script-src",
        args.script_src,
        "--out-dir",
        args.out_dir,
        "--max-lines",
        str(args.max_lines),
    ]
    if args.dry_run:
        cmd.append("--dry-run")

    res = subprocess.run(cmd, cwd=repo_root, check=False, capture_output=True, text=True)
    if res.stdout:
        sys.stdout.write(res.stdout)
    if res.stderr:
        sys.stderr.write(res.stderr)
    return res.returncode


if __name__ == "__main__":
    raise SystemExit(main())


