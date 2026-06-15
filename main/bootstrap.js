const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
// `bootstrap.js` lives under /main/, so `__dirname` is not the app root.
// Use APP_ROOT for all paths that refer to top-level project files (preload.js, renderer/, etc).
const APP_ROOT = path.resolve(__dirname, '..');
const { createLogger, redactDeep } = require('./logger');
const fs = require('fs').promises;
const fsSync = require('fs');
const readline = require('readline');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const os = require('os');
// PERF: defer heavy modules until they're actually needed (Electron best practice).
// - sql.js is wasm + relatively heavy to load
// - claude-sdk-service is large and only needed when user runs the agent
let initSqlJs = null;
let __claudeSdk = null;
function _getClaudeSdk() {
  if (!__claudeSdk) __claudeSdk = require(path.join(APP_ROOT, 'claude-sdk-service'));
  return __claudeSdk;
}

// ---------------------------------------------------------------------------
// Structured logging + safe console patch (prevents EPIPE + best-effort redaction)
// ---------------------------------------------------------------------------
const log = createLogger({
  name: 'Main',
  level: process.env.CODEON_LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info')
});
try { globalThis.__codeonMainLog = log; } catch { /* ignore */ }

const __rawConsole = {
  log: typeof console.log === 'function' ? console.log.bind(console) : () => {},
  info: typeof console.info === 'function' ? console.info.bind(console) : (typeof console.log === 'function' ? console.log.bind(console) : () => {}),
  warn: typeof console.warn === 'function' ? console.warn.bind(console) : (typeof console.log === 'function' ? console.log.bind(console) : () => {}),
  error: typeof console.error === 'function' ? console.error.bind(console) : (typeof console.log === 'function' ? console.log.bind(console) : () => {}),
};

function _safeConsoleArgs(args) {
  try {
    return args.map((a) => (typeof a === 'string' ? a : redactDeep(a)));
  } catch {
    return args;
  }
}

function _safeConsoleCall(fn, args) {
  try {
    fn(..._safeConsoleArgs(args));
  } catch {
    // ignore (EPIPE / write-after-end)
  }
}

const safeConsole = {
  log: (...args) => _safeConsoleCall(__rawConsole.log, args),
  info: (...args) => _safeConsoleCall(__rawConsole.info, args),
  warn: (...args) => _safeConsoleCall(__rawConsole.warn, args),
  error: (...args) => _safeConsoleCall(__rawConsole.error, args),
};

// ----------------------------------------------------------------------------
// Cross-Platform Claude Code Credential Reader
// Claude Code SDK v0.2.7+ uses OS-native credential stores:
//   - macOS: macOS Keychain (service: "Claude Code-credentials")
//   - Windows: Windows Credential Manager (via keytar)
//   - Linux/fallback: ~/.claude/.credentials.json
// ----------------------------------------------------------------------------

/**
 * Get the Claude Code service name for Keychain (matches SDK's Ms() function)
 * @param {string} suffix - Optional suffix (e.g., "-credentials" for OAuth)
 * @returns {string} Service name like "Claude Code-credentials"
 */
function getClaudeKeychainServiceName(suffix = '') {
  // In production, OAUTH_FILE_SUFFIX is empty string
  // If CLAUDE_CONFIG_DIR is set, a hash is appended, but we ignore that for now
  // as most users don't customize the config dir
  return `Claude Code${suffix}`;
}

/**
 * Get the username for Keychain account (matches SDK's Aa() function)
 * @returns {string} Username
 */
function getClaudeKeychainAccount() {
  try {
    return process.env.USER || os.userInfo().username || 'claude-code-user';
  } catch {
    return 'claude-code-user';
  }
}

/**
 * Read Claude OAuth credentials from macOS Keychain
 * The native Claude CLI stores credentials as plain JSON in Keychain
 * The VS Code extension stores them as HEX-encoded JSON
 * We try both formats.
 * @returns {Promise<{claudeAiOauth: object}|null>} Parsed credentials or null
 */
async function readClaudeCredentialsFromKeychain() {
  if (process.platform !== 'darwin') return null;
  
  try {
    const serviceName = getClaudeKeychainServiceName('-credentials');
    const account = getClaudeKeychainAccount();
    
    log.debug(`[Claude Keychain] Attempting to read from service="${serviceName}" account="${account}"`);
    
    // Use security command to read from Keychain
    // The -w flag outputs just the password
    const { stdout } = await execAsync(
      `security find-generic-password -a "${account}" -s "${serviceName}" -w`,
      { timeout: 5000 }
    );
    
    if (!stdout || !stdout.trim()) {
      log.debug('[Claude Keychain] No credentials found in Keychain');
      return null;
    }
    
    const rawData = stdout.trim();
    let parsed = null;
    
    // Try 1: Parse as plain JSON (native Claude CLI format)
    try {
      parsed = JSON.parse(rawData);
      if (parsed?.claudeAiOauth?.accessToken) {
        log.info('[Claude Keychain] Successfully read credentials from macOS Keychain (plain JSON format)');
        return parsed;
      }
    } catch {
      // Not plain JSON, try hex decoding
    }
    
    // Try 2: Decode as hex then parse (VS Code extension format)
    try {
      const jsonStr = Buffer.from(rawData, 'hex').toString('utf-8');
      parsed = JSON.parse(jsonStr);
      if (parsed?.claudeAiOauth?.accessToken) {
        log.info('[Claude Keychain] Successfully read credentials from macOS Keychain (hex-encoded format)');
        return parsed;
      }
    } catch {
      // Not hex-encoded JSON either
    }
    
    log.warn('[Claude Keychain] Found Keychain entry but could not parse credentials');
    return null;
  } catch (error) {
    // Error code 44 means item not found - this is expected when not logged in
    const errStr = String(error?.message || error || '');
    if (errStr.includes('could not be found') || errStr.includes('SecKeychainSearchCopyNext') || errStr.includes('44')) {
      log.debug('[Claude Keychain] No credentials found in Keychain (item not found)');
    } else {
      log.debug(`[Claude Keychain] Failed to read from Keychain: ${errStr}`);
    }
    return null;
  }
}

/**
 * Read Claude credentials from the fallback file
 * @returns {Promise<{claudeAiOauth: object}|null>} Parsed credentials or null
 */
async function readClaudeCredentialsFromFile() {
  try {
    const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const raw = await fs.readFile(credentialsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.claudeAiOauth?.accessToken) {
      log.debug('[Claude Credentials] Found credentials in file');
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read Claude credentials from all available sources
 * Priority: Keychain (macOS) -> File fallback
 * @param {object} options - Options
 * @param {boolean} options.syncToFile - If true, sync Keychain creds to file for SDK compatibility
 * @returns {Promise<{source: string, credentials: object}|null>}
 */
async function readClaudeCredentials(options = {}) {
  const { syncToFile = false } = options;
  
  // 1. Try macOS Keychain first (primary storage in SDK v0.2.7+)
  if (process.platform === 'darwin') {
    const keychainCreds = await readClaudeCredentialsFromKeychain();
    if (keychainCreds?.claudeAiOauth?.accessToken) {
      log.info('[Claude Credentials] Found credentials in macOS Keychain');
      
      // Optionally sync to file for SDK compatibility
      if (syncToFile) {
        try {
          const claudeDir = path.join(os.homedir(), '.claude');
          const credentialsPath = path.join(claudeDir, '.credentials.json');
          await fs.mkdir(claudeDir, { recursive: true });
          await fs.writeFile(credentialsPath, JSON.stringify(keychainCreds), { encoding: 'utf8', mode: 0o600 });
          log.info('[Claude Credentials] Synced Keychain credentials to file');
        } catch (syncErr) {
          log.warn(`[Claude Credentials] Failed to sync to file: ${syncErr?.message || syncErr}`);
        }
      }
      
      return { source: 'keychain', credentials: keychainCreds };
    }
  }
  
  // 2. Try file fallback (Linux, Windows, or macOS when Keychain fails)
  const fileCreds = await readClaudeCredentialsFromFile();
  if (fileCreds?.claudeAiOauth?.accessToken) {
    log.info('[Claude Credentials] Found credentials in file');
    return { source: 'file', credentials: fileCreds };
  }
  
  log.debug('[Claude Credentials] No credentials found in any source');
  return null;
}

/**
 * Save credentials to macOS Keychain (for writing back after auth)
 * Note: Prefixed with _ as it's reserved for future use when we implement Keychain write-back
 * @param {object} credentials - Credentials object with claudeAiOauth
 * @returns {Promise<boolean>} Success status
 */
async function _saveClaudeCredentialsToKeychain(credentials) {
  if (process.platform !== 'darwin') return false;
  
  try {
    const serviceName = getClaudeKeychainServiceName('-credentials');
    const account = getClaudeKeychainAccount();
    const jsonStr = JSON.stringify(credentials);
    const hexData = Buffer.from(jsonStr, 'utf-8').toString('hex');
    
    // Use security -i to pipe the command (more reliable for special chars)
    const addCmd = `add-generic-password -U -a "${account}" -s "${serviceName}" -X "${hexData}"\n`;
    
    await execAsync(`printf '%s' "${addCmd.replace(/"/g, '\\"')}" | security -i`, { timeout: 5000 });
    log.info('[Claude Keychain] Successfully saved credentials to macOS Keychain');
    return true;
  } catch (error) {
    log.error(`[Claude Keychain] Failed to save to Keychain: ${error?.message || error}`);
    return false;
  }
}

// ----------------------------------------------------------------------------
// Claude streaming debug logs (per-request JSONL under <project>/.codeon/debug/)
// ----------------------------------------------------------------------------
const claudeStreamDebugByRequestId = new Map(); // requestId -> { filePath, writeLine(), close() }

function _safeJsonlStringify(obj) {
  try { return JSON.stringify(obj); } catch { return JSON.stringify({ error: 'unserializable' }); }
}

function _truncateForLog(s, max = 260) {
  const str = typeof s === 'string' ? s : String(s || '');
  if (str.length <= max) return str;
  return str.slice(0, max) + `…(+${str.length - max})`;
}

function _sanitizeClaudeDebugEvent(evt) {
  try {
    if (!evt || typeof evt !== 'object') return evt;
    const t = String(evt.type || '');
    // Keep logs small but still useful for confirming streaming behavior.
    if (t === 'text_delta') {
      const d = typeof evt.textDelta === 'string' ? evt.textDelta : '';
      return { type: t, sessionId: evt.sessionId || null, len: d.length, sample: _truncateForLog(d, 200) };
    }
    if (t === 'thinking_delta') {
      const d = typeof evt.thinkingDelta === 'string' ? evt.thinkingDelta : '';
      return { type: t, sessionId: evt.sessionId || null, len: d.length, sample: _truncateForLog(d, 160) };
    }
    if (t === 'assistant_message') {
      const tx = typeof evt.text === 'string' ? evt.text : '';
      return { type: t, sessionId: evt.sessionId || null, len: tx.length };
    }
    if (t === 'file_diff') {
      const diff = typeof evt.diffContent === 'string' ? evt.diffContent : '';
      return { type: t, sessionId: evt.sessionId || null, toolName: evt.toolName || null, filePath: evt.filePath || null, diffLen: diff.length };
    }
    if (t === 'tool_executed') {
      return {
        type: t,
        sessionId: evt.sessionId || null,
        toolName: evt.toolName || null,
        toolUseId: evt.toolUseId || null,
        toolInputSummary: evt.toolInputSummary || null,
        preview: evt.preview ? _truncateForLog(String(evt.preview || ''), 260) : null,
        taskId: evt.taskId || null,
      };
    }
    if (t === 'sdk_hook') {
      return {
        type: t,
        sessionId: evt.sessionId || null,
        hookEventName: evt.hookEventName || null,
        toolName: evt.toolName || null,
        toolUseId: evt.toolUseId || null,
        permissionSuggestionsCount: evt.permissionSuggestionsCount ?? null,
        relatedFiles: Array.isArray(evt.relatedFiles) ? evt.relatedFiles.slice(0, 8) : null,
      };
    }
    if (t === 'permission_request') {
      return { type: t, toolName: evt.toolName || null, permissionRequestId: evt.permissionRequestId || null };
    }
    if (t === 'code_stream_snapshot') {
      const c = typeof evt.content === 'string' ? evt.content : '';
      return { type: t, toolName: evt.toolName || null, toolUseId: evt.toolUseId || null, filePath: evt.filePath || null, contentLen: c.length, truncated: !!evt.truncated };
    }
    if (t === 'code_stream_delta') {
      const d = typeof evt.contentDelta === 'string' ? evt.contentDelta : '';
      return { type: t, toolName: evt.toolName || null, toolUseId: evt.toolUseId || null, filePath: evt.filePath || null, deltaLen: d.length };
    }
    if (t === 'code_stream_complete') {
      const c = typeof evt.content === 'string' ? evt.content : '';
      return { type: t, toolName: evt.toolName || null, toolUseId: evt.toolUseId || null, filePath: evt.filePath || null, contentLen: c.length };
    }
    if (t === 'result' || t === 'done' || t === 'error' || t === 'started' || t === 'init' || t === 'auth_status') {
      return { type: t, sessionId: evt.sessionId || null, subtype: evt.subtype || null, isError: !!evt.isError, error: evt.error ? _truncateForLog(String(evt.error || ''), 600) : null };
    }
    // Default: redact deep but keep small
    return redactDeep(evt);
  } catch {
    return { type: 'debug_sanitize_failed' };
  }
}

async function _createClaudeStreamDebugLogger({ baseDir, requestId }) {
  const rid = String(requestId || '').trim();
  const root = String(baseDir || '').trim();
  if (!rid || !root) return null;

  // In production (packaged), skip debug logging to avoid ASAR write errors
  // Debug logs are primarily for development debugging
  if (app.isPackaged) {
    return null;
  }

  try {
    // IMPORTANT: Write logs into the app workspace (APP_ROOT) so the coding agent can read them.
    // Do NOT write into arbitrary opened projects (may be outside this repo / not accessible here).
    const dir = path.join(root, 'debug-logs', 'claude-stream');
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(dir, `claude-stream-${ts}-${rid}.jsonl`);
    const stream = fsSync.createWriteStream(filePath, { flags: 'a' });

    const writeLine = (rec) => {
      try {
        const line = _safeJsonlStringify(rec) + '\n';
        stream.write(line);
      } catch { /* ignore */ }
    };
    const close = () => {
      try { stream.end(); } catch { /* ignore */ }
    };

    writeLine({ at: Date.now(), iso: new Date().toISOString(), requestId: rid, kind: 'debug_log_open', filePath });
    return { filePath, writeLine, close };
  } catch {
    return null;
  }
}

function _debugLogForRequest(requestId) {
  const rid = String(requestId || '').trim();
  if (!rid) return null;
  return claudeStreamDebugByRequestId.get(rid) || null;
}

// Always patch console in the main process (prevents crashes; keeps logs consistent).
try {
  console.log = safeConsole.log;
  console.info = safeConsole.info;
  console.warn = safeConsole.warn;
  console.error = safeConsole.error;
} catch { /* ignore */ }

// ----------------------------------------------------------------------------
// Prevent main-process crashes from benign stream errors in child-process IO
// (Claude Agent SDK can occasionally attempt a control write after the transport
// stream has ended during rapid cancel/restore flows).
// ----------------------------------------------------------------------------
function _isBenignStreamWriteAfterEnd(err) {
  try {
    const e = err && typeof err === 'object' ? err : null;
    const code = e && typeof e.code === 'string' ? e.code : '';
    const msg = e && typeof e.message === 'string' ? e.message : String(err || '');
    if (code === 'ERR_STREAM_WRITE_AFTER_END') return true;
    // Some Node versions surface this primarily in message text.
    if (msg && msg.toLowerCase().includes('write after end')) return true;
    // Keep existing robustness for broken pipes.
    if (code === 'EPIPE') return true;
    if (msg && msg.toLowerCase().includes('write epipe')) return true;
    return false;
  } catch {
    return false;
  }
}

// Do NOT swallow unexpected crashes; only ignore the specific benign stream errors above.
process.on('uncaughtException', (err) => {
  if (_isBenignStreamWriteAfterEnd(err)) {
    try { safeConsole.warn('[Main] Ignored benign stream write error:', err && err.message ? err.message : err); } catch { /* ignore */ }
    return;
  }
  throw err;
});

process.on('unhandledRejection', (reason) => {
  if (_isBenignStreamWriteAfterEnd(reason)) {
    try { safeConsole.warn('[Main] Ignored benign stream write rejection:', reason && reason.message ? reason.message : reason); } catch { /* ignore */ }
    return;
  }
  // Keep visibility for all other promise rejections.
  try { safeConsole.error('[Main] Unhandled rejection:', reason); } catch { /* ignore */ }
});

// Interactive terminal (PTY)
let nodePty = null;
try {
  // Native dependency (rebuilt for Electron via: `electron-builder install-app-deps`)
  nodePty = require('node-pty');
} catch (e) {
  console.warn('[Terminal:PTY] node-pty not available (terminal tab will be disabled).', e && e.message ? e.message : e);
}

// 🧪 TEST LINE FOR GIT ISOLATION: This line should NEVER be affected by user project git operations!
// If this line disappears after restoring a checkpoint in a user project, git isolation is BROKEN.

let mainWindow;
let currentProject = null;
const activeClaudeQueries = new Map(); // requestId -> { abortController, interrupt? }
const pendingClaudeToolPermissions = new Map(); // permissionRequestId -> { resolve, requestId }
const activeExecutionTimelineRunByRequestId = new Map(); // requestId -> executionRunId (AET)
let workspaceWatcher = null;
let workspaceWatcherRoot = null;
let workspaceWatchTimer = null;
let workspaceWatchChanged = null; // Set<string> of relative paths (posix-style)

// Prevent duplicate Terminal windows/tabs when opening the Claude setup-token flow.
let claudeSetupTokenTerminalInFlight = false;
let claudeSetupTokenTerminalLastAt = 0;

// Ensure renderer state (chat history + uiMetadata) is flushed to disk before closing/quitting.
let pendingFlushThen = null;
let flushTimeout = null;
let suppressCloseOnce = false;
const RENDERER_FLUSH_TIMEOUT_MS = 6000;

// ============================================================================
// INTERACTIVE TERMINAL (PTY) STATE
// - keyed by webContents.id to isolate windows
// ============================================================================
const ptySessionsByWebContentsId = new Map(); // Map<number, Map<string, { pty, cwd, createdAt }>>

function getPtySessionMapForWebContentsId(wcId) {
  const id = Number(wcId);
  if (!Number.isFinite(id)) return null;
  let m = ptySessionsByWebContentsId.get(id);
  if (!m) {
    m = new Map();
    ptySessionsByWebContentsId.set(id, m);
  }
  return m;
}

function getPtyEntryForEvent(event, terminalId) {
  try {
    const wcId = event && event.sender && typeof event.sender.id === 'number' ? event.sender.id : null;
    const m = getPtySessionMapForWebContentsId(wcId);
    if (!m) return null;
    const id = String(terminalId || '');
    if (!id) return null;
    return m.get(id) || null;
  } catch {
    return null;
  }
}

function cleanupPtySessionsForWebContentsId(wcId, reason = '') {
  try {
    const id = Number(wcId);
    const m = ptySessionsByWebContentsId.get(id);
    if (!m) return;
    for (const [terminalId, entry] of m.entries()) {
      try {
        entry?.pty?.kill?.();
      } catch {
        // ignore
      }
      try {
        m.delete(terminalId);
      } catch {
        // ignore
      }
    }
    ptySessionsByWebContentsId.delete(id);
    if (reason) console.log('[Terminal:PTY] cleaned up sessions for webContents', id, reason);
  } catch {
    // ignore
  }
}

// ============================================================================
// AET debug instrumentation toggle (dev only)
// - Renderer can enable via IPC so main/SDK logging is in sync.
// ============================================================================
let __aetDebugEnabled = false;
function aetDebugEnabled() {
  try {
    if (__aetDebugEnabled === true) return true;
    // Optional: allow env flag for developers/tests.
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

function focusMainWindowBestEffort() {
  try {
    if (!mainWindow || mainWindow.isDestroyed?.()) return;
    try { if (mainWindow.isMinimized?.()) mainWindow.restore?.(); } catch { /* ignore */ }
    try { mainWindow.show?.(); } catch { /* ignore */ }
    try { mainWindow.focus?.(); } catch { /* ignore */ }
    try { app.focus({ steal: true }); } catch { /* ignore */ }
  } catch {
    // ignore
  }
}

ipcMain.handle('aet-set-debug', async (_event, enabled) => {
  try {
    __aetDebugEnabled = enabled === true;
    try { globalThis.__CODEON_AET_DEBUG = __aetDebugEnabled; } catch { /* ignore */ }
    return { success: true, enabled: __aetDebugEnabled };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

async function ensureWorkspaceGitRepo(projectPath) {
  // The app relies on git for checkpoints/restore + showing diffs.
  // If the user opens a folder without git, we should silently initialize it immediately.
  if (!projectPath) return;
  const ws = String(projectPath || '').trim();
  if (!ws) return;

  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Codeon',
    GIT_AUTHOR_EMAIL: 'codeon@local',
    GIT_COMMITTER_NAME: 'Codeon',
    GIT_COMMITTER_EMAIL: 'codeon@local'
  };
  const baseOpts = { cwd: ws, env, maxBuffer: 10 * 1024 * 1024 };

  let isRepo = true;
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { ...baseOpts, maxBuffer: 256 * 1024 });
  } catch {
    isRepo = false;
  }
  if (!isRepo) {
    await execFileAsync('git', ['init'], baseOpts);
  }

  // Ensure at least one commit exists so we can create checkpoints safely
  // without auto-committing user files.
  let hasHead = true;
  try {
    await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { ...baseOpts, maxBuffer: 256 * 1024 });
  } catch {
    hasHead = false;
  }
  if (!hasHead) {
    // Use an empty initial commit to avoid automatically committing user files.
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], baseOpts);
    try { await execFileAsync('git', ['checkout', '-B', 'main'], { ...baseOpts, maxBuffer: 256 * 1024 }); } catch { /* ignore */ }
  }
}

function requestRendererFlushThen(thenFn) {
  try {
    if (!mainWindow || mainWindow.isDestroyed?.()) {
      thenFn();
      return;
    }
    // If a flush is already in progress, chain the next action.
    if (pendingFlushThen) {
      const prev = pendingFlushThen;
      pendingFlushThen = () => {
        try { prev(); } catch { /* ignore */ }
        try { thenFn(); } catch { /* ignore */ }
      };
      return;
    }
    pendingFlushThen = thenFn;
    try {
      mainWindow.webContents.send('app-flush-request', { timestamp: Date.now() });
    } catch {
      // If we can't message the renderer, just continue.
      const fn = pendingFlushThen;
      pendingFlushThen = null;
      fn();
      return;
    }
    flushTimeout = setTimeout(() => {
      try {
        const fn = pendingFlushThen;
        pendingFlushThen = null;
        if (fn) fn();
      } catch {
        // ignore
      }
    }, RENDERER_FLUSH_TIMEOUT_MS);
  } catch {
    thenFn();
  }
}

ipcMain.on('app-flush-done', () => {
  try {
    if (flushTimeout) clearTimeout(flushTimeout);
  } catch {
    // ignore
  }
  flushTimeout = null;
  try {
    const fn = pendingFlushThen;
    pendingFlushThen = null;
    if (fn) fn();
  } catch {
    // ignore
  }
});

function stopWorkspaceWatcher() {
  try {
    if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
  } catch {
    // ignore
  }
  workspaceWatchTimer = null;
  try { if (workspaceWatchChanged) workspaceWatchChanged.clear(); } catch { /* ignore */ }
  workspaceWatchChanged = null;
  try {
    if (workspaceWatcher) workspaceWatcher.close();
  } catch {
    // ignore
  }
  workspaceWatcher = null;
  workspaceWatcherRoot = null;
}

function startWorkspaceWatcher(projectPath) {
  try {
    stopWorkspaceWatcher();
    if (!projectPath || typeof projectPath !== 'string') return;
    workspaceWatcherRoot = projectPath;
    workspaceWatchChanged = new Set();

    const schedule = () => {
      try {
        if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
      } catch {
        // ignore
      }
      workspaceWatchTimer = setTimeout(() => {
        try {
          if (!mainWindow || mainWindow.isDestroyed?.()) return;
          const changed = [];
          try {
            // Cap to avoid giant IPC payloads on massive operations.
            for (const p of workspaceWatchChanged || []) {
              changed.push(p);
              if (changed.length >= 750) break;
            }
            if (workspaceWatchChanged) workspaceWatchChanged.clear();
          } catch {
            // ignore
          }
          mainWindow.webContents.send('workspace-files-changed', {
            path: workspaceWatcherRoot,
            timestamp: Date.now(),
            changed
          });
        } catch {
          // ignore
        }
      }, 250);
    };

    // macOS supports recursive watching; Linux may not, but we still best-effort.
    workspaceWatcher = fsSync.watch(projectPath, { recursive: true }, (_eventType, filename) => {
      // Ignore noisy paths to avoid constant refreshes.
      const name = typeof filename === 'string' ? filename : '';
      const norm = name.replace(/\\/g, '/');
      if (
        norm.startsWith('.git/') ||
        norm.startsWith('node_modules/') ||
        norm.startsWith('.codeon/') ||
        norm.startsWith('.ai-agent/') ||
        norm.includes('/.git/') ||
        norm.includes('/node_modules/') ||
        norm.includes('/.codeon/') ||
        norm.includes('/.ai-agent/')
      ) {
        return;
      }
      try {
        if (norm && workspaceWatchChanged) workspaceWatchChanged.add(norm.replace(/^\/+/, ''));
      } catch {
        // ignore
      }
      schedule();
    });
    console.log('[Watcher] Workspace watcher started:', projectPath);
  } catch (e) {
    console.warn('[Watcher] Failed to start workspace watcher:', e?.message || String(e));
    stopWorkspaceWatcher();
  }
}

async function readJsonWithFallback(filePath, { fallbackPaths = [] } = {}) {
  const candidates = [filePath, ...fallbackPaths].filter(Boolean);
  let lastErr = null;
  for (const p of candidates) {
    try {
      const data = await fs.readFile(p, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('Failed to read JSON');
}

async function writeJsonSafely(filePath, obj) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `${base}.tmp`);
  const bakPath = path.join(dir, `${base}.bak`);
  const json = JSON.stringify(obj, null, 2);

  // 1) Write temp
  await fs.writeFile(tmpPath, json, 'utf-8');

  // 2) Best-effort backup current file
  try {
    await fs.copyFile(filePath, bakPath);
  } catch (_e) {
    // ignore (first write / missing file)
  }

  // 3) Replace target
  try {
    // On POSIX, rename is atomic replace; on Windows, rename may fail if target exists.
    await fs.rename(tmpPath, filePath);
  } catch (_e) {
    try {
      await fs.writeFile(filePath, json, 'utf-8');
    } finally {
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    }
  }
}

// Atomic-ish write helper for binary payloads (e.g. sql.js db export).
async function writeBufferSafely(filePath, buffer) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `${base}.tmp`);
  const bakPath = path.join(dir, `${base}.bak`);
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);

  // 1) Write temp
  await fs.writeFile(tmpPath, buf);

  // 2) Best-effort backup current file
  try {
    await fs.copyFile(filePath, bakPath);
  } catch (_e) {
    // ignore (first write / missing file)
  }

  // 3) Replace target
  try {
    await fs.rename(tmpPath, filePath);
  } catch (_e) {
    try {
      await fs.writeFile(filePath, buf);
    } finally {
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    }
  }
}

// ============================================================================
// AGENT EXECUTION TIMELINE (AET) - Persistence + Streaming
// ============================================================================
const executionTimelineStores = new Map(); // projectPath -> { loaded, data, saveTimer, saveInFlight }
const EXECUTION_TIMELINE_VERSION = 2;
const aetPendingJpByRunId = new Map(); // runId -> [{ nodeType, target, why, raw, at }]
// Crash-safety: don't let continuous node streaming defer persistence indefinitely.
const AET_SAVE_MAX_WAIT_MS = 2000;

function _aetNow() {
  return Date.now();
}

function _aetId(prefix = 'aet') {
  try {
    const id = (crypto && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return prefix ? `${prefix}_${id}` : id;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function _aetHashProjectId(projectPath) {
  try {
    return crypto.createHash('sha1').update(String(projectPath || ''), 'utf8').digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}

function _aetTruncStr(s, max = 1600) {
  const str = typeof s === 'string' ? s : String(s || '');
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function _aetNormalizeNodeType(type) {
  const t = String(type || '').trim();
  // Keep this aligned to the PRD/UI spec.
  const allowed = new Set([
    'CheckpointCreated',
    'SessionStart',
    'SessionEnd',
    'PermissionRequest',
    'PlanGenerated',
    'FileRead',
    'Search',
    'SkillInvoked',
    'FileEdit',
    'BashCommand',
    'NetworkRequest',
    'ToolFailure',
    'SubagentStart',
    'SubagentStop',
    'Compact',
    'Warning',
    'UserIntervention',
    'Completion'
  ]);
  return allowed.has(t) ? t : 'Warning';
}

function _aetBuildNode({ runId, type, payload, relatedFiles = [], gitCheckpointHash = null, justificationText = null, timestamp } = {}) {
  const ts = Number(timestamp);
  // IMPORTANT: treat null/undefined/0/NaN as missing (Number(null) === 0 would otherwise poison timestamps).
  const finalTs = (Number.isFinite(ts) && ts > 0) ? ts : _aetNow();
  return {
    id: _aetId('node'),
    runId,
    type: _aetNormalizeNodeType(type),
    timestamp: finalTs,
    payload: payload && typeof payload === 'object' ? payload : {},
    relatedFiles: Array.isArray(relatedFiles) ? relatedFiles.slice(0, 50) : [],
    ...(gitCheckpointHash ? { gitCheckpointHash: String(gitCheckpointHash) } : {}),
    ...(justificationText ? { justificationText: String(justificationText) } : {})
  };
}

function _aetMigrateTimelineDataIfNeeded(data) {
  try {
    if (!data || typeof data !== 'object') return { data, changed: false };
    const v = Number(data.version);
    if (!Number.isFinite(v) || v >= EXECUTION_TIMELINE_VERSION) return { data, changed: false };
    let changed = false;
    const runs = Array.isArray(data.runs) ? data.runs : [];

    // v2 migration: fix node timestamps that were persisted as 0 due to Number(null) === 0.
    if (v < 2) {
      for (const r of runs) {
        if (!r || typeof r !== 'object') continue;
        const start = Number(r.startTime);
        const base = (Number.isFinite(start) && start > 0) ? start : _aetNow();
        const nodes = Array.isArray(r.nodes) ? r.nodes : [];
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (!n || typeof n !== 'object') continue;
          const t = Number(n.timestamp);
          if (!Number.isFinite(t) || t <= 0) {
            n.timestamp = base + i;
            changed = true;
          }
        }
      }
    }

    data.version = EXECUTION_TIMELINE_VERSION;
    if (!data.meta || typeof data.meta !== 'object') data.meta = {};
    data.meta.migratedAt = _aetNow();
    data.meta.migratedFromVersion = v;
    changed = true;
    return { data, changed };
  } catch {
    return { data, changed: false };
  }
}

function _aetReconcileStaleRunningRuns(data) {
  try {
    if (!data || typeof data !== 'object') return 0;
    const runs = Array.isArray(data.runs) ? data.runs : [];
    const now = _aetNow();
    let changed = 0;
    for (const r of runs) {
      if (!r || typeof r !== 'object') continue;
      const st = String(r.status || '').trim();
      const end = r.endTime;
      if (st === 'running' && (end == null || end === '')) {
        r.status = 'stopped';
        r.endTime = now;
        if (!r.meta || typeof r.meta !== 'object') r.meta = {};
        r.meta.reconciledAt = now;
        r.meta.reconciledReason = 'Recovered after app restart';
        if (!Array.isArray(r.nodes)) r.nodes = [];
        try {
          r.nodes.push(_aetBuildNode({
            runId: String(r.id || ''),
            type: 'UserIntervention',
            timestamp: now,
            payload: {
              title: 'Run reconciled after restart',
              subtype: 'recovered_after_restart',
              previousStatus: 'running'
            }
          }));
        } catch { /* ignore */ }
        changed++;
      }
    }
    if (changed > 0) {
      if (!data.meta || typeof data.meta !== 'object') data.meta = {};
      data.meta.reconciledAt = now;
    }
    return changed;
  } catch {
    return 0;
  }
}

function _aetGetFilePath(projectPath) {
  return path.join(projectPath, '.ai-agent', 'execution-runs.json');
}

async function _aetEnsureLoaded(projectPath) {
  const root = String(projectPath || '').trim();
  if (!root) throw new Error('Missing projectPath');

  let st = executionTimelineStores.get(root);
  if (!st) {
    st = { loaded: false, data: null, saveTimer: null, saveInFlight: false, saveFirstAt: 0 };
    executionTimelineStores.set(root, st);
  }
  if (st.loaded && st.data) return st;

  const aiAgentDir = path.join(root, '.ai-agent');
  await fs.mkdir(aiAgentDir, { recursive: true });
  const fp = _aetGetFilePath(root);
  const bakPath = fp + '.bak';
  const tmpPath = fp + '.tmp';

  let data = null;
  try {
    // If no file exists yet, initialize.
    try {
      await fs.access(fp);
    } catch {
      try { await fs.access(bakPath); } catch {
        try { await fs.access(tmpPath); } catch {
          data = { version: EXECUTION_TIMELINE_VERSION, runs: [] };
        }
      }
    }
    if (!data) {
      data = await readJsonWithFallback(fp, { fallbackPaths: [bakPath, tmpPath] });
    }
  } catch {
    data = { version: EXECUTION_TIMELINE_VERSION, runs: [] };
  }

  if (!data || typeof data !== 'object') data = { version: EXECUTION_TIMELINE_VERSION, runs: [] };
  let shouldPersistOnLoad = false;
  // Migrate older versions (v1 -> v2 currently fixes node timestamps that were persisted as 0).
  try {
    const mig = _aetMigrateTimelineDataIfNeeded(data);
    if (mig && mig.data) data = mig.data;
    if (mig && mig.changed === true) shouldPersistOnLoad = true;
  } catch { /* ignore */ }
  if (data.version !== EXECUTION_TIMELINE_VERSION) data.version = EXECUTION_TIMELINE_VERSION;
  if (!Array.isArray(data.runs)) data.runs = [];

  // Reconcile stale "running" runs (app quit/crash mid-run) so reload is honest.
  try {
    const reconciled = _aetReconcileStaleRunningRuns(data);
    if (reconciled > 0) {
      aetDebugLog('reconciled_stale_runs', { projectPath: root, count: reconciled });
      shouldPersistOnLoad = true;
    }
  } catch { /* ignore */ }

  st.data = data;
  st.loaded = true;
  // If we changed data during load (migration/reconciliation), persist immediately so the JSON on disk is truthful
  // even if the user doesn't start another run or open the AET panel.
  try {
    if (shouldPersistOnLoad) {
      await _aetFlushSave(root);
    }
  } catch { /* ignore */ }
  return st;
}

async function _aetFlushSave(projectPath) {
  const root = String(projectPath || '').trim();
  if (!root) return;
  const st = executionTimelineStores.get(root);
  if (!st || !st.loaded || !st.data) return;
  if (st.saveInFlight) return;

  st.saveInFlight = true;
  try {
    const fp = _aetGetFilePath(root);
    await writeJsonSafely(fp, st.data);
  } catch (e) {
    console.warn('[AET] Failed to persist execution timeline:', e?.message || String(e));
  } finally {
    st.saveInFlight = false;
  }
}

function _aetScheduleSave(projectPath, delayMs = 500) {
  const root = String(projectPath || '').trim();
  if (!root) return;
  const st = executionTimelineStores.get(root);
  if (!st) return;
  const now = _aetNow();
  if (!st.saveFirstAt) st.saveFirstAt = now;
  const waitLeft = Math.max(0, AET_SAVE_MAX_WAIT_MS - (now - (st.saveFirstAt || now)));
  const desired = Math.max(50, Number(delayMs) || 500);
  const finalDelay = Math.min(desired, waitLeft);
  // If a timer is already set, don't keep pushing it out indefinitely—keep the earliest flush.
  if (st.saveTimer) return;
  st.saveTimer = setTimeout(() => {
    st.saveTimer = null;
    st.saveFirstAt = 0;
    _aetFlushSave(root).catch(() => {});
  }, finalDelay);
}

async function _aetCreateRun(projectPath, { sessionId, agentName, requestId, model, permissionMode, networkPolicy, parentRunId = null, parentNodeId = null, meta = null } = {}) {
  const st = await _aetEnsureLoaded(projectPath);
  const root = String(projectPath || '').trim();

  const run = {
    id: _aetId('run'),
    projectId: _aetHashProjectId(root),
    sessionId: String(sessionId || '').trim() || null,
    agentName: String(agentName || '').trim() || 'Claude',
    requestId: String(requestId || '').trim() || null,
    startTime: _aetNow(),
    endTime: null,
    status: 'running',
    ...(String(parentRunId || '').trim() ? { parentRunId: String(parentRunId).trim() } : {}),
    ...(String(parentNodeId || '').trim() ? { parentNodeId: String(parentNodeId).trim() } : {}),
    meta: {
      ...(model ? { model: String(model) } : {}),
      ...(permissionMode ? { permissionMode: String(permissionMode) } : {}),
      ...(networkPolicy ? { networkPolicy } : {}),
      ...(meta && typeof meta === 'object' ? meta : {})
    },
    nodes: []
  };

  st.data.runs.push(run);
  // Cap total runs per project to avoid unbounded growth (oldest first).
  const MAX_RUNS = 200;
  if (st.data.runs.length > MAX_RUNS) st.data.runs.splice(0, st.data.runs.length - MAX_RUNS);

  _aetScheduleSave(projectPath);
  return run;
}

async function _aetAppendNode(projectPath, runId, node) {
  const st = await _aetEnsureLoaded(projectPath);
  const rid = String(runId || '').trim();
  if (!rid) return null;

  const run = st.data.runs.find(r => r && r.id === rid);
  if (!run) return null;
  if (!Array.isArray(run.nodes)) run.nodes = [];

  run.nodes.push(node);
  const MAX_NODES = 3000;
  if (run.nodes.length > MAX_NODES) run.nodes.splice(0, run.nodes.length - MAX_NODES);

  try {
    const n = node && typeof node === 'object' ? node : null;
    const toolUseId = n && n.payload && typeof n.payload === 'object' ? (n.payload.toolUseId || n.payload.toolUseID || null) : null;
    aetDebugLog('node_appended', {
      projectPath: String(projectPath || ''),
      sessionId: run.sessionId || null,
      runId: rid,
      nodeId: n ? n.id : null,
      type: n ? n.type : null,
      toolUseId: toolUseId ? String(toolUseId) : null
    });
  } catch { /* ignore */ }

  _aetScheduleSave(projectPath);
  return node;
}

async function _aetUpdateRun(projectPath, runId, patch = {}) {
  const st = await _aetEnsureLoaded(projectPath);
  const rid = String(runId || '').trim();
  if (!rid) return null;
  const run = st.data.runs.find(r => r && r.id === rid);
  if (!run) return null;

  try {
    Object.assign(run, patch && typeof patch === 'object' ? patch : {});
  } catch {
    // ignore
  }

  _aetScheduleSave(projectPath);
  return run;
}

function _aetMapToolToNodeType(toolName) {
  const t = String(toolName || '').trim();
  if (t === 'Read') return 'FileRead';
  if (t === 'Grep' || t === 'Glob') return 'Search';
  // Claude Code skill invocation (via "/<skill>" shorthand) is executed through the Skill tool.
  if (t === 'Skill') return 'SkillInvoked';
  if (t === 'Write' || t === 'Edit' || t === 'MultiEdit' || t === 'NotebookEdit') return 'FileEdit';
  if (t === 'Bash') return 'BashCommand';
  if (t === 'WebFetch') return 'NetworkRequest';
  return null;
}

function _aetStorePendingJp(runId, jp) {
  try {
    const rid = String(runId || '').trim();
    if (!rid || !jp || typeof jp !== 'object') return;
    const list = aetPendingJpByRunId.get(rid) || [];
    const nodeType = _aetNormalizeNodeType(jp.nodeType);
    const target = String(jp.target || '').trim();
    const why = String(jp.why || '').trim();
    const raw = String(jp.raw || '').trim();
    const outcome = String(jp.outcome || '').trim();
    const risk = String(jp.risk || '').trim().toLowerCase();
    const version = Number.isFinite(Number(jp.version)) ? Number(jp.version) : 1;
    if (!why) return;
    list.push({ nodeType, target, why, outcome, risk, version, raw, at: _aetNow() });
    if (list.length > 200) list.splice(0, list.length - 200);
    aetPendingJpByRunId.set(rid, list);
    try {
      aetDebugLog('jp_stored', { runId: rid, nodeType, target, version, risk: risk || null });
    } catch { /* ignore */ }
  } catch {
    // ignore
  }
}

function _aetConsumePendingJp(runId, { nodeType, target } = {}) {
  try {
    const rid = String(runId || '').trim();
    if (!rid) return null;
    const list = aetPendingJpByRunId.get(rid);
    if (!Array.isArray(list) || list.length === 0) return null;

    const nt = _aetNormalizeNodeType(nodeType);
    const tgt = String(target || '').trim().toLowerCase();

    let bestIdx = -1;
    let bestScore = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      const j = list[i];
      if (!j || _aetNormalizeNodeType(j.nodeType) !== nt) continue;
      const jt = String(j.target || '').trim().toLowerCase();
      let score = 10;
      if (tgt && jt) {
        if (tgt === jt) score += 60;
        else if (tgt.includes(jt) || jt.includes(tgt)) score += 35;
        else score -= 25;
      }
      // Prefer newer entries.
      score += Math.max(0, Math.min(20, (list.length - 1 - i)));
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return null;
    const picked = list.splice(bestIdx, 1)[0];
    aetPendingJpByRunId.set(rid, list);
    try {
      aetDebugLog('jp_attached', { runId: rid, nodeType: nt, target: String(target || ''), pickedTarget: picked ? picked.target : null, version: picked ? picked.version : null });
    } catch { /* ignore */ }
    return picked || null;
  } catch {
    return null;
  }
}

function _aetExtractTargetForNodeType(nodeType, evt) {
  try {
    const nt = _aetNormalizeNodeType(nodeType);
    if (!evt || typeof evt !== 'object') return '';
    if (nt === 'Search') {
      const s = evt.toolInputSummary && typeof evt.toolInputSummary === 'object' ? evt.toolInputSummary : null;
      const pattern = s && typeof s.pattern === 'string' ? s.pattern.trim() : '';
      const p = s && typeof s.path === 'string' ? s.path.trim() : '';
      if (pattern && p) return `${pattern} @ ${p}`;
      return pattern || p || String(evt.preview || '').trim();
    }
    if (nt === 'FileEdit') {
      const s = evt.toolInputSummary && typeof evt.toolInputSummary === 'object' ? evt.toolInputSummary : null;
      const fp = s && typeof s.filePath === 'string' ? s.filePath.trim() : '';
      return fp || '';
    }
    if (nt === 'BashCommand') {
      const s = evt.toolInputSummary && typeof evt.toolInputSummary === 'object' ? evt.toolInputSummary : null;
      const cmd = s && typeof s.command === 'string' ? s.command.trim() : '';
      return cmd || String(evt.preview || '').trim();
    }
    if (nt === 'NetworkRequest') {
      const s = evt.toolInputSummary && typeof evt.toolInputSummary === 'object' ? evt.toolInputSummary : null;
      const url = s && typeof s.url === 'string' ? s.url.trim() : '';
      return url || String(evt.preview || '').trim();
    }
    return '';
  } catch {
    return '';
  }
}

function _aetExtractRelatedFilesFromEvent(evt) {
  try {
    if (!evt || typeof evt !== 'object') return [];
    // Prefer explicit file paths when available (from claude-sdk-service).
    if (evt.type === 'file_diff' && typeof evt.filePath === 'string' && evt.filePath.trim()) {
      return [evt.filePath.trim()];
    }
    if (evt.type === 'tool_executed' && evt.toolInputSummary && typeof evt.toolInputSummary === 'object') {
      const fp = typeof evt.toolInputSummary.filePath === 'string' ? evt.toolInputSummary.filePath.trim() : '';
      if (fp) return [fp];
    }
    return [];
  } catch {
    return [];
  }
}

async function _aetHandleClaudeSdkEvent(projectPath, { runId, uiSessionId, emitToRenderer }, evt) {
  try {
    if (!runId) return;
    if (!evt || typeof evt !== 'object') return;

    // Late event dropping: once a run is not running anymore, ignore subsequent tool/gate/JP events.
    // This is critical for Stop/Cancel correctness and avoiding ghost nodes after completion.
    let runStatus = null;
    let runEndTime = null;
    try {
      const st = await _aetEnsureLoaded(projectPath);
      const rid = String(runId || '').trim();
      const run = (st && st.data && Array.isArray(st.data.runs)) ? st.data.runs.find(r => r && r.id === rid) : null;
      if (run && typeof run === 'object') {
        runStatus = String(run.status || '').trim() || null;
        runEndTime = run.endTime == null ? null : Number(run.endTime);
      }
    } catch { /* ignore */ }

    const et = String(evt.type || '').trim();
    const lateDropTypes = new Set(['gate_event', 'jp', 'tool_executed', 'file_diff', 'sdk_hook', 'init']);
    if (runStatus && runStatus !== 'running' && lateDropTypes.has(et)) {
      aetDebugLog('late_event_dropped', { runId, runStatus, type: et, kind: evt.kind || null, toolName: evt.toolName || null, toolUseId: evt.toolUseId || null });
      return;
    }

    const mergeRunMeta = async (patch) => {
      try {
        const st2 = await _aetEnsureLoaded(projectPath);
        const rid2 = String(runId || '').trim();
        const run2 = (st2 && st2.data && Array.isArray(st2.data.runs)) ? st2.data.runs.find(r => r && r.id === rid2) : null;
        if (!run2 || typeof run2 !== 'object') return;
        const cur = (run2.meta && typeof run2.meta === 'object') ? run2.meta : {};
        const next = { ...cur, ...(patch && typeof patch === 'object' ? patch : {}) };
        await _aetUpdateRun(projectPath, runId, { meta: next });
        if (typeof emitToRenderer === 'function') {
          emitToRenderer({ kind: 'run_update', sessionId: uiSessionId || null, runId, patch: { meta: next } });
        }
      } catch { /* ignore */ }
    };

    // SDK init (session start metadata)
    if (et === 'init') {
      const sid = typeof evt.sessionId === 'string' ? evt.sessionId.trim() : '';
      const model = typeof evt.model === 'string' ? evt.model.trim() : '';
      const sdkPerm = typeof evt.permissionMode === 'string' ? evt.permissionMode.trim() : '';
      const toolsArr = Array.isArray(evt.tools) ? evt.tools : [];
      const toolNames = toolsArr
        .map(t => {
          try {
            if (!t) return '';
            if (typeof t === 'string') return t;
            if (typeof t.name === 'string') return t.name;
            if (typeof t.tool_name === 'string') return t.tool_name;
            return '';
          } catch {
            return '';
          }
        })
        .filter(Boolean)
        .slice(0, 40);

      await mergeRunMeta({
        ...(sid ? { claudeSessionId: sid } : {}),
        ...(model ? { sdkModel: model } : {}),
        ...(sdkPerm ? { sdkPermissionMode: sdkPerm } : {}),
        sdkToolNames: toolNames,
        sdkToolsCount: toolsArr.length
      });

      const node = _aetBuildNode({
        runId,
        type: 'SessionStart',
        payload: {
          title: model ? `Session started (${model})` : 'Session started',
          sessionId: sid || null,
          model: model || null,
          permissionMode: sdkPerm || null,
          toolNames
        }
      });
      const saved = await _aetAppendNode(projectPath, runId, node);
      if (saved && typeof emitToRenderer === 'function') {
        emitToRenderer({ kind: 'node', sessionId: uiSessionId || null, runId, node: saved });
      }
      return;
    }

    // SDK hook events (permission requests, subagents, failures, etc.)
    if (et === 'sdk_hook') {
      const hook = String(evt.hookEventName || '').trim();
      const toolName = typeof evt.toolName === 'string' ? evt.toolName.trim() : '';
      // Avoid double-recording pause-before-tool (already captured in permission_request nodes + gate events)
      if (hook === 'PermissionRequest' && toolName === '__PAUSE_BEFORE_TOOL__') return;

      const basePayload = {
        hookEventName: hook || null,
        toolName: toolName || null,
        toolUseId: evt.toolUseId || null,
        agentId: evt.agentId || null,
        agentType: evt.agentType || null
      };

      const build = async (type, payloadExtra) => {
        const node = _aetBuildNode({
          runId,
          type,
          relatedFiles: Array.isArray(evt.relatedFiles) ? evt.relatedFiles.slice(0, 20) : [],
          payload: { ...basePayload, ...(payloadExtra || {}) }
        });
        const saved = await _aetAppendNode(projectPath, runId, node);
        if (saved && typeof emitToRenderer === 'function') {
          emitToRenderer({ kind: 'node', sessionId: uiSessionId || null, runId, node: saved });
        }
      };

      if (hook === 'PermissionRequest') {
        const count = Number.isFinite(Number(evt.permissionSuggestionsCount)) ? Number(evt.permissionSuggestionsCount) : null;
        await build('PermissionRequest', {
          title: toolName ? `Permission requested: ${toolName}` : 'Permission requested',
          permissionSuggestionsCount: count,
          inputPreview: evt.inputPreview ? _aetTruncStr(evt.inputPreview, 1200) : null
        });
        return;
      }

      if (hook === 'PostToolUseFailure') {
        await build('ToolFailure', {
          title: toolName ? `Tool failed: ${toolName}` : 'Tool failed',
          error: evt.error ? _aetTruncStr(evt.error, 7000) : null
        });
        return;
      }

      if (hook === 'SessionEnd') {
        await build('SessionEnd', { title: 'Session ended' });
        return;
      }

      if (hook === 'SubagentStart') {
        // DEBUG: Log raw subagent event to understand SDK structure
        console.log('[AET] SubagentStart raw evt:', JSON.stringify(evt, null, 2));
        // Include agentType (e.g., 'Task') when available for better identification
        // Try multiple property names: SDK might use agent_type, agentType, type, etc.
        const agentType =
          (typeof evt.agentType === 'string' && evt.agentType.trim()) ||
          (typeof evt.agent_type === 'string' && evt.agent_type.trim()) ||
          (typeof evt.type === 'string' && evt.type.trim()) ||
          (typeof evt.subagentType === 'string' && evt.subagentType.trim()) ||
          (typeof evt.subagent_type === 'string' && evt.subagent_type.trim()) ||
          '';
        const agentId =
          (typeof evt.agentId === 'string' && evt.agentId.trim()) ||
          (typeof evt.agent_id === 'string' && evt.agent_id.trim()) ||
          (typeof evt.id === 'string' && evt.id.trim()) ||
          '';
        console.log('[AET] SubagentStart extracted - agentType:', agentType, 'agentId:', agentId);
        let title = 'Subagent start';
        if (agentType && agentId) title = `${agentType}: ${agentId}`;
        else if (agentType) title = `${agentType} started`;
        else if (agentId) title = `Subagent: ${agentId}`;
        await build('SubagentStart', { title, hookEventName: hook, agentType: agentType || null, agentId: agentId || null });
        return;
      }
      if (hook === 'SubagentStop') {
        // DEBUG: Log raw subagent event to understand SDK structure
        console.log('[AET] SubagentStop raw evt:', JSON.stringify(evt, null, 2));
        const agentType =
          (typeof evt.agentType === 'string' && evt.agentType.trim()) ||
          (typeof evt.agent_type === 'string' && evt.agent_type.trim()) ||
          (typeof evt.type === 'string' && evt.type.trim()) ||
          (typeof evt.subagentType === 'string' && evt.subagentType.trim()) ||
          (typeof evt.subagent_type === 'string' && evt.subagent_type.trim()) ||
          '';
        const agentId =
          (typeof evt.agentId === 'string' && evt.agentId.trim()) ||
          (typeof evt.agent_id === 'string' && evt.agent_id.trim()) ||
          (typeof evt.id === 'string' && evt.id.trim()) ||
          '';
        console.log('[AET] SubagentStop extracted - agentType:', agentType, 'agentId:', agentId);
        let title = 'Subagent stop';
        if (agentType && agentId) title = `${agentType}: ${agentId} done`;
        else if (agentType) title = `${agentType} done`;
        else if (agentId) title = `Subagent: ${agentId} done`;
        await build('SubagentStop', { title, hookEventName: hook, agentType: agentType || null, agentId: agentId || null });
        return;
      }

      if (hook === 'PreCompact') {
        await build('Compact', { title: 'Compacting context' });
        return;
      }

      if (hook === 'Stop') {
        await build('UserIntervention', { title: 'Stop requested', subtype: 'stop' });
        return;
      }

      // Unknown hook: keep a lightweight warning for debugging.
      await build('Warning', { title: hook ? `Hook: ${hook}` : 'Hook event' });
      return;
    }

    // Gate-level events (pause prompts, lock blocks, internal write blocks)
    if (et === 'gate_event') {
      const kind = String(evt.kind || '').trim();
      // Pause-before-tool is already captured via permission_request/permission_response as UserIntervention nodes.
      // Avoid duplicating it here.
      if (kind === 'pause_prompt') return;
      const fp = typeof evt.filePath === 'string' ? evt.filePath.trim() : '';
      const toolName = typeof evt.toolName === 'string' ? evt.toolName.trim() : '';
      const title = (() => {
        if (kind === 'lock_block') return fp ? `Blocked edit (locked): ${fp}` : 'Blocked edit (locked file)';
        if (kind === 'internal_write_block') return fp ? `Blocked internal write: ${fp}` : 'Blocked internal write';
        return kind ? `Gate: ${kind}` : 'Gate event';
      })();

      const node = _aetBuildNode({
        runId,
        type: 'Warning',
        relatedFiles: fp ? [fp] : [],
        payload: {
          title,
          kind: kind || null,
          toolName: toolName || null,
          filePath: fp || null,
          ...(evt.lock && typeof evt.lock === 'object' ? { lock: evt.lock } : {})
        }
      });
      const saved = await _aetAppendNode(projectPath, runId, node);
      if (saved && typeof emitToRenderer === 'function') {
        emitToRenderer({ kind: 'node', sessionId: uiSessionId || null, runId, node: saved });
      }
      return;
    }

    // Justification Protocol (JP) lines parsed from the model stream.
    if (et === 'jp') {
      try {
        if (evt.jp && typeof evt.jp === 'object') _aetStorePendingJp(runId, evt.jp);
      } catch {
        // ignore
      }
      return;
    }

    // Tool usage -> primary timeline nodes
    if (et === 'tool_executed') {
      const nodeType = _aetMapToolToNodeType(evt.toolName);
      if (nodeType) {
        const relatedFiles = _aetExtractRelatedFilesFromEvent(evt);
        const target = _aetExtractTargetForNodeType(nodeType, evt);
        const jp = _aetConsumePendingJp(runId, { nodeType, target });
        const justificationText = jp && jp.why ? jp.why : null;
        
        // Generate better title based on tool type
        let nodeTitle = `${evt.toolName}${evt.preview || ''}`;
        if (evt.toolName === 'Skill' && evt.toolInputSummary && typeof evt.toolInputSummary === 'object') {
          // Extract skill name from commandName or infer from context
          const cmdName = typeof evt.toolInputSummary.commandName === 'string' ? evt.toolInputSummary.commandName.trim() : '';
          if (cmdName) {
            nodeTitle = `Skill: ${cmdName}`;
          } else {
            // Try to extract skill name from skillPath if available
            const skillPath = typeof evt.toolInputSummary.skillPath === 'string' ? evt.toolInputSummary.skillPath.trim() : '';
            if (skillPath) {
              const parts = skillPath.split('/').filter(Boolean);
              const skillName = parts.length > 0 ? parts[parts.length - 1] : '';
              if (skillName) nodeTitle = `Skill: ${skillName}`;
            }
          }
        }
        
        const node = _aetBuildNode({
          runId,
          type: nodeType,
          relatedFiles,
          justificationText,
          payload: {
            title: nodeTitle,
            toolName: evt.toolName,
            preview: evt.preview || '',
            toolUseId: evt.toolUseId || null,
            receipt: evt.receipt || null,
            toolInputSummary: evt.toolInputSummary || null,
            ...(justificationText ? {
              justification: {
                source: 'model',
                version: jp && typeof jp.version === 'number' ? jp.version : 1,
                why: justificationText,
                outcome: jp && typeof jp.outcome === 'string' ? jp.outcome : '',
                risk: jp && typeof jp.risk === 'string' ? jp.risk : '',
                raw: jp && typeof jp.raw === 'string' ? jp.raw : null
              }
            } : {})
          }
        });
        const saved = await _aetAppendNode(projectPath, runId, node);
        if (saved && typeof emitToRenderer === 'function') {
          emitToRenderer({ kind: 'node', sessionId: uiSessionId || null, runId, node: saved });
        }
      }
      return;
    }

    // Diff payload can be attached as a separate FileEdit node (lightweight + bounded)
    if (et === 'file_diff') {
      const relatedFiles = _aetExtractRelatedFilesFromEvent(evt);
      const node = _aetBuildNode({
        runId,
        type: 'FileEdit',
        relatedFiles,
        payload: {
          title: `Diff: ${evt.filePath || ''}`,
          toolName: evt.toolName || null,
          filePath: evt.filePath || null,
          diffContent: _aetTruncStr(evt.diffContent || '', 12_000)
        }
      });
      const saved = await _aetAppendNode(projectPath, runId, node);
      if (saved && typeof emitToRenderer === 'function') {
        emitToRenderer({ kind: 'node', sessionId: uiSessionId || null, runId, node: saved });
      }
      return;
    }

    // Permission denials / warnings
    if (et === 'result' && Array.isArray(evt.permissionDenials) && evt.permissionDenials.length > 0) {
      const node = _aetBuildNode({
        runId,
        type: 'Warning',
        payload: {
          title: 'Permission denials',
          permissionDenials: evt.permissionDenials.slice(0, 50)
        }
      });
      const saved = await _aetAppendNode(projectPath, runId, node);
      if (saved && typeof emitToRenderer === 'function') {
        emitToRenderer({ kind: 'node', sessionId: uiSessionId || null, runId, node: saved });
      }
      // Continue to completion handling below.
    }

    // Completion
    if (et === 'done' || et === 'error' || et === 'result') {
      // Persist usage/cost (for run summary + budget audits)
      if (et === 'result') {
        try {
          const cost = evt.totalCostUsd;
          const usage = evt.usage && typeof evt.usage === 'object' ? evt.usage : null;
          const patch = {};
          if (typeof cost === 'number' && Number.isFinite(cost)) patch.totalCostUsd = cost;
          if (usage) patch.usage = usage;
          if (Object.keys(patch).length > 0) await mergeRunMeta(patch);
        } catch { /* ignore */ }
      }

      // If the run already has an endTime, this is a late duplicate completion event. Drop it.
      if (runStatus && runStatus !== 'running' && Number.isFinite(runEndTime) && runEndTime > 0) {
        aetDebugLog('late_completion_dropped', { runId, runStatus, endTime: runEndTime, eventType: et });
        return;
      }
      const isError = et === 'error' || (
        et === 'result' && (
          evt.isError === true ||
          (typeof evt.subtype === 'string' && evt.subtype.trim() && evt.subtype !== 'success')
        )
      );
      const status = isError ? 'error' : 'success';
      const endTime = _aetNow();
      await _aetUpdateRun(projectPath, runId, { status, endTime });
      try { aetPendingJpByRunId.delete(String(runId || '').trim()); } catch { /* ignore */ }
      if (typeof emitToRenderer === 'function') {
        emitToRenderer({ kind: 'run_update', sessionId: uiSessionId || null, runId, patch: { status, endTime } });
      }

      const node = _aetBuildNode({
        runId,
        type: 'Completion',
        payload: {
          title: isError ? 'Run failed' : 'Run completed',
          eventType: et,
          ...(et === 'error' ? { error: _aetTruncStr(evt.error || '', 5000) } : {}),
          ...(et === 'result' ? { subtype: evt.subtype || null, totalCostUsd: evt.totalCostUsd ?? null, usage: (evt.usage && typeof evt.usage === 'object') ? evt.usage : null } : {})
        }
      });
      const saved = await _aetAppendNode(projectPath, runId, node);
      if (saved && typeof emitToRenderer === 'function') {
        emitToRenderer({ kind: 'node', sessionId: uiSessionId || null, runId, node: saved });
      }
    }
  } catch (e) {
    console.warn('[AET] Failed to handle Claude SDK event:', e?.message || String(e));
  }
}

// ============================================================================
// PROJECT PATH ISOLATION (Critical)
// ============================================================================

function requireCurrentProject() {
  if (!currentProject) {
    throw new Error('No project folder is currently open. Please open a project folder first.');
  }
  return currentProject;
}

function resolveInCurrentProject(inputPath) {
  const projectRoot = requireCurrentProject();
  const projectReal = fsSync.realpathSync(projectRoot);

  // Treat empty/undefined/"." as project root
  const raw = (inputPath == null || inputPath === '' || inputPath === '.') ? projectReal : inputPath;
  const resolved = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(projectReal, raw);

  // Prevent path escape
  const prefix = projectReal.endsWith(path.sep) ? projectReal : projectReal + path.sep;
  if (resolved !== projectReal && !resolved.startsWith(prefix)) {
    throw new Error('Access outside the currently opened project is not allowed.');
  }

  // Prevent symlink escapes: if any existing parent directory is a symlink pointing outside
  // the project (or the target itself is a symlink), reject it.
  try {
    let cur = resolved;
    // Walk up until we find an existing path (covers "new file in symlink dir" cases)
    // or until we reach the project root.
    while (cur && cur !== projectReal && !fsSync.existsSync(cur)) {
      const next = path.dirname(cur);
      if (!next || next === cur) break;
      cur = next;
    }
    // Ensure the closest existing ancestor (or project root) resolves inside the projectReal.
    const ancestorReal = realpathSafeSync(cur || projectReal);
    if (!isPathInside(projectReal, ancestorReal)) {
      throw new Error('Access outside the currently opened project is not allowed (symlink escape).');
    }
    // If the target itself exists, also verify its realpath is inside the project.
    if (fsSync.existsSync(resolved)) {
      const targetReal = realpathSafeSync(resolved);
      if (!isPathInside(projectReal, targetReal)) {
        throw new Error('Access outside the currently opened project is not allowed (symlink escape).');
      }
    }
  } catch (e) {
    // Normalize any internal failures to a safe, user-facing message.
    const msg = e && e.message ? e.message : 'Access outside the currently opened project is not allowed.';
    throw new Error(msg);
  }

  return resolved;
}

// App data directory for global settings (Desktop App)
const APP_DATA_DIR = path.join(os.homedir(), '.ai-agent');

// ============================================================================
// PATH UTILITIES
// ============================================================================
function realpathSafeSync(p) {
  try { return fsSync.realpathSync(p); } catch { return path.resolve(p); }
}

function isPathInside(parentDir, candidatePath) {
  const parent = realpathSafeSync(parentDir);
  const cand = realpathSafeSync(candidatePath);
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return cand === parent || cand.startsWith(prefix);
}

// Ensure app data directory exists
async function ensureAppDataDir() {
  try {
    await fs.mkdir(APP_DATA_DIR, { recursive: true });
    console.log('[App Data] Directory ready:', APP_DATA_DIR);
  } catch (e) {
    console.error('[App Data] Failed to create directory:', e);
  }
}

// Initialize app data directory on startup
ensureAppDataDir();

// ============================================================================
// WORKSPACE-SCOPED SQLITE KV STORE (Codeon-style, backed by sql.js)
// ============================================================================

let SQL = null;
// PERF: keep workspace KV DB open and debounce flushes to disk.
const workspaceKvStatesById = new Map(); // workspaceId -> state
const WORKSPACE_KV_FLUSH_DEBOUNCE_MS = 250;
const WORKSPACE_KV_CLOSE_IDLE_MS = 90_000;
const workspaceIdByProjectPath = new Map(); // projectPath -> workspaceId (memoize to avoid repeated realpath sync)

async function getSqlJs() {
  if (!SQL) {
    if (!initSqlJs) initSqlJs = require('sql.js');
    SQL = await initSqlJs();
  }
  return SQL;
}

function normalizeWorkspacePath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') return '';
  const trimmed = projectPath.replace(/[\\/]+$/, '');
  try {
    const real = fsSync.realpathSync(trimmed);
    return real.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function deriveWorkspaceId(projectPath) {
  const p = String(projectPath || '').trim();
  if (!p) return '';
  try {
    const cached = workspaceIdByProjectPath.get(p);
    if (cached) return cached;
  } catch { /* ignore */ }
  const normalized = normalizeWorkspacePath(p);
  if (!normalized) return '';
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  const id = hash.slice(0, 32);
  try { workspaceIdByProjectPath.set(p, id); } catch { /* ignore */ }
  return id;
}

function getWorkspaceDbPath(workspaceId) {
  const base = path.join(app.getPath('userData'), 'workspaces', workspaceId);
  return path.join(base, 'state.vscdb');
}

function _getWorkspaceKvState(projectPath) {
  const workspaceId = deriveWorkspaceId(projectPath);
  if (!workspaceId) throw new Error('Invalid workspace/project path');
  const dbPath = getWorkspaceDbPath(workspaceId);
  let st = workspaceKvStatesById.get(workspaceId);
  if (!st) {
    st = {
      workspaceId,
      dbPath,
      db: null,
      chain: Promise.resolve(),
      dirty: false,
      flushTimer: null,
      lastUsedAt: Date.now(),
      closeTimer: null
    };
    workspaceKvStatesById.set(workspaceId, st);
  }
  st.lastUsedAt = Date.now();
  return st;
}

async function _ensureWorkspaceKvDbOpen(_projectPath, st) {
  if (st.db) return st.db;
  const SQL = await getSqlJs();
  let filebuffer = null;
  try {
    filebuffer = await fs.readFile(st.dbPath);
  } catch {
    filebuffer = null;
  }
  st.db = filebuffer ? new SQL.Database(filebuffer) : new SQL.Database();
  // Ensure schema exists (idempotent)
  st.db.run(`
    CREATE TABLE IF NOT EXISTS ItemTable (
      key TEXT PRIMARY KEY,
      value TEXT,
      updatedAt INTEGER
    );
  `);
  return st.db;
}

function _touchWorkspaceKvCloseTimer(st) {
  try {
    if (st.closeTimer) clearTimeout(st.closeTimer);
  } catch { /* ignore */ }
  st.closeTimer = setTimeout(() => {
    try {
      const idleMs = Date.now() - Number(st.lastUsedAt || 0);
      if (idleMs < WORKSPACE_KV_CLOSE_IDLE_MS) {
        _touchWorkspaceKvCloseTimer(st);
        return;
      }
      // Best-effort: flush then close to free memory.
      void _queueWorkspaceKvFlush(st, { force: true }).finally(() => {
        try { st.db?.close?.(); } catch { /* ignore */ }
        st.db = null;
      });
    } catch { /* ignore */ }
  }, WORKSPACE_KV_CLOSE_IDLE_MS);
}

function _queueWorkspaceKvOp(st, op) {
  const run = st.chain.then(op, op);
  // Never let the chain break permanently.
  st.chain = run.catch(() => {});
  return run;
}

async function _flushWorkspaceKvNow(st) {
  if (!st.db || st.dirty !== true) return;
  st.dirty = false;
  const data = st.db.export(); // CPU-bound; keep debounced to avoid jank
  const buffer = Buffer.from(data);
  await fs.mkdir(path.dirname(st.dbPath), { recursive: true });
  await writeBufferSafely(st.dbPath, buffer);
}

function _queueWorkspaceKvFlush(st, { force = false } = {}) {
  // Debounced flush scheduling: keep UI responsive and avoid main-process stutters.
  if (force) {
    if (st.flushTimer) {
      try { clearTimeout(st.flushTimer); } catch { /* ignore */ }
      st.flushTimer = null;
    }
    return _queueWorkspaceKvOp(st, async () => {
      await _flushWorkspaceKvNow(st);
    });
  }
  if (st.flushTimer) return st.chain;
  st.flushTimer = setTimeout(() => {
    st.flushTimer = null;
    _queueWorkspaceKvOp(st, async () => {
      await _flushWorkspaceKvNow(st);
    }).catch(() => {});
  }, WORKSPACE_KV_FLUSH_DEBOUNCE_MS);
  return st.chain;
}

async function withWorkspaceKvDb(projectPath, fn) {
  const st = _getWorkspaceKvState(projectPath);
  _touchWorkspaceKvCloseTimer(st);
  return _queueWorkspaceKvOp(st, async () => {
    const db = await _ensureWorkspaceKvDbOpen(projectPath, st);
    return await fn(db, st);
  });
}

function kvGetString(db, key) {
  const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
  stmt.bind([key]);
  try {
    if (stmt.step()) {
      const row = stmt.getAsObject();
      return typeof row.value === 'string' ? row.value : undefined;
    }
    return undefined;
  } finally {
    stmt.free();
  }
}

function kvSetString(db, key, valueStr) {
  const now = Date.now();
  db.run(
    'INSERT OR REPLACE INTO ItemTable (key, value, updatedAt) VALUES (?, ?, ?)',
    [key, valueStr, now]
  );
}

function kvRemove(db, key) {
  db.run('DELETE FROM ItemTable WHERE key = ?', [key]);
}

// (Removed) Background shell + browser automation (agentic tooling)

// ============================================================================
// Built-in Skills Bootstrap
// Ensures Codeon's quality guideline skills are available in ~/.claude/skills/
// These are user-level skills that provide best practices across all projects.
// Claude auto-invokes them when contextually relevant (expose, don't force).
// ============================================================================

const BUILT_IN_SKILLS = {
  Security: {
    name: 'Security Best Practices',
    description: 'Guidelines for secure code - input validation, secrets management, authentication, injection prevention, and secure defaults',
    whenToUse: 'When writing code that handles user input, authentication, database queries, API endpoints, file operations, passwords, tokens, or any security-sensitive functionality',
    content: `---
name: Security Best Practices
description: Guidelines for secure code - input validation, secrets management, authentication, injection prevention, and secure defaults
when_to_use: When writing code that handles user input, authentication, database queries, API endpoints, file operations, passwords, tokens, or any security-sensitive functionality
---

# Security Best Practices

When writing or reviewing code that involves user input, database operations, authentication, API endpoints, file operations, or network requests, consider these security practices:

## Input Validation & Sanitization
- Validate all external input (user input, API responses, file contents) before use
- Sanitize data appropriately for the context (HTML encoding, SQL escaping, etc.)
- Use allowlists over denylists when validating input
- Implement proper type checking and boundary validation

## Secrets Management
- Never hardcode secrets, API keys, passwords, or credentials in source code
- Use environment variables or secure secret management systems
- Ensure secrets are not logged or exposed in error messages
- Rotate credentials regularly and use short-lived tokens when possible

## Authentication & Authorization
- Use established authentication libraries - never roll your own crypto
- Implement proper password hashing (bcrypt, argon2, scrypt)
- Apply principle of least privilege for all access controls
- Validate authorization on every protected resource access

## Database Security
- Use parameterized queries or prepared statements - never string concatenation
- Apply appropriate database user permissions
- Sanitize data before storage and escape on output

## API & Network Security
- Use HTTPS for all network communications
- Validate and sanitize all API inputs and outputs
- Implement rate limiting on public endpoints
- Use appropriate CORS policies

## General Secure Defaults
- Fail securely - deny access by default
- Log security-relevant events (without sensitive data)
- Keep dependencies updated to patch known vulnerabilities
- Apply defense in depth - multiple layers of security
`
  },

  Architecture: {
    name: 'Modular Architecture',
    description: 'Best practices for code organization - modularity, file structure, separation of concerns, avoiding monolithic code',
    whenToUse: 'When creating new features, adding significant code, organizing files, or when code structure decisions need to be made',
    content: `---
name: Modular Architecture
description: Best practices for code organization - modularity, file structure, separation of concerns, avoiding monolithic code
when_to_use: When creating new features, adding significant code, organizing files, or when code structure decisions need to be made
---

# Modular Architecture

When creating or modifying code structure, consider these architectural best practices:

## File Organization
- Create new features in separate files/modules - avoid dumping everything in one file
- Keep files focused on a single responsibility
- If a file exceeds ~500 lines, consider splitting it into smaller modules
- Group related functionality into logical directories

## Code Structure
- Follow existing project patterns and conventions before introducing new ones
- Prefer composition over inheritance
- Use dependency injection over hard-coded dependencies
- Extract repeated logic into reusable utilities (DRY principle)

## Module Design
- Each module should have a clear, single purpose
- Define clean interfaces between modules
- Minimize coupling - modules should know as little as possible about each other
- Maximize cohesion - related functionality should be grouped together

## Naming & Organization
- Use clear, descriptive names for files, functions, and variables
- Organize code by feature/domain rather than by type when it improves clarity
- Keep import/require statements organized and minimal
- Document module boundaries and responsibilities

## Scalability Considerations
- Design for independent testing of modules
- Consider how code will be maintained and extended
- Avoid circular dependencies
- Plan for future growth without over-engineering

## When to Split Code
Split into separate modules when:
- A file becomes difficult to navigate (>500 lines)
- Multiple developers need to work on the same file
- Code has distinct responsibilities that could change independently
- Testing requires isolating specific functionality
`
  },

  Quality: {
    name: 'Code Quality',
    description: 'General code quality guidelines - error handling, edge cases, clarity, maintainability, and robustness',
    whenToUse: 'When writing any code - applies to all programming tasks for ensuring robust, maintainable, and clear code',
    content: `---
name: Code Quality
description: General code quality guidelines - error handling, edge cases, clarity, maintainability, and robustness
when_to_use: When writing any code - applies to all programming tasks for ensuring robust, maintainable, and clear code
---

# Code Quality

When writing code, consider these quality guidelines:

## Error Handling
- Handle errors explicitly with meaningful, actionable messages
- Never silently swallow exceptions - log or propagate appropriately
- Provide context in error messages to aid debugging
- Use appropriate error types/codes for different failure modes
- Consider recovery strategies where applicable

## Edge Cases & Robustness
- Consider and handle edge cases explicitly (empty inputs, null values, boundaries)
- Validate assumptions at function boundaries
- Consider what happens when things go wrong - not just the happy path
- Handle resource cleanup properly (connections, file handles, etc.)
- Test boundary conditions

## Code Clarity
- Write self-documenting code with clear, descriptive naming
- Add comments for "why", not "what" - explain intent, not mechanics
- Keep functions focused and reasonably sized
- Use meaningful variable names that reveal intent
- Prefer explicit over clever - readable code over terse code

## Maintainability
- Write code that others (or future you) can understand
- Keep complexity manageable - refactor when logic becomes convoluted
- Follow consistent formatting and style conventions
- Remove dead code rather than commenting it out
- Update related documentation when changing functionality

## Testing Considerations
- Write code that can be tested in isolation
- Consider how code will be verified to work correctly
- Provide clear contracts (inputs, outputs, side effects)
- Handle test/debug scenarios gracefully

## Performance Awareness
- Be mindful of algorithmic complexity for data operations
- Avoid unnecessary work (redundant calculations, extra iterations)
- Consider memory usage for large data sets
- Profile before optimizing - don't prematurely optimize
`
  },

  UX: {
    name: 'User Experience',
    description: 'UX best practices for any user interface - feedback, error handling, clarity, accessibility, and intuitive design',
    whenToUse: 'When building any user interface - web pages, CLI tools, desktop apps, or mobile apps that users will interact with',
    content: `---
name: User Experience
description: UX best practices for any user interface - feedback, error handling, clarity, accessibility, and intuitive design
when_to_use: When building any user interface - web pages, CLI tools, desktop apps, or mobile apps that users will interact with
---

# User Experience

When building any user interface (web, CLI, desktop, mobile), consider these UX guidelines:

## User Feedback
- Provide clear feedback for all user actions (loading states, success, error)
- Show progress indicators for operations that take time
- Confirm destructive actions before executing
- Use appropriate visual/audio cues for state changes

## Error Communication
- Display errors in user-friendly language, not technical jargon
- Provide actionable guidance - tell users what they can do to fix issues
- Don't blame the user - errors should be constructive, not accusatory
- Preserve user input when errors occur (don't clear forms)

## Clarity & Simplicity
- Use clear, concise labels and messages
- Design for the user's mental model - match their expectations
- Use progressive disclosure - don't overwhelm with options upfront
- Provide sensible defaults that work for most users
- Make primary actions obvious, secondary actions accessible

## Accessibility
- Support keyboard navigation for all interactive elements
- Use appropriate color contrast for readability
- Provide text alternatives for non-text content
- Ensure interactive elements are appropriately sized
- Don't rely solely on color to convey information

## Consistency
- Use consistent patterns and terminology throughout
- Follow platform conventions where appropriate
- Maintain visual and behavioral consistency
- Use familiar patterns for common actions

## CLI-Specific (when applicable)
- Provide --help with clear usage examples
- Use progress indicators for long operations
- Support both verbose and quiet modes
- Use meaningful exit codes
- Color output for readability (with --no-color option)

## Responsiveness
- Design for various screen sizes and devices
- Ensure interactions feel immediate (< 100ms feedback)
- Handle slow network conditions gracefully
- Support offline scenarios where feasible
`
  },

  Testing: {
    name: 'Testing & Quality Assurance',
    description: 'Guidelines for writing tests - unit tests, integration tests, edge cases, coverage, and test-driven development',
    whenToUse: 'When writing new functions, fixing bugs, creating APIs, or any code that should be verified to work correctly',
    content: `---
name: Testing & Quality Assurance
description: Guidelines for writing tests - unit tests, integration tests, edge cases, coverage, and test-driven development
when_to_use: When writing new functions, fixing bugs, creating APIs, or any code that should be verified to work correctly
---

# Testing & Quality Assurance

When writing code, always consider how it will be tested. Don't wait to be asked - proactively suggest and write tests alongside implementation code.

## Test Coverage Philosophy
- Every public function or API endpoint should have corresponding tests
- Tests are documentation - they show how code is meant to be used
- When fixing a bug, write a test that reproduces it first

## Unit Tests
- Test individual functions/methods in isolation
- Mock external dependencies (databases, APIs, file system)
- Cover the main success path first, then edge cases
- Use descriptive test names that explain what's being tested and expected outcome
- Example pattern: "should return empty array when user has no orders"

## Edge Cases to Always Consider
- Empty inputs (null, undefined, empty string, empty array)
- Boundary values (0, -1, MAX_INT, empty collections)
- Invalid inputs (wrong types, malformed data)
- Concurrent access (race conditions)
- Network failures and timeouts
- Large data sets (performance under load)

## Integration Tests
- Test how components work together
- Test actual database queries (use test database)
- Test API endpoints end-to-end
- Verify error responses, not just success cases

## Test Quality
- Tests should be deterministic - same result every run
- Tests should be independent - order shouldn't matter
- Keep tests fast - slow tests don't get run
- Don't test implementation details, test behavior
- One assertion concept per test (may have multiple assert calls)

## When Generating Code
- If creating a new function, suggest accompanying test file
- If modifying existing code, update or add relevant tests
- For bug fixes, include a regression test
- For APIs, test both valid and invalid request scenarios

## Test File Organization
- Mirror source file structure in test directory
- Name test files clearly: *.test.js, *.spec.ts, test_*.py
- Group related tests using describe/context blocks
- Use setup/teardown for common test preparation
`
  },

  Performance: {
    name: 'Performance Optimization',
    description: 'Guidelines for writing efficient code - database queries, caching, memory management, algorithmic complexity, and scalability',
    whenToUse: 'When writing code that handles data processing, database queries, API calls, loops over collections, or any performance-sensitive operations',
    content: `---
name: Performance Optimization
description: Guidelines for writing efficient code - database queries, caching, memory management, algorithmic complexity, and scalability
when_to_use: When writing code that handles data processing, database queries, API calls, loops over collections, or any performance-sensitive operations
---

# Performance Optimization

When writing code that handles data, network requests, or user interactions, consider performance implications proactively.

## Database Query Optimization
- Avoid N+1 queries: Never query inside a loop. Use eager loading/joins instead
  - Bad: Loop through users, query orders for each
  - Good: Single query with JOIN or include related data
- Use appropriate indexes for frequently queried columns
- Select only needed columns, not SELECT *
- Use pagination for large result sets
- Consider query execution plans for complex queries

## Caching Strategies
- Cache expensive computations and repeated queries
- Use appropriate cache invalidation strategies
- Consider cache levels: memory > Redis/Memcached > database
- Cache at the right granularity - not too broad, not too narrow
- Set reasonable TTLs based on data volatility

## Memory Management
- Be mindful of memory when processing large data sets
- Use streaming/chunking for large files instead of loading entirely
- Clean up resources (close connections, release handles)
- Avoid memory leaks in long-running processes
- Consider memory implications of data structures chosen

## Algorithmic Complexity
- Be aware of Big O implications for data operations
- Avoid O(n squared) operations on potentially large datasets
- Use appropriate data structures (Set for lookups, Map for key-value)
- Consider trade-offs between time and space complexity
- For sorting/searching, use built-in optimized methods

## Network & I/O Efficiency
- Batch API calls instead of many individual requests
- Use compression for large payloads
- Implement request debouncing/throttling in UIs
- Consider lazy loading for non-critical resources
- Use connection pooling for database connections

## Frontend Performance
- Minimize bundle size (code splitting, tree shaking)
- Lazy load components and routes
- Optimize images (compression, appropriate formats, srcset)
- Use virtualization for long lists
- Avoid unnecessary re-renders (memoization)

## When to Optimize
- Profile before optimizing - identify actual bottlenecks
- Focus on hot paths (code that runs frequently)
- Consider 80/20 rule - 20% of code causes 80% of issues
- Don't prematurely optimize - but do design with scalability in mind
`
  },

  Accessibility: {
    name: 'Accessibility (A11Y)',
    description: 'WCAG guidelines for inclusive design - screen readers, keyboard navigation, ARIA, color contrast, and assistive technologies',
    whenToUse: 'When building any user interface with interactive elements, forms, buttons, images, or content that users need to perceive and interact with',
    content: `---
name: Accessibility (A11Y)
description: WCAG guidelines for inclusive design - screen readers, keyboard navigation, ARIA, color contrast, and assistive technologies
when_to_use: When building any user interface with interactive elements, forms, buttons, images, or content that users need to perceive and interact with
---

# Accessibility (A11Y)

When building any user interface, ensure it's usable by everyone, including people with disabilities. Accessibility is not optional - it's a core requirement.

## Keyboard Navigation
- All interactive elements must be keyboard accessible
- Use logical tab order (follows visual layout)
- Provide visible focus indicators (never outline: none without alternative)
- Implement keyboard shortcuts for common actions
- Ensure modals/dialogs trap focus appropriately
- Provide skip links for repetitive navigation

## Screen Reader Support
- Use semantic HTML elements (nav, main, article, aside, button, etc.)
- Provide meaningful alt text for images (or empty alt="" for decorative)
- Use ARIA labels for elements without visible text
- Announce dynamic content changes with aria-live regions
- Ensure form inputs have associated labels
- Use heading hierarchy (h1, h2, h3) for document structure

## ARIA Best Practices
- Prefer semantic HTML over ARIA when possible
- Use aria-label, aria-labelledby, aria-describedby appropriately
- Implement aria-expanded, aria-selected for interactive widgets
- Use role attributes only when semantic HTML isn't sufficient
- Don't misuse ARIA - incorrect ARIA is worse than none

## Color & Visual Design
- Ensure 4.5:1 contrast ratio for normal text (3:1 for large text)
- Never convey information through color alone (add icons, text, patterns)
- Support high contrast mode and user color preferences
- Test with color blindness simulators
- Provide sufficient spacing between interactive elements (44px touch targets)

## Forms & Inputs
- Associate every input with a visible label
- Group related fields with fieldset/legend
- Provide clear error messages linked to specific fields
- Indicate required fields accessibly (not just color)
- Support autocomplete attributes for common fields

## Media & Content
- Provide captions for videos
- Provide transcripts for audio content
- Ensure text can be resized to 200% without loss of content
- Avoid auto-playing media
- Provide controls for any motion/animation

## Testing Accessibility
- Use automated tools (axe, Lighthouse, WAVE)
- Test with keyboard only - no mouse
- Test with screen readers (VoiceOver, NVDA, JAWS)
- Verify in high contrast mode
- Check zoom levels up to 200%
`
  },

  API: {
    name: 'API Design',
    description: 'REST and API guidelines - endpoint design, HTTP methods, status codes, versioning, documentation, and error responses',
    whenToUse: 'When designing or implementing REST APIs, HTTP endpoints, request/response handling, or any client-server communication',
    content: `---
name: API Design
description: REST and API guidelines - endpoint design, HTTP methods, status codes, versioning, documentation, and error responses
when_to_use: When designing or implementing REST APIs, HTTP endpoints, request/response handling, or any client-server communication
---

# API Design

When designing or implementing APIs, follow these conventions for consistency, clarity, and ease of use.

## RESTful Endpoint Design
- Use nouns for resources, not verbs: /users not /getUsers
- Use plural nouns: /orders, /products
- Use hierarchy for relationships: /users/{id}/orders
- Keep URLs lowercase with hyphens: /order-items
- Limit nesting depth (max 2-3 levels)

## HTTP Methods
- GET: Retrieve resources (idempotent, cacheable)
- POST: Create new resources
- PUT: Full update of a resource (idempotent)
- PATCH: Partial update of a resource
- DELETE: Remove a resource (idempotent)

## Status Codes - Use Them Correctly

### Success (2xx)
- 200 OK: Successful GET, PUT, PATCH, or DELETE
- 201 Created: Successful POST creating a resource
- 204 No Content: Successful request with no body to return

### Client Errors (4xx)
- 400 Bad Request: Invalid request data
- 401 Unauthorized: Missing or invalid authentication
- 403 Forbidden: Authenticated but not authorized
- 404 Not Found: Resource doesn't exist
- 409 Conflict: Request conflicts with current state
- 422 Unprocessable Entity: Validation errors

### Server Errors (5xx)
- 500 Internal Server Error: Unexpected server error
- 503 Service Unavailable: Service temporarily down

## Error Response Format
Consistent error structure helps clients handle errors:

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  }
}

## Request/Response Best Practices
- Use JSON for request and response bodies
- Support pagination for list endpoints: ?page=1&limit=20
- Support filtering and sorting: ?status=active&sort=-created_at
- Return created/updated resource in response body
- Use ISO 8601 for dates: 2024-01-15T10:30:00Z
- Use camelCase for JSON properties

## API Versioning
- Include version in URL: /api/v1/users or header
- Don't break existing versions
- Document deprecation timeline
- Provide migration guides for major versions

## Documentation
- Document all endpoints, parameters, and responses
- Provide request/response examples
- Document authentication requirements
- List possible error codes and meanings
- Use OpenAPI/Swagger for standardized docs
`
  },

  Database: {
    name: 'Database Patterns',
    description: 'Database best practices - schema design, query optimization, N+1 prevention, indexing, migrations, and data integrity',
    whenToUse: 'When writing database queries, designing schemas, working with ORMs, creating migrations, or any code that interacts with databases',
    content: `---
name: Database Patterns
description: Database best practices - schema design, query optimization, N+1 prevention, indexing, migrations, and data integrity
when_to_use: When writing database queries, designing schemas, working with ORMs, creating migrations, or any code that interacts with databases
---

# Database Patterns

When working with databases, follow these patterns for reliability, performance, and maintainability.

## Schema Design
- Use appropriate data types (don't store numbers as strings)
- Add NOT NULL constraints where appropriate
- Use foreign keys to enforce referential integrity
- Normalize to reduce redundancy, denormalize strategically for performance
- Include created_at, updated_at timestamps on most tables
- Use UUIDs for public-facing IDs, auto-increment for internal

## Indexing Strategy
- Index columns used in WHERE clauses
- Index columns used in JOIN conditions
- Index columns used in ORDER BY
- Consider composite indexes for multi-column queries
- Don't over-index - indexes slow down writes
- Monitor and remove unused indexes

## Query Optimization

### Avoid N+1 Queries (Critical!)

BAD - N+1 (1 query + N queries):
users = User.all()
for user in users:
    orders = Order.where(user_id=user.id)  # N queries!

GOOD - Eager loading (1-2 queries):
users = User.all().prefetch_related('orders')
# or: JOIN query returning all data at once

### Other Optimizations
- Select only needed columns
- Use LIMIT for pagination, not offset for large tables
- Use EXISTS instead of COUNT when checking presence
- Batch inserts/updates for bulk operations
- Use EXPLAIN to understand query execution

## Transactions & Integrity
- Use transactions for multi-step operations
- Keep transactions short to avoid locks
- Handle deadlocks with retry logic
- Use appropriate isolation levels
- Validate data at database level (constraints), not just application

## Migrations
- Make migrations reversible when possible
- One logical change per migration
- Test migrations on production-like data
- Have a rollback plan for each migration
- Don't modify historical migration files

## Connection Management
- Use connection pooling
- Set appropriate pool sizes
- Handle connection timeouts gracefully
- Close connections when done (or use context managers)
- Implement retry logic for transient failures

## Data Safety
- Never store plain text passwords (bcrypt, argon2)
- Encrypt sensitive data at rest
- Sanitize inputs to prevent SQL injection
- Regular backups with tested restore procedures
- Implement soft deletes for important data
`
  },

  Documentation: {
    name: 'Code Documentation',
    description: 'Documentation guidelines - inline comments, function docs, README files, API documentation, and knowledge sharing',
    whenToUse: 'When writing functions, classes, modules, or APIs that others will use or maintain',
    content: `---
name: Code Documentation
description: Documentation guidelines - inline comments, function docs, README files, API documentation, and knowledge sharing
when_to_use: When writing functions, classes, modules, or APIs that others will use or maintain
---

# Code Documentation

Good documentation makes code maintainable and helps others (including future you) understand the codebase.

## Inline Comments

### When to Comment
- Explain "why", not "what" - code shows what, comments show why
- Document non-obvious business logic or decisions
- Explain workarounds and link to related issues/tickets
- Mark TODO/FIXME with context and ideally a ticket number

### When NOT to Comment
- Don't comment obvious code
- Don't leave commented-out code (delete it, git has history)
- Don't write comments that just repeat the code
- Don't let comments get stale - update or remove

### Good vs Bad Examples

// Bad: Sets x to 5
let x = 5;

// Good: Retry limit based on 99th percentile of successful attempts (see JIRA-1234)
const MAX_RETRIES = 5;

## Function/Method Documentation

Document public functions with:
- Brief description of purpose
- Parameters and their types
- Return value and type
- Exceptions/errors thrown
- Usage example for complex functions

Example:
/**
 * Calculates shipping cost based on weight and destination.
 * 
 * @param {number} weightKg - Package weight in kilograms
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @returns {number} Shipping cost in USD
 * @throws {Error} If country is not supported
 */
function calculateShipping(weightKg, countryCode) { ... }

## README Files
Every project should have a README with:
- Project name and brief description
- Prerequisites and setup instructions
- How to run locally
- How to run tests
- Environment variables needed
- Deployment process
- Contributing guidelines

## Architecture Documentation
For larger projects, document:
- High-level system architecture
- Data flow diagrams
- Integration points with external systems
- Key design decisions and their rationale
- Module responsibilities and boundaries

## Keeping Docs Updated
- Review documentation when changing related code
- Include doc updates in PR requirements
- Delete outdated documentation
- Use automation (OpenAPI, TypeDoc) where possible
`
  },

  ErrorHandling: {
    name: 'Error Handling Patterns',
    description: 'Comprehensive error handling - try-catch, error types, logging, user-facing messages, recovery strategies, and debugging',
    whenToUse: 'When writing code that can fail - async operations, API calls, file I/O, user input handling, or any operation that needs error handling',
    content: `---
name: Error Handling Patterns
description: Comprehensive error handling - try-catch, error types, logging, user-facing messages, recovery strategies, and debugging
when_to_use: When writing code that can fail - async operations, API calls, file I/O, user input handling, or any operation that needs error handling
---

# Error Handling Patterns

Robust error handling is essential for reliable software. Handle errors explicitly and gracefully.

## Core Principles
- Never silently swallow errors - at minimum, log them
- Fail fast during development, fail gracefully in production
- Provide context - what operation failed and why
- Help the next developer (or yourself) debug the issue

## Error Types - Use Them

Create specific error types/classes for different failure modes:

class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class NotFoundError extends Error { ... }
class AuthorizationError extends Error { ... }
class ExternalServiceError extends Error { ... }

## Try-Catch Best Practices
- Don't wrap everything in try-catch - only where recovery is possible
- Catch specific errors, not generic Exception/Error when possible
- Include original error as cause for wrapping
- Log with appropriate level (error vs warn vs info)

Example - specific handling:

try {
  await saveUser(userData);
} catch (error) {
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof DuplicateKeyError) {
    return res.status(409).json({ error: 'User already exists' });
  }
  // Unknown error - log and return generic message
  logger.error('Unexpected error saving user', { error, userData });
  return res.status(500).json({ error: 'Unable to save user' });
}

## Logging Errors

Include context for debugging:

logger.error('Failed to process order', {
  orderId: order.id,
  userId: user.id,
  error: error.message,
  stack: error.stack,
  attemptNumber: retryCount
});

## User-Facing Error Messages
- Never expose technical details to users (stack traces, SQL errors)
- Provide helpful, actionable messages
- Use error codes that support can reference
- Be honest but not alarming

Bad: "NullPointerException at line 234"
Bad: "Error"
Good: "We couldn't save your changes. Please try again or contact support (ERR-2001)"

## Recovery Strategies
- Retry with exponential backoff for transient failures
- Circuit breaker pattern for external services
- Graceful degradation - provide partial functionality
- Queue failed operations for later retry
- Provide rollback for partial failures

## Validation Errors
- Validate early, fail early
- Return all validation errors at once (not one at a time)
- Be specific about what's wrong and how to fix it
- Validate at API boundaries, trust internal code

## Async Error Handling
- Always handle Promise rejections (.catch or try/catch with await)
- Use unhandledRejection handlers as safety net
- Don't mix callbacks and promises - pick one
- Ensure cleanup happens even on error (finally blocks)
`
  }
};

async function ensureBuiltInSkills() {
  const userClaudeDir = path.join(os.homedir(), '.claude');
  const skillsDir = path.join(userClaudeDir, 'skills');

  try {
    // Ensure ~/.claude/skills directory exists
    await fs.mkdir(skillsDir, { recursive: true });

    for (const [skillName, skillData] of Object.entries(BUILT_IN_SKILLS)) {
      const skillDir = path.join(skillsDir, skillName);
      const skillFile = path.join(skillDir, 'SKILL.md');

      try {
        // Check if skill already exists
        await fs.access(skillFile);
        // Skill exists, skip (don't overwrite user modifications)
      } catch {
        // Skill doesn't exist, create it
        try {
          await fs.mkdir(skillDir, { recursive: true });
          await fs.writeFile(skillFile, skillData.content, 'utf8');
          console.log(`[Skills] Created built-in skill: ${skillName}`);
        } catch (writeErr) {
          console.warn(`[Skills] Failed to create skill ${skillName}:`, writeErr?.message || writeErr);
        }
      }
    }

    console.log('[Skills] Built-in skills bootstrap complete');
  } catch (err) {
    // Non-fatal: skills are a nice-to-have, not critical for app function
    console.warn('[Skills] Failed to bootstrap built-in skills:', err?.message || err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(APP_ROOT, 'preload.js'),
      cache: app.isPackaged  // Enable cache in production, disable in development
    },
    backgroundColor: '#121214',  // Dark theme background
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 }
  });

  mainWindow.loadFile(path.join(APP_ROOT, 'renderer', 'index.html'));

  // Cleanup any interactive terminal sessions when the window goes away
  try {
    const wcId = mainWindow.webContents.id;
    mainWindow.on('closed', () => cleanupPtySessionsForWebContentsId(wcId, 'window-closed'));
    mainWindow.webContents.on('destroyed', () => cleanupPtySessionsForWebContentsId(wcId, 'webContents-destroyed'));
  } catch {
    // ignore
  }

  // Create application menu
  createMenu();

  // Native edit context menu (right-click) for input/textarea fields.
  try {
    mainWindow.webContents.on('context-menu', (_event, params) => {
      try {
        if (!mainWindow || mainWindow.isDestroyed?.()) return;
        
        const x = Number(params.x || 0);
        const y = Number(params.y || 0);

        const showMenu = () => {
          const ef = params.editFlags || {};
          const hasSelection = !!(params.selectionText && String(params.selectionText).trim());
          const template = [
            { role: 'undo', enabled: !!ef.canUndo },
            { role: 'redo', enabled: !!ef.canRedo },
            { type: 'separator' },
            { role: 'cut', enabled: !!ef.canCut },
            { role: 'copy', enabled: !!ef.canCopy && hasSelection },
            { role: 'paste', enabled: !!ef.canPaste },
            { type: 'separator' },
            { role: 'selectAll', enabled: !!ef.canSelectAll }
          ];
          const menu = Menu.buildFromTemplate(template);
          menu.popup({ window: mainWindow, x, y });
        };

        // Check if it's an editable field
        if (params.isEditable === true) {
          // Validate it's not Monaco (which has its own context menu)
          mainWindow.webContents
            .executeJavaScript(
              `(function(){
                try {
                  const el = document.elementFromPoint(${x}, ${y});
                  if (!el || !el.closest) return false;
                  if (el.closest('.monaco-editor') || el.closest('#editor') || el.closest('#diffEditor')) return false;
                  return true;
                } catch { return false; }
              })();`,
              true
            )
            .then((ok) => {
              if (ok) showMenu();
            })
            .catch(() => {});
        }
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }

  // Open DevTools only in development (packaged builds keep them closed).
  try {
    const isDebugFlag = process.argv.includes('--codeon-debug') || process.env.CODEON_DEBUG === '1';
    if (!app.isPackaged || isDebugFlag) {
      mainWindow.webContents.openDevTools();
      console.log('[Electron] DevTools enabled for development');
    } else {
      console.log('[Electron] DevTools disabled for production');
    }
  } catch { /* ignore */ }

  // Log to console
  console.log('[Electron] App started');
  console.log('[Electron] Current project:', currentProject || 'none');

  mainWindow.on('close', (e) => {
    try {
      if (suppressCloseOnce) {
        suppressCloseOnce = false;
        return;
      }
      // Ask renderer to flush state before closing the window.
      e.preventDefault();
      requestRendererFlushThen(() => {
        try {
          if (!mainWindow || mainWindow.isDestroyed?.()) return;
          suppressCloseOnce = true;
          mainWindow.close();
        } catch {
          try { mainWindow.destroy(); } catch { /* ignore */ }
        }
      });
    } catch {
      // ignore
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

}

function createMenu() {
  const isMac = process.platform === 'darwin';

  if (isMac) {
    try {
      app.setAboutPanelOptions({
        applicationName: app.getName(),
        applicationVersion: app.getVersion(),
        copyright: '© Codeon'
      });
    } catch {
      // ignore
    }
  }

  const showAboutDialog = async () => {
    try {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: `About ${app.getName()}`,
        message: app.getName(),
        detail: `Version ${app.getVersion()}`
      });
    } catch {
      // ignore
    }
  };

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFolder()
        },
        {
          label: 'Open File',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => openFile()
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu-save')
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => saveFileAs()
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        // Show DevTools toggle in development mode or when debug flag is present
        ...((app.isPackaged && !process.argv.includes('--codeon-debug') && process.env.CODEON_DEBUG !== '1') 
          ? [] 
          : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://codeonai.net/documentation.html')
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ label: `About ${app.getName()}`, click: showAboutDialog }])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function openFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    // Allow creating a new folder directly from the native dialog (shows "New Folder" on macOS).
    properties: ['openDirectory', 'createDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    currentProject = folderPath;
    console.log('[Electron] Folder opened:', folderPath);
    console.log('[Electron] currentProject set to:', currentProject);
    startWorkspaceWatcher(currentProject);
    // AET: load + reconcile immediately on project open so stale "running" runs are fixed after relaunch.
    try { await _aetEnsureLoaded(currentProject); } catch { /* ignore */ }
    const files = await readDirectory(folderPath);
    mainWindow.webContents.send('folder-opened', { path: folderPath, files });
  }
}

async function openFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'JavaScript', extensions: ['js', 'jsx', 'mjs'] },
      { name: 'TypeScript', extensions: ['ts', 'tsx'] },
      { name: 'Python', extensions: ['py'] },
      { name: 'HTML', extensions: ['html', 'htm'] },
      { name: 'CSS', extensions: ['css', 'scss', 'sass'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    const language = detectLanguage(filePath);

    mainWindow.webContents.send('file-opened', {
      path: filePath,
      content,
      language,
      name: path.basename(filePath)
    });
  }
}

async function saveFileAs() {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'JavaScript', extensions: ['js'] },
      { name: 'TypeScript', extensions: ['ts'] },
      { name: 'Python', extensions: ['py'] },
      { name: 'HTML', extensions: ['html'] },
      { name: 'CSS', extensions: ['css'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    mainWindow.webContents.send('save-file-as', result.filePath);
  }
}

// Read directory with depth limit (for node_modules)
async function readDirectoryLimited(dirPath, basePath = dirPath, maxDepth = 3, currentDepth = 0) {
  const items = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  // Limit to first 100 items per folder for performance
  for (const item of items.slice(0, 100)) {
    const fullPath = path.join(dirPath, item.name);
    const relativePath = path.relative(basePath, fullPath);

    // Skip hidden files and nested node_modules (but allow .claude-plugin for plugin manifests)
    if ((item.name.startsWith('.') && item.name !== '.claude-plugin') || item.name === 'node_modules') {
      continue;
    }

    if (item.isDirectory()) {
      // If we're at max depth, show folder but with no children
      // If we're below max depth, recurse to get children
      const children = currentDepth < maxDepth
        ? await readDirectoryLimited(fullPath, basePath, maxDepth, currentDepth + 1)
        : [];

      files.push({
        name: item.name,
        path: relativePath,
        type: 'directory',
        children
      });
    } else {
      files.push({
        name: item.name,
        path: relativePath,
        type: 'file'
      });
    }
  }

  return files.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'directory' ? -1 : 1;
  });
}

async function readDirectory(dirPath, basePath = dirPath) {
  const items = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    const relativePath = path.relative(basePath, fullPath);

    // Skip .git, .ai-agent (our chat history), and most hidden files (but show node_modules for verification!)
    // Allow .cursor so we can see project brain DB
    if (item.name === '.git' || item.name === '.ai-agent' || (item.name.startsWith('.') && item.name !== '.env' && item.name !== '.gitignore' && item.name !== '.cursor')) {
      continue;
    }

    // For node_modules, read it but limit depth to avoid too many files
    if (item.name === 'node_modules' && item.isDirectory()) {
      const nmChildren = await readDirectoryLimited(fullPath, basePath, 3); // 3 levels deep
      files.push({
        name: item.name,
        path: relativePath,
        type: 'directory',
        children: nmChildren
      });
      continue;
    }

    if (item.isDirectory()) {
      const children = await readDirectory(fullPath, basePath);
      files.push({
        name: item.name,
        path: relativePath,
        type: 'directory',
        children
      });
    } else {
      files.push({
        name: item.name,
        path: relativePath,
        type: 'file'
      });
    }
  }

  return files.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'directory' ? -1 : 1;
  });
}

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.json': 'json',
    '.md': 'markdown',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.sh': 'shell',
    '.bash': 'shell',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'cpp',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.php': 'php',
    '.rb': 'ruby',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.sql': 'sql'
  };
  return languageMap[ext] || 'plaintext';
}

// IPC Handlers
ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    const resolvedPath = resolveInCurrentProject(filePath);
    // Check if file is an image
    const ext = path.extname(resolvedPath).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext);

    if (isImage && ext !== '.svg') {
      // Read binary images as base64
      const buffer = await fs.readFile(resolvedPath);
      const content = buffer.toString('base64');
      return { success: true, content, language: 'image', isBase64: true };
    } else {
      // Read text files as utf-8
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const language = detectLanguage(resolvedPath);
      return { success: true, content, language, isBase64: false };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Read file line ranges efficiently (streaming) to avoid loading huge files into memory.
// Mirrors Cursor-style safety: hard cap at 5MB, and supports start/end line + max lines.
ipcMain.handle('read-file-lines', async (_event, filePath, options = {}) => {
  let stream = null;
  let rl = null;
  try {
    const resolvedPath = resolveInCurrentProject(filePath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext);

    // Range reading does not apply to binary images. (SVG is text, but treat it as text.)
    if (isImage && ext !== '.svg') {
      return { success: false, error: 'read-file-lines does not support binary image files' };
    }

    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      return { success: false, error: 'Path is not a file' };
    }

    // Cursor-style hard cap (lTc = 5e6)
    const hardMaxBytes = Number.isFinite(Number(options.hardMaxBytes))
      ? Number(options.hardMaxBytes)
      : 5_000_000;
    if (stats.size > hardMaxBytes) {
      return {
        success: false,
        error: `File too large to read (${stats.size} bytes > ${hardMaxBytes} bytes)`,
        size: stats.size,
        limitBytes: hardMaxBytes
      };
    }

    const startLineRaw = Number.isFinite(Number(options.start_line))
      ? Number(options.start_line)
      : (Number.isFinite(Number(options.startLine)) ? Number(options.startLine) : 1);

    const endLineRaw = Number.isFinite(Number(options.end_line))
      ? Number(options.end_line)
      : (Number.isFinite(Number(options.endLine)) ? Number(options.endLine) : null);

    const maxLinesRaw = Number.isFinite(Number(options.max_lines))
      ? Number(options.max_lines)
      : (Number.isFinite(Number(options.maxLines)) ? Number(options.maxLines) : null);

    const computeTotalLines = options.computeTotalLines === true;

    const startLine = Math.max(1, Math.floor(startLineRaw || 1));
    let endLine = endLineRaw == null ? null : Math.max(startLine, Math.floor(endLineRaw));
    const maxLines = maxLinesRaw == null ? null : Math.max(1, Math.floor(maxLinesRaw));

    // If caller provided maxLines, enforce it even if endLine is huge/omitted.
    if (maxLines != null) {
      const impliedEnd = startLine + maxLines - 1;
      endLine = endLine == null ? impliedEnd : Math.min(endLine, impliedEnd);
    }

    // Stream the file line-by-line to avoid loading full contents.
    stream = fsSync.createReadStream(resolvedPath, { encoding: 'utf8' });
    rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const lines = [];
    let lineNo = 0;
    let stored = 0;
    let truncated = false;

    for await (const line of rl) {
      lineNo += 1;

      if (lineNo < startLine) continue;

      // If we've passed requested endLine, we can stop early unless caller wants total line count.
      if (endLine != null && lineNo > endLine) {
        if (!computeTotalLines) break;
        continue;
      }

      if (maxLines != null && stored >= maxLines) {
        truncated = true;
        if (!computeTotalLines) break;
        continue;
      }

      lines.push(line);
      stored += 1;
    }

    const totalLines = computeTotalLines ? lineNo : null;
    const displayedStart = startLine;
    const displayedEnd = startLine + lines.length - 1;

    return {
      success: true,
      content: lines.join('\n'),
      startLine: displayedStart,
      endLine: displayedEnd,
      totalLines,
      truncated,
      size: stats.size
    };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    try { rl?.close(); } catch (_e) { /* ignore */ }
    try { stream?.destroy?.(); } catch (_e) { /* ignore */ }
  }
});

ipcMain.handle('write-file', async (_event, filePath, content, isBase64 = false) => {
  try {
    const resolvedPath = resolveInCurrentProject(filePath);
    if (isBase64) {
      // Write binary data from base64
      const buffer = Buffer.from(content, 'base64');
      await fs.writeFile(resolvedPath, buffer);
    } else {
      // Write text file
      await fs.writeFile(resolvedPath, content, 'utf-8');
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-directory', async (_event, dirPath) => {
  try {
    const resolvedDir = resolveInCurrentProject(dirPath);
    const files = await readDirectory(resolvedDir, resolvedDir);
    return { success: true, files };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Agent-safe shallow directory listing (prevents huge tool payloads)
ipcMain.handle('list-directory', async (_event, dirPath, options = {}) => {
  try {
    const resolvedDir = resolveInCurrentProject(dirPath);
    const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : 2;
    const files = await readDirectoryLimited(resolvedDir, resolvedDir, maxDepth, 0);
    return { success: true, files, maxDepth };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Open project by path (used by recent projects)
ipcMain.handle('open-project-by-path', async (_event, projectPath) => {
  try {
    // CRITICAL: Set currentProject when opening from recent projects
    currentProject = projectPath;
    console.log('[Electron] Project opened by path:', projectPath);
    console.log('[Electron] currentProject set to:', currentProject);
    try { await ensureWorkspaceGitRepo(currentProject); } catch (e) {
      console.warn('[Git] Failed to auto-init git repo for opened folder:', e?.message || String(e));
    }
    startWorkspaceWatcher(currentProject);
    // AET: load + reconcile immediately on project open so stale "running" runs are fixed after relaunch.
    try { await _aetEnsureLoaded(currentProject); } catch { /* ignore */ }
    
    const files = await readDirectory(projectPath);
    return { success: true, path: projectPath, files };
  } catch (error) {
    // Don't set currentProject if failed to open
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-file-stats', async (_event, filePath) => {
  try {
    const resolvedPath = resolveInCurrentProject(filePath);
    const stats = await fs.stat(resolvedPath);
    return {
      success: true,
      stats: {
        size: stats.size,
        modified: stats.mtime,
        created: stats.birthtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile()
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get App Path
ipcMain.handle('get-app-path', () => {
  return app.getAppPath();
});

// Get currently opened project folder (used by renderer to reliably persist MCP config)
ipcMain.handle('get-current-project', () => {
  try {
    return { success: true, projectPath: currentProject || null };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Get user home directory (used for ~/.claude user-level agents/skills)
ipcMain.handle('get-user-home', () => {
  try {
    return { success: true, home: os.homedir() };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

function userClaudeBaseDir() {
  return path.join(os.homedir(), '.claude');
}

function resolveInUserClaude(subpath) {
  const base = fsSync.realpathSync.native ? fsSync.realpathSync.native(userClaudeBaseDir()) : fsSync.realpathSync(userClaudeBaseDir());
  const raw = String(subpath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(base, raw);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (resolved !== base && !resolved.startsWith(prefix)) {
    throw new Error('Access outside ~/.claude is not allowed.');
  }
  return resolved;
}

async function listUserClaudeDir(relDir, { maxDepth = 6 } = {}) {
  const abs = resolveInUserClaude(relDir);
  const walk = async (dirAbs, baseAbs, depth) => {
    const out = [];
    let items = [];
    try {
      items = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const item of items.slice(0, 200)) {
      const name = item.name;
      if (!name) continue;
      // Skip dot-files EXCEPT .claude-plugin (needed for plugin manifests)
      if (name.startsWith('.') && name !== '.claude-plugin') continue;
      const full = path.join(dirAbs, name);
      const rel = path.relative(baseAbs, full).replace(/\\/g, '/');
      if (item.isDirectory()) {
        const children = depth < maxDepth ? await walk(full, baseAbs, depth + 1) : [];
        out.push({ name, path: rel, type: 'directory', children });
      } else {
        out.push({ name, path: rel, type: 'file' });
      }
    }
    return out.sort((a, b) => {
      if (a.type === b.type) return String(a.name).localeCompare(String(b.name));
      return a.type === 'directory' ? -1 : 1;
    });
  };
  return await walk(abs, abs, 0);
}

function isBinaryImageExt(ext) {
  const e = String(ext || '').toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp'].includes(e);
}

ipcMain.handle('user-claude-list-agents', async () => {
  try {
    const files = await listUserClaudeDir('agents', { maxDepth: 4 });
    return { success: true, files };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-read-agent', async (_event, relPath) => {
  try {
    const rp = String(relPath || '').trim();
    if (!rp) return { success: false, error: 'Missing relPath' };
    const abs = resolveInUserClaude(path.join('agents', rp));
    const content = await fs.readFile(abs, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-list-skills', async () => {
  try {
    const files = await listUserClaudeDir('skills', { maxDepth: 8 });
    return { success: true, files };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Claude Code Plugins (user-level): ~/.claude/plugins/**/.claude-plugin/plugin.json
ipcMain.handle('user-claude-list-plugins', async () => {
  try {
    console.log('[Plugins IPC] user-claude-list-plugins called');
    const files = await listUserClaudeDir('plugins', { maxDepth: 8 });
    console.log('[Plugins IPC] listUserClaudeDir returned:', JSON.stringify(files, null, 2));
    return { success: true, files };
  } catch (error) {
    console.error('[Plugins IPC] Error:', error);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-read-plugin-manifest', async (_event, payload = {}) => {
  try {
    const rel = typeof payload.rel === 'string' ? payload.rel.trim().replace(/\\/g, '/') : '';
    if (!rel) return { success: false, error: 'Missing rel' };
    // Accept either:
    // - "<pluginDir>" (we append ".claude-plugin/plugin.json")
    // - "<pluginDir>/.claude-plugin/plugin.json"
    const manifestRel = rel.endsWith('.claude-plugin/plugin.json')
      ? rel
      : `${rel.replace(/\/+$/, '')}/.claude-plugin/plugin.json`;
    const abs = resolveInUserClaude(path.join('plugins', manifestRel));
    const content = await fs.readFile(abs, 'utf-8');
    let parsed = null;
    try { parsed = JSON.parse(content); } catch { parsed = null; }
    return { success: true, content, parsed, path: abs };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-read-settings-json', async () => {
  try {
    const abs = resolveInUserClaude('settings.json');
    try {
      const content = await fs.readFile(abs, 'utf-8');
      let parsed = null;
      try { parsed = JSON.parse(content); } catch { parsed = null; }
      return { success: true, content, parsed, path: abs, exists: true };
    } catch {
      return { success: true, content: '', parsed: null, path: abs, exists: false };
    }
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

function _userClaudeMarketplacesConfigPath() {
  return resolveInUserClaude('codeon-marketplaces.json');
}

ipcMain.handle('user-claude-marketplaces-get', async () => {
  try {
    const abs = _userClaudeMarketplacesConfigPath();
    try {
      const content = await fs.readFile(abs, 'utf-8');
      let parsed = null;
      try { parsed = JSON.parse(content); } catch { parsed = null; }
      return { success: true, content, parsed, path: abs, exists: true };
    } catch {
      return { success: true, content: '', parsed: null, path: abs, exists: false };
    }
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-marketplaces-set', async (_event, payload = {}) => {
  try {
    const abs = _userClaudeMarketplacesConfigPath();
    const dir = path.dirname(abs);
    await fs.mkdir(dir, { recursive: true });
    const content =
      typeof payload.content === 'string'
        ? payload.content
        : (payload && typeof payload.obj === 'object' && payload.obj)
          ? JSON.stringify(payload.obj, null, 2) + '\n'
          : JSON.stringify({ sources: [] }, null, 2) + '\n';
    try { JSON.parse(String(content || '')); } catch (e) {
      return { success: false, error: `Invalid JSON: ${e?.message || String(e)}` };
    }
    await fs.writeFile(abs, String(content || ''), 'utf-8');
    return { success: true, path: abs };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

function _sanitizeMarketplaceCacheDir(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const cleaned = s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.slice(0, 120);
}

async function _gitCloneOrPullRepo({ repoUrl, destAbs, ref = '' } = {}) {
  const url = String(repoUrl || '').trim();
  const dst = String(destAbs || '').trim();
  if (!url || !dst) throw new Error('Missing repoUrl or destAbs');

  // If exists, try pull; else clone.
  let exists = false;
  try {
    const st = await fs.stat(dst);
    exists = !!st && st.isDirectory();
  } catch { exists = false; }

  if (exists) {
    // Ensure it's a git repo
    try { await fs.access(path.join(dst, '.git')); } catch {
      throw new Error(`Marketplace cache exists but is not a git repo: ${dst}`);
    }
    // IMPORTANT: Cache dirs can accumulate stray/untracked files (e.g. from older builds).
    // A normal pull can fail with "untracked working tree files would be overwritten".
    // Since this is a cache, it's safe to reset + clean before updating.
    try {
      await execFileAsync('git', ['reset', '--hard'], { cwd: dst, timeout: 180_000, maxBuffer: 1024 * 1024 * 10 });
      await execFileAsync('git', ['clean', '-fd'], { cwd: dst, timeout: 180_000, maxBuffer: 1024 * 1024 * 10 });
    } catch { /* ignore */ }
    // Best-effort: checkout ref first if provided.
    if (ref) {
      await execFileAsync('git', ['fetch', '--all', '--prune'], { cwd: dst, timeout: 180_000, maxBuffer: 1024 * 1024 * 10 });
      await execFileAsync('git', ['checkout', ref], { cwd: dst, timeout: 180_000, maxBuffer: 1024 * 1024 * 10 });
    }
    try {
      await execFileAsync('git', ['pull', '--ff-only'], { cwd: dst, timeout: 180_000, maxBuffer: 1024 * 1024 * 10 });
    } catch (e) {
      // If pull fails due to local state, wipe and re-clone to recover.
      try { await fs.rm(dst, { recursive: true, force: true }); } catch { /* ignore */ }
      await fs.mkdir(path.dirname(dst), { recursive: true });
      const args = ['clone', '--depth', '1'];
      if (ref) args.push('--branch', ref);
      args.push(url, dst);
      await execFileAsync('git', args, { cwd: os.homedir(), timeout: 180_000, maxBuffer: 1024 * 1024 * 10 });
      return { updated: false, cloned: true, recovered: true, error: e?.message || String(e) };
    }
    return { updated: true, cloned: false };
  }

  // Ensure parent exists
  await fs.mkdir(path.dirname(dst), { recursive: true });
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(url, dst);
  await execFileAsync('git', args, { cwd: os.homedir(), timeout: 180_000, maxBuffer: 1024 * 1024 * 10 });
  return { updated: false, cloned: true };
}

ipcMain.handle('user-claude-marketplace-sync', async (_event, payload = {}) => {
  try {
    const src = payload && typeof payload === 'object' ? payload.source : null;
    if (!src || typeof src !== 'object') return { success: false, error: 'Missing source' };
    const kind = String(src.source || '').trim();
    const repo = String(src.repo || '').trim();
    const url = String(src.url || '').trim();
    const ref = String(src.ref || '').trim();
    const relPath = String(src.path || '').trim() || '.claude-plugin/marketplace.json';

    if (kind !== 'github' && kind !== 'git') {
      return { success: false, error: `Unsupported marketplace source: ${kind}` };
    }
    const repoUrl = kind === 'github'
      ? `https://github.com/${repo}.git`
      : url;
    if (!repoUrl || (kind === 'github' && !repo)) return { success: false, error: 'Invalid marketplace repo' };

    const cacheBase = resolveInUserClaude('codeon-marketplace-cache');
    const dirName = _sanitizeMarketplaceCacheDir(kind === 'github' ? repo.replace('/', '-') : (repoUrl.split('/').filter(Boolean).pop() || 'marketplace'));
    if (!dirName) return { success: false, error: 'Invalid cache directory name' };
    const destAbs = path.join(cacheBase, dirName);

    const startedAt = Date.now();
    let cloneInfo = null;
    cloneInfo = await _gitCloneOrPullRepo({ repoUrl, destAbs, ref: ref || '' });

    const marketplaceAbs = path.join(destAbs, relPath.replace(/\\/g, '/'));
    const content = await fs.readFile(marketplaceAbs, 'utf-8');
    let parsed = null;
    try { parsed = JSON.parse(content); } catch (e) {
      return { success: false, error: `Invalid marketplace JSON: ${e?.message || String(e)}`, path: marketplaceAbs };
    }
    const elapsedMs = Date.now() - startedAt;
    return { success: true, parsed, content, path: marketplaceAbs, cacheDir: destAbs, cacheKey: dirName, cloneInfo, elapsedMs };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-write-settings-json', async (_event, payload = {}) => {
  try {
    const abs = resolveInUserClaude('settings.json');
    const dir = path.dirname(abs);
    await fs.mkdir(dir, { recursive: true });
    const content =
      typeof payload.content === 'string'
        ? payload.content
        : (payload && typeof payload.obj === 'object' && payload.obj)
          ? JSON.stringify(payload.obj, null, 2) + '\n'
          : '{}\n';
    // Ensure valid JSON if caller provided raw string.
    try { JSON.parse(String(content || '')); } catch (e) {
      return { success: false, error: `Invalid JSON: ${e?.message || String(e)}` };
    }
    await fs.writeFile(abs, String(content || ''), 'utf-8');
    return { success: true, path: abs };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

function _sanitizePluginDirName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  // Keep it simple: allow a-zA-Z0-9 . _ -
  const cleaned = s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.slice(0, 80);
}

ipcMain.handle('user-claude-plugin-install-git', async (_event, payload = {}) => {
  try {
    const repoUrl = typeof payload.repoUrl === 'string' ? payload.repoUrl.trim() : '';
    if (!repoUrl) return { success: false, error: 'Missing repoUrl' };
    const dirNameRaw = typeof payload.dirName === 'string' ? payload.dirName.trim() : '';
    const dirName = _sanitizePluginDirName(dirNameRaw || repoUrl.split('/').filter(Boolean).pop() || 'plugin');
    if (!dirName) return { success: false, error: 'Invalid dirName' };

    const pluginsAbs = resolveInUserClaude('plugins');
    await fs.mkdir(pluginsAbs, { recursive: true });
    const destAbs = resolveInUserClaude(path.join('plugins', dirName));

    // Refuse to overwrite an existing directory.
    try {
      const st = await fs.stat(destAbs);
      if (st && (st.isDirectory() || st.isFile())) {
        return { success: false, error: `Destination already exists: ${destAbs}` };
      }
    } catch { /* doesn't exist */ }

    const startedAt = Date.now();
    const { stdout, stderr } = await execFileAsync('git', ['clone', '--depth', '1', repoUrl, destAbs], {
      cwd: os.homedir(),
      timeout: 180_000,
      maxBuffer: 1024 * 1024 * 10
    });
    const elapsedMs = Date.now() - startedAt;

    // Best-effort: verify plugin manifest exists
    const manifestAbs = path.join(destAbs, '.claude-plugin', 'plugin.json');
    try {
      await fs.access(manifestAbs);
    } catch {
      // Keep the clone, but report as warning
      return {
        success: false,
        error: `Cloned, but plugin manifest not found at ${manifestAbs}. Is this a valid Claude Code plugin repo?`,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        dirName,
        destAbs,
        elapsedMs
      };
    }

    return {
      success: true,
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      dirName,
      destAbs,
      manifestAbs,
      elapsedMs
    };
  } catch (error) {
    const output = (error && (error.stdout || '')) + (error && (error.stderr || '')) + (error && (error.message || ''));
    return { success: false, error: error?.message || String(error), output };
  }
});

ipcMain.handle('user-claude-plugin-install-from-dir', async (_event, payload = {}) => {
  try {
    const srcAbsRaw = typeof payload.srcAbs === 'string' ? payload.srcAbs.trim() : '';
    if (!srcAbsRaw) return { success: false, error: 'Missing srcAbs' };
    const dirNameRaw = typeof payload.dirName === 'string' ? payload.dirName.trim() : '';
    const dirName = _sanitizePluginDirName(dirNameRaw || 'plugin');
    if (!dirName) return { success: false, error: 'Invalid dirName' };

    // Restrict source to ~/.claude (and specifically our cache folder) for safety.
    const base = fsSync.realpathSync.native ? fsSync.realpathSync.native(userClaudeBaseDir()) : fsSync.realpathSync(userClaudeBaseDir());
    const cacheBase = resolveInUserClaude('codeon-marketplace-cache');
    const srcAbs = path.resolve(srcAbsRaw);
    const basePrefix = base.endsWith(path.sep) ? base : base + path.sep;
    const cachePrefix = cacheBase.endsWith(path.sep) ? cacheBase : cacheBase + path.sep;
    if (!srcAbs.startsWith(basePrefix) || !srcAbs.startsWith(cachePrefix)) {
      return { success: false, error: 'Source must be inside ~/.claude/codeon-marketplace-cache' };
    }

    // Destination: ~/.claude/plugins/<dirName>
    const destAbs = resolveInUserClaude(path.join('plugins', dirName));

    // Refuse to overwrite existing destination.
    try {
      const st = await fs.stat(destAbs);
      if (st && (st.isDirectory() || st.isFile())) {
        return { success: false, error: `Destination already exists: ${destAbs}` };
      }
    } catch { /* doesn't exist */ }

    // Ensure manifest exists in source
    const manifestAbs = path.join(srcAbs, '.claude-plugin', 'plugin.json');
    try { await fs.access(manifestAbs); } catch {
      return { success: false, error: `Plugin manifest not found at ${manifestAbs}` };
    }

    // Copy directory recursively (this is user-owned state; exclude .git if present).
    try {
      if (typeof fsSync.cpSync === 'function') {
        fsSync.cpSync(srcAbs, destAbs, {
          recursive: true,
          dereference: true,
          filter: (src) => {
            try {
              const p = String(src || '').replace(/\\/g, '/');
              if (p.includes('/.git/')) return false;
            } catch { /* ignore */ }
            return true;
          }
        });
      } else if (typeof fs.cp === 'function') {
        await fs.cp(srcAbs, destAbs, { recursive: true, dereference: true });
      } else {
        return { success: false, error: 'Recursive copy is not supported in this Node runtime.' };
      }
    } catch (e) {
      // Best-effort cleanup
      try { await fs.rm(destAbs, { recursive: true, force: true }); } catch { /* ignore */ }
      return { success: false, error: e?.message || String(e) };
    }

    return { success: true, destAbs, manifestAbs: path.join(destAbs, '.claude-plugin', 'plugin.json') };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-plugin-uninstall', async (_event, payload = {}) => {
  try {
    const rel = typeof payload.rel === 'string' ? payload.rel.trim().replace(/\\/g, '/') : '';
    if (!rel) return { success: false, error: 'Missing rel' };
    const abs = resolveInUserClaude(path.join('plugins', rel));
    const st = await fs.stat(abs);
    if (st.isDirectory()) await fs.rm(abs, { recursive: true, force: true });
    else await fs.unlink(abs);
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Read any file from within ~/.claude (or ~/.claude/codeon-marketplace-cache)
// Used by Plugins UI to read README.md files from marketplace cache or installed plugins
ipcMain.handle('user-claude-read-abs-file', async (_event, absPath) => {
  try {
    const p = String(absPath || '').trim();
    if (!p) return { success: false, error: 'Missing path' };
    
    // Security: only allow reading from within ~/.claude directory
    const base = fsSync.realpathSync.native 
      ? fsSync.realpathSync.native(userClaudeBaseDir()) 
      : fsSync.realpathSync(userClaudeBaseDir());
    const basePrefix = base.endsWith(path.sep) ? base : base + path.sep;
    
    // Resolve the path (handles symlinks etc)
    let resolved;
    try {
      resolved = path.resolve(p);
    } catch {
      return { success: false, error: 'Invalid path' };
    }
    
    // Check the path is within ~/.claude
    if (!resolved.startsWith(basePrefix) && resolved !== base) {
      return { success: false, error: 'Access restricted to ~/.claude' };
    }
    
    const content = await fs.readFile(resolved, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-read-skill-md', async (_event, relSkillMdPath) => {
  try {
    const rp = String(relSkillMdPath || '').trim().replace(/\\/g, '/');
    if (!rp) return { success: false, error: 'Missing relSkillMdPath' };
    // Expect something like "<skillDir>/SKILL.md" (canonical per Claude Code docs),
    // but keep compatibility with legacy "<skillDir>/Skill.md".
    const abs = resolveInUserClaude(path.join('skills', rp));
    const content = await fs.readFile(abs, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-read-file', async (_event, payload = {}) => {
  try {
    const area = String(payload.area || '').trim(); // 'agents' | 'skills'
    if (area !== 'agents' && area !== 'skills') return { success: false, error: 'Invalid area' };
    const relPath = String(payload.relPath || '').trim().replace(/\\/g, '/');
    if (!relPath) return { success: false, error: 'Missing relPath' };
    const abs = resolveInUserClaude(path.join(area, relPath));
    const ext = path.extname(abs).toLowerCase();
    const isImage = isBinaryImageExt(ext);
    if (isImage) {
      const buf = await fs.readFile(abs);
      return { success: true, content: buf.toString('base64'), isBase64: true };
    }
    const content = await fs.readFile(abs, 'utf-8');
    return { success: true, content, isBase64: false };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-write-file', async (_event, payload = {}) => {
  try {
    const area = String(payload.area || '').trim(); // 'agents' | 'skills'
    if (area !== 'agents' && area !== 'skills') return { success: false, error: 'Invalid area' };
    const relPath = String(payload.relPath || '').trim().replace(/\\/g, '/');
    if (!relPath) return { success: false, error: 'Missing relPath' };
    const abs = resolveInUserClaude(path.join(area, relPath));
    const dir = path.dirname(abs);
    await fs.mkdir(dir, { recursive: true });
    const isBase64 = payload.isBase64 === true;
    const content = payload.content;
    if (isBase64) {
      const buf = Buffer.from(String(content || ''), 'base64');
      await fs.writeFile(abs, buf);
    } else {
      await fs.writeFile(abs, String(content || ''), 'utf-8');
    }
    return { success: true, path: abs };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('user-claude-delete-file', async (_event, payload = {}) => {
  try {
    const area = String(payload.area || '').trim(); // 'agents' | 'skills'
    if (area !== 'agents' && area !== 'skills') return { success: false, error: 'Invalid area' };
    const relPath = String(payload.relPath || '').trim().replace(/\\/g, '/');
    if (!relPath) return { success: false, error: 'Missing relPath' };
    const abs = resolveInUserClaude(path.join(area, relPath));
    const stats = await fs.stat(abs);
    if (stats.isDirectory()) {
      await fs.rm(abs, { recursive: true, force: true });
    } else {
      await fs.unlink(abs);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    // Allow creating a new folder directly from the native dialog (shows "New Folder" on macOS).
    properties: ['openDirectory', 'createDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    currentProject = folderPath; // CRITICAL: Set currentProject here!
    console.log('[Electron] Folder opened via IPC:', folderPath);
    console.log('[Electron] currentProject set to:', currentProject);
    try { await ensureWorkspaceGitRepo(currentProject); } catch (e) {
      console.warn('[Git] Failed to auto-init git repo for opened folder:', e?.message || String(e));
    }
    startWorkspaceWatcher(currentProject);
    // AET: load + reconcile immediately on project open so stale "running" runs are fixed after relaunch.
    try { await _aetEnsureLoaded(currentProject); } catch { /* ignore */ }
    const files = await readDirectory(folderPath);
    return { success: true, path: folderPath, files };
  }
  return { success: false };
});

// Open an external URL in the user's default browser
ipcMain.handle('open-external', async (_event, url) => {
  try {
    const u = String(url || '').trim();
    if (!u) return { success: false, error: 'Missing url' };
    if (!/^https?:\/\//i.test(u)) return { success: false, error: 'Invalid URL (only http/https allowed)' };
    await shell.openExternal(u);
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Open a local file/folder in the OS default handler (project-scoped)
ipcMain.handle('open-path', async (_event, filePath) => {
  try {
    const p = String(filePath || '').trim();
    if (!p) return { success: false, error: 'Missing path' };

    const abs = resolveInCurrentProject(p);
    // Best-effort: if path doesn't exist, report error rather than letting the OS decide.
    try {
      await fs.stat(abs);
    } catch {
      return { success: false, error: 'Path does not exist' };
    }

    const errMsg = await shell.openPath(abs);
    if (errMsg) return { success: false, error: errMsg };
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Bring Codeon to the foreground (used after Claude auth completes).
ipcMain.handle('focus-main-window', async () => {
  try {
    focusMainWindowBestEffort();
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Open system Terminal to run Claude Code subscription auth flow.
// This runs Claude Code's official `setup-token` command which handles:
// - Opening the browser for OAuth
// - Storing credentials in the OS-native credential store (Keychain on macOS, etc.)
// After auth completes, Codeon will detect credentials via the cross-platform reader (Keychain/file).
// IMPORTANT: We use the native Claude binary (not the SDK CLI) because only the native binary has setup-token.
ipcMain.handle('open-claude-setup-token-terminal', async () => {
  try {
    // Dedupe: prevent double opens (e.g., duplicate click handlers or double IPC invokes).
    const now = Date.now();
    if (claudeSetupTokenTerminalInFlight || (now - claudeSetupTokenTerminalLastAt) < 1500) {
      return { success: true, deduped: true };
    }
    claudeSetupTokenTerminalInFlight = true;
    claudeSetupTokenTerminalLastAt = now;

    const projectRoot = currentProject || process.cwd();
    
    // Find the native Claude CLI binary (NOT the SDK CLI - the SDK doesn't have setup-token)
    // The native binary is bundled with our app in resources/claude-cli/
    let claudeBinary = null;
    
    // Determine platform-specific binary name
    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
    
    // Map process.platform to electron-builder's folder naming convention
    // electron-builder uses 'mac' for macOS, 'win' for Windows, 'linux' for Linux
    const platformMap = { darwin: 'mac', win32: 'win', linux: 'linux' };
    const ebPlatform = platformMap[process.platform] || process.platform;
    
    // Try multiple locations for the native binary
    const possibleBinaryPaths = [
      // Production build: binary is in app's resources directory
      // process.resourcesPath points to Resources/ in the app bundle
      path.join(process.resourcesPath || '', 'claude-cli', binaryName),
      // Dev mode: binary in project's resources directory (electron-builder naming)
      path.join(APP_ROOT, 'resources', 'claude-cli', `${ebPlatform}-${process.arch}`, binaryName),
      // Dev mode fallback: look in the Claude Code extension bundle
      path.join(APP_ROOT, 'anthropic.claude-code-2.0.75-darwin-arm64', 'resources', 'native-binary', 'claude'),
      // Alternative dev paths - find any claude-code extension directory
      ...(() => {
        try {
          const appRoot = APP_ROOT;
          const dirs = fsSync.readdirSync(appRoot);
          return dirs
            .filter(d => d.startsWith('anthropic.claude-code'))
            .map(d => path.join(appRoot, d, 'resources', 'native-binary', binaryName));
        } catch { return []; }
      })(),
      // System-installed claude (fallback)
      process.platform === 'win32' ? null : '/usr/local/bin/claude',
      path.join(os.homedir(), '.claude', 'local', binaryName),
    ].filter(Boolean);
    
    for (const binPath of possibleBinaryPaths) {
      try {
        if (binPath && fsSync.existsSync(binPath)) {
          // Verify it's executable
          fsSync.accessSync(binPath, fsSync.constants.X_OK);
          claudeBinary = binPath;
          log.info(`[Claude Auth] Found native Claude binary at: ${binPath}`);
          break;
        }
      } catch {
        // continue trying other paths
      }
    }
    
    if (!claudeBinary) {
      log.error('[Claude Auth] Native Claude binary not found in any expected location');
      return { 
        success: false, 
        error: 'Claude Code CLI not found. Please install Claude Code from code.claude.com' 
      };
    }

    log.info('[Claude Auth] Starting setup-token flow with native binary');

    if (process.platform === 'darwin') {
      // macOS: Open Terminal.app and run setup-token with the native binary
      // The native binary stores credentials in macOS Keychain
      const tempScriptPath = path.join(os.tmpdir(), `codeon-auth-${Date.now()}.sh`);
      const shellScript = `#!/bin/bash
cd "${projectRoot}"
echo ""
echo "Starting Claude Code authentication..."
echo "The browser will open for you to sign in."
echo "After completing authentication, credentials will be saved to your Keychain."
echo ""
"${claudeBinary}" setup-token
echo ""
echo "Authentication complete! You can close this window and return to Codeon."
echo "Codeon will automatically detect your credentials from Keychain."
echo ""
read -p "Press Enter to close..."
rm -f "${tempScriptPath}"
`;
      await fs.writeFile(tempScriptPath, shellScript, { mode: 0o755 });
      
      const osa = `
set scriptPath to ${JSON.stringify(tempScriptPath)}
tell application "Terminal"
  do script scriptPath
end tell
`;
      await execFileAsync('osascript', ['-e', osa]);
      return { success: true };
    }

    if (process.platform === 'win32') {
      // Windows: Open PowerShell and run setup-token
      // Note: Windows binary path would be different - this is a placeholder
      const tempScriptPath = path.join(os.tmpdir(), `codeon-auth-${Date.now()}.ps1`);
      const claudeBinaryWin = claudeBinary.replace(/\//g, '\\');
      const psScript = `
Write-Host ""
Write-Host "Starting Claude Code authentication..." -ForegroundColor Cyan
Write-Host "The browser will open for you to sign in." -ForegroundColor Yellow
Write-Host "After completing authentication, credentials will be saved automatically." -ForegroundColor Yellow
Write-Host ""

Set-Location "${projectRoot.replace(/\\/g, '\\\\')}"
& "${claudeBinaryWin}" setup-token

Write-Host ""
Write-Host "Authentication complete! You can close this window and return to Codeon." -ForegroundColor Green
Write-Host "Codeon will automatically detect your credentials." -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close..."
Remove-Item -Path "${tempScriptPath.replace(/\\/g, '\\\\')}" -ErrorAction SilentlyContinue
`;
      await fs.writeFile(tempScriptPath, psScript, { encoding: 'utf8' });
      
      const { spawn } = require('child_process');
      spawn('powershell.exe', [
        '-ExecutionPolicy', 'Bypass',
        '-NoExit',
        '-File', tempScriptPath
      ], {
        detached: true,
        stdio: 'ignore',
        shell: true
      }).unref();
      
      return { success: true };
    }

    if (process.platform === 'linux') {
      // Linux: Try common terminal emulators
      const tempScriptPath = path.join(os.tmpdir(), `codeon-auth-${Date.now()}.sh`);
      const bashScript = `#!/bin/bash
echo ""
echo -e "\\033[36mStarting Claude Code authentication...\\033[0m"
echo -e "\\033[33mThe browser will open for you to sign in.\\033[0m"
echo -e "\\033[33mAfter completing authentication, credentials will be saved automatically.\\033[0m"
echo ""

cd "${projectRoot}"
"${claudeBinary}" setup-token

echo ""
echo -e "\\033[32mAuthentication complete! You can close this window and return to Codeon.\\033[0m"
echo -e "\\033[32mCodeon will automatically detect your credentials.\\033[0m"
echo ""
read -p "Press Enter to close..."
rm -f "${tempScriptPath}"
`;
      await fs.writeFile(tempScriptPath, bashScript, { mode: 0o755 });
      
      const { spawn, execSync } = require('child_process');
      const terminals = [
        { cmd: 'gnome-terminal', args: ['--', 'bash', tempScriptPath] },
        { cmd: 'konsole', args: ['-e', 'bash', tempScriptPath] },
        { cmd: 'xfce4-terminal', args: ['-e', `bash ${tempScriptPath}`] },
        { cmd: 'mate-terminal', args: ['-e', `bash ${tempScriptPath}`] },
        { cmd: 'terminator', args: ['-e', `bash ${tempScriptPath}`] },
        { cmd: 'tilix', args: ['-e', `bash ${tempScriptPath}`] },
        { cmd: 'xterm', args: ['-e', 'bash', tempScriptPath] },
      ];
      
      let launched = false;
      for (const term of terminals) {
        try {
          execSync(`which ${term.cmd}`, { stdio: 'ignore' });
          spawn(term.cmd, term.args, { detached: true, stdio: 'ignore' }).unref();
          launched = true;
          break;
        } catch {
          continue;
        }
      }
      
      if (launched) {
        return { success: true };
      }
      
      await shell.openExternal('https://code.claude.com/docs/en/quickstart');
      return { 
        success: true, 
        message: 'No supported terminal found. Run `claude setup-token` manually in your terminal.' 
      };
    }

    // Fallback for unknown platforms
    await shell.openExternal('https://code.claude.com/docs/en/quickstart');
    return { success: true, message: 'Opened Claude Code docs. Run `claude setup-token` in your terminal.' };
  } catch (error) {
    log.error('[Claude Auth] setup-token error:', error);
    return { success: false, error: error?.message || String(error) };
  } finally {
    claudeSetupTokenTerminalInFlight = false;
  }
});

// Save Claude OAuth token to credentials file (manual fallback)
// This is only used if the user has an existing token they want to paste manually.
// The primary auth flow uses setup-token which stores credentials in the OS native store.
ipcMain.handle('claude-save-oauth-token', async (_event, payload = {}) => {
  try {
    const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
    if (!token) {
      return { success: false, error: 'No token provided' };
    }
    // Validate token format (should start with sk-ant-oat01-)
    if (!token.startsWith('sk-ant-oat01-')) {
      return { success: false, error: 'Invalid token format. Expected sk-ant-oat01-...' };
    }
    
    const claudeDir = path.join(os.homedir(), '.claude');
    const credentialsPath = path.join(claudeDir, '.credentials.json');
    
    // Ensure directory exists
    await fs.mkdir(claudeDir, { recursive: true });
    
    // Write credentials in the format expected by Claude SDK
    const credentials = {
      claudeAiOauth: {
        accessToken: token,
        refreshToken: null,
        expiresAt: null,
        scopes: ['user:inference'],
        subscriptionType: null,
        rateLimitTier: null
      }
    };
    
    await fs.writeFile(credentialsPath, JSON.stringify(credentials), { encoding: 'utf8', mode: 0o600 });
    log.info('[Claude Auth] OAuth token saved to credentials file');
    return { success: true };
  } catch (error) {
    log.error('[Claude Auth] Failed to save OAuth token:', error);
    return { success: false, error: error?.message || String(error) };
  }
});

// Check if Claude OAuth credentials exist (supports Keychain on macOS + file fallback)
ipcMain.handle('claude-check-credentials', async () => {
  log.info('[Claude Credentials] IPC handler called - checking credentials...');
  try {
    // Use the cross-platform credential reader with auto-sync to file
    // This ensures SDK compatibility by syncing Keychain creds to file
    const result = await readClaudeCredentials({ syncToFile: true });
    
    log.info(`[Claude Credentials] readClaudeCredentials returned: ${result ? JSON.stringify({ source: result.source, hasToken: !!result.credentials?.claudeAiOauth?.accessToken }) : 'null'}`);
    
    if (result && result.credentials?.claudeAiOauth?.accessToken) {
      const token = result.credentials.claudeAiOauth.accessToken;
      log.info(`[Claude Credentials] ✓ Found credentials from ${result.source}`);
      return { 
        success: true, 
        hasCredentials: true,
        source: result.source,
        tokenPreview: token.slice(0, 20) + '...' // For debugging
      };
    }
    
    log.info('[Claude Credentials] No credentials found');
    return { success: true, hasCredentials: false };
  } catch (error) {
    log.error('[Claude Credentials] Error checking credentials:', error);
    return { success: false, error: error?.message || String(error) };
  }
});

// Sync Claude credentials from Keychain to file (for SDK compatibility)
// Call this after auth to ensure the SDK can read the credentials
ipcMain.handle('claude-sync-credentials', async () => {
  try {
    const result = await readClaudeCredentials({ syncToFile: true });
    if (result) {
      return { success: true, source: result.source, synced: result.source === 'keychain' };
    }
    return { success: true, synced: false, message: 'No credentials found to sync' };
  } catch (error) {
    log.error('[Claude Credentials] Error syncing credentials:', error);
    return { success: false, error: error?.message || String(error) };
  }
});

// Get Claude Code authenticated account info (best-effort; does not run a model completion)
ipcMain.handle('claude-sdk-account-info', async (_event, payload = {}) => {
  try {
    if (!currentProject) {
      return { success: false, error: 'No project folder is currently open. Please open a project folder first.' };
    }
    const apiKey = (payload && payload.apiKey != null) ? String(payload.apiKey) : '';
    const { getClaudeAccountInfo } = _getClaudeSdk();
    const { account, model } = await getClaudeAccountInfo({
      projectRoot: currentProject,
      apiKey
    });
    return { success: true, account: account || null, model: model || null };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Get Claude supported models list (best-effort; requires Claude auth)
ipcMain.handle('claude-sdk-supported-models', async (_event, payload = {}) => {
  try {
    if (!currentProject) {
      return { success: false, error: 'No project folder is currently open. Please open a project folder first.' };
    }
    const apiKey = (payload && payload.apiKey != null) ? String(payload.apiKey) : '';
    const { getClaudeSupportedModels } = _getClaudeSdk();
    const { models } = await getClaudeSupportedModels({
      projectRoot: currentProject,
      apiKey
    });
    return { success: true, models: Array.isArray(models) ? models : [] };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// ===========================================================================
// Codex (ChatGPT-subscription) provider IPC
// ===========================================================================
function _getCodexAuth() {
  return require('./codex/codex-auth');
}

ipcMain.handle('codex:login', async () => {
  try {
    const { url } = await _getCodexAuth().startCodexLogin();
    try { await shell.openExternal(url); } catch { /* user can copy from status */ }
    return { success: true, url };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('codex:status', async () => {
  try {
    return { success: true, status: _getCodexAuth().getCodexStatus() };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('codex:logout', async () => {
  try {
    _getCodexAuth().codexLogout();
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('codex:models', async () => {
  try {
    const models = await _getCodexAuth().fetchCodexModels();
    return { success: true, models: Array.isArray(models) ? models : [] };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('edit-file', async (_event, filePath, oldString, newString) => {
  try {
    const resolvedPath = resolveInCurrentProject(filePath);
    const content = await fs.readFile(resolvedPath, 'utf-8');
    
    // Normalize line endings for comparison if needed, but strict replacement is safer
    if (!content.includes(oldString)) {
      // Try to find it with relaxed whitespace if strict match fails?
      // For now, fail to be safe like Cursor
      return { success: false, error: 'Could not find exact match for old_string' };
    }
    
    const newContent = content.replace(oldString, newString);
    await fs.writeFile(resolvedPath, newContent, 'utf-8');
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Delete file
ipcMain.handle('delete-file', async (_event, filePath) => {
  try {
    const resolvedPath = resolveInCurrentProject(filePath);
    const stats = await fs.stat(resolvedPath);
    if (stats.isDirectory()) {
      await fs.rm(resolvedPath, { recursive: true, force: true });
    } else {
      await fs.unlink(resolvedPath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-file', async (_event, oldPath, newPath) => {
  try {
    const resolvedOld = resolveInCurrentProject(oldPath);
    const resolvedNew = resolveInCurrentProject(newPath);
    await fs.rename(resolvedOld, resolvedNew);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-directory', async (_event, dirPath) => {
  try {
    const resolvedDir = resolveInCurrentProject(dirPath);
    await fs.mkdir(resolvedDir, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================================================
// FILE EXPLORER: COPY / MOVE / DUPLICATE (Workspace-scoped, conflict-safe)
// ============================================================================

async function pathExists(absPath) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function splitNameForCopy(name) {
  const base = String(name || '');
  const ext = path.extname(base);
  if (!ext) return { stem: base, ext: '' };
  return { stem: base.slice(0, -ext.length), ext };
}

async function computeUniqueDestPath(destAbs, { isDirectory }) {
  // If it doesn't exist, we can use it.
  if (!(await pathExists(destAbs))) return destAbs;

  const dir = path.dirname(destAbs);
  const base = path.basename(destAbs);
  const { stem, ext } = splitNameForCopy(base);

  // VS Code-ish naming: "name copy", "name copy 2", ...
  const maxTries = 500;
  for (let i = 1; i <= maxTries; i++) {
    const suffix = i === 1 ? ' copy' : ` copy ${i}`;
    const nextName = isDirectory ? `${stem}${suffix}` : `${stem}${suffix}${ext}`;
    const candidate = path.join(dir, nextName);
    if (!(await pathExists(candidate))) return candidate;
  }

  throw new Error(`Could not find an available name for "${base}" after ${maxTries} attempts`);
}

async function copyFileExclusive(srcAbs, destAbs) {
  // COPYFILE_EXCL prevents overwriting existing destination.
  await fs.copyFile(srcAbs, destAbs, fsSync.constants.COPYFILE_EXCL);
}

async function copyDirRecursive(srcAbs, destAbs) {
  // Prefer fs.cp when available (Node >=16)
  if (typeof fs.cp === 'function') {
    await fs.cp(srcAbs, destAbs, { recursive: true, force: false, errorOnExist: true });
    return;
  }

  // Manual fallback
  await fs.mkdir(destAbs, { recursive: false });
  const entries = await fs.readdir(srcAbs, { withFileTypes: true });
  for (const ent of entries) {
    const srcChild = path.join(srcAbs, ent.name);
    const dstChild = path.join(destAbs, ent.name);
    if (ent.isDirectory()) {
      await copyDirRecursive(srcChild, dstChild);
    } else if (ent.isFile()) {
      await fs.mkdir(path.dirname(dstChild), { recursive: true });
      await copyFileExclusive(srcChild, dstChild);
    } else if (ent.isSymbolicLink()) {
      // Best-effort: preserve symlink
      const link = await fs.readlink(srcChild);
      await fs.symlink(link, dstChild);
    }
  }
}

async function copyPathToDir(srcAbs, destDirAbs) {
  const st = await fs.stat(srcAbs);
  const isDirectory = st.isDirectory();
  const desired = path.join(destDirAbs, path.basename(srcAbs));

  if (isDirectory) {
    // Prevent copying a directory into its own descendant (infinite recursion).
    if (isPathInside(srcAbs, destDirAbs)) {
      throw new Error('Cannot copy a folder into itself or one of its subfolders.');
    }
  }

  const destAbs = await computeUniqueDestPath(desired, { isDirectory });
  if (isDirectory) {
    await copyDirRecursive(srcAbs, destAbs);
  } else {
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await copyFileExclusive(srcAbs, destAbs);
  }
  return { src: srcAbs, dest: destAbs, kind: isDirectory ? 'directory' : 'file' };
}

async function movePathToDir(srcAbs, destDirAbs) {
  const st = await fs.stat(srcAbs);
  const isDirectory = st.isDirectory();

  // Prevent moving a directory into its own descendant.
  if (isDirectory) {
    if (isPathInside(srcAbs, destDirAbs)) {
      throw new Error('Cannot move a folder into itself or one of its subfolders.');
    }
  }

  const desired = path.join(destDirAbs, path.basename(srcAbs));
  const destAbs = await computeUniqueDestPath(desired, { isDirectory });

  // No-op move (same location)
  if (realpathSafeSync(srcAbs) === realpathSafeSync(destAbs)) {
    return { src: srcAbs, dest: destAbs, kind: isDirectory ? 'directory' : 'file', skipped: true };
  }
  if (realpathSafeSync(path.dirname(srcAbs)) === realpathSafeSync(destDirAbs)) {
    // Same parent folder: treat as no-op.
    return { src: srcAbs, dest: srcAbs, kind: isDirectory ? 'directory' : 'file', skipped: true };
  }

  try {
    await fs.rename(srcAbs, destAbs);
    return { src: srcAbs, dest: destAbs, kind: isDirectory ? 'directory' : 'file' };
  } catch (e) {
    // Cross-device rename fallback
    const code = e && typeof e === 'object' ? e.code : null;
    if (code !== 'EXDEV') throw e;

    if (isDirectory) {
      await copyDirRecursive(srcAbs, destAbs);
      await fs.rm(srcAbs, { recursive: true, force: true });
    } else {
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      await copyFileExclusive(srcAbs, destAbs);
      await fs.unlink(srcAbs);
    }
    return { src: srcAbs, dest: destAbs, kind: isDirectory ? 'directory' : 'file', exdevFallback: true };
  }
}

ipcMain.handle('copy-paths', async (_event, sourcePaths, destDir, _options = {}) => {
  try {
    const srcs = Array.isArray(sourcePaths) ? sourcePaths : [];
    const destDirAbs = resolveInCurrentProject(destDir);
    const st = await fs.stat(destDirAbs);
    if (!st.isDirectory()) throw new Error('Destination is not a directory');
    if (srcs.length === 0) return { success: true, results: [] };

    const results = [];
    for (const p of srcs) {
      const srcAbs = resolveInCurrentProject(p);
      results.push(await copyPathToDir(srcAbs, destDirAbs));
    }
    return { success: true, results };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('move-paths', async (_event, sourcePaths, destDir, _options = {}) => {
  try {
    const srcs = Array.isArray(sourcePaths) ? sourcePaths : [];
    const destDirAbs = resolveInCurrentProject(destDir);
    const st = await fs.stat(destDirAbs);
    if (!st.isDirectory()) throw new Error('Destination is not a directory');
    if (srcs.length === 0) return { success: true, results: [] };

    const results = [];
    for (const p of srcs) {
      const srcAbs = resolveInCurrentProject(p);
      results.push(await movePathToDir(srcAbs, destDirAbs));
    }
    return { success: true, results };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('duplicate-path', async (_event, sourcePath, _options = {}) => {
  try {
    const srcAbs = resolveInCurrentProject(sourcePath);
    const st = await fs.stat(srcAbs);
    const isDirectory = st.isDirectory();
    const parent = path.dirname(srcAbs);
    const desired = path.join(parent, path.basename(srcAbs));
    const destAbs = await computeUniqueDestPath(desired, { isDirectory });

    if (isDirectory) {
      await copyDirRecursive(srcAbs, destAbs);
    } else {
      await copyFileExclusive(srcAbs, destAbs);
    }
    return { success: true, src: srcAbs, dest: destAbs, kind: isDirectory ? 'directory' : 'file' };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// (Removed) Agent tool handlers (background shell + browser automation)

ipcMain.handle('read-lints', async (_event, _paths) => {
  // TODO: Implement real linter integration (LSP or diagnostics service)
  // For now return empty list or mock data
  return { success: true, lints: [] };
});

// Workspace Storage (SQLite KV, workspace-scoped)
ipcMain.handle('workspace-storage-get', async (_event, projectPath, key) => {
  try {
    if (!projectPath || !key) return { success: false, error: 'Missing projectPath or key' };
    return await withWorkspaceKvDb(projectPath, async (db, st) => {
      const valueStr = kvGetString(db, key);
      if (typeof valueStr !== 'string') return { success: true, value: undefined, workspaceId: st.workspaceId, dbPath: st.dbPath };
      try {
        return { success: true, value: JSON.parse(valueStr), workspaceId: st.workspaceId, dbPath: st.dbPath };
      } catch (e) {
        return { success: false, error: `Corrupt JSON for key "${key}": ${e.message}`, workspaceId: st.workspaceId, dbPath: st.dbPath };
      }
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workspace-storage-store', async (_event, projectPath, key, value) => {
  try {
    if (!projectPath || !key) return { success: false, error: 'Missing projectPath or key' };
    return await withWorkspaceKvDb(projectPath, async (db, st) => {
      const valueStr = JSON.stringify(value);
      kvSetString(db, key, valueStr);
      st.dirty = true;
      _queueWorkspaceKvFlush(st).catch(() => {});
      return { success: true, workspaceId: st.workspaceId, dbPath: st.dbPath };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workspace-storage-remove', async (_event, projectPath, key) => {
  try {
    if (!projectPath || !key) return { success: false, error: 'Missing projectPath or key' };
    return await withWorkspaceKvDb(projectPath, async (db, st) => {
      kvRemove(db, key);
      st.dirty = true;
      _queueWorkspaceKvFlush(st).catch(() => {});
      return { success: true, workspaceId: st.workspaceId, dbPath: st.dbPath };
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reveal-in-finder', async (_event, filePath) => {
  try {
    await shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Workspace-local Read File Cache (.codeon/cache/read_file_cache/<sessionId>.json)
ipcMain.handle('read-readfile-cache', async (_event, projectPath, sessionId) => {
  try {
    if (!projectPath || !sessionId) return { success: false, error: 'Missing projectPath or sessionId' };
    const cachePath = path.join(projectPath, '.codeon', 'cache', 'read_file_cache', `${sessionId}.json`);
    try {
      await fs.access(cachePath);
    } catch {
      return { success: true, cache: null, path: cachePath };
    }
    const raw = await fs.readFile(cachePath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      return { success: true, cache: parsed, path: cachePath };
    } catch (e) {
      return { success: false, error: `Corrupt cache JSON: ${e.message}`, path: cachePath };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('write-readfile-cache', async (_event, projectPath, sessionId, cacheObj) => {
  try {
    if (!projectPath || !sessionId) return { success: false, error: 'Missing projectPath or sessionId' };
    const cacheDir = path.join(projectPath, '.codeon', 'cache', 'read_file_cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, `${sessionId}.json`);
    await fs.writeFile(cachePath, JSON.stringify(cacheObj, null, 2), 'utf-8');
    return { success: true, path: cachePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Chat History File Operations (Desktop App - File System Based)
ipcMain.handle('save-chat-history', async (_event, projectPath, chatSessions) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'No project path provided' };
    }

    // Create .ai-agent directory in project root
    const aiAgentDir = path.join(projectPath, '.ai-agent');
    await fs.mkdir(aiAgentDir, { recursive: true });

    // Save chat sessions as JSON file
    const chatHistoryPath = path.join(aiAgentDir, 'chat-sessions.json');
    await writeJsonSafely(chatHistoryPath, chatSessions);
    // PERF: avoid JSON.stringify() just to compute size (can be expensive on large histories).
    console.log(`[Chat History] Saved to ${chatHistoryPath}`);

    return { success: true, path: chatHistoryPath };
  } catch (error) {
    console.error('[Chat History] Failed to save:', error);
    return { success: false, error: error.message };
  }
});

// Save UI metadata (diffs, file previews, tool executions) separately
ipcMain.handle('save-ui-metadata', async (_event, projectPath, uiMetadata) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'No project path provided' };
    }

    const aiAgentDir = path.join(projectPath, '.ai-agent');
    await fs.mkdir(aiAgentDir, { recursive: true });

    const uiMetadataPath = path.join(aiAgentDir, 'ui-metadata.json');
    await writeJsonSafely(uiMetadataPath, uiMetadata);
    // PERF: avoid JSON.stringify() just to compute size (can be expensive on large payloads).
    console.log(`[UI Metadata] Saved to ${uiMetadataPath}`);

    return { success: true, path: uiMetadataPath };
  } catch (error) {
    console.error('[UI Metadata] Failed to save:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-chat-history', async (_event, projectPath) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'No project path provided' };
    }

    const chatHistoryPath = path.join(projectPath, '.ai-agent', 'chat-sessions.json');
    const bakPath = chatHistoryPath + '.bak';
    const tmpPath = chatHistoryPath + '.tmp';
    
    // Check if any candidate file exists
    try {
      await fs.access(chatHistoryPath);
    } catch (_e) {
      try {
        await fs.access(bakPath);
      } catch (_e2) {
        try {
          await fs.access(tmpPath);
        } catch (_e3) {
          // No file exists yet - return empty sessions
          return { success: true, sessions: {}, uiMetadata: {} };
        }
      }
    }

    // Read and parse chat history
    const sessions = await readJsonWithFallback(chatHistoryPath, { fallbackPaths: [bakPath, tmpPath] });

    console.log(`[Chat History] Loaded from ${chatHistoryPath}`);

    return { success: true, sessions };
  } catch (error) {
    console.error('[Chat History] Failed to load:', error);
    return { success: false, error: error.message };
  }
});

// Load UI metadata separately
ipcMain.handle('load-ui-metadata', async (_event, projectPath) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'No project path provided' };
    }

    const uiMetadataPath = path.join(projectPath, '.ai-agent', 'ui-metadata.json');
    const bakPath = uiMetadataPath + '.bak';
    const tmpPath = uiMetadataPath + '.tmp';
    
    // Check if any candidate file exists
    try {
      await fs.access(uiMetadataPath);
    } catch (_e) {
      try {
        await fs.access(bakPath);
      } catch (_e2) {
        try {
          await fs.access(tmpPath);
        } catch (_e3) {
          // No file exists yet - return empty metadata
          return { success: true, metadata: {} };
        }
      }
    }

    // Read and parse UI metadata
    const metadata = await readJsonWithFallback(uiMetadataPath, { fallbackPaths: [bakPath, tmpPath] });

    console.log(`[UI Metadata] Loaded from ${uiMetadataPath}`);

    return { success: true, metadata };
  } catch (error) {
    console.error('[UI Metadata] Failed to load:', error);
    return { success: false, error: error.message };
  }
});

// Agent Execution Timeline (AET) - load runs for a chat session
ipcMain.handle('execution-timeline-load-session', async (_event, projectPath, sessionId) => {
  try {
    const projectRoot = requireCurrentProject();
    const reqPath = String(projectPath || '').trim();
    if (reqPath) {
      const a = path.resolve(reqPath);
      const b = path.resolve(projectRoot);
      if (a !== b) {
        return { success: false, error: 'Project path mismatch (open project differs from request).' };
      }
    }
    const sid = String(sessionId || '').trim();
    if (!sid) return { success: false, error: 'Missing sessionId' };

    const st = await _aetEnsureLoaded(projectRoot);
    const runs = (st.data && Array.isArray(st.data.runs)) ? st.data.runs : [];
    const filtered = runs
      .filter(r => r && String(r.sessionId || '') === sid)
      .sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0));
    return { success: true, runs: filtered };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Agent Execution Timeline (AET) - discard runs after a cutoff (used when chat history is rewound)
ipcMain.handle('execution-timeline-discard-after', async (_event, projectPath, sessionId, cutoffTimeMs, reason) => {
  try {
    const projectRoot = requireCurrentProject();
    const reqPath = String(projectPath || '').trim();
    if (reqPath) {
      const a = path.resolve(reqPath);
      const b = path.resolve(projectRoot);
      if (a !== b) {
        return { success: false, error: 'Project path mismatch (open project differs from request).' };
      }
    }
    const sid = String(sessionId || '').trim();
    if (!sid) return { success: false, error: 'Missing sessionId' };
    const cutoff = Number(cutoffTimeMs);
    if (!Number.isFinite(cutoff) || cutoff <= 0) return { success: false, error: 'Invalid cutoffTimeMs' };

    const st = await _aetEnsureLoaded(projectRoot);
    const runs = (st.data && Array.isArray(st.data.runs)) ? st.data.runs : [];
    let changed = 0;
    for (const r of runs) {
      if (!r || String(r.sessionId || '') !== sid) continue;
      const start = Number(r.startTime || 0);
      if (!Number.isFinite(start) || start <= 0) continue;
      if (start <= cutoff) continue;
      if (r && r.meta && typeof r.meta === 'object' && r.meta.discarded === true) continue;
      if (!r.meta || typeof r.meta !== 'object') r.meta = {};
      r.meta.discarded = true;
      r.meta.discardedAt = Date.now();
      r.meta.discardReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Chat restored to earlier point';
      r.status = 'discarded';
      changed++;
    }
    if (changed > 0) _aetScheduleSave(projectRoot);
    return { success: true, changed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Agent Execution Timeline (AET) - truncate a run after a specific node (used when user restores to a checkpoint from the timeline)
ipcMain.handle('execution-timeline-truncate-after-node', async (_event, projectPath, sessionId, runId, nodeId, reason) => {
  try {
    const projectRoot = requireCurrentProject();
    const reqPath = String(projectPath || '').trim();
    if (reqPath) {
      const a = path.resolve(reqPath);
      const b = path.resolve(projectRoot);
      if (a !== b) {
        return { success: false, error: 'Project path mismatch (open project differs from request).' };
      }
    }
    const sid = String(sessionId || '').trim();
    const rid = String(runId || '').trim();
    const nid = String(nodeId || '').trim();
    if (!sid || !rid || !nid) return { success: false, error: 'Missing sessionId/runId/nodeId' };

    const st = await _aetEnsureLoaded(projectRoot);
    const runs = (st.data && Array.isArray(st.data.runs)) ? st.data.runs : [];
    const run = runs.find(r => r && String(r.id || '') === rid);
    if (!run) return { success: false, error: 'Run not found' };
    if (String(run.sessionId || '') !== sid) return { success: false, error: 'Run/session mismatch' };
    if (!Array.isArray(run.nodes)) run.nodes = [];

    const idx = run.nodes.findIndex(n => String(n?.id || '') === nid);
    if (idx < 0) return { success: false, error: 'Node not found in run' };

    const prevLen = run.nodes.length;
    const nextLen = idx + 1;
    const removedCount = prevLen > nextLen ? (prevLen - nextLen) : 0;
    if (removedCount > 0) run.nodes = run.nodes.slice(0, nextLen);

    const node = run.nodes[idx] || null;
    const cutoff = Number(node?.timestamp || run.startTime || 0);
    const cutoffTimeMs = (Number.isFinite(cutoff) && cutoff > 0) ? cutoff : Date.now();

    if (!run.meta || typeof run.meta !== 'object') run.meta = {};
    run.meta.truncated = true;
    run.meta.truncatedAt = Date.now();
    run.meta.truncatedAfterNodeId = nid;
    run.meta.truncatedReason = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'User restored to a checkpoint from the execution timeline';
    run.meta.truncatedRemovedCount = removedCount;

    // Also discard future runs for this chat session after the cutoff so the UI doesn't keep showing "future" history.
    let discardedRuns = 0;
    for (const r of runs) {
      if (!r || String(r.sessionId || '') !== sid) continue;
      if (String(r.id || '') === rid) continue;
      const start = Number(r.startTime || 0);
      if (!Number.isFinite(start) || start <= 0) continue;
      if (start <= cutoffTimeMs) continue;
      if (r.meta && typeof r.meta === 'object' && r.meta.discarded === true) continue;
      if (!r.meta || typeof r.meta !== 'object') r.meta = {};
      r.meta.discarded = true;
      r.meta.discardedAt = Date.now();
      r.meta.discardReason = run.meta.truncatedReason;
      r.status = 'discarded';
      discardedRuns++;
    }

    await _aetFlushSave(projectRoot);

    // Broadcast updates so open renderers update immediately.
    try {
      const sender = _event?.sender;
      const send = (wc) => {
        try {
          wc.send('execution-timeline-event', { kind: 'run_update', sessionId: sid, runId: rid, patch: { nodes: run.nodes, meta: run.meta } });
          for (const r of runs) {
            if (!r || String(r.sessionId || '') !== sid) continue;
            if (String(r.id || '') === rid) continue;
            if (!(r.meta && typeof r.meta === 'object' && r.meta.discarded === true)) continue;
            wc.send('execution-timeline-event', { kind: 'run_update', sessionId: sid, runId: String(r.id || ''), patch: { status: r.status, meta: r.meta } });
          }
        } catch { /* ignore */ }
      };
      if (sender && !sender.isDestroyed?.()) send(sender);
      else if (mainWindow && !mainWindow.isDestroyed?.()) send(mainWindow.webContents);
    } catch { /* ignore */ }

    return { success: true, runId: rid, truncatedTo: nextLen, removedCount, cutoffTimeMs, discardedRuns };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Agent Execution Timeline (AET) - append a node to an existing run (used for user actions like locks)
ipcMain.handle('execution-timeline-append-node', async (_event, projectPath, sessionId, runId, nodeType, payload) => {
  try {
    const projectRoot = requireCurrentProject();
    const reqPath = String(projectPath || '').trim();
    if (reqPath) {
      const a = path.resolve(reqPath);
      const b = path.resolve(projectRoot);
      if (a !== b) {
        return { success: false, error: 'Project path mismatch (open project differs from request).' };
      }
    }
    const sid = String(sessionId || '').trim();
    const rid = String(runId || '').trim();
    const type = String(nodeType || '').trim();
    if (!sid || !rid || !type) return { success: false, error: 'Missing sessionId/runId/type' };

    const st = await _aetEnsureLoaded(projectRoot);
    const run = (st.data && Array.isArray(st.data.runs)) ? st.data.runs.find(r => r && r.id === rid) : null;
    if (!run) return { success: false, error: 'Run not found' };
    if (String(run.sessionId || '') !== sid) return { success: false, error: 'Run/session mismatch' };

    const node = _aetBuildNode({
      runId: rid,
      type,
      payload: (payload && typeof payload === 'object') ? payload : { title: String(payload || '') }
    });
    const saved = await _aetAppendNode(projectRoot, rid, node);
    if (saved) {
      try {
        if (_event && _event.sender && !_event.sender.isDestroyed?.()) {
          _event.sender.send('execution-timeline-event', { kind: 'node', sessionId: sid, runId: rid, node: saved });
        } else if (mainWindow && !mainWindow.isDestroyed?.()) {
          mainWindow.webContents.send('execution-timeline-event', { kind: 'node', sessionId: sid, runId: rid, node: saved });
        }
      } catch { /* ignore */ }
    }
    return { success: true, node: saved };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// File locks (v2.0) - project-local .ai-agent/locks.json
ipcMain.handle('execution-locks-get', async (_event, projectPath) => {
  try {
    const projectRoot = requireCurrentProject();
    const reqPath = String(projectPath || '').trim();
    if (reqPath) {
      const a = path.resolve(reqPath);
      const b = path.resolve(projectRoot);
      if (a !== b) return { success: false, error: 'Project path mismatch (open project differs from request).' };
    }
    const fp = path.join(projectRoot, '.ai-agent', 'locks.json');
    const bakPath = fp + '.bak';
    const tmpPath = fp + '.tmp';
    let obj = null;
    try {
      obj = await readJsonWithFallback(fp, { fallbackPaths: [bakPath, tmpPath] });
    } catch {
      obj = null;
    }
    const locks = obj && typeof obj === 'object' && obj.locks && typeof obj.locks === 'object' ? obj.locks : {};
    const canonicalizeLockPath = (p) => {
      try {
        let raw = String(p || '').trim();
        if (!raw) return null;
        raw = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
        if (path.isAbsolute(raw)) {
          const abs = path.resolve(raw);
          const root = path.resolve(projectRoot);
          const prefix = root.endsWith(path.sep) ? root : root + path.sep;
          if (!(abs === root || abs.startsWith(prefix))) return null;
          raw = path.relative(root, abs).replace(/\\/g, '/').trim();
        }
        raw = raw.replace(/^\/+/, '').trim();
        if (!raw || raw === '.') return null;
        return raw;
      } catch {
        return null;
      }
    };
    const migrated = {};
    try {
      for (const [k, v] of Object.entries(locks)) {
        const nk = canonicalizeLockPath(k);
        if (!nk) continue;
        if (!Object.prototype.hasOwnProperty.call(migrated, nk)) migrated[nk] = v;
      }
    } catch { /* ignore */ }
    return { success: true, locks: migrated };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('execution-locks-set', async (_event, projectPath, { paths = [], locked = true, note = '' } = {}) => {
  try {
    const projectRoot = requireCurrentProject();
    const reqPath = String(projectPath || '').trim();
    if (reqPath) {
      const a = path.resolve(reqPath);
      const b = path.resolve(projectRoot);
      if (a !== b) return { success: false, error: 'Project path mismatch (open project differs from request).' };
    }
    const canonicalizeLockPath = (p) => {
      try {
        let raw = String(p || '').trim();
        if (!raw) return null;
        raw = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
        // Allow callers to pass absolute paths, but always store locks as project-relative keys.
        if (path.isAbsolute(raw)) {
          const abs = path.resolve(raw);
          const root = path.resolve(projectRoot);
          const prefix = root.endsWith(path.sep) ? root : root + path.sep;
          if (!(abs === root || abs.startsWith(prefix))) return null;
          raw = path.relative(root, abs).replace(/\\/g, '/').trim();
        }
        raw = raw.replace(/^\/+/, '').trim();
        if (!raw || raw === '.') return null;
        return raw;
      } catch {
        return null;
      }
    };
    const list = Array.isArray(paths)
      ? paths.map(canonicalizeLockPath).filter(Boolean).slice(0, 200)
      : [];
    if (list.length === 0) return { success: false, error: 'No paths provided' };
    const aiAgentDir = path.join(projectRoot, '.ai-agent');
    await fs.mkdir(aiAgentDir, { recursive: true });
    const fp = path.join(aiAgentDir, 'locks.json');
    const bakPath = fp + '.bak';
    const tmpPath = fp + '.tmp';
    let obj = null;
    try { obj = await readJsonWithFallback(fp, { fallbackPaths: [bakPath, tmpPath] }); } catch { obj = null; }
    if (!obj || typeof obj !== 'object') obj = { v: 1, locks: {} };
    if (!obj.locks || typeof obj.locks !== 'object') obj.locks = {};

    // Normalize any legacy absolute lock keys into project-relative keys.
    try {
      const migrated = {};
      for (const [k, v] of Object.entries(obj.locks)) {
        const nk = canonicalizeLockPath(k);
        if (!nk) continue;
        if (!Object.prototype.hasOwnProperty.call(migrated, nk)) migrated[nk] = (v && typeof v === 'object') ? v : { lockedBy: 'user', lockedAt: Date.now() };
      }
      obj.locks = migrated;
    } catch { /* ignore */ }

    const now = Date.now();
    if (locked === true) {
      for (const p of list) {
        obj.locks[p] = { lockedBy: 'user', lockedAt: now, ...(note ? { note: String(note).trim().slice(0, 280) } : {}) };
      }
    } else {
      for (const p of list) {
        delete obj.locks[p];
      }
    }
    await writeJsonSafely(fp, obj);
    return { success: true, locks: obj.locks };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Mindmap Pinboard (v1) - project-local .ai-agent/mindmap-pinboard.json
ipcMain.handle('mindmap-pinboard-get', async (_event, projectPath) => {
  try {
    const projectRoot = requireCurrentProject();
    const reqPath = String(projectPath || '').trim();
    if (reqPath) {
      const a = path.resolve(reqPath);
      const b = path.resolve(projectRoot);
      if (a !== b) return { success: false, error: 'Project path mismatch (open project differs from request).' };
    }
    const fp = path.join(projectRoot, '.ai-agent', 'mindmap-pinboard.json');
    const bakPath = fp + '.bak';
    const tmpPath = fp + '.tmp';
    let obj = null;
    try { obj = await readJsonWithFallback(fp, { fallbackPaths: [bakPath, tmpPath] }); } catch { obj = null; }
    if (!obj || typeof obj !== 'object') obj = { v: 1, pins: [] };
    const pins = Array.isArray(obj.pins) ? obj.pins : [];

    const canonicalizeRel = (p) => {
      try {
        let raw = String(p || '').trim();
        if (!raw) return null;
        raw = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
        if (path.isAbsolute(raw)) {
          const abs = path.resolve(raw);
          const root = path.resolve(projectRoot);
          const prefix = root.endsWith(path.sep) ? root : root + path.sep;
          if (!(abs === root || abs.startsWith(prefix))) return null;
          raw = path.relative(root, abs).replace(/\\/g, '/').trim();
        }
        raw = raw.replace(/^\/+/, '').trim();
        if (!raw || raw === '.') return null;
        return raw;
      } catch {
        return null;
      }
    };

    const out = [];
    for (const p of pins.slice(0, 600)) {
      if (!p || typeof p !== 'object') continue;
      const ref = p.ref && typeof p.ref === 'object' ? p.ref : {};
      const filePath = ref.filePath ? canonicalizeRel(ref.filePath) : null;
      const toolUseId = ref.toolUseId && typeof ref.toolUseId === 'string' ? ref.toolUseId.trim() : '';
      const runId = ref.runId && typeof ref.runId === 'string' ? ref.runId.trim() : '';
      const aetNodeId = ref.aetNodeId && typeof ref.aetNodeId === 'string' ? ref.aetNodeId.trim() : '';
      const ref2 = {};
      if (filePath) ref2.filePath = filePath;
      if (toolUseId) ref2.toolUseId = toolUseId.slice(0, 200);
      if (runId && aetNodeId) { ref2.runId = runId.slice(0, 200); ref2.aetNodeId = aetNodeId.slice(0, 200); }
      if (Object.keys(ref2).length === 0) continue;

      const id = typeof p.id === 'string' ? p.id.trim().slice(0, 220) : '';
      const label = typeof p.label === 'string' ? p.label.trim().slice(0, 180) : '';
      const note = typeof p.note === 'string' ? p.note.trim().slice(0, 1200) : '';
      const createdAt = Number.isFinite(Number(p.createdAt)) ? Number(p.createdAt) : Date.now();
      out.push({ id: id || `pin:${Date.now()}`, createdAt, label: label || (filePath || 'Pin'), ref: ref2, ...(note ? { note } : {}) });
    }
    return { success: true, pins: out };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mindmap-pinboard-set', async (_event, projectPath, pins = []) => {
  try {
    const projectRoot = requireCurrentProject();
    const reqPath = String(projectPath || '').trim();
    if (reqPath) {
      const a = path.resolve(reqPath);
      const b = path.resolve(projectRoot);
      if (a !== b) return { success: false, error: 'Project path mismatch (open project differs from request).' };
    }
    const list = Array.isArray(pins) ? pins.slice(0, 600) : [];

    const canonicalizeRel = (p) => {
      try {
        let raw = String(p || '').trim();
        if (!raw) return null;
        raw = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
        if (path.isAbsolute(raw)) {
          const abs = path.resolve(raw);
          const root = path.resolve(projectRoot);
          const prefix = root.endsWith(path.sep) ? root : root + path.sep;
          if (!(abs === root || abs.startsWith(prefix))) return null;
          raw = path.relative(root, abs).replace(/\\/g, '/').trim();
        }
        raw = raw.replace(/^\/+/, '').trim();
        if (!raw || raw === '.') return null;
        return raw;
      } catch {
        return null;
      }
    };

    const out = [];
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const ref = p.ref && typeof p.ref === 'object' ? p.ref : {};
      const filePath = ref.filePath ? canonicalizeRel(ref.filePath) : null;
      const toolUseId = ref.toolUseId && typeof ref.toolUseId === 'string' ? ref.toolUseId.trim() : '';
      const runId = ref.runId && typeof ref.runId === 'string' ? ref.runId.trim() : '';
      const aetNodeId = ref.aetNodeId && typeof ref.aetNodeId === 'string' ? ref.aetNodeId.trim() : '';
      const ref2 = {};
      if (filePath) ref2.filePath = filePath;
      if (toolUseId) ref2.toolUseId = toolUseId.slice(0, 200);
      if (runId && aetNodeId) { ref2.runId = runId.slice(0, 200); ref2.aetNodeId = aetNodeId.slice(0, 200); }
      if (Object.keys(ref2).length === 0) continue;

      const id = typeof p.id === 'string' ? p.id.trim().slice(0, 220) : '';
      const label = typeof p.label === 'string' ? p.label.trim().slice(0, 180) : '';
      const note = typeof p.note === 'string' ? p.note.trim().slice(0, 1200) : '';
      const createdAt = Number.isFinite(Number(p.createdAt)) ? Number(p.createdAt) : Date.now();
      out.push({ id: id || `pin:${Date.now()}`, createdAt, label: label || (filePath || 'Pin'), ref: ref2, ...(note ? { note } : {}) });
    }

    const aiAgentDir = path.join(projectRoot, '.ai-agent');
    await fs.mkdir(aiAgentDir, { recursive: true });
    const fp = path.join(aiAgentDir, 'mindmap-pinboard.json');
    await writeJsonSafely(fp, { v: 1, pins: out });
    return { success: true, pins: out };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Pause-before-next-tool (v2.0) - run control
ipcMain.handle('claude-sdk-set-run-control', async (_event, payload = {}) => {
  try {
    const requestId = String(payload.requestId || '').trim();
    if (!requestId) return { success: false, error: 'Missing requestId' };
    const patch = payload && typeof payload === 'object' ? payload : {};
    const { setClaudeSdkRunControl } = _getClaudeSdk();
    const res = setClaudeSdkRunControl(requestId, patch);
    return res && typeof res === 'object' ? res : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Pause-before-next-tool reset (project open / window reload safety)
ipcMain.handle('claude-sdk-reset-pause-state', async (_event, payload = {}) => {
  try {
    const sid = typeof payload?.uiSessionId === 'string' ? payload.uiSessionId.trim() : '';
    const { resetClaudeSdkPauseState } = _getClaudeSdk();
    const res = resetClaudeSdkPauseState({ uiSessionId: sid || null });
    return res && typeof res === 'object' ? res : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Global Settings Management (Desktop App)
ipcMain.handle('save-settings', async (_event, settings) => {
  try {
    await ensureAppDataDir();
    const settingsPath = path.join(APP_DATA_DIR, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    
    console.log('[Settings] Saved to', settingsPath);
    return { success: true, path: settingsPath };
  } catch (error) {
    console.error('[Settings] Failed to save:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-settings', async (_event) => {
  try {
    const settingsPath = path.join(APP_DATA_DIR, 'settings.json');
    
    // Check if file exists
    try {
      await fs.access(settingsPath);
    } catch (_e) {
      // File doesn't exist - return defaults
      return { success: true, settings: null };
    }

    const data = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(data);
    
    console.log('[Settings] Loaded from', settingsPath);
    return { success: true, settings };
  } catch (error) {
    console.error('[Settings] Failed to load:', error);
    return { success: false, error: error.message };
  }
});

// Recent Projects Management (Desktop App)
ipcMain.handle('save-recent-projects', async (_event, projects) => {
  try {
    await ensureAppDataDir();
    const projectsPath = path.join(APP_DATA_DIR, 'recent-projects.json');
    await fs.writeFile(projectsPath, JSON.stringify(projects, null, 2), 'utf-8');
    
    console.log('[Recent Projects] Saved', projects.length, 'projects to', projectsPath);
    return { success: true, path: projectsPath };
  } catch (error) {
    console.error('[Recent Projects] Failed to save:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-recent-projects', async (_event) => {
  try {
    const projectsPath = path.join(APP_DATA_DIR, 'recent-projects.json');
    
    // Check if file exists
    try {
      await fs.access(projectsPath);
    } catch (_e) {
      // File doesn't exist - return empty array
      return { success: true, projects: [] };
    }

    const data = await fs.readFile(projectsPath, 'utf-8');
    const projects = JSON.parse(data);
    
    console.log('[Recent Projects] Loaded', projects.length, 'projects from', projectsPath);
    return { success: true, projects };
  } catch (error) {
    console.error('[Recent Projects] Failed to load:', error);
    return { success: false, error: error.message };
  }
});

// (Removed) per-project agent memory (legacy agentic runtime)

// Terminal Command Execution (extracted)
try {
  const { registerTerminalCommandIpc } = require('./ipc/terminal-commands');
  registerTerminalCommandIpc({
    ipcMain,
    execAsync,
    path,
    isPathInside,
    getCurrentProject: () => currentProject,
    APP_ROOT,
    appDir: __dirname,
  });
} catch (e) {
  console.error('[IPC] Failed to register terminal command handlers:', e);
}

// ============================================================================
// INTERACTIVE TERMINAL (PTY) — xterm.js in renderer + node-pty in main
// ============================================================================
function getDefaultShellSpec() {
  try {
    if (process.platform === 'win32') {
      // Prefer PowerShell if available; fall back to cmd.exe
      return { file: 'powershell.exe', args: ['-NoLogo'] };
    }
    const shell = String(process.env.SHELL || '/bin/zsh').trim() || '/bin/zsh';
    const base = path.basename(shell);
    if (base === 'zsh' || base === 'bash') return { file: shell, args: ['-l'] };
    return { file: shell, args: [] };
  } catch {
    return { file: process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh', args: [] };
  }
}

function getShellCandidates() {
  if (process.platform === 'win32') {
    return [
      { file: 'powershell.exe', args: ['-NoLogo'], label: 'powershell' },
      { file: 'cmd.exe', args: [], label: 'cmd' }
    ];
  }
  const envShell = String(process.env.SHELL || '').trim();
  const list = [];
  if (envShell) {
    const base = path.basename(envShell);
    list.push({ file: envShell, args: (base === 'zsh' || base === 'bash') ? ['-l'] : [], label: 'env:SHELL' });
    list.push({ file: envShell, args: [], label: 'env:SHELL(no -l)' });
  }
  list.push({ file: '/bin/zsh', args: ['-l'], label: 'zsh -l' });
  list.push({ file: '/bin/zsh', args: [], label: 'zsh' });
  list.push({ file: '/bin/bash', args: ['-l'], label: 'bash -l' });
  list.push({ file: '/bin/bash', args: [], label: 'bash' });
  list.push({ file: '/bin/sh', args: [], label: 'sh' });
  return list;
}

function resolveTerminalCwd(options = {}) {
  const cwdRaw = typeof options.cwd === 'string' ? options.cwd.trim() : '';
  const cwdResolved = cwdRaw
    ? (path.isAbsolute(cwdRaw) ? path.resolve(cwdRaw) : path.resolve(currentProject, cwdRaw))
    : currentProject;
  return cwdResolved;
}

function validateTerminalCwd(cwdResolved) {
  try {
    if (!cwdResolved) return { ok: false, error: 'Missing cwd' };
    if (!fsSync.existsSync(cwdResolved)) return { ok: false, error: `cwd does not exist: ${cwdResolved}` };
    const st = fsSync.statSync(cwdResolved);
    if (!st.isDirectory()) return { ok: false, error: `cwd is not a directory: ${cwdResolved}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function trySpawnPtyWithFallbacks(candidates, cols, rows, cwdResolved, env) {
  const errors = [];
  for (const c of candidates) {
    try {
      if (!c || !c.file) continue;
      const pty = nodePty.spawn(c.file, Array.isArray(c.args) ? c.args : [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: cwdResolved,
        env,
      });
      return { pty, used: { file: c.file, args: c.args || [], label: c.label || '' }, errors };
    } catch (e) {
      const errObj = {
        label: c && c.label ? c.label : '',
        file: c && c.file ? c.file : '',
        args: c && Array.isArray(c.args) ? c.args : [],
        message: e && e.message ? e.message : String(e),
        code: e && (e.code || e.errno) ? (e.code || e.errno) : undefined,
      };
      errors.push(errObj);
    }
  }
  const last = errors.length ? errors[errors.length - 1] : null;
  const msg = last && last.message ? last.message : 'Failed to spawn PTY (unknown)';
  const err = new Error(msg);
  err.details = errors;
  throw err;
}

ipcMain.handle('terminal:create', async (event, options = {}) => {
  try {
    if (!nodePty) {
      return { success: false, error: 'node-pty is not installed (run `npm install`).', terminalId: null };
    }
    if (!currentProject) {
      return { success: false, error: 'No project folder open', terminalId: null };
    }

    const cols = Number.isFinite(Number(options.cols)) ? Math.max(2, Math.min(500, Number(options.cols))) : 80;
    const rows = Number.isFinite(Number(options.rows)) ? Math.max(2, Math.min(300, Number(options.rows))) : 24;

    const cwdResolved = resolveTerminalCwd(options);
    if (!isPathInside(currentProject, cwdResolved)) {
      return { success: false, error: 'Invalid cwd (not inside project)', terminalId: null, cwd: cwdResolved };
    }
    // Never allow commands to run in the Electron app directory
    if (cwdResolved === APP_ROOT || cwdResolved === __dirname || cwdResolved === process.cwd()) {
      return { success: false, error: 'Security violation: attempted to run in app directory', terminalId: null, cwd: cwdResolved };
    }
    const cwdCheck = validateTerminalCwd(cwdResolved);
    if (!cwdCheck.ok) {
      return { success: false, error: cwdCheck.error || 'Invalid cwd', terminalId: null, cwd: cwdResolved };
    }

    const m = getPtySessionMapForWebContentsId(event.sender.id);
    if (!m) return { success: false, error: 'Invalid window context', terminalId: null };

    const terminalId = crypto.randomBytes(10).toString('hex');
    const spec = getDefaultShellSpec();
    const env = { ...process.env };
    if (!env.TERM) env.TERM = 'xterm-256color';
    if (!env.PATH) env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

    let pty = null;
    let used = null;
    try {
      // Try primary spec first, then fallbacks
      const candidates = [{ ...spec, label: 'primary' }, ...getShellCandidates()];
      const res = trySpawnPtyWithFallbacks(candidates, cols, rows, cwdResolved, env);
      pty = res.pty;
      used = res.used;
      if (res.errors && res.errors.length) {
        console.warn('[Terminal:PTY] spawn fallbacks encountered errors:', res.errors);
      }
    } catch (e) {
      const details = e && e.details ? e.details : undefined;
      console.error('[Terminal:PTY] Failed to spawn PTY', {
        cwd: cwdResolved,
        project: currentProject,
        shell: spec,
        error: e && e.message ? e.message : e,
        details,
      });
      return {
        success: false,
        error: e && e.message ? e.message : String(e),
        terminalId: null,
        cwd: cwdResolved,
        details: {
          cwd: cwdResolved,
          projectPath: currentProject,
          shellAttempted: spec,
          fallbackErrors: details,
        },
      };
    }

    m.set(terminalId, { pty, cwd: cwdResolved, createdAt: Date.now() });

    // Stream output back to the renderer that created this terminal
    try {
      pty.onData((data) => {
        try {
          event.sender.send('terminal:data', { terminalId, data });
        } catch {
          // ignore
        }
      });
      pty.onExit(({ exitCode, signal }) => {
        try {
          event.sender.send('terminal:exit', { terminalId, exitCode, signal });
        } catch {
          // ignore
        }
        try {
          const mm = getPtySessionMapForWebContentsId(event.sender.id);
          mm?.delete?.(terminalId);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }

    return {
      success: true,
      terminalId,
      cwd: cwdResolved,
      projectPath: currentProject,
      shell: used && used.file ? used.file : spec.file,
      shellArgs: used && used.args ? used.args : spec.args,
    };
  } catch (error) {
    return { success: false, error: error.message, terminalId: null };
  }
});

ipcMain.on('terminal:write', (event, payload = {}) => {
  try {
    const id = payload && payload.terminalId ? String(payload.terminalId) : '';
    const data = payload && typeof payload.data === 'string' ? payload.data : '';
    if (!id || !data) return;
    const entry = getPtyEntryForEvent(event, id);
    if (!entry || !entry.pty) return;
    entry.pty.write(data);
  } catch {
    // ignore
  }
});

ipcMain.on('terminal:resize', (event, payload = {}) => {
  try {
    const id = payload && payload.terminalId ? String(payload.terminalId) : '';
    const cols = Number(payload && payload.cols);
    const rows = Number(payload && payload.rows);
    if (!id) return;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    const c = Math.max(2, Math.min(500, Math.floor(cols)));
    const r = Math.max(2, Math.min(300, Math.floor(rows)));
    const entry = getPtyEntryForEvent(event, id);
    if (!entry || !entry.pty) return;
    entry.pty.resize(c, r);
  } catch {
    // ignore
  }
});

ipcMain.handle('terminal:kill', async (event, payload = {}) => {
  try {
    const terminalId = payload && payload.terminalId ? String(payload.terminalId) : '';
    if (!terminalId) return { success: false, error: 'Missing terminalId' };
    const m = getPtySessionMapForWebContentsId(event.sender.id);
    const entry = m?.get?.(terminalId) || null;
    if (!entry || !entry.pty) return { success: true, terminalId, alreadyClosed: true };
    try { entry.pty.kill(); } catch { /* ignore */ }
    try { m.delete(terminalId); } catch { /* ignore */ }
    return { success: true, terminalId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// (Removed) grep-search + cursor-search (agentic tooling)

// Git Changes
ipcMain.handle('get-git-changes', async (_event, includeContent = false) => {
  try {
    if (!currentProject) {
      return { success: false, error: 'No workspace folder open' };
    }

    const options = { cwd: currentProject, maxBuffer: 1024 * 1024 * 10 };

    // Get git status safely (no shell). Use -z to avoid path parsing ambiguity.
    const { stdout: statusOutputRaw } = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '-z'],
      options
    );

    const changes = {
      modified: [],
      added: [],
      deleted: [],
      untracked: []
    };

    // Parse NUL-delimited porcelain output.
    const tokens = String(statusOutputRaw || '').split('\0');
    for (let i = 0; i < tokens.length; i++) {
      const entry = tokens[i];
      if (!entry) continue;

      // Format: XY SP path (rename/copy add an extra NUL + newPath)
      const xy = entry.slice(0, 2);
      const status = xy.trim();
      let filePath = entry.length >= 4 ? entry.slice(3) : '';

      // Renames/copies include a second path token (destination).
      const isRenameOrCopy = xy.includes('R') || xy.includes('C');
      if (isRenameOrCopy) {
        const nextPath = tokens[i + 1];
        if (nextPath) {
          filePath = nextPath;
          i += 1;
        }
      }

      if (!filePath) continue;

      const fileInfo = { path: filePath };

      // Include diff content safely (no shell).
      if (includeContent && xy.includes('M')) {
        try {
          const { stdout: diff } = await execFileAsync('git', ['diff', 'HEAD', '--', filePath], options);
          fileInfo.diff = diff;
        } catch (_e) {
          // Ignore diff errors
        }
      }

      if (xy.includes('M') || xy.includes('R') || xy.includes('C')) {
        changes.modified.push(fileInfo);
      } else if (xy.includes('A')) {
        changes.added.push(fileInfo);
      } else if (xy.includes('D')) {
        changes.deleted.push(fileInfo);
      } else if (status === '??') {
        changes.untracked.push(fileInfo);
      }
    }

    const totalChanges = changes.modified.length + changes.added.length +
      changes.deleted.length + changes.untracked.length;

    return {
      success: true,
      changes,
      message: `📊 ${totalChanges} changed files`,
      totalChanges
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Read a file's contents at a given git revision (default: HEAD).
// Used by the Monaco diff viewer in the renderer.
ipcMain.handle('git-show-file', async (_event, payload = {}) => {
  try {
    if (!currentProject) return { success: false, error: 'No workspace folder open' };

    const rawRev = String(payload.rev || 'HEAD').trim() || 'HEAD';
    // Avoid option injection; allow common revspec characters only.
    if (
      rawRev.startsWith('-') ||
      rawRev.includes(':') ||
      !/^[0-9A-Za-z][0-9A-Za-z._~^/+-]{0,200}$/.test(rawRev)
    ) {
      return { success: false, error: 'Invalid rev' };
    }

    const abs = resolveInCurrentProject(payload.filePath);
    const rel = path.relative(requireCurrentProject(), abs).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { success: false, error: 'Invalid filePath (outside project)' };
    }

    const options = { cwd: currentProject, maxBuffer: 1024 * 1024 * 20 };
    const { stdout } = await execFileAsync('git', ['show', `${rawRev}:${rel}`], options);
    return { success: true, content: stdout, rev: rawRev, path: rel };
  } catch (error) {
    const msg = error?.stderr || error?.message || String(error);
    return { success: false, error: msg };
  }
});

// Git Related Files (Context Awareness)
ipcMain.handle('get-related-files', async (_event, filePath) => {
  try {
    if (!currentProject) {
      return { success: false, error: 'No workspace folder open' };
    }

    const options = { cwd: currentProject, maxBuffer: 1024 * 1024 * 10 };

    // Get relative path if absolute path provided
    let targetFile = filePath;
    if (path.isAbsolute(filePath)) {
      targetFile = path.relative(currentProject, filePath);
    }

    console.log(`[Git] Analyzing related files for: ${targetFile}`);

    const relatedFiles = [];
    const fileFrequency = {};
    let hasGitHistory = false;

    // 1. Try Git Analysis
    try {
      // Check if inside git repo first
      try {
        await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], options);
      } catch (_e) {
        console.log('[Git] Not a git repository. Initializing...');
        // Auto-initialize git repo as requested
        await execFileAsync('git', ['init'], options);
        // Stop git analysis here as there's no history yet
        throw new Error('Initialized new git repository');
      }

      // Get last 50 commits that modified this file
      // --follow handles renames
      const { stdout: commitsOut } = await execFileAsync(
        'git',
        ['log', '--pretty=format:%H', '-n', '50', '--follow', '--', String(targetFile || '')],
        options
      );

      const commits = commitsOut.split('\n').filter(Boolean);

      if (commits.length > 0) {
        hasGitHistory = true;
        const limit = Math.min(commits.length, 20); // Analyze max 20 commits deep for performance

        // For each commit, find what OTHER files were modified
        for (let i = 0; i < limit; i++) {
          const commit = commits[i];
          try {
            const { stdout: filesOut } = await execFileAsync(
              'git',
              ['show', '--pretty=', '--name-only', String(commit || '')],
              options
            );

            const files = filesOut.split('\n').filter(f => f.trim() && f.trim() !== targetFile);

            for (const file of files) {
              fileFrequency[file] = (fileFrequency[file] || 0) + 1;
            }
          } catch (_e) {
            // Ignore errors for individual commits
          }
        }

        // Sort by frequency and format
        const gitRelated = Object.entries(fileFrequency)
          .sort((a, b) => b[1] - a[1]) // Sort desc by count
          .slice(0, 10) // Top 10
          .map(([file, count]) => ({
            path: file,
            score: count,
            reason: `Edited together in ${count} commit(s)`
          }));

        relatedFiles.push(...gitRelated);
      }
    } catch (gitError) {
      // Not a git repo or other git error - ignore and proceed to pattern matching
      console.log('[Git] Skipping git analysis (not a repo or error):', gitError.message);
    }

    // 2. If no Git history, use currently changed files as related (GitHub Copilot strategy)
    if (!hasGitHistory || relatedFiles.length === 0) {
      try {
        const { stdout: statusOutRaw } = await execFileAsync('git', ['status', '--porcelain=v1', '-z'], options);
        const changedFiles = String(statusOutRaw || '')
          .split('\0')
          .filter(Boolean)
          .map((entry, idx, arr) => {
            // Parse git status format: "XY filename" (rename/copy adds a second entry with destination path)
            const xy = entry.slice(0, 2);
            let fp = entry.length >= 4 ? entry.slice(3) : '';
            const isRenameOrCopy = xy.includes('R') || xy.includes('C');
            if (isRenameOrCopy) {
              const nextPath = arr[idx + 1];
              if (nextPath) fp = nextPath;
            }
            return String(fp || '').trim();
          })
          .filter(file => file !== targetFile && file.length > 0);

        for (const file of changedFiles.slice(0, 10)) {
          if (!fileFrequency[file]) {
            relatedFiles.push({
              path: file,
              score: 50,
              reason: 'Currently modified (working together)'
            });
          }
        }
      } catch (e) {
        console.log('[Git] Could not get changed files:', e.message);
      }
    }

    // 3. Also check for test files (Pattern matching strategy)
    const testPatterns = [
      targetFile.replace(/\.(js|ts|jsx|tsx)$/, '.test.$1'),
      targetFile.replace(/\.(js|ts|jsx|tsx)$/, '.spec.$1'),
      targetFile.replace('/src/', '/test/'),
      targetFile.replace('/lib/', '/test/')
    ];

    // Check if test files exist
    for (const testFile of testPatterns) {
      if (testFile !== targetFile) {
        try {
          await fs.access(path.join(currentProject, testFile));
          // If exists and not already in list, add it with high priority
          if (!fileFrequency[testFile]) {
            relatedFiles.unshift({
              path: testFile,
              score: 100,
              reason: 'Corresponding test file'
            });
          }
        } catch (_e) {
          // File doesn't exist
        }
      }
    }

    return {
      success: true,
      files: relatedFiles,
      message: relatedFiles.length > 0
        ? `Found ${relatedFiles.length} related files`
        : 'No related files found'
    };

  } catch (error) {
    console.error('[Git] Error getting related files:', error);
    return { success: false, error: error.message };
  }
});

// (Removed) fetch-webpage + token counting + indexing IPC (agentic tooling)

// ============================================================================
// CLAUDE AGENT SDK (Claude Code) - IPC HANDLERS
// ============================================================================

ipcMain.handle('openrouter-describe-image', async (_event, payload = {}) => {
  try {
    const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
    const model = typeof payload.model === 'string' ? payload.model.trim() : '';
    const dataUrl = typeof payload.dataUrl === 'string' ? payload.dataUrl.trim() : '';
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';

    if (!apiKey) return { success: false, error: 'Missing OpenRouter API key' };
    if (!model) return { success: false, error: 'Missing OpenRouter model' };
    if (!dataUrl || !dataUrl.startsWith('data:')) return { success: false, error: 'Missing image data' };
    if (dataUrl.length > 30_000_000) return { success: false, error: 'Image too large for OpenRouter vision' };

    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt || 'Describe this image.' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.2
    };

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://codeon.ai',
        'X-Title': 'Codeon'
      },
      body: JSON.stringify(body)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = json && json.error && json.error.message ? json.error.message : `OpenRouter error (${res.status})`;
      return { success: false, error: errMsg };
    }

    const raw = json && json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : '';
    let text = '';
    if (Array.isArray(raw)) {
      text = raw.map(part => (part && typeof part.text === 'string' ? part.text : '')).filter(Boolean).join(' ').trim();
    } else if (raw && typeof raw.text === 'string') {
      text = raw.text.trim();
    } else if (typeof raw === 'string') {
      text = raw.trim();
    }
    if (!text) return { success: false, error: 'OpenRouter returned empty description' };
    return { success: true, description: text };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('claude-sdk-start', async (event, payload = {}) => {
  try {
    if (!currentProject) {
      return { success: false, error: 'No project folder is currently open. Please open a project folder first.' };
    }

    const requestId = String(payload.requestId || '').trim();
    const prompt = payload.prompt;
    const debugLogEnabled = payload && payload.debugLog === true;
    
    // OpenRouter provider support
    const useOpenRouter = payload.useOpenRouter === true;
    const openrouterApiKey = typeof payload.openrouterApiKey === 'string' ? payload.openrouterApiKey.trim() : '';
    const openrouterModel = typeof payload.openrouterModel === 'string' ? payload.openrouterModel.trim() : '';

    // Codex (ChatGPT-subscription) provider support
    const useCodex = payload.useCodex === true;
    const codexModel = typeof payload.codexModel === 'string' ? payload.codexModel.trim() : '';
    
    // If the renderer explicitly passes apiKey (even empty string), respect it:
    // - empty string => keyless flow (Claude.ai OAuth / stored auth)
    // - non-empty string => API key flow
    // If apiKey is omitted (undefined/null), fall back to env var for dev convenience.
    const apiKey =
      payload.apiKey == null
        ? String(process.env.ANTHROPIC_API_KEY || '').trim()
        : String(payload.apiKey || '').trim();
    let model = (payload && typeof payload.model === 'string') ? payload.model.trim() : '';
    if (model && model.toLowerCase() === 'default') model = '';
    const resumeSessionId = typeof payload.resumeSessionId === 'string' && payload.resumeSessionId.trim()
      ? payload.resumeSessionId.trim()
      : null;
    const resumeSessionAt = typeof payload.resumeSessionAt === 'string' && payload.resumeSessionAt.trim()
      ? payload.resumeSessionAt.trim()
      : null;
    const forkSession = payload.forkSession === true;
    const maxBudgetUsdRaw = payload && typeof payload.maxBudgetUsd !== 'undefined' ? Number(payload.maxBudgetUsd) : NaN;
    const maxBudgetUsd = (Number.isFinite(maxBudgetUsdRaw) && maxBudgetUsdRaw > 0) ? maxBudgetUsdRaw : null;
    // Permission modes (Claude Code-style). Keep backward compatibility with older payloads.
    const allowedPermissionModes = new Set(['plan', 'default', 'acceptEdits', 'bypassPermissions']);
    let permissionMode = (payload && typeof payload.permissionMode === 'string') ? payload.permissionMode.trim() : '';
    if (!allowedPermissionModes.has(permissionMode)) {
      const toolPermissionMode = (payload.toolPermissionMode === 'always_allow' || payload.toolPermissionMode === 'ask')
        ? payload.toolPermissionMode
        : 'ask';
      // Preserve legacy behavior:
      // - ask -> acceptEdits (edits allowed; prompts handled in our UI)
      // - always_allow -> bypassPermissions
      permissionMode = (toolPermissionMode === 'always_allow') ? 'bypassPermissions' : 'acceptEdits';
    }

    // Soft sandboxing: WebFetch network policy (allow_all | deny_all | allowlist)
    const allowedNetworkModes = new Set(['allow_all', 'deny_all', 'allowlist']);
    const rawNetwork = payload && payload.networkPolicy && typeof payload.networkPolicy === 'object' ? payload.networkPolicy : {};
    const networkModeRaw = rawNetwork && typeof rawNetwork.mode === 'string' ? rawNetwork.mode.trim() : '';
    const networkPolicyMode = allowedNetworkModes.has(networkModeRaw) ? networkModeRaw : 'allow_all';
    const networkAllowlist = Array.isArray(rawNetwork.allowlist)
      ? rawNetwork.allowlist.map(v => String(v || '').trim().toLowerCase()).filter(Boolean).slice(0, 200)
      : [];
    const networkPolicy = { mode: networkPolicyMode, allowlist: networkAllowlist };

    if (!requestId) return { success: false, error: 'Missing requestId' };
    if (typeof prompt !== 'string' || !prompt.trim()) return { success: false, error: 'Missing prompt' };

    // Codex provider gate: must be signed in, and the chosen model must be
    // serveable by this ChatGPT account (the backend 400s unknown models).
    if (useCodex) {
      try {
        const codexAuth = require('./codex/codex-auth');
        if (!codexAuth.hasCodexAuth()) {
          return { success: false, error: 'Codex is not connected. Sign in with ChatGPT in Settings.' };
        }
        const modelErr = await codexAuth.validateCodexModel(codexModel || 'codex/gpt-5.5');
        if (modelErr) return { success: false, error: modelErr };
      } catch (e) {
        return { success: false, error: `Codex provider error: ${e?.message || e}` };
      }
    }

    const projectRootForRun = currentProject;

    // Create per-run debug log file (opt-in via payload.debugLog).
    if (debugLogEnabled) {
      try {
        const dbg = await _createClaudeStreamDebugLogger({ baseDir: APP_ROOT, requestId });
        if (dbg) claudeStreamDebugByRequestId.set(requestId, dbg);
        dbg?.writeLine?.({
          at: Date.now(),
          iso: new Date().toISOString(),
          requestId,
          kind: 'ipc_claude_sdk_start_received',
          uiSessionId: (typeof payload.uiSessionId === 'string' ? payload.uiSessionId.trim() : null),
          model: (payload && typeof payload.model === 'string' ? payload.model.trim() : null),
          useOpenRouter: payload.useOpenRouter === true,
          openrouterModel: (payload && typeof payload.openrouterModel === 'string' ? payload.openrouterModel.trim() : null),
          promptLen: (typeof prompt === 'string' ? prompt.length : null),
          currentProject: projectRootForRun
        });
      } catch { /* ignore */ }
    }

    // MCP servers (from Codeon MCP tab) -> pass through to Claude Agent SDK so Claude Code can use them.
    // Stored in project: .codeon/mcp-config.json
    let mcpServersForSdk = null;
    try {
      const cfgPath = path.join(projectRootForRun, '.codeon', 'mcp-config.json');
      const raw = await fs.readFile(cfgPath, 'utf8').catch(() => null);
      if (raw) {
        const parsed = JSON.parse(String(raw || ''));
        const list = Array.isArray(parsed?.mcpServers) ? parsed.mcpServers : [];
        const out = {};
        const used = new Set();
        const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 48);
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          if (item.enabled === false) continue;
          const name = String(item.name || '').trim();
          
          // Use shorter key for Lens Studio to reduce tool name length
          let keyBase = slug(name) || slug(item.id) || `mcp-${Date.now()}`;
          if (_mcpIsLensStudioServer(item)) {
            keyBase = 'l';  // Ultra-short key: mcp__l__ToolName
          }
          
          let key = keyBase;
          for (let i = 0; used.has(key) && i < 50; i++) key = `${keyBase}-${i + 2}`;
          used.add(key);

          const type = String(item.type || 'stdio').trim();
          if (type === 'stdio') {
            const command = String(item.command || '').trim();
            if (!command) continue;
            out[key] = {
              type: 'stdio',
              command,
              args: Array.isArray(item.args) ? item.args.map(v => String(v)) : undefined,
              env: (item.env && typeof item.env === 'object') ? Object.fromEntries(Object.entries(item.env).map(([k, v]) => [String(k), String(v)])) : undefined
            };
          } else {
            const url = String(item.url || '').trim();
            if (!url) continue;
            let finalUrl = url;
            let headers = (item.headers && typeof item.headers === 'object')
              ? Object.fromEntries(Object.entries(item.headers).map(([k, v]) => [String(k), String(v)]))
              : undefined;
            
            // Check if this is Lens Studio MCP server (needs protocol version fix)
            if (_mcpIsLensStudioServer(item)) {
              console.log('[MCP] Detected Lens Studio server, starting internal proxy');
              const authHeader = headers?.Authorization || '';
              finalUrl = _mcpStartLensStudioProxy(url, authHeader);
              // Remove authorization header since proxy handles it
              if (headers) {
                delete headers.Authorization;
                if (Object.keys(headers).length === 0) headers = undefined;
              }
            }
            
            // Our UI currently labels HTTP servers as "sse"; for the SDK, prefer modern Streamable HTTP ("http").
            out[key] = { type: 'http', url: finalUrl, ...(headers ? { headers } : {}) };
          }
        }
        if (Object.keys(out).length > 0) mcpServersForSdk = out;
      }
    } catch (e) {
      console.warn('[MCP] Failed to load MCP config for Claude SDK:', e?.message || e);
    }

    // Build skill awareness section - exposes skill metadata to model for autonomous use
    const buildSkillAwareness = () => {
      try {
        const skillSummaries = Object.entries(BUILT_IN_SKILLS).map(([key, skill]) => {
          const name = skill.name || key;
          const whenToUse = skill.whenToUse || skill.description || '';
          return `- ${name}: ${whenToUse}`;
        });
        
        if (skillSummaries.length === 0) {
          console.log('[Skills] No built-in skills found');
          return '';
        }
        
        console.log(`[Skills] Injecting ${skillSummaries.length} skill summaries into prompt`);
        
        return [
          '# Quality Guidelines (Auto-Apply When Relevant)',
          'You have access to built-in quality guidelines. Apply them automatically based on context:',
          '',
          ...skillSummaries,
          '',
          'Apply these guidelines naturally when the task context matches. No explicit invocation needed.',
          ''
        ].join('\n');
      } catch (e) {
        console.error('[Skills] Error building skill awareness:', e);
        return '';
      }
    };

    const injectJustificationProtocol = (rawPrompt) => {
      const p = typeof rawPrompt === 'string' ? rawPrompt : String(rawPrompt || '');
      const trimmed = p.trim();
      // Avoid interfering with slash commands / auth flows.
      if (!trimmed) return p;
      if (/^\/\w+/.test(trimmed)) return p;

      // Help Claude Code discover configured MCP servers (names must match the mcpServers keys).
      const mcpHint = (() => {
        try {
          const keys = mcpServersForSdk && typeof mcpServersForSdk === 'object' ? Object.keys(mcpServersForSdk) : [];
          if (!keys.length) return '';
          return `MCP servers configured: ${keys.join(', ')}. Use these exact server names when using MCP.`;
        } catch {
          return '';
        }
      })();

      // Build skill awareness for the model
      const skillAwareness = buildSkillAwareness();

      const jp = [
        'Justification Protocol (JP v2)',
        '- Provide justifications ONLY for actions that mutate files, run commands, or access network.',
        '- For simple reads/listing, no justification needed.',
        '- When a justification is required, output ONE line immediately BEFORE the action, using:',
        '  JP: <node_type> | <target> | <why in <= 12 words> | outcome: <expected outcome in <= 10 words> | risk: <low|med|high>',
        '- Fields outcome/risk are optional, but risk is REQUIRED for Bash and destructive edits.',
        '- Use these node_type values:',
        '  - Edit (for Write/Edit/MultiEdit/NotebookEdit)',
        '  - Bash (for shell commands)',
        '  - WebFetch (for network requests)',
        '- Keep it factual; avoid generic filler.',
        ''
      ].join('\n');

      // Compose final prompt with skill awareness + justification protocol + MCP hints
      const preamble = [skillAwareness, jp, mcpHint].filter(Boolean).join('\n');
      return preamble ? `${preamble}\n\n${p}` : p;
    };

    const promptForSdk = injectJustificationProtocol(prompt);

    // Cancel any existing run with the same requestId
    const existing = activeClaudeQueries.get(requestId);
    if (existing) {
      try { existing.interrupt?.(); } catch (_e) { /* ignore */ }
      try { existing.abortController?.abort?.(); } catch (_e) { /* ignore */ }
      activeClaudeQueries.delete(requestId);
    }

    const sender = event.sender;
    // PERF: Avoid IPC storms during streaming/tool loops by batching high-frequency deltas.
    // Also ensures we don't repeatedly serialize large payloads on every token.
    const send = (() => {
      const FLUSH_MS = 45; // ~22fps max; renderer further throttles to ~11fps
      let flushTimer = null;
      let pendingText = '';
      let pendingThinking = '';
      let pendingSessionIdForText = null;
      let pendingSessionIdForThinking = null;

      const rawSend = (data) => {
        try {
          if (!sender || sender.isDestroyed?.()) return;
          try {
            const dbg = _debugLogForRequest(requestId);
            dbg?.writeLine?.({
              at: Date.now(),
              iso: new Date().toISOString(),
              requestId,
              kind: 'ipc_send',
              data: _sanitizeClaudeDebugEvent(data)
            });
          } catch { /* ignore */ }
          sender.send('claude-sdk-event', data);
        } catch (_e) { /* ignore */ }
      };

      const flush = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (pendingThinking) {
          const ev = {
            requestId,
            type: 'thinking_delta',
            sessionId: pendingSessionIdForThinking,
            thinkingDelta: pendingThinking
          };
          rawSend(ev);
          pendingThinking = '';
        }
        if (pendingText) {
          const ev = {
            requestId,
            type: 'text_delta',
            sessionId: pendingSessionIdForText,
            textDelta: pendingText
          };
          rawSend(ev);
          pendingText = '';
        }
      };

      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(flush, FLUSH_MS);
      };

      return (data) => {
        try {
          if (!data || typeof data !== 'object') return;
          const t = data.type;
          if (t === 'text_delta') {
            const d = (typeof data.textDelta === 'string') ? data.textDelta : '';
            if (d) {
              pendingText += d;
              if (data.sessionId) pendingSessionIdForText = data.sessionId;
              scheduleFlush();
              try {
                const dbg = _debugLogForRequest(requestId);
                dbg?.writeLine?.({
                  at: Date.now(),
                  iso: new Date().toISOString(),
                  requestId,
                  kind: 'enqueue_text_delta',
                  len: d.length
                });
              } catch { /* ignore */ }
              return;
            }
          }
          if (t === 'thinking_delta') {
            const d = (typeof data.thinkingDelta === 'string') ? data.thinkingDelta : '';
            if (d) {
              pendingThinking += d;
              if (data.sessionId) pendingSessionIdForThinking = data.sessionId;
              scheduleFlush();
              try {
                const dbg = _debugLogForRequest(requestId);
                dbg?.writeLine?.({
                  at: Date.now(),
                  iso: new Date().toISOString(),
                  requestId,
                  kind: 'enqueue_thinking_delta',
                  len: d.length
                });
              } catch { /* ignore */ }
              return;
            }
          }

          // Maintain ordering: flush deltas before any other event type.
          flush();
          try {
            const dbg = _debugLogForRequest(requestId);
            dbg?.writeLine?.({
              at: Date.now(),
              iso: new Date().toISOString(),
              requestId,
              kind: 'ipc_send_unbatched',
              data: _sanitizeClaudeDebugEvent(data)
            });
          } catch { /* ignore */ }
          rawSend(data);
        } catch (_e) {
          // ignore
        }
      };
    })();

    const sendTimeline = (data) => {
      try {
        if (!sender || sender.isDestroyed?.()) return;
        sender.send('execution-timeline-event', data);
      } catch (_e) { /* ignore */ }
    };

    // AET run metadata (renderer should supply uiSessionId so timelines can be filtered per chat)
    const uiSessionId = typeof payload.uiSessionId === 'string' ? payload.uiSessionId.trim() : '';
    const restoreCheckpointHash = typeof payload.restoreCheckpointHash === 'string' ? payload.restoreCheckpointHash.trim() : '';
    const agentName = typeof payload.agentName === 'string' ? payload.agentName.trim() : 'Claude';
    const aetParentRunId = typeof payload.aetParentRunId === 'string' ? payload.aetParentRunId.trim() : '';
    const aetParentNodeId = typeof payload.aetParentNodeId === 'string' ? payload.aetParentNodeId.trim() : '';
    const aetIntervention = payload && typeof payload.aetIntervention === 'object' ? payload.aetIntervention : null;
    let executionRunId = null;
    try {
      const run = await _aetCreateRun(projectRootForRun, {
        sessionId: uiSessionId || null,
        agentName,
        requestId,
        model: model || null,
        permissionMode,
        networkPolicy,
        meta: {
          resumeSessionId,
          resumeSessionAt,
          forkSession,
          ...(maxBudgetUsd != null ? { maxBudgetUsd } : {}),
          networkPolicyMode,
          networkAllowlistCount: networkAllowlist.length,
          ...(restoreCheckpointHash ? { restoreCheckpointHash } : {})
        },
        parentRunId: aetParentRunId || null,
        parentNodeId: aetParentNodeId || null
      });
      executionRunId = run.id;
      activeExecutionTimelineRunByRequestId.set(requestId, executionRunId);
      sendTimeline({ kind: 'run_created', sessionId: uiSessionId || null, run });

      // Optional: checkpoint commit hash created right before this message (used for Restore & Retry).
      if (restoreCheckpointHash) {
        const ckNode = _aetBuildNode({
          runId: executionRunId,
          type: 'CheckpointCreated',
          gitCheckpointHash: restoreCheckpointHash,
          payload: {
            title: 'Checkpoint created',
            reason: 'Before user message',
            commitHash: restoreCheckpointHash
          }
        });
        const saved = await _aetAppendNode(projectRootForRun, executionRunId, ckNode);
        if (saved) sendTimeline({ kind: 'node', sessionId: uiSessionId || null, runId: executionRunId, node: saved });
      }

      // Record the user's action that triggered the run (avoid storing full prompt).
      const promptStr = typeof prompt === 'string' ? prompt : '';
      const firstLine = promptStr.split('\n')[0] || '';
      const userNode = _aetBuildNode({
        runId: executionRunId,
        type: 'UserIntervention',
        payload: {
          title: 'User prompt sent',
          promptFirstLine: _aetTruncStr(firstLine, 220),
          promptChars: promptStr.length
        }
      });
      const savedUser = await _aetAppendNode(projectRootForRun, executionRunId, userNode);
      if (savedUser) sendTimeline({ kind: 'node', sessionId: uiSessionId || null, runId: executionRunId, node: savedUser });

      // Optional: explicit intervention marker (Retry/Fork/etc). Keep it separate from the prompt node.
      if (aetIntervention && typeof aetIntervention === 'object') {
        const subtype = typeof aetIntervention.subtype === 'string' ? aetIntervention.subtype.trim() : '';
        const title = typeof aetIntervention.title === 'string' ? aetIntervention.title.trim() : '';
        const node = _aetBuildNode({
          runId: executionRunId,
          type: 'UserIntervention',
          payload: {
            title: title || (subtype ? `Intervention: ${subtype}` : 'Intervention'),
            subtype: subtype || null,
            parentRunId: aetParentRunId || null,
            parentNodeId: aetParentNodeId || null,
            anchorCheckpointHash: typeof aetIntervention.anchorCheckpointHash === 'string' ? aetIntervention.anchorCheckpointHash.trim() : null,
            note: typeof aetIntervention.note === 'string' ? aetIntervention.note.trim() : null,
            target: aetIntervention.target && typeof aetIntervention.target === 'object' ? aetIntervention.target : null
          }
        });
        const saved = await _aetAppendNode(projectRootForRun, executionRunId, node);
        if (saved) sendTimeline({ kind: 'node', sessionId: uiSessionId || null, runId: executionRunId, node: saved });
      }
    } catch (e) {
      // AET is best-effort; never block runs.
      console.warn('[AET] Failed to start run:', e?.message || String(e));
      executionRunId = null;
    }

    send({ requestId, type: 'started' });

    const requestUserPermission = ({ toolName, input }) => {
      const permissionRequestId = `${requestId}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      return new Promise((resolve) => {
        pendingClaudeToolPermissions.set(permissionRequestId, { resolve, requestId });

        // AET: permission prompt event
        try {
          if (executionRunId) {
            const isPause = String(toolName || '') === '__PAUSE_BEFORE_TOOL__';
            const nextToolName =
              isPause && input && typeof input === 'object' && typeof input.nextToolName === 'string'
                ? input.nextToolName
                : '';
            const node = _aetBuildNode({
              runId: executionRunId,
              type: 'UserIntervention',
              payload: {
                title: isPause ? `Paused before tool: ${nextToolName || 'tool'}` : `Permission requested: ${toolName}`,
                toolName: toolName || null,
                inputPreview: _aetTruncStr(JSON.stringify(input || null), 1200)
              }
            });
            _aetAppendNode(projectRootForRun, executionRunId, node)
              .then((saved) => { if (saved) sendTimeline({ kind: 'node', sessionId: uiSessionId || null, runId: executionRunId, node: saved }); })
              .catch(() => {});
          }
        } catch {
          // ignore
        }

        send({
          requestId,
          type: 'permission_request',
          permissionRequestId,
          toolName,
          input: input || null
        });
        try {
          aetDebugLog('permission_request', { requestId, permissionRequestId, toolName: toolName || null, uiSessionId: uiSessionId || null });
        } catch { /* ignore */ }
        // Timeout to avoid deadlocks if the UI never responds.
        const timeoutMs = toolName === 'AskUserQuestion' ? 10 * 60_000 : 60_000;
        setTimeout(() => {
          const pending = pendingClaudeToolPermissions.get(permissionRequestId);
          if (pending) {
            pendingClaudeToolPermissions.delete(permissionRequestId);
            resolve(false);
          }
        }, timeoutMs);
      });
    };

    const { startClaudeSdkQuery } = _getClaudeSdk();
    const { abortController, interrupt } = await startClaudeSdkQuery({
      requestId,
      prompt: promptForSdk,
      projectRoot: projectRootForRun,
      apiKey,
      model,
      useOpenRouter,
      openrouterApiKey,
      openrouterModel,
      useCodex,
      codexModel,
      mcpServers: mcpServersForSdk,
      resumeSessionId,
      resumeSessionAt,
      forkSession,
      uiSessionId: uiSessionId || null,
      permissionMode,
      resumePermissionMode: (payload && typeof payload.resumePermissionMode === 'string') ? payload.resumePermissionMode : '',
      networkPolicy,
      maxBudgetUsd,
      requestUserPermission,
      onEvent: (evt) => {
        try {
          const dbg = _debugLogForRequest(requestId);
          dbg?.writeLine?.({
            at: Date.now(),
            iso: new Date().toISOString(),
            requestId,
            kind: 'from_sdk_onEvent',
            data: _sanitizeClaudeDebugEvent(evt)
          });
        } catch { /* ignore */ }
        // JP events are internal-only (used for AET justification matching). Do not show in chat UI.
        if (!(evt && evt.type === 'jp')) {
          send(evt);
        }
        // AET: normalize + persist events
        try {
          if (executionRunId) {
            void _aetHandleClaudeSdkEvent(projectRootForRun, { runId: executionRunId, uiSessionId, emitToRenderer: sendTimeline }, evt);
          }
        } catch {
          // ignore
        }
        if (evt && (evt.type === 'done' || evt.type === 'error' || evt.type === 'result')) {
          activeClaudeQueries.delete(requestId);
          try {
            const dbg = _debugLogForRequest(requestId);
            dbg?.writeLine?.({
              at: Date.now(),
              iso: new Date().toISOString(),
              requestId,
              kind: 'terminal_event_seen',
              type: evt.type
            });
          } catch { /* ignore */ }
          try {
            const dbg = _debugLogForRequest(requestId);
            dbg?.close?.();
          } catch { /* ignore */ }
          try { claudeStreamDebugByRequestId.delete(requestId); } catch { /* ignore */ }
        }
      }
    });

    activeClaudeQueries.set(requestId, { abortController, interrupt });
    const dbgPath = (() => {
      try {
        const dbg = _debugLogForRequest(requestId);
        return dbg && dbg.filePath ? dbg.filePath : null;
      } catch { return null; }
    })();
    return { success: true, requestId, ...(dbgPath ? { debugLogPath: dbgPath } : {}) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Renderer can append milestones to the current request's debug log (opt-in).
ipcMain.handle('claude-sdk-debug-log', async (_event, payload = {}) => {
  try {
    const requestId = String(payload.requestId || '').trim();
    if (!requestId) return { success: false, error: 'Missing requestId' };
    const dbg = _debugLogForRequest(requestId);
    if (!dbg) return { success: false, error: 'No active debug logger for requestId' };
    const kind = String(payload.kind || '').trim() || 'renderer_milestone';
    const data = payload && typeof payload.data === 'object' ? payload.data : { message: payload.message };
    dbg.writeLine({
      at: Date.now(),
      iso: new Date().toISOString(),
      requestId,
      kind,
      data: redactDeep(data)
    });
    return { success: true, requestId };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('claude-sdk-cancel', async (_event, requestId) => {
  try {
    const id = String(requestId || '').trim();
    if (!id) return { success: false, error: 'Missing requestId' };
    const entry = activeClaudeQueries.get(id);
    if (entry) {
      // Prefer hard interrupt when available (prevents background tool execution continuing).
      try { entry.interrupt?.(); } catch (_e) { /* ignore */ }
      try { entry.abortController?.abort?.(); } catch (_e) { /* ignore */ }
      activeClaudeQueries.delete(id);
      // AET: mark run cancelled
      try {
        const runId = activeExecutionTimelineRunByRequestId.get(id);
        activeExecutionTimelineRunByRequestId.delete(id);
        if (runId && currentProject) {
          const endTime = Date.now();
          await _aetUpdateRun(currentProject, runId, { status: 'cancelled', endTime });
          try {
            const node = _aetBuildNode({
              runId,
              type: 'UserIntervention',
              payload: { title: 'Run cancelled', subtype: 'cancel', requestId: id }
            });
            const saved = await _aetAppendNode(currentProject, runId, node);
            if (saved) {
              try {
                if (_event && _event.sender && !_event.sender.isDestroyed?.()) {
                  _event.sender.send('execution-timeline-event', { kind: 'node', runId, node: saved });
                } else if (mainWindow && !mainWindow.isDestroyed?.()) {
                  mainWindow.webContents.send('execution-timeline-event', { kind: 'node', runId, node: saved });
                }
              } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
          try {
            aetDebugLog('run_cancelled', { requestId: id, runId, endTime });
          } catch { /* ignore */ }
          try {
            if (_event && _event.sender && !_event.sender.isDestroyed?.()) {
              _event.sender.send('execution-timeline-event', { kind: 'run_update', runId, patch: { status: 'cancelled', endTime } });
            } else if (mainWindow && !mainWindow.isDestroyed?.()) {
              mainWindow.webContents.send('execution-timeline-event', { kind: 'run_update', runId, patch: { status: 'cancelled', endTime } });
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      return { success: true, requestId: id };
    }
    return { success: true, requestId: id, message: 'No active query' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('claude-sdk-permission-response', async (_event, payload = {}) => {
  try {
    const permissionRequestId = String(payload.permissionRequestId || '').trim();
    const requestId = String(payload.requestId || '').trim();
    const allow = payload.allow === true;
    const toolName = typeof payload.toolName === 'string' ? payload.toolName.trim() : '';
    const answers =
      payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers)
        ? payload.answers
        : null;
    if (!permissionRequestId || !requestId) return { success: false, error: 'Missing permissionRequestId/requestId' };

    const pending = pendingClaudeToolPermissions.get(permissionRequestId);
    if (!pending) return { success: false, error: 'No pending permission request' };
    if (pending.requestId !== requestId) return { success: false, error: 'Mismatched requestId' };

    pendingClaudeToolPermissions.delete(permissionRequestId);
    try { pending.resolve(answers ? { allow, answers } : allow); } catch (_e) { /* ignore */ }

    try {
      aetDebugLog('permission_response', { requestId, permissionRequestId, toolName: toolName || null, allow: !!allow });
    } catch { /* ignore */ }

    // AET: record the user's decision
    try {
      const runId = activeExecutionTimelineRunByRequestId.get(requestId);
      if (runId && currentProject) {
        const isPause = toolName === '__PAUSE_BEFORE_TOOL__';
        const node = _aetBuildNode({
          runId,
          type: 'UserIntervention',
          payload: {
            title: isPause ? (allow ? 'Paused: Continue' : 'Paused: Skip tool') : (allow ? 'Permission allowed' : 'Permission denied'),
            permissionRequestId,
            allow,
            ...(toolName ? { toolName } : {})
          }
        });
        const saved = await _aetAppendNode(currentProject, runId, node);
        if (saved) {
          try {
            if (_event && _event.sender && !_event.sender.isDestroyed?.()) {
              _event.sender.send('execution-timeline-event', { kind: 'node', runId, node: saved });
            } else if (mainWindow && !mainWindow.isDestroyed?.()) {
              mainWindow.webContents.send('execution-timeline-event', { kind: 'node', runId, node: saved });
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================================================
// Utility IPC Handlers (for MCP and other features)
// ============================================================================

ipcMain.handle('path-join', async (_event, args) => {
  return path.join(...args);
});

ipcMain.handle('fs-exists', async (_event, filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('fs-mkdir', async (_event, dirPath, options) => {
  try {
    await fs.mkdir(dirPath, options);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================================================
// MCP (Model Context Protocol) Server Management
// ============================================================================

// Store active MCP server connections
const mcpServerConnections = new Map(); // serverId -> { kind, status, capabilities, client?, transport?, process? }

// Lens Studio MCP internal proxy
let lensStudioProxyServer = null;
const LENS_STUDIO_PROXY_PORT = 8733;

// MCP SDK (supports stdio + Streamable HTTP + SSE fallback)
// IMPORTANT: This package uses export maps; include the `.js` extension for subpath requires.
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

function _mcpNormalizeHeaders(h) {
  try {
    if (!h || typeof h !== 'object') return undefined;
    const out = {};
    for (const [k, v] of Object.entries(h)) {
      const key = String(k || '').trim();
      if (!key) continue;
      const val = (v == null) ? '' : String(v);
      out[key] = val;
    }
    return out;
  } catch {
    return undefined;
  }
}

function _mcpClientInfo() {
  try {
    return {
      name: 'codeon-mcp-client',
      version: String(app?.getVersion?.() || '1.0.0')
    };
  } catch {
    return { name: 'codeon-mcp-client', version: '1.0.0' };
  }
}

function _mcpExtractHttpStatusFromError(err) {
  try {
    const direct = Number(
      err?.status ??
      err?.statusCode ??
      err?.response?.status ??
      err?.cause?.status ??
      err?.cause?.statusCode ??
      err?.code
    );
    if (Number.isFinite(direct) && direct >= 100 && direct <= 599) return direct;
  } catch { /* ignore */ }

  try {
    const msg = String(err?.message || '');
    // MCP SDK often formats errors like: "Error POSTing to endpoint (HTTP 401): ..."
    const m = msg.match(/\bHTTP\s+(\d{3})\b/i);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 100 && n <= 599) return n;
    }
  } catch { /* ignore */ }

  return 0;
}

function _mcpFormatConnectError(err) {
  try {
    const msg = String(err?.message || err || 'Connection failed');
    const cause = err?.cause;
    const code = cause?.code || err?.code;
    const detail = (code || cause?.message) ? ` (${String(code || cause?.message)})` : '';
    return `${msg}${detail}`;
  } catch {
    return 'Connection failed';
  }
}

// Detect if this is a Lens Studio MCP server (which uses custom protocol version 2025-06-18)
function _mcpIsLensStudioServer(serverConfig) {
  const url = String(serverConfig.url || '').toLowerCase();
  const name = String(serverConfig.name || '').toLowerCase();
  const id = String(serverConfig.id || '').toLowerCase();
  
  // IMPORTANT: Don't detect our own proxy as Lens Studio (prevents infinite recursion)
  if (name.includes('proxy') || id.includes('proxy') || url.includes(':8733')) {
    return false;
  }
  
  // Check if URL points to Lens Studio's default port or contains lens-studio
  if (url.includes(':8732') || url.includes('lens-studio') || url.includes('lensstudio')) {
    return true;
  }
  
  // Check server name/id
  if (name.includes('lens-studio') || name.includes('lensstudio') || 
      id.includes('lens-studio') || id.includes('lensstudio')) {
    return true;
  }
  
  return false;
}

// Start internal Lens Studio MCP proxy server (translates protocol version 2025-06-18)
// This proxy implements Streamable HTTP protocol while Lens Studio only supports simple POST
function _mcpStartLensStudioProxy(targetUrl, targetToken) {
  if (lensStudioProxyServer) {
    return `http://localhost:${LENS_STUDIO_PROXY_PORT}`;
  }
  
  const http = require('http');
  
  // Store for SSE connections (though Lens Studio doesn't push events, we need to implement the protocol)
  const sseConnections = new Map();
  
  lensStudioProxyServer = http.createServer(async (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, Last-Event-ID, Accept');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    // Handle GET requests for SSE (Server-Sent Events) - required by Streamable HTTP transport
    if (req.method === 'GET') {
      console.log('[MCP] Lens Studio proxy: Starting SSE connection');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      
      // Keep connection alive with heartbeat
      const connectionId = Date.now().toString();
      sseConnections.set(connectionId, res);
      
      // Send keepalive every 30 seconds
      const heartbeat = setInterval(() => {
        if (!res.destroyed) {
          res.write(':\n\n'); // SSE comment (heartbeat)
        } else {
          clearInterval(heartbeat);
          sseConnections.delete(connectionId);
        }
      }, 30000);
      
      req.on('close', () => {
        clearInterval(heartbeat);
        sseConnections.delete(connectionId);
        console.log('[MCP] Lens Studio proxy: SSE connection closed');
      });
      
      return;
    }
    
    // Handle POST requests for JSON-RPC
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      
      req.on('end', async () => {
        try {
          let requestBody = body;
          
          // If this is an initialize request, rewrite protocol version
          if (body) {
            try {
              const parsedBody = JSON.parse(body);
              if (parsedBody.method === 'initialize' && parsedBody.params) {
                console.log('[MCP] Lens Studio proxy: rewriting initialize request to use protocol 2025-06-18');
                parsedBody.params.protocolVersion = '2025-06-18';
                requestBody = JSON.stringify(parsedBody);
              }
            } catch { /* ignore */ }
          }
          
          // Forward to Lens Studio with custom protocol version
          const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': targetToken,
              'MCP-Protocol-Version': '2025-06-18'
            },
            body: requestBody
          });
          
          const responseText = await response.text();
          let responseData;
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = { jsonrpc: '2.0', error: { code: -32000, message: responseText } };
          }
          
          res.writeHead(response.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responseData));
        } catch (error) {
          console.error('[MCP] Lens Studio proxy error:', error);
          const errorResponse = {
            jsonrpc: '2.0',
            error: { code: -32603, message: error.message }
          };
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(errorResponse));
        }
      });
      return;
    }
    
    // Other methods
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Lens Studio MCP Internal Proxy');
  });
  
  lensStudioProxyServer.listen(LENS_STUDIO_PROXY_PORT, 'localhost', () => {
    console.log(`[MCP] Lens Studio internal proxy started on port ${LENS_STUDIO_PROXY_PORT}`);
  });
  
  lensStudioProxyServer.on('error', (error) => {
    console.error('[MCP] Lens Studio proxy server error:', error);
    lensStudioProxyServer = null;
  });
  
  return `http://localhost:${LENS_STUDIO_PROXY_PORT}`;
}

// Note: Lens Studio connections now use the internal proxy server (_mcpStartLensStudioProxy)
// instead of custom fetch wrappers, since Lens Studio doesn't fully support streaming protocols

async function _mcpConnectHttpLike(serverConfig) {
  const headers = _mcpNormalizeHeaders(serverConfig.headers);
  const isLensStudio = _mcpIsLensStudioServer(serverConfig);
  
  // For Lens Studio, redirect through internal proxy (it doesn't support streaming protocols)
  if (isLensStudio) {
    console.log('[MCP] Detected Lens Studio - redirecting through internal proxy');
    const url = String(serverConfig.url || '').trim();
    const authHeader = headers?.Authorization || headers?.authorization || '';
    const proxyUrl = _mcpStartLensStudioProxy(url, authHeader);
    
    // Create modified config that points to proxy
    // IMPORTANT: Clear name/id to prevent infinite recursion (detection checks name/id too!)
    const modifiedConfig = {
      ...serverConfig,
      name: 'lens-studio-proxy',
      id: serverConfig.id ? `${serverConfig.id}-proxy` : 'lens-studio-proxy',
      url: proxyUrl,
      headers: Object.fromEntries(
        Object.entries(headers || {}).filter(([k]) => k.toLowerCase() !== 'authorization')
      )
    };
    
    // Recursively call with proxy URL (won't be detected as Lens Studio anymore)
    return _mcpConnectHttpLike(modifiedConfig);
  }
  
  // Build transport options
  const transportOptions = {};
  
  // Add headers as requestInit
  if (headers) {
    transportOptions.requestInit = { headers };
  }
  
  const opts = Object.keys(transportOptions).length > 0 ? transportOptions : undefined;

  // Prefer modern Streamable HTTP, fall back to legacy SSE when the server rejects streamable HTTP (often 4xx/405).
  // Note: the MCP SDK frequently embeds the HTTP status in the error message instead of `error.status`.
  const tryUrl = async (baseUrl) => {
    try {
      const client = new Client(_mcpClientInfo());
      const transport = new StreamableHTTPClientTransport(baseUrl, opts);
      await client.connect(transport);
      return { kind: 'streamableHttp', client, transport, capabilities: client.getServerCapabilities?.() };
    } catch (error) {
      const status = _mcpExtractHttpStatusFromError(error);
      const is4xx = Number.isFinite(status) && status >= 400 && status < 500;
      // If it's not an HTTP rejection, propagate (e.g. DNS/ECONNREFUSED).
      if (!is4xx) throw error;

      const client = new Client(_mcpClientInfo());
      const transport = new SSEClientTransport(baseUrl, opts);
      await client.connect(transport);
      return { kind: 'sse', client, transport, capabilities: client.getServerCapabilities?.() };
    }
  };

  const rawUrl = String(serverConfig.url || '').trim();
  const baseUrl = new URL(rawUrl);

  // Common localhost pitfall: many local servers bind only to IPv4 (127.0.0.1) and refuse IPv6 (::1).
  // Some fetch stacks don't "Happy Eyeballs" fallback correctly, which manifests as `TypeError: fetch failed`.
  // To make this deterministic, when the user config says "localhost" we try IPv4 first, then the original hostname.
  const candidates = [];
  if (baseUrl.hostname === 'localhost') {
    const ipv4 = new URL(baseUrl.toString());
    ipv4.hostname = '127.0.0.1';
    candidates.push(ipv4);
  }
  candidates.push(baseUrl);

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      return await tryUrl(candidate);
    } catch (error) {
      lastErr = error;
      // If this was the original hostname and it failed, keep looping; we'll surface the last error below.
      continue;
    }
  }
  throw lastErr || new Error('MCP connection failed');
}

// Connect to MCP server
ipcMain.handle('mcp-connect', async (_event, serverConfig) => {
  try {
    const cfg = serverConfig && typeof serverConfig === 'object' ? serverConfig : {};
    const serverId = cfg.id;
    if (!serverId) {
      return { success: false, error: 'Server ID is required' };
    }

    // Check if already connected
    if (mcpServerConnections.has(serverId)) {
      const existing = mcpServerConnections.get(serverId);
      if (existing.status === 'connected') {
        return { success: true, capabilities: existing.capabilities };
      }
    }

    const type = String(cfg.type || 'stdio').trim();

    if (type === 'stdio') {
      const command = String(cfg.command || '').trim();
      if (!command) return { success: false, error: 'Missing command' };

      const client = new Client(_mcpClientInfo());
      const transport = new StdioClientTransport({
        command,
        args: Array.isArray(cfg.args) ? cfg.args.map(a => String(a)) : [],
        env: (cfg.env && typeof cfg.env === 'object') ? cfg.env : undefined,
        cwd: currentProject || process.cwd()
      });
      await client.connect(transport);
      const capabilities = client.getServerCapabilities?.();

      mcpServerConnections.set(serverId, {
        kind: 'stdio',
        status: 'connected',
        capabilities,
        client,
        transport,
        config: cfg
      });
      return { success: true, capabilities };
    }

    // Accept both "http" and the UI's older label "sse"
    if (type === 'http' || type === 'sse') {
      const url = String(cfg.url || '').trim();
      if (!url) return { success: false, error: 'Missing server URL' };

      const conn = await _mcpConnectHttpLike(cfg);
      mcpServerConnections.set(serverId, {
        kind: conn.kind,
        status: 'connected',
        capabilities: conn.capabilities,
        client: conn.client,
        transport: conn.transport,
        config: cfg
      });
      return { success: true, capabilities: conn.capabilities };
    }

    return { success: false, error: `Invalid server type: ${type}` };
  } catch (error) {
    console.error('[MCP] Connection error:', error);
    return { success: false, error: _mcpFormatConnectError(error) };
  }
});

// Disconnect from MCP server
ipcMain.handle('mcp-disconnect', async (_event, serverId) => {
  try {
    const connection = mcpServerConnections.get(serverId);
    if (!connection) {
      return { success: true }; // Already disconnected
    }

    // Close SDK client/transport if present
    try {
      if (connection.client && typeof connection.client.close === 'function') {
        await connection.client.close();
      }
    } catch (err) {
      console.warn('[MCP] Failed to close MCP client:', err);
    }
    // Back-compat: if any legacy process exists
    try { connection.process?.kill?.(); } catch { /* ignore */ }

    mcpServerConnections.delete(serverId);
    console.log('[MCP] Disconnected from server:', serverId);
    
    return { success: true };
  } catch (error) {
    console.error('[MCP] Disconnect error:', error);
    return { success: false, error: error.message };
  }
});

// List available tools from MCP server
ipcMain.handle('mcp-list-tools', async (_event, serverId) => {
  try {
    const connection = mcpServerConnections.get(serverId);
    if (!connection || connection.status !== 'connected') {
      return { success: false, error: 'Server not connected', tools: [] };
    }

    if (connection.client && typeof connection.client.listTools === 'function') {
      const out = await connection.client.listTools();
      return { success: true, tools: out?.tools || [] };
    }
    return { success: false, error: 'MCP client not available', tools: [] };
  } catch (error) {
    console.error('[MCP] List tools error:', error);
    return { success: false, error: error.message, tools: [] };
  }
});

// List available resources from MCP server
ipcMain.handle('mcp-list-resources', async (_event, serverId) => {
  try {
    const connection = mcpServerConnections.get(serverId);
    if (!connection || connection.status !== 'connected') {
      return { success: false, error: 'Server not connected', resources: [] };
    }

    if (connection.client && typeof connection.client.listResources === 'function') {
      const out = await connection.client.listResources();
      return { success: true, resources: out?.resources || [] };
    }
    return { success: false, error: 'MCP client not available', resources: [] };
  } catch (error) {
    console.error('[MCP] List resources error:', error);
    return { success: false, error: error.message, resources: [] };
  }
});

// Call a tool on an MCP server
ipcMain.handle('mcp-call-tool', async (_event, payload = {}) => {
  try {
    const serverId = String(payload.serverId || '').trim();
    const toolName = String(payload.name || '').trim();
    const args = (payload.arguments && typeof payload.arguments === 'object') ? payload.arguments : {};
    if (!serverId || !toolName) return { success: false, error: 'Missing serverId/name' };

    const connection = mcpServerConnections.get(serverId);
    if (!connection || connection.status !== 'connected' || !connection.client) {
      return { success: false, error: 'Server not connected' };
    }
    const result = await connection.client.callTool({ name: toolName, arguments: args });
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Read a resource from an MCP server
ipcMain.handle('mcp-read-resource', async (_event, payload = {}) => {
  try {
    const serverId = String(payload.serverId || '').trim();
    const uri = String(payload.uri || '').trim();
    if (!serverId || !uri) return { success: false, error: 'Missing serverId/uri' };

    const connection = mcpServerConnections.get(serverId);
    if (!connection || connection.status !== 'connected' || !connection.client) {
      return { success: false, error: 'Server not connected' };
    }
    const result = await connection.client.readResource({ uri });
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Cleanup MCP connections on app quit
app.on('before-quit', () => {
  try {
    for (const [serverId, connection] of mcpServerConnections.entries()) {
      try {
        if (connection.client && typeof connection.client.close === 'function') {
          // best-effort; don't await to avoid blocking quit
          connection.client.close().catch(() => {});
        }
        try { connection.process?.kill?.(); } catch { /* ignore */ }
      } catch (err) {
        console.warn('[MCP] Failed to cleanup connection:', serverId, err);
      }
    }
    mcpServerConnections.clear();
    
    // Stop Lens Studio proxy server
    if (lensStudioProxyServer) {
      try {
        lensStudioProxyServer.close();
        console.log('[MCP] Lens Studio proxy server stopped');
      } catch (err) {
        console.warn('[MCP] Failed to stop Lens Studio proxy:', err);
      }
      lensStudioProxyServer = null;
    }
  } catch (err) {
    console.error('[MCP] Cleanup error:', err);
  }
});

// App lifecycle
app.whenReady().then(async () => {
  // Bootstrap built-in skills (quality guidelines) before showing window
  await ensureBuiltInSkills();
  createWindow();
});

// On macOS (and sometimes during fast closes), renderer 'beforeunload' is not reliable.
// Flush persisted state (chat history + uiMetadata) before we actually quit.
app.on('before-quit', (e) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed?.()) return;
    if (pendingFlushThen) return; // already flushing
    e.preventDefault();
    // Best-effort: flush AET to disk before quitting (prevents losing most of a run on crash/quit).
    try { if (currentProject) _aetFlushSave(currentProject).catch(() => {}); } catch { /* ignore */ }
    requestRendererFlushThen(() => {
      // Also flush workspace KV state (sql.js) before exiting.
      try {
        const deadlineMs = Date.now() + 1500;
        const flushAll = async () => {
          const tasks = [];
          for (const st of workspaceKvStatesById.values()) {
            if (!st) continue;
            tasks.push(_queueWorkspaceKvFlush(st, { force: true }));
          }
          // Race with a small deadline so quit can never hang indefinitely.
          await Promise.race([
            Promise.allSettled(tasks),
            new Promise((resolve) => setTimeout(resolve, Math.max(0, deadlineMs - Date.now())))
          ]);
          // Close db handles (best-effort).
          for (const st of workspaceKvStatesById.values()) {
            try { st.db?.close?.(); } catch { /* ignore */ }
            st.db = null;
          }
        };
        flushAll().finally(() => {
          try { app.exit(0); } catch { /* ignore */ }
        });
      } catch {
        try { app.exit(0); } catch { /* ignore */ }
      }
    });
  } catch {
    // ignore
  }
});

app.on('window-all-closed', () => {
  stopWorkspaceWatcher();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});



