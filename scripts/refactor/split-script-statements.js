#!/usr/bin/env node
/**
 * Split a JS file into multiple ordered chunks by top-level statements using the
 * TypeScript compiler API, then update renderer/index.html to load the chunks
 * instead of the original <script src="...">, and replace the original file
 * with a tiny stub.
 *
 * This preserves execution order and avoids splitting mid-statement.
 *
 * Usage:
 *   node scripts/refactor/split-script-statements.js \
 *     --target renderer/app/editor/editor-tabs.js \
 *     --index renderer/index.html \
 *     --script-src app/editor/editor-tabs.js \
 *     --out-dir renderer/app/editor/chunks \
 *     --max-lines 450
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function parseArgs(argv) {
  const args = {
    target: '',
    index: 'renderer/index.html',
    scriptSrc: '',
    outDir: '',
    maxLines: 450,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target' && argv[i + 1]) args.target = argv[++i];
    else if (a === '--index' && argv[i + 1]) args.index = argv[++i];
    else if (a === '--script-src' && argv[i + 1]) args.scriptSrc = argv[++i];
    else if (a === '--out-dir' && argv[i + 1]) args.outDir = argv[++i];
    else if (a === '--max-lines' && argv[i + 1]) args.maxLines = Number(argv[++i]) || 450;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function backupFile(absPath, backupsDir) {
  mkdirp(backupsDir);
  const base = path.basename(absPath);
  const dst = path.join(backupsDir, `${base}.${nowStamp()}.bak`);
  fs.copyFileSync(absPath, dst);
  return dst;
}

function posToLine1(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function inclusiveEndPos(sf, node) {
  const endExclusive = node.end;
  if (typeof endExclusive !== 'number') return Math.max(node.getStart(sf), 0);
  return Math.max(node.getStart(sf), endExclusive - 1);
}

function chunkStatementsByLines(sf, maxLines) {
  const chunks = [];
  let cur = [];
  let curStartLine = null;
  let curEndLine = null;

  for (const st of sf.statements) {
    const startPos = st.getStart(sf);
    const endPos = inclusiveEndPos(sf, st);
    const sLine = posToLine1(sf, startPos);
    const eLine = posToLine1(sf, endPos);

    if (!cur.length) {
      cur = [st];
      curStartLine = sLine;
      curEndLine = eLine;
      continue;
    }

    const nextEnd = Math.max(curEndLine, eLine);
    const span = (nextEnd - curStartLine) + 1;
    if (span > maxLines) {
      chunks.push({ statements: cur, startLine: curStartLine, endLine: curEndLine });
      cur = [st];
      curStartLine = sLine;
      curEndLine = eLine;
    } else {
      cur.push(st);
      curEndLine = nextEnd;
    }
  }
  if (cur.length) chunks.push({ statements: cur, startLine: curStartLine, endLine: curEndLine });
  return chunks;
}

function extractChunkText(sf, chunk) {
  const start = chunk.statements[0].getStart(sf);
  const end = chunk.statements[chunk.statements.length - 1].end;
  return sf.text.slice(start, end);
}

function safeSlug(s) {
  const t = String(s || '').trim().toLowerCase();
  return t.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'chunk';
}

function firstLabelInChunk(_sf, chunk) {
  for (const st of chunk.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) return `fn-${st.name.text}`;
    if (ts.isClassDeclaration(st) && st.name) return `class-${st.name.text}`;
    if (ts.isVariableStatement(st)) {
      const d = st.declarationList.declarations[0];
      if (d && ts.isIdentifier(d.name)) return `var-${d.name.text}`;
    }
  }
  return `lines-${chunk.startLine}-${chunk.endLine}`;
}

function replaceScriptTag(indexText, scriptSrc, replacementBlock) {
  const marker = `<script src="${scriptSrc}"></script>`;
  const i = indexText.indexOf(marker);
  if (i < 0) throw new Error(`Could not find script tag: ${marker}`);
  return indexText.replace(marker, replacementBlock, 1);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.target || !args.scriptSrc || !args.outDir) {
    process.stdout.write(
      'Usage: node scripts/refactor/split-script-statements.js --target <path> --index renderer/index.html --script-src <src> --out-dir <path> [--max-lines 450] [--dry-run]\n'
    );
    process.exit(args.help ? 0 : 2);
  }

  const repoRoot = process.cwd();
  const targetAbs = path.resolve(repoRoot, args.target);
  const indexAbs = path.resolve(repoRoot, args.index);
  const outDirAbs = path.resolve(repoRoot, args.outDir);
  const backupsDir = path.resolve(repoRoot, 'renderer/_backups');

  const targetText = fs.readFileSync(targetAbs, 'utf8');
  const sf = ts.createSourceFile(
    path.basename(targetAbs),
    targetText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );

  const chunks = chunkStatementsByLines(sf, args.maxLines);

  const relFromRenderer = (absPath) => path.relative(path.resolve(repoRoot, 'renderer'), absPath).split(path.sep).join('/');
  const outSrcPrefix = relFromRenderer(outDirAbs);

  const scriptLines = [];
  scriptLines.push(`  <!-- ${args.scriptSrc} (split by top-level statements; preserve order) -->\n`);

  const planned = [];
  for (let i = 0; i < chunks.length; i++) {
    const label = safeSlug(firstLabelInChunk(sf, chunks[i]));
    const name = `${String(i).padStart(4, '0')}-${label}.js`;
    const outAbs = path.join(outDirAbs, name);
    const outSrc = `${outSrcPrefix}/${name}`;
    planned.push({ outAbs, outSrc, chunk: chunks[i] });
    scriptLines.push(`  <script src="${outSrc}"></script>\n`);
  }
  scriptLines.push(`  <!-- Thin stub (kept at ${args.scriptSrc}) -->\n`);
  scriptLines.push(`  <script src="${args.scriptSrc}"></script>`);
  const replacementBlock = scriptLines.join('');

  const indexText = fs.readFileSync(indexAbs, 'utf8');
  const nextIndexText = replaceScriptTag(indexText, args.scriptSrc, replacementBlock);

  const stub = `// Codeon - stub\n// NOTE: ${args.scriptSrc} was split into ordered chunks under ${outSrcPrefix}/.\n// Chunks are loaded from renderer/index.html.\n\n(function () {\n  'use strict';\n})();\n`;

  if (args.dryRun) {
    process.stdout.write('DRY RUN\n');
    process.stdout.write(`- Would write ${planned.length} chunks into ${args.outDir}\n`);
    process.stdout.write(`- Would update ${args.index} replacing <script src="${args.scriptSrc}"></script>\n`);
    process.stdout.write(`- Would replace ${args.target} with a stub\n`);
    return;
  }

  // Backups
  const bakTarget = backupFile(targetAbs, backupsDir);
  const bakIndex = backupFile(indexAbs, backupsDir);

  // Writes
  mkdirp(outDirAbs);
  for (const p of planned) {
    const content = extractChunkText(sf, p.chunk).replace(/^\n+/, '');
    fs.writeFileSync(p.outAbs, content.endsWith('\n') ? content : content + '\n', 'utf8');
  }
  fs.writeFileSync(indexAbs, nextIndexText, 'utf8');
  fs.writeFileSync(targetAbs, stub, 'utf8');

  process.stdout.write('OK\n');
  process.stdout.write(`- Backed up target -> ${bakTarget}\n`);
  process.stdout.write(`- Backed up index  -> ${bakIndex}\n`);
  process.stdout.write(`- Wrote chunks     -> ${outDirAbs} (${planned.length} files)\n`);
  process.stdout.write(`- Updated index    -> ${indexAbs}\n`);
  process.stdout.write(`- Replaced target  -> ${targetAbs} (stub)\n`);
}

main();


