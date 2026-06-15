// AET Run Map — deterministic event stream builder
//
// Builds MapEvent[] from:
// - AET run nodes (from main, persisted to .ai-agent/execution-runs.json)
// - Session timeline messages: tool_receipt + file_preview
//
// IMPORTANT: no hallucinated nodes; everything is derived from persisted artifacts.
/* global chatSessions, ensureSessionMessages, getToolReceiptsForSession */

(function () {
  function _safeStr(s, max = 240) {
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

  function _hash32(str) {
    // Fast, deterministic, non-crypto hash (FNV-1a 32-bit)
    try {
      const s = String(str || '');
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
      }
      return h >>> 0;
    } catch {
      return (Math.random() * 0xffffffff) >>> 0;
    }
  }

  function _countDiffStats(diffContent) {
    const diff = typeof diffContent === 'string' ? diffContent : '';
    let added = 0;
    let removed = 0;
    const lines = diff.split('\n');
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
    const isNewFile = diff.includes('new file mode') || diff.includes('--- /dev/null');
    return { added, removed, isNewFile };
  }

  function _diffStatString(diffContent) {
    try {
      // Prefer global helper if present (keeps consistent with chat UI)
      if (typeof window.countDiffStats === 'function') {
        const s = window.countDiffStats(diffContent);
        const a = Number(s?.added || 0);
        const r = Number(s?.removed || 0);
        const isNew = !!s?.isNewFile;
        if (isNew) return `+${Math.max(0, a)}`;
        return `+${Math.max(0, a)} -${Math.max(0, r)}`;
      }
    } catch { /* ignore */ }
    const s2 = _countDiffStats(diffContent);
    if (s2.isNewFile) return `+${s2.added}`;
    return `+${s2.added} -${s2.removed}`;
  }

  function _extractFilePathFromNode(node) {
    try {
      const p = node && node.payload && typeof node.payload === 'object' ? node.payload : null;
      const s = p && p.toolInputSummary && typeof p.toolInputSummary === 'object' ? p.toolInputSummary : null;
      const fp = s && typeof s.filePath === 'string' ? s.filePath.trim() : '';
      if (fp) return _normRel(fp);
      const fp2 = p && typeof p.filePath === 'string' ? p.filePath.trim() : '';
      if (fp2) return _normRel(fp2);
      return '';
    } catch {
      return '';
    }
  }

  function _extractToolUseIdFromNode(node) {
    try {
      const p = node && node.payload && typeof node.payload === 'object' ? node.payload : null;
      const tid = p && typeof p.toolUseId === 'string' ? p.toolUseId.trim() : '';
      if (tid) return tid;
      const s = p && p.toolInputSummary && typeof p.toolInputSummary === 'object' ? p.toolInputSummary : null;
      const tid2 = s && typeof s.toolUseId === 'string' ? s.toolUseId.trim() : '';
      if (tid2) return tid2;
      return '';
    } catch {
      return '';
    }
  }

  function _extractToolNameFromNode(node) {
    try {
      const p = node && node.payload && typeof node.payload === 'object' ? node.payload : null;
      const tn = p && typeof p.toolName === 'string' ? p.toolName.trim() : '';
      if (tn) return tn;
    } catch { /* ignore */ }
    const t = String(node?.type || '').trim();
    // Coarse mapping (deterministic); used when payload lacks toolName.
    if (t === 'FileRead') return 'Read';
    if (t === 'Search') return 'Search';
    if (t === 'FileEdit') return 'Edit';
    if (t === 'BashCommand') return 'Bash';
    if (t === 'NetworkRequest') return 'WebFetch';
    if (t === 'CheckpointCreated') return 'Checkpoint';
    if (t === 'UserIntervention') return 'User';
    return t || 'Tool';
  }

  function _runOutcome(run) {
    const s = String(run?.status || '').trim().toLowerCase();
    if (s === 'success') return 'success';
    if (s === 'error' || s === 'failed' || s === 'failure') return 'failure';
    if (s === 'cancelled' || s === 'canceled' || s === 'discarded' || s === 'stopped') return 'stopped';
    return 'stopped';
  }

  function _sessionMessages(sessionId) {
    try {
      const sid = String(sessionId || '').trim();
      if (!sid) return [];
      if (typeof ensureSessionMessages === 'function') return ensureSessionMessages(sid);
      const s = (chatSessions && chatSessions[sid] && Array.isArray(chatSessions[sid].messages)) ? chatSessions[sid].messages : [];
      return Array.isArray(s) ? s : [];
    } catch {
      return [];
    }
  }

  function _selectGoalText({ sessionId, runStartTime }) {
    try {
      const msgs = _sessionMessages(sessionId);
      const start = Number(runStartTime || 0);
      if (!Number.isFinite(start) || start <= 0) {
        const last = [...msgs].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim());
        return last ? String(last.content || '').trim() : '';
      }
      // Pick the last user message at/before run start (with a small grace window)
      const grace = 30_000;
      let best = null;
      let bestTs = -Infinity;
      for (const m of msgs) {
        if (!m || m.role !== 'user') continue;
        const ts = typeof m.timestamp === 'number' ? m.timestamp : 0;
        const text = typeof m.content === 'string' ? m.content.trim() : '';
        if (!text) continue;
        if (ts <= start + grace && ts >= bestTs) {
          bestTs = ts;
          best = m;
        }
      }
      return best ? String(best.content || '').trim() : '';
    } catch {
      return '';
    }
  }

  function buildMapEvents({ sessionId, run }) {
    const sid = String(sessionId || '').trim();
    const rid = String(run?.id || '').trim();
    if (!sid || !rid || !run) return [];

    const events = [];
    const push = (e) => { events.push({ ...e, orderIndex: events.length }); };

    const startTime = Number(run?.startTime || 0);
    const endTime = Number(run?.endTime || 0);
    const baseStart = Number.isFinite(startTime) && startTime > 0 ? startTime : Date.now();
    const grace = 30_000;
    const endBound = (Number.isFinite(endTime) && endTime > 0) ? (endTime + grace) : (Date.now() + grace);
    const startBound = baseStart - grace;

    // Prefer requestId matching when available; it’s the most reliable per-run discriminator.
    const runRequestId = (() => {
      try {
        const r =
          (typeof run?.requestId === 'string' ? run.requestId : null) ||
          (typeof run?.request_id === 'string' ? run.request_id : null) ||
          (typeof run?.meta?.requestId === 'string' ? run.meta.requestId : null) ||
          (typeof run?.meta?.request_id === 'string' ? run.meta.request_id : null);
        return r ? String(r).trim() : '';
      } catch {
        return '';
      }
    })();

    const inWindow = (ts) => {
      const t = Number(ts);
      if (!Number.isFinite(t)) return false;
      return t >= startBound && t <= endBound;
    };

    push({ kind: 'run_start', t: baseStart, runId: rid, sessionId: sid });

    const goalText = _selectGoalText({ sessionId: sid, runStartTime: baseStart });
    if (goalText) {
      push({ kind: 'goal', t: baseStart, text: goalText });
    }

    // AET nodes are the primary ground truth for tool events.
    const nodes = Array.isArray(run?.nodes) ? run.nodes : [];
    const sortedNodes = nodes.slice().sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
    const seenToolUseIds = new Set();

    for (const n of sortedNodes) {
      if (!n || typeof n !== 'object') continue;
      const t = Number(n.timestamp || 0) || baseStart;
      const aetNodeId = String(n.id || '').trim();
      const toolUseId = _extractToolUseIdFromNode(n);
      const toolName = _extractToolNameFromNode(n);
      if (toolUseId) seenToolUseIds.add(toolUseId);

      // Treat most nodes as "tool-ish"; the map is a meaning layer, not a perfect AET replica.
      if (toolName) {
        push({
          kind: 'tool',
          t,
          toolName,
          toolUseId: toolUseId || undefined,
          aetNodeId: aetNodeId || undefined,
          summary: _safeStr(n?.payload?.title || n?.payload?.preview || '', 160) || undefined
        });
      }

      // Diff evidence (from AET nodes)
      const p = n.payload && typeof n.payload === 'object' ? n.payload : null;
      const diffContent = p && typeof p.diffContent === 'string' ? p.diffContent : '';
      const filePath = _extractFilePathFromNode(n);
      if (filePath && diffContent && diffContent.trim()) {
        const diffStat = _diffStatString(diffContent);
        const snippet = diffContent.slice(0, 2200);
        const hk = _hash32(`${filePath}\n${t}\n${snippet}`);
        push({
          kind: 'file_diff',
          t,
          filePath,
          diffStat,
          diffKey: `aet:${filePath}:${t}:${hk.toString(16)}`,
          toolName: toolName || undefined,
          toolUseId: toolUseId || undefined,
          aetNodeId: aetNodeId || undefined
        });
      }

      // Block-ish nodes (permission/network/errors)
      try {
        const type = String(n.type || '').trim();
        if (type === 'PermissionRequest' || type === 'Warning') {
          const reason = _safeStr(p?.title || p?.reason || type, 240) || type;
          push({
            kind: 'block',
            t,
            reason,
            filePath: filePath || undefined,
            toolName: toolName || undefined,
            toolUseId: toolUseId || undefined,
            aetNodeId: aetNodeId || undefined
          });
        }
      } catch { /* ignore */ }
    }

    // Tool receipts (fallback / extra evidence)
    let receipts = [];
    try {
      receipts = (typeof getToolReceiptsForSession === 'function') ? getToolReceiptsForSession(sid) : [];
    } catch {
      receipts = [];
    }
    for (const r of Array.isArray(receipts) ? receipts : []) {
      if (!r || typeof r !== 'object') continue;
      const t = typeof r.timestamp === 'number' ? r.timestamp : baseStart;
      // CRITICAL: Only include receipts that belong to THIS run, otherwise maps stack across runs.
      const receiptRunRequestId = typeof r.runRequestId === 'string' ? r.runRequestId.trim() : '';
      if (runRequestId && receiptRunRequestId && receiptRunRequestId !== runRequestId) continue;
      if (!inWindow(t)) continue;
      const toolName = String(r.toolName || '').trim() || 'Tool';
      const toolUseId = String(r.toolUseId || '').trim();
      if (toolUseId && seenToolUseIds.has(toolUseId)) continue;
      if (toolUseId) seenToolUseIds.add(toolUseId);
      push({
        kind: 'tool',
        t,
        toolName,
        toolUseId: toolUseId || undefined,
        summary: _safeStr(r.preview || '', 180) || undefined
      });

      // Heuristic block evidence (still deterministic, based on receipt fields)
      try {
        const receipt = r.receipt && typeof r.receipt === 'object' ? r.receipt : null;
        const exitCode = receipt && typeof receipt.exitCode === 'number' ? receipt.exitCode : null;
        const net = receipt && receipt.networkPolicy && typeof receipt.networkPolicy === 'object' ? receipt.networkPolicy : null;
        const netMode = net && typeof net.mode === 'string' ? net.mode : '';
        const looksBlocked = (toolName === 'WebFetch' && netMode === 'deny_all') || (typeof exitCode === 'number' && exitCode !== 0);
        if (looksBlocked) {
          const reason = _safeStr(`Blocked: ${toolName}${netMode ? ` (net=${netMode})` : ''}${typeof exitCode === 'number' ? ` (exit=${exitCode})` : ''}`, 240);
          push({ kind: 'block', t, reason, toolName, toolUseId: toolUseId || undefined });
        }
      } catch { /* ignore */ }
    }

    // File preview diffs (chat timeline evidence)
    const msgs = _sessionMessages(sid);
    for (const m of msgs) {
      if (!m || m.role !== 'file_preview') continue;
      const fp = _normRel(m.filePath || '');
      const diffContent = typeof m.diffContent === 'string' ? m.diffContent : '';
      if (!fp || !diffContent.trim()) continue;
      const t = typeof m.timestamp === 'number' ? m.timestamp : baseStart;
      // CRITICAL: Only include file previews from this run’s time window, otherwise maps stack across runs.
      if (!inWindow(t)) continue;
      const diffStat = String(m.diffStat || '').trim() || _diffStatString(diffContent);
      const snippet = diffContent.slice(0, 2200);
      const hk = _hash32(`${fp}\n${t}\n${snippet}`);
      push({
        kind: 'file_diff',
        t,
        filePath: fp,
        diffStat,
        diffKey: `preview:${fp}:${t}:${hk.toString(16)}`,
        toolName: _safeStr(m.toolName || '', 40) || undefined
      });
    }

    // Outcome
    const outT = (Number.isFinite(endTime) && endTime > 0) ? endTime : (baseStart + 1);
    push({
      kind: 'outcome',
      t: outT,
      status: _runOutcome(run),
      summary: _safeStr(run?.meta?.summary || '', 200) || undefined
    });

    return events;
  }

  window.CodeonAetMapEvents = { buildMapEvents };
})();


