// ============================================================================
// DOCS STATE (Codeon Documentation Mode)
// State management for auto-generated documentation updates
// ============================================================================

(function () {
  'use strict';

  if (window._docsState) return;

  // Constants
  const STORAGE_KEY = 'codeon.docs';
  const DOCS_STATE_REL_PATH = 'docs/codeon-docs.json';
  const MAX_ENTRIES_PER_PROJECT = 200;
  const MAX_PROJECTS = 10;

  // In-memory state
  const state = {
    // entries: { [projectId]: { [runRequestId]: DocEntry } }
    entries: Object.create(null),
    // Per-session docs enabled state: { sessionId: boolean }
    enabledSessions: Object.create(null),
    activeEntryId: null,
    view: 'list', // 'list' | 'detail' | 'web'
    isGenerating: false,
    currentGeneratingRunId: null
  };

  /**
   * DocEntry Schema:
   * {
   *   runRequestId: string,
   *   sessionId: string,
   *   projectId: string,
   *   timestamp: number,
   *   originalPrompt: string,
   *   status: 'pending' | 'generating' | 'completed' | 'error',
   *   content: {
   *     rawMarkdown: string,
   *     title: string,
   *     summary: string
   *   } | null,
   *   metadata: {
   *     toolsUsed: string[],
   *     filesModified: string[],
   *     durationMs: number
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

  function _projectId() {
    const p = _trim(window.currentFolder || window.currentProjectPath || '');
    return p || 'default';
  }

  function _canUseWorkspaceFs() {
    return !!(window.currentFolder && window.electronAPI &&
      typeof window.electronAPI.readFile === 'function' &&
      typeof window.electronAPI.writeFile === 'function' &&
      typeof window.electronAPI.createDirectory === 'function');
  }

  function _getDocsStatePath() {
    return DOCS_STATE_REL_PATH;
  }

  function _ensureProject(projectId) {
    const pid = _trim(projectId);
    if (!pid) return null;
    if (!state.entries[pid]) state.entries[pid] = Object.create(null);
    return state.entries[pid];
  }

  // === Documentation Mode Setting (Per-Session) ===
  // Docs mode is opt-in per session via the Docs panel toggle.
  function isDocsEnabled(sessionId) {
    const sid = _trim(sessionId || _sid());
    if (!sid) return false;
    if (_isPlanMode()) return false;
    if (Object.prototype.hasOwnProperty.call(state.enabledSessions, sid)) {
      return state.enabledSessions[sid] === true;
    }
    // Default to disabled when not explicitly set for this session.
    return false;
  }

  function setDocsEnabled(enabled, sessionId) {
    const sid = _trim(sessionId || _sid());
    if (!sid) return;
    if (enabled && _isPlanMode()) return;
    state.enabledSessions[sid] = enabled === true;
    try { window._onDocsStateUpdate?.(); } catch { /* ignore */ }
  }

  function resetDocsEnabled() {
    state.enabledSessions = Object.create(null);
    try { window._onDocsStateUpdate?.(); } catch { /* ignore */ }
  }

  // === Entry Management ===
  function createEntry({ projectId, sessionId, runRequestId, originalPrompt, metadata = {} }) {
    const pid = _trim(projectId || _projectId());
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!pid || !rid) return null;

    const project = _ensureProject(pid);
    if (!project) return null;

    if (project[rid]) return project[rid];

    const entry = {
      runRequestId: rid,
      sessionId: sid,
      projectId: pid,
      timestamp: _now(),
      originalPrompt: _trim(originalPrompt) || '',
      status: 'pending',
      content: null,
      metadata: {
        toolsUsed: Array.isArray(metadata.toolsUsed) ? metadata.toolsUsed : [],
        filesModified: Array.isArray(metadata.filesModified) ? metadata.filesModified : [],
        durationMs: typeof metadata.durationMs === 'number' ? metadata.durationMs : 0
      },
      error: null
    };

    project[rid] = entry;
    _boundProject(pid);
    _scheduleSave();

    return entry;
  }

  function getEntry(projectId, runRequestId) {
    const pid = _trim(projectId || _projectId());
    const rid = _trim(runRequestId);
    if (!pid || !rid) return null;
    const project = state.entries[pid];
    return project ? (project[rid] || null) : null;
  }

  function updateEntry(projectId, runRequestId, patch) {
    const entry = getEntry(projectId, runRequestId);
    if (!entry) return null;
    if (patch && typeof patch === 'object') {
      Object.assign(entry, patch);
    }
    _scheduleSave();
    return entry;
  }

  function setEntryGenerating(projectId, runRequestId) {
    const entry = getEntry(projectId, runRequestId);
    if (!entry) return;
    entry.status = 'generating';
    state.isGenerating = true;
    state.currentGeneratingRunId = runRequestId;
    _scheduleSave();
  }

  function setEntryCompleted(projectId, runRequestId, content) {
    const entry = getEntry(projectId, runRequestId);
    if (!entry) return;
    entry.status = 'completed';
    entry.content = content || null;
    if (state.currentGeneratingRunId === runRequestId) {
      state.isGenerating = false;
      state.currentGeneratingRunId = null;
    }
    _scheduleSave();
  }

  function setEntryError(projectId, runRequestId, errorMessage) {
    const entry = getEntry(projectId, runRequestId);
    if (!entry) return;
    entry.status = 'error';
    entry.error = _trim(errorMessage) || 'Unknown error';
    if (state.currentGeneratingRunId === runRequestId) {
      state.isGenerating = false;
      state.currentGeneratingRunId = null;
    }
    _scheduleSave();
  }

  function getEntriesForProject(projectId) {
    const pid = _trim(projectId || _projectId());
    if (!pid) return [];
    const project = state.entries[pid];
    if (!project) return [];
    return Object.values(project)
      .filter(e => e && e.timestamp)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  function getAllEntries() {
    const all = [];
    for (const pid of Object.keys(state.entries)) {
      const project = state.entries[pid];
      if (!project) continue;
      for (const entry of Object.values(project)) {
        if (entry && entry.timestamp) all.push(entry);
      }
    }
    return all.sort((a, b) => b.timestamp - a.timestamp);
  }

  function deleteEntry(projectId, runRequestId) {
    const pid = _trim(projectId || _projectId());
    const rid = _trim(runRequestId);
    if (!pid || !rid) return;
    const project = state.entries[pid];
    if (project && project[rid]) {
      delete project[rid];
      _scheduleSave();
    }
  }

  function clearProjectEntries(projectId) {
    const pid = _trim(projectId || _projectId());
    if (!pid) return;
    if (state.entries[pid]) {
      delete state.entries[pid];
      _scheduleSave();
    }
  }

  // === View State ===
  function setActiveEntry(runRequestId) {
    state.activeEntryId = _trim(runRequestId) || null;
    state.view = runRequestId ? 'detail' : 'list';
  }

  function getActiveEntry(projectId) {
    if (!state.activeEntryId) return null;
    return getEntry(projectId || _projectId(), state.activeEntryId);
  }

  function setView(view) {
    state.view = view === 'detail' || view === 'web' ? view : 'list';
    if (state.view === 'list') state.activeEntryId = null;
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
  function _boundProject(projectId) {
    const project = state.entries[projectId];
    if (!project) return;
    const entries = Object.values(project)
      .filter(e => e && e.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (entries.length > MAX_ENTRIES_PER_PROJECT) {
      const toDelete = entries.slice(0, entries.length - MAX_ENTRIES_PER_PROJECT);
      for (const e of toDelete) {
        delete project[e.runRequestId];
      }
    }
  }

  function _boundGlobalMemory() {
    const pids = Object.keys(state.entries);
    if (pids.length > MAX_PROJECTS) {
      const projectAges = pids.map(pid => {
        const project = state.entries[pid];
        const entries = project ? Object.values(project) : [];
        const newest = entries.reduce((max, e) => Math.max(max, e?.timestamp || 0), 0);
        return { pid, newest };
      }).sort((a, b) => a.newest - b.newest);
      const toDelete = projectAges.slice(0, projectAges.length - MAX_PROJECTS);
      for (const { pid } of toDelete) {
        delete state.entries[pid];
      }
    }
  }

  // === Persistence ===
  let _saveTimer = null;

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
      localStorage.setItem(STORAGE_KEY, data);
    } catch (e) {
      console.warn('[Docs] Failed to save state:', e);
    }
    try { _saveToWorkspace(); } catch { /* ignore */ }
  }

  function _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        state.entries = data;
      }
    } catch (e) {
      console.warn('[Docs] Failed to load state:', e);
    }
  }

  function _normalizeAfterLoad() {
    try {
      for (const pid of Object.keys(state.entries || {})) {
        const project = state.entries[pid];
        if (!project) continue;
        for (const entry of Object.values(project)) {
          if (entry && entry.status === 'generating') {
            delete project[entry.runRequestId];
          }
        }
      }
    } catch { /* ignore */ }
    state.isGenerating = false;
    state.currentGeneratingRunId = null;
  }

  async function _saveToWorkspace() {
    try {
      if (!_canUseWorkspaceFs()) return;
      const relPath = _getDocsStatePath();
      // Ensure docs/ exists
      await window.electronAPI.createDirectory('docs');
      const payload = JSON.stringify({ v: 1, entries: state.entries }, null, 2);
      await window.electronAPI.writeFile(relPath, payload, false);
    } catch (e) {
      console.warn('[Docs] Failed to save to workspace:', e);
    }
  }

  async function _loadFromWorkspace({ clearIfMissing = false } = {}) {
    try {
      if (!_canUseWorkspaceFs()) return false;
      const relPath = _getDocsStatePath();
      const rr = await window.electronAPI.readFile(relPath);
      if (!rr || rr.success !== true || !rr.content) {
        if (clearIfMissing) {
          const pid = _projectId();
          if (pid && state.entries[pid]) {
            delete state.entries[pid];
            try {
              const data = JSON.stringify(state.entries);
              localStorage.setItem(STORAGE_KEY, data);
            } catch { /* ignore */ }
          }
        }
        return false;
      }
      const data = JSON.parse(rr.content);
      if (data && typeof data === 'object' && data.entries) {
        state.entries = data.entries;
        _normalizeAfterLoad();
        return true;
      }
    } catch (_e) {
      // Ignore if file missing or invalid
    }
    return false;
  }

  function init() {
    _loadFromStorage();
    _normalizeAfterLoad();
    // Prefer workspace file (git-tracked) when available
    _loadFromWorkspace().then((loaded) => {
      if (loaded) {
        try { window._onDocsStateUpdate?.(); } catch { /* ignore */ }
      }
    }).catch(() => {});
  }

  init();

  // === Expose API ===
  window._docsState = {
    getProjectId: _projectId,
    isDocsEnabled,
    setDocsEnabled,
    resetDocsEnabled,
    createEntry,
    getEntry,
    updateEntry,
    deleteEntry,
    clearProjectEntries,
    setEntryGenerating,
    setEntryCompleted,
    setEntryError,
    getEntriesForProject,
    getAllEntries,
    setActiveEntry,
    getActiveEntry,
    setView,
    getView,
    isGenerating,
    getCurrentGeneratingRunId,
    save: _saveToStorage,
    reload: _loadFromStorage,
    reloadFromWorkspace: _loadFromWorkspace,
    saveToWorkspace: _saveToWorkspace,
    getWorkspacePath: _getDocsStatePath
  };
})();
