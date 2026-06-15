// ============================================================================
// LEARNING STATE (Codeon Learning Feature)
// State management for AI learning explanations after each run
// ============================================================================

(function () {
  'use strict';

  if (window._learningState) return;

  // Constants
  const STORAGE_KEY = 'codeon.learning';
  const LEARNING_STATE_REL_PATH = 'learning/codeon-learning.json';
  const MAX_ENTRIES_PER_SESSION = 20;
  const MAX_SESSIONS = 10;

  // In-memory state
  const state = {
    // learningEntries: { sessionId: { runRequestId: LearningEntry } }
    entries: Object.create(null),
    // Per-session learning enabled state: { sessionId: boolean }
    // Each new session defaults to false (off)
    enabledSessions: Object.create(null),
    // Currently viewed entry
    activeEntryId: null,
    // UI state
    isGenerating: false,
    currentGeneratingRunId: null,
    // View mode
    view: 'list' // 'list' | 'detail'
  };

  /**
   * LearningEntry Schema:
   * {
   *   runRequestId: string,
   *   sessionId: string,
   *   timestamp: number,
   *   originalPrompt: string,
   *   status: 'pending' | 'generating' | 'completed' | 'error',
   *   content: {
   *     summary: string,           // What happened (high-level)
   *     reasoning: string,         // Why this approach
   *     technical: string,         // How it works (algorithms, patterns, etc.)
   *     concepts: [                // Key concepts to learn
   *       { name: string, explanation: string, category: string }
   *     ],
   *     codeHighlights: [          // Important code snippets with explanations
   *       { file: string, snippet: string, explanation: string }
   *     ]
   *   },
   *   metadata: {
   *     toolsUsed: string[],
   *     filesModified: string[],
   *     durationMs: number,
   *     tokensUsed: number
   *   },
   *   error: string | null
   * }
   */

  // === Helpers ===
  const _now = () => Date.now();
  const _trim = (s) => (typeof s === 'string' ? s.trim() : '');
  const _sid = () => _trim(window.currentSessionId || '');

  function _isPlanMode() {
    try {
      return (window.appSettings && window.appSettings.permissionMode === 'plan');
    } catch {
      return false;
    }
  }

  function _ensureSession(sessionId) {
    const sid = _trim(sessionId);
    if (!sid) return null;
    if (!state.entries[sid]) state.entries[sid] = Object.create(null);
    return state.entries[sid];
  }

  // === Learning Mode Setting (Per-Session) ===
  // Learning mode is OFF by default for each new session
  // User must explicitly enable it for each session
  function isLearningEnabled(sessionId) {
    const sid = _trim(sessionId || _sid());
    if (!sid) return false;
    if (_isPlanMode()) return false;
    // Default to false (off) for new sessions
    return state.enabledSessions[sid] === true;
  }

  function setLearningEnabled(enabled, sessionId) {
    const sid = _trim(sessionId || _sid());
    if (!sid) return;
    if (enabled && _isPlanMode()) return;
    state.enabledSessions[sid] = !!enabled;
    // Note: We don't persist this to disk - each new session starts fresh (off)
  }

  // === Entry Management ===
  function createEntry({ sessionId, runRequestId, originalPrompt, metadata = {} }) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return null;

    const session = _ensureSession(sid);
    if (!session) return null;

    // Don't recreate if exists
    if (session[rid]) return session[rid];

    const entry = {
      runRequestId: rid,
      sessionId: sid,
      timestamp: _now(),
      originalPrompt: _trim(originalPrompt) || '',
      status: 'pending',
      content: null,
      metadata: {
        toolsUsed: Array.isArray(metadata.toolsUsed) ? metadata.toolsUsed : [],
        filesModified: Array.isArray(metadata.filesModified) ? metadata.filesModified : [],
        durationMs: typeof metadata.durationMs === 'number' ? metadata.durationMs : 0,
        tokensUsed: 0
      },
      error: null
    };

    session[rid] = entry;
    _boundMemory(sid);
    _scheduleSave();

    return entry;
  }

  function getEntry(sessionId, runRequestId) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return null;
    const session = state.entries[sid];
    return session ? (session[rid] || null) : null;
  }

  function updateEntry(sessionId, runRequestId, patch) {
    const entry = getEntry(sessionId, runRequestId);
    if (!entry) return null;
    if (patch && typeof patch === 'object') {
      Object.assign(entry, patch);
    }
    _scheduleSave();
    return entry;
  }

  function setEntryGenerating(sessionId, runRequestId) {
    const entry = getEntry(sessionId, runRequestId);
    if (!entry) return;
    entry.status = 'generating';
    state.isGenerating = true;
    state.currentGeneratingRunId = runRequestId;
    _scheduleSave();
  }

  function setEntryCompleted(sessionId, runRequestId, content) {
    const entry = getEntry(sessionId, runRequestId);
    if (!entry) return;
    entry.status = 'completed';
    entry.content = content;
    if (state.currentGeneratingRunId === runRequestId) {
      state.isGenerating = false;
      state.currentGeneratingRunId = null;
    }
    _scheduleSave();
  }

  function setEntryError(sessionId, runRequestId, errorMessage) {
    const entry = getEntry(sessionId, runRequestId);
    if (!entry) return;
    entry.status = 'error';
    entry.error = _trim(errorMessage) || 'Unknown error';
    if (state.currentGeneratingRunId === runRequestId) {
      state.isGenerating = false;
      state.currentGeneratingRunId = null;
    }
    _scheduleSave();
  }

  function getEntriesForSession(sessionId) {
    const sid = _trim(sessionId || _sid());
    if (!sid) return [];
    const session = state.entries[sid];
    if (!session) return [];
    return Object.values(session)
      .filter(e => e && e.timestamp)
      .sort((a, b) => b.timestamp - a.timestamp); // newest first
  }

  function getAllEntries() {
    const all = [];
    for (const sid of Object.keys(state.entries)) {
      const session = state.entries[sid];
      if (!session) continue;
      for (const entry of Object.values(session)) {
        if (entry && entry.timestamp) all.push(entry);
      }
    }
    return all.sort((a, b) => b.timestamp - a.timestamp);
  }

  function deleteEntry(sessionId, runRequestId) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return;
    const session = state.entries[sid];
    if (session && session[rid]) {
      delete session[rid];
      _scheduleSave();
    }
  }

  function clearSessionEntries(sessionId) {
    const sid = _trim(sessionId);
    if (!sid) return;
    if (state.entries[sid]) {
      delete state.entries[sid];
      _scheduleSave();
    }
  }

  // === View State ===
  function setActiveEntry(runRequestId) {
    state.activeEntryId = _trim(runRequestId) || null;
    state.view = runRequestId ? 'detail' : 'list';
  }

  function getActiveEntry() {
    if (!state.activeEntryId) return null;
    const sid = _sid();
    return getEntry(sid, state.activeEntryId);
  }

  function setView(view) {
    state.view = view === 'detail' ? 'detail' : 'list';
    if (view === 'list') state.activeEntryId = null;
  }

  function getView() {
    return state.view;
  }

  function isGenerating() {
    return state.isGenerating;
  }

  function getCurrentGeneratingRunId() {
    return state.currentGeneratingRunId;
  }

  // === Memory Management ===
  function _boundMemory(sessionId) {
    const session = state.entries[sessionId];
    if (!session) return;
    const entries = Object.values(session)
      .filter(e => e && e.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (entries.length > MAX_ENTRIES_PER_SESSION) {
      const toDelete = entries.slice(0, entries.length - MAX_ENTRIES_PER_SESSION);
      for (const e of toDelete) {
        delete session[e.runRequestId];
      }
    }
  }

  function _boundGlobalMemory() {
    const sids = Object.keys(state.entries);
    if (sids.length > MAX_SESSIONS) {
      // Find oldest sessions by looking at their newest entry
      const sessionAges = sids.map(sid => {
        const session = state.entries[sid];
        const entries = session ? Object.values(session) : [];
        const newest = entries.reduce((max, e) => Math.max(max, e?.timestamp || 0), 0);
        return { sid, newest };
      }).sort((a, b) => a.newest - b.newest);
      
      const toDelete = sessionAges.slice(0, sessionAges.length - MAX_SESSIONS);
      for (const { sid } of toDelete) {
        delete state.entries[sid];
      }
    }
  }

  // === Persistence ===
  let _saveTimer = null;

  function _canUseWorkspaceFs() {
    return !!(window.currentFolder && window.electronAPI &&
      typeof window.electronAPI.readFile === 'function' &&
      typeof window.electronAPI.writeFile === 'function' &&
      typeof window.electronAPI.createDirectory === 'function');
  }

  function _getLearningStatePath() {
    return LEARNING_STATE_REL_PATH;
  }

  function _scheduleSave() {
    if (_saveTimer) return;
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      _saveToStorage();
    }, 500);
  }

  function _saveToStorage() {
    try {
      _boundGlobalMemory();
      const data = JSON.stringify(state.entries);
      try { localStorage.setItem(STORAGE_KEY, data); } catch { /* ignore */ }
      if (_canUseWorkspaceFs()) {
        const relPath = _getLearningStatePath();
        window.electronAPI.createDirectory('learning').catch(() => {});
        window.electronAPI.writeFile(relPath, data, false).catch(() => {});
      }
    } catch (e) {
      console.warn('[Learning] Failed to save state:', e);
    }
  }

  function _loadFromStorage() {
    try {
      let raw = '';
      if (_canUseWorkspaceFs()) {
        try {
          const res = window.electronAPI.readFile(_getLearningStatePath());
          if (res && res.then) {
            // async path
            return res.then((r) => {
              const content = r && r.success ? String(r.content || '') : '';
              if (content) {
                const data = JSON.parse(content);
                if (data && typeof data === 'object') state.entries = data;
              } else {
                _loadFromLocalStorage();
              }
            }).catch(() => _loadFromLocalStorage());
          }
        } catch { /* ignore */ }
      }
      _loadFromLocalStorage();
    } catch (e) {
      console.warn('[Learning] Failed to load state:', e);
    }
  }

  function _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        state.entries = data;
      }
    } catch (e) {
      console.warn('[Learning] Failed to load local state:', e);
    }
  }

  function reloadFromWorkspace({ clearIfMissing = false } = {}) {
    if (!_canUseWorkspaceFs()) return;
    try {
      return window.electronAPI.readFile(_getLearningStatePath())
        .then((res) => {
          const content = res && res.success ? String(res.content || '') : '';
          if (!content) {
            if (clearIfMissing) {
              state.entries = Object.create(null);
              _scheduleSave();
            }
            return;
          }
          const data = JSON.parse(content);
          if (data && typeof data === 'object') {
            state.entries = data;
            _normalizeAfterLoad();
          }
        })
        .catch(() => {
          if (clearIfMissing) {
            state.entries = Object.create(null);
            _scheduleSave();
          }
        });
    } catch { /* ignore */ }
  }

  function _normalizeAfterLoad() {
    try {
      for (const sid of Object.keys(state.entries || {})) {
        const session = state.entries[sid];
        if (!session) continue;
        for (const entry of Object.values(session)) {
          if (entry && entry.status === 'generating') {
            delete session[entry.runRequestId];
          }
        }
      }
    } catch { /* ignore */ }
    state.isGenerating = false;
    state.currentGeneratingRunId = null;
  }

  // === Initialize ===
  function init() {
    const maybe = _loadFromStorage();
    if (maybe && typeof maybe.then === 'function') {
      maybe.finally(() => _normalizeAfterLoad());
    } else {
    _normalizeAfterLoad();
    }
  }

  // Auto-init
  init();

  // === Expose API ===
  window._learningState = {
    // Settings
    isLearningEnabled,
    setLearningEnabled,
    // Entry CRUD
    createEntry,
    getEntry,
    updateEntry,
    deleteEntry,
    clearSessionEntries,
    // Entry status
    setEntryGenerating,
    setEntryCompleted,
    setEntryError,
    // Queries
    getEntriesForSession,
    getAllEntries,
    // View state
    setActiveEntry,
    getActiveEntry,
    setView,
    getView,
    isGenerating,
    getCurrentGeneratingRunId,
    // Persistence
    save: _saveToStorage,
    reload: _loadFromStorage,
    reloadFromWorkspace
  };
})();
