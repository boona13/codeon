#!/usr/bin/env python3
"""
Safely extract a part from renderer/app.js into a new renderer/* module file,
replace it with a forwarder in app.js, and update renderer/index.html to load
the new module before app.js.

This is intentionally conservative:
- Only supports extracting top-level `function name(...) { ... }` parts (type: function_decl)
- Makes timestamped backups before editing
- Validates the app.js SHA256 matches the manifest

Usage:
  python3 scripts/refactor/extract_appjs_part.py \
    --manifest scripts/refactor/appjs-parts.json \
    --part-id p123 \
    --out renderer/utils/shell-quote.js \
    --attach Codeon.utils.shellQuote
"""

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import sys
from typing import List, Tuple


RE_FUNC_DECL = re.compile(
    r"^\s*(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(",
    re.MULTILINE,
)


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def split_lines_keepends(text: str) -> List[str]:
    return text.splitlines(keepends=True)


def now_stamp() -> str:
    return _dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def backup_file(src_path: str, backups_dir: str) -> str:
    os.makedirs(backups_dir, exist_ok=True)
    base = os.path.basename(src_path)
    dst_path = os.path.join(backups_dir, f"{base}.{now_stamp()}.bak")
    shutil.copy2(src_path, dst_path)
    return dst_path


def extract_range_by_lines(lines: List[str], start_line: int, end_line: int) -> Tuple[str, List[str]]:
    # start_line/end_line are 1-based inclusive
    if start_line < 1 or end_line < start_line or end_line > len(lines):
        raise ValueError(f"Invalid line range {start_line}-{end_line} (file has {len(lines)} lines)")
    extracted = "".join(lines[start_line - 1 : end_line])
    remaining = lines[: start_line - 1] + lines[end_line:]
    return extracted, remaining


def replace_range_by_lines(lines: List[str], start_line: int, end_line: int, replacement: str) -> List[str]:
    if start_line < 1 or end_line < start_line or end_line > len(lines):
        raise ValueError(f"Invalid line range {start_line}-{end_line} (file has {len(lines)} lines)")
    rep_lines = split_lines_keepends(replacement)
    return lines[: start_line - 1] + rep_lines + lines[end_line:]


def ensure_rel_under_renderer(out_path: str) -> None:
    norm = out_path.replace("\\", "/")
    if not norm.startswith("renderer/"):
        raise ValueError(f"--out must be under renderer/ (got {out_path})")
    if norm == "renderer/app.js":
        raise ValueError("--out cannot be renderer/app.js")


def build_attach_object(assign_path: str) -> Tuple[str, str, str]:
    """
    Given "Codeon.utils.shellQuote" returns:
      root="Codeon", chain="Codeon.utils", prop="shellQuote"
    """
    p = assign_path.strip().lstrip(".")
    if not p or "." not in p:
        raise ValueError("--attach must look like Codeon.utils.shellQuote")
    parts = p.split(".")
    root = parts[0]
    prop = parts[-1]
    chain = ".".join(parts[:-1])
    if not re.match(r"^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$", p):
        raise ValueError(f"Invalid attach path: {assign_path}")
    return root, chain, prop


def insert_script_before_appjs(index_html_text: str, script_src: str) -> str:
    """
    Inserts <script src="..."></script> immediately before the app.js script tag.
    Does nothing if an identical script src already exists.
    """
    if f'src="{script_src}"' in index_html_text:
        return index_html_text

    marker = '<script src="app.js"></script>'
    i = index_html_text.find(marker)
    if i < 0:
        raise ValueError("Could not find <script src=\"app.js\"></script> in renderer/index.html")

    insert = f'  <script src="{script_src}"></script>\n'
    return index_html_text[:i] + insert + index_html_text[i:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="scripts/refactor/appjs-parts.json")
    ap.add_argument("--part-id", required=True)
    ap.add_argument("--out", required=True, help="Destination module file under renderer/, e.g. renderer/utils/shell-quote.js")
    ap.add_argument("--attach", required=True, help="Global attach path, e.g. Codeon.utils.shellQuote")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    manifest_path = os.path.join(repo_root, args.manifest) if not os.path.isabs(args.manifest) else args.manifest
    out_path = os.path.join(repo_root, args.out) if not os.path.isabs(args.out) else args.out
    ensure_rel_under_renderer(os.path.relpath(out_path, repo_root))

    app_js_path = os.path.join(repo_root, "renderer", "app.js")
    index_html_path = os.path.join(repo_root, "renderer", "index.html")
    backups_dir = os.path.join(repo_root, "renderer", "_backups")

    manifest = json.loads(read_text(manifest_path))
    app_text = read_text(app_js_path)

    expected_sha = str(manifest.get("sha256") or "").strip()
    actual_sha = sha256_text(app_text)
    if expected_sha and expected_sha != actual_sha:
        sys.stderr.write(
            "Refusing to proceed: renderer/app.js does not match manifest sha256.\n"
            f"  manifest: {expected_sha}\n"
            f"  current : {actual_sha}\n"
            "Re-run analyze_appjs.py to generate a fresh manifest.\n"
        )
        return 2

    parts = manifest.get("parts") or []
    part = next((p for p in parts if p.get("id") == args.part_id), None)
    if not part:
        sys.stderr.write(f"Part id not found in manifest: {args.part_id}\n")
        return 2
    if part.get("type") != "function_decl":
        sys.stderr.write(
            f"Extractor currently only supports type=function_decl (got {part.get('type')}).\n"
        )
        return 2

    start_line = int(part["startLine"])
    end_line = int(part["endLine"])
    lines = split_lines_keepends(app_text)
    extracted, _remaining = extract_range_by_lines(lines, start_line, end_line)

    m = RE_FUNC_DECL.search(extracted)
    if not m:
        sys.stderr.write("Safety check failed: extracted text does not look like a function declaration.\n")
        return 2
    func_name = m.group(2)

    root, chain, prop = build_attach_object(args.attach)
    if prop != func_name:
        sys.stderr.write(
            f"Safety check failed: --attach property '{prop}' does not match function name '{func_name}'.\n"
            "Use --attach Codeon.utils.<SameNameAsFunction>\n"
        )
        return 2

    module_rel = os.path.relpath(out_path, os.path.join(repo_root, "renderer")).replace("\\", "/")
    script_src = module_rel

    module_text = (
        "(() => {\n"
        "  'use strict';\n"
        "\n"
        f"{extracted.rstrip()}\n"
        "\n"
        f"  window.{root} = window.{root} || {{}};\n"
        f"  window.{chain} = window.{chain} || {{}};\n"
        f"  window.{args.attach} = {func_name};\n"
        "})();\n"
    )

    forwarder = (
        f"function {func_name}() {{\n"
        f"  const fn = window.{args.attach};\n"
        "  if (typeof fn !== 'function') {\n"
        f"    throw new Error('{args.attach} not loaded (script order issue)');\n"
        "  }\n"
        "  return fn.apply(this, arguments);\n"
        "}\n"
    )

    next_app_lines = replace_range_by_lines(lines, start_line, end_line, forwarder)
    next_app_text = "".join(next_app_lines)

    index_text = read_text(index_html_path)
    next_index_text = insert_script_before_appjs(index_text, script_src)

    if args.dry_run:
        sys.stdout.write("DRY RUN\n")
        sys.stdout.write(f"- Would write module: {out_path}\n")
        sys.stdout.write(f"- Would update app.js lines {start_line}-{end_line} with forwarder for {func_name}\n")
        sys.stdout.write(f"- Would insert <script src=\"{script_src}\"></script> before app.js in renderer/index.html\n")
        return 0

    # Backups
    app_bak = backup_file(app_js_path, backups_dir)
    idx_bak = backup_file(index_html_path, backups_dir)

    # Writes
    write_text(out_path, module_text)
    write_text(app_js_path, next_app_text)
    write_text(index_html_path, next_index_text)

    sys.stdout.write("OK\n")
    sys.stdout.write(f"- Backed up app.js  -> {app_bak}\n")
    sys.stdout.write(f"- Backed up index  -> {idx_bak}\n")
    sys.stdout.write(f"- Wrote module     -> {out_path}\n")
    sys.stdout.write(f"- Updated app.js   -> {app_js_path} (replaced {start_line}-{end_line})\n")
    sys.stdout.write(f"- Updated index    -> {index_html_path} (added script before app.js)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


