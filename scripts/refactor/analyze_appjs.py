#!/usr/bin/env python3
"""
Python wrapper around the Node-based analyzer (TypeScript AST).

Why: user requested a Python entrypoint, but we still want robust parsing.

Usage:
  python3 scripts/refactor/analyze_appjs.py \
    --in /path/to/codeon/renderer/app.js \
    --out /path/to/codeon/scripts/refactor/appjs-parts.json
"""

import argparse
import os
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_file", default="renderer/app.js")
    parser.add_argument("--out", dest="out_file", default="scripts/refactor/appjs-parts.json")
    args = parser.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    node_script = os.path.join(repo_root, "scripts", "refactor", "analyze-appjs.js")

    cmd = ["node", node_script, "--in", args.in_file, "--out", args.out_file]
    try:
        res = subprocess.run(cmd, cwd=repo_root, check=False, capture_output=True, text=True)
    except FileNotFoundError:
        sys.stderr.write("Error: `node` not found on PATH.\n")
        return 2

    if res.stdout:
        sys.stdout.write(res.stdout)
    if res.stderr:
        sys.stderr.write(res.stderr)

    return res.returncode


if __name__ == "__main__":
    raise SystemExit(main())


