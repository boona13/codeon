#!/usr/bin/env python3
"""
Python wrapper for scripts/refactor/split-hoist-runtime.js
"""

import argparse
import os
import subprocess
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True)
    ap.add_argument("--script-src", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--index", default="renderer/index.html")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    node_script = os.path.join(repo_root, "scripts", "refactor", "split-hoist-runtime.js")

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


