#!/usr/bin/env node
/**
 * Analyze renderer/app.js and emit a JSON manifest of top-level extractable parts.
 *
 * This uses the TypeScript compiler API (already in devDependencies) to avoid fragile regex parsing.
 *
 * Usage:
 *   node scripts/refactor/analyze-appjs.js --in renderer/app.js --out scripts/refactor/appjs-parts.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ts = require('typescript');

function parseArgs(argv) {
  const args = { inFile: 'renderer/app.js', outFile: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in' && argv[i + 1]) {
      args.inFile = argv[++i];
    } else if (a === '--out' && argv[i + 1]) {
      args.outFile = argv[++i];
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function getLine1(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function getCol1(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).character + 1;
}

function getInclusiveEndPos(sf, node) {
  // `node.end` is an exclusive position. For inclusive end line/col metadata,
  // use the last character within the node when possible.
  const endExclusive = node.end;
  if (typeof endExclusive !== 'number') return node.getEnd ? node.getEnd() : 0;
  if (endExclusive <= 0) return 0;
  return Math.max(node.getStart(sf), endExclusive - 1);
}

function nodeTextPreview(sf, node) {
  const t = sf.text.slice(node.getStart(sf), node.end);
  const first = t.split(/\r?\n/, 1)[0] || '';
  return first.trim().slice(0, 140);
}

function visitTopLevel(sourceFile) {
  const parts = [];
  let idx = 1;

  for (const st of sourceFile.statements) {
    // Top-level `function name(...) { ... }`
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      const start = st.getStart(sourceFile);
      const end = getInclusiveEndPos(sourceFile, st);
      parts.push({
        id: `p${idx++}`,
        type: 'function_decl',
        name: st.name.text,
        startLine: getLine1(sourceFile, start),
        startCol: getCol1(sourceFile, start),
        endLine: getLine1(sourceFile, end),
        endCol: getCol1(sourceFile, end),
        preview: nodeTextPreview(sourceFile, st),
      });
      continue;
    }

    // Top-level `class Name { ... }`
    if (ts.isClassDeclaration(st) && st.name) {
      const start = st.getStart(sourceFile);
      const end = getInclusiveEndPos(sourceFile, st);
      parts.push({
        id: `p${idx++}`,
        type: 'class_decl',
        name: st.name.text,
        startLine: getLine1(sourceFile, start),
        startCol: getCol1(sourceFile, start),
        endLine: getLine1(sourceFile, end),
        endCol: getCol1(sourceFile, end),
        preview: nodeTextPreview(sourceFile, st),
      });
      continue;
    }

    // Top-level variable statements – record, but extractor will be conservative about these.
    if (ts.isVariableStatement(st)) {
      const decls = st.declarationList?.declarations || [];
      for (const d of decls) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        const kind = init
          ? (ts.isArrowFunction(init) ? 'arrow_function'
            : ts.isFunctionExpression(init) ? 'function_expr'
            : ts.isObjectLiteralExpression(init) ? 'object_literal'
            : ts.isCallExpression(init) ? 'call_expr'
            : ts.isArrayLiteralExpression(init) ? 'array_literal'
            : 'value')
          : 'decl';
        const start = st.getStart(sourceFile);
        const end = getInclusiveEndPos(sourceFile, st);
        parts.push({
          id: `p${idx++}`,
          type: `var_${kind}`,
          name: d.name.text,
          startLine: getLine1(sourceFile, start),
          startCol: getCol1(sourceFile, start),
          endLine: getLine1(sourceFile, end),
          endCol: getCol1(sourceFile, end),
          preview: nodeTextPreview(sourceFile, st),
        });
      }
      continue;
    }
  }

  return parts;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/refactor/analyze-appjs.js --in renderer/app.js --out scripts/refactor/appjs-parts.json\n'
    );
    process.exit(0);
  }

  const inAbs = path.resolve(process.cwd(), args.inFile);
  const text = fs.readFileSync(inAbs, 'utf8');

  const sourceFile = ts.createSourceFile(
    path.basename(inAbs),
    text,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.JS
  );

  const parts = visitTopLevel(sourceFile);
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    inputFile: args.inFile,
    sha256: sha256Text(text),
    parts,
  };

  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (args.outFile) {
    const outAbs = path.resolve(process.cwd(), args.outFile);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, json, 'utf8');
  } else {
    process.stdout.write(json);
  }
}

main();


