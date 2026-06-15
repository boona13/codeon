// Pinboard (“Project Brain”) — persistent pins across runs
// Storage: main process persists to .ai-agent/mindmap-pinboard.json
/* global showToast */

(function () {
  const MAX_PINS = 600;

  function _now() { return Date.now(); }

  function _normRel(p) {
    try {
      let s = String(p || '').trim();
      if (!s) return '';
      s = s.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
      return s;
    } catch {
      return '';
    }
  }

  function _safeStr(s, max = 280) {
    try {
      const v = String(s || '');
      if (!v) return '';
      return v.length > max ? v.slice(0, max) : v;
    } catch {
      return '';
    }
  }

  function _pinIdFromRef(ref) {
    try {
      const r = ref && typeof ref === 'object' ? ref : {};
      if (r.filePath) return `pin:file:${_normRel(r.filePath)}`;
      if (r.aetNodeId && r.runId) return `pin:aet:${String(r.runId).trim()}:${String(r.aetNodeId).trim()}`;
      if (r.toolUseId) return `pin:tool:${String(r.toolUseId).trim()}`;
      return `pin:unknown:${Math.random().toString(16).slice(2)}`;
    } catch {
      return `pin:unknown:${Math.random().toString(16).slice(2)}`;
    }
  }

  const cacheByProjectPath = new Map(); // projectPath -> { loadedAt, data }
  const inFlightByProjectPath = new Map(); // projectPath -> Promise

  async function _fetchPinboard(projectPath) {
    const pp = String(projectPath || '').trim();
    if (!pp) return { v: 1, pins: [] };
    if (!window.electronAPI || typeof window.electronAPI.mindmapPinboardGet !== 'function') {
      return { v: 1, pins: [] };
    }
    const res = await window.electronAPI.mindmapPinboardGet(pp);
    if (!res || res.success !== true) return { v: 1, pins: [] };
    const pins = Array.isArray(res.pins) ? res.pins : [];
    return { v: 1, pins: pins.slice(0, MAX_PINS) };
  }

  async function getPinboard(projectPath) {
    const pp = String(projectPath || '').trim();
    if (!pp) return { v: 1, pins: [] };

    const cached = cacheByProjectPath.get(pp);
    if (cached && cached.data) return cached.data;

    const inFlight = inFlightByProjectPath.get(pp);
    if (inFlight) return await inFlight;

    const p = (async () => {
      const data = await _fetchPinboard(pp);
      cacheByProjectPath.set(pp, { loadedAt: _now(), data });
      inFlightByProjectPath.delete(pp);
      return data;
    })();
    inFlightByProjectPath.set(pp, p);
    return await p;
  }

  async function _persistPinboard(projectPath, pinboard) {
    const pp = String(projectPath || '').trim();
    if (!pp) return { success: false, error: 'Missing projectPath' };
    if (!window.electronAPI || typeof window.electronAPI.mindmapPinboardSet !== 'function') {
      return { success: false, error: 'Pinboard IPC not available' };
    }
    const pins = Array.isArray(pinboard?.pins) ? pinboard.pins : [];
    const res = await window.electronAPI.mindmapPinboardSet(pp, pins.slice(0, MAX_PINS));
    if (!res || res.success !== true) return { success: false, error: res?.error || 'Failed to save pinboard' };
    const next = { v: 1, pins: Array.isArray(res.pins) ? res.pins : pins.slice(0, MAX_PINS) };
    cacheByProjectPath.set(pp, { loadedAt: _now(), data: next });
    return { success: true, pinboard: next };
  }

  function _coercePin(pin) {
    const p = pin && typeof pin === 'object' ? pin : {};
    const ref = p.ref && typeof p.ref === 'object' ? p.ref : {};
    const filePath = ref.filePath ? _normRel(ref.filePath) : '';
    const runId = _safeStr(ref.runId || '', 120);
    const aetNodeId = _safeStr(ref.aetNodeId || '', 120);
    const toolUseId = _safeStr(ref.toolUseId || '', 160);
    const ref2 = {};
    if (filePath) ref2.filePath = filePath;
    if (runId && aetNodeId) { ref2.runId = runId; ref2.aetNodeId = aetNodeId; }
    if (toolUseId) ref2.toolUseId = toolUseId;

    const id = _safeStr(p.id || _pinIdFromRef(ref2), 200);
    const createdAt = Number.isFinite(Number(p.createdAt)) ? Number(p.createdAt) : _now();
    const label = _safeStr(p.label || (filePath || 'Pin'), 160);
    const note = _safeStr(p.note || '', 700);
    return { id, createdAt, label, ref: ref2, note };
  }

  async function togglePinForRef(projectPath, { ref, label = '', note = '' } = {}) {
    const pp = String(projectPath || '').trim();
    if (!pp) return { success: false, error: 'Missing projectPath' };

    const pinboard = await getPinboard(pp);
    const pins = Array.isArray(pinboard.pins) ? pinboard.pins.slice() : [];

    const coercedRef = (ref && typeof ref === 'object') ? ref : {};
    const wantId = _pinIdFromRef(coercedRef);
    const idx = pins.findIndex(p => p && String(p.id || '') === wantId);
    if (idx >= 0) {
      pins.splice(idx, 1);
      const res = await _persistPinboard(pp, { v: 1, pins });
      try { if (res.success) showToast?.('Unpinned'); } catch { /* ignore */ }
      return res.success ? { success: true, pinned: false, pinboard: res.pinboard } : res;
    }

    const nextPin = _coercePin({ id: wantId, createdAt: _now(), label, ref: coercedRef, note });
    pins.unshift(nextPin);
    if (pins.length > MAX_PINS) pins.splice(MAX_PINS);
    const res2 = await _persistPinboard(pp, { v: 1, pins });
    try { if (res2.success) showToast?.('Pinned'); } catch { /* ignore */ }
    return res2.success ? { success: true, pinned: true, pinboard: res2.pinboard } : res2;
  }

  function isPinned(pinboard, { ref } = {}) {
    try {
      const pins = Array.isArray(pinboard?.pins) ? pinboard.pins : [];
      if (pins.length === 0) return false;
      const id = _pinIdFromRef(ref || {});
      return pins.some(p => p && String(p.id || '') === id);
    } catch {
      return false;
    }
  }

  window.CodeonPinboard = {
    getPinboard,
    togglePinForRef,
    isPinned
  };
})();


