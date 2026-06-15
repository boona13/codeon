// ---- CHUNK 1/7 from hoisted.js (AST statement boundaries; order preserved) ----
// ---- GENERATED: hoisted declarations extracted from app/editor/editor-tabs.js ----
 // { [relPath: string]: { diffContent: string, timestamp: number } }

function getLastApplyBeforeCommitForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !chatSessions || !chatSessions[sid]) return '';
  // Fast path: persisted field on the session object
  const direct = String(chatSessions[sid].lastApplyBeforeCommit || '').trim();
  if (direct) return direct;
  // Fallback: scan timeline for latest apply_review
  try {
    const msgs = ensureSessionMessages(sid);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === 'apply_review') {
        const before = String(m.beforeCommit || '').trim();
        if (before) return before;
      }
    }
  } catch { /* ignore */ }
  return '';
}


function getDiffHighlightsClearedAt(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return 0;
  const v = chatSessions && chatSessions[sid] ? chatSessions[sid].diffHighlightsClearedAt : 0;
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}


function getDiffHighlightsGlobalClearedAt() {
  const v = settings && typeof settings.diffHighlightsGlobalClearedAt !== 'undefined'
    ? Number(settings.diffHighlightsGlobalClearedAt || 0)
    : 0;
  return Number.isFinite(v) ? v : 0;
}


function getDiffHighlightsGlobalClearedFiles() {
  const raw = settings && settings.diffHighlightsGlobalClearedFiles;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}


function getDiffHighlightsClearedFiles(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return {};
  const raw = chatSessions && chatSessions[sid] ? chatSessions[sid].diffHighlightsClearedFiles : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}


function rebuildLastDiffCacheForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  lastDiffByRelPath = {};
  if (!sid) return;
  const msgs = ensureSessionMessages(sid);
  const clearedAt = Math.max(getDiffHighlightsClearedAt(sid), getDiffHighlightsGlobalClearedAt());
  const clearedFiles = getDiffHighlightsClearedFiles(sid);
  const globalClearedFiles = getDiffHighlightsGlobalClearedFiles();
  // Prefer most recent diff per file.
  try {
    for (const m of msgs) {
      if (!m || m.role !== 'file_preview') continue;
      const fp = normalizeRelPathForDiffPreview(m.filePath || '');
      const dc = typeof m.diffContent === 'string' ? m.diffContent : '';
      if (!fp || !dc.trim()) continue;
      const ts = typeof m.timestamp === 'number' ? m.timestamp : Date.now();
      if (clearedAt && ts <= clearedAt) continue;
      const sessionFileClearedAt = Number(clearedFiles && clearedFiles[fp] ? clearedFiles[fp] : 0);
      const globalFileClearedAt = Number(globalClearedFiles && globalClearedFiles[fp] ? globalClearedFiles[fp] : 0);
      const fileClearedAt = Math.max(
        (Number.isFinite(sessionFileClearedAt) ? sessionFileClearedAt : 0),
        (Number.isFinite(globalFileClearedAt) ? globalFileClearedAt : 0)
      );
      if (Number.isFinite(fileClearedAt) && fileClearedAt > 0 && ts <= fileClearedAt) continue;
      const prev = lastDiffByRelPath[fp];
      if (!prev || (typeof prev.timestamp === 'number' ? prev.timestamp : 0) <= ts) {
        lastDiffByRelPath[fp] = { diffContent: dc, timestamp: ts };
      }
    }
  } catch { /* ignore */ }

  // If a run is currently active, also include in-memory diff blocks (not yet persisted).
  try {
    const st = getRunState(sid);
    const blocks = Array.isArray(st?.stream?.diffBlocks) ? st.stream.diffBlocks : [];
    for (const b of blocks) {
      const fp = normalizeRelPathForDiffPreview(b?.filePath || '');
      const dc = typeof b?.diffContent === 'string' ? b.diffContent : '';
      if (!fp || !dc.trim()) continue;
      const ts = Number(b?.timestamp || Date.now());
      const sessionFileClearedAt = Number(clearedFiles && clearedFiles[fp] ? clearedFiles[fp] : 0);
      const globalFileClearedAt = Number(globalClearedFiles && globalClearedFiles[fp] ? globalClearedFiles[fp] : 0);
      const fileClearedAt = Math.max(
        (Number.isFinite(sessionFileClearedAt) ? sessionFileClearedAt : 0),
        (Number.isFinite(globalFileClearedAt) ? globalFileClearedAt : 0)
      );
      if (clearedAt && ts <= clearedAt) continue;
      if (Number.isFinite(fileClearedAt) && fileClearedAt > 0 && ts <= fileClearedAt) continue;
      lastDiffByRelPath[fp] = { diffContent: dc, timestamp: Number(b?.timestamp || Date.now()) };
    }
  } catch { /* ignore */ }
}


function refreshDiffDecorationsForAllOpenTabs() {
  try {
    for (const tab of editorTabs || []) {
      if (!tab || !tab.model) continue;
      syncDiffDecorationsForTab(tab);
    }
  } catch { /* ignore */ }
}


async function _clearDiffHighlightsForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    if (chatSessions && chatSessions[sid]) {
      chatSessions[sid].diffHighlightsClearedAt = Date.now();
      // Reset per-file clears since the global clear supersedes them.
      chatSessions[sid].diffHighlightsClearedFiles = {};
    }
  } catch { /* ignore */ }

  try { rebuildLastDiffCacheForSession(sid); } catch { /* ignore */ }

  // Clear decorations across all open file models.
  try {
    for (const tab of editorTabs || []) {
      if (!tab || !tab.model) continue;
      try { tab.diffDecorationIds = tab.model.deltaDecorations(tab.diffDecorationIds || [], []); } catch { /* ignore */ }
      tab.lastDiffSig = null;
    }
  } catch { /* ignore */ }

  try { renderEditorTabs(); } catch { /* ignore */ }
  try { await saveChatHistory(true); } catch { /* ignore */ }
}


async function _clearDiffHighlightsGlobally() {
  const ts = Date.now();
  try { settings.diffHighlightsGlobalClearedAt = ts; } catch { /* ignore */ }
  try { await saveSettings(); } catch { /* ignore */ }

  // Clear decorations across all open file models immediately.
  try {
    for (const tab of editorTabs || []) {
      if (!tab || !tab.model) continue;
      try { tab.diffDecorationIds = tab.model.deltaDecorations(tab.diffDecorationIds || [], []); } catch { /* ignore */ }
      tab.lastDiffSig = null;
    }
  } catch { /* ignore */ }

  // Rebuild cache for the active session (future session switches will also respect the global timestamp).
  try { rebuildLastDiffCacheForSession(currentSessionId); } catch { /* ignore */ }
  try { refreshDiffDecorationsForAllOpenTabs(); } catch { /* ignore */ }
  try { renderEditorTabs(); } catch { /* ignore */ }
  try { await saveChatHistory(true); } catch { /* ignore */ }
}


async function _clearDiffHighlightsForFileGlobally(relPath) {
  const rel = normalizeRelPathForDiffPreview(String(relPath || '').trim());
  if (!rel) return;
  const ts = Date.now();

  try {
    const prev = getDiffHighlightsGlobalClearedFiles();
    const next = { ...(prev || {}) };
    next[rel] = ts;
    settings.diffHighlightsGlobalClearedFiles = next;
  } catch { /* ignore */ }
  try { await saveSettings(); } catch { /* ignore */ }

  // Clear decorations for any open tab matching the file.
  try {
    const abs = resolveToWorkspaceAbsPath(rel);
    const tab = findTabByAbsPath(abs);
    if (tab && tab.model) {
      try { tab.diffDecorationIds = tab.model.deltaDecorations(tab.diffDecorationIds || [], []); } catch { /* ignore */ }
      tab.lastDiffSig = null;
    }
    for (const t of editorTabs || []) {
      if (!t || !t.model) continue;
      const r = normalizeRelPathForDiffPreview(t.relPath || getRelPath(t.absPath || ''));
      if (r !== rel) continue;
      try { t.diffDecorationIds = t.model.deltaDecorations(t.diffDecorationIds || [], []); } catch { /* ignore */ }
      t.lastDiffSig = null;
    }
  } catch { /* ignore */ }

  // Rebuild cache for active session and refresh open tabs.
  try { rebuildLastDiffCacheForSession(currentSessionId); } catch { /* ignore */ }
  try { refreshDiffDecorationsForAllOpenTabs(); } catch { /* ignore */ }
  try { renderEditorTabs(); } catch { /* ignore */ }
  try { await saveChatHistory(true); } catch { /* ignore */ }
}


async function _clearDiffHighlightsForFileInSession(sessionId, relPath) {
  const sid = String(sessionId || '').trim();
  const rel = normalizeRelPathForDiffPreview(String(relPath || '').trim());
  if (!sid || !rel) return;
  try {
    if (chatSessions && chatSessions[sid]) {
      const prev = getDiffHighlightsClearedFiles(sid);
      const next = { ...(prev || {}) };
      next[rel] = Date.now();
      chatSessions[sid].diffHighlightsClearedFiles = next;
    }
  } catch { /* ignore */ }

  // Drop cached diff + clear decorations for any open tab matching the file.
  try { rebuildLastDiffCacheForSession(sid); } catch { /* ignore */ }
  try {
    const abs = resolveToWorkspaceAbsPath(rel);
    const tab = findTabByAbsPath(abs);
    if (tab && tab.model) {
      try { tab.diffDecorationIds = tab.model.deltaDecorations(tab.diffDecorationIds || [], []); } catch { /* ignore */ }
      tab.lastDiffSig = null;
    }
    // If the file is open under a slightly different key, clear by rel match too.
    for (const t of editorTabs || []) {
      if (!t || !t.model) continue;
      const r = normalizeRelPathForDiffPreview(t.relPath || getRelPath(t.absPath || ''));
      if (r !== rel) continue;
      try { t.diffDecorationIds = t.model.deltaDecorations(t.diffDecorationIds || [], []); } catch { /* ignore */ }
      t.lastDiffSig = null;
    }
  } catch { /* ignore */ }

  // Re-apply (will be empty for this file) and persist state.
  try { refreshDiffDecorationsForAllOpenTabs(); } catch { /* ignore */ }
  try { renderEditorTabs(); } catch { /* ignore */ }
  try { await saveChatHistory(true); } catch { /* ignore */ }
}

function normalizeFsPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/');
}


function joinFsPath(a, b) {
  const left = String(a || '').replace(/\/+$/, '');
  const right = String(b || '').replace(/^\/+/, '');
  return normalizeFsPath(`${left}/${right}`);
}


function getRelPath(absPath) {
  const root = String(window.currentFolder || '').replace(/\/+$/, '');
  const abs = normalizeFsPath(absPath);
  if (!root) return abs;
  const rootN = normalizeFsPath(root);
  if (abs === rootN) return '.';
  if (abs.startsWith(rootN + '/')) return abs.slice(rootN.length + 1);
  return abs;
}


function isProbablyAbsolutePath(p) {
  const s = String(p || '');
  // POSIX absolute or Windows drive absolute
  return s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s);
}


function resolveToWorkspaceAbsPath(pathMaybeRel) {
  const raw = normalizeFsPath(pathMaybeRel);
  if (!raw) return '';
  if (isProbablyAbsolutePath(raw)) return raw;
  const root = String(window.currentFolder || '').replace(/\/+$/, '');
  if (!root) return raw;
  return joinFsPath(root, raw);
}


function detectMonacoLanguageFromPath(filePath) {
  const fp = String(filePath || '').toLowerCase();
  const dot = fp.lastIndexOf('.');
  const ext = dot >= 0 ? fp.slice(dot) : '';
  const map = {
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
    '.sql': 'sql',
    '.toml': 'toml',
    '.cs': 'csharp',
    '.dart': 'dart',
    '.lua': 'lua',
    '.r': 'r',
    '.scala': 'scala'
  };
  return map[ext] || 'plaintext';
}


function safeMonacoFileUri(absPath) {
  try {
    if (typeof monaco === 'undefined' || !monaco?.Uri?.file) return null;
    const abs = normalizeFsPath(String(absPath || '').trim());
    if (!abs) return null;
    return monaco.Uri.file(abs);
  } catch {
    return null;
  }
}


function countNewlines(s) {
  const str = String(s || '');
  let n = 0;
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 10) n++;
  return n;
}


function parseScriptAttrs(rawAttrs) {
  const attrs = String(rawAttrs || '');
  const out = { type: '', src: '' };
  try {
    const typeMatch = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    out.type = String(typeMatch?.[1] || typeMatch?.[2] || typeMatch?.[3] || '').trim().toLowerCase();
    out.src = String(srcMatch?.[1] || srcMatch?.[2] || srcMatch?.[3] || '').trim();
  } catch { /* ignore */ }
  return out;
}


function findHtmlScriptBlockRangeForLine(text, targetLine) {
  try {
    const t = String(text || '');
    const ln = Math.max(1, Number(targetLine || 1));
    const re = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
    let m;
    let guard = 0;
    while ((m = re.exec(t)) && guard++ < 200) {
      const startIdx = m.index;
      const endIdx = startIdx + String(m[0] || '').length;
      const before = t.slice(0, startIdx);
      const within = t.slice(startIdx, endIdx);
      const startLine = countNewlines(before) + 1;
      const endLine = startLine + countNewlines(within);
      if (ln >= startLine && ln <= endLine) return { startLine, endLine };
    }
  } catch {
    // ignore
  }
  return null;
}


function shouldCheckScriptType(type) {
  const t = String(type || '').trim().toLowerCase();
  // Default script type is JS; only validate classic scripts.
  if (!t) return true;
  if (t === 'text/javascript' || t === 'application/javascript') return true;
  // Avoid module scripts: `import` etc. will look like syntax errors in basic JS syntax checks.
  if (t === 'module' || t === 'text/module') return false;
  return false;
}

let __htmlScriptJsWorkerFactoryPromise = null;
async function getHtmlScriptJsWorkerFactory() {
  try {
    if (!settings?.enableTsJsLanguageService && !settings?.enableWebLanguageServices) return null;
    if (typeof monaco === 'undefined' || !monaco?.languages?.typescript?.getJavaScriptWorker) return null;
    if (!__htmlScriptJsWorkerFactoryPromise) {
      __htmlScriptJsWorkerFactoryPromise = monaco.languages.typescript.getJavaScriptWorker();
    }
    const factory = await __htmlScriptJsWorkerFactoryPromise;
    return typeof factory === 'function' ? factory : null;
  } catch {
    return null;
  }
}

function tsDiagMessageToString(msg) {
  try {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    if (typeof msg.messageText === 'string') return msg.messageText;
    if (typeof msg === 'object' && msg.messageText) return String(msg.messageText);
    return String(msg);
  } catch {
    return '';
  }
}


async function validateEmbeddedScriptsInHtmlModel(tab) {
  try {
    if (!settings?.enableProblemsPanel) return;
    // Only run when user opted into language services (keeps default experience unchanged).
    if (!settings?.enableWebLanguageServices && !settings?.enableTsJsLanguageService) return;
    if (!tab || !tab.model) return;
    const lang = String(tab.model.getLanguageId?.() || '').toLowerCase();
    if (lang !== 'html') return;

    const model = tab.model;
    const text = String(model.getValue?.() || '');
    const markers = [];
    const versionAtStart = typeof model.getVersionId === 'function' ? model.getVersionId() : 0;
    tab.__htmlScriptValidationToken = (tab.__htmlScriptValidationToken || 0) + 1;
    const token = tab.__htmlScriptValidationToken;
    
    // Safety limit: skip very large HTML files to prevent hangs
    const MAX_HTML_SIZE = 500 * 1024; // 500KB
    if (text.length > MAX_HTML_SIZE) {
      return;
    }
    
    const jsWorkerFactory = await getHtmlScriptJsWorkerFactory();
    if (!jsWorkerFactory || typeof monaco === 'undefined' || !monaco?.editor?.createModel || !monaco?.Uri?.parse) {
      return;
    }

    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

    let m;
    let guard = 0;
    while ((m = re.exec(text)) && guard++ < 50) {
      const attrsRaw = m[1] || '';
      const body = m[2] || '';
      const attrs = parseScriptAttrs(attrsRaw);
      if (attrs.src) continue; // external script, skip
      if (!shouldCheckScriptType(attrs.type)) continue;
      const code = String(body || '');
      if (!code.trim()) continue;
      
      // Skip extremely large script blocks to prevent worker hangs
      const MAX_SCRIPT_SIZE = 100 * 1024; // 100KB
      if (code.length > MAX_SCRIPT_SIZE) {
        continue;
      }

      // Approximate location: start of this <script> block
      const before = text.slice(0, m.index);
      const startLine = countNewlines(before) + 1;

      let scriptModel = null;
      try {
        const uri = monaco.Uri.parse(
          `inmemory://html-script/${encodeURIComponent(String(tab.id || 'tab'))}/${versionAtStart}-${guard}`
        );
        try { monaco.editor.getModel(uri)?.dispose?.(); } catch { /* ignore */ }
        scriptModel = monaco.editor.createModel(code, 'javascript', uri);
        if (!scriptModel) continue;

        const withTimeout = (promise, ms) => Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Worker timeout')), ms))
        ]);
        const WORKER_TIMEOUT_MS = 3000;
        const client = await withTimeout(jsWorkerFactory(uri), WORKER_TIMEOUT_MS);
        const diags = await withTimeout(client.getSyntacticDiagnostics(uri.toString()), WORKER_TIMEOUT_MS);
        if (Array.isArray(diags) && diags.length > 0) {
          for (const d of diags.slice(0, 20)) {
            const start = Number(d?.start || 0);
            const length = Number(d?.length || 1);
            const a = scriptModel.getPositionAt(start);
            const b = scriptModel.getPositionAt(start + Math.max(1, length));
            const msg = tsDiagMessageToString(d?.messageText) || 'Script syntax error';
            markers.push({
              severity: monaco?.MarkerSeverity?.Error || 8,
              message: `Embedded <script> JS syntax error: ${msg}`,
              startLineNumber: startLine + a.lineNumber - 1,
              startColumn: a.column,
              endLineNumber: startLine + b.lineNumber - 1,
              endColumn: b.column
            });
            if (markers.length >= 20) break;
          }
        }
      } catch {
        // ignore worker errors
      } finally {
        if (scriptModel) {
          try { scriptModel.dispose(); } catch { /* ignore */ }
          scriptModel = null;
        }
      }
    }

    try {
      if (token !== tab.__htmlScriptValidationToken) return;
      if (model.getVersionId && model.getVersionId() !== versionAtStart) return;
      monaco?.editor?.setModelMarkers?.(model, HTML_SCRIPT_MARKER_OWNER, markers);
    } catch { /* ignore */ }
  } catch {
    // ignore
  }
}

function bindHtmlEmbeddedScriptValidationForTab(tab) {
  if (!tab || !tab.model) return;
  try {
    if (tab.__htmlScriptValidationBound) return;
    tab.__htmlScriptValidationBound = true;
    let t = null;
    const run = () => {
      try { void validateEmbeddedScriptsInHtmlModel(tab); } catch { /* ignore */ }
      try { scheduleRenderProblemsView(); } catch { /* ignore */ }
    };
    // Debounced validate on edits
    const d = tab.model.onDidChangeContent(() => {
      if (t) clearTimeout(t);
      t = setTimeout(run, 250);
    });
    tab.__htmlScriptValidationDisposable = d;
    // Initial validate
    setTimeout(run, 0);
  } catch {
    // ignore
  }
}


function getEditorTabsEl() {
  return document.getElementById('editorTabs');
}


function setTopFilePathLabel(text) {
  const el = document.getElementById('currentFilePath');
  if (el) el.textContent = String(text || '');
}


function findTabByKey(key) {
  return editorTabs.find(t => t && t.key === key) || null;
}


function findTabByAbsPath(absPath) {
  const target = normalizeFsPath(absPath);
  return editorTabs.find(t => t && normalizeFsPath(t.absPath) === target) || null;
}


function isTabDirty(tab) {
  if (!tab || !tab.model) return false;
  try {
    return tab.model.getAlternativeVersionId() !== tab.savedVersionId;
  } catch {
    return false;
  }
}

// ---- Editor tab context menu (VS Code-like) ----
let editorTabContextKey = null;
let __editorTabContextMenuBound = false;

function getEditorTabContextMenuEls() {
  return {
    menu: document.getElementById('editorTabContextMenu'),
    close: document.getElementById('editorTabCtxClose'),
    closeOthers: document.getElementById('editorTabCtxCloseOthers'),
    closeRight: document.getElementById('editorTabCtxCloseRight'),
    closeSaved: document.getElementById('editorTabCtxCloseSaved'),
    closeAll: document.getElementById('editorTabCtxCloseAll'),
    copyPath: document.getElementById('editorTabCtxCopyPath'),
    copyRel: document.getElementById('editorTabCtxCopyRelPath'),
    closeShortcut: document.getElementById('editorTabCtxCloseShortcut'),
  };
}

function hideEditorTabContextMenu() {
  try {
    const { menu } = getEditorTabContextMenuEls();
    if (menu) menu.style.display = 'none';
  } catch { /* ignore */ }
  editorTabContextKey = null;
}

function _positionMenuAt(menu, x, y) {
  if (!menu) return;
  try {
    // Portal to body so it can't be clipped by panels
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
  } catch { /* ignore */ }

  // Show invisibly so we can measure
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  const rect = menu.getBoundingClientRect();
  const pad = 10;

  let left = Math.round(Number(x || 0));
  let top = Math.round(Number(y || 0));
  if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
  if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
  if (left < pad) left = pad;
  if (top < pad) top = pad;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = '';
}

async function _copyTextBestEffort(text) {
  const s = String(text || '');
  if (!s) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      try { showToast?.('Copied to clipboard'); } catch { /* ignore */ }
      return true;
    }
  } catch { /* ignore */ }

  // Fallback: execCommand
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) {
      try { showToast?.('Copied to clipboard'); } catch { /* ignore */ }
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

async function _closeTabsByKeys(keys) {
  const list = Array.isArray(keys) ? keys.map(String).filter(Boolean) : [];
  for (const k of list) {
    // sequential so prompts (dirty) are predictable
    await closeEditorTab(k);
  }
}

function showEditorTabContextMenu(e, key) {
  const tab = findTabByKey(key);
  if (!tab) return;
  const { menu, closeOthers, closeRight, closeSaved, closeAll, copyPath, copyRel, closeShortcut } = getEditorTabContextMenuEls();
  if (!menu) return;

  try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
  editorTabContextKey = String(key || '');

  // Shortcuts (only show what we actually support)
  try {
    const isMac = (() => {
      try { return window.electronAPI && window.electronAPI.platform === 'darwin'; } catch { return false; }
    })();
    if (closeShortcut) closeShortcut.textContent = isMac ? '⌘W' : 'Ctrl+W';
  } catch { /* ignore */ }

  // Disabled states
  try {
    const idx = editorTabs.findIndex(t => t && t.key === editorTabContextKey);
    const hasOthers = editorTabs.length > 1;
    const hasRight = idx >= 0 && idx < editorTabs.length - 1;
    const hasSavedClosable = (() => {
      try {
        for (const t of editorTabs || []) {
          if (!t) continue;
          if (!isTabDirty(t)) return true;
        }
      } catch { /* ignore */ }
      return false;
    })();
    if (closeOthers) closeOthers.classList.toggle('disabled', !hasOthers);
    if (closeRight) closeRight.classList.toggle('disabled', !hasRight);
    if (closeSaved) closeSaved.classList.toggle('disabled', !hasSavedClosable);
    if (closeAll) closeAll.classList.toggle('disabled', editorTabs.length === 0);
    if (copyPath) copyPath.classList.toggle('disabled', !(tab.absPath && String(tab.absPath).trim()));
    if (copyRel) copyRel.classList.toggle('disabled', !(tab.relPath && String(tab.relPath).trim()));
  } catch { /* ignore */ }

  _positionMenuAt(menu, e.clientX, e.clientY);
  menu.style.display = 'block';
}

function bindEditorTabContextMenuOnce() {
  if (__editorTabContextMenuBound) return;
  __editorTabContextMenuBound = true;

  const { menu, close, closeOthers, closeRight, closeSaved, closeAll, copyPath, copyRel } = getEditorTabContextMenuEls();
  if (!menu) return;

  if (close && !close.__codeonBound) {
    close.__codeonBound = true;
    close.addEventListener('click', async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
      const key = String(editorTabContextKey || '');
      hideEditorTabContextMenu();
      if (key) await closeEditorTab(key);
    });
  }
  if (closeOthers && !closeOthers.__codeonBound) {
    closeOthers.__codeonBound = true;
    closeOthers.addEventListener('click', async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
      const key = String(editorTabContextKey || '');
      hideEditorTabContextMenu();
      if (!key) return;
      const keys = editorTabs.filter(t => t && t.key !== key).map(t => t.key);
      await _closeTabsByKeys(keys);
    });
  }
  if (closeRight && !closeRight.__codeonBound) {
    closeRight.__codeonBound = true;
    closeRight.addEventListener('click', async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
      const key = String(editorTabContextKey || '');
      hideEditorTabContextMenu();
      if (!key) return;
      const idx = editorTabs.findIndex(t => t && t.key === key);
      if (idx < 0) return;
      const keys = editorTabs.slice(idx + 1).filter(Boolean).map(t => t.key);
      await _closeTabsByKeys(keys);
    });
  }
  if (closeSaved && !closeSaved.__codeonBound) {
    closeSaved.__codeonBound = true;
    closeSaved.addEventListener('click', async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
      hideEditorTabContextMenu();
      const keys = editorTabs.filter(t => t && !isTabDirty(t)).map(t => t.key);
      await _closeTabsByKeys(keys);
    });
  }
  if (closeAll && !closeAll.__codeonBound) {
    closeAll.__codeonBound = true;
    closeAll.addEventListener('click', async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
      hideEditorTabContextMenu();
      const keys = editorTabs.filter(Boolean).map(t => t.key);
      await _closeTabsByKeys(keys);
    });
  }
  if (copyPath && !copyPath.__codeonBound) {
    copyPath.__codeonBound = true;
    copyPath.addEventListener('click', async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
      const key = String(editorTabContextKey || '');
      hideEditorTabContextMenu();
      const tab = key ? findTabByKey(key) : null;
      if (!tab || !tab.absPath) return;
      await _copyTextBestEffort(tab.absPath);
    });
  }
  if (copyRel && !copyRel.__codeonBound) {
    copyRel.__codeonBound = true;
    copyRel.addEventListener('click', async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
      const key = String(editorTabContextKey || '');
      hideEditorTabContextMenu();
      const tab = key ? findTabByKey(key) : null;
      const rel = tab ? String(tab.relPath || '').trim() : '';
      if (!rel) return;
      await _copyTextBestEffort(rel);
    });
  }
}


function scrollActiveEditorTabIntoView(listEl) {
  if (!listEl) return;
  const activeTab = listEl.querySelector('.editor-tab.active');
  if (!activeTab) return;
  const listRect = listEl.getBoundingClientRect();
  const tabRect = activeTab.getBoundingClientRect();
  const padding = 16;
  let nextScrollLeft = listEl.scrollLeft;
  if (tabRect.left < listRect.left + padding) {
    nextScrollLeft -= (listRect.left + padding) - tabRect.left;
  } else if (tabRect.right > listRect.right - padding) {
    nextScrollLeft += tabRect.right - (listRect.right - padding);
  } else {
    return;
  }
  const maxScroll = Math.max(0, listEl.scrollWidth - listEl.clientWidth);
  if (nextScrollLeft < 0) nextScrollLeft = 0;
  if (nextScrollLeft > maxScroll) nextScrollLeft = maxScroll;
  try {
    listEl.scrollTo({ left: nextScrollLeft, behavior: 'smooth' });
  } catch {
    listEl.scrollLeft = nextScrollLeft;
  }
}

function renderEditorTabs() {
  const el = getEditorTabsEl();
  if (!el) return;
  
  // Check if we have a diff pseudo-tab from FileSyncController
  const diffPseudoTab = window.FileSyncController?.getDiffPseudoTab?.() || null;
  const hasDiffTab = !!diffPseudoTab;
  
  if ((!editorTabs || editorTabs.length === 0) && !hasDiffTab) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  el.style.display = 'flex';
  el.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'editor-tabs-list';

  // Decide whether actions should show at all (only when they matter).
  const activeTab = activeEditorTabKey ? findTabByKey(activeEditorTabKey) : null;
  const activeRel = activeTab ? normalizeRelPathForDiffPreview(activeTab.relPath || getRelPath(activeTab.absPath || '')) : '';
  const activeHasDecorations = (() => {
    try { return !!(activeTab && Array.isArray(activeTab.diffDecorationIds) && activeTab.diffDecorationIds.length > 0); } catch { return false; }
  })();
  const activeHasCachedDiff = (() => {
    try { return !!(activeRel && lastDiffByRelPath && lastDiffByRelPath[activeRel] && String(lastDiffByRelPath[activeRel].diffContent || '').trim()); } catch { return false; }
  })();
  const anyOpenHasDecorations = (() => {
    try {
      for (const t of editorTabs || []) {
        if (!t) continue;
        if (Array.isArray(t.diffDecorationIds) && t.diffDecorationIds.length > 0) return true;
      }
    } catch { /* ignore */ }
    return false;
  })();
  const anyCachedDiffs = (() => {
    try { return !!(lastDiffByRelPath && typeof lastDiffByRelPath === 'object' && Object.keys(lastDiffByRelPath).length > 0); } catch { return false; }
  })();

  const showDone = !!activeRel && (activeHasDecorations || activeHasCachedDiff);
  const showDoneAll = anyOpenHasDecorations || anyCachedDiffs;

  el.appendChild(list);

  if (showDone || showDoneAll) {
    const actions = document.createElement('div');
    actions.className = 'editor-tabs-actions';

    if (showDone) {
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'editor-tabs-action-btn';
      doneBtn.textContent = 'Done';
      doneBtn.title = 'Clear green highlights for the active file';
      doneBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeRel) return;
        try { doneBtn.disabled = true; } catch { /* ignore */ }
        try { await _clearDiffHighlightsForFileGlobally(activeRel); } catch { /* ignore */ }
      });
      actions.appendChild(doneBtn);
    }

    if (showDoneAll) {
      const doneAllBtn = document.createElement('button');
      doneAllBtn.type = 'button';
      doneAllBtn.className = 'editor-tabs-action-btn primary';
      doneAllBtn.textContent = 'Done for all';
      doneAllBtn.title = 'Clear green highlights for all files (open and closed)';
      doneAllBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { doneAllBtn.disabled = true; } catch { /* ignore */ }
        try { await _clearDiffHighlightsGlobally(); } catch { /* ignore */ }
      });
      actions.appendChild(doneAllBtn);
    }

    el.appendChild(actions);
  }

  for (const tab of editorTabs) {
    if (!tab) continue;
    const tabEl = document.createElement('div');
    tabEl.className = 'editor-tab';
    if (tab.key === activeEditorTabKey) tabEl.classList.add('active');
    if (isTabDirty(tab)) tabEl.classList.add('dot-dirty');
    if (tab.conflictOnDisk === true) tabEl.classList.add('dot-conflict');
    tabEl.dataset.key = tab.key;
    tabEl.title = tab.relPath || tab.absPath || '';

    const title = document.createElement('div');
    title.className = 'editor-tab-title';
    title.textContent = tab.name || tab.relPath || tab.absPath || 'Untitled';

    const indicators = document.createElement('div');
    indicators.className = 'editor-tab-indicators';
    const dot = document.createElement('span');
    dot.className = 'editor-tab-dot';
    indicators.appendChild(dot);

    const close = document.createElement('button');
    close.className = 'editor-tab-close';
    close.type = 'button';
    close.innerHTML = '×';
    close.title = 'Close';
    close.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await closeEditorTab(tab.key);
    });

    tabEl.appendChild(title);
    tabEl.appendChild(indicators);
    tabEl.appendChild(close);

    tabEl.addEventListener('click', async () => {
      await activateEditorTab(tab.key);
    });

    tabEl.addEventListener('contextmenu', (e) => {
      showEditorTabContextMenu(e, tab.key);
    });

    list.appendChild(tabEl);
  }

  // Add diff pseudo-tab if diff view is active
  if (diffPseudoTab) {
    const diffTabEl = document.createElement('div');
    diffTabEl.className = 'editor-tab editor-tab-diff active';
    diffTabEl.dataset.key = diffPseudoTab.key;
    diffTabEl.title = `${diffPseudoTab.relPath} (comparing changes)`;

    const title = document.createElement('div');
    title.className = 'editor-tab-title';
    title.textContent = diffPseudoTab.displayName || `${diffPseudoTab.name} (diff)`;

    const indicators = document.createElement('div');
    indicators.className = 'editor-tab-indicators';
    const diffIcon = document.createElement('span');
    diffIcon.className = 'editor-tab-diff-icon';
    diffIcon.innerHTML = '⇋';
    diffIcon.title = 'Diff view';
    indicators.appendChild(diffIcon);

    const close = document.createElement('button');
    close.className = 'editor-tab-close';
    close.type = 'button';
    close.innerHTML = '×';
    close.title = 'Close diff view';
    close.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Close diff view and clear state
      try {
        if (typeof exitDiffView === 'function') exitDiffView();
        if (window.FileSyncController?.clearDiffState) window.FileSyncController.clearDiffState();
      } catch { /* ignore */ }
    });

    diffTabEl.appendChild(title);
    diffTabEl.appendChild(indicators);
    diffTabEl.appendChild(close);

    // Click on diff tab does nothing (already active), but we keep the click handler for consistency
    diffTabEl.addEventListener('click', () => {
      // Diff tab is already active when visible
    });

    // Remove 'active' class from other tabs when diff is shown
    list.querySelectorAll('.editor-tab.active').forEach(t => {
      if (!t.classList.contains('editor-tab-diff')) t.classList.remove('active');
    });

    list.appendChild(diffTabEl);
  }

  // Keep the active tab in view after render.
  requestAnimationFrame(() => {
    try {
      if (!list.isConnected) return;
      scrollActiveEditorTabIntoView(list);
    } catch { /* ignore */ }
  });
}
