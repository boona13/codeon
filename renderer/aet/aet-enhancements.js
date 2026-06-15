// Codeon AET Enhancements
// - Playback controls (Graph view): prev/next/play/scrub
// - Export run bundle: writes a bounded JSON under .ai-agent/exports/
//
// IMPORTANT:
// - Keep this file self-contained and avoid adding large code to renderer/app.js.
// - This file is loaded AFTER renderer/app.js so it can call existing AET functions.

/* global
  executionTimelineActiveRunBySession,
  executionTimelineRunsBySession,
  executionTimelineSelectedNodeByRunId,
  _aetNodesForDisplay,
  _getAetFiltersForSession,
  _aetApplyNodeFilters,
  _getAetViewMode,
  showToast
*/

(function () {
  const $ = (id) => document.getElementById(id);

  const PLAY_MS = 850;
  const playbackState = {
    playing: false,
    timer: null,
    // runId -> index
    indexByRunId: Object.create(null),
    lastRunId: '',
    highlightedNodeIdByRunId: Object.create(null)
  };

  function _safeInt(n, fallback = 0) {
    const x = Number(n);
    return Number.isFinite(x) ? Math.trunc(x) : fallback;
  }

  function _clamp(n, lo, hi) {
    const x = _safeInt(n, lo);
    return Math.max(lo, Math.min(hi, x));
  }

  function _fmtUsd(n) {
    try {
      const v = Number(n);
      if (!Number.isFinite(v)) return '';
      return `$${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
    } catch {
      return '';
    }
  }

  function _getActiveAetRun() {
    try {
      const sid = String(window.currentSessionId || '').trim();
      if (!sid) return null;
      const rid = (typeof executionTimelineActiveRunBySession === 'object' && executionTimelineActiveRunBySession)
        ? String(executionTimelineActiveRunBySession[sid] || '').trim()
        : '';
      if (!rid) return null;
      const runs = (typeof executionTimelineRunsBySession === 'object' && executionTimelineRunsBySession && Array.isArray(executionTimelineRunsBySession[sid]))
        ? executionTimelineRunsBySession[sid]
        : [];
      const run = runs.find(r => String(r?.id || '') === rid) || null;
      if (!run) return null;

      const rawNodes = Array.isArray(run.nodes) ? run.nodes : [];
      const nodesDisplay =
        (typeof _aetNodesForDisplay === 'function')
          ? _aetNodesForDisplay({ runId: rid, nodes: rawNodes })
          : rawNodes.slice();
      const filters = (typeof _getAetFiltersForSession === 'function') ? _getAetFiltersForSession(sid) : { q: '', qScope: 'all', type: 'all', risk: 'all' };
      const nodesView = (typeof _aetApplyNodeFilters === 'function') ? _aetApplyNodeFilters(nodesDisplay, filters) : nodesDisplay;
      const sorted = nodesView.slice().sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));

      return { sid, rid, run, rawNodes, nodesDisplay, nodesView: sorted, filters };
    } catch {
      return null;
    }
  }

  function _stopPlayback() {
    playbackState.playing = false;
    try { if (playbackState.timer) clearInterval(playbackState.timer); } catch { /* ignore */ }
    playbackState.timer = null;
    const playBtn = $('executionTimelinePlaybackPlayBtn');
    if (playBtn) {
      playBtn.title = 'Play';
      playBtn.setAttribute('aria-label', 'Play');
      playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M8 5v14l11-7z"></path>
        </svg>
      `.trim();
    }
  }

  function _highlightGraphNode(runId, nodeId) {
    try {
      const rid = String(runId || '').trim();
      const nid = String(nodeId || '').trim();
      if (!rid) return;

      const prev = String(playbackState.highlightedNodeIdByRunId[rid] || '').trim();
      if (prev && prev !== nid) {
        try {
          const prevEl = document.querySelector(`.execution-graph-node[data-node-id="${CSS.escape(prev)}"]`);
          prevEl?.classList?.remove?.('playback-highlight');
        } catch { /* ignore */ }
      }

      playbackState.highlightedNodeIdByRunId[rid] = nid;
      if (!nid) return;

      const el = document.querySelector(`.execution-graph-node[data-node-id="${CSS.escape(nid)}"]`);
      if (!el) return;
      el.classList.add('playback-highlight');
      // Keep it in view (best-effort)
      try { el.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    } catch {
      // ignore
    }
  }

  function _selectPlaybackIndex(idx) {
    const active = _getActiveAetRun();
    if (!active) return;
    const { rid, nodesView } = active;
    if (!nodesView.length) return;

    const max = Math.max(0, nodesView.length - 1);
    const next = _clamp(idx, 0, max);
    playbackState.indexByRunId[rid] = next;

    const scrub = $('executionTimelinePlaybackScrub');
    if (scrub) scrub.value = String(next);
    const label = $('executionTimelinePlaybackLabel');
    if (label) label.textContent = `${next + 1}/${nodesView.length}`;

    const node = nodesView[next];
    const nid = String(node?.id || '').trim();
    if (!nid) return;

    // Keep graph selection in sync.
    try {
      if (typeof executionTimelineSelectedNodeByRunId === 'object' && executionTimelineSelectedNodeByRunId) {
        executionTimelineSelectedNodeByRunId[rid] = nid;
      }
    } catch { /* ignore */ }

    // Playback should highlight only (no drawer open).
    _highlightGraphNode(rid, nid);
  }

  function _refreshPlaybackControls() {
    const active = _getActiveAetRun();
    const controls = $('executionTimelinePlaybackControls');
    const exportBtn = $('executionTimelineExportBtn');
    const exportBtn2 = $('executionTimelineEditorExportBtn');

    if (!active) {
      _stopPlayback();
      if (controls) controls.style.display = 'none';
      if (exportBtn) exportBtn.style.display = 'none';
      if (exportBtn2) exportBtn2.disabled = true;
      return;
    }

    const { sid, rid, run, nodesView } = active;
    const mode = (typeof _getAetViewMode === 'function') ? _getAetViewMode(sid) : 'feed';
    const inGraph = mode === 'graph';

    // Export button: show when a run is selected.
    if (exportBtn) exportBtn.style.display = '';
    if (exportBtn2) exportBtn2.disabled = false;

    // Playback: only in graph view and only when there are nodes.
    if (!inGraph || nodesView.length === 0) {
      _stopPlayback();
      if (controls) controls.style.display = 'none';
      return;
    }

    if (controls) controls.style.display = '';

    // Initialize index when switching runs (best-effort: map from currently selected node).
    if (playbackState.lastRunId !== rid) {
      playbackState.lastRunId = rid;
      _stopPlayback();

      let idx = 0;
      try {
        const selected = (typeof executionTimelineSelectedNodeByRunId === 'object' && executionTimelineSelectedNodeByRunId)
          ? String(executionTimelineSelectedNodeByRunId[rid] || '').trim()
          : '';
        if (selected) {
          const found = nodesView.findIndex(n => String(n?.id || '') === selected);
          if (found >= 0) idx = found;
        }
      } catch { /* ignore */ }
      playbackState.indexByRunId[rid] = idx;
    }

    const scrub = $('executionTimelinePlaybackScrub');
    if (scrub) {
      scrub.min = '0';
      scrub.max = String(Math.max(0, nodesView.length - 1));
      scrub.step = '1';
      scrub.value = String(_clamp(playbackState.indexByRunId[rid] ?? 0, 0, Math.max(0, nodesView.length - 1)));
    }
    const label = $('executionTimelinePlaybackLabel');
    const curIdx = _clamp(playbackState.indexByRunId[rid] ?? 0, 0, Math.max(0, nodesView.length - 1));
    if (label) label.textContent = `${curIdx + 1}/${nodesView.length}`;

    // Keep play enabled only when node count allows it.
    const prevBtn = $('executionTimelinePlaybackPrevBtn');
    const nextBtn = $('executionTimelinePlaybackNextBtn');
    const playBtn = $('executionTimelinePlaybackPlayBtn');
    if (prevBtn) prevBtn.disabled = curIdx <= 0;
    if (nextBtn) nextBtn.disabled = curIdx >= (nodesView.length - 1);
    if (playBtn) playBtn.disabled = nodesView.length <= 1;

    // Show cost hint in export tooltips (helpful, but no UI changes beyond existing).
    try {
      const meta = run && run.meta && typeof run.meta === 'object' ? run.meta : null;
      const cost = meta && typeof meta.totalCostUsd === 'number' ? _fmtUsd(meta.totalCostUsd) : '';
      if (exportBtn2 && cost) exportBtn2.title = `Export this run (AET bundle) — cost ${cost}`;
    } catch { /* ignore */ }
  }

  function _bindPlaybackOnce() {
    if (window.__codeonAetPlaybackBound) return;
    window.__codeonAetPlaybackBound = true;

    const prevBtn = $('executionTimelinePlaybackPrevBtn');
    const nextBtn = $('executionTimelinePlaybackNextBtn');
    const playBtn = $('executionTimelinePlaybackPlayBtn');
    const scrub = $('executionTimelinePlaybackScrub');

    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _stopPlayback();
        const active = _getActiveAetRun();
        if (!active) return;
        const { rid } = active;
        const cur = _safeInt(playbackState.indexByRunId[rid] ?? 0, 0);
        _selectPlaybackIndex(cur - 1);
        _refreshPlaybackControls();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _stopPlayback();
        const active = _getActiveAetRun();
        if (!active) return;
        const { rid } = active;
        const cur = _safeInt(playbackState.indexByRunId[rid] ?? 0, 0);
        _selectPlaybackIndex(cur + 1);
        _refreshPlaybackControls();
      });
    }
    if (scrub) {
      scrub.addEventListener('input', (e) => {
        try {
          e.preventDefault();
          const active = _getActiveAetRun();
          if (!active) return;
          const { rid } = active;
          const v = _safeInt(scrub.value, 0);
          playbackState.indexByRunId[rid] = v;
          _selectPlaybackIndex(v, { openDrawer: true });
          _refreshPlaybackControls();
        } catch { /* ignore */ }
      });
    }
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const active = _getActiveAetRun();
        if (!active) return;
        const { rid, nodesView } = active;
        if (!nodesView || nodesView.length <= 1) return;

        if (playbackState.playing) {
          _stopPlayback();
          _refreshPlaybackControls();
          return;
        }

        playbackState.playing = true;
        playBtn.title = 'Pause';
        playBtn.setAttribute('aria-label', 'Pause');
        playBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="7" y="5" width="3" height="14" rx="1"></rect>
            <rect x="14" y="5" width="3" height="14" rx="1"></rect>
          </svg>
        `.trim();
        playbackState.timer = setInterval(() => {
          try {
            const active2 = _getActiveAetRun();
            if (!active2 || active2.rid !== rid) {
              _stopPlayback();
              _refreshPlaybackControls();
              return;
            }
            const max = Math.max(0, active2.nodesView.length - 1);
            const cur = _safeInt(playbackState.indexByRunId[rid] ?? 0, 0);
            if (cur >= max) {
              // When playback finishes, jump back to the start (index 0) and stop.
              _stopPlayback();
              _selectPlaybackIndex(0);
              _refreshPlaybackControls();
              return;
            }
            _selectPlaybackIndex(cur + 1, { openDrawer: true });
            _refreshPlaybackControls();
          } catch {
            _stopPlayback();
          }
        }, PLAY_MS);
      });
    }
  }

  function _trimString(s, maxLen) {
    const str = typeof s === 'string' ? s : String(s ?? '');
    if (!str) return '';
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '…';
  }

  function _bundleSanitizeNode(node) {
    try {
      if (!node || typeof node !== 'object') return node;
      const out = JSON.parse(JSON.stringify(node));
      // Bound the heavy fields.
      try {
        if (out && out.payload && typeof out.payload === 'object') {
          if (typeof out.payload.diffContent === 'string') out.payload.diffContent = _trimString(out.payload.diffContent, 12_000);
          if (typeof out.payload.preview === 'string') out.payload.preview = _trimString(out.payload.preview, 1_400);
          if (typeof out.payload.inputPreview === 'string') out.payload.inputPreview = _trimString(out.payload.inputPreview, 1_400);
          if (typeof out.payload.error === 'string') out.payload.error = _trimString(out.payload.error, 7_000);
        }
      } catch { /* ignore */ }
      return out;
    } catch {
      return node;
    }
  }

  async function _exportActiveRunBundle({ source = 'aet' } = {}) {
    const active = _getActiveAetRun();
    if (!active) {
      try { if (typeof showToast === 'function') showToast('No run to export'); } catch { /* ignore */ }
      return;
    }
    if (!window.currentFolder || !window.electronAPI) return;

    const { sid, rid, run, rawNodes, nodesDisplay, nodesView, filters } = active;
    const now = Date.now();

    const bundle = {
      v: 1,
      kind: 'codeon_aet_run_bundle',
      exportedAt: now,
      source,
      projectPath: String(window.currentFolder || ''),
      uiSessionId: sid,
      runId: rid,
      run: (() => {
        try {
          const base = JSON.parse(JSON.stringify(run));
          // Ensure we store sanitized nodes only.
          if (Array.isArray(base.nodes)) base.nodes = base.nodes.map(_bundleSanitizeNode);
          return base;
        } catch {
          return run;
        }
      })(),
      view: {
        mode: (typeof _getAetViewMode === 'function') ? _getAetViewMode(sid) : 'feed',
        filters
      },
      counts: {
        nodesRecorded: Array.isArray(rawNodes) ? rawNodes.length : 0,
        nodesDisplay: Array.isArray(nodesDisplay) ? nodesDisplay.length : 0,
        nodesShown: Array.isArray(nodesView) ? nodesView.length : 0
      }
    };

    const dir = '.ai-agent/exports';
    const safeRid = rid ? rid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) : 'run';
    const outRel = `${dir}/aet-run-${safeRid}-${now}.json`;
    try { await window.electronAPI.createDirectory(dir); } catch { /* ignore */ }
    const res = await window.electronAPI.writeFile(outRel, JSON.stringify(bundle, null, 2), false);
    if (!res || res.success !== true) {
      try { if (typeof showToast === 'function') showToast(res?.error || 'Export failed'); } catch { /* ignore */ }
      return;
    }
    try { if (typeof showToast === 'function') showToast(`Exported AET run bundle: ${outRel}`, 3500); } catch { /* ignore */ }
    try {
      if (typeof window.electronAPI.revealInFinder === 'function') {
        const abs = `${String(window.currentFolder).replace(/\\/g, '/')}/${outRel}`.replace(/\/{2,}/g, '/');
        await window.electronAPI.revealInFinder(abs);
      }
    } catch { /* ignore */ }
  }

  function _bindExportOnce() {
    if (window.__codeonAetExportBound) return;
    window.__codeonAetExportBound = true;
    const b1 = $('executionTimelineExportBtn');
    const b2 = $('executionTimelineEditorExportBtn');
    if (b1) {
      b1.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await _exportActiveRunBundle({ source: 'aet_panel' });
      });
    }
    if (b2) {
      b2.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await _exportActiveRunBundle({ source: 'aet_editor' });
      });
    }
  }

  function _bindEditorCanvasControlsHoverCollapseOnce() {
    if (window.__codeonAetCanvasControlsHoverBound) return;
    window.__codeonAetCanvasControlsHoverBound = true;

    const controls = $('executionTimelineEditorCanvasControls');
    if (!controls) return;

    // Track last input type so clicks don't "pin" expanded state via focus.
    let lastInput = 'pointer'; // 'pointer' | 'keyboard'
    const setKeyboard = () => { lastInput = 'keyboard'; };
    const setPointer = () => { lastInput = 'pointer'; };

    document.addEventListener('keydown', setKeyboard, true);
    document.addEventListener('pointerdown', setPointer, true);
    document.addEventListener('mousedown', setPointer, true);
    document.addEventListener('touchstart', setPointer, true);

    // Only keep expanded when focus came from keyboard navigation.
    controls.addEventListener('focusin', () => {
      try {
        if (lastInput === 'keyboard') controls.classList.add('kbd-focus');
      } catch { /* ignore */ }
    }, true);
    controls.addEventListener('focusout', () => {
      // Defer so activeElement updates first.
      setTimeout(() => {
        try {
          if (!controls.contains(document.activeElement)) controls.classList.remove('kbd-focus');
        } catch { /* ignore */ }
      }, 0);
    }, true);

    // Any pointer interaction should not keep the toolbar expanded after hover ends.
    controls.addEventListener('pointerdown', () => {
      try { controls.classList.remove('kbd-focus'); } catch { /* ignore */ }
    }, true);

    // Key fix: if user clicked a control, then moves mouse away, blur so it collapses.
    controls.addEventListener('mouseleave', () => {
      try {
        if (lastInput !== 'keyboard') {
          const ae = document.activeElement;
          if (ae && controls.contains(ae) && typeof ae.blur === 'function') ae.blur();
        }
        controls.classList.remove('kbd-focus');
      } catch { /* ignore */ }
    });
  }

  function init() {
    _bindPlaybackOnce();
    _bindExportOnce();
    _bindEditorCanvasControlsHoverCollapseOnce();
    bindMetaCollapseOnce();
    _refreshPlaybackControls();
    // Keep it resilient to tab switches / mode toggles.
    setInterval(() => {
      try { _refreshPlaybackControls(); } catch { /* ignore */ }
    }, 1200);
  }

  function setMetaCollapsed(kind, collapsed) {
    try {
      const on = collapsed === true;
      if (kind === 'editor') {
        const overlay = $('executionTimelineEditorOverlay');
        if (overlay) overlay.classList.toggle('meta-collapsed', on);
        const btn = $('executionTimelineEditorMetaToggleBtn');
        if (btn) {
          btn.title = on ? 'Expand details' : 'Collapse details';
          btn.setAttribute('aria-label', on ? 'Expand timeline details' : 'Collapse timeline details');
        }
      }
      if (kind === 'panel') {
        const panel = $('executionTimelinePanel');
        if (panel) panel.classList.toggle('meta-collapsed', on);
        const btn = $('executionTimelineMetaToggleBtn');
        if (btn) {
          btn.title = on ? 'Expand details' : 'Collapse details';
          btn.setAttribute('aria-label', on ? 'Expand timeline details' : 'Collapse timeline details');
        }
      }
    } catch { /* ignore */ }
  }

  function bindMetaCollapseOnce() {
    if (window.__codeonAetMetaCollapseBound) return;
    window.__codeonAetMetaCollapseBound = true;

    // Default: expanded
    setMetaCollapsed('editor', false);
    setMetaCollapsed('panel', false);

    const editorBtn = $('executionTimelineEditorMetaToggleBtn');
    if (editorBtn) {
      editorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const overlay = $('executionTimelineEditorOverlay');
        const on = !!(overlay && overlay.classList.contains('meta-collapsed'));
        setMetaCollapsed('editor', !on);
        try {
          // Avoid stale layouts when toggling height above the graph.
          const host = $('executionTimelineEditorGraphHost');
          const viewport = host ? host.querySelector('.execution-graph-viewport') : null;
          if (viewport && typeof viewport._aetFit === 'function' && !on) {
            // If expanding, do a soft-fit.
            viewport._aetFit();
          }
        } catch { /* ignore */ }
      });
    }

    const panelBtn = $('executionTimelineMetaToggleBtn');
    if (panelBtn) {
      panelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const panel = $('executionTimelinePanel');
        const on = !!(panel && panel.classList.contains('meta-collapsed'));
        setMetaCollapsed('panel', !on);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


