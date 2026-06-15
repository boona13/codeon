(function () {
  // Context snapshots for transparency: what did we send to Claude SDK at run start?
  // In-memory only (no persistence) to keep it safe + lightweight.

  const byRequestId = new Map(); // requestId -> snapshot
  const bySessionId = new Map(); // sessionId -> [requestId newest-first]
  const MAX_PER_SESSION = 50;

  function _nowIso() {
    try { return new Date().toISOString(); } catch { return String(Date.now()); }
  }

  function _safeClone(obj) {
    // Avoid throwing on circulars; keep it best-effort.
    try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
  }

  function record(snapshot) {
    try {
      const s = snapshot && typeof snapshot === 'object' ? snapshot : null;
      const requestId = s && typeof s.requestId === 'string' ? s.requestId.trim() : '';
      const sessionId = s && typeof s.sessionId === 'string' ? s.sessionId.trim() : '';
      if (!requestId || !sessionId) return false;

      const full = {
        schema: 'codeon.context_snapshot.v1',
        capturedAt: _nowIso(),
        ..._safeClone(s)
      };
      byRequestId.set(requestId, full);

      const list = bySessionId.get(sessionId) || [];
      const next = [requestId, ...list.filter(id => id !== requestId)].slice(0, MAX_PER_SESSION);
      bySessionId.set(sessionId, next);
      return true;
    } catch {
      return false;
    }
  }

  function getByRequestId(requestId) {
    const rid = String(requestId || '').trim();
    if (!rid) return null;
    return byRequestId.get(rid) || null;
  }

  function listForSession(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) return [];
    const ids = bySessionId.get(sid) || [];
    return ids.map(id => byRequestId.get(id)).filter(Boolean);
  }

  function getLatestForSession(sessionId) {
    const list = listForSession(sessionId);
    return list.length ? list[0] : null;
  }

  window.codeonContextSnapshots = {
    record,
    getByRequestId,
    listForSession,
    getLatestForSession
  };
})();


