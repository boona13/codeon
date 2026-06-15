#!/usr/bin/env node
/**
 * Split a large plain-script file into:
 *  - hoisted.js: all top-level FunctionDeclaration/ClassDeclaration statements (hoisting-safe)
 *  - runtime.js: everything else (variables + side effects) in original order
 *
 * Then update renderer/index.html, replacing the original <script src="..."></script>
 * with:
 *   <!-- <src> (hoist/runtime split; preserve behavior) -->
 *   <script src="<out>/hoisted.js"></script>
 *   <script src="<out>/runtime.js"></script>
 *   <script src="<src>"></script>  (thin stub)
 *
 * Finally, replace the original target file with a tiny stub.
 *
 * Usage:
 *   node scripts/refactor/split-hoist-runtime.js \
 *     --target renderer/app/editor/editor-tabs.js \
 *     --index renderer/index.html \
 *     --script-src app/editor/editor-tabs.js \
 *     --out-dir renderer/app/editor/modules/editor-tabs
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
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target' && argv[i + 1]) args.target = argv[++i];
    else if (a === '--index' && argv[i + 1]) args.index = argv[++i];
    else if (a === '--script-src' && argv[i + 1]) args.scriptSrc = argv[++i];
    else if (a === '--out-dir' && argv[i + 1]) args.outDir = argv[++i];
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

function relFromRenderer(repoRoot, absPath) {
  return path.relative(path.resolve(repoRoot, 'renderer'), absPath).split(path.sep).join('/');
}

function sliceStatementsText(sf, statements) {
  if (!statements.length) return '';
  const text = sf.text;
  const parts = [];
  for (const st of statements) {
    const start = st.getFullStart();
    const end = st.end;
    parts.push(text.slice(start, end));
  }
  let out = parts.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
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
      'Usage: node scripts/refactor/split-hoist-runtime.js --target <path> --script-src <src> --out-dir <path> [--index renderer/index.html] [--dry-run]\n'
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

  const hoisted = [];
  const runtime = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) hoisted.push(st);
    else runtime.push(st);
  }

  const fileHeader = sf.statements.length
    ? targetText.slice(0, sf.statements[0].getFullStart())
    : targetText;

  const hoistedText =
    `${fileHeader}` +
    `// ---- GENERATED: hoisted declarations extracted from ${args.scriptSrc} ----\n` +
    sliceStatementsText(sf, hoisted);

  const runtimeText =
    `// ---- GENERATED: runtime statements extracted from ${args.scriptSrc} ----\n` +
    sliceStatementsText(sf, runtime);

  const outSrcPrefix = relFromRenderer(repoRoot, outDirAbs);
  const hoistedSrc = `${outSrcPrefix}/hoisted.js`;
  const runtimeSrc = `${outSrcPrefix}/runtime.js`;

  const replacementBlock =
    `  <!-- ${args.scriptSrc} (hoist/runtime split; preserve behavior) -->\n` +
    `  <script src="${hoistedSrc}"></script>\n` +
    `  <script src="${runtimeSrc}"></script>\n` +
    `  <!-- Thin stub (kept at ${args.scriptSrc}) -->\n` +
    `  <script src="${args.scriptSrc}"></script>`;

  const indexText = fs.readFileSync(indexAbs, 'utf8');
  const nextIndexText = replaceScriptTag(indexText, args.scriptSrc, replacementBlock);

  const stub = `// Codeon - stub\n// NOTE: ${args.scriptSrc} was split into:\\n//   - ${hoistedSrc}\\n//   - ${runtimeSrc}\\n// Loaded from renderer/index.html.\\n\n(function () { 'use strict'; })();\n`;

  if (args.dryRun) {
    process.stdout.write('DRY RUN\n');
    process.stdout.write(`- Would write: ${path.join(outDirAbs, 'hoisted.js')}\n`);
    process.stdout.write(`- Would write: ${path.join(outDirAbs, 'runtime.js')}\n`);
    process.stdout.write(`- Would update index: ${args.index}\n`);
    process.stdout.write(`- Would replace target with stub: ${args.target}\n`);
    return;
  }

  // Backups
  const bakTarget = backupFile(targetAbs, backupsDir);
  const bakIndex = backupFile(indexAbs, backupsDir);

  // Writes
  mkdirp(outDirAbs);
  fs.writeFileSync(path.join(outDirAbs, 'hoisted.js'), hoistedText, 'utf8');
  fs.writeFileSync(path.join(outDirAbs, 'runtime.js'), runtimeText, 'utf8');
  fs.writeFileSync(indexAbs, nextIndexText, 'utf8');
  fs.writeFileSync(targetAbs, stub, 'utf8');

  process.stdout.write('OK\n');
  process.stdout.write(`- Backed up target -> ${bakTarget}\n`);
  process.stdout.write(`- Backed up index  -> ${bakIndex}\n`);
  process.stdout.write(`- Wrote hoisted    -> ${path.join(outDirAbs, 'hoisted.js')}\n`);
  process.stdout.write(`- Wrote runtime    -> ${path.join(outDirAbs, 'runtime.js')}\n`);
  process.stdout.write(`- Updated index    -> ${indexAbs}\n`);
  process.stdout.write(`- Stubbed target   -> ${targetAbs}\n`);
}

main();


