const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// Anti-slop UI design guidance (injected into the system prompt for frontend work)
let buildAntiSlopAppend;
try {
  ({ buildAntiSlopAppend } = require('./main/design/anti-slop'));
} catch (err) {
  console.warn('[Claude SDK] Anti-slop design module unavailable:', err?.message || err);
  buildAntiSlopAppend = () => '';
}

// ============================================================================
// AET debug instrumentation (dev only)
// - Enabled by main process via globalThis.__CODEON_AET_DEBUG, or env CODEON_AET_DEBUG=1
// ============================================================================
function aetDebugEnabled() {
  try {
    if (globalThis && globalThis.__CODEON_AET_DEBUG === true) return true;
    return String(process.env.CODEON_AET_DEBUG || '').trim() === '1';
  } catch {
    return false;
  }
}
function aetDebugLog(...args) {
  try {
    if (!aetDebugEnabled()) return;
    console.log('[AET:DEBUG]', ...args);
  } catch {
    // ignore
  }
}

// ============================================================================
// Nodes v2.0 foundations: run controls (pause-before-next-tool / cancelled) + file locks
// ============================================================================
const runControlsByRequestId = new Map(); // requestId -> { pauseBeforeNextTool: boolean, cancelled: boolean, permissionMode?: string, resumePermissionMode?: string }
// Secondary channel: pause state keyed by UI session id (chat tab).
// This makes pause robust even if requestId tracking is briefly stale in the renderer.
const pauseBeforeNextToolByUiSessionId = new Map(); // uiSessionId -> boolean

function resetClaudeSdkPauseState({ uiSessionId = null } = {}) {
  try {
    const sid = typeof uiSessionId === 'string' ? uiSessionId.trim() : '';
    if (sid) {
      pauseBeforeNextToolByUiSessionId.delete(sid);
      // requestId-scoped controls are ephemeral; no reliable mapping to uiSessionId here.
      return { success: true };
    }
    pauseBeforeNextToolByUiSessionId.clear();
    runControlsByRequestId.clear();
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

// Tools that should NOT be gated by the pause-before-next-tool UX.
// Rationale: Some tools are internal bookkeeping (e.g. TodoWrite) and skipping them can
// destabilize the agent loop / task planner without providing meaningful user control.
const PAUSE_AUTO_CONTINUE_TOOLS = new Set(['TodoWrite']);

function getClaudeSdkRunControl(requestId) {
  const id = String(requestId || '').trim();
  if (!id) return { pauseBeforeNextTool: false, cancelled: false, permissionMode: 'acceptEdits', resumePermissionMode: 'acceptEdits' };
  const cur = runControlsByRequestId.get(id);
  if (cur && typeof cur === 'object') return cur;
  const next = { pauseBeforeNextTool: false, cancelled: false, permissionMode: 'acceptEdits', resumePermissionMode: 'acceptEdits' };
  runControlsByRequestId.set(id, next);
  return next;
}

function setClaudeSdkRunControl(requestId, patch = {}) {
  const id = String(requestId || '').trim();
  if (!id) return { success: false, error: 'Missing requestId' };
  const cur = getClaudeSdkRunControl(id);
  try {
    if (typeof patch.pauseBeforeNextTool === 'boolean') {
      cur.pauseBeforeNextTool = patch.pauseBeforeNextTool;
    }
    if (typeof patch.cancelled === 'boolean') {
      cur.cancelled = patch.cancelled;
      if (patch.cancelled === true) cur.pauseBeforeNextTool = false;
    }
    if (typeof patch.permissionMode === 'string' && patch.permissionMode.trim()) {
      cur.permissionMode = patch.permissionMode.trim();
    }
    if (typeof patch.resumePermissionMode === 'string' && patch.resumePermissionMode.trim()) {
      cur.resumePermissionMode = patch.resumePermissionMode.trim();
    }
    const sid = typeof patch.uiSessionId === 'string' ? patch.uiSessionId.trim() : '';
    if (sid && typeof patch.pauseBeforeNextTool === 'boolean') {
      pauseBeforeNextToolByUiSessionId.set(sid, patch.pauseBeforeNextTool === true);
    }
  } catch {
    // ignore
  }
  runControlsByRequestId.set(id, cur);
  return { success: true, control: { ...cur } };
}

const locksCacheByProjectRoot = new Map(); // projectRoot -> { mtimeMs, size, loadedAt, locksByRelPath }

async function loadProjectLocks(projectRoot, { noCache = false } = {}) {
  const root = String(projectRoot || '').trim();
  if (!root) return { locksByRelPath: {} };
  const fp = path.join(root, '.ai-agent', 'locks.json');
  try {
    const st = await fs.promises.stat(fp);
    const mtimeMs = Number(st?.mtimeMs || 0);
    const size = Number(st?.size || 0);
    const now = Date.now();
    const cached = locksCacheByProjectRoot.get(root);
    // For correctness, allow callers to bypass cache (used for edit tools).
    if (!noCache && cached && cached.mtimeMs === mtimeMs && cached.size === size && cached.locksByRelPath) {
      return { locksByRelPath: cached.locksByRelPath };
    }
    const raw = await fs.promises.readFile(fp, 'utf8');
    const parsed = JSON.parse(String(raw || '') || '{}');
    const locksObj = parsed && typeof parsed === 'object' && parsed.locks && typeof parsed.locks === 'object' ? parsed.locks : {};
    const out = {};
    for (const [k, v] of Object.entries(locksObj)) {
      let key = String(k || '').trim().replace(/\\/g, '/');
      if (!key) continue;
      // Allow legacy absolute keys, but always enforce by project-relative path.
      if (path.isAbsolute(key)) {
        const abs = path.resolve(key);
        if (!isPathInsideRoot(root, abs)) continue;
        const relInside = toRelPathInsideProject(root, abs);
        if (!relInside || relInside === '.') continue;
        key = relInside;
      }
      const rel = normalizeRelPath(key);
      if (!rel || rel === '.') continue;
      out[rel] = (v && typeof v === 'object') ? v : { lockedAt: Date.now(), lockedBy: 'unknown' };
    }
    locksCacheByProjectRoot.set(root, { mtimeMs, size, loadedAt: now, locksByRelPath: out });
    return { locksByRelPath: out };
  } catch {
    // Missing or invalid file => no locks.
    locksCacheByProjectRoot.set(root, { mtimeMs: 0, size: 0, loadedAt: Date.now(), locksByRelPath: {} });
    return { locksByRelPath: {} };
  }
}

function _bashCommandLooksMutating(cmd) {
  const s = String(cmd || '');
  if (!s.trim()) return false;
  // Heuristic: treat common mutation patterns as "write-like".
  // This is intentionally conservative: we only use this to protect locked files.
  const lower = s.toLowerCase();
  if (lower.includes(' sed -i') || lower.includes('sed -i') || lower.includes(' perl -pi') || lower.includes('perl -pi')) return true;
  if (lower.includes(' tee ') || lower.startsWith('tee ') || lower.includes('>>') || lower.includes('>')) return true;
  if (lower.includes(' mv ') || lower.startsWith('mv ')) return true;
  if (lower.includes(' cp ') || lower.startsWith('cp ')) return true;
  if (lower.includes(' rm ') || lower.startsWith('rm ')) return true;
  if (lower.includes(' truncate ') || lower.startsWith('truncate ')) return true;
  if (lower.includes(' git apply') || lower.includes(' git checkout') || lower.includes(' git restore')) return true;
  return false;
}

function _bashCommandMentionsLockedPath(cmd, lockedRelPath) {
  try {
    const s = String(cmd || '');
    if (!s) return false;
    const rel = normalizeRelPath(String(lockedRelPath || ''));
    if (!rel) return false;
    const base = path.posix.basename(rel);
    // Very lightweight matching; combined with mutation heuristic to avoid noisy false positives.
    return s.includes(rel) || (base && s.includes(base));
  } catch {
    return false;
  }
}

function withAugmentedPath(env) {
  try {
    if (!env || typeof env !== 'object') return env;

    const delimiter = path.delimiter || ':';
    const current = typeof env.PATH === 'string' && env.PATH.trim()
      ? env.PATH
      : (typeof process.env.PATH === 'string' ? process.env.PATH : '');

    // Finder-launched macOS apps often have a very minimal PATH (missing Homebrew),
    // which breaks locating common binaries. Add common locations.
    const extra = [];
    if (process.platform === 'darwin') {
      extra.push(
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/local/sbin',
        path.join(os.homedir(), '.local', 'bin'),
        path.join(os.homedir(), 'bin')
      );
    }

    const parts = []
      .concat(extra)
      .concat(String(current || '').split(delimiter))
      .map((p) => String(p || '').trim())
      .filter(Boolean);

    // De-dupe while preserving order.
    const seen = new Set();
    const deduped = [];
    for (const p of parts) {
      if (seen.has(p)) continue;
      seen.add(p);
      deduped.push(p);
    }

    env.PATH = deduped.join(delimiter);
  } catch {
    // ignore
  }
  return env;
}

function applyElectronRunAsNode({ env, options }) {
  // The Agent SDK defaults to spawning `node` to run its bundled `cli.js`.
  // In packaged apps (Finder launch), `node` may not exist on PATH, causing: spawn node ENOENT.
  //
  // Electron can run as Node when ELECTRON_RUN_AS_NODE=1, so we can always use process.execPath.
  //
  // However, spawning the main app executable can briefly surface as a "new app/window" on macOS.
  // Prefer the helper executable when available (it is background-only and avoids visible flicker).
  try {
    if (!env || typeof env !== 'object') return;
    if (!options || typeof options !== 'object') return;
    if (!process.versions || !process.versions.electron) return;
    if (typeof process.execPath !== 'string' || !process.execPath) return;

    env.ELECTRON_RUN_AS_NODE = '1';
    let runner = process.execPath;
    try {
      if (process.platform === 'darwin') {
        const appName = path.basename(process.execPath);
        const contentsDir = path.resolve(process.execPath, '..', '..'); // .../Contents
        const frameworksDir = path.join(contentsDir, 'Frameworks');
        const helperExec = path.join(
          frameworksDir,
          `${appName} Helper.app`,
          'Contents',
          'MacOS',
          `${appName} Helper`
        );
        if (helperExec && fs.existsSync(helperExec)) {
          runner = helperExec;
        }
      }
    } catch {
      // ignore
    }

    options.executable = runner;
    options.executableArgs = [];
  } catch {
    // ignore
  }
}

// NOTE: We intentionally do NOT fall back to direct Anthropic API calls.
// If the Claude Code subprocess stalls, we surface a clear error and include
// subprocess stderr (when available) to make the root cause diagnosable.

async function execGitAllowNonZero(projectRoot, args, { maxBuffer } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: projectRoot, maxBuffer: maxBuffer ?? (10 * 1024 * 1024) });
    return typeof stdout === 'string' ? stdout : '';
  } catch (e) {
    // Some git commands (notably `git diff --no-index`) exit with code 1 when changes exist.
    // `execFileAsync` rejects in that case, but still includes stdout.
    const out = e && typeof e === 'object' && typeof e.stdout === 'string' ? e.stdout : '';
    return out || '';
  }
}

async function gitStatusPorcelainForPath(projectRoot, relPath) {
  const out = await execGitAllowNonZero(projectRoot, ['status', '--porcelain', '--', relPath], { maxBuffer: 512 * 1024 });
  const line = out.split('\n').map(l => l.trimEnd()).find(Boolean);
  return line || '';
}

async function gitDiffForPath(projectRoot, relPath) {
  try {
    const statusLine = await gitStatusPorcelainForPath(projectRoot, relPath);

    // New/untracked file: normal `git diff -- <file>` returns nothing.
    // Use `--no-index` to diff against /dev/null.
    if (statusLine.startsWith('??')) {
      return await execGitAllowNonZero(projectRoot, ['diff', '--no-index', '--no-color', '--', '/dev/null', relPath]);
    }

    // Staged additions/deletions should be diffed from the index.
    const x = statusLine.length >= 1 ? statusLine[0] : ' ';
    if (x === 'A' || x === 'D') {
      const cached = await execGitAllowNonZero(projectRoot, ['diff', '--cached', '--no-color', '--', relPath]);
      if (cached && cached.trim()) return cached;
    }

    // Default: prefer working-tree diff; fall back to cached diff if the file is staged-only.
    const wd = await execGitAllowNonZero(projectRoot, ['diff', '--no-color', '--', relPath]);
    if (wd && wd.trim()) return wd;
    const cached = await execGitAllowNonZero(projectRoot, ['diff', '--cached', '--no-color', '--', relPath]);
    return typeof cached === 'string' ? cached : '';
  } catch {
    return '';
  }
}

async function gitStatusPorcelain(projectRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectRoot, maxBuffer: 2 * 1024 * 1024 });
    return typeof stdout === 'string' ? stdout : '';
  } catch {
    return '';
  }
}

function normalizeRelPath(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

const CLAUDE_PLAN_DIR = (() => {
  try {
    return path.resolve(os.homedir(), '.claude', 'plans');
  } catch {
    return '';
  }
})();

function normalizePathForCompare(p) {
  const s = String(p || '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

function slugifyWorkspaceName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'workspace';
  const ascii = raw.replace(/[^\x20-\x7E]/g, '');
  const clean = ascii.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return clean || 'workspace';
}

function shortHash(input) {
  try {
    return crypto.createHash('sha1').update(String(input || '')).digest('hex').slice(0, 8);
  } catch {
    return '00000000';
  }
}

function isAllowedClaudePlanPath(absPath) {
  try {
    const resolved = path.resolve(String(absPath || ''));
    if (!resolved || !CLAUDE_PLAN_DIR) return false;
    const resolvedNorm = normalizePathForCompare(resolved);
    const planNorm = normalizePathForCompare(CLAUDE_PLAN_DIR);
    if (!resolvedNorm.startsWith(planNorm + path.sep)) return false;
    if (!resolved.toLowerCase().endsWith('.md')) return false;
    return true;
  } catch {
    return false;
  }
}

function isAllowedHiddenRelPath(relPath) {
  const p = normalizeRelPath(relPath);
  if (!p) return false;
  if (p === '.gitignore') return true;
  if (p.endsWith('/.gitignore')) return true;
  return false;
}

function isHiddenOrInternalRelPath(relPath) {
  const p = normalizeRelPath(relPath);
  if (!p || p === '.') return true;
  if (isAllowedHiddenRelPath(p)) return false;
  // Explicit internal app state (never show in code diffs)
  // Allow ONLY the attachments subfolder so Claude can read user-provided files,
  // while still protecting all other internal state under .ai-agent/.
  if (p === '.ai-agent/attachments' || p.startsWith('.ai-agent/attachments/')) return false;
  if (p === '.ai-agent' || p.startsWith('.ai-agent/') || p.includes('/.ai-agent/')) return true;
  // Git internals
  if (p === '.git' || p.startsWith('.git/') || p.includes('/.git/')) return true;
  // Any hidden segment (dotfiles / dotfolders)
  const parts = p.split('/').filter(Boolean);
  return parts.some(seg => seg.startsWith('.') && seg !== '.' && seg !== '..');
}

// Strict hidden path check (no exceptions). Used to enforce "do not list/edit/delete hidden files".
function isStrictHiddenRelPath(relPath) {
  const p = normalizeRelPath(relPath);
  if (!p || p === '.') return true;
  if (isAllowedHiddenRelPath(p)) return false;
  const parts = p.split('/').filter(Boolean);
  return parts.some(seg => seg.startsWith('.') && seg !== '.' && seg !== '..');
}

function bashCommandLooksLikeHiddenListing(cmd) {
  try {
    const s = String(cmd || '');
    if (!s.trim()) return false;
    // Explicit "list hidden" flags
    if (/\bls\b[^\n]*(\s-\w*a\w*|\s--all\b|\s--almost-all\b)/i.test(s)) return true;
    // Common patterns that enumerate dotfiles explicitly
    if (/\bfind\b[^\n]*(\s-name\s+['"]\.\*['"]|\s-name\s+\\\.\\\*)/i.test(s)) return true;
    if (/\bglob\b[^\n]*\.\*/i.test(s)) return true;
    // Direct dotfile paths (avoid matching "./" or "../")
    if (/(^|\s)(\.[A-Za-z0-9_-][^\s]*)/.test(s)) return true;
    if (/(^|\s)(\.\.\/\.[^\s]+|\.\/\.[^\s]+)/.test(s)) return true;
    if (s.includes('/.git') || s.includes('/.ai-agent') || s.includes('/.env')) return true;
    return false;
  } catch {
    return false;
  }
}

function parseGitStatusPorcelainPaths(statusOutput) {
  const out = [];
  const raw = typeof statusOutput === 'string' ? statusOutput : '';
  const lines = raw.split('\n').map(l => l.trimEnd()).filter(Boolean);
  for (const line of lines) {
    // Format: XY <path> or XY <old> -> <new>
    const pathPart = line.length >= 4 ? line.slice(3).trim() : '';
    if (!pathPart) continue;
    const p = pathPart.includes('->') ? pathPart.split('->').pop().trim() : pathPart;
    if (!p) continue;
    out.push(p);
  }
  return out;
}

function diffSignature(diffText) {
  try {
    return crypto.createHash('sha1').update(String(diffText || ''), 'utf8').digest('hex');
  } catch {
    return '';
  }
}

function toRelPathInsideProject(projectRoot, absPath) {
  const root = realpathSafe(projectRoot);
  const cand = realpathSafe(absPath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (cand === root) return '.';
  if (!cand.startsWith(prefix)) return null;
  return cand.slice(prefix.length);
}

function realpathSafe(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isPathInsideRoot(rootDir, candidatePath) {
  const root = realpathSafe(rootDir);
  const cand = realpathSafe(candidatePath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return cand === root || cand.startsWith(prefix);
}

function extractStreamDeltas(rawEvent) {
  // Claude beta message streaming event shapes vary slightly; keep this resilient.
  if (!rawEvent || typeof rawEvent !== 'object') {
    return { 
      textDelta: null, 
      thinkingDelta: null, 
      toolUseDelta: null,
      contentBlockStart: null,
      contentBlockStop: null,
      index: null
    };
  }

  // Common Anthropic stream events:
  // - { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } }
  // - { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '...' } }
  // - { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '...' } }
  // - { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: '...', name: '...' } }
  // - { type: 'content_block_stop', index: 0 }
  const type = rawEvent.type;
  const index = typeof rawEvent.index === 'number' ? rawEvent.index : null;

  // Handle content_block_start (tool use initialization)
  if (type === 'content_block_start' && rawEvent.content_block && typeof rawEvent.content_block === 'object') {
    const block = rawEvent.content_block;
    if (block.type === 'tool_use') {
      return {
        textDelta: null,
        thinkingDelta: null,
        toolUseDelta: null,
        contentBlockStart: {
          index,
          toolUseId: block.id,
          toolName: block.name
        },
        contentBlockStop: null,
        index
      };
    }
  }

  // Handle content_block_stop
  if (type === 'content_block_stop') {
    return {
      textDelta: null,
      thinkingDelta: null,
      toolUseDelta: null,
      contentBlockStart: null,
      contentBlockStop: { index },
      index
    };
  }

  // Handle content_block_delta
  if (type === 'content_block_delta' && rawEvent.delta && typeof rawEvent.delta === 'object') {
    const dt = rawEvent.delta.type;
    if (dt === 'text_delta' && typeof rawEvent.delta.text === 'string') {
      return { textDelta: rawEvent.delta.text, thinkingDelta: null, toolUseDelta: null, contentBlockStart: null, contentBlockStop: null, index };
    }
    if (dt === 'thinking_delta' && typeof rawEvent.delta.thinking === 'string') {
      return { textDelta: null, thinkingDelta: rawEvent.delta.thinking, toolUseDelta: null, contentBlockStart: null, contentBlockStop: null, index };
    }
    if (dt === 'input_json_delta' && typeof rawEvent.delta.partial_json === 'string') {
      return { 
        textDelta: null, 
        thinkingDelta: null, 
        toolUseDelta: {
          partialJson: rawEvent.delta.partial_json,
          index
        },
        contentBlockStart: null,
        contentBlockStop: null,
        index
      };
    }
  }

  // Some variants omit delta.type and place text directly on delta.
  if (rawEvent.delta && typeof rawEvent.delta === 'object') {
    if (typeof rawEvent.delta.text === 'string') return { textDelta: rawEvent.delta.text, thinkingDelta: null, toolUseDelta: null, contentBlockStart: null, contentBlockStop: null, index };
    if (typeof rawEvent.delta.thinking === 'string') return { textDelta: null, thinkingDelta: rawEvent.delta.thinking, toolUseDelta: null, contentBlockStart: null, contentBlockStop: null, index };
    if (typeof rawEvent.delta.partial_json === 'string') {
      return { 
        textDelta: null, 
        thinkingDelta: null, 
        toolUseDelta: {
          partialJson: rawEvent.delta.partial_json,
          index
        },
        contentBlockStart: null,
        contentBlockStop: null,
        index
      };
    }
  }

  // Some variants use message_delta with nested deltas.
  if (type === 'message_delta' && rawEvent.delta && typeof rawEvent.delta === 'object') {
    if (typeof rawEvent.delta.text === 'string') return { textDelta: rawEvent.delta.text, thinkingDelta: null, toolUseDelta: null, contentBlockStart: null, contentBlockStop: null, index };
    if (typeof rawEvent.delta.thinking === 'string') return { textDelta: null, thinkingDelta: rawEvent.delta.thinking, toolUseDelta: null, contentBlockStart: null, contentBlockStop: null, index };
  }

  // Rare: direct fields.
  if (typeof rawEvent.text === 'string') return { textDelta: rawEvent.text, thinkingDelta: null, toolUseDelta: null, contentBlockStart: null, contentBlockStop: null, index };
  if (typeof rawEvent.thinking === 'string') return { textDelta: null, thinkingDelta: rawEvent.thinking, toolUseDelta: null, contentBlockStart: null, contentBlockStop: null, index };

  return { textDelta: null, thinkingDelta: null, toolUseDelta: null, contentBlockStart: null, contentBlockStop: null, index };
}

function extractAssistantText(message) {
  try {
    if (!message || typeof message !== 'object') return '';
    const content = message.content;
    if (!Array.isArray(content)) {
      // Some shapes provide plain text directly.
      if (typeof message.text === 'string') return message.text.trim();
      if (typeof message.content === 'string') return message.content.trim();
      return '';
    }
    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
    return parts.join('').trim();
  } catch {
    return '';
  }
}

/**
 * Try to extract partial content from streaming tool input JSON.
 * This allows us to stream code to the editor even before the JSON is complete.
 * Returns { path, contentDelta, fullContent } or null if not parseable yet.
 */
function tryParsePartialToolInput(partialJson, toolName) {
  if (!partialJson || typeof partialJson !== 'string') return null;
  
  try {
    // Strategy: look for content/file_text field in the partial JSON
    // For Write tool: { "path": "...", "content": "..." }
    // For Edit tool: { "path": "...", "file_text": "..." }
    
    const contentField = toolName === 'Edit' ? 'file_text' : 'content';
    
    // Try to find the path field
    let pathMatch = null;
    const pathPattern = /"(?:path|file_path)"\s*:\s*"([^"]+)"/;
    const pathResult = partialJson.match(pathPattern);
    if (pathResult) {
      pathMatch = pathResult[1];
    }
    
    // Try to extract content field - handle both complete and partial strings
    const contentPattern = new RegExp(`"${contentField}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, 's');
    const contentResult = partialJson.match(contentPattern);
    
    if (!contentResult) return null;
    
    // Unescape the content
    let content = contentResult[1];
    // Basic unescaping (handle common cases)
    content = content
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    
    // Store last known content length to calculate delta
    if (!tryParsePartialToolInput._lastContentLength) {
      tryParsePartialToolInput._lastContentLength = {};
    }
    const key = `${toolName}_${pathMatch || 'unknown'}`;
    const lastLen = tryParsePartialToolInput._lastContentLength[key] || 0;
    const delta = content.slice(lastLen);
    tryParsePartialToolInput._lastContentLength[key] = content.length;
    
    if (delta.length === 0) return null;
    
    return {
      path: pathMatch,
      contentDelta: delta,
      fullContent: content
    };
  } catch {
    return null;
  }
}

function normalizePermissionMode({ permissionMode, toolPermissionMode } = {}) {
  const allowed = new Set(['plan', 'default', 'acceptEdits', 'bypassPermissions']);
  const pm = typeof permissionMode === 'string' ? permissionMode.trim() : '';
  if (allowed.has(pm)) return pm;

  // Back-compat: older renderer/main sends `toolPermissionMode`:
  // - ask -> acceptEdits (edits allowed; prompts handled in our UI)
  // - always_allow -> bypassPermissions
  const tpm = typeof toolPermissionMode === 'string' ? toolPermissionMode.trim() : '';
  if (tpm === 'always_allow') return 'bypassPermissions';
  return 'acceptEdits';
}

function normalizeNetworkPolicy(networkPolicy) {
  const raw = networkPolicy && typeof networkPolicy === 'object' ? networkPolicy : {};
  const allowedModes = new Set(['allow_all', 'deny_all', 'allowlist']);
  const mode = (typeof raw.mode === 'string' && allowedModes.has(raw.mode.trim())) ? raw.mode.trim() : 'allow_all';
  const allowlist = Array.isArray(raw.allowlist)
    ? raw.allowlist.map(v => String(v || '').trim().toLowerCase()).filter(Boolean).slice(0, 200)
    : [];
  return { mode, allowlist };
}

function hostMatchesAllowlist(host, allowlist) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  const list = Array.isArray(allowlist) ? allowlist : [];
  for (const entryRaw of list) {
    const entry = String(entryRaw || '').trim().toLowerCase();
    if (!entry) continue;
    if (h === entry) return true;
    if (h.endsWith(`.${entry}`)) return true;
  }
  return false;
}

function bashLooksLikeNetworkCommand(command) {
  const c = String(command || '').toLowerCase();
  if (!c.trim()) return false;
  // Obvious URL usage
  if (c.includes('http://') || c.includes('https://')) return true;
  // Common network tools / installers / fetchers
  const needles = [
    'curl ',
    'wget ',
    'pnpm add',
    'pnpm install',
    'npm install',
    'yarn add',
    'yarn install',
    'pip install',
    'pip3 install',
    'poetry add',
    'poetry install',
    'git clone',
    'git fetch',
    'git pull'
  ];
  return needles.some(n => c.includes(n));
}

function extractHostsFromText(text) {
  const t = String(text || '');
  const hosts = [];
  const re = /https?:\/\/([a-zA-Z0-9.-]+)(?::\d+)?(?:\/|\b)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (m[1]) hosts.push(String(m[1]).toLowerCase());
    if (hosts.length >= 10) break;
  }
  return [...new Set(hosts)];
}

function isEditToolName(toolName) {
  const t = String(toolName || '').trim();
  if (!t) return false;
  // Canonical Claude Code edit tools (seen in the official VS Code extension bundle)
  // + NotebookEdit is present in the SDK tool schema.
  return t === 'Write' || t === 'Edit' || t === 'MultiEdit' || t === 'NotebookEdit';
}

function isNetworkToolName(toolName) {
  const t = String(toolName || '').trim();
  if (!t) return false;
  // WebFetch is the canonical Claude Code network tool. WebSearch is also networked in the SDK schema.
  // Defensive: treat any future Web* tools as networked (aligns with "ask before network" semantics).
  if (t === 'WebFetch' || t === 'WebSearch') return true;
  return t.startsWith('Web');
}

function isReadOnlyToolName(toolName) {
  const t = String(toolName || '').trim();
  if (!t) return false;
  // Known non-mutating tools from Claude Code / SDK schema.
  // NOTE: This list is intentionally conservative.
  return (
    t === 'Read' ||
    t === 'Grep' ||
    t === 'Glob' ||
    // Claude Code "Skill" expansion + subagent orchestration should not trigger permission prompts.
    t === 'Skill' ||
    t === 'Task' ||
    t === 'ListMcpResources' ||
    t === 'ReadMcpResource' ||
    t === 'TaskOutput' ||
    t === 'AskUserQuestion'
  );
}

function isAskUserQuestionToolName(toolName) {
  const t = String(toolName || '').trim();
  return t === 'AskUserQuestion';
}

function isExitPlanModeToolName(toolName) {
  const t = String(toolName || '').trim();
  return t === 'ExitPlanMode';
}

function createCanUseTool(projectRoot, {
  permissionMode = '',
  toolPermissionMode = 'ask',
  networkPolicy = null,
  uiSessionId = null,
  requestUserPermission = null,
  getRunControl = null,
  emitGateEvent = null,
  recordPlanWrite = null
} = {}) {
  const baseMode = normalizePermissionMode({ permissionMode, toolPermissionMode });
  const net = normalizeNetworkPolicy(networkPolicy);
  const getCurrentPermissionMode = () => {
    try {
      const rc = (typeof getRunControl === 'function') ? getRunControl() : null;
      const rcMode = rc && typeof rc.permissionMode === 'string' ? rc.permissionMode.trim() : '';
      if (rcMode) return normalizePermissionMode({ permissionMode: rcMode, toolPermissionMode });
    } catch { /* ignore */ }
    return baseMode;
  };
  const allowExternalPlanPath = (toolName, key, resolvedPath) => {
    const pm = getCurrentPermissionMode();
    if (pm !== 'plan') return false;
    if (!isAllowedClaudePlanPath(resolvedPath)) return false;
    if (!(key === 'file_path' || key === 'filePath' || key === 'path')) return false;
    const t = String(toolName || '').trim();
    return t === 'Write' || t === 'Edit' || t === 'Read';
  };

  const resolvePlanFilePath = (inputObj) => {
    try {
      const raw =
        (inputObj && typeof inputObj.file_path === 'string' ? inputObj.file_path : '') ||
        (inputObj && typeof inputObj.filePath === 'string' ? inputObj.filePath : '') ||
        (inputObj && typeof inputObj.path === 'string' ? inputObj.path : '');
      if (!raw) return '';
      const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
      return isAllowedClaudePlanPath(resolved) ? resolved : '';
    } catch {
      return '';
    }
  };

  const shouldDenyForMode = (toolName) => {
    const pm = getCurrentPermissionMode();
    // Plan mode is strictly read-only: no edits, no shell, no network.
    if (pm === 'plan') {
      // Allow only explicit read-only tools; deny everything else.
      if (isReadOnlyToolName(toolName) || isExitPlanModeToolName(toolName)) return false;
      return true;
    }
    return false;
  };

  const shouldAskForTool = (toolName) => {
    const pm = getCurrentPermissionMode();
    if (isExitPlanModeToolName(toolName)) return true;
    if (isAskUserQuestionToolName(toolName)) return true;
    if (pm === 'bypassPermissions') return false;
    if (pm === 'acceptEdits') {
      // Accept edits: no permission prompts (still enforce sandboxing/path isolation + network policy blocks).
      return false;
    }
    if (pm === 'default') {
      // Default: ask before edits, commands, and network.
      if (toolName === 'Bash' || isNetworkToolName(toolName) || isEditToolName(toolName)) return true;
      // Read-only tools should not prompt.
      if (isReadOnlyToolName(toolName)) return false;
      // Unknown tool: be safe and prompt.
      return true;
    }
    // plan: no prompts; hard-deny handled above.
    return false;
  };

  const promptForTool = async (toolName, updatedInput, toolUseID) => {
    if (typeof requestUserPermission !== 'function') {
      return {
        behavior: 'deny',
        message: `Tool "${toolName}" requires permission, but the UI permission bridge is not available.`,
        interrupt: true,
        toolUseID
      };
    }
    const permissionResult = await requestUserPermission({
      toolName,
      input: updatedInput
    });
    let allow = false;
    let answers = null;
    if (permissionResult && typeof permissionResult === 'object' && !Array.isArray(permissionResult)) {
      allow = permissionResult.allow === true;
      if (permissionResult.answers && typeof permissionResult.answers === 'object' && !Array.isArray(permissionResult.answers)) {
        answers = permissionResult.answers;
      }
    } else {
      allow = !!permissionResult;
    }
    if (allow && isAskUserQuestionToolName(toolName)) {
      const existingAnswers = (updatedInput && typeof updatedInput.answers === 'object' && !Array.isArray(updatedInput.answers))
        ? updatedInput.answers
        : null;
      const finalAnswers = answers || existingAnswers;
      if (!finalAnswers || Object.keys(finalAnswers).length === 0) {
        return { behavior: 'deny', message: 'User declined to answer questions.', interrupt: false, toolUseID };
      }
      updatedInput.answers = finalAnswers;
    }
    return allow
      ? { behavior: 'allow', updatedInput: updatedInput || {}, toolUseID }
      : { behavior: 'deny', message: `User denied tool "${toolName}".`, interrupt: false, toolUseID };
  };

  const normalizePathKey = (updatedInput, key, toolName) => {
    const raw = updatedInput && typeof updatedInput[key] === 'string' ? updatedInput[key].trim() : '';
    if (!raw) return;
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
    if (!isPathInsideRoot(projectRoot, resolved)) {
      if (allowExternalPlanPath(toolName, key, resolved)) {
        updatedInput[key] = resolved;
        return;
      }
      throw new Error(`Access outside the opened project is not allowed: ${resolved}`);
    }
    updatedInput[key] = resolved;
  };

  return async (toolName, input, options) => {
    const toolUseID = options?.toolUseID;
    // Hard stop: user pressed Stop for this run. Do not allow any more tools.
    try {
      const rc = (typeof getRunControl === 'function') ? getRunControl() : null;
      if (rc && rc.cancelled === true) {
        try {
          emitGateEvent?.({
            type: 'gate_event',
            kind: 'cancelled',
            toolName,
            toolUseId: toolUseID || null
          });
        } catch { /* ignore */ }
        return {
          behavior: 'deny',
          message: 'Run cancelled by user.',
          interrupt: true,
          toolUseID
        };
      }
    } catch { /* ignore */ }
    try {
      if (aetDebugEnabled()) {
        const rc = (typeof getRunControl === 'function') ? getRunControl() : null;
        const sid = (typeof uiSessionId === 'string') ? uiSessionId.trim() : '';
        const pausedByRequestId = !!(rc && rc.pauseBeforeNextTool === true);
        const pausedBySession = !!(sid && pauseBeforeNextToolByUiSessionId.get(sid) === true);
        const pm = getCurrentPermissionMode();
        aetDebugLog('can_use_tool_called', { toolName, toolUseId: toolUseID || null, uiSessionId: sid || null, pausedByRequestId, pausedBySession, permissionMode: pm });
      }
    } catch { /* ignore */ }

    // Hard isolation: if Claude Code reports a blocked path, enforce it.
    // This covers cases like Bash trying to access paths outside allowed directories.
    const blockedPath = options?.blockedPath;
    if (typeof blockedPath === 'string' && blockedPath.trim()) {
      const resolved = path.isAbsolute(blockedPath) ? path.resolve(blockedPath) : path.resolve(projectRoot, blockedPath);
      if (!isPathInsideRoot(projectRoot, resolved)) {
        return {
          behavior: 'deny',
          message: `Access outside the opened project is not allowed: ${resolved}`,
          interrupt: true,
          toolUseID
        };
      }
    }

    try {
      const updatedInput = { ...(input || {}) };

      // Common path keys used by Claude Code tools (both snake_case and camelCase variants)
      const pathKeys = [
        'file_path',
        'filePath',
        'path',
        'directory',
        'dir',
        'cwd',
        'working_directory',
        'workingDirectory',
        'working_dir',
        'workingDir'
      ];
      for (const key of pathKeys) {
        if (updatedInput && Object.prototype.hasOwnProperty.call(updatedInput, key)) {
          normalizePathKey(updatedInput, key, toolName);
        }
      }

      // Guard: Read tool only accepts files (prevent EISDIR when a directory is passed).
      if (toolName === 'Read') {
        const readPath =
          (typeof updatedInput.file_path === 'string' ? updatedInput.file_path.trim() : '') ||
          (typeof updatedInput.filePath === 'string' ? updatedInput.filePath.trim() : '') ||
          (typeof updatedInput.path === 'string' ? updatedInput.path.trim() : '');
        if (readPath) {
          try {
            const st = await fs.promises.stat(readPath);
            if (st && st.isDirectory()) {
              return {
                behavior: 'deny',
                message: 'Read expects a file path, not a directory. Use Glob/ListDir to list contents.',
                interrupt: false,
                toolUseID
              };
            }
          } catch {
            // If stat fails (missing path, permissions), let the tool decide.
          }
        }
      }

      // For Bash: if no cwd was provided, force it to the project root.
      if (toolName === 'Bash') {
        // Always force Bash cwd to the opened workspace root.
        updatedInput.cwd = path.resolve(projectRoot);
      }

      // Policy: Models must not list/edit/delete hidden files (dotfiles/dotfolders).
      // For Bash, proactively block commands that explicitly enumerate dotfiles (e.g. `ls -a`).
      if (toolName === 'Bash') {
        const cmd = typeof updatedInput.command === 'string'
          ? updatedInput.command
          : (typeof updatedInput.cmd === 'string' ? updatedInput.cmd : '');
        if (bashCommandLooksLikeHiddenListing(cmd)) {
          return {
            behavior: 'deny',
            message: 'Blocked: listing hidden files is not allowed.',
            interrupt: false,
            toolUseID
          };
        }
      }

      // If any files are locked, Bash becomes inherently risky (it can mutate locked files without file_path metadata).
      // We surface *referenced* locked files in the permission prompt (when a prompt happens),
      // but we do NOT force prompts just because locks exist (locks are enforced via PreToolUse hook).
      if (toolName === 'Bash') {
        try {
          const { locksByRelPath } = await loadProjectLocks(projectRoot, { noCache: true });
          const allLocked = locksByRelPath && typeof locksByRelPath === 'object'
            ? Object.keys(locksByRelPath).map(String).filter(Boolean)
            : [];
          if (allLocked.length > 0) {
            const cmd = typeof updatedInput.command === 'string'
              ? updatedInput.command
              : (typeof updatedInput.cmd === 'string' ? updatedInput.cmd : '');
            // Only surface locked files that are actually referenced by the command.
            const referenced = cmd
              ? allLocked.filter((p) => _bashCommandMentionsLockedPath(cmd, p)).slice(0, 50)
              : [];
            if (referenced.length > 0) updatedInput.lockedPaths = referenced;
          }
        } catch {
          // If locks lookup fails, fall back to normal behavior (do not block Bash unexpectedly).
        }
      }

      // v2.0: File locks + internal state protection (block edit tools before execution).
      if (isEditToolName(toolName)) {
        // Support both snake_case (file_path) and camelCase (filePath) from SDK
        const abs = (typeof updatedInput.file_path === 'string' ? updatedInput.file_path.trim() : '')
          || (typeof updatedInput.filePath === 'string' ? updatedInput.filePath.trim() : '');
        
        // CRITICAL: Hard block any writes outside the project root (even in bypassPermissions mode)
        if (abs) {
          const resolvedAbs = path.isAbsolute(abs) ? path.resolve(abs) : path.resolve(projectRoot, abs);
          const allowPlan = allowExternalPlanPath(toolName, 'file_path', resolvedAbs)
            || allowExternalPlanPath(toolName, 'path', resolvedAbs)
            || allowExternalPlanPath(toolName, 'filePath', resolvedAbs);
          if (!isPathInsideRoot(projectRoot, resolvedAbs) && !allowPlan) {
            try {
              emitGateEvent?.({
                type: 'gate_event',
                kind: 'outside_project_block',
                toolName,
                filePath: abs,
                resolvedPath: resolvedAbs,
                projectRoot,
                toolUseId: toolUseID || null
              });
            } catch { /* ignore */ }
            console.warn(`[Claude SDK] BLOCKED: Write outside project - ${resolvedAbs} (project: ${projectRoot})`);
            return {
              behavior: 'deny',
              message: `Writes outside the project directory are not allowed: ${resolvedAbs}`,
              interrupt: false,
              toolUseID
            };
          }
        }
        
        const rel = abs ? toRelPathInsideProject(projectRoot, abs) : null;
        const normRel = rel ? normalizeRelPath(rel) : '';

        // Policy: never allow edits to any hidden file/directory (dotfiles/dotfolders), including .ai-agent/attachments.
        if (normRel && isStrictHiddenRelPath(normRel)) {
          try {
            emitGateEvent?.({
              type: 'gate_event',
              kind: 'hidden_write_block',
              toolName,
              filePath: normRel,
              toolUseId: toolUseID || null
            });
          } catch { /* ignore */ }
          return {
            behavior: 'deny',
            message: `Edits to hidden files are blocked: ${normRel}`,
            interrupt: false,
            toolUseID
          };
        }

        // Never allow the agent to mutate internal state under .ai-agent/ (except attachments).
        if (normRel && isHiddenOrInternalRelPath(normRel)) {
          try {
            emitGateEvent?.({
              type: 'gate_event',
              kind: 'internal_write_block',
              toolName,
              filePath: normRel,
              toolUseId: toolUseID || null
            });
          } catch { /* ignore */ }
          try {
            aetDebugLog('gate_internal_write_block', { projectRoot, toolName, filePath: normRel, toolUseId: toolUseID || null });
          } catch { /* ignore */ }
          return {
            behavior: 'deny',
            message: `Edits to internal app state are blocked: ${normRel}`,
            interrupt: false,
            toolUseID
          };
        }

        if (normRel) {
          const { locksByRelPath } = await loadProjectLocks(projectRoot, { noCache: true });
          const locked = locksByRelPath && Object.prototype.hasOwnProperty.call(locksByRelPath, normRel) ? locksByRelPath[normRel] : null;
          if (locked) {
            try {
              emitGateEvent?.({
                type: 'gate_event',
                kind: 'lock_block',
                toolName,
                filePath: normRel,
                toolUseId: toolUseID || null,
                lock: locked
              });
            } catch { /* ignore */ }
            try {
              aetDebugLog('gate_lock_block', { projectRoot, toolName, filePath: normRel, toolUseId: toolUseID || null, lock: locked });
            } catch { /* ignore */ }
            return {
              behavior: 'deny',
              message: `File is locked: ${normRel}`,
              interrupt: false,
              toolUseID
            };
          }
        }
      }

      // Pause-before-next-tool is enforced via the SDK PreToolUse hook (reliable across permission modes).

      // Soft sandbox: network policy for WebFetch / WebSearch
      if (toolName === 'WebFetch' || toolName === 'WebSearch') {
        if (net.mode === 'deny_all') {
          return {
            behavior: 'deny',
            message: `${toolName} is disabled by network policy (deny_all).`,
            interrupt: false,
            toolUseID
          };
        }
        if (net.mode === 'allowlist') {
          // NOTE: allowlist can be enforced for WebFetch URLs; WebSearch doesn't have a URL/host to validate,
          // so we only block it under deny_all.
          if (toolName === 'WebSearch') {
            return {
              behavior: 'deny',
              message: 'WebSearch is blocked under allowlist policy. Switch network policy to allow_all or use WebFetch with an allowlisted domain.',
              interrupt: false,
              toolUseID
            };
          }
          const urls = [];
          if (typeof updatedInput.url === 'string' && updatedInput.url.trim()) urls.push(updatedInput.url.trim());
          if (typeof updatedInput.uri === 'string' && updatedInput.uri.trim()) urls.push(updatedInput.uri.trim());
          if (Array.isArray(updatedInput.urls)) {
            for (const u of updatedInput.urls) {
              if (typeof u === 'string' && u.trim()) urls.push(u.trim());
            }
          }
          const unique = [...new Set(urls)].slice(0, 12);
          if (unique.length === 0) {
            return {
              behavior: 'deny',
              message: 'WebFetch request blocked by allowlist policy (no URL provided).',
              interrupt: false,
              toolUseID
            };
          }
          for (const u of unique) {
            let host = '';
            try {
              const parsed = new URL(u);
              host = parsed.hostname || '';
            } catch {
              return {
                behavior: 'deny',
                message: `WebFetch blocked: invalid URL under allowlist policy: ${u}`,
                interrupt: false,
                toolUseID
              };
            }
            if (!hostMatchesAllowlist(host, net.allowlist)) {
              return {
                behavior: 'deny',
                message: `WebFetch blocked by allowlist policy: ${host || u}`,
                interrupt: false,
                toolUseID
              };
            }
          }
        }
      }

      // Sandboxing v2: apply network policy to Bash (best-effort heuristic).
      if (toolName === 'Bash') {
        const cmd = (typeof updatedInput.command === 'string' ? updatedInput.command : (typeof updatedInput.cmd === 'string' ? updatedInput.cmd : '')).trim();
        const cmdLower = cmd.toLowerCase();
        // Block obvious escapes to internal state.
        const mentionsAiAgent = cmdLower.includes('.ai-agent');
        const mentionsAiAgentAttachments = cmdLower.includes('.ai-agent/attachments');
        if (mentionsAiAgent && !mentionsAiAgentAttachments) {
          return {
            behavior: 'deny',
            message: 'Bash command blocked: references to .ai-agent are not allowed.',
            interrupt: false,
            toolUseID
          };
        }

        // Claude Code semantics: allow referencing skills/agents directories under .claude (project) and ~/.claude (user),
        // since skills can include scripts executed via Bash.
        const hasHomeClaude = cmdLower.includes('~/.claude');
        const hasDotClaude = cmdLower.includes('/.claude/');
        const allowHomeClaude = cmdLower.includes('~/.claude/skills') || cmdLower.includes('~/.claude/agents');
        const allowDotClaude = cmdLower.includes('/.claude/skills') || cmdLower.includes('/.claude/agents');
        if ((hasHomeClaude && !allowHomeClaude) || (hasDotClaude && !allowDotClaude)) {
          return {
            behavior: 'deny',
            message: 'Bash command blocked: .claude references are only allowed for skills/agents directories.',
            interrupt: false,
            toolUseID
          };
        }

        if (net.mode === 'deny_all' && bashLooksLikeNetworkCommand(cmd)) {
          return {
            behavior: 'deny',
            message: 'Bash command blocked by network policy (deny_all). Use WebFetch with allow_all or update the network policy.',
            interrupt: false,
            toolUseID
          };
        }

        if (net.mode === 'allowlist' && bashLooksLikeNetworkCommand(cmd)) {
          const hosts = extractHostsFromText(cmd);
          if (hosts.length === 0) {
            return {
              behavior: 'deny',
              message: 'Bash network-like command blocked by allowlist policy (no allowlisted host detected). Prefer WebFetch or add an allowlisted domain.',
              interrupt: false,
              toolUseID
            };
          }
          for (const h of hosts) {
            if (!hostMatchesAllowlist(h, net.allowlist)) {
              return {
                behavior: 'deny',
                message: `Bash network command blocked by allowlist policy: ${h}`,
                interrupt: false,
                toolUseID
              };
            }
          }
        }
      }

      const planFilePath = resolvePlanFilePath(updatedInput);
      const allowPlanWrite = (getCurrentPermissionMode() === 'plan') && isEditToolName(toolName) && !!planFilePath;
      if (allowPlanWrite && typeof recordPlanWrite === 'function' && toolUseID) {
        try { recordPlanWrite(String(toolUseID), planFilePath); } catch { /* ignore */ }
      }

      // Plan mode: deny tool usage that can mutate state or exfiltrate.
      if (shouldDenyForMode(toolName) && !allowPlanWrite) {
        return {
          behavior: 'deny',
          message: `Tool "${toolName}" is not allowed in plan mode (read-only).`,
          interrupt: false,
          toolUseID
        };
      }

      // Ask permission (UI) for tools gated by the current permission mode.
      if (shouldAskForTool(toolName)) {
        return await promptForTool(toolName, updatedInput, toolUseID);
      }

      // Allow tool.
      return {
        behavior: 'allow',
        updatedInput,
        toolUseID
      };
    } catch (e) {
      return {
        behavior: 'deny',
        message: e?.message || String(e),
        interrupt: true,
        toolUseID
      };
    }
  };
}

// Pick the "small/fast" background model for OpenRouter. Claude Code uses this for
// auto-compaction/summaries, title + topic detection, and quota probes. We must hand
// it a slug that actually EXISTS on the user's OpenRouter account, otherwise those
// background calls 404 and abort the entire run.
//
// The only slug we can guarantee is valid is the main model the user explicitly
// selected — it's already validated by the live request. Hardcoding a separate
// "cheap" Anthropic haiku slug (e.g. `anthropic/claude-3.5-haiku`) is exactly what
// caused the regression: if that slug is renamed/unavailable on their account, the
// background call 404s. This bites hardest right after image generation, because the
// base64/asset-heavy context balloons and triggers auto-compaction (a background
// call). Reusing the main model is marginally pricier for those background calls but
// can never introduce a brand-new 404.
function mapOpenRouterSmallModel(mainModel) {
  return String(mainModel || '').trim();
}

async function startClaudeSdkQuery({
  requestId,
  prompt,
  projectRoot,
  apiKey,
  model,
  useOpenRouter = false,
  openrouterApiKey = '',
  openrouterModel = '',
  // Codex (ChatGPT-subscription) provider — routed through a local Anthropic<->Responses proxy
  useCodex = false,
  codexModel = '',
  mcpServers = null,
  onEvent,
  resumeSessionId,
  resumeSessionAt,
  forkSession,
  uiSessionId = null,
  // New: Claude Code-style permission mode (plan/default/acceptEdits/bypassPermissions)
  permissionMode = '',
  // When exiting plan mode, resume to this permission mode (default: acceptEdits)
  resumePermissionMode = '',
  // Soft sandbox: network policy for WebFetch
  networkPolicy = null,
  // Optional budget cap (Agent SDK: maxBudgetUsd)
  maxBudgetUsd = null,
  // Back-compat (older renderer/main payloads)
  toolPermissionMode = 'ask',
  requestUserPermission = null
}) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const abortController = new AbortController();
  // Initialize run control state.
  try { getClaudeSdkRunControl(requestId); } catch { /* ignore */ }

  // ==========================================================================
  // Justification Protocol (JP v1) - parse + strip from user-visible text
  // ==========================================================================
  let jpPartialLine = '';
  const jpSeen = new Set();

  const mapJpNodeType = (raw) => {
    const t = String(raw || '').trim().toLowerCase();
    if (!t) return null;
    if (t === 'edit' || t === 'write' || t === 'multiedit' || t === 'notebookedit') return 'FileEdit';
    if (t === 'bash' || t === 'bashcommand') return 'BashCommand';
    if (t === 'webfetch' || t === 'network' || t === 'networkrequest') return 'NetworkRequest';
    if (t === 'warning') return 'Warning';
    if (t === 'checkpoint' || t === 'checkpointcreated') return 'CheckpointCreated';
    if (t === 'plan' || t === 'plangenerated') return 'PlanGenerated';
    if (t === 'user' || t === 'userintervention') return 'UserIntervention';
    if (t === 'completion') return 'Completion';
    return null;
  };

  const parseJpLine = (line) => {
    // Format: JP: <node_type> | <target> | <why in <= 12 words>
    const raw = String(line || '').trim();
    if (!raw.toLowerCase().startsWith('jp:')) return null;
    const rest = raw.slice(3).trim();
    const parts = rest.split('|').map(s => String(s || '').trim());
    if (parts.length < 3) return null;
    const nodeType = mapJpNodeType(parts[0]);
    if (!nodeType) return null;
    const target = parts[1] || '';
    // JP v1: 3 parts. JP v2: allow extra key/value fields like "outcome:" / "risk:".
    const why = parts[2] || '';
    let outcome = '';
    let risk = '';
    for (const extra of parts.slice(3)) {
      const low = String(extra || '').trim();
      const lower = low.toLowerCase();
      if (lower.startsWith('outcome:') || lower.startsWith('expected:') || lower.startsWith('impact:')) {
        outcome = low.split(':').slice(1).join(':').trim();
      } else if (lower.startsWith('risk:')) {
        risk = low.split(':').slice(1).join(':').trim().toLowerCase();
      }
    }
    if (risk && !['low', 'med', 'high'].includes(risk)) risk = '';
    if (!why) return null;
    const version = (outcome || risk || parts.length > 3) ? 2 : 1;
    const parsed = { nodeType, target, why: String(why).trim(), outcome: String(outcome || '').trim(), risk: String(risk || '').trim(), version, raw };
    try {
      aetDebugLog('jp_parsed', { requestId, uiSessionId: uiSessionId || null, nodeType: parsed.nodeType, target: parsed.target, why: parsed.why, version: parsed.version, risk: parsed.risk || null });
    } catch { /* ignore */ }
    return parsed;
  };

  // More robust extractor: sometimes the model emits "....JP: Edit | ..." without a preceding newline.
  // We still want to parse + strip it from user-visible output.
  const extractJpFromLine = (line) => {
    try {
      const s = typeof line === 'string' ? line : String(line || '');
      if (!s) return null;
      const lower = s.toLowerCase();
      const idx = lower.indexOf('jp:');
      if (idx < 0) return null;
      const candidate = s.slice(idx).trim();
      const parsed = parseJpLine(candidate);
      if (!parsed) return null;
      const prefix = s.slice(0, idx);
      return { parsed, raw: parsed.raw, prefix };
    } catch {
      return null;
    }
  };

  const stripAndEmitJpFromText = (text, sessionIdForEvent) => {
    try {
      const s = typeof text === 'string' ? text : String(text || '');
      if (!s) return '';
      const lines = s.split('\n');
      const kept = [];
      for (const ln of lines) {
        const hit = extractJpFromLine(ln);
        const parsed = hit ? hit.parsed : null;
        if (parsed) {
          const key = hit.raw;
          if (!jpSeen.has(key)) {
            jpSeen.add(key);
            try {
              onEvent({
                requestId,
                type: 'jp',
                sessionId: sessionIdForEvent || null,
                jp: parsed
              });
            } catch {
              // ignore
            }
          }
          // Keep any prefix text that preceded "JP:" on the same line.
          const prefix = String(hit.prefix || '').trimEnd();
          if (prefix) kept.push(prefix);
          continue;
        }
        kept.push(ln);
      }
      return kept.join('\n');
    } catch {
      return typeof text === 'string' ? text : String(text || '');
    }
  };

  const stripAndEmitJpFromDelta = (deltaText, sessionIdForEvent) => {
    const raw = typeof deltaText === 'string' ? deltaText : String(deltaText || '');
    if (!raw) return '';
    const combined = jpPartialLine + raw;
    const parts = combined.split('\n');
    jpPartialLine = parts.pop() ?? '';

    const outLines = [];
    for (const ln of parts) {
      const hit = extractJpFromLine(ln);
      const parsed = hit ? hit.parsed : null;
      if (parsed) {
        const key = hit.raw;
        if (!jpSeen.has(key)) {
          jpSeen.add(key);
          try {
            onEvent({
              requestId,
              type: 'jp',
              sessionId: sessionIdForEvent || null,
              jp: parsed
            });
          } catch {
            // ignore
          }
        }
        // Keep any prefix text that preceded "JP:" on the same line.
        const prefix = String(hit.prefix || '').trimEnd();
        if (prefix) outLines.push(prefix);
        continue;
      }
      outLines.push(ln);
    }
    return outLines.length ? outLines.join('\n') + '\n' : '';
  };

  const emitFatalInitError = (err, { sessionId = null } = {}) => {
    try {
      const msg = err?.message || String(err);
      onEvent({
        requestId,
        type: 'error',
        sessionId,
        error: msg
      });
    } catch {
      // ignore
    }
  };

  const isAuthCommand =
    typeof prompt === 'string' && /^\/(login|logout|status)\b/i.test(prompt.trim());

  // Track diff state per run to prevent cross-tab “bleed”:
  // - hidden/internal files are excluded
  // - Bash diffs are emitted only when the file's diff changes since the run started / last emit
  const baselineDirtyPaths = new Set(); // normalized rel paths
  const baselineSigByPath = new Map(); // rel -> sha1(diff) (captured at run start for already-dirty files)
  const lastSeenSigByPath = new Map(); // rel -> sha1(diff) (updated whenever we emit)
  const MAX_BASELINE_SIG_FILES = 30;

  const initDiffBaseline = async () => {
    try {
      const status = await gitStatusPorcelain(projectRoot);
      const paths = parseGitStatusPorcelainPaths(status);
      for (const raw of paths) {
        const rel = normalizeRelPath(raw);
        if (!rel || rel === '.' || isHiddenOrInternalRelPath(rel)) continue;
        baselineDirtyPaths.add(rel);
      }
      let captured = 0;
      for (const rel of baselineDirtyPaths) {
        if (captured >= MAX_BASELINE_SIG_FILES) break;
        const diff = await gitDiffForPath(projectRoot, rel);
        const sig = diffSignature(diff);
        baselineSigByPath.set(rel, sig);
        lastSeenSigByPath.set(rel, sig);
        captured++;
      }
    } catch {
      // ignore (baseline is best-effort)
    }
  };

  // Initialize baseline before we start, so early Bash tools don't pick up pre-existing dirty files.
  await initDiffBaseline();

  const emitTodoUpdate = (hookInput) => {
    try {
      if (!hookInput || hookInput.tool_name !== 'TodoWrite') return;
      // tool_response schema for TodoWrite: { oldTodos: [...], newTodos: [...] }
      const toolResponse = hookInput.tool_response;
      const newTodos = toolResponse && typeof toolResponse === 'object' ? toolResponse.newTodos : null;
      if (!Array.isArray(newTodos)) return;

      onEvent({
        requestId,
        type: 'todo_write',
        sessionId: hookInput.session_id,
        todos: newTodos
      });
    } catch {
      // ignore
    }
  };

  const formatCommonClaudeFailureHint = (text) => {
    const raw = String(text || '');
    if (!raw) return '';

    const isRipgrepAsar =
      raw.includes('spawn ENOTDIR') &&
      raw.includes('app.asar') &&
      raw.includes('claude-agent-sdk') &&
      raw.includes('ripgrep');
    if (isRipgrepAsar) {
      return '\n\nHint: This is usually caused by ASAR packaging. Claude Code tries to run ripgrep at a path like Resources/app.asar/... which macOS treats as a file (not a directory). Rebuild with ASAR disabled (recommended for this app) or ensure ripgrep runs from a real on-disk path.';
    }

    if (raw.toLowerCase().includes('axioserror') && raw.includes('status code 403')) {
      return '\n\nHint: Claude Code attempted to download a dependency but got HTTP 403. This often happens when it can’t execute bundled ripgrep and falls back to downloading it. Fix the ripgrep execution issue (ASAR), or ensure the network allows the download origin.';
    }

    if ((raw.includes('Not Found') || raw.includes('"code":404') || raw.includes('status code 404')) && /\b404\b/.test(raw)) {
      return '\n\nHint: Received HTTP 404 (Not Found). This usually means the provider endpoint or model name is invalid. For OpenRouter, ensure the base URL is `https://openrouter.ai/api` (the SDK already calls `/v1/...`) and the model name exists.';
    }

    // Claude Code sandbox proxy allowlist block (independent of our WebFetch/Bash "network policy" UI).
    // The CLI runs some network traffic through an internal proxy. When blocked, it returns 403 with
    // header `X-Proxy-Error: blocked-by-allowlist`.
    if (
      raw.toLowerCase().includes('blocked-by-allowlist') ||
      raw.toLowerCase().includes('connection blocked by network allowlist') ||
      raw.toLowerCase().includes('x-proxy-error') && raw.toLowerCase().includes('allowlist')
    ) {
      return '\n\nHint: A network request was blocked by Claude Code\'s internal sandbox allowlist (HTTP 403, often with `X-Proxy-Error: blocked-by-allowlist`). This is separate from Codeon\'s “Network policy (WebFetch + Bash)” setting. To fix: disable Claude Code sandbox networking (recommended in Codeon) or explicitly allow the needed domain(s) in `.claude/settings.json`.';
    }

    if (raw.includes('Permission denials') || /\bPermission denials:\s*- /i.test(raw)) {
      return '\n\nHint: One or more tools were denied by the permission gate (e.g., Bash). This shouldn’t crash the app; you can re-run after allowing the required tool, or change permission mode in settings.';
    }

    return '';
  };

  const safeStringify = (obj, maxLen = 800) => {
    try {
      const s = JSON.stringify(obj);
      if (typeof s !== 'string') return '';
      return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    } catch {
      return '';
    }
  };

  const summarizeToolInput = (toolName, toolInput) => {
    try {
      const inputObj = (toolInput && typeof toolInput === 'object') ? toolInput : null;
      if (!inputObj) return null;

      const toRelIfPossible = (p) => {
        const raw = typeof p === 'string' ? p.trim() : '';
        if (!raw) return '';
        if (!path.isAbsolute(raw)) return normalizeRelPath(raw);
        const rel = toRelPathInsideProject(projectRoot, raw);
        return rel ? normalizeRelPath(rel) : raw;
      };

      const trunc = (s, n) => {
        const str = typeof s === 'string' ? s : String(s || '');
        if (!str) return '';
        return str.length > n ? str.slice(0, n) + '…' : str;
      };

      if (toolName === 'Bash') {
        const cmd = typeof inputObj.command === 'string'
          ? inputObj.command
          : (typeof inputObj.cmd === 'string' ? inputObj.cmd : '');
        const cwd = typeof inputObj.cwd === 'string' ? inputObj.cwd : '';
        const runInBackground = inputObj.run_in_background === true || inputObj.runInBackground === true;
        const timeout = Number.isFinite(Number(inputObj.timeout)) ? Number(inputObj.timeout) : null;
        return {
          command: trunc(cmd, 800),
          cwd: trunc(cwd, 260),
          ...(runInBackground ? { runInBackground: true } : {}),
          ...(timeout != null ? { timeoutMs: timeout } : {})
        };
      }

      if (toolName === 'TaskOutput') {
        const taskId = typeof inputObj.task_id === 'string' ? inputObj.task_id : (typeof inputObj.taskId === 'string' ? inputObj.taskId : '');
        const block = inputObj.block === true;
        const timeout = Number.isFinite(Number(inputObj.timeout)) ? Number(inputObj.timeout) : null;
        return {
          taskId: trunc(taskId, 200),
          ...(block ? { block: true } : {}),
          ...(timeout != null ? { timeoutMs: timeout } : {})
        };
      }

      if (toolName === 'WebFetch') {
        const url = typeof inputObj.url === 'string'
          ? inputObj.url
          : (typeof inputObj.uri === 'string' ? inputObj.uri : '');
        return { url: trunc(url, 800) };
      }

      if (toolName === 'Skill') {
        // DEBUG: Log the raw tool input to understand what the SDK sends
        console.log('[Claude SDK] Skill tool input:', JSON.stringify(inputObj, null, 2));
        
        // Primary: The SDK uses 'skill' parameter for the skill name
        const name =
          (typeof inputObj.skill === 'string' ? inputObj.skill : '') ||
          (typeof inputObj.command_name === 'string' ? inputObj.command_name : '') ||
          (typeof inputObj.commandName === 'string' ? inputObj.commandName : '') ||
          (typeof inputObj.skill_name === 'string' ? inputObj.skill_name : '') ||
          (typeof inputObj.skillName === 'string' ? inputObj.skillName : '') ||
          (typeof inputObj.name === 'string' ? inputObj.name : '');
        // Primary: The SDK uses 'args' parameter for arguments
        const arg =
          (typeof inputObj.args === 'string' ? inputObj.args : '') ||
          (typeof inputObj.argument === 'string' ? inputObj.argument : '');
        // Try to extract skill directory path for better identification
        const skillPath =
          (typeof inputObj.skill_path === 'string' ? inputObj.skill_path : '') ||
          (typeof inputObj.skillPath === 'string' ? inputObj.skillPath : '') ||
          (typeof inputObj.path === 'string' ? inputObj.path : '') ||
          (typeof inputObj.directory === 'string' ? inputObj.directory : '');
        // Extract skill name from path if name is not provided
        let skillName = String(name || '').trim();
        if (!skillName && skillPath) {
          const pathParts = skillPath.split('/').filter(Boolean);
          // Try to find the skill name from path (usually last or second-to-last component)
          if (pathParts.length > 0) {
            // Check if it's a plugin skill path: ~/.claude/plugins/<plugin>/skills/<skill>
            const skillsIdx = pathParts.indexOf('skills');
            if (skillsIdx >= 0 && skillsIdx < pathParts.length - 1) {
              skillName = pathParts[skillsIdx + 1];
            } else {
              skillName = pathParts[pathParts.length - 1];
            }
          }
        }
        
        console.log('[Claude SDK] Skill extracted - name:', skillName, 'path:', skillPath, 'arg:', arg?.slice(0, 100));
        
        return {
          commandName: trunc(skillName, 200),
          argument: trunc(String(arg || '').trim(), 800),
          ...(skillPath ? { skillPath: trunc(skillPath, 500) } : {})
        };
      }

      if (toolName === 'Agent' || toolName === 'Task') {
        const subagentType =
          (typeof inputObj.subagent_type === 'string' ? inputObj.subagent_type : '') ||
          (typeof inputObj.subagentType === 'string' ? inputObj.subagentType : '') ||
          (typeof inputObj.type === 'string' ? inputObj.type : '') ||
          (typeof inputObj.task_type === 'string' ? inputObj.task_type : '') ||
          (typeof inputObj.taskType === 'string' ? inputObj.taskType : '');
        const desc = 
          (typeof inputObj.description === 'string' ? inputObj.description : '') ||
          (typeof inputObj.prompt === 'string' ? inputObj.prompt : '') ||
          (typeof inputObj.task === 'string' ? inputObj.task : '');
        const taskName =
          (typeof inputObj.name === 'string' ? inputObj.name : '') ||
          (typeof inputObj.task_name === 'string' ? inputObj.task_name : '') ||
          (typeof inputObj.taskName === 'string' ? inputObj.taskName : '');
        return {
          subagentType: trunc(String(subagentType || '').trim(), 120),
          taskName: trunc(String(taskName || '').trim(), 200),
          description: trunc(String(desc || '').trim(), 500)
        };
      }

      if (toolName === 'Read') {
        const fp = typeof inputObj.file_path === 'string' ? inputObj.file_path : '';
        const offset = Number.isFinite(Number(inputObj.offset)) ? Number(inputObj.offset) : null;
        const limit = Number.isFinite(Number(inputObj.limit)) ? Number(inputObj.limit) : null;
        return {
          filePath: trunc(toRelIfPossible(fp), 500),
          ...(offset != null ? { offset } : {}),
          ...(limit != null ? { limit } : {})
        };
      }

      if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
        const fp = typeof inputObj.file_path === 'string' ? inputObj.file_path : '';
        return { filePath: trunc(toRelIfPossible(fp), 500) };
      }

      if (toolName === 'Grep') {
        const pattern =
          typeof inputObj.pattern === 'string' ? inputObj.pattern
            : (typeof inputObj.query === 'string' ? inputObj.query : '');
        const searchPath =
          typeof inputObj.path === 'string' ? inputObj.path
            : (typeof inputObj.root === 'string' ? inputObj.root : '');
        return {
          pattern: trunc(pattern, 500),
          path: trunc(toRelIfPossible(searchPath), 500)
        };
      }

      if (toolName === 'Glob') {
        const globPattern =
          typeof inputObj.pattern === 'string' ? inputObj.pattern
            : (typeof inputObj.glob_pattern === 'string' ? inputObj.glob_pattern : '');
        const searchPath =
          typeof inputObj.path === 'string' ? inputObj.path
            : (typeof inputObj.root === 'string' ? inputObj.root : '');
        return {
          pattern: trunc(globPattern, 500),
          path: trunc(toRelIfPossible(searchPath), 500)
        };
      }

      // Default: no summary (avoid leaking large/complex inputs by default)
      return null;
    } catch {
      return null;
    }
  };

  const formatToolPreview = (toolName, toolInput) => {
    try {
      const inputObj = (toolInput && typeof toolInput === 'object') ? toolInput : null;
      if (!inputObj) return '';

      const toRelIfPossible = (p) => {
        const raw = typeof p === 'string' ? p.trim() : '';
        if (!raw) return '';
        if (!path.isAbsolute(raw)) return normalizeRelPath(raw);
        const rel = toRelPathInsideProject(projectRoot, raw);
        return rel ? normalizeRelPath(rel) : raw;
      };
      if (toolName === 'Bash') {
        const cmd = typeof inputObj.command === 'string' ? inputObj.command : (typeof inputObj.cmd === 'string' ? inputObj.cmd : '');
        return cmd ? `: ${cmd}` : '';
      }
      if (toolName === 'TaskOutput') {
        const taskId = typeof inputObj.task_id === 'string' ? inputObj.task_id : (typeof inputObj.taskId === 'string' ? inputObj.taskId : '');
        return taskId ? `: ${taskId}` : '';
      }
      if (toolName === 'WebFetch') {
        const url = typeof inputObj.url === 'string' ? inputObj.url : (typeof inputObj.uri === 'string' ? inputObj.uri : '');
        return url ? `: ${url}` : '';
      }
      if (toolName === 'Skill') {
        // Primary: The SDK uses 'skill' parameter for the skill name
        const name =
          (typeof inputObj.skill === 'string' ? inputObj.skill : '') ||
          (typeof inputObj.command_name === 'string' ? inputObj.command_name : '') ||
          (typeof inputObj.commandName === 'string' ? inputObj.commandName : '') ||
          (typeof inputObj.skill_name === 'string' ? inputObj.skill_name : '') ||
          (typeof inputObj.skillName === 'string' ? inputObj.skillName : '') ||
          (typeof inputObj.name === 'string' ? inputObj.name : '');
        // Primary: The SDK uses 'args' parameter for arguments
        const arg =
          (typeof inputObj.args === 'string' ? inputObj.args : '') ||
          (typeof inputObj.argument === 'string' ? inputObj.argument : '');
        const nm = String(name || '').trim();
        if (!nm) return '';
        const extra = String(arg || '').trim();
        return extra ? `: /${nm} ${extra}` : `: /${nm}`;
      }
      if (toolName === 'Agent') {
        const subagentType =
          (typeof inputObj.subagent_type === 'string' ? inputObj.subagent_type : '') ||
          (typeof inputObj.subagentType === 'string' ? inputObj.subagentType : '');
        const st = String(subagentType || '').trim();
        return st ? `: ${st}` : '';
      }
      if (toolName === 'Read') {
        const fp = typeof inputObj.file_path === 'string' ? inputObj.file_path : '';
        const rel = toRelIfPossible(fp);
        return rel ? `: ${rel}` : '';
      }
      if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
        const fp = typeof inputObj.file_path === 'string' ? inputObj.file_path : '';
        const rel = toRelIfPossible(fp);
        return rel ? `: ${rel}` : '';
      }
      if (toolName === 'Grep') {
        const pattern =
          typeof inputObj.pattern === 'string' ? inputObj.pattern
            : (typeof inputObj.query === 'string' ? inputObj.query : '');
        const searchPath =
          typeof inputObj.path === 'string' ? inputObj.path
            : (typeof inputObj.root === 'string' ? inputObj.root : '');
        const relPath = toRelIfPossible(searchPath);
        if (pattern && searchPath) return `: "${pattern}" in ${searchPath}`;
        if (pattern) return `: "${pattern}"`;
        if (relPath) return `: ${relPath}`;
      }
      if (toolName === 'Glob') {
        const globPattern =
          typeof inputObj.pattern === 'string' ? inputObj.pattern
            : (typeof inputObj.glob_pattern === 'string' ? inputObj.glob_pattern : '');
        const searchPath =
          typeof inputObj.path === 'string' ? inputObj.path
            : (typeof inputObj.root === 'string' ? inputObj.root : '');
        const relPath = toRelIfPossible(searchPath);
        if (globPattern && searchPath) return `: "${globPattern}" in ${searchPath}`;
        if (globPattern) return `: "${globPattern}"`;
        if (relPath) return `: ${relPath}`;
      }
      if (toolName === 'TodoWrite' || toolName === 'todo_write') {
        const todos = Array.isArray(inputObj.todos) ? inputObj.todos : [];
        if (todos.length === 0) return '';
        const taskTexts = todos.map(t => (t && typeof t.content === 'string') ? t.content : '').filter(Boolean);
        if (taskTexts.length === 0) return '';
        if (taskTexts.length === 1) return `: ${taskTexts[0]}`;
        return `: ${taskTexts.length} tasks: ${taskTexts[0]}, …`;
      }
      // Generic: show a compact JSON preview for debuggability
      const preview = safeStringify(inputObj, 300);
      return preview ? `: ${preview}` : '';
    } catch {
      return '';
    }
  };

  const copyPlanFileToWorkspace = async (planPath) => {
    try {
      const src = path.resolve(String(planPath || ''));
      if (!isAllowedClaudePlanPath(src)) return null;
      const baseName = path.basename(src);
      const workspaceSlug = slugifyWorkspaceName(path.basename(projectRoot));
      const workspaceHash = shortHash(projectRoot);
      const destDir = path.resolve(projectRoot);
      const destName = `plan-${workspaceSlug}-${workspaceHash}-${baseName}`;
      const dest = path.join(destDir, destName);
      const MAX_RETRIES = 8;
      for (let i = 0; i < MAX_RETRIES; i += 1) {
        try {
          await fs.promises.stat(src);
          await fs.promises.copyFile(src, dest);
          return { src, dest };
        } catch (err) {
          if (i === MAX_RETRIES - 1) throw err;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  const planWriteByToolUseId = new Map(); // toolUseId -> plan file path

  const emitToolExecuted = (hookInput) => {
    try {
      if (!hookInput || hookInput.hook_event_name !== 'PostToolUse') return;
      const toolName = hookInput.tool_name;
      if (!toolName) return;
      if (toolName === 'ExitPlanMode') {
        try {
          const rc = getClaudeSdkRunControl(requestId);
          const nextModeRaw = (rc && typeof rc.resumePermissionMode === 'string')
            ? rc.resumePermissionMode
            : 'acceptEdits';
          const nextMode = normalizePermissionMode({ permissionMode: nextModeRaw, toolPermissionMode });
          setClaudeSdkRunControl(requestId, { permissionMode: nextMode });
          onEvent?.({
            requestId,
            type: 'permission_mode_changed',
            sessionId: hookInput.session_id || uiSessionId || null,
            permissionMode: nextMode,
            source: 'exit_plan_mode'
          });
        } catch { /* ignore */ }
      }
      const toolInput = hookInput.tool_input && typeof hookInput.tool_input === 'object' ? hookInput.tool_input : null;
      const toolResp = hookInput.tool_response && typeof hookInput.tool_response === 'object' ? hookInput.tool_response : null;
      const trackedPlanPath = planWriteByToolUseId.get(hookInput.tool_use_id || '');
      if (trackedPlanPath) {
        planWriteByToolUseId.delete(hookInput.tool_use_id || '');
      }
      const toolPathRaw =
        trackedPlanPath ||
        (toolInput && typeof toolInput.file_path === 'string' ? toolInput.file_path : '') ||
        (toolInput && typeof toolInput.filePath === 'string' ? toolInput.filePath : '') ||
        (toolInput && typeof toolInput.path === 'string' ? toolInput.path : '');
      if ((toolName === 'Write' || toolName === 'Edit') && toolPathRaw) {
        try {
          const resolvedPlanPath = path.isAbsolute(toolPathRaw)
            ? path.resolve(toolPathRaw)
            : path.resolve(projectRoot, toolPathRaw);
          if (isAllowedClaudePlanPath(resolvedPlanPath)) {
            copyPlanFileToWorkspace(resolvedPlanPath).then((res) => {
              if (res && typeof onEvent === 'function') {
                onEvent({
                  requestId,
                  type: 'plan_file_copied',
                  sessionId: hookInput.session_id || uiSessionId || null,
                  src: res.src,
                  dest: res.dest
                });
              }
            }).catch(() => {});
          }
        } catch { /* ignore */ }
      }
      if (toolName === 'ExitPlanMode' && toolResp) {
        const planPath =
          (typeof toolResp.filePath === 'string' ? toolResp.filePath : '') ||
          (typeof toolResp.file_path === 'string' ? toolResp.file_path : '') ||
          (typeof toolResp.planFilePath === 'string' ? toolResp.planFilePath : '');
        if (planPath) {
          copyPlanFileToWorkspace(planPath).then((res) => {
            if (res && typeof onEvent === 'function') {
              onEvent({
                requestId,
                type: 'plan_file_copied',
                sessionId: hookInput.session_id || uiSessionId || null,
                src: res.src,
                dest: res.dest
              });
            }
          }).catch(() => {});
        }
      }
      const receipt = {
        permissionMode: getRuntimePermissionMode(),
        cwd: (toolName === 'Bash' && toolInput && typeof toolInput.cwd === 'string') ? toolInput.cwd : null,
        networkPolicy: (toolName === 'WebFetch') ? normalizedNetworkPolicy : null,
        exitCode: toolResp && (typeof toolResp.exitCode === 'number' ? toolResp.exitCode : (typeof toolResp.exit_code === 'number' ? toolResp.exit_code : null)),
        success: toolResp && (typeof toolResp.success === 'boolean' ? toolResp.success : null)
      };

      // For UI mirroring (Terminal panel): include best-effort tool output for Bash/TaskOutput.
      // IMPORTANT: cap size to avoid huge IPC payloads / runaway memory.
      let toolOutput = null;
      let toolOutputTruncated = false;
      if ((toolName === 'Bash' || toolName === 'TaskOutput') && toolResp && typeof toolResp === 'object') {
        try {
          const pick = (...keys) => {
            for (const k of keys) {
              if (typeof toolResp[k] === 'string' && toolResp[k]) return toolResp[k];
            }
            return '';
          };
          const out = pick('output', 'stdout', 'stdOut', 'result', 'text');
          const err = pick('stderr', 'stdErr', 'errorOutput');
          const combined = (out || '') + ((err && err.trim()) ? `\n${err}` : '');
          const raw = String(combined || '').replace(/\r\n/g, '\n');
          if (raw.trim()) {
            const MAX = 120_000;
            if (raw.length > MAX) {
              toolOutput = raw.slice(0, MAX) + '\n… (output truncated)';
              toolOutputTruncated = true;
            } else {
              toolOutput = raw;
            }
          }
        } catch {
          toolOutput = null;
          toolOutputTruncated = false;
        }
      }

      // Bash background tasks often return a task id instead of stdout.
      let taskId = null;
      if (toolName === 'Bash' && toolResp && typeof toolResp === 'object') {
        try {
          const tid =
            (typeof toolResp.task_id === 'string' ? toolResp.task_id : null) ||
            (typeof toolResp.taskId === 'string' ? toolResp.taskId : null) ||
            (typeof toolResp.id === 'string' ? toolResp.id : null);
          taskId = tid ? String(tid).trim() : null;
        } catch {
          taskId = null;
        }
      }
      onEvent({
        requestId,
        type: 'tool_executed',
        sessionId: hookInput.session_id,
        toolName,
        toolUseId: hookInput.tool_use_id,
        toolInputSummary: summarizeToolInput(toolName, toolInput),
        preview: formatToolPreview(toolName, hookInput.tool_input),
        receipt,
        ...(toolOutput ? { toolOutput, toolOutputTruncated } : {}),
        ...(taskId ? { taskId } : {})
      });
    } catch {
      // ignore
    }
  };

  const emitFileDiff = async (hookInput) => {
    try {
      if (!hookInput || !hookInput.tool_name) return;
      const toolName = hookInput.tool_name;
      const toolInput = hookInput.tool_input && typeof hookInput.tool_input === 'object' ? hookInput.tool_input : null;

      const emitOne = async (filePathStr) => {
        if (typeof filePathStr !== 'string' || !filePathStr.trim()) return;
        const raw = filePathStr.trim();
        const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
        if (!isPathInsideRoot(projectRoot, abs)) return;
        const rel = toRelPathInsideProject(projectRoot, abs);
        if (!rel || rel === '.') return;
        const normRel = normalizeRelPath(rel);
        if (!normRel || normRel === '.' || isHiddenOrInternalRelPath(normRel)) return;
        const diff = await gitDiffForPath(projectRoot, rel);
        if (!diff || !diff.trim()) return;
        const sig = diffSignature(diff);
        const prevSig = lastSeenSigByPath.get(normRel);
        if (prevSig && prevSig === sig) return;
        onEvent({
          requestId,
          type: 'file_diff',
          sessionId: hookInput.session_id,
          toolName,
          filePath: normRel,
          diffContent: diff
        });
        lastSeenSigByPath.set(normRel, sig);
      };

      // Claude Code file mutation tools
      const MUTATION_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
      if (MUTATION_TOOLS.has(toolName)) {
        const fp = toolInput && typeof toolInput.file_path === 'string' ? toolInput.file_path : null;
        if (fp) await emitOne(fp);
        return;
      }

      // Bash can mutate multiple files; we emit diffs only for files whose diff changed since:
      // - run start (baseline), and
      // - last emission (prevents repeated spam + cross-tab bleed)
      if (toolName === 'Bash') {
        const status = await gitStatusPorcelain(projectRoot);
        if (!status) return;
        const paths = parseGitStatusPorcelainPaths(status);
        // Cap to avoid spamming the UI.
        const maxFiles = 8;
        let emitted = 0;
        for (const rawPath of paths) {
          if (emitted >= maxFiles) break;
          const rel = normalizeRelPath(rawPath);
          if (!rel || rel === '.' || isHiddenOrInternalRelPath(rel)) continue;
          // If the file was already dirty at run start AND we didn't capture a baseline signature
          // (due to cap), skip it to avoid pulling in unrelated diffs from other tabs/sessions.
          if (baselineDirtyPaths.has(rel) && !baselineSigByPath.has(rel)) continue;
          const before = lastSeenSigByPath.get(rel);
          await emitOne(rel);
          const after = lastSeenSigByPath.get(rel);
          if (after && after !== before) emitted++;
        }
      }
    } catch {
      // ignore
    }
  };

  const emitPreToolUseGate = async (hookInput) => {
    try {
      if (!hookInput || hookInput.hook_event_name !== 'PreToolUse') return { continue: true };
      const toolName = String(hookInput.tool_name || '').trim();
      const toolUseId = String(hookInput.tool_use_id || '').trim();
      const inputObj = (hookInput.tool_input && typeof hookInput.tool_input === 'object') ? hookInput.tool_input : {};

      // ----------------------------
      // 0) Plan mode hard block (defense-in-depth)
      // ----------------------------
      try {
        if (getRuntimePermissionMode() === 'plan') {
          const rawPlanPath =
            (inputObj && typeof inputObj.file_path === 'string' ? inputObj.file_path : '') ||
            (inputObj && typeof inputObj.filePath === 'string' ? inputObj.filePath : '') ||
            (inputObj && typeof inputObj.path === 'string' ? inputObj.path : '');
          const resolvedPlanPath = rawPlanPath
            ? (path.isAbsolute(rawPlanPath) ? path.resolve(rawPlanPath) : path.resolve(projectRoot, rawPlanPath))
            : '';
          const allowPlanWrite = isEditToolName(toolName) && resolvedPlanPath && isAllowedClaudePlanPath(resolvedPlanPath);
          if (!(isReadOnlyToolName(toolName) || isExitPlanModeToolName(toolName) || allowPlanWrite)) {
            try {
              onEvent?.({
                requestId,
                type: 'gate_event',
                kind: 'plan_mode_denied',
                toolName,
                toolUseId: toolUseId || null,
                permissionMode: 'plan'
              });
            } catch { /* ignore */ }
            return {
              continue: false,
              decision: 'block',
              reason: `Plan mode denied tool "${toolName}"`,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: 'plan_mode'
              }
            };
          }
        }
      } catch {
        // ignore plan enforcement failures; do not block tool execution unexpectedly
      }

      // ----------------------------
      // 1) Pause-before-next-tool
      // ----------------------------
      try {
        const rc = getClaudeSdkRunControl(requestId);
        const pausedByRequestId = !!(rc && rc.pauseBeforeNextTool === true);
        const pausedBySession = !!(uiSessionId && pauseBeforeNextToolByUiSessionId.get(String(uiSessionId)) === true);
        const shouldPause = pausedByRequestId || pausedBySession;
        // Auto-continue for specific tools (do not prompt). Keep pause enabled for the next tool.
        if (shouldPause && PAUSE_AUTO_CONTINUE_TOOLS.has(toolName)) {
          try { aetDebugLog('pause_auto_continue_tool', { toolName, toolUseId: toolUseId || null, uiSessionId: uiSessionId || null }); } catch { /* ignore */ }
          return { continue: true };
        }
        if (shouldPause && typeof requestUserPermission === 'function') {
          // Ask UI whether to continue or skip this tool.
          const allowed = await requestUserPermission({
            toolName: '__PAUSE_BEFORE_TOOL__',
            input: {
              nextToolName: toolName,
              nextToolInput: inputObj || null,
              toolUseId: toolUseId || null
            }
          });
          if (!allowed) {
            try {
              // Emit a gate event so AET records a Warning/Blocked node chain.
              onEvent?.({
                requestId,
                type: 'gate_event',
                kind: 'pause_skip',
                toolName,
                toolUseId: toolUseId || null
              });
            } catch { /* ignore */ }
            return {
              continue: true,
              decision: 'block',
              reason: `Paused: user skipped tool "${toolName}"`,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: 'paused_skip'
              }
            };
          }
        }
      } catch {
        // ignore pause failures; do not block tool execution if pause UI bridge fails
      }

      // ----------------------------
      // 2) Locks + internal-state blocks (edit tools)
      // ----------------------------
      try {
        // Bash: prevent using shell commands to mutate locked files as a workaround.
        if (toolName === 'Bash') {
          const cmd = typeof inputObj.command === 'string'
            ? inputObj.command
            : (typeof inputObj.cmd === 'string' ? inputObj.cmd : '');
          if (cmd && _bashCommandLooksMutating(cmd)) {
            const { locksByRelPath } = await loadProjectLocks(projectRoot, { noCache: true });
            const lockedList = locksByRelPath && typeof locksByRelPath === 'object' ? Object.keys(locksByRelPath) : [];
            for (const lp of lockedList) {
              const normRel = normalizeRelPath(String(lp || ''));
              if (!normRel) continue;
              if (_bashCommandMentionsLockedPath(cmd, normRel)) {
                const locked = Object.prototype.hasOwnProperty.call(locksByRelPath, normRel) ? locksByRelPath[normRel] : null;
                try {
                  onEvent?.({
                    requestId,
                    type: 'gate_event',
                    kind: 'lock_block',
                    toolName,
                    filePath: normRel,
                    toolUseId: toolUseId || null,
                    lock: locked || null
                  });
                } catch { /* ignore */ }
                return {
                  continue: true,
                  decision: 'block',
                  systemMessage: `Blocked Bash mutation of locked file "${normRel}"`,
                  reason: `Blocked by lock (bash): ${normRel}`,
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason:
                      `Locked file: "${normRel}". ` +
                      `This Bash command appears to modify it. ` +
                      `Skip this file and continue with other tasks/files. ` +
                      `Do NOT attempt lock workarounds via Bash. ` +
                      `At the end, report it as skipped due to a lock and ask the user to unlock if they want it changed.`
                  }
                };
              }
            }
          }
        }

        if (isEditToolName(toolName)) {
          const fp = typeof inputObj.file_path === 'string' ? inputObj.file_path.trim() : '';
          const abs = fp ? (path.isAbsolute(fp) ? path.resolve(fp) : path.resolve(projectRoot, fp)) : '';
          const rel = abs ? toRelPathInsideProject(projectRoot, abs) : null;
          const normRel = rel ? normalizeRelPath(rel) : '';

          // Block internal state edits
          if (normRel && isHiddenOrInternalRelPath(normRel)) {
            try {
              onEvent?.({
                requestId,
                type: 'gate_event',
                kind: 'internal_write_block',
                toolName,
                filePath: normRel,
                toolUseId: toolUseId || null
              });
            } catch { /* ignore */ }
            return {
              continue: true,
              decision: 'block',
              reason: `Blocked internal write: ${normRel}`,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: 'internal_write_block'
              }
            };
          }

          // Enforce locks (fresh read so mid-run locks take effect)
          if (normRel) {
            const { locksByRelPath } = await loadProjectLocks(projectRoot, { noCache: true });
            const locked = locksByRelPath && Object.prototype.hasOwnProperty.call(locksByRelPath, normRel) ? locksByRelPath[normRel] : null;
            if (locked) {
              try {
                onEvent?.({
                  requestId,
                  type: 'gate_event',
                  kind: 'lock_block',
                  toolName,
                  filePath: normRel,
                  toolUseId: toolUseId || null,
                  lock: locked
                });
              } catch { /* ignore */ }
              const lockInstruction =
                `Locked file: "${normRel}". ` +
                `Skip this file and continue with other tasks/files. ` +
                `Do NOT retry editing it or attempt workarounds via Bash. ` +
                `At the end, report it as skipped due to a lock and ask the user to unlock if they want it changed.`;
              return {
                continue: true,
                decision: 'block',
                // NOTE: `systemMessage` is primarily shown to the user; the *model* will see a blockingError
                // derived from `permissionDecisionReason`/`reason`. Put the actionable guidance there.
                systemMessage: `Blocked edit: locked file "${normRel}"`,
                reason: `Blocked by lock: ${normRel}`,
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: lockInstruction
                }
              };
            }
          }
        }
      } catch {
        // If lock logic fails, don't block tool execution unexpectedly.
      }

      return { continue: true };
    } catch {
      return { continue: true };
    }
  };

  const env = {
    ...process.env,
    // Ensure consistent output; avoid forcing CI/TERM for auth flows (CLI needs a TTY for login UX).
    NO_COLOR: '1',
    ...(isAuthCommand ? {} : { CI: '1', TERM: 'dumb' })
  };

  // macOS: Claude Code's internal file watcher can crash with:
  //   Error: UNKNOWN: unknown error, watch '/var/folders/.../T/docker_cli_...'
  // which can prevent streaming entirely.
  //
  // We do NOT disable file checking. Instead we force chokidar to use polling on macOS
  // to avoid fs.watch edge-case failures on ephemeral temp paths.
  try {
    if (process.platform === 'darwin') {
      if (env.CHOKIDAR_USEPOLLING == null) env.CHOKIDAR_USEPOLLING = '1';
      // Keep interval moderate to reduce CPU while staying responsive.
      if (env.CHOKIDAR_INTERVAL == null) env.CHOKIDAR_INTERVAL = '1500';
    }
  } catch { /* ignore */ }

  // Claude Code telemetry export can fail on some networks and should never kill the run.
  // Default to disabling OTEL exporters unless the user explicitly configured them.
  try {
    if (env.OTEL_TRACES_EXPORTER == null) env.OTEL_TRACES_EXPORTER = 'none';
    if (env.OTEL_METRICS_EXPORTER == null) env.OTEL_METRICS_EXPORTER = 'none';
    if (env.OTEL_LOGS_EXPORTER == null) env.OTEL_LOGS_EXPORTER = 'none';
  } catch { /* ignore */ }

  withAugmentedPath(env);
  
  // Codex integration: route requests through the local Anthropic<->Responses
  // proxy so the Claude Code subprocess can drive ChatGPT-subscription models
  // while keeping the full agent loop (tools, skills, AET, checkpoints).
  if (useCodex) {
    try {
      const { ensureCodexProxy } = require('./main/codex/codex-proxy');
      const proxyBase = await ensureCodexProxy();
      env.ANTHROPIC_BASE_URL = proxyBase;
      // The proxy authenticates with the stored ChatGPT OAuth token; the binary
      // still requires *some* auth value, so give it a placeholder.
      env.ANTHROPIC_AUTH_TOKEN = 'codex-proxy';
      delete env.ANTHROPIC_API_KEY;
      console.log('[Claude SDK] Using Codex provider via proxy:', proxyBase, '->', codexModel || '(default model)');
    } catch (err) {
      console.error('[Claude SDK] Failed to start Codex proxy:', err?.message || err);
      throw new Error(`Codex provider unavailable: ${err?.message || err}`);
    }
  } else if (useOpenRouter && openrouterApiKey) {
    // Route through OpenRouter: set base URL and use ANTHROPIC_AUTH_TOKEN
    env.ANTHROPIC_BASE_URL = 'https://openrouter.ai/api';
    env.ANTHROPIC_AUTH_TOKEN = String(openrouterApiKey || '').trim();
    // Ensure ANTHROPIC_API_KEY is empty (OpenRouter uses auth token)
    delete env.ANTHROPIC_API_KEY;
    // CRITICAL: Claude Code uses a separate "small/fast" model for background work
    // (auto-compaction/summarization, title + topic detection, quota probes). If we
    // don't pin it, the CLI falls back to a default Anthropic haiku slug (e.g.
    // `claude-3-5-haiku-...`) which does NOT exist on OpenRouter -> HTTP 404 ->
    // `error_during_execution` that aborts the whole run. This bites hard right after
    // generating images, because base64 image blocks balloon the context and trigger
    // auto-compaction. Pin it to a valid OpenRouter slug so background calls succeed.
    const orMainModel = String(openrouterModel || '').trim();
    if (orMainModel) {
      const orSmallModel = mapOpenRouterSmallModel(orMainModel);
      env.ANTHROPIC_SMALL_FAST_MODEL = orSmallModel;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = orSmallModel;
      // Newer Claude Code resolves model *classes* (haiku/sonnet/opus) from these env
      // vars for background + subagent work. Pin every one to a valid OpenRouter slug
      // so nothing falls back to a bare Anthropic default (e.g. `claude-sonnet-4-...`)
      // that doesn't exist on OpenRouter -> 404 -> aborted run.
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = orMainModel;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = orMainModel;
    }
    console.log('[Claude SDK] Using OpenRouter provider:', openrouterModel || '(default model)', '| small/fast:', env.ANTHROPIC_SMALL_FAST_MODEL || '(unset)');
  } else {
    // Direct Anthropic API: standard auth selection
    // - If apiKey is a non-empty string, force API-key auth.
    // - If apiKey is an empty string, force keyless auth by removing ANTHROPIC_API_KEY from the env,
    //   so Claude Code can use stored Claude.ai OAuth/session credentials.
    if (typeof apiKey === 'string') {
      const trimmed = apiKey.trim();
      if (trimmed) env.ANTHROPIC_API_KEY = trimmed;
      else delete env.ANTHROPIC_API_KEY;
    }
  }

  // For non-Anthropic providers (OpenRouter / Codex proxy), Claude Code's first-party
  // telemetry + error reporting POST to Anthropic endpoints that don't exist on the
  // provider's base URL. Those failed POSTs surface as noisy "1P event logging: N events
  // failed to export" errors in the run output. Disable nonessential traffic so they
  // never appear (and never compete with real model calls).
  if (useCodex || (useOpenRouter && openrouterApiKey)) {
    if (env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC == null) env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    if (env.DISABLE_TELEMETRY == null) env.DISABLE_TELEMETRY = '1';
    if (env.DISABLE_ERROR_REPORTING == null) env.DISABLE_ERROR_REPORTING = '1';
  }

  // IMPORTANT: We intentionally bypass Claude Code's *internal* interactive permission prompts
  // to avoid deadlocks (the CLI can otherwise wait for TTY input after init, leaving the renderer stuck).
  //
  // We enforce our own permission UX via `canUseTool` (which can prompt/deny based on permissionMode),
  // while still letting the SDK operate with a non-interactive permissionMode.
  const normalizedPermissionMode = normalizePermissionMode({ permissionMode, toolPermissionMode });
  const normalizedResumePermissionMode = normalizePermissionMode({
    permissionMode: resumePermissionMode || '',
    toolPermissionMode
  });
  // IMPORTANT:
  // Even with `canUseTool` (stdio permission bridge), Claude Code still applies its own
  // `--permission-mode` behavior. Modes like `acceptEdits` can still deny non-edit tools (e.g., Bash)
  // when the subprocess can't display/answer an interactive prompt, which shows up as
  // "Permission denials: Bash: denied" even though Codeon is in Accept Edits.
  //
  // To make Codeon the single source of truth for permissions, run Claude Code in bypass mode
  // and rely on `canUseTool` for all allow/deny/prompt decisions.
  // Exception: plan mode should be enforced by Claude Code itself to guarantee read-only behavior.
  const sdkPermissionMode = (normalizedPermissionMode === 'plan') ? 'plan' : 'bypassPermissions';
  const normalizedNetworkPolicy = normalizeNetworkPolicy(networkPolicy);
  // Claude Code sandboxing can introduce an internal HTTP proxy allowlist that blocks non-allowlisted
  // domains with a 403 (`X-Proxy-Error: blocked-by-allowlist`). In Codeon, we already enforce
  // workspace isolation + tool gating, so for allow_all we disable sandbox to prevent false negatives.
  const sdkSandbox = (normalizedNetworkPolicy.mode === 'allow_all') ? { enabled: false } : undefined;

  try {
    setClaudeSdkRunControl(requestId, {
      permissionMode: normalizedPermissionMode,
      resumePermissionMode: normalizedResumePermissionMode || 'acceptEdits'
    });
  } catch { /* ignore */ }

  const getRuntimePermissionMode = () => {
    try {
      const rc = getClaudeSdkRunControl(requestId);
      const rcMode = rc && typeof rc.permissionMode === 'string' ? rc.permissionMode.trim() : '';
      if (rcMode) return normalizePermissionMode({ permissionMode: rcMode, toolPermissionMode });
    } catch { /* ignore */ }
    return normalizedPermissionMode;
  };

  const emitSdkHookEvent = (hookInput) => {
    try {
      if (!hookInput || typeof hookInput !== 'object') return;
      const hookName = typeof hookInput.hook_event_name === 'string' ? hookInput.hook_event_name : '';
      if (!hookName) return;

      const toolName = typeof hookInput.tool_name === 'string' ? hookInput.tool_name : '';
      const toolInput = hookInput.tool_input && typeof hookInput.tool_input === 'object' ? hookInput.tool_input : null;
      const toolInputSummary = toolName ? summarizeToolInput(toolName, toolInput) : null;
      const relatedFiles = [];
      try {
        const fp = toolInputSummary && typeof toolInputSummary.filePath === 'string' ? toolInputSummary.filePath.trim() : '';
        if (fp) relatedFiles.push(fp);
      } catch { /* ignore */ }

      const permissionSuggestionsCount = Array.isArray(hookInput.permission_suggestions) ? hookInput.permission_suggestions.length : null;
      const error =
        typeof hookInput.error === 'string'
          ? hookInput.error
          : (hookInput.error != null ? safeStringify(hookInput.error, 2000) : null);

      const inputPreview = toolName ? formatToolPreview(toolName, toolInput) : '';

      if (typeof onEvent === 'function') {
        onEvent({
          requestId,
          type: 'sdk_hook',
          sessionId: hookInput.session_id || uiSessionId || null,
          hookEventName: hookName,
          toolName: toolName || null,
          toolUseId: hookInput.tool_use_id || null,
          agentId: hookInput.agent_id || null,
          agentType: hookInput.agent_type || null,
          permissionSuggestionsCount,
          ...(error ? { error } : {}),
          ...(inputPreview ? { inputPreview } : {}),
          ...(toolInputSummary ? { toolInputSummary } : {}),
          ...(relatedFiles.length ? { relatedFiles } : {})
        });
      }

      // Editor streaming (provider-agnostic):
      // If a file-mutation tool is about to run, emit the full file content snapshot so the renderer
      // can animate "typing" in Monaco even when we don't have raw Anthropic `input_json_delta`.
      try {
        if (hookName === 'PreToolUse' && toolInput && typeof toolInput === 'object') {
          const MUTATION_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
          if (MUTATION_TOOLS.has(toolName)) {
            const fpRaw = typeof toolInput.file_path === 'string'
              ? toolInput.file_path
              : (typeof toolInput.path === 'string' ? toolInput.path : '');
            const contentRaw =
              (typeof toolInput.content === 'string' ? toolInput.content : '') ||
              (typeof toolInput.file_text === 'string' ? toolInput.file_text : '') ||
              (typeof toolInput.text === 'string' ? toolInput.text : '');
            if (fpRaw && contentRaw) {
              const raw = fpRaw.trim();
              const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
              if (isPathInsideRoot(projectRoot, abs)) {
                const rel = toRelPathInsideProject(projectRoot, abs);
                const normRel = rel ? normalizeRelPath(rel) : '';
                if (normRel && normRel !== '.' && !isHiddenOrInternalRelPath(normRel)) {
                  const MAX = 600_000;
                  const content = contentRaw.length > MAX ? contentRaw.slice(0, MAX) : contentRaw;
                  onEvent({
                    requestId,
                    type: 'code_stream_snapshot',
                    sessionId: hookInput.session_id || uiSessionId || null,
                    toolName,
                    toolUseId: hookInput.tool_use_id || null,
                    filePath: normRel,
                    content,
                    truncated: contentRaw.length > MAX
                  });
                }
              }
            }
          }
        }
      } catch { /* ignore */ }
    } catch {
      // ignore
    }
  };

  // Determine the model to use: Codex model (sent through the proxy) takes
  // precedence, then OpenRouter, otherwise the standard model.
  const effectiveModel = useCodex
    ? (codexModel || 'codex/gpt-5.5')
    : ((useOpenRouter && openrouterModel) ? openrouterModel : model);

  // Load plugins from ~/.claude/settings.json (for Claude Code plugin support)
  let loadedPlugins = [];
  try {
    const os = require('os');
    const fs = require('fs').promises;
    const path = require('path');
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const settingsContent = await fs.readFile(settingsPath, 'utf-8');
    const settingsObj = JSON.parse(settingsContent);
    if (Array.isArray(settingsObj?.plugins)) {
      loadedPlugins = settingsObj.plugins.filter(p => p && p.type === 'local' && p.path);
      console.log(`[Claude SDK] Loaded ${loadedPlugins.length} plugin(s) from ~/.claude/settings.json`);
    }
  } catch (err) {
    // No plugins or settings.json doesn't exist - that's fine
    console.log('[Claude SDK] No plugins found in ~/.claude/settings.json:', err?.message || '');
  }
  
  // Image generation for the OpenRouter provider: OpenRouter has no built-in
  // image tool (unlike the Codex proxy), so we attach an in-process SDK MCP
  // server backed by an image model on OpenRouter (default Gemini image). This
  // gives the agent a `generate_image` tool while staying on OpenRouter.
  let mergedMcpServers = (mcpServers && typeof mcpServers === 'object') ? { ...mcpServers } : {};
  let imageToolActive = false;
  if (useOpenRouter && openrouterApiKey) {
    try {
      const { createImageMcpServer } = require('./main/imagegen/openrouter-image');
      const imageServer = createImageMcpServer({
        apiKey: openrouterApiKey,
        model: 'google/gemini-3.1-flash-image-preview',
        saveDir: process.env.CODEON_IMAGE_DIR || null,
      });
      if (imageServer) {
        mergedMcpServers.codeon_image = imageServer;
        imageToolActive = true;
        console.log('[Claude SDK] OpenRouter image tool enabled (google/gemini-3.1-flash-image-preview)');
      }
    } catch (err) {
      console.warn('[Claude SDK] Failed to enable OpenRouter image tool:', err?.message || err);
    }
  }

  const options = {
    abortController,
    cwd: projectRoot,
    env,
    ...(typeof effectiveModel === 'string' && effectiveModel.trim() ? { model: effectiveModel.trim() } : {}),
    ...(Object.keys(mergedMcpServers).length ? { mcpServers: mergedMcpServers } : {}),
    ...(Number.isFinite(Number(maxBudgetUsd)) && Number(maxBudgetUsd) > 0 ? { maxBudgetUsd: Number(maxBudgetUsd) } : {}),
    // Match Claude Code VS Code extension behavior (2.0.75):
    // - use stream-json IO
    // - include partial messages
    // - enable auth status + debug flags (useful for richer event stream)
    // The SDK forwards unknown flags via `extraArgs` as `--<flag>`.
    extraArgs: {
      debug: null,
      'debug-to-stderr': null,
      'enable-auth-status': null
    },
    // Enable all default Claude Code tools (including Bash, WebFetch, etc.)
    tools: { type: 'preset', preset: 'claude_code' },
    // Permission handling:
    // - SDK runs in a non-interactive permission mode (avoid TTY prompts)
    // - UI prompts/denies are enforced in `canUseTool` based on normalizedPermissionMode
    permissionMode: sdkPermissionMode,
    ...(sdkPermissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: createCanUseTool(projectRoot, {
      permissionMode: normalizedPermissionMode,
      toolPermissionMode,
      networkPolicy: normalizedNetworkPolicy,
      uiSessionId: uiSessionId || null,
      requestUserPermission,
      getRunControl: () => getClaudeSdkRunControl(requestId),
      recordPlanWrite: (toolUseID, planPath) => {
        if (!toolUseID || !planPath) return;
        planWriteByToolUseId.set(String(toolUseID), String(planPath));
      },
      emitGateEvent: (evt) => {
        try {
          if (typeof onEvent === 'function' && evt && typeof evt === 'object') {
            onEvent({ requestId, type: evt.type || 'gate_event', sessionId: uiSessionId || null, ...evt });
          }
        } catch { /* ignore */ }
      }
    }),
    // IMPORTANT: Sandbox settings have caused the Claude Code subprocess to stall after init in some environments.
    // We keep sandbox disabled in allow_all mode to avoid Claude Code's internal proxy allowlist 403s.
    ...(sdkSandbox ? { sandbox: sdkSandbox } : {}),
    includePartialMessages: true,
    enableFileCheckpointing: true,
    systemPrompt: (() => {
      const base = { type: 'preset', preset: 'claude_code' };
      const parts = [];
      try {
        const designAppend = buildAntiSlopAppend(projectRoot, prompt);
        if (designAppend) {
          console.log('[Claude SDK] Injecting anti-slop UI design guidance into system prompt');
          parts.push(designAppend);
        }
      } catch (err) {
        console.warn('[Claude SDK] Failed to build anti-slop append:', err?.message || err);
      }
      if (imageToolActive) {
        parts.push([
          '# Image generation tool available',
          'You have an image-generation tool `mcp__codeon_image__generate_image` (Google\'s image model via OpenRouter). Use it to create the imagery this UI needs, following the Imagery guidance above. Call it with `prompt` (describe the asset AND a single shared art direction), `filename` (e.g. `hero.png`), and `transparent: true` for cutouts — when transparent, prompt the subject on a solid pure magenta (#FF00FF) background. It saves the file and returns the path; move it into your project (e.g. `public/assets/`) and reference it with explicit width/height and alt text. Do NOT leave placeholder or broken image references.',
        ].join('\n'));
      }
      return parts.length ? { ...base, append: parts.join('\n\n') } : base;
    })(),
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (hookInput) => {
              return await emitPreToolUseGate(hookInput);
            }
          ]
        }
      ],
      PostToolUse: [
        {
          hooks: [
            async (hookInput) => {
              emitTodoUpdate(hookInput);
              emitToolExecuted(hookInput);
              await emitFileDiff(hookInput);
              return { continue: true };
            }
          ]
        }
      ],
      PermissionRequest: [
        {
          hooks: [
            async (hookInput) => {
              try { emitSdkHookEvent(hookInput); } catch { /* ignore */ }
              return { continue: true };
            }
          ]
        }
      ],
      PostToolUseFailure: [
        {
          hooks: [
            async (hookInput) => {
              try { emitSdkHookEvent(hookInput); } catch { /* ignore */ }
              return { continue: true };
            }
          ]
        }
      ],
      SessionStart: [
        {
          hooks: [
            async (hookInput) => {
              try { emitSdkHookEvent(hookInput); } catch { /* ignore */ }
              return { continue: true };
            }
          ]
        }
      ],
      SessionEnd: [
        {
          hooks: [
            async (hookInput) => {
              try { emitSdkHookEvent(hookInput); } catch { /* ignore */ }
              return { continue: true };
            }
          ]
        }
      ],
      Stop: [
        {
          hooks: [
            async (hookInput) => {
              try { emitSdkHookEvent(hookInput); } catch { /* ignore */ }
              return { continue: true };
            }
          ]
        }
      ],
      SubagentStart: [
        {
          hooks: [
            async (hookInput) => {
              try { emitSdkHookEvent(hookInput); } catch { /* ignore */ }
              return { continue: true };
            }
          ]
        }
      ],
      SubagentStop: [
        {
          hooks: [
            async (hookInput) => {
              try { emitSdkHookEvent(hookInput); } catch { /* ignore */ }
              return { continue: true };
            }
          ]
        }
      ],
      PreCompact: [
        {
          hooks: [
            async (hookInput) => {
              try { emitSdkHookEvent(hookInput); } catch { /* ignore */ }
              return { continue: true };
            }
          ]
        }
      ]
    },
    // NOTE: The SDK currently passes `--setting-sources` when `settingSources` is an array (even empty).
    //
    // Claude Code semantics:
    // - Must include 'project' to load CLAUDE.md + project settings/skills/agents.
    // - Include 'user' to load ~/.claude settings + user skills/agents.
    // - Include 'local' to load .claude/settings.local.json if present.
    //
    // This moves us out of SDK isolation mode and toward Claude Code behavior.
    settingSources: ['project', 'user', 'local'],
    // Pass loaded plugins (from ~/.claude/settings.json) to the SDK
    // Format: [{ type: 'local', path: '/abs/path/to/plugin' }, ...]
    ...(loadedPlugins.length > 0 ? { plugins: loadedPlugins } : {}),
    // Use SDK built-in CLI (cli.js) by default
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    ...(resumeSessionAt ? { resumeSessionAt } : {}),
    ...(forkSession ? { forkSession: true } : {})
  };
  applyElectronRunAsNode({ env, options });

  // PERF: streaming can produce thousands of tiny deltas.
  // Avoid O(n^2) string concatenation by buffering parts and joining only when needed.
  let accumulatedTextParts = [];
  let accumulatedTextLen = 0;
  const pushAccumulatedText = (s) => {
    const v = (typeof s === 'string') ? s : '';
    if (!v) return;
    accumulatedTextParts.push(v);
    accumulatedTextLen += v.length;
  };
  const getAccumulatedText = () => {
    if (accumulatedTextParts.length === 0) return '';
    if (accumulatedTextParts.length === 1) return accumulatedTextParts[0] || '';
    return accumulatedTextParts.join('');
  };
  let sessionId = null;
  let completed = false;
  let q = null; // assigned after query() starts; also used by interrupt()

  // Allow main process to hard-interrupt this run (Stop button).
  const interrupt = () => {
    try { setClaudeSdkRunControl(requestId, { cancelled: true }); } catch { /* ignore */ }
    try { completed = true; } catch { /* ignore */ }
    try {
      if (q && typeof q.interrupt === 'function') q.interrupt();
    } catch { /* ignore */ }
    try { abortController.abort(); } catch { /* ignore */ }
  };
  let stallTimer = null;
  let stallTimerArmed = false;
  let lastActivityAt = Date.now();
  // Watchdog: abort if Claude Code emits no events for too long.
  // Default to the maximum safe `setTimeout` delay (~24.8 days) so long-running tool chains don't get killed.
  // You can still override via env:
  // - CLAUDE_CODE_STREAM_STALL_TIMEOUT_MS=600000  (10 minutes)
  // - CLAUDE_CODE_STREAM_STALL_TIMEOUT_MS=0       (disable watchdog entirely)
  const MAX_SET_TIMEOUT_MS = 2_147_483_647;
  const STALL_MS = (() => {
    const raw = String(process.env.CLAUDE_CODE_STREAM_STALL_TIMEOUT_MS || '').trim();
    if (!raw) return MAX_SET_TIMEOUT_MS;
    const n = Number(raw);
    if (!Number.isFinite(n)) return MAX_SET_TIMEOUT_MS;
    if (n <= 0) return 0;
    // Keep a reasonable floor to avoid accidental ultra-low timeouts.
    if (n > 0 && n < 5_000) return 5_000;
    return Math.min(n, MAX_SET_TIMEOUT_MS);
  })();
  let stderrBuffer = '';

  const clearStallTimer = () => {
    try { if (stallTimer) clearTimeout(stallTimer); } catch { /* ignore */ }
    stallTimer = null;
  };

  const armOrResetStallTimer = () => {
    if (!stallTimerArmed) return;
    if (!STALL_MS) return; // disabled
    clearStallTimer();
    stallTimer = setTimeout(() => {
      if (completed || abortController.signal.aborted) return;
      const idleMs = Date.now() - lastActivityAt;
      const idleSec = Math.round(idleMs / 1000);
      const tail = stderrBuffer.trim()
        ? `\n\nClaude Code stderr (tail):\n${stderrBuffer.trim().slice(-2000)}`
        : '';
      onEvent({
        requestId,
        type: 'error',
        sessionId,
        error: `Claude Code stream appears stalled (no events for ~${idleSec}s).${tail}`
      });
      try { q.interrupt?.(); } catch { /* ignore */ }
      try { abortController.abort(); } catch { /* ignore */ }
    }, STALL_MS);
  };

  const touchActivity = () => {
    lastActivityAt = Date.now();
    armOrResetStallTimer();
  };

  // Capture subprocess stderr to make stalls diagnosable (prints to Electron main process logs).
  options.stderr = (chunk) => {
    try {
      const s = typeof chunk === 'string' ? chunk : String(chunk || '');
      if (!s) return;
      stderrBuffer += s;
      if (stderrBuffer.length > 20_000) stderrBuffer = stderrBuffer.slice(-20_000);
      // Show a short tail in terminal logs for immediate visibility.
      const tail = s.length > 500 ? s.slice(-500) : s;
      console.error(`[ClaudeSDK stderr][${requestId}] ${tail.trimEnd()}`);
    } catch {
      // ignore
    }
  };

  // ==========================================================================
  // Action-Forcing Instructions + Claude Code Translation Layer (OpenRouter-only)
  // ==========================================================================
  // IMPORTANT: These instructions reference our app/tooling conventions and can
  // confuse the native Claude Code flow (Anthropic login). Keep them scoped to
  // OpenRouter mode only.
  //
  // The translation layer helps non-Claude models understand Claude Code semantics
  // (skills, plugins, project boundaries, etc.)
  const buildActionForcingPrefix = (projectRoot, plugins) => {
    const projectPath = projectRoot || '.';
    const hasPlugins = Array.isArray(plugins) && plugins.length > 0;
    
    // Build plugin/skill context if plugins are loaded
    let skillContext = '';
    if (hasPlugins) {
      skillContext = `
<claude_code_translation_layer>
IMPORTANT: You are operating in a Claude Code-compatible environment with SKILLS and PLUGINS loaded.

SKILL/PLUGIN SEMANTICS (CRITICAL):
- Skills are KNOWLEDGE SOURCES that provide domain expertise and guidelines
- Skills are NOT output directories - NEVER write files to skill/plugin paths
- When a skill is invoked (via the Skill tool), READ its guidance but WRITE files to the PROJECT
- Paths like ~/.claude/plugins/* or ~/.claude/skills/* are READ-ONLY knowledge bases

USE SKILLS PROACTIVELY (DO NOT SKIP THIS STEP):
- Available skills are listed in your system context. Before doing the work, check whether a loaded skill matches the task and INVOKE it via the Skill tool — invoking the right skill IS your first action, not a delay.
- In particular, for ANY task that builds, styles, redesigns, or beautifies a UI / web page / component / app / landing page, your FIRST action MUST be to invoke the \`frontend-design\` skill (Skill tool) to load its design guidance, THEN build the project applying that guidance.
- "Act first" means act by loading the relevant skill and then implementing — it does NOT mean skip skills and rush to write generic code.

PROJECT DIRECTORY: ${projectPath}
- ALL files you create or edit MUST be inside this project directory
- Use RELATIVE paths from the project root (e.g., "src/App.jsx", "index.html")
- NEVER use absolute paths to ~/.claude/* for writing files
- If you need to create a landing page, create it at "${projectPath}/index.html" (or similar)

EXAMPLE - CORRECT SKILL USAGE:
User: "Use the frontend-design skill to build a landing page"
1. ✅ Invoke the Skill tool to read the skill's guidance
2. ✅ Apply the skill's design principles and knowledge
3. ✅ Write files to the PROJECT: "${projectPath}/index.html", "${projectPath}/styles.css", etc.
4. ❌ NEVER write to the skill's directory (e.g., ~/.claude/plugins/frontend-design/*)

EXAMPLE - WRONG (DO NOT DO THIS):
❌ Write to: /Users/*/.claude/plugins/frontend-design/skills/frontend-design/index.html
✅ Write to: ${projectPath}/index.html (or ${projectPath}/landing/index.html)
</claude_code_translation_layer>
`;
    }

    return `<critical_instructions>
PRIORITY OVERRIDE (READ FIRST):
- Always prioritize the LATEST user message. If a new message arrives, abandon any unfinished plan from earlier messages.
- Decide whether the latest message is:
  (A) A coding/work request that requires tools/project inspection, or
  (B) Conversational (greeting, intro, thanks, small talk) that does NOT require tools.
- If (B): respond conversationally. Do NOT use tools/commands. Do NOT call TodoWrite.
- If (A): follow the action-first guidance below.

${skillContext}

WHEN THE USER ASKS YOU TO FIX/BUILD/MODIFY SOMETHING (CATEGORY A):
1. ❌ DO NOT write explanations like "That issue is caused by..." or "The problem is..."
2. ❌ DO NOT propose solutions like "You should..." or "I recommend..."
3. ❌ DO NOT ask for permission like "Would you like me to..." or "Shall I..."
4. ✅ IMMEDIATELY use the available tools to implement the fix
5. ✅ Read files, make edits, run commands - take action FIRST
6. ✅ Only provide brief explanations AFTER you've completed the changes

EXAMPLES:
❌ BAD: "The issue is in the API endpoint. You need to add error handling. Here's the code you should use..."
✅ GOOD: [Immediately reads the file, adds error handling, then says "Added error handling to the API endpoint"]

❌ BAD: "I see the problem. The function is missing a return statement. You should modify line 42 like this: [code snippet]"
✅ GOOD: [Immediately edits line 42 to add the return statement, then says "Fixed missing return statement"]

WHEN A COMMAND / ACTION FAILS (build, script, API call, tool run, etc.):
✅ You MUST reproduce the failure, identify the root cause, implement the fix, then re-run the same command/action until it succeeds.
❌ Do NOT stop while it still fails.
❌ Do NOT "fix" by weakening validation or changing acceptance criteria. Fix the underlying implementation/configuration.

WHEN THE USER ASKS "WHAT FILES ARE IN THIS WORKSPACE?" OR SIMILAR:
✅ Do NOT rely on "Glob" alone — it may only show git-tracked / non-ignored files.
✅ Do NOT list hidden files/folders (dotfiles/dotfolders like .git, .env, .ai-agent, etc).
✅ Use a directory listing tool/command that reflects the real filesystem WITHOUT hidden entries (e.g. Bash "ls" (no -a) or "find" with hidden paths excluded), then summarize.

TODOWRITE TOOL USAGE (CRITICAL):
❌ Do NOT use TodoWrite for conversational messages (category B).
❌ Do NOT create TODO tasks for single-step operations or quick questions.
✅ ONLY use TodoWrite for complex multi-step coding tasks that genuinely need tracking (3+ steps).

REMINDER:
- If category (B), do NOT touch the project. Just reply.
- If category (A), act first, explain after (if needed).
</critical_instructions>

`;
  };

  // Apply for non-Claude providers (OpenRouter / Codex), never for auth commands.
  // These models under-trigger Claude Code's action conventions without a nudge.
  const shouldApplyActionForcing = (useOpenRouter === true || useCodex === true) && isAuthCommand !== true;
  const actionForcingPrefix = shouldApplyActionForcing ? buildActionForcingPrefix(projectRoot, loadedPlugins) : '';
  const enhancedPrompt = shouldApplyActionForcing ? (actionForcingPrefix + prompt) : prompt;

  // q is declared above to support interrupt().
  try {
    q = query({ prompt: enhancedPrompt, options });
  } catch (e) {
    // Important: query() can throw synchronously if the Claude Code subprocess fails to spawn
    // (e.g., ENOTDIR when attempting to execute binaries inside app.asar).
    const raw = e?.message || String(e);
    const looksLikeAsarRipgrep =
      raw.includes('spawn ENOTDIR') &&
      raw.includes('app.asar') &&
      raw.includes('claude-agent-sdk') &&
      raw.includes('ripgrep');
    const looksLike403Download =
      raw.includes('status code 403') && (raw.toLowerCase().includes('axioserror') || raw.toLowerCase().includes('axios'));

    let hint = '';
    if (looksLikeAsarRipgrep) {
      hint = '\n\nLikely cause: Claude Code is trying to execute ripgrep from inside app.asar (not a real directory on disk).\nFix: build with ASAR disabled, or ensure the Claude Code ripgrep binary is accessible outside ASAR.';
    } else if (looksLike403Download) {
      hint = '\n\nLikely cause: Claude Code attempted to download a dependency (often ripgrep) but the request was blocked (403). Fix: ship the dependency in the app bundle or allow the download origin.';
    }

    emitFatalInitError(new Error(`${raw}${hint}`), { sessionId: null });
    return { abortController, interrupt };
  }

  // MCP: ensure servers are applied via control channel (more reliable than only --mcp-config).
  // Also emit a status snapshot so the renderer can confirm Claude Code sees the servers.
  (async () => {
    try {
      const servers = (mergedMcpServers && Object.keys(mergedMcpServers).length) ? mergedMcpServers : null;
      if (!servers || !Object.keys(servers).length) return;

      if (typeof q.setMcpServers === 'function') {
        try {
          const res = await q.setMcpServers(servers);
          onEvent?.({ requestId, type: 'mcp_set_servers', sessionId: uiSessionId || null, result: res });
        } catch (e) {
          onEvent?.({ requestId, type: 'mcp_set_servers', sessionId: uiSessionId || null, error: e?.message || String(e) });
        }
      }

      if (typeof q.mcpServerStatus === 'function') {
        try {
          const status = await q.mcpServerStatus();
          // SDK 0.2.x adds `error` field to McpServerStatus for failed connections
          const enrichedStatus = Array.isArray(status) ? status.map(s => ({
            ...s,
            // Ensure error field is forwarded (new in SDK 0.2.0)
            error: s.error || null
          })) : status;
          onEvent?.({ requestId, type: 'mcp_status', sessionId: uiSessionId || null, mcpServers: enrichedStatus });
        } catch (e) {
          onEvent?.({ requestId, type: 'mcp_status', sessionId: uiSessionId || null, error: e?.message || String(e) });
        }
      }
    } catch {
      // ignore
    }
  })();

  // Tool use streaming state (accumulate partial JSON for streaming code)
  const toolUseBlocks = new Map(); // index -> { toolUseId, toolName, partialJson }
  // Yield to the event loop periodically so IPC timers + renderer paints aren't starved
  // by tight microtask loops when many events arrive back-to-back.
  let _streamLoopEventCount = 0;
  const _yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

  // First: surface init + auth status + tool progress + deltas
  (async () => {
    try {
      for await (const msg of q) {
        if (completed) break;
        if (!msg || typeof msg !== 'object') continue;
        // Periodically yield to let timers/IPC flush and UI paint.
        // NOTE: This must happen before early-`continue` branches below.
        _streamLoopEventCount++;
        if ((_streamLoopEventCount % 60) === 0) {
          try { await _yieldToEventLoop(); } catch { /* ignore */ }
        }
        if (stallTimerArmed && !(msg.type === 'system' && msg.subtype === 'init')) {
          touchActivity();
        }

        // Surface message UUIDs so the renderer can link "Restore & Retry" to Claude's resume/rewind features.
        // NOTE: We intentionally do not forward message content here (only UUIDs), to keep IPC light.
        if (msg.type === 'user' && msg.uuid) {
          onEvent({
            requestId,
            type: 'sdk_message_uuid',
            sessionId: msg.session_id,
            role: 'user',
            uuid: msg.uuid,
            isReplay: msg.isReplay === true
          });
        }
        if (msg.type === 'assistant' && msg.uuid) {
          onEvent({
            requestId,
            type: 'sdk_message_uuid',
            sessionId: msg.session_id,
            role: 'assistant',
            uuid: msg.uuid,
            isReplay: msg.isReplay === true
          });
        }
        if (msg.type === 'assistant') {
          if (msg.error) {
            onEvent({
              requestId,
              type: 'assistant_error',
              sessionId: msg.session_id,
              uuid: msg.uuid || null,
              error: msg.error
            });
          }

          // Different SDK versions may expose assistant text in different fields.
          const fullText = extractAssistantText(msg.message || msg);
          if (fullText) {
            const cleaned = stripAndEmitJpFromText(fullText, msg.session_id);
            if (cleaned.length > accumulatedTextLen) {
              accumulatedTextParts = [cleaned];
              accumulatedTextLen = cleaned.length;
            }

            // Keep existing full snapshot event (used by UI as a backup)
            onEvent({
              requestId,
              type: 'assistant_message',
              sessionId: msg.session_id,
              uuid: msg.uuid || null,
              text: cleaned
            });
            continue;
          }
        }

        if (msg.type === 'system' && msg.subtype === 'init') {
          sessionId = msg.session_id || sessionId;
          onEvent({
            requestId,
            type: 'init',
            sessionId,
            model: msg.model,
            tools: msg.tools,
            permissionMode: msg.permissionMode
          });
          stallTimerArmed = true;
          touchActivity();
          continue;
        }

        if (msg.type === 'auth_status') {
          onEvent({
            requestId,
            type: 'auth_status',
            sessionId: msg.session_id,
            isAuthenticating: !!msg.isAuthenticating,
            output: Array.isArray(msg.output) ? msg.output : [],
            error: msg.error || null
          });
          continue;
        }

        if (msg.type === 'tool_progress') {
          onEvent({
            requestId,
            type: 'tool_progress',
            sessionId: msg.session_id,
            toolName: msg.tool_name,
            toolUseId: msg.tool_use_id,
            parentToolUseId: msg.parent_tool_use_id,
            elapsedSeconds: msg.elapsed_time_seconds
          });
          continue;
        }

        if (msg.type === 'stream_event') {
          // IMPORTANT: Forward the raw stream_event to renderer for StreamAssembler processing.
          // This mirrors Claude Code VS Code extension's approach where the webview receives
          // raw Anthropic events and assembles them into messages.
          const rawEvent = msg.event || msg;
          onEvent({
            requestId,
            type: 'stream_event',
            sessionId: msg.session_id,
            parentToolUseId: msg.parent_tool_use_id || null,
            event: rawEvent
          });

          const { 
            textDelta, 
            thinkingDelta, 
            toolUseDelta, 
            contentBlockStart, 
            contentBlockStop, 
            index 
          } = extractStreamDeltas(rawEvent);

          // Handle tool use block start
          if (contentBlockStart && contentBlockStart.toolName) {
            const idx = contentBlockStart.index;
            toolUseBlocks.set(idx, {
              toolUseId: contentBlockStart.toolUseId,
              toolName: contentBlockStart.toolName,
              partialJson: ''
            });
            // Emit tool_use_start event for renderer awareness
            onEvent({
              requestId,
              type: 'tool_use_start',
              sessionId: msg.session_id,
              toolUseId: contentBlockStart.toolUseId,
              toolName: contentBlockStart.toolName,
              index: idx
            });
          }

          // Handle tool use input streaming (input_json_delta)
          if (toolUseDelta && toolUseDelta.partialJson) {
            const idx = typeof toolUseDelta.index === 'number' ? toolUseDelta.index : index;
            const block = toolUseBlocks.get(idx);
            if (block) {
              block.partialJson += toolUseDelta.partialJson;

              // Try to extract and stream code content for Write/Edit tools in real-time
              if (block.toolName === 'Write' || block.toolName === 'Edit') {
                try {
                  // Attempt incremental parse to extract partial content
                  const partialData = tryParsePartialToolInput(block.partialJson, block.toolName);
                  if (partialData) {
                    onEvent({
                      requestId,
                      type: 'code_stream_delta',
                      sessionId: msg.session_id,
                      toolUseId: block.toolUseId,
                      toolName: block.toolName,
                      filePath: partialData.path,
                      contentDelta: partialData.contentDelta,
                      fullContent: partialData.fullContent,
                      isComplete: false
                    });
                  }
                } catch {
                  // Ignore parse errors during streaming
                }
              }
            }
          }

          // Handle tool use block stop
          if (contentBlockStop) {
            const idx = contentBlockStop.index;
            const block = toolUseBlocks.get(idx);
            if (block && (block.toolName === 'Write' || block.toolName === 'Edit')) {
              try {
                // Parse complete JSON
                const toolInput = JSON.parse(block.partialJson);
                const filePath = toolInput.path || toolInput.file_path;
                
                onEvent({
                  requestId,
                  type: 'code_stream_complete',
                  sessionId: msg.session_id,
                  toolUseId: block.toolUseId,
                  toolName: block.toolName,
                  filePath,
                  content: toolInput.content || toolInput.file_text || '',
                  isComplete: true
                });
                
                // Reset partial parser state for this file
                if (tryParsePartialToolInput._lastContentLength) {
                  const key = `${block.toolName}_${filePath || 'unknown'}`;
                  delete tryParsePartialToolInput._lastContentLength[key];
                }
              } catch {
                // Ignore parse errors
              }
            }
            toolUseBlocks.delete(idx);
          }

          // Handle text/thinking deltas (existing logic)
          if (typeof thinkingDelta === 'string' && thinkingDelta.length > 0) {
            onEvent({
              requestId,
              type: 'thinking_delta',
              sessionId: msg.session_id,
              thinkingDelta
            });
          }
          if (typeof textDelta === 'string' && textDelta.length > 0) {
            const visibleDelta = stripAndEmitJpFromDelta(textDelta, msg.session_id);
            if (!visibleDelta) continue;
            pushAccumulatedText(visibleDelta);
            onEvent({
              requestId,
              type: 'text_delta',
              sessionId: msg.session_id,
              textDelta: visibleDelta
            });
          }
          continue;
        }

        if (msg.type === 'result') {
          // Prefer the SDK result string for final content; fall back to accumulated stream.
          const finalText = (msg.subtype === 'success' && typeof msg.result === 'string')
            ? msg.result
            : getAccumulatedText();
          // Flush any pending partial JP line and strip JP from final output.
          if (jpPartialLine) {
            const flush = stripAndEmitJpFromText(jpPartialLine, msg.session_id);
            if (flush && flush.trim()) pushAccumulatedText(flush);
            jpPartialLine = '';
          }
          const cleanedFinal = stripAndEmitJpFromText(finalText, msg.session_id);

          completed = true;
          onEvent({
            requestId,
            type: 'result',
            sessionId: msg.session_id,
            subtype: msg.subtype,
            isError: !!msg.is_error,
            result: cleanedFinal || '',
            errors: msg.errors || null,
            permissionDenials: Array.isArray(msg.permission_denials) ? msg.permission_denials : [],
            totalCostUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
            usage: msg.usage || null
          });
          continue;
        }

        // Ignore other message types for now.
      }

      if (!completed) {
        completed = true;
        // Flush any pending partial JP line and strip JP from final output.
        if (jpPartialLine) {
          const flush = stripAndEmitJpFromText(jpPartialLine, sessionId);
          if (flush && flush.trim()) pushAccumulatedText(flush);
          jpPartialLine = '';
        }
        onEvent({ requestId, type: 'done', sessionId, finalText: getAccumulatedText() || '' });
      }
    } catch (e) {
      if (!completed) {
        completed = true;
        const tail = stderrBuffer.trim()
          ? `\n\nClaude Code stderr (tail):\n${stderrBuffer.trim().slice(-2000)}`
          : '';
        const hint = formatCommonClaudeFailureHint(`${e?.message || String(e)}\n${stderrBuffer || ''}`);
        onEvent({
          requestId,
          type: 'error',
          sessionId,
          error: `${e?.message || String(e)}${tail}${hint}`
        });
      }
    } finally {
      clearStallTimer();
      try { runControlsByRequestId.delete(String(requestId || '').trim()); } catch { /* ignore */ }
    }
  })();

  return { abortController, interrupt };
}

async function getClaudeAccountInfo({ projectRoot, apiKey }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const abortController = new AbortController();

  const env = {
    ...process.env,
    NO_COLOR: '1',
    CI: '1',
    TERM: 'dumb'
  };

  // macOS: Claude Code's internal file watcher can crash with:
  //   Error: UNKNOWN: unknown error, watch '/var/folders/.../T/docker_cli_...'
  // which can prevent streaming entirely.
  //
  // We do NOT disable file checking. Instead we force chokidar to use polling on macOS
  // to avoid fs.watch edge-case failures on ephemeral temp paths.
  try {
    if (process.platform === 'darwin') {
      if (env.CHOKIDAR_USEPOLLING == null) env.CHOKIDAR_USEPOLLING = '1';
      // Keep interval moderate to reduce CPU while staying responsive.
      if (env.CHOKIDAR_INTERVAL == null) env.CHOKIDAR_INTERVAL = '1500';
    }
  } catch { /* ignore */ }

  withAugmentedPath(env);

  // Auth selection:
  // - If apiKey is a non-empty string, force API-key auth.
  // - If apiKey is an empty string, force keyless auth by removing ANTHROPIC_API_KEY from the env.
  if (typeof apiKey === 'string') {
    const trimmed = apiKey.trim();
    if (trimmed) env.ANTHROPIC_API_KEY = trimmed;
    else delete env.ANTHROPIC_API_KEY;
  }

  const emptyInput = async function* emptyInputGen() { /* no user messages */ };

  const options = {
    abortController,
    cwd: projectRoot,
    env,
    // Enable auth status messages (best-effort, may help debugging)
    extraArgs: { 'enable-auth-status': null },
    tools: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'acceptEdits',
    includePartialMessages: false,
    enableFileCheckpointing: false
  };
  applyElectronRunAsNode({ env, options });

  const q = query({ prompt: emptyInput(), options });

  let initModel = null;
  const timeoutMs = 8000;
  const timeout = setTimeout(() => {
    try { abortController.abort(); } catch { /* ignore */ }
  }, timeoutMs);

  try {
    for await (const msg of q) {
      if (msg && msg.type === 'system' && msg.subtype === 'init') {
        initModel = msg.model || null;
        break;
      }
    }
  } catch {
    // ignore; we'll still try accountInfo below
  } finally {
    try { clearTimeout(timeout); } catch { /* ignore */ }
  }

  let account = null;
  try {
    account = await q.accountInfo();
  } catch {
    account = null;
  } finally {
    try { abortController.abort(); } catch { /* ignore */ }
  }

  return { account, model: initModel };
}

async function getClaudeSupportedModels({ projectRoot, apiKey }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const abortController = new AbortController();

  const env = {
    ...process.env,
    NO_COLOR: '1',
    CI: '1',
    TERM: 'dumb'
  };

  // macOS: Claude Code's internal file watcher can crash with:
  //   Error: UNKNOWN: unknown error, watch '/var/folders/.../T/docker_cli_...'
  // which can prevent streaming entirely.
  //
  // We do NOT disable file checking. Instead we force chokidar to use polling on macOS
  // to avoid fs.watch edge-case failures on ephemeral temp paths.
  try {
    if (process.platform === 'darwin') {
      if (env.CHOKIDAR_USEPOLLING == null) env.CHOKIDAR_USEPOLLING = '1';
      // Keep interval moderate to reduce CPU while staying responsive.
      if (env.CHOKIDAR_INTERVAL == null) env.CHOKIDAR_INTERVAL = '1500';
    }
  } catch { /* ignore */ }

  withAugmentedPath(env);

  // Auth selection:
  // - If apiKey is a non-empty string, force API-key auth.
  // - If apiKey is an empty string, force keyless auth by removing ANTHROPIC_API_KEY from the env.
  if (typeof apiKey === 'string') {
    const trimmed = apiKey.trim();
    if (trimmed) env.ANTHROPIC_API_KEY = trimmed;
    else delete env.ANTHROPIC_API_KEY;
  }

  const emptyInput = async function* emptyInputGen() { /* no user messages */ };

  const options = {
    abortController,
    cwd: projectRoot,
    env,
    extraArgs: { 'enable-auth-status': null },
    tools: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'acceptEdits',
    includePartialMessages: false,
    enableFileCheckpointing: false
  };
  applyElectronRunAsNode({ env, options });

  const q = query({ prompt: emptyInput(), options });

  // Ensure init happens; control requests require streaming mode.
  const timeoutMs = 10_000;
  const timeout = setTimeout(() => {
    try { abortController.abort(); } catch { /* ignore */ }
  }, timeoutMs);

  try {
    for await (const msg of q) {
      if (msg && msg.type === 'system' && msg.subtype === 'init') break;
    }
  } catch {
    // ignore; supportedModels might still work, but usually requires init
  } finally {
    try { clearTimeout(timeout); } catch { /* ignore */ }
  }

  let models = null;
  try {
    models = await q.supportedModels();
  } catch {
    models = null;
  } finally {
    try { abortController.abort(); } catch { /* ignore */ }
  }

  return { models };
}

module.exports = {
  startClaudeSdkQuery,
  setClaudeSdkRunControl,
  resetClaudeSdkPauseState,
  getClaudeAccountInfo,
  getClaudeSupportedModels
};


