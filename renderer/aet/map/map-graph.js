// AET Run Map — fold MapEvent[] into a deterministic graph
//
// Graph shape:
// - nodes: [{ id, type, label, refs, meta, t, orderIndex }]
// - edges: [{ id, type, from, to }]
//
// No external deps.

(function () {
  function _safeStr(s, max = 160) {
    try {
      const v = String(s || '');
      if (!v) return '';
      return v.length > max ? v.slice(0, max) + '…' : v;
    } catch {
      return '';
    }
  }

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

  function _edgeId(type, from, to) {
    return `${type}:${from}->${to}`;
  }

  function foldEventsToGraph(events, { pins = null } = {}) {
    const evts = Array.isArray(events) ? events : [];
    if (evts.length === 0) return { nodes: [], edges: [], nodesById: Object.create(null) };

    const firstRun = evts.find(e => e && e.kind === 'run_start') || null;
    const runId = firstRun ? String(firstRun.runId || '').trim() : '';
    if (!runId) return { nodes: [], edges: [], nodesById: Object.create(null) };

    const nodesById = Object.create(null);
    const edgesById = Object.create(null);
    const nodes = [];
    const edges = [];

    const ensureNode = ({ id, type, label, refs = {}, meta = {}, t = 0, orderIndex = 0 }) => {
      const nid = String(id || '').trim();
      if (!nid) return null;
      if (nodesById[nid]) return nodesById[nid];
      const n = {
        id: nid,
        type: String(type || 'node'),
        label: _safeStr(label || nid, 140),
        refs: (refs && typeof refs === 'object') ? refs : {},
        meta: (meta && typeof meta === 'object') ? meta : {},
        t: Number.isFinite(Number(t)) ? Number(t) : 0,
        orderIndex: Number.isFinite(Number(orderIndex)) ? Number(orderIndex) : 0
      };
      nodesById[nid] = n;
      nodes.push(n);
      return n;
    };

    const ensureEdge = ({ type, from, to }) => {
      const f = String(from || '').trim();
      const t = String(to || '').trim();
      if (!f || !t) return;
      const et = String(type || 'edge');
      const id = _edgeId(et, f, t);
      if (edgesById[id]) return;
      const e = { id, type: et, from: f, to: t };
      edgesById[id] = e;
      edges.push(e);
    };

    // Root run node
    const rootId = `run:${runId}`;
    ensureNode({
      id: rootId,
      type: 'root_run',
      label: `Run ${runId.slice(0, 8)}`,
      refs: { runId },
      meta: {},
      t: firstRun?.t || 0,
      orderIndex: 0
    });

    // Fold events
    for (const e of evts) {
      if (!e || typeof e !== 'object') continue;
      const kind = String(e.kind || '').trim();
      if (kind === 'goal') {
        const goalId = `goal:${runId}`;
        ensureNode({
          id: goalId,
          type: 'goal',
          label: _safeStr(String(e.text || ''), 120) || 'Goal',
          refs: { runId },
          meta: {},
          t: e.t,
          orderIndex: e.orderIndex
        });
        ensureEdge({ type: 'has_goal', from: rootId, to: goalId });
        continue;
      }

      if (kind === 'tool') {
        const toolUseId = String(e.toolUseId || '').trim();
        const aetNodeId = String(e.aetNodeId || '').trim();
        const toolKey = toolUseId || (aetNodeId ? `aet:${aetNodeId}` : `idx:${e.orderIndex}`);
        const toolId = `tool:${toolKey}`;
        ensureNode({
          id: toolId,
          type: 'tool',
          label: _safeStr(String(e.toolName || 'Tool'), 72),
          refs: {
            runId,
            ...(toolUseId ? { toolUseId } : {}),
            ...(aetNodeId ? { aetNodeId } : {})
          },
          meta: {
            summary: e.summary ? _safeStr(e.summary, 220) : undefined
          },
          t: e.t,
          orderIndex: e.orderIndex
        });
        ensureEdge({ type: 'used_tool', from: rootId, to: toolId });
        continue;
      }

      if (kind === 'file_diff') {
        const fp = _normRel(e.filePath || '');
        if (!fp) continue;
        const fileId = `file:${fp}`;
        ensureNode({
          id: fileId,
          type: 'file',
          label: fp,
          refs: { filePath: fp },
          meta: {},
          t: e.t,
          orderIndex: e.orderIndex
        });

        const diffKey = String(e.diffKey || '').trim() || `${fp}:${e.t}:${e.orderIndex}`;
        const diffId = `diff:${diffKey}`;
        ensureNode({
          id: diffId,
          type: 'diff',
          label: _safeStr(String(e.diffStat || 'diff'), 24),
          refs: { filePath: fp, diffKey },
          meta: {
            diffStat: _safeStr(String(e.diffStat || ''), 40),
            toolName: e.toolName ? _safeStr(e.toolName, 40) : undefined
          },
          t: e.t,
          orderIndex: e.orderIndex
        });

        // Attach to tool if we can, else to run.
        const toolUseId = String(e.toolUseId || '').trim();
        const aetNodeId = String(e.aetNodeId || '').trim();
        const toolKey = toolUseId || (aetNodeId ? `aet:${aetNodeId}` : '');
        if (toolKey) {
          const toolId = `tool:${toolKey}`;
          if (nodesById[toolId]) {
            ensureEdge({ type: 'touched_file', from: toolId, to: fileId });
          } else {
            ensureEdge({ type: 'touched_file', from: rootId, to: fileId });
          }
        } else {
          ensureEdge({ type: 'touched_file', from: rootId, to: fileId });
        }
        ensureEdge({ type: 'produced_diff', from: fileId, to: diffId });
        continue;
      }

      if (kind === 'block') {
        const toolUseId = String(e.toolUseId || '').trim();
        const aetNodeId = String(e.aetNodeId || '').trim();
        const toolKey = toolUseId || (aetNodeId ? `aet:${aetNodeId}` : '');
        const reason = _safeStr(String(e.reason || 'Blocked'), 120) || 'Blocked';
        const blockId = `block:${runId}:${e.orderIndex}`;
        ensureNode({
          id: blockId,
          type: 'block',
          label: reason,
          refs: {
            runId,
            ...(toolUseId ? { toolUseId } : {}),
            ...(aetNodeId ? { aetNodeId } : {}),
            ...(e.filePath ? { filePath: _normRel(e.filePath) } : {})
          },
          meta: { toolName: e.toolName ? _safeStr(e.toolName, 40) : undefined },
          t: e.t,
          orderIndex: e.orderIndex
        });
        if (toolKey) {
          const toolId = `tool:${toolKey}`;
          if (nodesById[toolId]) ensureEdge({ type: 'blocked_by', from: toolId, to: blockId });
          else ensureEdge({ type: 'blocked_by', from: rootId, to: blockId });
        } else {
          ensureEdge({ type: 'blocked_by', from: rootId, to: blockId });
        }
        continue;
      }

      if (kind === 'outcome') {
        const outId = `outcome:${runId}`;
        ensureNode({
          id: outId,
          type: 'outcome',
          label: String(e.status || 'done'),
          refs: { runId },
          meta: { summary: e.summary ? _safeStr(e.summary, 220) : undefined },
          t: e.t,
          orderIndex: e.orderIndex
        });
        ensureEdge({ type: 'resulted_in', from: rootId, to: outId });
        continue;
      }
    }

    // Overlay pins (if provided)
    try {
      const pinsArr = Array.isArray(pins) ? pins : (Array.isArray(pins?.pins) ? pins.pins : []);
      if (pinsArr && pinsArr.length > 0) {
        const pinboardId = 'pinboard:root';
        ensureNode({ id: pinboardId, type: 'pinboard', label: 'Pinboard', refs: {}, meta: {}, t: firstRun?.t || 0, orderIndex: -1 });
        for (const p of pinsArr.slice(0, 600)) {
          if (!p || typeof p !== 'object') continue;
          const pid = String(p.id || '').trim();
          const pref = p.ref && typeof p.ref === 'object' ? p.ref : {};
          const filePath = pref.filePath ? _normRel(pref.filePath) : '';
          const targetId = filePath ? `file:${filePath}` : '';
          if (!pid || !targetId || !nodesById[targetId]) continue;
          const pinNodeId = `pin:${pid}`;
          ensureNode({
            id: pinNodeId,
            type: 'pin',
            label: _safeStr(p.label || filePath || 'Pin', 120),
            refs: { ...pref },
            meta: { note: p.note ? _safeStr(p.note, 600) : undefined },
            t: Number.isFinite(Number(p.createdAt)) ? Number(p.createdAt) : 0,
            orderIndex: -1
          });
          ensureEdge({ type: 'pinned', from: pinboardId, to: pinNodeId });
          ensureEdge({ type: 'pinned', from: pinNodeId, to: targetId });
        }
      }
    } catch { /* ignore */ }

    // Stable ordering: by orderIndex then id (keeps layout stable)
    nodes.sort((a, b) => (a.orderIndex - b.orderIndex) || String(a.id).localeCompare(String(b.id)));
    edges.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    return { nodes, edges, nodesById };
  }

  window.CodeonAetMapGraph = { foldEventsToGraph };
})();


