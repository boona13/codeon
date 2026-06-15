// ---- GENERATED: hoisted declarations extracted from aet/aet-session-ui.js ----
 // snapshot of editor/diff/empty visibility

function _fmtAetTime(ts) {
  try {
    if (!Number.isFinite(Number(ts))) return '';
    return new Date(Number(ts)).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}


function _nodeLevel(node) {
  try {
    const t = String(node?.type || '');
    if (t === 'ToolFailure') return 'danger';
    if (t === 'PermissionRequest') return 'warning';
    if (t === 'Warning') return 'warning';
    if (t === 'Completion') {
      const title = String(node?.payload?.title || '');
      return title.toLowerCase().includes('failed') ? 'danger' : 'safe';
    }
    const r = node?.payload?.receipt;
    const exitCode = r && typeof r.exitCode === 'number' ? r.exitCode : null;
    const success = r && typeof r.success === 'boolean' ? r.success : null;
    if (typeof exitCode === 'number' && exitCode !== 0) return 'danger';
    if (success === false) return 'danger';
    if (t === 'BashCommand' || t === 'FileEdit' || t === 'FileRead' || t === 'Search' || t === 'SkillInvoked' || t === 'NetworkRequest' || t === 'CheckpointCreated') return 'safe';
    return '';
  } catch {
    return '';
  }
}


function _getAetEls() {
  return {
    panel: document.getElementById('executionTimelinePanel'),
    list: document.getElementById('executionTimelineList'),
    graph: document.getElementById('executionTimelineGraph'),
    select: document.getElementById('executionTimelineRunSelect'),
    runSummary: document.getElementById('executionTimelineRunSummary'),
    changes: document.getElementById('executionTimelineChanges'),
    filters: document.getElementById('executionTimelineFilters'),
    editorOverlay: document.getElementById('executionTimelineEditorOverlay'),
    editorGraphHost: document.getElementById('executionTimelineEditorGraphHost'),
    editorRunSelect: document.getElementById('executionTimelineEditorRunSelect'),
    editorRunSummary: document.getElementById('executionTimelineEditorRunSummary'),
    editorChanges: document.getElementById('executionTimelineEditorChanges'),
    editorFilters: document.getElementById('executionTimelineEditorFilters'),
    nodeDrawer: document.getElementById('executionTimelineNodeDrawer'),
    nodeDrawerBackdrop: document.getElementById('executionTimelineNodeDrawerBackdrop'),
    nodeDrawerBody: document.getElementById('executionTimelineNodeDrawerBody'),
    nodeDrawerCloseBtn: document.getElementById('executionTimelineNodeDrawerCloseBtn')
  };
}


function _getActiveRunForSession(sessionId) {
  try {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    const runs = Array.isArray(executionTimelineRunsBySession[sid]) ? executionTimelineRunsBySession[sid] : [];
    if (!runs.length) return null;
    const activeRunId = String(executionTimelineActiveRunBySession[sid] || runs[runs.length - 1].id || '').trim();
    if (!activeRunId) return null;
    return runs.find(r => String(r?.id || '') === activeRunId) || null;
  } catch {
    return null;
  }
}


function _findRunById(sessionId, runId) {
  try {
    const sid = String(sessionId || '').trim();
    const rid = String(runId || '').trim();
    if (!sid || !rid) return null;
    const runs = Array.isArray(executionTimelineRunsBySession[sid]) ? executionTimelineRunsBySession[sid] : [];
    return runs.find(r => String(r?.id || '') === rid) || null;
  } catch {
    return null;
  }
}


function _findNodeById(run, nodeId) {
  try {
    const nid = String(nodeId || '').trim();
    if (!run || !nid) return null;
    const nodes = Array.isArray(run.nodes) ? run.nodes : [];
    return nodes.find(n => String(n?.id || '') === nid) || null;
  } catch {
    return null;
  }
}


function _findNearestCheckpointHashes(run, node) {
  try {
    const nodes = Array.isArray(run?.nodes) ? run.nodes.slice() : [];
    const nid = String(node?.id || '').trim();
    if (!nid || nodes.length === 0) return { prev: '', next: '' };
    nodes.sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
    const idx = nodes.findIndex(n => String(n?.id || '') === nid);
    if (idx < 0) return { prev: '', next: '' };
    let prev = '';
    for (let i = idx; i >= 0; i--) {
      const n = nodes[i];
      const h = String(n?.gitCheckpointHash || n?.payload?.commitHash || '').trim();
      if (h) { prev = h; break; }
    }
    let next = '';
    for (let i = idx; i < nodes.length; i++) {
      const n = nodes[i];
      const h = String(n?.gitCheckpointHash || n?.payload?.commitHash || '').trim();
      if (h) { next = h; break; }
    }
    return { prev, next };
  } catch {
    return { prev: '', next: '' };
  }
}


function _closeAetNodeDrawer() {
  try {
    const { nodeDrawer, nodeDrawerBackdrop, editorOverlay } = _getAetEls();
    if (nodeDrawer) nodeDrawer.style.display = 'none';
    if (nodeDrawerBackdrop) nodeDrawerBackdrop.style.display = 'none';
    if (editorOverlay) editorOverlay.classList.remove('drawer-open');
  } catch { /* ignore */ }
}


function _renderAetNodeDrawer({ sessionId, runId, nodeId } = {}) {
  const { nodeDrawerBody } = _getAetEls();
  if (!nodeDrawerBody) return;
  try {
    const sid = String(sessionId || '').trim();
    const rid = String(runId || '').trim();
    const nid = String(nodeId || '').trim();
    const run = _findRunById(sid, rid) || _getActiveRunForSession(sid);
    const node = run ? _findNodeById(run, nid) : null;
    if (!run || !node) {
      nodeDrawerBody.innerHTML = '<div style="opacity:0.8;">Node not found.</div>';
      return;
    }

    const title = _nodeTitle(node);
    const when = _fmtAetTime(node.timestamp);
    const type = String(node.type || '');
    const lvl = _nodeLevel(node);
    const just = _nodeJustificationText(node);
    const meta = _nodeJustificationMeta(node);
    const outcome = meta && typeof meta.outcome === 'string' ? meta.outcome.trim() : '';
    const risk = meta && typeof meta.risk === 'string' ? meta.risk.trim().toLowerCase() : '';
    const receiptRaw = node?.payload?.receipt && typeof node.payload.receipt === 'object' ? node.payload.receipt : null;
    const toolInputSummary = node?.payload?.toolInputSummary && typeof node.payload.toolInputSummary === 'object'
      ? node.payload.toolInputSummary
      : null;
    const relatedFiles = Array.isArray(node.relatedFiles) ? node.relatedFiles.filter(Boolean).slice(0, 30) : [];
    const lockNoteDefault = (() => {
      try {
        if (!window._aetLockNoteByRunId) window._aetLockNoteByRunId = {};
        return String(window._aetLockNoteByRunId[rid] || '').trim();
      } catch {
        return '';
      }
    })();

    const normalizeLockKey = (p) => {
      try {
        let s = String(p || '').trim().replace(/\\/g, '/');
        if (!s) return '';
        s = s.replace(/^\.\/+/, '').trim();
        const root = window.currentFolder ? String(window.currentFolder).replace(/\\/g, '/').replace(/\/+$/, '') : '';
        if (root && (s === root || s.startsWith(root + '/'))) {
          s = s === root ? '' : s.slice(root.length + 1);
        }
        s = s.replace(/^\/+/, '').trim();
        if (!s || s === '.') return '';
        return s;
      } catch {
        return '';
      }
    };

    const locksObj = (() => {
      try {
        // Best-effort sync cache from last fetch; drawer will refresh after lock/unlock.
        const p = window.currentFolder ? String(window.currentFolder) : '';
        if (!p) return {};
        const cache = window._aetLocksCache && window._aetLocksCache[p];
        const locks = cache && cache.locks && typeof cache.locks === 'object' ? cache.locks : {};
        return locks;
      } catch {
        return {};
      }
    })();
    const isLocked = (anyPath) => {
      try {
        const key = normalizeLockKey(anyPath);
        if (!key) return false;
        return Object.prototype.hasOwnProperty.call(locksObj, key);
      } catch {
        return false;
      }
    };
    const diff = (() => {
      try {
        const p = node && node.payload && typeof node.payload === 'object' ? node.payload : null;
        const d = p && typeof p.diffContent === 'string' ? p.diffContent : '';
        const derived = typeof node?.__aetDerivedDiffContent === 'string' ? node.__aetDerivedDiffContent : '';
        return String(derived || d || '').trim();
      } catch {
        return '';
      }
    })();
    const ckHash = _nodeCheckpointHash(node);
    const isCheckpoint = !!ckHash;
    const { prev: prevCk, next: nextCk } = _findNearestCheckpointHashes(run, node);

    // Session continuity inspector (best-effort; values come from run meta + SDK init events).
    const runMeta = run?.meta && typeof run.meta === 'object' ? run.meta : null;
    const runPermissionMode = String(run?.permissionMode || runMeta?.permissionMode || '').trim();
    const runNetworkMode = String(runMeta?.networkPolicyMode || run?.networkPolicy?.mode || runMeta?.networkPolicy?.mode || '').trim();
    const claudeSessionId = String(runMeta?.claudeSessionId || runMeta?.sessionId || '').trim();
    const resumeId = String(runMeta?.resumeSessionId || '').trim();
    const resumeAt = String(runMeta?.resumeSessionAt || '').trim();
    const fork = runMeta?.forkSession === true ? 'true' : (runMeta?.forkSession === false ? 'false' : '');
    const maxBudgetUsd = runMeta && Number.isFinite(Number(runMeta.maxBudgetUsd)) ? Number(runMeta.maxBudgetUsd) : null;
    const totalCostUsd = runMeta && Number.isFinite(Number(runMeta.totalCostUsd)) ? Number(runMeta.totalCostUsd) : null;
    const usage = runMeta?.usage && typeof runMeta.usage === 'object' ? runMeta.usage : null;
    const fmtUsd = (n) => {
      try {
        const v = Number(n);
        if (!Number.isFinite(v)) return '';
        return `$${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
      } catch {
        return '';
      }
    };

    const fmtJson = (obj, max = 6000) => {
      try {
        const s = JSON.stringify(obj, null, 2);
        return s.length > max ? (s.slice(0, max) + '\n…') : s;
      } catch {
        return '';
      }
    };

    // UI-only helper: remove null/undefined values so receipts don't show noisy "null" fields.
    // (We still persist raw receipts elsewhere for auditability.)
    const stripNullishDeep = (val, depth = 0) => {
      try {
        if (depth > 14) return val;
        if (val == null) return undefined; // drop null/undefined
        if (Array.isArray(val)) {
          const next = [];
          for (const it of val) {
            const v = stripNullishDeep(it, depth + 1);
            if (v !== undefined) next.push(v);
          }
          return next;
        }
        if (typeof val === 'object') {
          const out = {};
          for (const [k, v0] of Object.entries(val)) {
            const v = stripNullishDeep(v0, depth + 1);
            if (v !== undefined) out[k] = v;
          }
          return out;
        }
        return val;
      } catch {
        return val;
      }
    };

    const receipt = receiptRaw ? stripNullishDeep(receiptRaw) : null;
    const hasReceiptDetails = (() => {
      try {
        if (!receipt || typeof receipt !== 'object') return false;
        if (Array.isArray(receipt)) return receipt.length > 0;
        return Object.keys(receipt).length > 0;
      } catch {
        return !!receipt;
      }
    })();

    const statusPill = (() => {
      const base = lvl === 'danger' ? 'risk-high' : (lvl === 'warning' ? 'risk-med' : 'risk-low');
      const txt = lvl === 'danger' ? 'error' : (lvl === 'warning' ? 'warning' : 'ok');
      return `<span class="execution-graph-node-risk ${base}" title="Status">${escapeHtml(txt)}</span>`;
    })();

    const canLock = relatedFiles.length > 0;
    const relatedUnique = canLock
      ? Array.from(new Set(relatedFiles.map(f => normalizeLockKey(f)).filter(Boolean))).slice(0, 120)
      : [];
    const lockedCountInDrawer = relatedUnique.filter((p) => isLocked(p)).length;
    const allLockedInDrawer = relatedUnique.length > 0 && lockedCountInDrawer === relatedUnique.length;
    const bulkLockBtnLabel = allLockedInDrawer ? 'Bulk unlock' : 'Bulk lock';

    nodeDrawerBody.innerHTML = `
      <div class="execution-node-drawer-section">
        <div class="execution-node-drawer-section-title">Summary</div>
        <div class="execution-node-drawer-kv">
          <div class="k">Title</div><div class="v">${escapeHtml(title)}</div>
          <div class="k">Type</div><div class="v">${escapeHtml(type)} ${statusPill}</div>
          <div class="k">Time</div><div class="v">${escapeHtml(when)}</div>
          <div class="k">Run</div><div class="v">${escapeHtml(String(run.id || ''))}</div>
          <div class="k">Checkpoint</div><div class="v">${isCheckpoint ? `ckpt ${escapeHtml(ckHash.slice(0, 7))}` : '—'}</div>
        </div>
      </div>

      <div class="execution-node-drawer-section">
        <div class="execution-node-drawer-section-title">Session</div>
        <div class="execution-node-drawer-kv">
          <div class="k">Claude session</div><div class="v">${escapeHtml(claudeSessionId || '—')}</div>
          <div class="k">Resume from</div><div class="v">${escapeHtml(resumeId ? `${resumeId}${resumeAt ? ` @ ${resumeAt}` : ''}` : '—')}</div>
          <div class="k">Fork</div><div class="v">${escapeHtml(fork || '—')}</div>
          <div class="k">Mode</div><div class="v">${escapeHtml(runPermissionMode || '—')}</div>
          <div class="k">Network</div><div class="v">${escapeHtml(runNetworkMode || '—')}</div>
        </div>
        ${usage ? `<div class="execution-node-drawer-code" style="margin-top:10px;">${escapeHtml(fmtJson({ usage }, 2500))}</div>` : ''}
      </div>

      <div class="execution-node-drawer-section">
        <div class="execution-node-drawer-section-title">Actions</div>
        <div class="execution-node-drawer-actions">
          ${isCheckpoint ? `<button class="btn-secondary" type="button" id="aetDrawerRestoreBtn" data-hash="${escapeHtml(ckHash)}">Restore</button>` : ''}
          ${/* Recovery is checkpoint-based (Restore). */''}
          ${/* Resume-from-node is intentionally disabled for now (too risky with dual history + git checkpoints). */''}
          <button class="btn-secondary" type="button" id="aetDrawerLockBtn" ${canLock ? '' : 'disabled'} title="${canLock ? (allLockedInDrawer ? 'Bulk unlock related files' : 'Bulk lock related files for safety') : 'No related files to lock'}">${escapeHtml(bulkLockBtnLabel)}</button>
        </div>
        <div style="margin-top: 10px;">
          <input class="execution-node-drawer-lock-note" id="aetDrawerLockNoteInput" placeholder="Lock note (optional)…" value="${escapeHtml(lockNoteDefault)}" />
        </div>
      </div>

      <div class="execution-node-drawer-section">
        <div class="execution-node-drawer-section-title">Inputs</div>
        ${toolInputSummary ? `<div class="execution-node-drawer-code">${escapeHtml(fmtJson(toolInputSummary))}</div>` : '<div style="opacity:0.75;">No structured tool input summary.</div>'}
      </div>

      <div class="execution-node-drawer-section">
        <div class="execution-node-drawer-section-title">Outputs / Receipt</div>
        ${hasReceiptDetails ? `<div class="execution-node-drawer-code">${escapeHtml(fmtJson(receipt))}</div>` : '<div style="opacity:0.75;">No receipt recorded.</div>'}
      </div>

      <div class="execution-node-drawer-section">
        <div class="execution-node-drawer-section-title">Files</div>
        ${relatedFiles.length ? `
          <div style="display:flex; flex-wrap: wrap; gap: 8px;">
            ${relatedFiles.map(fp => {
              const f = String(fp || '').trim();
              const key = normalizeLockKey(f);
              const locked = key ? isLocked(key) : false;
              const lockMeta = (locked && key) ? locksObj[key] : null;
              const note = lockMeta && typeof lockMeta.note === 'string' ? lockMeta.note.trim() : '';
              const by = lockMeta && typeof lockMeta.lockedBy === 'string' ? lockMeta.lockedBy.trim() : '';
              const t = locked
                ? `Locked${note ? ` — ${note}` : ''}${by ? ` (by ${by})` : ''}`
                : 'Open file';
              const lockTitle = locked ? `Unlock ${key || f}` : `Lock ${key || f}`;
              const icon = locked
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="5" y="10" width="14" height="12" rx="2"/><path d="M12 14v4"/></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14"><path d="M7 10V7a5 5 0 0 1 9.9-1"/><rect x="5" y="10" width="14" height="12" rx="2"/><path d="M12 14v4"/><path d="M17 4l3 3"/></svg>`;
              const label = key || f;
              return `
                <div class="execution-node-drawer-file ${locked ? 'locked' : ''}" data-file="${escapeHtml(label)}" title="${escapeHtml(t)}">
                  <button class="lock-toggle" type="button" data-lock-toggle="${escapeHtml(label)}" ${key ? '' : 'disabled'} title="${escapeHtml(lockTitle)}">${icon}</button>
                  <span class="file-label">${escapeHtml(label)}</span>
                </div>
              `.trim();
            }).join('')}
          </div>
        ` : '<div style="opacity:0.75;">No related files.</div>'}
      </div>

      <div class="execution-node-drawer-section">
        <div class="execution-node-drawer-section-title">Justification</div>
        ${just ? `<div class="execution-node-drawer-kv">
          <div class="k">Why</div><div class="v">${escapeHtml(just)}</div>
          <div class="k">Outcome</div><div class="v">${escapeHtml(outcome || '—')}</div>
          <div class="k">Risk</div><div class="v">${escapeHtml(risk || '—')}</div>
        </div>` : '<div style="opacity:0.75;">No justification provided.</div>'}
      </div>

      <div class="execution-node-drawer-section">
        <div class="execution-node-drawer-section-title">Restore checkpoint</div>
        ${isCheckpoint ? `
          <div class="execution-node-drawer-kv">
            <div class="k">This node</div><div class="v">${escapeHtml(ckHash)}</div>
            <div class="k">Meaning</div><div class="v">Turn baseline (safe restore point)</div>
          </div>
        ` : `
          <div class="execution-node-drawer-kv">
            <div class="k">Nearest prev</div><div class="v">${escapeHtml(prevCk || '—')}</div>
            <div class="k">Nearest next</div><div class="v">${escapeHtml(nextCk || '—')}</div>
            <div class="k">Note</div><div class="v">Restore is only available on checkpoint nodes.</div>
          </div>
        `}
      </div>

      ${diff ? `
        <div class="execution-node-drawer-section">
          <div class="execution-node-drawer-section-title">Diff (preview)</div>
          <div class="execution-node-drawer-code">${escapeHtml(diff)}</div>
        </div>
      ` : ''}
    `;

    // Wire file clicks.
    for (const el of Array.from(nodeDrawerBody.querySelectorAll('[data-file]'))) {
      el.addEventListener('click', (e) => {
        try {
          // If click originated from lock toggle, ignore (handled separately).
          if (e && e.target && e.target.closest && e.target.closest('[data-lock-toggle]')) return;
          e.preventDefault();
          const fp = String(el.getAttribute('data-file') || '').trim();
          if (!fp) return;
          openFile(fp);
        } catch { /* ignore */ }
      });
    }

    // Wire per-file lock toggles.
    for (const btn of Array.from(nodeDrawerBody.querySelectorAll('[data-lock-toggle]'))) {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (!window.currentFolder || !window.electronAPI) return;
          if (typeof window.electronAPI.executionLocksGet !== 'function' || typeof window.electronAPI.executionLocksSet !== 'function') {
            showToast('Locks not available (missing IPC).');
            return;
          }
          const fp = String(btn.getAttribute('data-lock-toggle') || '').trim();
          if (!fp) return;

          const res = await window.electronAPI.executionLocksGet(window.currentFolder);
          const locks = (res && res.success === true && res.locks && typeof res.locks === 'object') ? res.locks : {};
          const currentlyLocked = Object.prototype.hasOwnProperty.call(locks, fp);
          const noteInput = nodeDrawerBody.querySelector('#aetDrawerLockNoteInput');
          const note = noteInput ? String(noteInput.value || '').trim() : '';

          const res2 = await window.electronAPI.executionLocksSet(window.currentFolder, {
            paths: [fp],
            locked: !currentlyLocked,
            note: !currentlyLocked ? (note || 'Locked from node drawer') : ''
          });
          if (!res2 || res2.success !== true) {
            showToast(res2?.error || 'Failed to update lock');
            return;
          }
          // Refresh cache + rerender drawer.
          try {
            if (!window._aetLocksCache) window._aetLocksCache = {};
            window._aetLocksCache[String(window.currentFolder)] = { locks: res2.locks || {}, at: Date.now() };
          } catch { /* ignore */ }
          try { explorerSyncLocksFromCache(); } catch { /* ignore */ }
          try { _renderAetNodeDrawer({ sessionId: sid, runId: rid, nodeId: nid }); } catch { /* ignore */ }

          try {
            addMessage('system_action', currentlyLocked ? `🔓 Unlocked file: \`${fp}\`` : `🔒 Locked file: \`${fp}\``, null, null, true);
          } catch { /* ignore */ }
          try {
            if (window.electronAPI && typeof window.electronAPI.executionTimelineAppendNode === 'function') {
              await window.electronAPI.executionTimelineAppendNode(window.currentFolder, sid, rid, 'UserIntervention', {
                title: currentlyLocked ? 'File unlocked' : 'File locked',
                subtype: currentlyLocked ? 'unlock' : 'lock',
                paths: [fp],
                ...(note ? { note } : {})
              });
            }
          } catch { /* ignore */ }
        } catch { /* ignore */ }
      });
    }
    // Wire restore (existing functionality).
    const restoreBtn = nodeDrawerBody.querySelector('#aetDrawerRestoreBtn');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const h = String(restoreBtn.getAttribute('data-hash') || '').trim();
        if (!h) return;
        try {
          // Strong coupling: use the same restore logic as the chat restore button.
          // This rewinds chat history + Claude resume state to the checkpoint (when possible).
          const ok = await (async () => {
            try {
              // If we have a matching user message for this checkpoint, restore will also rewind chat.
              await restoreToUserCheckpoint(h, null, null, null, false);
              return true;
            } catch {
              // Fallback: workspace-only restore
              return await restoreToCheckpoint(h);
            }
          })();
          if (!ok) return;
          // After restoring workspace state, truncate the active run and discard future runs immediately
          // so the Execution Timeline doesn't keep showing invalid "future" history.
          try {
            const projectPath = window.currentFolder ? String(window.currentFolder) : '';
            if (
              projectPath &&
              window.electronAPI &&
              typeof window.electronAPI.executionTimelineTruncateAfterNode === 'function'
            ) {
              await window.electronAPI.executionTimelineTruncateAfterNode(
                projectPath,
                sid,
                rid,
                nid,
                'Manual restore from execution timeline'
              );
            }
          } catch { /* ignore */ }
          // Refresh in-memory AET runs (best-effort)
          try { if (sid) loadExecutionTimelineForSession(sid).catch(() => {}); } catch { /* ignore */ }
        } catch { /* ignore */ }
      });
    }

    // (Removed) Node-level replay action.

    // Wire resume (v2.0) — DISABLED.
    // Rationale: true resume-from-node requires careful reconciliation between
    // Claude Code memory/session + in-app chat history + git checkpoints.
    // const resumeBtn = nodeDrawerBody.querySelector('#aetDrawerResumeBtn');
    // if (resumeBtn && canRetry) {
    //   resumeBtn.addEventListener('click', async (e) => {
    //     e.preventDefault();
    //     e.stopPropagation();
    //     try { await _runAetResumeFromNode({ sessionId: sid, runId: rid, nodeId: nid }); } catch { /* ignore */ }
    //   });
    // }

    // Wire locks (v2.0).
    const lockBtn = nodeDrawerBody.querySelector('#aetDrawerLockBtn');
    if (lockBtn && canLock) {
      lockBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (!window.currentFolder || !window.electronAPI) return;
          if (typeof window.electronAPI.executionLocksGet !== 'function' || typeof window.electronAPI.executionLocksSet !== 'function') {
            showToast('Locks not available (missing IPC).');
            return;
          }
          const res = await window.electronAPI.executionLocksGet(window.currentFolder);
          const locks = (res && res.success === true && res.locks && typeof res.locks === 'object') ? res.locks : {};
          // Cache for immediate UI updates.
          try {
            if (!window._aetLocksCache) window._aetLocksCache = {};
            window._aetLocksCache[String(window.currentFolder)] = { locks, at: Date.now() };
          } catch { /* ignore */ }
          try { explorerSyncLocksFromCache(); } catch { /* ignore */ }
          const uniq = Array.from(new Set(relatedFiles.map(f => normalizeLockKey(f)).filter(Boolean))).slice(0, 80);
          const lockedCount = uniq.filter(p => Object.prototype.hasOwnProperty.call(locks, p)).length;
          const willUnlock = lockedCount === uniq.length && uniq.length > 0;
          const label = willUnlock ? 'Bulk unlock' : 'Bulk lock';
          const noteInput = nodeDrawerBody.querySelector('#aetDrawerLockNoteInput');
          const note = noteInput ? String(noteInput.value || '').trim() : '';
          try {
            if (!window._aetLockNoteByRunId) window._aetLockNoteByRunId = {};
            window._aetLockNoteByRunId[rid] = note;
          } catch { /* ignore */ }
          const ok = await customConfirm(
            `${label} ${uniq.length} file(s)?\n\n` + uniq.slice(0, 10).map(p => `• ${p}`).join('\n') + (uniq.length > 10 ? `\n• ... (+${uniq.length - 10} more)` : ''),
            `${label}`
          );
          if (!ok) return;
          const res2 = await window.electronAPI.executionLocksSet(window.currentFolder, {
            paths: uniq,
            locked: !willUnlock,
            note: note || `${label} from node drawer`
          });
          if (!res2 || res2.success !== true) {
            showToast(res2?.error || 'Failed to update locks');
            return;
          }
          // Refresh cache + rerender drawer to show lock badges immediately.
          try {
            if (!window._aetLocksCache) window._aetLocksCache = {};
            window._aetLocksCache[String(window.currentFolder)] = { locks: res2.locks || {}, at: Date.now() };
          } catch { /* ignore */ }
          try { explorerSyncLocksFromCache(); } catch { /* ignore */ }
          try { _renderAetNodeDrawer({ sessionId: sid, runId: rid, nodeId: nid }); } catch { /* ignore */ }
          try {
            addMessage('system_action', willUnlock ? `🔓 Unlocked ${uniq.length} file(s)` : `🔒 Locked ${uniq.length} file(s)`, null, null, true);
          } catch { /* ignore */ }
          try {
            if (window.electronAPI && typeof window.electronAPI.executionTimelineAppendNode === 'function') {
              await window.electronAPI.executionTimelineAppendNode(window.currentFolder, sid, rid, 'UserIntervention', {
                title: willUnlock ? 'Files unlocked' : 'Files locked',
                subtype: willUnlock ? 'unlock' : 'lock',
                paths: uniq.slice(0, 80)
              });
            }
          } catch { /* ignore */ }
          showToast(willUnlock ? 'Files unlocked' : 'Files locked');
        } catch { /* ignore */ }
      });
    }
  } catch (e) {
    nodeDrawerBody.innerHTML = `<div style="opacity:0.8;">Failed to render node drawer: ${escapeHtml(String(e?.message || e))}</div>`;
  }
}


function _openAetNodeDrawer({ sessionId, runId, nodeId } = {}) {
  try {
    const sid = String(sessionId || currentSessionId || '').trim();
    const rid = String(runId || '').trim();
    const nid = String(nodeId || '').trim();
    if (!sid || !rid || !nid) return;

    _setAetViewMode(sid, 'graph');
    try { closeExecutionTimeline(); } catch { /* ignore */ }
    try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }

    executionTimelineSelectedNodeByRunId[rid] = nid;
    _renderAetNodeDrawer({ sessionId: sid, runId: rid, nodeId: nid });
    // Fetch locks asynchronously so the drawer can show lock indicators.
    try {
      const projectPath = window.currentFolder ? String(window.currentFolder) : '';
      if (projectPath && window.electronAPI && typeof window.electronAPI.executionLocksGet === 'function') {
        window.electronAPI.executionLocksGet(projectPath).then((res) => {
          try {
            if (!window._aetLocksCache) window._aetLocksCache = {};
            const locks = (res && res.success === true && res.locks && typeof res.locks === 'object') ? res.locks : {};
            window._aetLocksCache[projectPath] = { locks, at: Date.now() };
            try { explorerSyncLocksFromCache(); } catch { /* ignore */ }
            _renderAetNodeDrawer({ sessionId: sid, runId: rid, nodeId: nid });
          } catch { /* ignore */ }
        }).catch(() => {});
      }
    } catch { /* ignore */ }

    const { nodeDrawer, nodeDrawerBackdrop, editorOverlay } = _getAetEls();
    if (editorOverlay) editorOverlay.classList.add('drawer-open');
    if (nodeDrawerBackdrop) nodeDrawerBackdrop.style.display = 'block';
    if (nodeDrawer) nodeDrawer.style.display = 'flex';
  } catch { /* ignore */ }
}


async function _runAetResumeFromNode({ sessionId, runId, nodeId } = {}) {
  const sid = String(sessionId || currentSessionId || '').trim();
  const rid = String(runId || '').trim();
  const nid = String(nodeId || '').trim();
  if (!sid || !rid || !nid) return;

  // Same concurrency rules as retry.
  if (isSessionProcessing(sid)) {
    showToast('A run is already in progress. Stop it first, then resume.');
    return;
  }
  try {
    const otherRunning = Object.keys(runStateBySession || {}).filter(s => {
      if (!s || s === sid) return false;
      return !!(runStateBySession[s] && runStateBySession[s].isProcessing === true);
    });
    if (otherRunning.length > 0) {
      showToast('Another AI run is already in progress. Wait for it to finish, then resume.');
      return;
    }
  } catch { /* ignore */ }

  const run = _findRunById(sid, rid);
  const node = run ? _findNodeById(run, nid) : null;
  if (!run || !node) {
    showToast('Node not found (cannot resume).');
    return;
  }

  const supported = new Set(['BashCommand', 'NetworkRequest', 'FileEdit']);
  if (!supported.has(String(node.type || ''))) {
    showToast('Resume is not supported for this node type yet.');
    return;
  }

  const { prev: anchor } = _findNearestCheckpointHashes(run, node);
  if (!anchor) {
    await customAlert('No checkpoint found before this node.\n\nResume requires a checkpoint for deterministic recovery.', 'Resume from node');
    return;
  }

  const title = _nodeTitle(node);
  const ok = await customConfirm(
    `Resume from node?\n\n` +
    `This will:\n` +
    `• Restore workspace to checkpoint ${anchor.substring(0, 7)}\n` +
    `• Start a new run that resumes the original task flow from this point\n\n` +
    `Node: ${title}`,
    'Resume from node'
  );
  if (!ok) return;

  // 1) Restore baseline.
  const restored = await restoreToCheckpoint(anchor, { skipConfirmation: true });
  if (!restored) return;

  // 2) Chat audit entry.
  try {
    addMessage('system_action', `⏩ Resume from node: **${title}**\n\nRestored to checkpoint: \`${anchor.substring(0, 7)}\``, null, null, true);
  } catch { /* ignore */ }

  // 3) Build a simple “remaining tasks” hint from subsequent nodes.
  const nodes = Array.isArray(run.nodes) ? run.nodes.slice().sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0)) : [];
  const idx = nodes.findIndex(n => String(n?.id || '') === nid);
  const remaining = [];
  if (idx >= 0) {
    for (let i = idx; i < Math.min(nodes.length, idx + 20); i++) {
      const n = nodes[i];
      const t = String(n?.type || '');
      if (t === 'Completion') break;
      const ttl = _nodeTitle(n);
      if (ttl) remaining.push(`- ${t}: ${ttl}`.slice(0, 260));
    }
  }

  const promptLines = [];
  promptLines.push('You are resuming a previous Codeon execution run from an earlier node.');
  promptLines.push(`Anchor checkpoint (already restored): ${anchor}`);
  promptLines.push('');
  promptLines.push('Goal: continue the original run’s tasks from this point onward.');
  promptLines.push('Do NOT stop after the single node; continue until the task is complete.');
  promptLines.push('');
  promptLines.push(`Resume starting at node type: ${String(node.type || '')}`);
  promptLines.push(`Resume starting at node title: ${title}`);
  if (remaining.length) {
    promptLines.push('\nRecent/remaining node trail (for continuity; workspace state is source of truth):');
    promptLines.push(remaining.join('\n'));
  }
  const resumePrompt = promptLines.join('\n').trim();

  const typingId = showTypingIndicator(sid);
  setProcessingState(true, sid);
  const abortController = new AbortController();
  try { const st = getRunState(sid); if (st) st.abortController = abortController; } catch { /* ignore */ }

  try {
    await getAIResponse(resumePrompt, [], abortController.signal, sid, {
      forceNewClaudeSession: true,
      aetParentRunId: String(rid),
      aetParentNodeId: String(nid),
      aetIntervention: {
        subtype: 'resume_from_node',
        title: 'Resume from node',
        anchorCheckpointHash: anchor,
        note: `Resume from node "${title}"`,
        target: {
          nodeType: String(node.type || ''),
          nodeTitle: title
        }
      }
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      // ignore
    } else {
      window.addConsoleMessage?.(`Resume failed: ${e?.message || String(e)}`, 'error', sid);
    }
  } finally {
    if (typingId) removeTypingIndicator(typingId);
    // Defensive cleanup for stuck Stop button edge cases.
    try {
      const st = getRunState(sid);
      if (st && st.isProcessing === true && !st.requestId) {
        setProcessingState(false, sid);
      }
    } catch { /* ignore */ }
  }
}


function _getAetViewMode(sessionId) {
  const sid = String(sessionId || '').trim();
  const m = executionTimelineViewModeBySession[sid];
  return (m === 'graph' || m === 'map') ? m : 'feed';
}


function _setAetViewMode(sessionId, mode) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const m = String(mode || '').trim();
  executionTimelineViewModeBySession[sid] = (m === 'graph' || m === 'map') ? m : 'feed';
  try { scheduleUIMetadataSave(500); } catch { /* ignore */ }
}


function _syncAetViewToggleUI() {
  try {
    const sid = currentSessionId;
    const mode = _getAetViewMode(sid);
    const feedBtn = document.getElementById('executionTimelineFeedViewBtn');
    const graphBtn = document.getElementById('executionTimelineGraphViewBtn');
    const mapBtn = document.getElementById('executionTimelineMapViewBtn');
    const fitBtn = document.getElementById('executionTimelineFitBtn');
    const eFeedBtn = document.getElementById('executionTimelineEditorFeedBtn');
    const eGraphBtn = document.getElementById('executionTimelineEditorGraphBtn');
    const eMapBtn = document.getElementById('executionTimelineEditorMapBtn');
    const eFitBtn = document.getElementById('executionTimelineEditorFitBtn');
    if (feedBtn) {
      feedBtn.classList.toggle('active', mode === 'feed');
      feedBtn.setAttribute('aria-selected', mode === 'feed' ? 'true' : 'false');
    }
    if (graphBtn) {
      graphBtn.classList.toggle('active', mode === 'graph');
      graphBtn.setAttribute('aria-selected', mode === 'graph' ? 'true' : 'false');
    }
    if (mapBtn) {
      mapBtn.classList.toggle('active', mode === 'map');
      mapBtn.setAttribute('aria-selected', mode === 'map' ? 'true' : 'false');
    }
    if (fitBtn) {
      fitBtn.disabled = mode !== 'graph';
      fitBtn.style.display = (mode === 'graph') ? '' : 'none';
    }
    if (eFeedBtn) {
      eFeedBtn.classList.toggle('active', mode === 'feed');
      eFeedBtn.setAttribute('aria-selected', mode === 'feed' ? 'true' : 'false');
    }
    if (eGraphBtn) {
      eGraphBtn.classList.toggle('active', mode === 'graph');
      eGraphBtn.setAttribute('aria-selected', mode === 'graph' ? 'true' : 'false');
    }
    if (eMapBtn) {
      eMapBtn.classList.toggle('active', mode === 'map');
      eMapBtn.setAttribute('aria-selected', mode === 'map' ? 'true' : 'false');
    }
    if (eFitBtn) {
      eFitBtn.disabled = !(mode === 'graph' || mode === 'map');
      eFitBtn.style.display = (mode === 'graph' || mode === 'map') ? '' : 'none';
    }
    // Collapse extra vertical space when the feed toolbar row has no visible controls.
    try {
      const row = document.getElementById('executionTimelineToolbarRow');
      if (row) {
        const kids = Array.from(row.children || []);
        const hasVisible = kids.some((el) => {
          try { return window.getComputedStyle(el).display !== 'none'; } catch { return false; }
        });
        if (hasVisible) row.setAttribute('data-has-controls', '1');
        else row.removeAttribute('data-has-controls');
      }
    } catch { /* ignore */ }
    try { window.CodeonAetMap?.onAetViewModeChanged?.(mode); } catch { /* ignore */ }
  } catch { /* ignore */ }
}


function _syncAetPauseButtonUI(sessionId) {
  try {
    const sid = String(sessionId || currentSessionId || '').trim();
    const el = document.getElementById('executionTimelinePauseBtn');
    if (!el || !sid) return;
    const on = !!(window._pauseBeforeNextToolBySession && window._pauseBeforeNextToolBySession[sid] === true);
    el.classList.toggle('pause-on', on);
    el.title = on ? 'Pause before next tool: ON' : 'Pause before next tool: OFF';
    el.setAttribute('aria-label', on ? 'Pause before next tool is ON' : 'Pause before next tool is OFF');
  } catch { /* ignore */ }
}


function _openExecutionTimelineInEditor() {
  const { editorOverlay } = _getAetEls();
  if (!editorOverlay) return;
  if (executionTimelineEditorOpen) return;
  executionTimelineEditorOpen = true;
  try {
    const editorEl = document.getElementById('editor');
    const diffEl = document.getElementById('diffEditor');
    const emptyEl = document.getElementById('editorEmptyState');
    const tabsEl = document.getElementById('editorTabs');
    executionTimelineEditorRestore = {
      editorDisplay: editorEl ? editorEl.style.display : '',
      diffDisplay: diffEl ? diffEl.style.display : '',
      emptyDisplay: emptyEl ? emptyEl.style.display : '',
      tabsDisplay: tabsEl ? tabsEl.style.display : ''
    };
    if (editorEl) editorEl.style.display = 'none';
    if (diffEl) diffEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
    // Hide the file tabs header too (it lives outside .editor-wrapper).
    if (tabsEl) tabsEl.style.display = 'none';
  } catch { /* ignore */ }
  editorOverlay.style.display = 'flex';
  // Ensure Monaco doesn't get stuck after being hidden.
  try { editor?.layout?.(); } catch { /* ignore */ }
  try { diffEditor?.layout?.(); } catch { /* ignore */ }
}

function _closeExecutionTimelineInEditor() {
  const { editorOverlay } = _getAetEls();
  if (!editorOverlay) return;
  try { _closeAetNodeDrawer(); } catch { /* ignore */ }
  executionTimelineEditorOpen = false;
  editorOverlay.style.display = 'none';
  try {
    const editorEl = document.getElementById('editor');
    const diffEl = document.getElementById('diffEditor');
    const emptyEl = document.getElementById('editorEmptyState');
    const tabsEl = document.getElementById('editorTabs');
    if (executionTimelineEditorRestore) {
      if (editorEl) editorEl.style.display = executionTimelineEditorRestore.editorDisplay || '';
      if (diffEl) diffEl.style.display = executionTimelineEditorRestore.diffDisplay || '';
      if (emptyEl) emptyEl.style.display = executionTimelineEditorRestore.emptyDisplay || '';
      if (tabsEl) tabsEl.style.display = executionTimelineEditorRestore.tabsDisplay || '';
    }
  } catch { /* ignore */ }
  executionTimelineEditorRestore = null;
  try { editor?.layout?.(); } catch { /* ignore */ }
  try { diffEditor?.layout?.(); } catch { /* ignore */ }
}


function _getGraphViewportState(runId) {
  const rid = String(runId || '').trim();
  const v = rid ? executionTimelineGraphViewportByRunId[rid] : null;
  if (v && typeof v === 'object') {
    const scale = Number(v.scale);
    const tx = Number(v.tx);
    const ty = Number(v.ty);
    return {
      scale: Number.isFinite(scale) ? scale : 1,
      tx: Number.isFinite(tx) ? tx : 0,
      ty: Number.isFinite(ty) ? ty : 0
    };
  }
  return { scale: 1, tx: 0, ty: 0 };
}


function _setGraphViewportState(runId, state) {
  const rid = String(runId || '').trim();
  if (!rid) return;
  const next = state && typeof state === 'object' ? state : {};
  const scale = Number(next.scale);
  const tx = Number(next.tx);
  const ty = Number(next.ty);
  executionTimelineGraphViewportByRunId[rid] = {
    scale: Number.isFinite(scale) ? scale : 1,
    tx: Number.isFinite(tx) ? tx : 0,
    ty: Number.isFinite(ty) ? ty : 0
  };
  try { scheduleUIMetadataSave(700); } catch { /* ignore */ }
}


function _applyGraphTransform(canvas, { scale, tx, ty }) {
  if (!canvas) return;
  const s = Number.isFinite(Number(scale)) ? Number(scale) : 1;
  const x = Number.isFinite(Number(tx)) ? Number(tx) : 0;
  const y = Number.isFinite(Number(ty)) ? Number(ty) : 0;
  canvas.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
}


function _fitGraphToView({ runId, viewport, canvas, grid }) {
  try {
    if (!viewport || !canvas || !grid) return;
    const nodeEls = Array.from(grid.querySelectorAll('[data-node-id]'));
    if (nodeEls.length === 0) return;

    // Content bounds in content coords (untransformed).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of nodeEls) {
      const x = grid.offsetLeft + el.offsetLeft;
      const y = grid.offsetTop + el.offsetTop;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return;

    const padding = 26;
    const boundsW = Math.max(1, (maxX - minX) + padding * 2);
    const boundsH = Math.max(1, (maxY - minY) + padding * 2);

    const vw = Math.max(1, viewport.clientWidth);
    const vh = Math.max(1, viewport.clientHeight);

    let scale = Math.min(vw / boundsW, vh / boundsH);
    scale = Math.max(0.25, Math.min(2.5, scale));

    const tx = ((vw - boundsW * scale) / 2) - (minX - padding) * scale;
    const ty = ((vh - boundsH * scale) / 2) - (minY - padding) * scale;

    const st = { scale, tx, ty };
    _setGraphViewportState(runId, st);
    _applyGraphTransform(canvas, st);
  } catch {
    // ignore
  }
}


function _installGraphInteractions({ runId, viewport, canvas }) {
  if (!viewport || !canvas) return;
  if (viewport._aetBound === true) return;
  viewport._aetBound = true;

  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  const beginPan = (e) => {
    try {
      if (e.target && e.target.closest && e.target.closest('.execution-graph-node')) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      isPanning = true;
      viewport.classList.add('grabbing');
      viewport.setPointerCapture?.(e.pointerId);
      const st = _getGraphViewportState(runId);
      startX = e.clientX;
      startY = e.clientY;
      startTx = st.tx;
      startTy = st.ty;
    } catch { /* ignore */ }
  };

  const movePan = (e) => {
    if (!isPanning) return;
    try {
      e.preventDefault();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const st = _getGraphViewportState(runId);
      const next = { ...st, tx: startTx + dx, ty: startTy + dy };
      _setGraphViewportState(runId, next);
      _applyGraphTransform(canvas, next);
    } catch { /* ignore */ }
  };

  const endPan = (e) => {
    if (!isPanning) return;
    try {
      e.preventDefault();
      isPanning = false;
      viewport.classList.remove('grabbing');
      viewport.releasePointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
  };

  viewport.addEventListener('pointerdown', beginPan);
  viewport.addEventListener('pointermove', movePan);
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);

  // Zoom: pinch (Electron ctrlKey wheel) or ctrl/cmd + scroll.
  // Zoom: default wheel/trackpad scroll (cursor-centered).
  // Pan: drag background; optionally wheel-pan with modifiers.
  viewport.addEventListener('wheel', (e) => {
    try {
      const st = _getGraphViewportState(runId);
      const rect = viewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Desired UX: two-finger scroll zooms (like a graph debugger).
      // Provide wheel-pan when user holds a modifier key.
      const wantsPan = e.shiftKey === true || e.ctrlKey === true || e.metaKey === true || e.altKey === true;

      if (!wantsPan) {
        e.preventDefault();
        const s = st.scale;
        // deltaY > 0 => zoom out, deltaY < 0 => zoom in
        const factor = Math.exp((-e.deltaY) * 0.001);
        const nextScale = Math.max(0.25, Math.min(2.5, s * factor));
        const uX = (cx - st.tx) / s;
        const uY = (cy - st.ty) / s;
        const tx = cx - uX * nextScale;
        const ty = cy - uY * nextScale;
        const next = { scale: nextScale, tx, ty };
        _setGraphViewportState(runId, next);
        _applyGraphTransform(canvas, next);
        return;
      }

      // Wheel-pan (modifier held)
      if (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        const next = { ...st, tx: st.tx - e.deltaX, ty: st.ty - e.deltaY };
        _setGraphViewportState(runId, next);
        _applyGraphTransform(canvas, next);
      }
    } catch {
      // ignore
    }
  }, { passive: false });
}


function openExecutionTimeline() {
  const { panel } = _getAetEls();
  if (!panel) return;
  executionTimelineIsOpen = true;
  panel.style.display = 'flex';
  // next tick for transition
  setTimeout(() => {
    try { panel.classList.add('open'); } catch { /* ignore */ }
  }, 0);
  try { if (currentSessionId) loadExecutionTimelineForSession(currentSessionId).catch(() => {}); } catch { /* ignore */ }
  try { _syncAetViewToggleUI(); } catch { /* ignore */ }
  try { if (currentSessionId) renderExecutionTimelineForSession(currentSessionId); } catch { /* ignore */ }
}


function closeExecutionTimeline() {
  const { panel } = _getAetEls();
  if (!panel) return;
  executionTimelineIsOpen = false;
  try { panel.classList.remove('open'); } catch { /* ignore */ }
  setTimeout(() => {
    try {
      if (!executionTimelineIsOpen) panel.style.display = 'none';
    } catch { /* ignore */ }
  }, 180);
}


function toggleExecutionTimeline() {
  if (executionTimelineIsOpen) closeExecutionTimeline();
  else openExecutionTimeline();
}


function clearExecutionTimelineData() {
  // Clear all AET (Agent Execution Timeline) data when switching projects
  try {
    // Clear runs data
    for (const key in executionTimelineRunsBySession) {
      delete executionTimelineRunsBySession[key];
    }
    // Clear active run tracking
    for (const key in executionTimelineActiveRunBySession) {
      delete executionTimelineActiveRunBySession[key];
    }
    // Clear run-to-session mapping
    for (const key in executionTimelineSessionByRunId) {
      delete executionTimelineSessionByRunId[key];
    }
    // Clear view mode preferences
    for (const key in executionTimelineViewModeBySession) {
      delete executionTimelineViewModeBySession[key];
    }
    // Clear filters
    for (const key in executionTimelineFiltersBySession) {
      delete executionTimelineFiltersBySession[key];
    }
    // Clear panel preferences
    for (const key in executionTimelinePanelPrefsBySession) {
      delete executionTimelinePanelPrefsBySession[key];
    }
    // Clear graph viewport state (in-memory)
    for (const key in executionTimelineGraphViewportByRunId) {
      delete executionTimelineGraphViewportByRunId[key];
    }
    // Clear graph node layout (in-memory)
    for (const key in executionTimelineGraphNodeLayoutByRunId) {
      delete executionTimelineGraphNodeLayoutByRunId[key];
    }
    // Clear selected nodes (in-memory)
    for (const key in executionTimelineSelectedNodeByRunId) {
      delete executionTimelineSelectedNodeByRunId[key];
    }
    
    // Close AET panels if open
    try { if (typeof window.closeExecutionTimeline === 'function') window.closeExecutionTimeline(); } catch { /* ignore */ }
    try { if (typeof window._closeExecutionTimelineInEditor === 'function') window._closeExecutionTimelineInEditor(); } catch { /* ignore */ }
  } catch (err) {
    console.error('[AET] Error clearing execution timeline data:', err);
  }
}


async function loadExecutionTimelineForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (!window.currentFolder) return;
  if (!window.electronAPI || typeof window.electronAPI.executionTimelineLoadSession !== 'function') return;

  const res = await window.electronAPI.executionTimelineLoadSession(window.currentFolder, sid);
  if (!res || res.success !== true) return;
  const runs = Array.isArray(res.runs) ? res.runs : [];
  executionTimelineRunsBySession[sid] = runs;
  for (const r of runs) {
    if (r && r.id) executionTimelineSessionByRunId[String(r.id)] = sid;
  }
  if (!executionTimelineActiveRunBySession[sid] && runs.length > 0) {
    executionTimelineActiveRunBySession[sid] = String(runs[runs.length - 1].id);
  }
  if (!executionTimelineViewModeBySession[sid]) {
    executionTimelineViewModeBySession[sid] = 'feed';
  }
  if ((executionTimelineIsOpen || executionTimelineEditorOpen) && sid === currentSessionId) {
    _syncAetViewToggleUI();
    renderExecutionTimelineForSession(sid);
  }
}


function _nodeTitle(node) {
  try {
    const baseTitle = String((node && node.payload && node.payload.title) ? node.payload.title : (node && node.type ? node.type : 'Node'));
    const type = String(node?.type || '');
    const payload = node?.payload && typeof node.payload === 'object' ? node.payload : null;
    const summary = payload?.toolInputSummary && typeof payload.toolInputSummary === 'object' ? payload.toolInputSummary : null;
    const preview = payload?.preview && typeof payload.preview === 'string' ? payload.preview : '';
    
    // Enhance generic titles with more specific info from toolInputSummary
    if (type === 'SkillInvoked' && (baseTitle === 'Skill' || baseTitle.startsWith('Skill:'))) {
      // Helper to look up display name from folder name
      const getDisplayName = (folderName) => {
        if (!folderName) return null;
        const skills = Array.isArray(availableSkills) ? availableSkills : [];
        // Try exact match on folder name in skill ID
        const skill = skills.find(s => {
          if (!s || !s.id) return false;
          const dir = skillIdToProjectSkillDir ? skillIdToProjectSkillDir(s.id) : '';
          return dir === folderName || dir.endsWith('/' + folderName);
        });
        return skill?.name || null;
      };
      
      // Try multiple sources for skill name: commandName (primary), skill, then fallbacks
      const skillName = summary?.commandName || summary?.skill || '';
      if (skillName && !baseTitle.includes(skillName)) {
        const displayName = getDisplayName(skillName) || skillName;
        return `Skill: ${displayName}`;
      }
      // Try to extract from skillPath if commandName is empty
      if (!skillName && summary?.skillPath) {
        const parts = String(summary.skillPath).split('/').filter(Boolean);
        const skillsIdx = parts.indexOf('skills');
        const extractedName = skillsIdx >= 0 && skillsIdx < parts.length - 1 ? parts[skillsIdx + 1] : parts[parts.length - 1];
        if (extractedName) {
          const displayName = getDisplayName(extractedName) || extractedName;
          return `Skill: ${displayName}`;
        }
      }
      // Try to extract from preview like ": /frontend-design ..." or ": frontend-design ..."
      if (!skillName && preview) {
        const match = preview.match(/:\s*\/?([a-z0-9][a-z0-9_:-]{0,63})/i);
        if (match && match[1]) {
          const displayName = getDisplayName(match[1]) || match[1];
          return `Skill: ${displayName}`;
        }
      }
    }
    
    // Enhance subagent titles with agentType
    if ((type === 'SubagentStart' || type === 'SubagentStop') && payload) {
      const agentType = payload.agentType || '';
      const agentId = payload.agentId || '';
      if (agentType && !baseTitle.includes(agentType)) {
        const suffix = type === 'SubagentStop' ? ' done' : '';
        if (agentId) return `${agentType}: ${agentId}${suffix}`;
        return `${agentType}${suffix}`;
      }
    }
    
    return baseTitle;
  } catch {
    return 'Node';
  }
}


function _nodeJustificationText(node) {
  try {
    const jt = node && typeof node.justificationText === 'string' ? node.justificationText : '';
    return String(jt || '').trim();
  } catch {
    return '';
  }
}


function _nodeJustificationMeta(node) {
  try {
    const j = node && node.payload && typeof node.payload === 'object' ? node.payload.justification : null;
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}


function _executionTimelineDevMode() {
  try {
    // Dev-only: enable with localStorage key.
    // In DevTools console: localStorage.setItem('codeon.devExecutionTimeline', '1')
    return String(localStorage.getItem('codeon.devExecutionTimeline') || '') === '1';
  } catch {
    return false;
  }
}


function _shouldShowJustificationForNode(node) {
  const t = String(node?.type || '');
  if (t === 'FileEdit' || t === 'BashCommand' || t === 'NetworkRequest' || t === 'Warning' || t === 'UserIntervention') {
    return true;
  }
  return false;
}


function _nodeFilePath(node) {
  try {
    // Prefer structured summaries (from main/claude service)
    const p = node && node.payload && typeof node.payload === 'object' ? node.payload : null;
    const s = p && p.toolInputSummary && typeof p.toolInputSummary === 'object' ? p.toolInputSummary : null;
    const fp = s && typeof s.filePath === 'string' ? s.filePath.trim() : '';
    if (fp) return fp;
    // Diff nodes store filePath directly
    const fp2 = p && typeof p.filePath === 'string' ? p.filePath.trim() : '';
    if (fp2) return fp2;
    return '';
  } catch {
    return '';
  }
}


function _nodeIsDiff(node) {
  try {
    const p = node && node.payload && typeof node.payload === 'object' ? node.payload : null;
    return !!(p && typeof p.diffContent === 'string' && p.diffContent.trim());
  } catch {
    return false;
  }
}


function _nodeCheckpointHash(node) {
  try {
    const h = String(node?.gitCheckpointHash || node?.payload?.commitHash || '').trim();
    return h;
  } catch {
    return '';
  }
}


function _isCheckpointNode(node) {
  return !!_nodeCheckpointHash(node);
}


function _fmtAetDuration(ms) {
  try {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '';
    const total = Math.floor(n / 1000);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad2 = (v) => String(v).padStart(2, '0');
    if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    return `${pad2(m)}:${pad2(s)}`;
  } catch {
    return '';
  }
}


function _aetRunAnchorCheckpointHash(run) {
  try {
    const nodes = Array.isArray(run?.nodes) ? run.nodes : [];
    let bestTs = Infinity;
    let bestHash = '';
    for (const n of nodes) {
      const h = _nodeCheckpointHash(n);
      if (!h) continue;
      const ts = Number(n?.timestamp || 0);
      if (Number.isFinite(ts) && ts > 0) {
        if (ts < bestTs) { bestTs = ts; bestHash = h; }
      } else if (!bestHash) {
        // Fallback: accept first hash if timestamps are missing.
        bestHash = h;
      }
    }
    return String(bestHash || '').trim();
  } catch {
    return '';
  }
}


function _aetRunStatus(run) {
  try {
    const s = String(run?.status || '').trim().toLowerCase();
    return s || 'running';
  } catch {
    return 'running';
  }
}


function _aetRunSummaryHtml(run, { shownNodesCount = null, recordedNodesCount = null } = {}) {
  try {
    if (!run || typeof run !== 'object') return '';

    const status = _aetRunStatus(run);
    const statusClass = (
      status === 'success' ? 'success'
        : (status === 'error' ? 'error'
          : (status === 'cancelled' ? 'cancelled'
            : (status === 'discarded' ? 'discarded' : 'running')))
    );

    const start = Number(run?.startTime || 0);
    const end = Number(run?.endTime || 0);
    const now = Date.now();
    const durMs = (Number.isFinite(start) && start > 0)
      ? ((Number.isFinite(end) && end > 0) ? Math.max(0, end - start) : Math.max(0, now - start))
      : 0;
    const dur = _fmtAetDuration(durMs) || '—';

    const nodes = Array.isArray(run?.nodes) ? run.nodes : [];
    const totalNodesRecorded = (recordedNodesCount != null && Number.isFinite(Number(recordedNodesCount)))
      ? Number(recordedNodesCount)
      : nodes.length;
    const totalNodesShown = (shownNodesCount != null && Number.isFinite(Number(shownNodesCount)))
      ? Number(shownNodesCount)
      : totalNodesRecorded;

    const counts = {};
    const editedFiles = new Set();
    for (const n of nodes) {
      const t = String(n?.type || '').trim() || 'Node';
      counts[t] = (Number(counts[t] || 0) || 0) + 1;
      if (t === 'FileEdit' && !_nodeIsDiff(n)) {
        const fp = _nodeFilePath(n);
        if (fp) editedFiles.add(fp);
      }
    }

    const anchor = _aetRunAnchorCheckpointHash(run);
    const anchorShort = anchor ? anchor.slice(0, 7) : '';

    const editsTitle = (() => {
      try {
        const list = Array.from(editedFiles);
        if (list.length === 0) return 'No edited files recorded in this run';
        const head = list.slice(0, 12).join('\n');
        return list.length > 12 ? `${head}\n… (+${list.length - 12} more)` : head;
      } catch {
        return '';
      }
    })();

    const meta = run?.meta && typeof run.meta === 'object' ? run.meta : null;
    const discardedReason = meta && meta.discarded === true && typeof meta.discardReason === 'string' ? meta.discardReason.trim() : '';
    const truncated = !!(meta && meta.truncated === true);
    const truncatedRemoved = meta && Number.isFinite(Number(meta.truncatedRemovedCount)) ? Number(meta.truncatedRemovedCount) : null;
    const totalCostUsd = meta && Number.isFinite(Number(meta.totalCostUsd)) ? Number(meta.totalCostUsd) : null;
    const maxBudgetUsd = meta && Number.isFinite(Number(meta.maxBudgetUsd)) ? Number(meta.maxBudgetUsd) : null;

    const fmtUsd = (n) => {
      try {
        const v = Number(n);
        if (!Number.isFinite(v)) return '';
        return `$${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
      } catch {
        return '';
      }
    };

    // Extract unique skill names from nodes
    const skillNames = new Set();
    const subagentTypes = new Set();
    for (const n of nodes) {
      const t = String(n?.type || '').trim();
      if (t === 'SkillInvoked') {
        const summary = n?.payload?.toolInputSummary;
        const name = summary?.commandName || summary?.skillName || '';
        if (name) skillNames.add(name);
        // Also try to extract from skillPath
        const skillPath = summary?.skillPath || '';
        if (!name && skillPath) {
          const parts = skillPath.split('/').filter(Boolean);
          const skillsIdx = parts.indexOf('skills');
          const extractedName = skillsIdx >= 0 && skillsIdx < parts.length - 1 ? parts[skillsIdx + 1] : parts[parts.length - 1];
          if (extractedName) skillNames.add(extractedName);
        }
      }
      if (t === 'SubagentStart') {
        const agentType = n?.payload?.agentType || '';
        if (agentType) subagentTypes.add(agentType);
      }
    }

    // Build skill pill - show names if 1-3 skills, otherwise show count
    const skillPills = (() => {
      const count = Number(counts.SkillInvoked || 0);
      if (count === 0) return [];
      const names = Array.from(skillNames).slice(0, 3);
      if (names.length === 1) {
        return [`<span class="aet-run-pill" title="Skill invoked: ${escapeAttr(names[0])}">skill <strong>${escapeHtml(names[0])}</strong></span>`];
      } else if (names.length <= 3 && names.length === count) {
        return [`<span class="aet-run-pill" title="Skills invoked: ${escapeAttr(names.join(', '))}">skills <strong>${escapeHtml(names.join(', '))}</strong></span>`];
      } else {
        return [`<span class="aet-run-pill" title="Claude Code skills invoked (via /&lt;skill&gt;): ${escapeAttr(names.join(', ') || 'skills')}">skills <strong>${escapeHtml(String(count))}</strong></span>`];
      }
    })();

    // Build subagent pill - show types if 1-3, otherwise show count
    const subagentPills = (() => {
      const count = Number(counts.SubagentStart || 0);
      if (count === 0) return [];
      const types = Array.from(subagentTypes).slice(0, 3);
      if (types.length === 1) {
        return [`<span class="aet-run-pill" title="Subagent type: ${escapeAttr(types[0])}">subagent <strong>${escapeHtml(types[0])}</strong></span>`];
      } else if (types.length <= 3 && types.length === count) {
        return [`<span class="aet-run-pill" title="Subagent types: ${escapeAttr(types.join(', '))}">subagents <strong>${escapeHtml(types.join(', '))}</strong></span>`];
      } else {
        return [`<span class="aet-run-pill" title="Subagent invocations during this run: ${escapeAttr(types.join(', ') || 'subagents')}">subagents <strong>${escapeHtml(String(count))}</strong></span>`];
      }
    })();

    const pills = [
      `<span class="aet-run-pill status-${statusClass}" title="${escapeAttr(discardedReason || `Run status: ${status}`)}">status <strong>${escapeHtml(status)}</strong></span>`,
      `<span class="aet-run-pill" title="Elapsed time for this run">duration <strong>${escapeHtml(dur)}</strong></span>`,
      `<span class="aet-run-pill" title="${escapeAttr(`Nodes shown: ${totalNodesShown} (recorded: ${totalNodesRecorded}; hidden diff nodes are not shown by default)`)}">nodes <strong>${escapeHtml(String(totalNodesShown))}</strong></span>`,
      `<span class="aet-run-pill" title="${escapeAttr(editsTitle)}">edited files <strong>${escapeHtml(String(editedFiles.size))}</strong></span>`,
      ...skillPills,
      ...subagentPills,
      ...(anchorShort ? [`<span class="aet-run-pill" title="Anchor (turn) checkpoint hash">ckpt <strong>${escapeHtml(anchorShort)}</strong></span>`] : []),
      ...(truncated ? [`<span class="aet-run-pill" title="This run was truncated after a restore">truncated <strong>${escapeHtml(truncatedRemoved != null ? String(truncatedRemoved) : 'yes')}</strong></span>`] : [])
    ];

    return `<div class="aet-run-summary">${pills.join('')}</div>`;
  } catch {
    return '';
  }
}


function _renderAetRunSummary(run, opts = {}) {
  try {
    const { runSummary, editorRunSummary } = _getAetEls();
    const html = _aetRunSummaryHtml(run, opts);
    if (runSummary) runSummary.innerHTML = html;
    if (editorRunSummary) editorRunSummary.innerHTML = html;
  } catch {
    // ignore
  }
}


function _aetBuildChangesFromDisplayNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const byFile = new Map(); // filePath -> { filePath, edits, hasDiff, nodeId, lastAt }
  for (const n of list) {
    if (!n || typeof n !== 'object') continue;
    const t = String(n.type || '');
    if (t !== 'FileEdit') continue;
    if (_nodeIsDiff(n)) continue; // diff nodes are normally hidden; derived diffs live on edit nodes
    const fp = _nodeFilePath(n);
    if (!fp) continue;
    const key = fp;
    const existing = byFile.get(key) || { filePath: fp, edits: 0, hasDiff: false, nodeId: '', lastAt: 0 };
    existing.edits = (Number(existing.edits || 0) || 0) + 1;
    const nid = String(n.id || '').trim();
    if (nid) existing.nodeId = nid; // last edit node wins
    const ts = Number(n.timestamp || 0);
    if (Number.isFinite(ts) && ts > 0) existing.lastAt = ts;
    const diff = typeof n.__aetDerivedDiffContent === 'string' ? String(n.__aetDerivedDiffContent || '') : '';
    if (diff.trim()) existing.hasDiff = true;
    byFile.set(key, existing);
  }
  return Array.from(byFile.values())
    .sort((a, b) => Number(b.lastAt || 0) - Number(a.lastAt || 0));
}


function _renderAetChangesPanel({ sessionId, runId, nodes } = {}) {
  try {
    const sid = String(sessionId || '').trim();
    const rid = String(runId || '').trim();
    const { changes, editorChanges } = _getAetEls();
    if (!changes && !editorChanges) return;

    const items = _aetBuildChangesFromDisplayNodes(nodes);
    if (!items.length) {
      const empty = `<div class="aet-changes"><div class="aet-changes-header"><div class="aet-changes-title">CHANGES</div><div class="aet-changes-meta">0 files</div></div><div style="opacity:0.72; font-size:0.78rem;">No file edits recorded for this run.</div></div>`;
      if (changes) changes.innerHTML = empty;
      if (editorChanges) editorChanges.innerHTML = empty;
      return;
    }

    const MAX = 80;
    const shown = items.slice(0, MAX);
    const more = items.length > MAX ? (items.length - MAX) : 0;

    const html = `
      <div class="aet-changes" data-aet-changes="1" data-session-id="${escapeAttr(sid)}" data-run-id="${escapeAttr(rid)}">
        <div class="aet-changes-header">
          <div class="aet-changes-title">CHANGES</div>
          <div class="aet-changes-meta">${escapeHtml(String(items.length))} file(s)</div>
        </div>
        <div class="aet-changes-list">
          ${shown.map(it => {
            const title = it.hasDiff ? 'Open node details (includes diff preview)' : 'Open node details';
            return `
              <button class="aet-change-chip" type="button"
                data-aet-change="1"
                data-node-id="${escapeAttr(String(it.nodeId || '').trim())}"
                title="${escapeAttr(title)}">
                <span class="aet-change-file">${escapeHtml(it.filePath)}</span>
                <span class="aet-change-badge" title="Edit nodes">${escapeHtml(String(it.edits))}</span>
                <span class="aet-change-badge ${it.hasDiff ? 'has-diff' : ''}" title="${escapeAttr(it.hasDiff ? 'Diff preview available' : 'No diff preview captured')}">${it.hasDiff ? 'diff' : 'no diff'}</span>
              </button>
            `.trim();
          }).join('')}
          ${more > 0 ? `<span class="aet-change-badge" title="List truncated for performance">+${escapeHtml(String(more))} more</span>` : ''}
        </div>
      </div>
    `.trim();

    if (changes) changes.innerHTML = html;
    if (editorChanges) editorChanges.innerHTML = html;

    // Delegate clicks once (applies to both chat + editor panels).
    if (!window.__aetChangesDelegationBound) {
      window.__aetChangesDelegationBound = true;
      document.addEventListener('click', (e) => {
        try {
          const btn = e && e.target && e.target.closest ? e.target.closest('[data-aet-change]') : null;
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          const wrap = btn.closest('[data-aet-changes]');
          const sid2 = wrap ? String(wrap.getAttribute('data-session-id') || '').trim() : '';
          const rid2 = wrap ? String(wrap.getAttribute('data-run-id') || '').trim() : '';
          const nid = String(btn.getAttribute('data-node-id') || '').trim();
          const sidFinal = sid2 || String(currentSessionId || '').trim();
          const ridFinal = rid2 || String(executionTimelineActiveRunBySession[sidFinal] || '').trim();
          if (!sidFinal || !ridFinal || !nid) return;
          _openAetNodeDrawer({ sessionId: sidFinal, runId: ridFinal, nodeId: nid });
        } catch { /* ignore */ }
      }, { capture: true });
    }
  } catch {
    // ignore
  }
}


function _getAetFiltersForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { q: '', qScope: 'all', type: 'all', risk: 'all' };
  if (!executionTimelineFiltersBySession[sid] || typeof executionTimelineFiltersBySession[sid] !== 'object') {
    executionTimelineFiltersBySession[sid] = { q: '', qScope: 'all', type: 'all', risk: 'all' };
  }
  const f = executionTimelineFiltersBySession[sid];
  // Normalize/defend
  const q = String(f.q || '').slice(0, 200);
  const qScopeRaw = String(f.qScope || '').trim().toLowerCase();
  const qScope = (qScopeRaw === 'file' || qScopeRaw === 'node' || qScopeRaw === 'all') ? qScopeRaw : 'all';
  const out = { q, qScope, type: String(f.type || 'all') || 'all', risk: String(f.risk || 'all') || 'all' };

  // Backward-compat: older builds stored a dedicated `file` filter.
  // If `file` is present and `q` is empty, migrate into qScope=file.
  try {
    const legacyFile = String(f.file || '').trim();
    if (legacyFile && !q) {
      out.q = legacyFile.slice(0, 200);
      out.qScope = 'file';
    }
  } catch { /* ignore */ }

  executionTimelineFiltersBySession[sid] = out;
  return out;
}


function _getAetPanelPrefsForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { filtersOpen: false };
  if (!executionTimelinePanelPrefsBySession[sid] || typeof executionTimelinePanelPrefsBySession[sid] !== 'object') {
    executionTimelinePanelPrefsBySession[sid] = { filtersOpen: false };
  }
  const p = executionTimelinePanelPrefsBySession[sid];
  const out = { filtersOpen: p.filtersOpen === true };
  executionTimelinePanelPrefsBySession[sid] = out;
  return out;
}


function _aetHasActiveFilters(f) {
  try {
    const q = String(f?.q || '').trim();
    const type = String(f?.type || 'all').trim();
    const risk = String(f?.risk || 'all').trim();
    return !!(q || (type && type !== 'all') || (risk && risk !== 'all'));
  } catch {
    return false;
  }
}


function _aetNormalizeRisk(val) {
  const r = String(val || '').trim().toLowerCase();
  if (r === 'low' || r === 'med' || r === 'high') return r;
  return '';
}


function _aetNodeRisk(node) {
  try {
    const meta = _nodeJustificationMeta(node);
    const risk = meta && typeof meta.risk === 'string' ? meta.risk.trim().toLowerCase() : '';
    return _aetNormalizeRisk(risk);
  } catch {
    return '';
  }
}


function _aetApplyNodeFilters(nodes, filters) {
  const list = Array.isArray(nodes) ? nodes : [];
  const f = filters && typeof filters === 'object' ? filters : { q: '', qScope: 'all', type: 'all', risk: 'all' };
  const q = String(f.q || '').trim().toLowerCase();
  const qScope = String(f.qScope || 'all').trim().toLowerCase();
  const type = String(f.type || 'all').trim();
  const risk = String(f.risk || 'all').trim().toLowerCase();

  if (!q && (type === 'all' || !type) && (risk === 'all' || !risk)) return list;

  const matchQuery = (node) => {
    if (!q) return true;
    try {
      const title = _nodeTitle(node);
      const fp = _nodeFilePath(node);
      const p = node && node.payload && typeof node.payload === 'object' ? node.payload : {};
      const toolName = typeof p.toolName === 'string' ? p.toolName : '';
      const preview = typeof p.preview === 'string' ? p.preview : '';
      // Intentionally avoid diff content (can be huge).
      const hay =
        qScope === 'file'
          ? `${fp}`.toLowerCase()
          : (qScope === 'node'
            ? `${title}\n${toolName}\n${preview}`.toLowerCase()
            : `${title}\n${toolName}\n${fp}\n${preview}`.toLowerCase());
      return hay.includes(q);
    } catch {
      return false;
    }
  };

  const matchType = (node) => {
    if (!type || type === 'all') return true;
    return String(node?.type || '') === type;
  };

  const matchRisk = (node) => {
    if (!risk || risk === 'all') return true;
    return _aetNodeRisk(node) === risk;
  };

  return list.filter(n => matchType(n) && matchRisk(n) && matchQuery(n));
}


function _aetFiltersHtml({ sessionId, shownCount, totalCount } = {}) {
  try {
    const sid = String(sessionId || '').trim();
    const f = _getAetFiltersForSession(sid);
    const prefs = _getAetPanelPrefsForSession(sid);
    const shown = Number.isFinite(Number(shownCount)) ? Number(shownCount) : 0;
    const total = Number.isFinite(Number(totalCount)) ? Number(totalCount) : 0;
    const active = _aetHasActiveFilters(f);
    const open = active || prefs.filtersOpen === true;

    const typeOptions = [
      ['all', 'All types'],
      ['CheckpointCreated', 'Checkpoint'],
      ['SessionStart', 'Session start'],
      ['SessionEnd', 'Session end'],
      ['PermissionRequest', 'Permission'],
      ['FileRead', 'File read'],
      ['Search', 'Search'],
      ['SkillInvoked', 'Skill'],
      ['FileEdit', 'File edit'],
      ['BashCommand', 'Bash'],
      ['NetworkRequest', 'Web'],
      ['ToolFailure', 'Tool failure'],
      ['SubagentStart', 'Subagent start'],
      ['SubagentStop', 'Subagent stop'],
      ['Compact', 'Compact'],
      ['UserIntervention', 'Intervention'],
      ['Warning', 'Warning'],
      ['PlanGenerated', 'Plan'],
      ['Completion', 'Completion']
    ];

    const riskOptions = [
      ['all', 'All risk'],
      ['low', 'Risk: low'],
      ['med', 'Risk: med'],
      ['high', 'Risk: high']
    ];

    const scopeOptions = [
      ['all', 'All fields'],
      ['file', 'File path'],
      ['node', 'Title/Tool']
    ];

    return `
      <div class="aet-filters-wrap ${open ? 'open' : ''}" data-aet-filters="1" data-session-id="${escapeAttr(sid)}">
        <div class="aet-filters-bar">
          <div class="aet-filters-title">FILTERS</div>
          ${active ? `<span class="aet-change-badge has-diff" data-aet-filters-active="1" title="Filters are active">active</span>` : ''}
          <div class="aet-filter-meta" data-aet-filters-meta="1">Showing ${escapeHtml(String(shown))}/${escapeHtml(String(total))}</div>
          ${active ? `<button class="btn-secondary aet-filter-clear" type="button" data-aet-filter-clear="1" title="Clear filters">Clear</button>` : ''}
          <button class="btn-secondary aet-filter-clear" type="button" data-aet-filter-toggle="1" title="${open ? 'Collapse filters' : 'Expand filters'}">${open ? 'Hide' : 'Show'}</button>
        </div>
        <div class="aet-filters aet-filters-body">
          <div class="aet-filter-qwrap">
            <input class="form-input aet-filter-input" data-aet-filter="q" type="text" value="${escapeAttr(f.q)}" placeholder="Search…" />
            <select class="form-input aet-filter-select aet-filter-scope" data-aet-filter="qScope" aria-label="Search scope">
              ${scopeOptions.map(([v, label]) => `<option value="${escapeAttr(v)}" ${String(f.qScope) === String(v) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
          <div class="aet-filter-trwrap">
            <select class="form-input aet-filter-select" data-aet-filter="type" aria-label="Filter by type">
              ${typeOptions.map(([v, label]) => `<option value="${escapeAttr(v)}" ${String(f.type) === String(v) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
            <select class="form-input aet-filter-select" data-aet-filter="risk" aria-label="Filter by risk">
              ${riskOptions.map(([v, label]) => `<option value="${escapeAttr(v)}" ${String(f.risk) === String(v) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
    `.trim();
  } catch {
    return '';
  }
}


function _patchAetFiltersDom(containerEl, { sessionId, shownCount, totalCount } = {}) {
  try {
    if (!containerEl) return false;
    const sid = String(sessionId || '').trim();
    if (!sid) return false;
    const wrap = containerEl.querySelector('[data-aet-filters="1"]');
    if (!wrap) return false;
    const existingSid = String(wrap.getAttribute('data-session-id') || '').trim();
    if (existingSid !== sid) return false;

    const f = _getAetFiltersForSession(sid);
    const prefs = _getAetPanelPrefsForSession(sid);
    const active = _aetHasActiveFilters(f);
    const open = active || prefs.filtersOpen === true;
    wrap.classList.toggle('open', !!open);

    const shown = Number.isFinite(Number(shownCount)) ? Number(shownCount) : 0;
    const total = Number.isFinite(Number(totalCount)) ? Number(totalCount) : 0;
    const meta = wrap.querySelector('[data-aet-filters-meta]');
    if (meta) meta.textContent = `Showing ${shown}/${total}`;

    // Active badge
    const badge = wrap.querySelector('[data-aet-filters-active]');
    if (active && !badge) {
      const title = wrap.querySelector('.aet-filters-title');
      if (title) {
        const el = document.createElement('span');
        el.className = 'aet-change-badge has-diff';
        el.setAttribute('data-aet-filters-active', '1');
        el.title = 'Filters are active';
        el.textContent = 'active';
        title.insertAdjacentElement('afterend', el);
      }
    }
    if (!active && badge) {
      try { badge.remove(); } catch { /* ignore */ }
    }

    // Clear button: only when active
    const clearBtn = wrap.querySelector('[data-aet-filter-clear]');
    if (active && !clearBtn) {
      const metaEl = wrap.querySelector('[data-aet-filters-meta]');
      if (metaEl) {
        const btn = document.createElement('button');
        btn.className = 'btn-secondary aet-filter-clear';
        btn.type = 'button';
        btn.setAttribute('data-aet-filter-clear', '1');
        btn.title = 'Clear filters';
        btn.textContent = 'Clear';
        metaEl.insertAdjacentElement('afterend', btn);
      }
    }
    if (!active && clearBtn) {
      try { clearBtn.remove(); } catch { /* ignore */ }
    }

    // Toggle label
    const toggleBtn = wrap.querySelector('[data-aet-filter-toggle]');
    if (toggleBtn) {
      toggleBtn.textContent = open ? 'Hide' : 'Show';
      toggleBtn.title = open ? 'Collapse filters' : 'Expand filters';
    }

    // Keep input values in sync when they are NOT focused (prevents cursor jumps).
    const activeEl = document.activeElement;
    const inWrap = activeEl && wrap.contains(activeEl);
    if (!inWrap) {
      const qEl = wrap.querySelector('[data-aet-filter="q"]');
      if (qEl && typeof qEl.value === 'string') qEl.value = String(f.q || '');
      const scopeEl = wrap.querySelector('[data-aet-filter="qScope"]');
      if (scopeEl && typeof scopeEl.value === 'string') scopeEl.value = String(f.qScope || 'all');
      const typeEl = wrap.querySelector('[data-aet-filter="type"]');
      if (typeEl && typeof typeEl.value === 'string') typeEl.value = String(f.type || 'all');
      const riskEl = wrap.querySelector('[data-aet-filter="risk"]');
      if (riskEl && typeof riskEl.value === 'string') riskEl.value = String(f.risk || 'all');
    }

    return true;
  } catch {
    return false;
  }
}

function _renderAetFilters({ sessionId, shownCount, totalCount } = {}) {
  try {
    const { filters, editorFilters } = _getAetEls();
    // Important: avoid rebuilding the filter inputs on every keystroke (loses focus).
    // Patch DOM in-place when possible; fallback to full render if missing/mismatched session.
    const didPatch1 = filters ? _patchAetFiltersDom(filters, { sessionId, shownCount, totalCount }) : false;
    const didPatch2 = editorFilters ? _patchAetFiltersDom(editorFilters, { sessionId, shownCount, totalCount }) : false;
    if (!didPatch1 && filters) filters.innerHTML = _aetFiltersHtml({ sessionId, shownCount, totalCount });
    if (!didPatch2 && editorFilters) editorFilters.innerHTML = _aetFiltersHtml({ sessionId, shownCount, totalCount });

    if (!window.__aetFiltersDelegationBound) {
      window.__aetFiltersDelegationBound = true;
      // Input typing + select changes
      const onUpdate = (wrap, key, value) => {
        const sid = wrap ? String(wrap.getAttribute('data-session-id') || '').trim() : '';
        const sidFinal = sid || String(currentSessionId || '').trim();
        if (!sidFinal) return;
        const f = _getAetFiltersForSession(sidFinal);
        if (key === 'q') f.q = String(value || '').slice(0, 200);
        if (key === 'qScope') {
          const v = String(value || '').trim().toLowerCase();
          f.qScope = (v === 'file' || v === 'node' || v === 'all') ? v : 'all';
        }
        if (key === 'type') f.type = String(value || 'all') || 'all';
        if (key === 'risk') f.risk = String(value || 'all') || 'all';
        executionTimelineFiltersBySession[sidFinal] = f;
        try { scheduleUIMetadataSave(500); } catch { /* ignore */ }
        try { renderExecutionTimelineForSession(sidFinal); } catch { /* ignore */ }
      };

      document.addEventListener('input', (e) => {
        try {
          const el = e && e.target;
          if (!el || !el.getAttribute) return;
          const key = String(el.getAttribute('data-aet-filter') || '').trim();
          if (!key) return;
          const wrap = el.closest('[data-aet-filters]');
          onUpdate(wrap, key, el.value);
        } catch { /* ignore */ }
      }, { capture: true });

      document.addEventListener('change', (e) => {
        try {
          const el = e && e.target;
          if (!el || !el.getAttribute) return;
          const key = String(el.getAttribute('data-aet-filter') || '').trim();
          if (!key) return;
          const wrap = el.closest('[data-aet-filters]');
          onUpdate(wrap, key, el.value);
        } catch { /* ignore */ }
      }, { capture: true });

      document.addEventListener('click', (e) => {
        try {
          const toggle = e && e.target && e.target.closest ? e.target.closest('[data-aet-filter-toggle]') : null;
          if (toggle) {
            e.preventDefault();
            e.stopPropagation();
            const wrap = toggle.closest('[data-aet-filters]');
            const sid = wrap ? String(wrap.getAttribute('data-session-id') || '').trim() : '';
            const sidFinal = sid || String(currentSessionId || '').trim();
            if (!sidFinal) return;
            const prefs = _getAetPanelPrefsForSession(sidFinal);
            prefs.filtersOpen = !(prefs.filtersOpen === true);
            executionTimelinePanelPrefsBySession[sidFinal] = prefs;
            try { scheduleUIMetadataSave(500); } catch { /* ignore */ }
            try { renderExecutionTimelineForSession(sidFinal); } catch { /* ignore */ }
            return;
          }
          const btn = e && e.target && e.target.closest ? e.target.closest('[data-aet-filter-clear]') : null;
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          const wrap = btn.closest('[data-aet-filters]');
          const sid = wrap ? String(wrap.getAttribute('data-session-id') || '').trim() : '';
          const sidFinal = sid || String(currentSessionId || '').trim();
          if (!sidFinal) return;
          executionTimelineFiltersBySession[sidFinal] = { q: '', qScope: 'all', type: 'all', risk: 'all' };
          // If the user cleared, collapse back unless they explicitly keep it open.
          try {
            const prefs = _getAetPanelPrefsForSession(sidFinal);
            prefs.filtersOpen = false;
            executionTimelinePanelPrefsBySession[sidFinal] = prefs;
          } catch { /* ignore */ }
          try { scheduleUIMetadataSave(500); } catch { /* ignore */ }
          try { renderExecutionTimelineForSession(sidFinal); } catch { /* ignore */ }
        } catch { /* ignore */ }
      }, { capture: true });
    }
  } catch {
    // ignore
  }
}


function _aetShowDiffNodes() {
  try {
    // Default: hidden (diff nodes are noisy). Dev override:
    // localStorage.setItem('codeon.showAetDiffNodes','1')
    return String(localStorage.getItem('codeon.showAetDiffNodes') || '') === '1';
  } catch {
    return false;
  }
}


function _aetAttachDiffPreviewsToEdits(nodes) {
  try {
    const list = Array.isArray(nodes) ? nodes : [];
    if (list.length === 0) return;
    const sorted = list.slice().sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
    const nodeById = new Map();
    for (const n of sorted) {
      const id = String(n?.id || '').trim();
      if (id) nodeById.set(id, n);
    }

    const lastEditByFile = new Map(); // filePath -> node (non-diff FileEdit)
    for (const n of sorted) {
      if (!n || typeof n !== 'object') continue;
      const type = String(n.type || '');
      if (type !== 'FileEdit') continue;
      const fp = _nodeFilePath(n) || (n?.payload && typeof n.payload.filePath === 'string' ? String(n.payload.filePath).trim() : '');
      if (!fp) continue;

      if (_nodeIsDiff(n)) {
        const diff = n?.payload && typeof n.payload.diffContent === 'string' ? String(n.payload.diffContent) : '';
        if (!diff.trim()) continue;
        const editNode = lastEditByFile.get(fp);
        if (editNode) {
          editNode.__aetDerivedDiffContent = diff;
          editNode.__aetAttachedDiffNodeId = String(n.id || '');
          n.__aetAttachedToNodeId = String(editNode.id || '');
        }
      } else {
        // Non-diff edit: becomes the current attachment target.
        lastEditByFile.set(fp, n);
      }
    }
  } catch {
    // ignore
  }
}


function _aetNodesForDisplay({ runId, nodes }) {
  const rid = String(runId || '').trim();
  const list = Array.isArray(nodes) ? nodes : [];
  // Attach diff previews so drawers for Edit nodes can show them even when diff nodes are hidden.
  _aetAttachDiffPreviewsToEdits(list);

  if (_aetShowDiffNodes()) return list;
  const filtered = list.filter(n => !_nodeIsDiff(n));

  // If the selected node is a hidden diff node, jump selection to the attached edit node (best-effort).
  try {
    if (rid && executionTimelineSelectedNodeByRunId && executionTimelineSelectedNodeByRunId[rid]) {
      const selectedId = String(executionTimelineSelectedNodeByRunId[rid] || '').trim();
      if (selectedId) {
        const selected = list.find(n => String(n?.id || '') === selectedId);
        if (selected && _nodeIsDiff(selected)) {
          const to = String(selected.__aetAttachedToNodeId || '').trim();
          if (to) executionTimelineSelectedNodeByRunId[rid] = to;
        }
      }
    }
  } catch { /* ignore */ }

  return filtered;
}


function _graphLaneForNode(node) {
  const t = String(node?.type || '');
  if (t === 'FileRead') return 1; // left
  if (t === 'Search') return 1; // left (read-only investigation)
  if (t === 'SkillInvoked') return 1; // left (command/skill expansion)
  if (t === 'FileEdit') return 3; // right
  if (t === 'BashCommand') return 2;
  if (t === 'NetworkRequest') return 2;
  if (t === 'Warning') return 2;
  if (t === 'PermissionRequest') return 2;
  if (t === 'ToolFailure') return 2;
  if (t === 'CheckpointCreated') return 2;
  if (t === 'SessionStart' || t === 'SessionEnd') return 2;
  if (t === 'SubagentStart' || t === 'SubagentStop') return 2;
  if (t === 'Compact') return 2;
  if (t === 'UserIntervention') return 2;
  if (t === 'PlanGenerated') return 2;
  if (t === 'Completion') return 2;
  return 2;
}


function _getRunIdForActiveGraph() {
  try {
    const sid = currentSessionId;
    return sid ? String(executionTimelineActiveRunBySession[sid] || '').trim() : '';
  } catch {
    return '';
  }
}


function _getNodeLayoutMapForRun(runId) {
  const rid = String(runId || '').trim();
  if (!rid) return null;
  if (!executionTimelineGraphNodeLayoutByRunId[rid] || typeof executionTimelineGraphNodeLayoutByRunId[rid] !== 'object') {
    executionTimelineGraphNodeLayoutByRunId[rid] = {};
  }
  return executionTimelineGraphNodeLayoutByRunId[rid];
}


function _ensureNodeLayout({ runId, nodeId, lane, defaultY, defaultW }) {
  const map = _getNodeLayoutMapForRun(runId);
  if (!map) return { x: 0, y: 0, w: defaultW || 320 };
  const existing = map[nodeId];
  if (existing && typeof existing === 'object') {
    const x = Number(existing.x);
    const y = Number(existing.y);
    const w = Number(existing.w);
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      w: Number.isFinite(w) ? w : (defaultW || 320)
    };
  }

  // Deterministic initial layout: 3 lanes with fixed base widths.
  const LANE_W = 360;
  const GAP_X = 120;
  const baseX = (lane - 1) * (LANE_W + GAP_X);
  const w = Number.isFinite(Number(defaultW)) ? Number(defaultW) : LANE_W;
  const y = Number.isFinite(Number(defaultY)) ? Number(defaultY) : 0;
  map[nodeId] = { x: baseX, y, w };
  return map[nodeId];
}


function _buildExecutionGraph(nodesInOrder) {
  const nodes = Array.isArray(nodesInOrder) ? nodesInOrder : [];
  const edges = []; // { fromId, toId, kind }

  const lastReadByFile = new Map(); // filePath -> nodeId
  const lastEditByFile = new Map(); // filePath -> nodeId

  let prevId = null;
  for (const n of nodes) {
    const nid = String(n?.id || '').trim();
    if (!nid) continue;

    // Sequential edge
    if (prevId) edges.push({ fromId: prevId, toId: nid, kind: 'seq' });
    prevId = nid;

    const fp = _nodeFilePath(n);

    if (String(n?.type || '') === 'FileRead' && fp) {
      lastReadByFile.set(fp, nid);
    }

    if (String(n?.type || '') === 'FileEdit') {
      if (fp) {
        const lr = lastReadByFile.get(fp);
        if (lr && lr !== nid) edges.push({ fromId: lr, toId: nid, kind: 'feed' });
        const le = lastEditByFile.get(fp);
        if (_nodeIsDiff(n) && le && le !== nid) {
          // Diff follows an edit (same file)
          edges.push({ fromId: le, toId: nid, kind: 'diff' });
        }
        if (!_nodeIsDiff(n)) lastEditByFile.set(fp, nid);
      }
    }
  }

  return { edges };
}


function _renderExecutionTimelineGraph({ nodes }) {
  const { editorGraphHost, graph, list } = _getAetEls();
  const host = editorGraphHost || graph;
  if (!host) return;
  const editorCanvasHost = (() => {
    try {
      if (!editorGraphHost) return null;
      const el = document.getElementById('executionTimelineEditorCanvasHost');
      return el || null;
    } catch { return null; }
  })();
  const target = editorGraphHost ? (editorCanvasHost || host) : host;

  // Graph view: render into editor canvas if available.
  if (editorGraphHost) {
    try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }
    try { closeExecutionTimeline(); } catch { /* ignore */ }
  } else {
    // Fallback: keep in chat panel (should be rare).
    if (list) list.style.display = 'none';
    if (graph) graph.style.display = 'block';
  }

  const sorted = (Array.isArray(nodes) ? nodes : []).slice().sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  // Clear previous graph contents
  target.innerHTML = '';

  if (!sorted.length) {
    target.innerHTML = '<div style="opacity:0.75; padding: 8px 2px;">No nodes recorded for this run yet.</div>';
    return;
  }

  const runId = _getRunIdForActiveGraph();

  // Performance guard: very large graphs can freeze the renderer. Encourage filtering first.
  try {
    const THRESH = 900;
    const rid = String(runId || '').trim();
    if (!window.__aetAllowLargeGraphByRunId || typeof window.__aetAllowLargeGraphByRunId !== 'object') {
      window.__aetAllowLargeGraphByRunId = {};
    }
    const allow = rid && window.__aetAllowLargeGraphByRunId[rid] === true;
    if (sorted.length > THRESH && !allow) {
      target.innerHTML = `
        <div style="opacity:0.92; padding: 10px 2px;">
          <div style="font-weight:900; margin-bottom:6px;">Graph disabled for large runs</div>
          <div style="opacity:0.85; line-height:1.4;">
            This run has <b>${escapeHtml(String(sorted.length))}</b> nodes. Rendering the graph may freeze the UI.<br/>
            Use filters to reduce the node count, switch to Feed view, or render anyway.
          </div>
          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-secondary" type="button" data-aet-render-large-graph="1" data-run-id="${escapeAttr(rid)}">Render anyway</button>
          </div>
        </div>
      `.trim();
      if (!window.__aetLargeGraphAllowDelegationBound) {
        window.__aetLargeGraphAllowDelegationBound = true;
        document.addEventListener('click', (e) => {
          try {
            const btn = e && e.target && e.target.closest ? e.target.closest('[data-aet-render-large-graph]') : null;
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const rid2 = String(btn.getAttribute('data-run-id') || '').trim();
            if (!rid2) return;
            if (!window.__aetAllowLargeGraphByRunId || typeof window.__aetAllowLargeGraphByRunId !== 'object') {
              window.__aetAllowLargeGraphByRunId = {};
            }
            window.__aetAllowLargeGraphByRunId[rid2] = true;
            try { renderExecutionTimelineForSession(currentSessionId); } catch { /* ignore */ }
          } catch { /* ignore */ }
        }, { capture: true });
      }
      return;
    }
  } catch { /* ignore */ }

  // Fast lookup for lazy details rendering during Shift+click.
  const nodeById = new Map();
  try {
    for (const n of sorted) {
      const nid = String(n?.id || '').trim();
      if (nid) nodeById.set(nid, n);
    }
  } catch { /* ignore */ }

  const viewport = document.createElement('div');
  viewport.className = 'execution-graph-viewport';
  viewport.dataset.runId = runId || '';

  const canvas = document.createElement('div');
  canvas.className = 'execution-graph-canvas';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('execution-graph-edges');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  // v1.8: free-positioned nodes live in an absolute layer.
  const layer = document.createElement('div');
  layer.className = 'execution-graph-layer';

  // Build nodes
  let nextY = 20;
  const GAP_Y = 18;
  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i];
    const nid = String(node?.id || '').trim();
    if (!nid) continue;

    const lvl = _nodeLevel(node);
    const title = _nodeTitle(node);
    const just = _nodeJustificationText(node);
    const showJust = !!(just && _shouldShowJustificationForNode(node));
    const meta = _nodeJustificationMeta(node);
    const risk = meta && typeof meta.risk === 'string' ? meta.risk.trim().toLowerCase() : '';
    const showRisk = (risk === 'low' || risk === 'med' || risk === 'high');
    const showMissing = _executionTimelineDevMode() && _shouldShowJustificationForNode(node) && !showJust;
    const when = _fmtAetTime(node && node.timestamp);
    const checkpointHash = _nodeCheckpointHash(node);
    const isCheckpoint = !!checkpointHash;
    const checkpointShort = isCheckpoint ? checkpointHash.slice(0, 7) : '';

    const lane = _graphLaneForNode(node); // 1..3
    const el = document.createElement('div');
    el.className = `execution-graph-node ${lvl}`;
    el.dataset.nodeId = nid;
    el.dataset.nodeType = String(node?.type || '');
    el.innerHTML = `
      <div class="execution-graph-node-header">
        <div class="execution-graph-node-left">
          <div class="execution-graph-node-dot"></div>
          <div class="execution-graph-node-text">
            <div class="execution-graph-node-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            ${showJust ? `<div class="execution-graph-node-why" title="${escapeHtml(just)}">${escapeHtml(just)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex: 0 0 auto;">
          ${showMissing ? `<span class="execution-graph-node-missing-jp" title="Dev: missing justification">Missing JP</span>` : ''}
          ${showRisk ? `<span class="execution-graph-node-risk risk-${escapeHtml(risk)}" title="Risk: ${escapeHtml(risk)}">${escapeHtml(risk)}</span>` : ''}
          ${isCheckpoint ? `<span class="execution-graph-node-checkpoint" title="Restore checkpoint (turn baseline)">ckpt ${escapeHtml(checkpointShort)}</span>` : ''}
          <div class="execution-graph-node-time">${escapeHtml(when)}</div>
        </div>
      </div>
      <div class="execution-graph-node-resizer" title="Resize"></div>
      <div class="execution-graph-node-details" data-aet-details="1"></div>
    `;
    layer.appendChild(el);

    // Apply deterministic or previously-adjusted layout.
    const layout = _ensureNodeLayout({ runId, nodeId: nid, lane, defaultY: nextY, defaultW: 360 });
    el.style.left = `${layout.x}px`;
    el.style.top = `${layout.y}px`;
    el.style.width = `${Math.max(220, Math.min(1100, layout.w))}px`;

    // Advance y based on rendered height (after insertion).
    try {
      const h = el.offsetHeight || 52;
      nextY = layout.y + h + GAP_Y;
    } catch {
      nextY += 60;
    }
  }

  canvas.appendChild(svg);
  canvas.appendChild(layer);
  viewport.appendChild(canvas);
  target.appendChild(viewport);

  const { edges } = _buildExecutionGraph(sorted);

  const drawEdges = () => {
    try {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      // Size the canvas + svg to the content (content coords, not screen coords).
      // Compute bounds from positioned nodes.
      const els = Array.from(layer.querySelectorAll('[data-node-id]'));
      let maxX = 0;
      let maxY = 0;
      for (const n of els) {
        const x = n.offsetLeft + n.offsetWidth;
        const y = n.offsetTop + n.offsetHeight;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const w = Math.max(1, Math.ceil(maxX + 40));
      const h = Math.max(1, Math.ceil(maxY + 40));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      layer.style.width = `${w}px`;
      layer.style.height = `${h}px`;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const colorSeq = 'rgba(148, 163, 184, 0.35)';
      const colorFeed = 'rgba(34, 211, 238, 0.45)';
      const colorDiff = 'rgba(52, 211, 153, 0.45)';

      for (const e of edges) {
        const from = canvas.querySelector(`[data-node-id="${CSS.escape(e.fromId)}"]`);
        const to = canvas.querySelector(`[data-node-id="${CSS.escape(e.toId)}"]`);
        if (!from || !to) continue;
        // Use layout (offset*) coordinates so pan/zoom transforms do not affect edge math.
        const x1 = from.offsetLeft + (from.offsetWidth / 2);
        const y1 = from.offsetTop + from.offsetHeight;
        const x2 = to.offsetLeft + (to.offsetWidth / 2);
        const y2 = to.offsetTop;

        const dy = Math.max(18, Math.min(70, (y2 - y1) / 2));
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
        path.setAttribute('d', d);
        path.setAttribute('stroke-width', e.kind === 'seq' ? '1.5' : '2');
        path.setAttribute('stroke', e.kind === 'feed' ? colorFeed : (e.kind === 'diff' ? colorDiff : colorSeq));
        path.setAttribute('opacity', e.kind === 'seq' ? '0.8' : '1');
        svg.appendChild(path);
      }
    } catch {
      // ignore
    }
  };

  // First draw after layout
  requestAnimationFrame(() => requestAnimationFrame(drawEdges));

  // Apply stored viewport transform, install pan/zoom, and auto-fit on first render per run.
  const hasSaved = !!(runId && executionTimelineGraphViewportByRunId[runId]);
  const st = _getGraphViewportState(runId);
  _applyGraphTransform(canvas, st);
  _installGraphInteractions({ runId, viewport, canvas });

  // Expose fit helper for toolbar button
  viewport._aetFit = () => {
    try {
      _fitGraphToView({ runId, viewport, canvas, grid: layer });
      drawEdges();
    } catch { /* ignore */ }
  };

  if (runId && !hasSaved) {
    requestAnimationFrame(() => {
      _fitGraphToView({ runId, viewport, canvas, grid: layer });
      drawEdges();
    });
  }

  // v1.8 interactions: drag + resize + live links
  try {
    let raf = 0;
    const scheduleEdges = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        drawEdges();
      });
    };

    const toContentPoint = (clientX, clientY) => {
      const rect = viewport.getBoundingClientRect();
      const v = _getGraphViewportState(runId);
      return {
        x: (clientX - rect.left - v.tx) / v.scale,
        y: (clientY - rect.top - v.ty) / v.scale
      };
    };

    const bindNode = (nodeEl) => {
      const nodeId = String(nodeEl.dataset.nodeId || '').trim();
      if (!nodeId) return;
      if (nodeEl._aetBound) return;
      nodeEl._aetBound = true;

      const header = nodeEl.querySelector('.execution-graph-node-header');
      const resizer = nodeEl.querySelector('.execution-graph-node-resizer');
      const layoutMap = _getNodeLayoutMapForRun(runId);

      // Drag on header (click toggles details if no movement)
      if (header) {
        let dragging = false;
        let moved = false;
        let start = { x: 0, y: 0 };
        let startLayout = { x: 0, y: 0, w: 0 };

        header.addEventListener('pointerdown', (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            moved = false;
            nodeEl.classList.add('dragging');
            header.setPointerCapture?.(e.pointerId);
            start = toContentPoint(e.clientX, e.clientY);
            const cur = layoutMap && layoutMap[nodeId] ? layoutMap[nodeId] : { x: nodeEl.offsetLeft, y: nodeEl.offsetTop, w: nodeEl.offsetWidth };
            startLayout = { x: Number(cur.x) || 0, y: Number(cur.y) || 0, w: Number(cur.w) || nodeEl.offsetWidth };
          } catch { /* ignore */ }
        });

        header.addEventListener('pointermove', (e) => {
          if (!dragging) return;
          try {
            e.preventDefault();
            e.stopPropagation();
            const pt = toContentPoint(e.clientX, e.clientY);
            const dx = pt.x - start.x;
            const dy = pt.y - start.y;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
            const nx = startLayout.x + dx;
            const ny = startLayout.y + dy;
            if (layoutMap) layoutMap[nodeId] = { x: nx, y: ny, w: startLayout.w };
            nodeEl.style.left = `${nx}px`;
            nodeEl.style.top = `${ny}px`;
            scheduleEdges();
          } catch { /* ignore */ }
        });

        header.addEventListener('pointerup', (e) => {
          if (!dragging) return;
          try {
            e.preventDefault();
            e.stopPropagation();
            dragging = false;
            nodeEl.classList.remove('dragging');
            header.releasePointerCapture?.(e.pointerId);
            if (!moved) {
              // v2.0: click-to-inspect (drawer). Shift+click keeps legacy inline expand.
              try {
                if (e && e.shiftKey) {
                  nodeEl.classList.toggle('open');
                  // Lazy-render details only when expanded.
                  try {
                    if (nodeEl.classList.contains('open')) {
                      const detailsEl = nodeEl.querySelector('[data-aet-details]');
                      const ready = detailsEl && detailsEl.getAttribute('data-aet-details-ready') === '1';
                      if (detailsEl && !ready) {
                        const n = nodeById.get(nodeId);
                        if (n) {
                          const payload = n && n.payload && typeof n.payload === 'object' ? n.payload : {};
                          const { title: _t, ...rest } = payload;
                          const j = _nodeJustificationText(n);
                          const showJ = !!(j && _shouldShowJustificationForNode(n));
                          const full = showJ ? { ...rest, justificationText: j } : rest;
                          detailsEl.textContent = JSON.stringify(full, null, 2);
                          detailsEl.setAttribute('data-aet-details-ready', '1');
                        }
                      }
                    }
                  } catch { /* ignore */ }
                  scheduleEdges();
                } else {
                  _openAetNodeDrawer({ sessionId: currentSessionId, runId, nodeId });
                }
              } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        });
        header.addEventListener('pointercancel', () => {
          try { dragging = false; nodeEl.classList.remove('dragging'); } catch { /* ignore */ }
        });
      }

      // Width resize
      if (resizer) {
        let resizing = false;
        let start = { x: 0, y: 0 };
        let startW = 0;
        resizer.addEventListener('pointerdown', (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
            resizing = true;
            resizer.setPointerCapture?.(e.pointerId);
            start = toContentPoint(e.clientX, e.clientY);
            startW = nodeEl.offsetWidth;
          } catch { /* ignore */ }
        });
        resizer.addEventListener('pointermove', (e) => {
          if (!resizing) return;
          try {
            e.preventDefault();
            e.stopPropagation();
            const pt = toContentPoint(e.clientX, e.clientY);
            const dw = pt.x - start.x;
            const w = Math.max(220, Math.min(1400, startW + dw));
            nodeEl.style.width = `${w}px`;
            if (layoutMap) {
              const cur = layoutMap[nodeId] || { x: nodeEl.offsetLeft, y: nodeEl.offsetTop, w };
              layoutMap[nodeId] = { x: Number(cur.x) || 0, y: Number(cur.y) || 0, w };
            }
            scheduleEdges();
          } catch { /* ignore */ }
        });
        resizer.addEventListener('pointerup', (e) => {
          if (!resizing) return;
          try {
            e.preventDefault();
            e.stopPropagation();
            resizing = false;
            resizer.releasePointerCapture?.(e.pointerId);
            scheduleEdges();
          } catch { /* ignore */ }
        });
        resizer.addEventListener('pointercancel', () => {
          try { resizing = false; } catch { /* ignore */ }
        });
      }
    };

    for (const el of Array.from(layer.querySelectorAll('.execution-graph-node'))) {
      bindNode(el);
    }
  } catch {
    // ignore
  }
}


function _renderExecutionTimelineFeed({ nodes }) {
  const { list, graph } = _getAetEls();
  if (!list) return;
  if (graph) graph.style.display = 'none';
  list.style.display = 'block';

  list.innerHTML = '';
  if (!nodes || nodes.length === 0) {
    list.innerHTML = '<div style="opacity:0.75; padding: 8px 2px;">No nodes recorded for this run yet.</div>';
    return;
  }

  for (const node of nodes.slice().sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))) {
    const div = document.createElement('div');
    const lvl = _nodeLevel(node);
    div.className = `execution-node ${lvl}`;
    try { div.dataset.nodeType = String(node?.type || ''); } catch { /* ignore */ }
    const title = _nodeTitle(node);
    const just = _nodeJustificationText(node);
    const showJust = !!(just && _shouldShowJustificationForNode(node));
    const meta = _nodeJustificationMeta(node);
    const risk = meta && typeof meta.risk === 'string' ? meta.risk.trim().toLowerCase() : '';
    const showRisk = (risk === 'low' || risk === 'med' || risk === 'high');
    const showMissing = _executionTimelineDevMode() && _shouldShowJustificationForNode(node) && !showJust;
    const when = _fmtAetTime(node && node.timestamp);
    const checkpointHash = _nodeCheckpointHash(node);
    const isCheckpoint = !!checkpointHash;
    const checkpointShort = isCheckpoint ? checkpointHash.slice(0, 7) : '';
    const ensureDetailsRendered = () => {
      try {
        const detailsEl = div.querySelector('[data-aet-details]');
        const ready = detailsEl && detailsEl.getAttribute('data-aet-details-ready') === '1';
        if (!detailsEl || ready) return;
        const payload = node && node.payload && typeof node.payload === 'object' ? node.payload : {};
        const { title: _t, ...rest } = payload;
        const full = showJust ? { ...rest, justificationText: just } : rest;
        detailsEl.textContent = JSON.stringify(full, null, 2);
        detailsEl.setAttribute('data-aet-details-ready', '1');
      } catch { /* ignore */ }
    };
    div.innerHTML = `
      <div class="execution-node-header">
        <div class="execution-node-left">
          <div class="execution-node-dot"></div>
          <div class="execution-node-text">
            <div class="execution-node-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            ${showJust ? `<div class="execution-node-why" title="${escapeHtml(just)}">${escapeHtml(just)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex: 0 0 auto;">
          ${showMissing ? `<span class="execution-node-missing-jp" title="Dev: missing justification">Missing JP</span>` : ''}
          ${showRisk ? `<span class="execution-node-risk risk-${escapeHtml(risk)}" title="Risk: ${escapeHtml(risk)}">${escapeHtml(risk)}</span>` : ''}
          ${isCheckpoint ? `<span class="execution-node-checkpoint" title="Restore checkpoint (turn baseline)">ckpt ${escapeHtml(checkpointShort)}</span>` : ''}
          <div class="execution-node-time">${escapeHtml(when)}</div>
        </div>
      </div>
      <div class="execution-node-details">
        ${isCheckpoint ? `
          <div class="execution-node-actions">
            <button class="btn-secondary execution-node-restore-btn" type="button" data-hash="${escapeHtml(checkpointHash)}" title="Restore workspace to this turn checkpoint">Restore</button>
          </div>
        ` : ''}
        <div class="execution-node-details-json" data-aet-details="1"></div>
      </div>
    `;
    div.querySelector('.execution-node-header')?.addEventListener('click', (e) => {
      try {
        // v2.0: clicking a node in Feed should jump to graph + open drawer.
        // Shift+click keeps legacy inline expand.
        if (e && e.shiftKey) {
          div.classList.toggle('open');
          if (div.classList.contains('open')) ensureDetailsRendered();
          return;
        }
        const sid = currentSessionId;
        const runs = Array.isArray(executionTimelineRunsBySession[sid]) ? executionTimelineRunsBySession[sid] : [];
        const rid = String(executionTimelineActiveRunBySession[sid] || (runs[runs.length - 1] && runs[runs.length - 1].id) || '').trim();
        const nid = String(node?.id || '').trim();
        if (sid && rid && nid) _openAetNodeDrawer({ sessionId: sid, runId: rid, nodeId: nid });
      } catch { /* ignore */ }
    });
    const restoreBtn = div.querySelector('.execution-node-restore-btn');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const h = String(restoreBtn.getAttribute('data-hash') || '').trim();
        if (!h) return;
        try {
          // Strong coupling: use the same restore logic as the chat restore button.
          // This rewinds chat history + Claude resume state to the checkpoint (when possible).
          const ok = await (async () => {
            try {
              await restoreToUserCheckpoint(h, null, null, null, false);
              return true;
            } catch {
              return await restoreToCheckpoint(h);
            }
          })();
          if (!ok) return;
          // Keep AET consistent: truncate the run at this checkpoint node and discard future runs.
          try {
            const sid = String(currentSessionId || '').trim();
            const rid = sid ? String(executionTimelineActiveRunBySession[sid] || '').trim() : '';
            const nid = String(node?.id || '').trim();
            const projectPath = window.currentFolder ? String(window.currentFolder) : '';
            if (
              sid && rid && nid && projectPath &&
              window.electronAPI &&
              typeof window.electronAPI.executionTimelineTruncateAfterNode === 'function'
            ) {
              await window.electronAPI.executionTimelineTruncateAfterNode(
                projectPath,
                sid,
                rid,
                nid,
                'Manual restore from execution timeline (feed)'
              );
            }
          } catch { /* ignore */ }
          try { if (currentSessionId) loadExecutionTimelineForSession(currentSessionId).catch(() => {}); } catch { /* ignore */ }
        } catch { /* ignore */ }
      });
    }
    list.appendChild(div);
  }
}

function renderExecutionTimelineForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  const { select, list, graph } = _getAetEls();
  if (!select) return;

  const runs = Array.isArray(executionTimelineRunsBySession[sid]) ? executionTimelineRunsBySession[sid] : [];
  select.innerHTML = '';
  const mode = _getAetViewMode(sid);
  try {
    const { editorRunSelect } = _getAetEls();
    if (editorRunSelect) editorRunSelect.innerHTML = '';
  } catch { /* ignore */ }

  if (runs.length === 0) {
    try { _renderAetRunSummary(null); } catch { /* ignore */ }
    try { _renderAetChangesPanel({ sessionId: sid, runId: '', nodes: [] }); } catch { /* ignore */ }
    try { _renderAetFilters({ sessionId: sid, shownCount: 0, totalCount: 0 }); } catch { /* ignore */ }
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No runs yet for this chat';
    select.appendChild(opt);
    try {
      const { editorRunSelect } = _getAetEls();
      if (editorRunSelect) {
        const opt2 = document.createElement('option');
        opt2.value = '';
        opt2.textContent = 'No runs yet for this chat';
        editorRunSelect.appendChild(opt2);
      }
    } catch { /* ignore */ }
    _syncAetViewToggleUI();
    if (mode === 'graph' || mode === 'map') {
      // IMPORTANT: ensure we do NOT show a previous session's graph.
      try { closeExecutionTimeline(); } catch { /* ignore */ }
      try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }
      try {
        const { editorGraphHost } = _getAetEls();
        if (editorGraphHost) {
          const canvasHost = document.getElementById('executionTimelineEditorCanvasHost');
          (canvasHost || editorGraphHost).innerHTML = '<div style="opacity:0.75; padding: 8px 2px;">No execution nodes yet for this chat session.</div>';
        }
      } catch { /* ignore */ }
      // Hide chat-panel graph/list (graph lives in editor in this mode).
      if (graph) graph.style.display = 'none';
      if (list) list.style.display = 'none';
    } else {
      // Feed mode: ensure editor overlay is closed and show empty feed.
      try { _closeExecutionTimelineInEditor(); } catch { /* ignore */ }
      if (graph) graph.style.display = 'none';
      if (list) {
        list.style.display = 'block';
        list.innerHTML = '<div style="opacity:0.75; padding: 8px 2px;">No execution nodes yet.</div>';
      }
    }
    return;
  }

  const sortedRuns = runs.slice().sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0));
  const isDiscarded = (r) => {
    try { return !!(r && r.meta && typeof r.meta === 'object' && r.meta.discarded === true); } catch { return false; }
  };
  const activeRuns = sortedRuns.filter(r => r && !isDiscarded(r));
  const discardedRuns = sortedRuns.filter(r => r && isDiscarded(r));

  const appendGroup = (sel, label, arr) => {
    try {
      if (!sel) return;
      const grp = document.createElement('optgroup');
      grp.label = label;
      for (const r of arr) {
        const opt = document.createElement('option');
        opt.value = String(r.id || '');
        const when = _fmtAetTime(r.startTime);
        const st = String(r.status || 'running');
        opt.textContent = `${when || 'Run'} · ${st}`;
        grp.appendChild(opt);
      }
      sel.appendChild(grp);
    } catch { /* ignore */ }
  };

  appendGroup(select, 'Runs', activeRuns);
  if (discardedRuns.length > 0) appendGroup(select, 'Discarded (from chat restore)', discardedRuns);
  try {
    const { editorRunSelect } = _getAetEls();
    if (editorRunSelect) {
      editorRunSelect.innerHTML = '';
      appendGroup(editorRunSelect, 'Runs', activeRuns);
      if (discardedRuns.length > 0) appendGroup(editorRunSelect, 'Discarded (from chat restore)', discardedRuns);
    }
  } catch { /* ignore */ }

  const defaultRun = activeRuns.length ? activeRuns[activeRuns.length - 1] : (sortedRuns.length ? sortedRuns[sortedRuns.length - 1] : null);
  const activeRunId = executionTimelineActiveRunBySession[sid] || String(defaultRun?.id || '');
  if (activeRunId) select.value = activeRunId;
  try {
    const { editorRunSelect } = _getAetEls();
    if (activeRunId && editorRunSelect) editorRunSelect.value = activeRunId;
  } catch { /* ignore */ }

  const run = runs.find(r => String(r.id || '') === String(activeRunId)) || defaultRun;
  const rawNodes = run && Array.isArray(run.nodes) ? run.nodes : [];
  const nodes = _aetNodesForDisplay({ runId: activeRunId, nodes: rawNodes });
  const filters = _getAetFiltersForSession(sid);
  const nodesView = _aetApplyNodeFilters(nodes, filters);
  try {
    _renderAetRunSummary(run, { shownNodesCount: nodesView.length, recordedNodesCount: rawNodes.length });
  } catch { /* ignore */ }
  try { _renderAetChangesPanel({ sessionId: sid, runId: String(activeRunId || ''), nodes }); } catch { /* ignore */ }
  try { _renderAetFilters({ sessionId: sid, shownCount: nodesView.length, totalCount: nodes.length }); } catch { /* ignore */ }

  _syncAetViewToggleUI();
  if (mode === 'map') {
    // Map mode: always render in the editor overlay host.
    try { closeExecutionTimeline(); } catch { /* ignore */ }
    try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }
    if (graph) graph.style.display = 'none';
    if (list) list.style.display = 'none';
    try {
      const rid = String(activeRunId || '').trim();
      window.CodeonAetMap?.renderForSession?.({ sessionId: sid, runId: rid });
    } catch { /* ignore */ }
  } else if (mode === 'graph') {
    _renderExecutionTimelineGraph({ nodes: nodesView });
    // Keep drawer in sync with the active run/node (best-effort).
    try {
      const rid = String(activeRunId || '').trim();
      const nid = rid ? String(executionTimelineSelectedNodeByRunId[rid] || '').trim() : '';
      const { nodeDrawer } = _getAetEls();
      if (nodeDrawer && nodeDrawer.style.display !== 'none' && rid && nid) {
        _renderAetNodeDrawer({ sessionId: sid, runId: rid, nodeId: nid });
      }
    } catch { /* ignore */ }
  } else {
    try { _closeExecutionTimelineInEditor(); } catch { /* ignore */ }
    _renderExecutionTimelineFeed({ nodes: nodesView });
  }
}


function updateSendButtonForCurrentSession() {
  const sendButton = document.getElementById('sendButton');
  if (!sendButton) return;
  const sendIcon = sendButton.querySelector('svg');
  const sid = currentSessionId;
  const running = sid ? isSessionProcessing(sid) : false;

  sendButton.disabled = false;
  if (running) {
    sendButton.classList.add('stop');
    sendButton.title = 'Stop (this chat session)';
    // Change icon to stop square
    sendIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect>';
  } else {
    sendButton.classList.remove('stop');
    sendButton.title = 'Send Message';
    // Change icon back to send arrow
    sendIcon.innerHTML = '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>';
  }

  // Removed: redundant AET Stop button (chat composer stop covers this).
}


function setProcessingState(isProcessing, sessionId = currentSessionId) {
  const sid = sessionId || currentSessionId;
  const st = getRunState(sid);
  if (!st) return;
  st.isProcessing = !!isProcessing;
  if (!st.isProcessing) {
    st.abortController = null;
    st.requestId = null;
    st.processCommitHash = null;
    // Clear the status banner when run completes
    if (sid === currentSessionId) {
      try { removeTypingIndicator(); } catch { /* ignore */ }
    }
  }
  if (sid === currentSessionId) {
    updateSendButtonForCurrentSession();
  }
  renderChatTabs();
}


async function stopProcessing(sessionId = currentSessionId) {
  const sid = sessionId || currentSessionId;
  const st = getRunState(sid);
  if (!st) return;

  // If the user explicitly stops a run, clear any persisted partial snapshot to avoid "stuck" partial messages.
  // (The user can re-run if needed; partial snapshots are mainly for app restarts/crashes.)
  clearAssistantPartialSnapshot(sid);

  if (st.abortController) {
    try { st.abortController.abort(); } catch { /* ignore */ }
    st.abortController = null;
  }

  // Cancel Claude SDK query if one is active
  if (st.requestId && window.electronAPI && typeof window.electronAPI.claudeSdkCancel === 'function') {
    try {
      await window.electronAPI.claudeSdkCancel(st.requestId);
    } catch (e) {
      console.warn('[ClaudeSDK] Cancel failed (non-fatal):', e);
    } finally {
      st.requestId = null;
    }
  }

  setProcessingState(false, sid);
  window.updateConsoleStatus?.('Process stopped by user', 'error');

  // Remove any typing indicators
  if (sid === currentSessionId) {
    const banner = document.getElementById('chatStatusBanner');
    if (banner) banner.style.display = 'none';
  }

  // Cancel any in-flight Learning/Docs generation tied to this session
  try { window._cancelLearningGeneration?.({ sessionId: sid, reason: 'Stopped by user' }); } catch { /* ignore */ }
  try { window._cancelDocsGeneration?.({ sessionId: sid, reason: 'Stopped by user' }); } catch { /* ignore */ }

}


async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();

  const sessionIdForRun = currentSessionId;
  if (!sessionIdForRun) return;

  // If this tab is already running, ignore (button should be in Stop mode).
  if (isSessionProcessing(sessionIdForRun)) return;

  // With real-workspace execution, we must avoid parallel Claude runs across tabs:
  // - it increases rate limiting dramatically
  // - it can interleave file edits in confusing ways
  try {
    const otherRunning = Object.keys(runStateBySession || {}).filter(sid => {
      if (!sid || sid === sessionIdForRun) return false;
      return !!(runStateBySession[sid] && runStateBySession[sid].isProcessing === true);
    });
    if (otherRunning.length > 0) {
      showToast('Another AI run is already in progress. Wait for it to finish, then try again.');
      return;
    }
  } catch { /* ignore */ }

  // Global rate-limit backoff gate.
  try {
    if (claudeGlobalBackoffUntilMs && Date.now() < claudeGlobalBackoffUntilMs) {
      const left = Math.max(1, Math.ceil((claudeGlobalBackoffUntilMs - Date.now()) / 1000));
      showToast(`Claude is rate limited. Please wait ~${left}s and retry.`);
      return;
    }
  } catch { /* ignore */ }

  // UX gate: if Claude.ai auth is selected but not ready, prompt immediately instead of failing later.
  try {
    if (isClaudeAiAuthMode()) {
      // Do NOT block Send on a slow login status check.
      // Only stop the user if we already *know* they aren't logged in.
      const cached = claudeAuthGateState && claudeAuthGateState.lastResult ? claudeAuthGateState.lastResult : null;
      if (cached && cached.status && cached.status !== 'logged_in') {
        openAuthGateModal({
          statusText: cached.status === 'error' ? `Login check failed: ${cached.message || 'Unknown error'}` : 'Sign in required',
          subtitleText: 'Click “Sign in with Claude.ai” to set up login, then try again.'
        });
        return;
      }
      // Otherwise, refresh status in the background (best-effort) without delaying Send.
      checkClaudeLoginStatusBestEffort({ projectOpen: false }).catch(() => {});
    }
  } catch { /* ignore */ }

  // Hard safety: do not start a new run while git has an in-progress operation (conflicts/recovery).
  try {
    const g = await getGitInProgressState();
    if (g && g.inProgress === true) {
      addSystemMessage(`⚠️ Git ${g.op} is in progress. Resolve/abort it before starting a new run.`);
      addGitOpRecoveryMessage(sessionIdForRun, { op: g.op, conflictFiles: g.conflictFiles || [], note: 'Resolve conflicts, then Continue or Abort.' });
      await customAlert(`Git ${g.op} is in progress.\n\nResolve conflicts then press Continue (or Abort) in the recovery card before starting a new AI run.`, 'Git Operation In Progress');
      return;
    }
  } catch { /* ignore */ }

  // Clear any stale persisted partial snapshot (and any DOM it rendered) before starting a fresh run.
  // Partial snapshots are for crash recovery; during an active run they can cause duplicate diff rendering.
  clearAssistantPartialSnapshot(sessionIdForRun);

  // Hard safety: never append to stale chatHistory (prevents cross-session surprises).
  if (hydratedChatSessionId !== sessionIdForRun) {
    console.warn('[Chat History] sendMessage detected non-hydrated state; re-switching to hydrate.');
    await switchToSession(sessionIdForRun);
  }

  const pendingAttachments = getPendingAttachments(sessionIdForRun);
  if (!message && pendingAttachments.length === 0) return;

  // Hide suggestions as we are committing to send.
  try {
    const wrap = document.getElementById('skillSuggestions');
    if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
  } catch { /* ignore */ }

  // Pending skill (Claude Code semantics: explicit invocation via "/<skill-name>" for this message only)
  const skillIdForRun = getPendingSkillId(sessionIdForRun);
  const skillObjForRun = skillIdForRun ? getPendingSkill(sessionIdForRun) : null;
  const skillsMetaForRun = skillObjForRun ? [{ id: String(skillObjForRun.id || ''), name: String(skillObjForRun.name || '') }] : [];

  // If a skill is selected, invoke it appropriately:
  // - For PROJECT skills: use "/<skill-name> ..." slash command syntax
  // - For USER skills: prepend "use {skill name}" directive (slash commands only work for project skills)
  const skillPrefixResult = (() => {
    try {
      if (!skillIdForRun) return { prefix: '', useDirectInjection: false };
      
      console.log('[Skills] sendMessage: skillIdForRun =', skillIdForRun);
      console.log('[Skills] sendMessage: isProjectSkillId exists =', typeof isProjectSkillId === 'function');
      console.log('[Skills] sendMessage: isUserSkillId exists =', typeof isUserSkillId === 'function');
      
      // Check if it's a project skill (supports slash commands)
      if (typeof isProjectSkillId === 'function' && isProjectSkillId(skillIdForRun)) {
        console.log('[Skills] sendMessage: Detected PROJECT skill, using slash command');
        if (typeof skillIdToProjectSkillDir !== 'function') return { prefix: '', useDirectInjection: false };
      const dir = String(skillIdToProjectSkillDir(skillIdForRun) || '').trim();
      const cmdName = dir.split('/').filter(Boolean).pop() || '';
        return { prefix: cmdName ? `/${cmdName} ` : '', useDirectInjection: false };
      }
      
      // User skill: need direct injection, no slash prefix
      if (typeof isUserSkillId === 'function' && isUserSkillId(skillIdForRun)) {
        console.log('[Skills] sendMessage: Detected USER skill, using direct injection');
        return { prefix: '', useDirectInjection: true };
      }
      
      console.log('[Skills] sendMessage: Skill type not detected, no prefix');
      return { prefix: '', useDirectInjection: false };
    } catch (e) {
      console.error('[Skills] sendMessage: Error in skillPrefixResult', e);
      return { prefix: '', useDirectInjection: false };
    }
  })();
  const skillPrefix = skillPrefixResult.prefix;
  const useSkillDirectInjection = skillPrefixResult.useDirectInjection;
  const attachmentContextPrefix = (typeof buildComposerInlineAttachmentSummary === 'function')
    ? buildComposerInlineAttachmentSummary(pendingAttachments)
    : '';
  
  const messageForUserBubble = (() => {
    const base = String(message || '').trim() || 'See attached files';
    if (base.startsWith('/')) return base;
    // For user skills, show "use {skill name} skill" prefix in bubble
    if (useSkillDirectInjection && skillObjForRun) {
      return `use ${skillObjForRun.name || 'Skill'} skill\n\n${base}`;
    }
    if (!skillPrefix) return base;
    return `${skillPrefix}${base}`;
  })();
  const messageForRun = (() => {
    const base = String(message || '').trim() || 'Please analyze the attached files';
    if (base.startsWith('/')) return base;
    const baseWithContext = attachmentContextPrefix ? `${attachmentContextPrefix}\n\n${base}` : base;
    // For user skills, inject "use {skill name}" directive
    if (useSkillDirectInjection && typeof applySkillByIdToPrompt === 'function') {
      return applySkillByIdToPrompt(skillIdForRun, baseWithContext);
    }
    if (!skillPrefix) return baseWithContext;
    return `${skillPrefix}${baseWithContext}`;
  })();

  const hasApiKey = typeof settings.apiKey === 'string' && settings.apiKey.trim().length > 0;
  normalizeClaudeAuthMode();
  const authMode = settings.authMode; // 'claude_ai' | 'api_key'
  const isAuthCommand = /^\/(login|status|logout)\b/i.test(message);

  // If the user is trying to login/logout/check status, allow the request even if
  // they previously selected API-key mode but haven't provided a key.
  if (!isAuthCommand && authMode === 'api_key' && !hasApiKey) {
    await customAlert(
      'Please configure your Anthropic API key in Settings (or switch authentication to Claude.ai).',
      'Claude Authentication'
    );
    openSettings();
    return;
  }

  // /login is handled via browser OAuth flow.
  if (/^\/login\b/i.test(message) && window.electronAPI && typeof window.electronAPI.openClaudeSetupTokenTerminal === 'function') {
    // Show auth gate modal which polls for login success and auto-dismisses.
    openAuthGateModal({
      statusText: 'Opening Terminal…',
      subtitleText: 'Complete the Claude Code "setup-token" flow in Terminal, then come back to Codeon.'
    });
    try {
      const res = await window.electronAPI.openClaudeSetupTokenTerminal();
      if (!res || res.success !== true) {
        openAuthGateModal({
          statusText: `Failed to sign in: ${res?.error || 'Unknown error'}`,
          subtitleText: 'Try again, or use an API key instead.'
        });
      } else {
        // OAuth flow completed successfully
        settings.authMode = 'claude_ai';
        await saveSettings();
        applyClaudeAuthSettingsUI({ refreshStatus: true });
        openAuthGateModal({
          statusText: 'Terminal opened. Waiting for sign-in…',
          subtitleText: 'Finish the setup-token flow in Terminal. This popup will close automatically once you are signed in.'
        });
      }
    } catch (e) {
      openAuthGateModal({
        statusText: `Failed to sign in: ${e?.message || String(e)}`,
        subtitleText: 'Try again, or use an API key instead.'
      });
    }
    // Don't send /login to Claude SDK.
    input.value = '';
    input.style.height = 'auto';
    return;
  }

  // Clear pending skill now that we are definitely sending (so it behaves as "next message only").
  if (skillIdForRun) {
    clearPendingSkillForSession(sessionIdForRun);
  }

  // Flip to Stop immediately once we're committed to send (avoid delayed UI).
  const st = getRunState(sessionIdForRun);
  if (st) st.processCommitHash = null;
  setProcessingState(true, sessionIdForRun);
  const abortController = new AbortController();
  if (st) st.abortController = abortController;

  window.addConsoleMessage?.('Sending message to Claude…', 'processing', sessionIdForRun);

  try { if (st) st.pendingUserSeq = null; } catch { /* ignore */ }
  resetStreamBuffer(sessionIdForRun);

  // Prepare message with attachments
  const attachments = [...pendingAttachments]; // Copy before clearing
  clearAttachments(sessionIdForRun);

  // Add user message immediately (perceived latency improvement).
  // We'll create the restore checkpoint async right after, then patch in the restoreHash.
  addMessage('user', messageForUserBubble, null, null, true, attachments, skillsMetaForRun);
  // Clear textarea immediately (do not wait for git checkpointing / restore hash patching).
  try {
    input.value = '';
    input.style.height = 'auto';
  } catch { /* ignore */ }
  let userMsgRef = null;
  try {
    const timeline = ensureSessionMessages(sessionIdForRun);
    for (let i = timeline.length - 1; i >= 0; i--) {
      const m = timeline[i];
      if (m && m.role === 'user') { userMsgRef = m; break; }
    }
    const st2 = getRunState(sessionIdForRun);
    if (st2 && userMsgRef && typeof userMsgRef.seq === 'number') st2.pendingUserSeq = userMsgRef.seq;
  } catch { /* ignore */ }

  // Persist the user's message immediately so it appears without delay and survives restarts.
  try { await saveChatHistory(true); } catch { /* ignore */ }

  // Create a restore checkpoint for this user message (so every user message has Restore & Retry).
  // Do this BEFORE we start the run (but AFTER we render the message to reduce perceived send latency).
  let restoreHash = null;
  try {
    await withGitOperationLock(async () => {
      await ensureGitInitializedIfNeeded();
      const g = await getGitInProgressState();
      if (g && g.inProgress === true) {
        throw new Error(`Git ${g.op} is in progress; resolve it before sending a new message.`);
      }
      const ck = await maybeCommitAICheckpoint('Before user message');
      restoreHash = ck || (await getLastCommitHash());
    });
  } catch (e) {
    // Non-fatal UX: allow the run to continue, but the Restore button won't be available for this turn.
    window.addConsoleMessage?.(`Restore checkpoint unavailable: ${e?.message || String(e)}`, 'error', sessionIdForRun);
    addSystemMessage(`⚠️ Restore checkpoint unavailable for this turn.\n\n${e?.message || String(e)}`, true, { sessionId: sessionIdForRun });
    restoreHash = null;
  }

  // Store the checkpoint hash for this turn/run so backend instrumentation (AET) can link it.
  try {
    if (st) st.processCommitHash = restoreHash;
  } catch { /* ignore */ }

  // Patch commitHash into the last user message + attach restore button (if possible).
  if (restoreHash && userMsgRef) {
    try { userMsgRef.commitHash = restoreHash; } catch { /* ignore */ }
    try { await saveChatHistory(true); } catch { /* ignore */ }
    try {
      const messagesContainer = document.getElementById('chatMessages');
      const userEls = messagesContainer ? Array.from(messagesContainer.querySelectorAll('.message.user')) : [];
      const lastEl = userEls.length ? userEls[userEls.length - 1] : null;
      if (lastEl && !lastEl.querySelector('.restore-btn.restore-btn--float')) {
        try { lastEl.dataset.commitHash = String(restoreHash || '').trim(); } catch { /* ignore */ }
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'restore-btn restore-btn--icon restore-btn--float';
        restoreBtn.title = 'Restore to this checkpoint';
        restoreBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
            <path d="M3 3v5h5"></path>
          </svg>
        `;
        restoreBtn.onclick = () => restoreToUserCheckpoint(restoreHash, lastEl, messageForUserBubble, attachments);
        lastEl.appendChild(restoreBtn);
      }
    } catch { /* ignore */ }
  }

  // If the user stopped during prep/checkpointing, don't start the run.
  if (abortController.signal.aborted) return;

  // Show typing indicator
  const typingId = showTypingIndicator(sessionIdForRun);

  try {
    // Get AI response (pass attachments for API call)
    // Pass the signal to getAIResponse
    let nextOpts = null;
    try {
      if (window._nextRunOptionsBySession && typeof window._nextRunOptionsBySession === 'object') {
        nextOpts = window._nextRunOptionsBySession[sessionIdForRun] || null;
        if (nextOpts) delete window._nextRunOptionsBySession[sessionIdForRun];
      }
    } catch { /* ignore */ }
    const runOpts = { skillId: skillIdForRun, ...(nextOpts && typeof nextOpts === 'object' ? nextOpts : {}) };
    await getAIResponse(messageForRun, attachments, abortController.signal, sessionIdForRun, runOpts);

    // Remove typing indicator
    if (typingId) removeTypingIndicator(typingId);

    // Assistant message is added/streamed by getAIResponse -> makeAgentCall

  } catch (error) {
    if (typingId) removeTypingIndicator(typingId);
    if (error.name === 'AbortError') {
      // Handled in stopProcessing
    } else if (error && error._uiShown === true) {
      // Error already surfaced by Claude event handlers
    } else {
      addMessage('assistant', `Error: ${error.message}`);
    }
  } finally {
    // Only reset if we finished normally (not aborted via Stop button which handles its own reset)
    if (abortController && !abortController.signal.aborted) {
      setProcessingState(false, sessionIdForRun);
    }
  }
}

// Expose sendMessage globally for queue processing
window.triggerSendMessage = sendMessage;

// Expose stopProcessing globally for queue "send now" feature
window.stopCurrentRun = async function(sessionId = currentSessionId) {
  const sid = String(sessionId || currentSessionId || '').trim();
  if (!sid) return;
  if (typeof isSessionProcessing === 'function' && !isSessionProcessing(sid)) return;
  // Use the same stop function as the composer Stop button.
  await stopProcessing(sid);
};
