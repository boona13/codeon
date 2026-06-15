(function () {
  'use strict';

  if (window._proofedEditsState) return;

  const STORAGE_KEY = 'codeon.proofedEdits';
  const PROOFED_STATE_REL_PATH = 'verification/codeon-proofed-edits.json';
  const MAX_ENTRIES_PER_SESSION = 30;
  const MAX_SESSIONS = 12;

  const state = {
    entries: Object.create(null),
    enabledSessions: Object.create(null)
  };

  const _now = () => Date.now();
  const _trim = (s) => (typeof s === 'string' ? s.trim() : '');
  const _projectId = () => _trim(window.currentFolder || window.currentProjectPath || '') || 'default';
  const _canUseWorkspaceFs = () => !!(window.currentFolder && window.electronAPI &&
    typeof window.electronAPI.readFile === 'function' &&
    typeof window.electronAPI.writeFile === 'function' &&
    typeof window.electronAPI.createDirectory === 'function');

  const _getProofedStatePath = () => PROOFED_STATE_REL_PATH;

  function _matchesProject(entry, projectId) {
    if (!entry || !projectId) return false;
    return _trim(entry.projectId) === projectId;
  }

  function _filterEntriesByProject(projectId) {
    const out = Object.create(null);
    for (const sid of Object.keys(state.entries || {})) {
      const session = state.entries[sid];
      if (!session) continue;
      const nextSession = Object.create(null);
      for (const [rid, entry] of Object.entries(session)) {
        if (_matchesProject(entry, projectId)) {
          nextSession[rid] = entry;
        }
      }
      if (Object.keys(nextSession).length) out[sid] = nextSession;
    }
    return out;
  }

  function _clearProjectEntries(projectId) {
    for (const sid of Object.keys(state.entries || {})) {
      const session = state.entries[sid];
      if (!session) continue;
      let removed = false;
      for (const [rid, entry] of Object.entries(session)) {
        if (_matchesProject(entry, projectId)) {
          delete session[rid];
          removed = true;
        }
      }
      if (removed && Object.keys(session).length === 0) {
        delete state.entries[sid];
      }
    }
  }

  function _mergeProjectEntries(projectId, incomingEntries) {
    if (!incomingEntries || typeof incomingEntries !== 'object') return;
    _clearProjectEntries(projectId);
    for (const [sid, session] of Object.entries(incomingEntries)) {
      if (!session || typeof session !== 'object') continue;
      const target = state.entries[sid] || Object.create(null);
      for (const [rid, entry] of Object.entries(session)) {
        if (!entry || typeof entry !== 'object') continue;
        entry.projectId = projectId;
        target[rid] = entry;
      }
      state.entries[sid] = target;
    }
  }

  function _ensureSession(sessionId) {
    const sid = _trim(sessionId);
    if (!sid) return null;
    if (!state.entries[sid]) state.entries[sid] = Object.create(null);
    return state.entries[sid];
  }

  function _notify() {
    try { window._onProofedEditsStateUpdate?.(); } catch { /* ignore */ }
  }

  function _prune() {
    try {
      const sessionIds = Object.keys(state.entries || {});
      if (sessionIds.length > MAX_SESSIONS) {
        sessionIds.sort((a, b) => {
          const aLatest = getLatestEntryTimestamp(a);
          const bLatest = getLatestEntryTimestamp(b);
          return aLatest - bLatest;
        });
        const toDelete = sessionIds.slice(0, sessionIds.length - MAX_SESSIONS);
        for (const sid of toDelete) {
          delete state.entries[sid];
        }
      }
      for (const sid of Object.keys(state.entries || {})) {
        const session = state.entries[sid];
        const entries = Object.values(session || {});
        if (entries.length > MAX_ENTRIES_PER_SESSION) {
          entries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          const keep = entries.slice(entries.length - MAX_ENTRIES_PER_SESSION);
          const next = Object.create(null);
          for (const e of keep) next[e.runRequestId] = e;
          state.entries[sid] = next;
        }
      }
    } catch { /* ignore */ }
  }

  function getLatestEntryTimestamp(sessionId) {
    try {
      const session = state.entries[_trim(sessionId)] || {};
      const entries = Object.values(session);
      if (!entries.length) return 0;
      return entries.reduce((acc, e) => Math.max(acc, Number(e?.updatedAt || e?.timestamp || 0)), 0);
    } catch {
      return 0;
    }
  }

  function isVerificationEnabled(sessionId) {
    const sid = _trim(sessionId);
    if (!sid) return false;
    return state.enabledSessions[sid] === true;
  }

  function setVerificationEnabled(enabled, sessionId) {
    const sid = _trim(sessionId);
    if (!sid) return;
    state.enabledSessions[sid] = enabled === true;
    saveState();
    _notify();
  }

  function isVerificationRunning(sessionId) {
    const sid = _trim(sessionId);
    if (!sid) return false;
    const session = state.entries[sid] || {};
    const pid = _projectId();
    return Object.values(session).some(e => e && e.status === 'running' && _matchesProject(e, pid));
  }

  function createEntry({ sessionId, runRequestId, summary = '', status = 'pending', originalPrompt = '', metadata = {}, restoreCheckpointHash = '' } = {}) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return null;

    const session = _ensureSession(sid);
    if (!session) return null;

    if (session[rid]) return session[rid];

    const entry = {
      sessionId: sid,
      runRequestId: rid,
      projectId: _projectId(),
      timestamp: _now(),
      updatedAt: _now(),
      status: _trim(status) || 'pending',
      summary: _trim(summary),
      originalPrompt: _trim(originalPrompt),
      confidencePct: null,
      checks: [],
      filesModified: Array.isArray(metadata.filesModified) ? metadata.filesModified.slice(0, 200) : [],
      toolsUsed: Array.isArray(metadata.toolsUsed) ? metadata.toolsUsed.slice(0, 120) : [],
      warnings: [],
      restoreCheckpointHash: _trim(restoreCheckpointHash)
    };

    session[rid] = entry;
    _prune();
    saveState();
    _notify();
    return entry;
  }

  function updateEntry(sessionId, runRequestId, patch = {}) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return null;
    const session = _ensureSession(sid);
    if (!session || !session[rid]) return null;
    const entry = session[rid];
    const pid = _projectId();
    if (!_matchesProject(entry, pid)) return null;
    try {
      Object.assign(entry, patch && typeof patch === 'object' ? patch : {});
      entry.updatedAt = _now();
    } catch { /* ignore */ }
    _prune();
    saveState();
    _notify();
    return entry;
  }

  function getEntry(sessionId, runRequestId) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return null;
    const session = state.entries[sid];
    const entry = session && session[rid] ? session[rid] : null;
    if (!entry) return null;
    return _matchesProject(entry, _projectId()) ? entry : null;
  }

  function getEntriesForSession(sessionId) {
    const sid = _trim(sessionId);
    if (!sid) return [];
    const session = state.entries[sid] || {};
    const pid = _projectId();
    return Object.values(session)
      .filter(e => _matchesProject(e, pid))
      .sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0));
  }

  function deleteEntry(sessionId, runRequestId) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return;
    const session = state.entries[sid];
    if (!session || !session[rid]) return;
    if (!_matchesProject(session[rid], _projectId())) return;
    delete session[rid];
    saveState();
    _notify();
  }

  function saveState() {
    try {
      const data = JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY, data);
    } catch { /* ignore */ }
    try {
      if (!_canUseWorkspaceFs()) return;
      const pid = _projectId();
      const projectEntries = _filterEntriesByProject(pid);
      if (!Object.keys(projectEntries).length) return;
      const payload = JSON.stringify({ v: 1, projectId: pid, entries: projectEntries }, null, 2);
      window.electronAPI.createDirectory('verification').catch(() => {});
      window.electronAPI.writeFile(_getProofedStatePath(), payload, false).catch(() => {});
    } catch { /* ignore */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.entries) {
        state.entries = parsed.entries;
        state.enabledSessions = parsed.enabledSessions || Object.create(null);
      }
    } catch { /* ignore */ }
  }

  async function reloadFromWorkspace({ clearIfMissing = false } = {}) {
    try {
      const pid = _projectId();
      if (!_canUseWorkspaceFs()) {
        if (clearIfMissing) {
          _clearProjectEntries(pid);
          saveState();
          _notify();
        }
        return false;
      }
      const rr = await window.electronAPI.readFile(_getProofedStatePath());
      if (!rr || rr.success !== true || !rr.content) {
        if (clearIfMissing) {
          _clearProjectEntries(pid);
          saveState();
          _notify();
        }
        return false;
      }
      const data = JSON.parse(rr.content);
      if (data && typeof data === 'object' && data.entries) {
        const fileProjectId = _trim(data.projectId || '');
        if (fileProjectId && fileProjectId !== pid) {
          if (clearIfMissing) {
            _clearProjectEntries(pid);
            saveState();
            _notify();
          }
          return false;
        }
        _mergeProjectEntries(pid, data.entries);
        _notify();
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  loadState();
  reloadFromWorkspace().catch(() => {});

  window._proofedEditsState = {
    createEntry,
    updateEntry,
    getEntry,
    getEntriesForSession,
    deleteEntry,
    isVerificationEnabled,
    isVerificationRunning,
    setVerificationEnabled,
    reloadFromWorkspace
  };
})();
