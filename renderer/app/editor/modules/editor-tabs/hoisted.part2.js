// ---- CHUNK 2/7 from hoisted.js (AST statement boundaries; order preserved) ----



async function activateEditorTab(key) {
  const next = findTabByKey(key);
  if (!next || !editor) return;

  // Exit diff view if active (diff view is a "preview mode" over the editor)
  if (typeof exitDiffView === 'function') exitDiffView();

  // If we were showing a chat transcript in the editor, restore normal editing.
  if (isChatEditorView) {
    setEditorReadOnly(false);
    isChatEditorView = false;
  }

  // Save current view state
  try {
    const cur = findTabByKey(activeEditorTabKey);
    if (cur && editor && typeof editor.saveViewState === 'function') {
      cur.viewState = editor.saveViewState();
    }
  } catch {
    // ignore
  }

  activeEditorTabKey = key;
  currentFile = next.absPath;
  window.currentFile = currentFile;

  try {
    editor.setModel(next.model);
  } catch {
    // ignore
  }

  // Sync diff highlights for this file (if we have a stored diff for it).
  try { syncDiffDecorationsForTab(next); } catch { /* ignore */ }

  // Skip viewState restoration if this file is actively being streamed to (code-streaming module sets this)
  // This prevents viewState from overriding the scroll-to-bottom behavior during streaming
  const suppressViewState = window.__codeonStreamingScrollSuppressViewState === next.absPath;
  
  try {
    if (!suppressViewState && next.viewState && editor && typeof editor.restoreViewState === 'function') {
      editor.restoreViewState(next.viewState);
    }
  } catch {
    // ignore
  }
  try { editor.focus(); } catch { /* ignore */ }

  // Show relative path like VS Code does
  setTopFilePathLabel(next.relPath || next.name || 'File');
  const empty = document.getElementById('editorEmptyState');
  if (empty) empty.style.display = 'none';

  // Ensure embedded HTML <script> validation is active for the selected tab.
  try { bindHtmlEmbeddedScriptValidationForTab(next); } catch { /* ignore */ }

  renderEditorTabs();

  // Keep Problems panel in sync with active tab changes (low-cost, debounced).
  scheduleRenderProblemsView();
}


function simpleSig(str) {
  const s = String(str || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}


function parseUnifiedDiffAddedLines(diffContent) {
  const diff = String(diffContent || '');
  const lines = diff.split('\n');
  const added = new Set();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] || '';
    const m = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!m) { i++; continue; }
    let newLine = Number(m[1] || 1);
    i++;
    while (i < lines.length) {
      const l = lines[i] || '';
      if (l.startsWith('@@')) break;
      if (l.startsWith('diff --git')) break;
      if (l.startsWith('+++') || l.startsWith('---')) { i++; continue; }
      if (l.startsWith('+')) {
        added.add(newLine);
        newLine++;
        i++;
        continue;
      }
      if (l.startsWith('-')) {
        i++;
        continue;
      }
      if (l.startsWith('\\ No newline')) { i++; continue; }
      // context
      newLine++;
      i++;
    }
  }
  return added;
}


function extractFirstNewLineFromUnifiedDiff(diffContent) {
  const s = String(diffContent || '');
  const m = s.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/m);
  if (!m) return 1;
  const ln = Number(m[1] || 1);
  return Number.isFinite(ln) && ln > 0 ? ln : 1;
}


function findFirstAddedLineFromUnifiedDiff(diffContent) {
  try {
    const added = parseUnifiedDiffAddedLines(String(diffContent || ''));
    let min = null;
    for (const n of added) {
      if (!Number.isFinite(n) || n <= 0) continue;
      if (min == null || n < min) min = n;
    }
    return min;
  } catch {
    return null;
  }
}


function syncDiffDecorationsForTab(tab) {
  if (!tab || !tab.model) return;

  const relRaw = tab.relPath || getRelPath(tab.absPath);
  const rel = normalizeRelPathForDiffPreview(relRaw);
  const cached = rel && lastDiffByRelPath && lastDiffByRelPath[rel] ? lastDiffByRelPath[rel] : null;
  const diff = cached && typeof cached.diffContent === 'string' ? cached.diffContent : '';
  const sig = diff ? simpleSig(diff) : null;

  // Clear existing decorations if no diff or if diff changed to empty
  if (!diff || !diff.trim()) {
    try {
      tab.diffDecorationIds = tab.model.deltaDecorations(tab.diffDecorationIds || [], []);
      tab.lastDiffSig = null;
    } catch { /* ignore */ }
    return;
  }

  // If we already applied this exact diff AND still have decoration ids, we can skip.
  // But if decorations were cleared by a model refresh, reapply even if sig is unchanged.
  if (tab.lastDiffSig === sig && Array.isArray(tab.diffDecorationIds) && tab.diffDecorationIds.length > 0) return;
  tab.lastDiffSig = sig;

  const added = parseUnifiedDiffAddedLines(diff);
  const decorations = [];
  const lineCount = (() => { try { return tab.model.getLineCount(); } catch { return 0; } })();
  for (const ln of added) {
    if (!Number.isFinite(ln) || ln <= 0) continue;
    if (lineCount && ln > lineCount) continue;
    decorations.push({
      range: new monaco.Range(ln, 1, ln, 1),
      options: {
        isWholeLine: true,
        className: 'codeon-diff-line-added',
        linesDecorationsClassName: 'codeon-diff-gutter-added'
      }
    });
  }
  try {
    tab.diffDecorationIds = tab.model.deltaDecorations(tab.diffDecorationIds || [], decorations);
  } catch {
    // ignore
  }
}


async function openRelPathFromChat(relPath, { jumpToDiff = false, diffContent = '' } = {}) {
  const relRaw = String(relPath || '').replace(/^\/+/, '').trim();
  if (!relRaw || !window.currentFolder) return;
  const rel = normalizeRelPathForDiffPreview(relRaw);
  if (!rel) return;

  // Reveal in explorer (expand folders + select)
  try {
    const abs = explorerAbsFromRel(rel);
    if (abs) explorerRevealAbsPath(abs);
  } catch { /* ignore */ }

  // Seed diff cache so editor shows highlights on open.
  if (diffContent && diffContent.trim()) {
    try { lastDiffByRelPath[rel] = { diffContent: String(diffContent), timestamp: Date.now() }; } catch { /* ignore */ }
  }

  const abs = resolveToWorkspaceAbsPath(rel);
  await openFile(abs);

  if (jumpToDiff && diffContent && diffContent.trim()) {
    const ln = findFirstAddedLineFromUnifiedDiff(diffContent) || extractFirstNewLineFromUnifiedDiff(diffContent);
    try {
      if (editor && typeof editor.revealLineInCenter === 'function') {
        editor.setPosition({ lineNumber: ln, column: 1 });
        editor.revealLineInCenter(ln);
      }
    } catch { /* ignore */ }
  }
}


async function retryLastUserMessageWithNewClaudeSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (sid !== currentSessionId) {
    showToast('Switch to that chat tab to retry');
    return;
  }
  const st = getRunState(sid);
  if (st && st.isProcessing) {
    showToast('A run is already in progress');
    return;
  }

  // Place streaming after the latest message (retry/recovery runs don't create a new user message).
  try { if (st) st.streamingPlacement = 'after_latest'; } catch { /* ignore */ }

  // Find the most recent user message (source of truth: persisted session messages).
  const msgs = ensureSessionMessages(sid);
  let lastUser = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === 'user') { lastUser = m; break; }
  }
  if (!lastUser) {
    showToast('No user message to retry');
    return;
  }

  // Clear broken resume pointers so Claude starts a fresh session.
  clearClaudeResumeStateForSession(sid);

  const message = String(lastUser.content || '').trim() || 'Please continue';
  const attachments = Array.isArray(lastUser.attachments) ? lastUser.attachments : [];
  const skillId = (() => {
    try {
      const s0 = Array.isArray(lastUser.skills) ? lastUser.skills[0] : null;
      const id = s0 && typeof s0.id === 'string' ? s0.id.trim() : '';
      return id || '';
    } catch { return ''; }
  })();

  // Show typing indicator + run
  const typingId = showTypingIndicator(sid);
  setProcessingState(true, sid);
  const abortController = new AbortController();
  if (st) st.abortController = abortController;

  try {
    await getAIResponse(message, attachments, abortController.signal, sid, { skillId, forceNewClaudeSession: true });
  } catch (error) {
    if (error && error._uiShown === true) return;
    if (error && error.name === 'AbortError') return;
    addMessage('assistant', `Error: ${error?.message || String(error)}`);
  } finally {
    if (typingId) removeTypingIndicator(typingId);
    if (abortController && !abortController.signal.aborted) {
      setProcessingState(false, sid);
    }
    try { if (st) st.streamingPlacement = 'after_user'; } catch { /* ignore */ }
  }
}

function parseRetryAfterSecondsFromText(text) {
  const s = String(text || '');
  if (!s) return null;
  // Common shapes:
  // - "Retry after 12 seconds"
  // - "retry_after=12"
  // - "try again in 12s"
  const m =
    s.match(/retry[_ -]?after\s*[:=]?\s*(\d+)\s*(?:seconds?|secs?|s)?/i) ||
    s.match(/\bretry[_ -]?after\s*=\s*(\d+)\b/i) ||
    s.match(/\btry again in\s*(\d+)\s*(?:seconds?|secs?|s)\b/i);
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}


async function retryLastUserMessageAfterTransientClaudeFailure(sessionId, { restoreToCheckpointHash = null, forceNewClaudeSession = false } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (sid !== currentSessionId) {
    showToast('Switch to that chat tab to retry');
    return;
  }
  const st = getRunState(sid);
  if (st && st.isProcessing) {
    showToast('A run is already in progress');
    return;
  }

  // Respect global rate-limit backoff.
  if (claudeGlobalBackoffUntilMs && Date.now() < claudeGlobalBackoffUntilMs) {
    const left = Math.max(1, Math.ceil((claudeGlobalBackoffUntilMs - Date.now()) / 1000));
    showToast(`Claude is rate limited. Please wait ~${left}s and retry.`);
    return false;
  }

  // Place the new streaming bubble AFTER the latest message (so it doesn't stream above the error/retry UI).
  try { if (st) st.streamingPlacement = 'after_latest'; } catch { /* ignore */ }

  // Find the most recent user message (source of truth: persisted session messages).
  const msgs = ensureSessionMessages(sid);
  let lastUser = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === 'user') { lastUser = m; break; }
  }
  if (!lastUser) {
    showToast('No user message to retry');
    return;
  }

  // Optional: restore workspace to a deterministic checkpoint first.
  // This is safer for retries after tool/edit failures because it aligns workspace + prompt.
  const ckptToRestore = (typeof restoreToCheckpointHash === 'string' && restoreToCheckpointHash.trim())
    ? restoreToCheckpointHash.trim()
    : null;
  if (ckptToRestore) {
    try {
      const ok = await restoreToCheckpoint(ckptToRestore, { skipConfirmation: true });
      if (!ok) return false;
      // If we restored the workspace, force a fresh Claude session unless explicitly overridden.
      forceNewClaudeSession = true;
    } catch {
      // If restore fails, fall back to normal retry.
    }
  }

  // IMPORTANT: Retry the *same* user turn, but try to rewind Claude to just-before
  // that user message and fork, so we don't duplicate the user message in Claude's history.
  // (We previously only did this for rate limits; it's generally beneficial for transient failures.)
  try {
    const meta = getClaudeSessionMeta(sid);
    const sess = chatSessions && chatSessions[sid] ? chatSessions[sid] : null;
    const resumeId = sess && typeof sess.claudeSessionId === 'string' && sess.claudeSessionId.trim() ? sess.claudeSessionId.trim() : null;
    const resumeAt =
      (typeof lastUser.claudeResumeFrom === 'string' && lastUser.claudeResumeFrom.trim())
        ? lastUser.claudeResumeFrom.trim()
        : null;
    if (!forceNewClaudeSession && meta && resumeId && resumeAt) {
      meta.pendingResumeAt = resumeAt;
      meta.forkOnNext = true;
      try { saveChatHistory(true).catch(() => {}); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  // If requested, start a fresh Claude session (useful after checkpoint restore to avoid mismatched context).
  if (forceNewClaudeSession === true) {
    try { clearClaudeResumeStateForSession(sid); } catch { /* ignore */ }
  }

  const message = String(lastUser.content || '').trim() || 'Please continue';
  const attachments = Array.isArray(lastUser.attachments) ? lastUser.attachments : [];
  const skillId = (() => {
    try {
      const s0 = Array.isArray(lastUser.skills) ? lastUser.skills[0] : null;
      const id = s0 && typeof s0.id === 'string' ? s0.id.trim() : '';
      return id || '';
    } catch { return ''; }
  })();

  const typingId = showTypingIndicator(sid);
  setProcessingState(true, sid);
  const abortController = new AbortController();
  if (st) st.abortController = abortController;

  try {
    await getAIResponse(message, attachments, abortController.signal, sid, { skillId, ...(forceNewClaudeSession === true ? { forceNewClaudeSession: true } : {}) });
    return true;
  } catch (error) {
    if (error && error._uiShown === true) return;
    if (error && error.name === 'AbortError') return;
    addMessage('assistant', `Error: ${error?.message || String(error)}`);
  } finally {
    if (typingId) removeTypingIndicator(typingId);
    if (abortController && !abortController.signal.aborted) {
      setProcessingState(false, sid);
    }
    try { if (st) st.streamingPlacement = 'after_user'; } catch { /* ignore */ }
  }
}


function invalidateDiffDecorations(tab) {
  if (!tab || !tab.model) return;
  try {
    // Clear any tracked ids first so we never treat stale ids as "decorations exist".
    tab.diffDecorationIds = tab.model.deltaDecorations(tab.diffDecorationIds || [], []);
  } catch { /* ignore */ }
  tab.diffDecorationIds = [];
  tab.lastDiffSig = null;
}


async function closeEditorTab(key) {
  const tab = findTabByKey(key);
  if (!tab) return;

  if (isTabDirty(tab)) {
    const ok = await customConfirm(`"${tab.name}" has unsaved changes. Close anyway?`, 'Unsaved Changes');
    if (!ok) return;
  }

  // If active, pick a neighbor to activate after removal
  const idx = editorTabs.findIndex(t => t && t.key === key);
  const wasActive = key === activeEditorTabKey;

  // Remove first (so activate doesn't immediately switch back)
  editorTabs = editorTabs.filter(t => t && t.key !== key);

  // Dispose model to avoid leaks
  try { tab.model?.dispose?.(); } catch { /* ignore */ }

  if (editorTabs.length === 0) {
    activeEditorTabKey = null;
    currentFile = null;
    window.currentFile = null;
    setTopFilePathLabel('No file open');
    const empty = document.getElementById('editorEmptyState');
    if (empty) empty.style.display = '';
    renderEditorTabs();
    return;
  }

  if (wasActive) {
    const next = editorTabs[Math.min(idx, editorTabs.length - 1)] || editorTabs[editorTabs.length - 1];
    if (next) await activateEditorTab(next.key);
  } else {
    renderEditorTabs();
  }
}


async function openEditorTabFromFilePayload({ absPath, content, language }) {
  if (!editor || !absPath) return;
  const abs = normalizeFsPath(resolveToWorkspaceAbsPath(absPath));
  const existing = findTabByAbsPath(abs);
  if (existing) {
    // Refresh model content if tab is NOT dirty (keeps user edits safe)
    if (!isTabDirty(existing) && typeof content === 'string') {
      try {
        suppressModelDirtyTracking = true;
        // Avoid needless setValue if identical (prevents flicker + decoration churn).
        try {
          const cur = existing.model.getValue();
          if (cur !== content) {
            invalidateDiffDecorations(existing);
            existing.model.setValue(content);
          }
        } catch {
          invalidateDiffDecorations(existing);
          existing.model.setValue(content);
        }
        existing.savedVersionId = existing.model.getAlternativeVersionId();
        existing.conflictOnDisk = false;
        // Re-apply diff decorations; some Monaco operations can clear decorations on setValue.
        try { syncDiffDecorationsForTab(existing); } catch { /* ignore */ }
      } catch {
        // ignore
      } finally {
        suppressModelDirtyTracking = false;
      }
    }
    await activateEditorTab(existing.key);
    return;
  }

  const rel = getRelPath(abs);
  const name = String(rel || abs).split(/[/\\]/).pop();
  const lang = String(language || detectMonacoLanguageFromPath(abs));
  let model = null;
  try {
    const uri = safeMonacoFileUri(abs);
    // Use stable file URIs when possible (improves diagnostics/navigation consistency, cross-platform).
    // If URI creation fails, fall back to Monaco's in-memory model URI.
    model = uri
      ? monaco.editor.createModel(String(content || ''), lang, uri)
      : monaco.editor.createModel(String(content || ''), lang);
  } catch {
    model = null;
  }
  if (!model) return;

  // Single source of truth: one tab per absolute path.
  const key = abs;
  const tab = {
    key,
    absPath: abs,
    relPath: rel,
    name,
    model,
    savedVersionId: model.getAlternativeVersionId(),
    viewState: null,
    lastDiskMtimeMs: null,
    conflictOnDisk: false,
    diffDecorationIds: [],
    lastDiffSig: null
  };

  // Track disk mtime best-effort
  try {
    const st = await window.electronAPI?.getFileStats?.(abs);
    const ms = st?.success && st?.stats?.modified ? new Date(st.stats.modified).getTime() : null;
    if (Number.isFinite(ms)) tab.lastDiskMtimeMs = ms;
  } catch { /* ignore */ }

  editorTabs.push(tab);
  try { syncDiffDecorationsForTab(tab); } catch { /* ignore */ }
  // If HTML, bind embedded <script> validation (low-risk; emits its own markers).
  try { bindHtmlEmbeddedScriptValidationForTab(tab); } catch { /* ignore */ }
  await activateEditorTab(tab.key);
}


function bindEditorTabHotkeysOnce() {
  if (window.__editorTabsHotkeysBound) return;
  window.__editorTabsHotkeysBound = true;

  document.addEventListener('keydown', async (e) => {
    // Cmd/Ctrl+W closes active tab
    const isClose = (e.key === 'w' || e.key === 'W') && (e.metaKey || e.ctrlKey);
    if (isClose) {
      e.preventDefault();
      if (activeEditorTabKey) await closeEditorTab(activeEditorTabKey);
      return;
    }

    // Ctrl/Cmd+Tab cycles next; Ctrl/Cmd+Shift+Tab cycles prev
    const isCycle = (e.key === 'Tab') && (e.metaKey || e.ctrlKey);
    if (isCycle && editorTabs.length > 1) {
      e.preventDefault();
      const idx = editorTabs.findIndex(t => t && t.key === activeEditorTabKey);
      const dir = e.shiftKey ? -1 : 1;
      const next = editorTabs[(idx + dir + editorTabs.length) % editorTabs.length];
      if (next) await activateEditorTab(next.key);
      return;
    }

    // Escape exits diff view quickly (VS Code-like)
    if (e.key === 'Escape') {
      try { if (typeof exitDiffView === 'function') exitDiffView(); } catch { /* ignore */ }
    }
  });
}


// Initialize application
async function initializeApp() {
  // App initialized

  await loadSettings(); // Now async - loads from file system
  setupEventListeners(); // Setup listeners first (initializes custom dropdowns)
  initConsoleTabsAndTasks();
  checkApiKey();

  // If enabled via Settings, configure Monaco TS/JS language service (safe, local-only).
  try { if (settings.enableTsJsLanguageService === true) configureMonacoTsJsServiceOnce(); } catch { /* ignore */ }
  // If enabled via Settings, configure Monaco HTML/CSS/JSON language services (safe, local-only).
  try { if (settings.enableWebLanguageServices === true) configureMonacoWebLanguageServicesOnce(); } catch { /* ignore */ }

  // Best-effort flush of chat state on window close/reload
  window.addEventListener('beforeunload', () => {
    try {
      saveChatHistory(true);
    } catch {
      // ignore
    }
    try {
      if (window.readFileCacheService && window.currentFolder && window.currentSessionId) {
        window.readFileCacheService.flushSession(window.currentFolder, window.currentSessionId);
      }
    } catch {
      // ignore
    }
  });

  // Main-process driven flush (more reliable than beforeunload in Electron close/quit paths).
  if (window.electronAPI && typeof window.electronAPI.onAppFlushRequest === 'function') {
    window.electronAPI.onAppFlushRequest(async () => {
      try {
        await saveChatHistory(true);
      } catch {
        // ignore
      }
      try {
        // Flush UI metadata (AET viewport state, etc.) so `.ai-agent/ui-metadata.json` is always present.
        await saveUIMetadataNow(true);
      } catch {
        // ignore
      }
      try {
        if (window.readFileCacheService && window.currentFolder && window.currentSessionId) {
          await window.readFileCacheService.flushSession(window.currentFolder, window.currentSessionId);
        }
      } catch {
        // ignore
      }
      try {
        if (window.electronAPI && typeof window.electronAPI.appFlushDone === 'function') {
          window.electronAPI.appFlushDone();
        }
      } catch {
        // ignore
      }
    });
  }
}

async function loadSettings() {
  if (window.electronAPI) {
    const result = await window.electronAPI.loadSettings();
    
    if (result.success && result.settings) {
      const loaded = result.settings;
      settings = { ...settings, ...loaded };
      console.log('[Settings] Loaded from disk');
    } else {
      console.log('[Settings] Using defaults (no saved settings found)');
    }
  }

  // Backward-compat migration: older builds stored `toolPermissionMode`.
  // Preserve previous behavior:
  // - ask           -> acceptEdits  (edits allowed; prompts for Bash/WebFetch)
  // - always_allow  -> bypassPermissions
  try {
    const hasPermissionMode = settings && typeof settings.permissionMode === 'string' && settings.permissionMode.trim();
    if (!hasPermissionMode && settings && typeof settings.toolPermissionMode === 'string') {
      const tpm = settings.toolPermissionMode;
      settings.permissionMode = (tpm === 'always_allow') ? 'bypassPermissions' : 'acceptEdits';
    }
  } catch {
    // ignore
  }

  // CRITICAL: Normalize LLM provider settings immediately after loading.
  // This ensures OpenRouter works for Learning/Docs/Verification requests,
  // which may fire before the Settings UI is opened.
  try {
    const validProviders = new Set(['claude_ai', 'anthropic_api', 'openrouter', 'codex']);
    if (!settings.llmProvider || !validProviders.has(settings.llmProvider)) {
      // Migrate from old settings or use sensible default
      if (settings.useOpenRouter === true) {
        settings.llmProvider = 'openrouter';
      } else if (settings.authMode === 'api_key') {
        settings.llmProvider = 'anthropic_api';
      } else {
        settings.llmProvider = 'claude_ai';
      }
      console.log('[Settings] Normalized llmProvider to:', settings.llmProvider);
    }
    // Ensure OpenRouter settings are strings (avoid null/undefined issues)
    if (typeof settings.openrouterApiKey !== 'string') {
      settings.openrouterApiKey = '';
    }
    if (typeof settings.openrouterModel !== 'string') {
      settings.openrouterModel = '';
    }
  } catch {
    // ignore
  }

  // Expose settings globally for tools to access
  window.appSettings = settings;

  // Populate settings UI
  const apiKeyInput = document.getElementById('apiKeyInput');

  if (apiKeyInput) apiKeyInput.value = settings.apiKey || '';

  const permissionModeInput = document.getElementById('permissionModeInput');
  if (permissionModeInput) {
    const raw = settings && typeof settings.permissionMode === 'string' ? settings.permissionMode : '';
    const allowed = new Set(['plan', 'default', 'acceptEdits', 'bypassPermissions']);
    const mode = allowed.has(raw) ? raw : 'acceptEdits';
    permissionModeInput.value = mode;
    settings.permissionMode = mode;
  }
  const permissionModeComposerInput = document.getElementById('permissionModeComposerInput');
  if (permissionModeComposerInput) {
    const raw = settings && typeof settings.permissionMode === 'string' ? settings.permissionMode : '';
    const allowed = new Set(['plan', 'default', 'acceptEdits', 'bypassPermissions']);
    const mode = allowed.has(raw) ? raw : 'acceptEdits';
    permissionModeComposerInput.value = mode;
  }

  // Max budget (Agent SDK)
  try {
    const el = document.getElementById('maxBudgetUsdInput');
    const v = settings && typeof settings.maxBudgetUsd !== 'undefined' ? Number(settings.maxBudgetUsd) : 0;
    const normalized = (Number.isFinite(v) && v >= 0) ? v : 0;
    settings.maxBudgetUsd = normalized;
    if (el) el.value = normalized ? String(normalized) : '';
  } catch { /* ignore */ }

  // Claude model selector (value is applied immediately; options list is fetched async)
  try {
    const modelEl = document.getElementById('claudeModelComposerInput');
    if (modelEl) {
      const raw = settings && typeof settings.claudeModel === 'string' ? settings.claudeModel.trim() : '';
      modelEl.value = raw || '';
    }
  } catch { /* ignore */ }

  // Network policy UI
  try {
    const modeEl = document.getElementById('networkPolicyModeInput');
    const allowlistGroup = document.getElementById('networkAllowlistGroup');
    const allowlistEl = document.getElementById('networkAllowlistInput');
    const allowed = new Set(['allow_all', 'deny_all', 'allowlist']);
    const rawMode = settings && typeof settings.networkPolicyMode === 'string' ? settings.networkPolicyMode : '';
    const mode = allowed.has(rawMode) ? rawMode : 'allow_all';
    settings.networkPolicyMode = mode;
    if (modeEl) modeEl.value = mode;

    const list = Array.isArray(settings.networkAllowlist) ? settings.networkAllowlist : [];
    const normalized = list.map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
    settings.networkAllowlist = normalized;
    if (allowlistEl) allowlistEl.value = normalized.join('\n');
    if (allowlistGroup) allowlistGroup.style.display = (mode === 'allowlist') ? '' : 'none';
  } catch {
    // ignore
  }

  // AI automations UI
  try {
    settings.enableDocsLearningOnFix = settings?.enableDocsLearningOnFix === true;
    const fixDocsToggle = document.getElementById('enableDocsLearningOnFixToggle');
    if (fixDocsToggle) {
      fixDocsToggle.checked = settings.enableDocsLearningOnFix === true;
    }
  } catch {
    // ignore
  }

  // Editor enhancements UI
  try {
    settings.enableProblemsPanel = settings?.enableProblemsPanel === true;
    settings.enableAiQuickFixes = settings?.enableAiQuickFixes === true;
    settings.enableTsJsLanguageService = settings?.enableTsJsLanguageService === true;
    settings.enableWebLanguageServices = settings?.enableWebLanguageServices === true;

    const problemsToggle = document.getElementById('enableProblemsToggle');
    if (problemsToggle) problemsToggle.checked = settings.enableProblemsPanel === true;
    const aiToggle = document.getElementById('enableAiQuickFixesToggle');
    if (aiToggle) aiToggle.checked = settings.enableAiQuickFixes === true;
    const tsToggle = document.getElementById('enableTsJsLanguageServiceToggle');
    if (tsToggle) tsToggle.checked = settings.enableTsJsLanguageService === true;
    const webToggle = document.getElementById('enableWebLanguageServicesToggle');
    if (webToggle) webToggle.checked = settings.enableWebLanguageServices === true;
    applyEditorEnhancementsSettingsUI();
    if (settings.enableTsJsLanguageService === true) configureMonacoTsJsServiceOnce();
    if (settings.enableWebLanguageServices === true) configureMonacoWebLanguageServicesOnce();
  } catch {
    // ignore
  }

  // LLM Provider selection (3 options: claude_ai, anthropic_api, openrouter)
  try {
    // Normalize provider setting
    const validProviders = new Set(['claude_ai', 'anthropic_api', 'openrouter', 'codex']);
    if (!settings.llmProvider || !validProviders.has(settings.llmProvider)) {
      // Migrate from old settings
      if (settings.useOpenRouter === true) {
        settings.llmProvider = 'openrouter';
      } else if (settings.authMode === 'claude_ai') {
        settings.llmProvider = 'claude_ai';
      } else {
        settings.llmProvider = 'anthropic_api';
      }
    }

    // Set radio buttons
    const providerClaudeAi = document.getElementById('providerClaudeAiRadio');
    const providerAnthropic = document.getElementById('providerAnthropicRadio');
    const providerOpenRouter = document.getElementById('providerOpenRouterRadio');
    const providerCodex = document.getElementById('providerCodexRadio');
    
    if (providerClaudeAi) providerClaudeAi.checked = settings.llmProvider === 'claude_ai';
    if (providerAnthropic) providerAnthropic.checked = settings.llmProvider === 'anthropic_api';
    if (providerOpenRouter) providerOpenRouter.checked = settings.llmProvider === 'openrouter';
    if (providerCodex) providerCodex.checked = settings.llmProvider === 'codex';

    // Load OpenRouter settings
    settings.openrouterApiKey = settings && typeof settings.openrouterApiKey === 'string' ? settings.openrouterApiKey : '';
    settings.openrouterModel = settings && typeof settings.openrouterModel === 'string' ? settings.openrouterModel : '';
    
    const orApiKeyInput = document.getElementById('openrouterApiKeyInput');
    if (orApiKeyInput) orApiKeyInput.value = settings.openrouterApiKey || '';
    
    const orModelInput = document.getElementById('openrouterModelInput');
    if (orModelInput) orModelInput.value = settings.openrouterModel || '';

    // Load Codex settings
    settings.codexModel = settings && typeof settings.codexModel === 'string' && settings.codexModel ? settings.codexModel : 'codex/gpt-5.5';
    const codexModelInput = document.getElementById('codexModelInput');
    if (codexModelInput) codexModelInput.value = settings.codexModel;
    
    applyLlmProviderUI();
  } catch {
    // ignore
  }

  normalizeClaudeAuthMode();
  applyClaudeAuthSettingsUI({ refreshStatus: false });

  // Best-effort: populate the model dropdown after settings/auth are loaded.
  try { refreshClaudeModelComposerSelect({ force: false }); } catch { /* ignore */ }
}


// Save settings to file system (Desktop App)
async function saveSettings() {
  // Expose settings globally for tools to access
  window.appSettings = settings;
  
  if (window.electronAPI) {
    const result = await window.electronAPI.saveSettings(settings);
    if (result.success) {
      console.log('[Settings] Saved to disk:', result.path);
    } else {
      console.error('[Settings] Failed to save:', result.error);
    }
  }
}


function normalizeClaudeAuthMode() {
  const v = settings && typeof settings.authMode === 'string' ? settings.authMode : '';
  if (v === 'claude_ai' || v === 'api_key') return;
  const hasApiKey = typeof settings.apiKey === 'string' && settings.apiKey.trim().length > 0;
  settings.authMode = hasApiKey ? 'api_key' : 'claude_ai';
}


function applyClaudeAuthSettingsUI({ refreshStatus = false } = {}) {
  // This function is now simplified - just handle Claude.ai login status
  checkApiKey();
  if (refreshStatus) refreshClaudeAuthStatus().catch(() => {});
}
