// ---- GENERATED: runtime statements extracted from aet/map/map-view.js ----
(function () {
  const $ = (id) => document.getElementById(id);

  const stateByRunId = new Map(); // runId -> state
  const dragState = { dragging: false, lastX: 0, lastY: 0, dragCanvas: null };
  let windowInputBound = false;
  let windowResizeBound = false;

  const mounted = {
    host: null,
    root: null,
    canvas: null,
    ctx: null,
    hud: null,
    hintEl: null,
    tooltipEl: null,
    side: null,
    sideBody: null,
    sideTitle: null,
    closeBtn: null,
    pinBtn: null,
    pinboardEl: null,
    pinboardList: null,
    pinboardCloseBtn: null,
    resizeObs: null
  };

  function _now() { return Date.now(); }

  function _safeStr(s, max = 200) {
    try {
      const v = String(s || '');
      if (!v) return '';
      return v.length > max ? v.slice(0, max) + '…' : v;
    } catch {
      return '';
    }
  }

  function _escapeHtml(str) {
    const s = String(str ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _clipText(str, max = 900) {
    const s = String(str ?? '');
    if (!s) return { text: '', clipped: false };
    if (s.length <= max) return { text: s, clipped: false };
    return { text: s.slice(0, max) + '…', clipped: true };
  }

  function _findToolReceipt(sessionId, toolUseId) {
    try {
      const sid = String(sessionId || '').trim();
      const tid = String(toolUseId || '').trim();
      if (!sid || !tid) return null;
      const msgs = (typeof ensureSessionMessages === 'function') ? ensureSessionMessages(sid) : [];
      const list = Array.isArray(msgs) ? msgs : [];
      return list.find(m => m && m.role === 'tool_receipt' && String(m.toolUseId || '') === tid) || null;
    } catch {
      return null;
    }
  }

  async function _copyToClipboard(text) {
    try {
      const s = String(text ?? '');
      if (!s) return;
      await navigator.clipboard.writeText(s);
      try { showToast?.('Copied to clipboard'); } catch { /* ignore */ }
    } catch {
      try { showToast?.('Copy failed'); } catch { /* ignore */ }
    }
  }

  function _clamp(n, lo, hi) {
    const x = Number(n);
    if (!Number.isFinite(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function _getRun(sessionId, runId) {
    const sid = String(sessionId || '').trim();
    const rid = String(runId || '').trim();
    if (!sid || !rid) return null;
    const runs = Array.isArray(executionTimelineRunsBySession?.[sid]) ? executionTimelineRunsBySession[sid] : [];
    return runs.find(r => String(r?.id || '') === rid) || null;
  }

  function _getOrInitRunState(runId) {
    const rid = String(runId || '').trim();
    if (!rid) return null;
    let st = stateByRunId.get(rid);
    if (!st) {
      st = {
        rid,
        rewindIdx: 0,
        playing: false,
        playTimer: null,
        // cache
        lastNodeCount: -1,
        lastReceiptCount: -1,
        lastFilePreviewCount: -1,
        events: [],
        graph: null,
        layout: null,
        pins: null,
        // view transform
        scale: 1,
        tx: 0,
        ty: 0,
        // render bookkeeping
        raf: 0,
        dirty: true,
        // selection
        selectedId: '',
        hoveredId: '',
        hoverScreen: { x: 0, y: 0 }
      };
      stateByRunId.set(rid, st);
    }
    return st;
  }

  function _setMapControlsVisible(on) {
    const controls = $('executionTimelineMapRewindControls');
    if (controls) controls.style.display = on ? '' : 'none';
  }

  function _setFitButtonLabelForMap() {
    try {
      const btn = $('executionTimelineEditorFitBtn');
      if (!btn) return;
      btn.title = 'Fit map to view';
      btn.textContent = 'Fit';
    } catch { /* ignore */ }
  }

  function _setFitButtonLabelForGraph() {
    try {
      const btn = $('executionTimelineEditorFitBtn');
      if (!btn) return;
      btn.title = 'Fit graph to view';
      btn.textContent = 'Fit';
    } catch { /* ignore */ }
  }

  function _resizeMountedCanvas() {
    try {
      const host = mounted.host;
      const canvas = mounted.canvas;
      if (!host || !canvas) return;
      const rect = host.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2.25, window.devicePixelRatio || 1));
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    } catch { /* ignore */ }
  }

  function _ensureMounted() {
    // Render into the inner canvas host so AET overlay controls remain persistent.
    const host = $('executionTimelineEditorCanvasHost') || $('executionTimelineEditorGraphHost');
    if (!host) return false;
    // IMPORTANT: Graph view re-renders by replacing the host's innerHTML, which destroys the map DOM.
    // If our cached root/canvas is no longer connected, we must remount.
    if (mounted.root && mounted.host === host && mounted.root.isConnected === true && host.contains(mounted.root)) return true;

    mounted.host = host;
    host.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'aet-map-root';

    const canvas = document.createElement('canvas');
    canvas.className = 'aet-map-canvas';
    canvas.width = 1;
    canvas.height = 1;
    root.appendChild(canvas);

    const hud = document.createElement('div');
    hud.className = 'aet-map-hud';

    const hint = document.createElement('div');
    hint.className = 'aet-map-hint';
    hint.textContent = 'Drag to pan · Wheel to zoom · Hover for details · Click to pin/open';
    hud.appendChild(hint);

    const tooltip = document.createElement('div');
    tooltip.className = 'aet-map-tooltip';
    tooltip.innerHTML = `<div class="t">Node</div><div class="l"></div>`;
    hud.appendChild(tooltip);

    const legend = document.createElement('div');
    legend.className = 'aet-map-legend';
    legend.innerHTML = `
      <div class="aet-map-legend-header">
        <div class="aet-map-legend-title">Legend</div>
        <button class="icon-button" id="aetMapLegendToggleBtn" title="Toggle legend">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>
      <div class="aet-map-legend-body">
        <div class="aet-map-legend-item">
          <div class="aet-map-legend-swatch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="6"></circle>
            </svg>
          </div>
          <div><b>Run</b> (center)</div>
        </div>
        <div class="aet-map-legend-item">
          <div class="aet-map-legend-swatch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M6 12l4-4h8l-4 4 4 4H10z"></path>
            </svg>
          </div>
          <div><b>Goal</b> (user intent)</div>
        </div>
        <div class="aet-map-legend-item">
          <div class="aet-map-legend-swatch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="7" y="7" width="10" height="10" rx="2"></rect>
            </svg>
          </div>
          <div><b>Tool</b> (Read/Edit/Bash/WebFetch…)</div>
        </div>
        <div class="aet-map-legend-item">
          <div class="aet-map-legend-swatch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M8 4h7l3 3v13H8z"></path>
              <path d="M15 4v4h4"></path>
            </svg>
          </div>
          <div><b>File</b> (touched)</div>
        </div>
        <div class="aet-map-legend-item">
          <div class="aet-map-legend-swatch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 3l7 9-7 9-7-9z"></path>
              <path d="M9 12h6"></path>
              <path d="M12 9v6"></path>
            </svg>
          </div>
          <div><b>Diff</b> (+/- changes)</div>
        </div>
        <div class="aet-map-legend-item">
          <div class="aet-map-legend-swatch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 3l9 16H3z"></path>
              <path d="M12 9v4"></path>
              <path d="M12 17h.01"></path>
            </svg>
          </div>
          <div><b>Block</b> (permission/error)</div>
        </div>
        <div class="aet-map-legend-item">
          <div class="aet-map-legend-swatch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 2l3 7 7 .6-5.3 4.6 1.8 7-6.5-4-6.5 4 1.8-7L2 9.6 9 9z"></path>
            </svg>
          </div>
          <div><b>Outcome</b> (success/failure)</div>
        </div>
        <div class="aet-map-legend-item">
          <div class="aet-map-legend-swatch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 17v5"></path>
              <path d="M9 3h6l1 2h4v4l-2 2v4H6v-4L4 9V5h4l1-2z"></path>
            </svg>
          </div>
          <div><b>Pin</b> (saved to Pinboard)</div>
        </div>
      </div>
    `.trim();
    hud.appendChild(legend);

    const side = document.createElement('div');
    side.className = 'aet-map-sidepanel';
    side.innerHTML = `
      <div class="aet-map-panel-header">
        <div class="aet-map-panel-title" id="aetMapPanelTitle">Node</div>
        <div class="aet-map-panel-actions">
          <button class="aet-mini-icon-btn" id="aetMapPinBtn" type="button" title="Pin / Unpin" aria-label="Pin / Unpin">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 17v5"></path>
              <path d="M9 3h6l1 2h4v4l-2 2v4H6v-4L4 9V5h4l1-2z"></path>
            </svg>
          </button>
          <button class="icon-button" id="aetMapPanelCloseBtn" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="aet-map-panel-body" id="aetMapPanelBody"></div>
      <div class="aet-map-panel-footer" id="aetMapPanelFooter"></div>
      <div class="aet-map-pinboard" id="aetMapPinboard">
        <div class="aet-map-pinboard-header">
          <div class="aet-map-panel-title">Pinboard</div>
          <button class="icon-button" id="aetMapPinboardCloseBtn" title="Close Pinboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="aet-map-pinboard-list" id="aetMapPinboardList"></div>
      </div>
    `;
    hud.appendChild(side);

    root.appendChild(hud);
    host.appendChild(root);

    mounted.root = root;
    mounted.canvas = canvas;
    mounted.ctx = canvas.getContext('2d');
    mounted.hud = hud;
    mounted.hintEl = hint;
    mounted.tooltipEl = tooltip;
    mounted.side = side;
    mounted.sideTitle = side.querySelector('#aetMapPanelTitle');
    mounted.sideBody = side.querySelector('#aetMapPanelBody');
    mounted.closeBtn = side.querySelector('#aetMapPanelCloseBtn');
    mounted.pinBtn = side.querySelector('#aetMapPinBtn');
    mounted.pinboardEl = side.querySelector('#aetMapPinboard');
    mounted.pinboardList = side.querySelector('#aetMapPinboardList');
    mounted.pinboardCloseBtn = side.querySelector('#aetMapPinboardCloseBtn');

    // Panel close
    mounted.closeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { mounted.side.classList.remove('open'); } catch { /* ignore */ }
    });
    mounted.pinboardCloseBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { mounted.pinboardEl.classList.remove('open'); } catch { /* ignore */ }
    });

    // Resize handling
    _resizeMountedCanvas();
    try {
      mounted.resizeObs?.disconnect?.();
    } catch { /* ignore */ }
    try {
      mounted.resizeObs = new ResizeObserver(() => {
        _resizeMountedCanvas();
        scheduleRenderCurrent();
      });
      mounted.resizeObs.observe(host);
    } catch { /* ignore */ }
    if (!windowResizeBound) {
      windowResizeBound = true;
      window.addEventListener('resize', () => {
        _resizeMountedCanvas();
        scheduleRenderCurrent();
      }, { passive: true });
    }

    _bindCanvasInteractions(canvas);
    _bindMapControlsOnce();

    // Legend toggle
    try {
      const btn = legend.querySelector('#aetMapLegendToggleBtn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          legend.classList.toggle('collapsed');
        });
      }
    } catch { /* ignore */ }

    return true;
  }

  function _worldToScreen(st, x, y) {
    return { x: x * st.scale + st.tx, y: y * st.scale + st.ty };
  }

  function _screenToWorld(st, x, y) {
    return { x: (x - st.tx) / st.scale, y: (y - st.ty) / st.scale };
  }

  function _fitToBounds(st, bounds, width, height) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    const pad = 30;
    const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
    const scale = _clamp(s, 0.2, 2.5);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const tx = w / 2 - cx * scale;
    const ty = h / 2 - cy * scale;
    st.scale = scale;
    st.tx = tx;
    st.ty = ty;
  }

  function _bindCanvasInteractions(canvas) {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragState.dragging = true;
      dragState.dragCanvas = canvas;
      dragState.lastX = e.clientX;
      dragState.lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    });
    if (!windowInputBound) {
      windowInputBound = true;
      window.addEventListener('mouseup', () => {
        try {
          dragState.dragging = false;
          if (dragState.dragCanvas && dragState.dragCanvas.isConnected) {
            dragState.dragCanvas.style.cursor = '';
          }
          dragState.dragCanvas = null;
        } catch { /* ignore */ }
      }, { passive: true });
      window.addEventListener('mousemove', (e) => {
        try {
          if (!dragState.dragging) return;
          const st = getCurrentRunState();
          if (!st) return;
          const dx = e.clientX - dragState.lastX;
          const dy = e.clientY - dragState.lastY;
          dragState.lastX = e.clientX;
          dragState.lastY = e.clientY;
          st.tx += dx;
          st.ty += dy;
          st.dirty = true;
          scheduleRenderCurrent();
        } catch { /* ignore */ }
      }, { passive: true });
    }

    // Hover (lightweight)
    canvas.addEventListener('mousemove', (e) => {
      try {
        if (dragState.dragging) return;
        const st = getCurrentRunState();
        if (!st || !st.layout) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        st.hoverScreen = { x: sx, y: sy };
        const w = _screenToWorld(st, sx, sy);
        const id = _hitTest(st, w.x, w.y);
        if (id !== st.hoveredId) {
          st.hoveredId = id || '';
          st.dirty = true;
          scheduleRenderCurrent();
        }
        _updateTooltip(st);
      } catch { /* ignore */ }
    }, { passive: true });

    canvas.addEventListener('wheel', (e) => {
      try {
        const st = getCurrentRunState();
        if (!st) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = _screenToWorld(st, sx, sy);
        const factor = Math.exp((-e.deltaY) * 0.0012);
        const nextScale = _clamp(st.scale * factor, 0.2, 2.7);
        st.scale = nextScale;
        st.tx = sx - world.x * nextScale;
        st.ty = sy - world.y * nextScale;
        st.dirty = true;
        scheduleRenderCurrent();
      } catch { /* ignore */ }
    }, { passive: false });

    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      try { fitCurrent(); } catch { /* ignore */ }
    });

    canvas.addEventListener('click', (e) => {
      try {
        const st = getCurrentRunState();
        if (!st || !st.layout || !st.graph) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const w = _screenToWorld(st, sx, sy);
        const nodeId = _hitTest(st, w.x, w.y);
        if (!nodeId) return;
        st.selectedId = nodeId;
        st.dirty = true;
        scheduleRenderCurrent();
        _openNodePanel(st, nodeId);
      } catch { /* ignore */ }
    });
  }

  function _hitTest(st, wx, wy) {
    const positions = st.layout?.positions || {};
    let bestId = '';
    let bestD2 = Infinity;
    for (const [id, p] of Object.entries(positions)) {
      const dx = wx - p.x;
      const dy = wy - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestId = id;
      }
    }
    const hitR = 18 / Math.max(0.2, st.scale);
    if (bestD2 <= hitR * hitR) return bestId;
    return '';
  }

  function _nodeColor(type) {
    // Align with Codeon theme (orange accent) instead of bluish/teal.
    if (type === 'root_run') return '#D97757';
    if (type === 'goal') return '#34d399';
    if (type === 'tool') return '#60a5fa';
    if (type === 'file') return '#a78bfa';
    if (type === 'diff') return '#E6A08A';
    if (type === 'block') return '#fb7185';
    if (type === 'outcome') return '#fbbf24';
    if (type === 'pinboard' || type === 'pin') return '#f472b6';
    return '#94a3b8';
  }

  function _drawShape(ctx, type, x, y, r) {
    // Distinct, recognizable silhouettes per node type.
    if (type === 'goal') {
      // Tag/flag
      const w = r * 2.1;
      const h = r * 1.55;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.55, y);
      ctx.lineTo(x - w * 0.15, y - h * 0.55);
      ctx.lineTo(x + w * 0.55, y - h * 0.55);
      ctx.lineTo(x + w * 0.15, y);
      ctx.lineTo(x + w * 0.55, y + h * 0.55);
      ctx.lineTo(x - w * 0.15, y + h * 0.55);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (type === 'tool') {
      // Rounded square
      const s = r * 2.0;
      const rr = Math.max(2, r * 0.55);
      _roundedRect(ctx, x - s / 2, y - s / 2, s, s, rr);
      ctx.fill();
      return;
    }
    if (type === 'file') {
      // Document with folded corner
      const w = r * 1.9;
      const h = r * 2.2;
      const left = x - w / 2;
      const top = y - h / 2;
      const fold = Math.max(4, r * 0.6);
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left + w - fold, top);
      ctx.lineTo(left + w, top + fold);
      ctx.lineTo(left + w, top + h);
      ctx.lineTo(left, top + h);
      ctx.closePath();
      ctx.fill();
      // Fold line
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = 'rgba(241, 245, 249, 0.55)';
      ctx.lineWidth = 1.3 / Math.max(0.2, (ctx.getTransform().a || 1));
      ctx.beginPath();
      ctx.moveTo(left + w - fold, top);
      ctx.lineTo(left + w - fold, top + fold);
      ctx.lineTo(left + w, top + fold);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (type === 'diff') {
      // Diamond
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.35);
      ctx.lineTo(x + r * 1.35, y);
      ctx.lineTo(x, y + r * 1.35);
      ctx.lineTo(x - r * 1.35, y);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (type === 'block') {
      // Warning triangle
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.5);
      ctx.lineTo(x + r * 1.45, y + r * 1.25);
      ctx.lineTo(x - r * 1.45, y + r * 1.25);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (type === 'outcome') {
      // Star-ish (5 points)
      const spikes = 5;
      const outer = r * 1.45;
      const inner = r * 0.65;
      let rot = -Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(x, y - outer);
      for (let i = 0; i < spikes; i++) {
        ctx.lineTo(x + Math.cos(rot) * outer, y + Math.sin(rot) * outer);
        rot += Math.PI / spikes;
        ctx.lineTo(x + Math.cos(rot) * inner, y + Math.sin(rot) * inner);
        rot += Math.PI / spikes;
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (type === 'pin' || type === 'pinboard') {
      // Circle with notch
      ctx.beginPath();
      ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    // Default: circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function _updateTooltip(st) {
    const el = mounted.tooltipEl;
    if (!el) return;
    const id = String(st?.hoveredId || '').trim();
    if (!id || !st.graph?.nodesById?.[id]) {
      el.style.transform = 'translate(-9999px, -9999px)';
      return;
    }
    const n = st.graph.nodesById[id];
    const type = String(n.type || 'node').toUpperCase();
    const label = _safeStr(n.label || id, 160);
    const tEl = el.querySelector('.t');
    const lEl = el.querySelector('.l');
    if (tEl) tEl.textContent = type;
    if (lEl) lEl.textContent = label;
    const x = Number(st.hoverScreen?.x || 0);
    const y = Number(st.hoverScreen?.y || 0);
    // Offset slightly from cursor; keep within viewport (best effort)
    const pad = 14;
    el.style.transform = `translate(${Math.max(8, x + pad)}px, ${Math.max(8, y + pad)}px)`;
  }

  function _roundedRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.max(0, w / 2), Math.max(0, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function _draw(st) {
    if (!mounted.canvas || !mounted.ctx) return;
    const ctx = mounted.ctx;
    const canvas = mounted.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2.25, window.devicePixelRatio || 1));
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, 0, w, h);

    if (!st.graph || !st.layout) return;
    const positions = st.layout.positions || {};

    // World transform
    ctx.translate(st.tx, st.ty);
    ctx.scale(st.scale, st.scale);

    // Edges
    ctx.lineWidth = 1 / st.scale;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.beginPath();
    for (const e of st.graph.edges || []) {
      const a = positions[e.from];
      const b = positions[e.to];
      if (!a || !b) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // Nodes
    const baseR = 10;
    for (const n of st.graph.nodes || []) {
      const p = positions[n.id];
      if (!p) continue;
      const selected = st.selectedId && n.id === st.selectedId;
      const hovered = st.hoveredId && n.id === st.hoveredId;
      const r = selected ? baseR * 1.75 : (hovered ? baseR * 1.45 : baseR);

      // Soft halo for hovered/selected
      if (selected || hovered) {
        ctx.beginPath();
        ctx.fillStyle = selected ? 'rgba(241, 245, 249, 0.18)' : 'rgba(94, 234, 212, 0.14)';
        ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.fillStyle = _nodeColor(n.type);
      ctx.globalAlpha = 0.92;
      _drawShape(ctx, n.type, p.x, p.y, r);
      ctx.globalAlpha = 1;

      // Outline
      if (selected || hovered) {
        ctx.strokeStyle = selected ? 'rgba(241, 245, 249, 0.85)' : 'rgba(94, 234, 212, 0.75)';
        ctx.lineWidth = (selected ? 2.2 : 1.8) / st.scale;
        ctx.stroke();
      }

      // Inner icon glyph (simple, readable at small sizes)
      if (st.scale >= 0.55 && n.type !== 'file') {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.lineWidth = 1.8 / st.scale;
        ctx.lineCap = 'round';
        if (n.type === 'diff') {
          ctx.beginPath();
          ctx.moveTo(p.x - r * 0.5, p.y);
          ctx.lineTo(p.x + r * 0.5, p.y);
          ctx.moveTo(p.x, p.y - r * 0.5);
          ctx.lineTo(p.x, p.y + r * 0.5);
          ctx.stroke();
        } else if (n.type === 'block') {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - r * 0.45);
          ctx.lineTo(p.x, p.y + r * 0.2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y + r * 0.55, 0.12 * r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
          ctx.fill();
        } else if (n.type === 'tool') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 0.22, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Labels: draw in screen-space (readable), heavily culled to avoid overlap
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const wantDenseLabels = st.scale >= 0.95;
    const labelFont = wantDenseLabels ? 12 : 12;
    ctx.font = `${labelFont}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;

    // Build candidate list: always show selected/hovered + root/goal/outcome; files only when zoomed in.
    const importantTypes = new Set(['root_run', 'goal', 'outcome']);
    const candidates = [];
    for (const n of st.graph.nodes || []) {
      if (!n) continue;
      if (!positions[n.id]) continue;
      const isSel = st.selectedId && n.id === st.selectedId;
      const isHover = st.hoveredId && n.id === st.hoveredId;
      if (isSel || isHover || importantTypes.has(n.type) || (wantDenseLabels && n.type === 'file')) {
        const label = _safeStr(n.label || '', (isSel || isHover) ? 90 : 44);
        if (label) candidates.push({ n, label, pri: (isSel ? 4 : (isHover ? 3 : (importantTypes.has(n.type) ? 2 : 1))) });
      }
    }
    candidates.sort((a, b) => (b.pri - a.pri) || String(a.n.id).localeCompare(String(b.n.id)));

    // Simple grid occupancy to prevent label overlap (fast)
    const grid = new Set();
    const cell = 22;
    const take = (x, y, w2, h2) => {
      const minCx = Math.floor((x - w2) / cell);
      const maxCx = Math.floor((x + w2) / cell);
      const minCy = Math.floor((y - h2) / cell);
      const maxCy = Math.floor((y + h2) / cell);
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const k = `${cx},${cy}`;
          if (grid.has(k)) return false;
        }
      }
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) grid.add(`${cx},${cy}`);
      }
      return true;
    };

    for (const c of candidates) {
      const p = positions[c.n.id];
      if (!p) continue;
      const sp = _worldToScreen(st, p.x, p.y);
      const sx = sp.x;
      const sy = sp.y;
      // Skip if offscreen
      if (sx < -80 || sy < -80 || sx > w + 80 || sy > h + 80) continue;
      const text = c.label;
      const tw = ctx.measureText(text).width;
      const padX = 8;
      const padY = 5;
      const bw = tw + padX * 2;
      const bh = labelFont + padY * 2;
      const bx = sx + 14;
      const by = sy - 18;
      if (!take(bx + bw / 2, by + bh / 2, bw / 2, bh / 2)) continue;
      ctx.save();
      ctx.globalAlpha = c.pri >= 3 ? 0.98 : 0.9;
      _roundedRect(ctx, bx, by, bw, bh, 10);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
      ctx.fill();
      ctx.strokeStyle = c.pri >= 3 ? 'rgba(94, 234, 212, 0.22)' : 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(241, 245, 249, 0.93)';
      ctx.fillText(text, bx + padX, by + padY + labelFont - 3);
      ctx.restore();
    }
  }

  function scheduleRenderCurrent() {
    const st = getCurrentRunState();
    if (!st) return;
    if (st.raf) return;
    st.raf = requestAnimationFrame(() => {
      st.raf = 0;
      if (!st.dirty) return;
      st.dirty = false;
      _draw(st);
    });
  }

  function _bindMapControlsOnce() {
    if (window.__codeonAetMapControlsBound) return;
    window.__codeonAetMapControlsBound = true;

    const scrub = $('executionTimelineMapScrub');
    if (scrub) {
      scrub.addEventListener('input', () => {
        try {
          const st = getCurrentRunState();
          if (!st) return;
          const v = Number(scrub.value || 0);
          st.rewindIdx = Math.max(0, Math.floor(v));
          st.dirty = true;
          renderForCurrentSession();
        } catch { /* ignore */ }
      });
    }

    const playBtn = $('executionTimelineMapPlayBtn');
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const st = getCurrentRunState();
        if (!st) return;
        if (st.playing) {
          stopPlayback(st);
          return;
        }
        startPlayback(st);
      });
    }

    const pinboardBtn = $('executionTimelineMapPinboardBtn');
    if (pinboardBtn) {
      pinboardBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await refreshPinboardUI();
          mounted.side?.classList?.add?.('open');
          mounted.pinboardEl?.classList?.toggle?.('open');
        } catch { /* ignore */ }
      });
    }
  }

  function _setMapRewindUi(st) {
    const scrub = $('executionTimelineMapScrub');
    const label = $('executionTimelineMapLabel');
    if (!scrub || !label) return;
    const max = Math.max(0, (st.events?.length || 0) - 1);
    scrub.min = '0';
    scrub.max = String(max);
    scrub.step = '1';
    st.rewindIdx = _clamp(st.rewindIdx, 0, max);
    scrub.value = String(st.rewindIdx);
    label.textContent = `${Math.min(max + 1, st.rewindIdx + 1)}/${max + 1}`;
  }

  function startPlayback(st) {
    const playBtn = $('executionTimelineMapPlayBtn');
    st.playing = true;
    if (playBtn) {
      playBtn.title = 'Pause rewind';
      playBtn.setAttribute('aria-label', 'Pause rewind');
      playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="7" y="5" width="3" height="14" rx="1"></rect>
          <rect x="14" y="5" width="3" height="14" rx="1"></rect>
        </svg>
      `.trim();
    }
    try { if (st.playTimer) clearInterval(st.playTimer); } catch { /* ignore */ }
    st.playTimer = setInterval(() => {
      try {
        const max = Math.max(0, (st.events?.length || 0) - 1);
        if (st.rewindIdx >= max) {
          stopPlayback(st);
          st.rewindIdx = 0;
          renderForCurrentSession();
          return;
        }
        st.rewindIdx += 1;
        renderForCurrentSession();
      } catch { /* ignore */ }
    }, 650);
  }

  function stopPlayback(st) {
    const playBtn = $('executionTimelineMapPlayBtn');
    st.playing = false;
    try { if (st.playTimer) clearInterval(st.playTimer); } catch { /* ignore */ }
    st.playTimer = null;
    if (playBtn) {
      playBtn.title = 'Play rewind';
      playBtn.setAttribute('aria-label', 'Play rewind');
      playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M8 5v14l11-7z"></path>
        </svg>
      `.trim();
    }
  }

  async function _loadPinsForProject() {
    try {
      if (!window.currentFolder || !window.CodeonPinboard) return null;
      const pb = await window.CodeonPinboard.getPinboard(window.currentFolder);
      return pb;
    } catch {
      return null;
    }
  }

  async function refreshPinboardUI() {
    try {
      if (!mounted.pinboardList) return;
      const pb = await _loadPinsForProject();
      const pins = Array.isArray(pb?.pins) ? pb.pins : [];
      mounted.pinboardList.innerHTML = '';
      if (pins.length === 0) {
        const div = document.createElement('div');
        div.style.opacity = '0.8';
        div.style.fontSize = '12px';
        div.style.padding = '8px';
        div.textContent = 'No pins yet. Select a node and click the pin icon.';
        mounted.pinboardList.appendChild(div);
        return;
      }
      for (const p of pins.slice(0, 120)) {
        const item = document.createElement('div');
        item.className = 'aet-map-pin-item';
        item.innerHTML = `
          <div class="aet-map-pin-title">${_safeStr(p.label || 'Pin', 120)}</div>
          ${p.note ? `<div class="aet-map-pin-note">${_safeStr(p.note, 260)}</div>` : ''}
        `;
        item.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            const ref = p.ref && typeof p.ref === 'object' ? p.ref : {};
            if (ref.filePath && typeof openRelPathFromChat === 'function') {
              await openRelPathFromChat(String(ref.filePath), { jumpToDiff: false });
            }
          } catch { /* ignore */ }
        });
        mounted.pinboardList.appendChild(item);
      }
    } catch { /* ignore */ }
  }

  function _openNodePanel(st, nodeId) {
    const n = st.graph?.nodesById?.[nodeId] || null;
    if (!n || !mounted.side || !mounted.sideBody || !mounted.sideTitle) return;
    mounted.side.classList.add('open');
    mounted.sideTitle.textContent = String(n.type || 'Node');

    const refs = n.refs && typeof n.refs === 'object' ? n.refs : {};
    const meta = n.meta && typeof n.meta === 'object' ? n.meta : {};

    // If this is a tool node and we have a toolUseId, enrich from the persisted tool_receipt message.
    const sid = String(window.currentSessionId || currentSessionId || '').trim();
    const toolReceipt = (n.type === 'tool' && refs.toolUseId) ? _findToolReceipt(sid, refs.toolUseId) : null;
    const receiptPreview = toolReceipt && typeof toolReceipt.preview === 'string' ? toolReceipt.preview : '';
    const receiptObj = toolReceipt && toolReceipt.receipt && typeof toolReceipt.receipt === 'object' ? toolReceipt.receipt : null;
    let receiptJson = '';
    try {
      if (receiptObj) receiptJson = JSON.stringify(receiptObj, null, 2);
    } catch { /* ignore */ }

    const kv = [];
    if (n.label) kv.push(['label', n.label]);
    if (refs.filePath) kv.push(['file', refs.filePath]);
    if (refs.toolUseId) kv.push(['toolUseId', refs.toolUseId]);
    if (refs.aetNodeId) kv.push(['aetNodeId', refs.aetNodeId]);
    if (meta.diffStat) kv.push(['diff', meta.diffStat]);
    if (meta.toolName) kv.push(['tool', meta.toolName]);
    if (meta.summary) kv.push(['summary', meta.summary]);
    if (receiptPreview) kv.push(['preview', receiptPreview]);
    if (meta.note) kv.push(['note', meta.note]);

    // Render KV with “More/Copy” for long values (keeps UI fast but allows full access).
    const rows = kv.map(([k, v]) => {
      const key = _escapeHtml(_safeStr(k, 80));
      const raw = String(v ?? '');
      const { text, clipped } = _clipText(raw, 900);
      const safeText = _escapeHtml(text);
      if (!clipped) {
        return `<div class="k">${key}</div><div class="v">${safeText}</div>`;
      }
      const fullEsc = _escapeHtml(raw);
      const id = `aetMapMore_${Math.random().toString(16).slice(2)}`;
      return `
        <div class="k">${key}</div>
        <div class="v">
          <div class="aet-map-more-row">
            <span>${safeText}</span>
            <button class="aet-map-inline-btn" type="button" data-aet-more="${id}">More</button>
            <button class="aet-map-inline-btn" type="button" data-aet-copy="${id}">Copy</button>
          </div>
          <div class="aet-map-pre" id="${id}" style="display:none;"><span class="mono">${fullEsc}</span></div>
        </div>
      `;
    }).join('');

    mounted.sideBody.innerHTML = `<div class="aet-map-kv">${rows}</div>`;

    // Wire More/Copy buttons
    try {
      mounted.sideBody.querySelectorAll('button[data-aet-more]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute('data-aet-more');
          const pre = id ? mounted.sideBody.querySelector(`#${CSS.escape(id)}`) : null;
          if (!pre) return;
          const on = pre.style.display !== 'none';
          pre.style.display = on ? 'none' : 'block';
          btn.textContent = on ? 'More' : 'Less';
        });
      });
      mounted.sideBody.querySelectorAll('button[data-aet-copy]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute('data-aet-copy');
          const pre = id ? mounted.sideBody.querySelector(`#${CSS.escape(id)}`) : null;
          const text = pre ? pre.textContent : '';
          await _copyToClipboard(text);
        });
      });
    } catch { /* ignore */ }

    const footer = mounted.side.querySelector('#aetMapPanelFooter');
    if (footer) footer.innerHTML = '';

    // Actions
    const addBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.className = 'btn-secondary';
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { await onClick(); } catch { /* ignore */ }
      });
      footer?.appendChild(b);
    };

    if (n.type === 'file' && refs.filePath && typeof openRelPathFromChat === 'function') {
      addBtn('Open file', async () => { await openRelPathFromChat(String(refs.filePath), { jumpToDiff: false }); });
    }
    if (n.type === 'diff' && refs.filePath && typeof openFullDiffForRelPath === 'function') {
      addBtn('Open diff', async () => { await openFullDiffForRelPath(String(refs.filePath)); });
    }
    if (n.type === 'tool' && refs.aetNodeId && typeof _openAetNodeDrawer === 'function') {
      const sid2 = String(currentSessionId || '').trim();
      const rid = st.rid;
      addBtn('Jump to AET', async () => { _openAetNodeDrawer({ sessionId: sid2, runId: rid, nodeId: String(refs.aetNodeId) }); });
    }

    // If we have a receipt object, provide a one-click copy action.
    if (n.type === 'tool' && receiptJson) {
      addBtn('Copy receipt JSON', async () => { await _copyToClipboard(receiptJson); });
    }

    // Pin/unpin
    if (mounted.pinBtn) {
      mounted.pinBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (!window.currentFolder || !window.CodeonPinboard) return;
          const ref = {};
          if (refs.filePath) ref.filePath = String(refs.filePath);
          if (refs.runId && refs.aetNodeId) { ref.runId = String(refs.runId); ref.aetNodeId = String(refs.aetNodeId); }
          if (refs.toolUseId) ref.toolUseId = String(refs.toolUseId);
          const label = n.type === 'file' ? String(refs.filePath) : `${n.type}: ${n.label}`;
          await window.CodeonPinboard.togglePinForRef(window.currentFolder, { ref, label });
          await refreshPinboardUI();
        } catch (err) {
          try { showToast?.(String(err?.message || err || 'Pin failed')); } catch { /* ignore */ }
        }
      };
    }
  }

  function getCurrentRunState() {
    try {
      const sid = String(currentSessionId || '').trim();
      const rid = sid ? String(executionTimelineActiveRunBySession?.[sid] || '').trim() : '';
      if (!rid) return null;
      return _getOrInitRunState(rid);
    } catch {
      return null;
    }
  }

  function renderForCurrentSession() {
    const sid = String(currentSessionId || '').trim();
    const rid = sid ? String(executionTimelineActiveRunBySession?.[sid] || '').trim() : '';
    if (!sid || !rid) return;
    renderForSession({ sessionId: sid, runId: rid });
  }

  function renderForSession({ sessionId, runId }) {
    const sid = String(sessionId || '').trim();
    const rid = String(runId || '').trim();
    if (!sid || !rid) return;
    if (!_ensureMounted()) return;

    _setMapControlsVisible(true);
    _setFitButtonLabelForMap();

    const st = _getOrInitRunState(rid);
    if (!st) return;

    const run = _getRun(sid, rid);
    if (!run) {
      try {
        mounted.host.innerHTML = '<div style="opacity:0.75; padding: 10px 6px;">No run selected.</div>';
      } catch { /* ignore */ }
      return;
    }

    // Cache key: AET nodes + receipts + file previews
    const nodes = Array.isArray(run.nodes) ? run.nodes : [];
    const msgs = (typeof ensureSessionMessages === 'function')
      ? ensureSessionMessages(sid)
      : ((typeof window.ensureSessionMessages === 'function') ? window.ensureSessionMessages(sid) : []);
    const receiptCount = Array.isArray(msgs) ? msgs.filter(m => m && m.role === 'tool_receipt').length : 0;
    const filePreviewCount = Array.isArray(msgs) ? msgs.filter(m => m && m.role === 'file_preview').length : 0;

    const needsRebuild = (nodes.length !== st.lastNodeCount) || (receiptCount !== st.lastReceiptCount) || (filePreviewCount !== st.lastFilePreviewCount);
    if (needsRebuild) {
      st.lastNodeCount = nodes.length;
      st.lastReceiptCount = receiptCount;
      st.lastFilePreviewCount = filePreviewCount;
      try {
        st.events = window.CodeonAetMapEvents?.buildMapEvents?.({ sessionId: sid, run }) || [];
      } catch {
        st.events = [];
      }
      // Default rewind index to end (latest)
      st.rewindIdx = Math.max(0, (st.events.length || 0) - 1);
      // Refresh pins async (do not block)
      _loadPinsForProject().then(pb => {
        st.pins = pb;
        st.dirty = true;
        renderForSession({ sessionId: sid, runId: rid });
      }).catch(() => {});
    }

    const eventsSlice = (st.events && st.events.length > 0)
      ? st.events.slice(0, Math.max(1, st.rewindIdx + 1))
      : [];

    st.graph = window.CodeonAetMapGraph?.foldEventsToGraph?.(eventsSlice, { pins: st.pins }) || null;
    st.layout = window.CodeonAetMapLayout?.layoutRadial?.(st.graph) || null;

    _setMapRewindUi(st);

    // Fit on first render for this run (best-effort)
    if (needsRebuild && st.layout?.bounds && mounted.canvas) {
      const rect = mounted.canvas.getBoundingClientRect();
      _fitToBounds(st, st.layout.bounds, rect.width, rect.height);
    }

    st.dirty = true;
    scheduleRenderCurrent();
  }

  function fitCurrent() {
    const st = getCurrentRunState();
    if (!st || !st.layout || !mounted.canvas) return;
    const rect = mounted.canvas.getBoundingClientRect();
    _fitToBounds(st, st.layout.bounds, rect.width, rect.height);
    st.dirty = true;
    scheduleRenderCurrent();
  }

  function onAetViewModeChanged(mode) {
    const m = String(mode || '').trim();
    if (m === 'map') {
      _setMapControlsVisible(true);
      _setFitButtonLabelForMap();
      renderForCurrentSession();
      return;
    }
    // Leaving map: hide rewind controls
    _setMapControlsVisible(false);
    _setFitButtonLabelForGraph();
    try { mounted.side?.classList?.remove?.('open'); } catch { /* ignore */ }
    try { mounted.pinboardEl?.classList?.remove?.('open'); } catch { /* ignore */ }
    const st = getCurrentRunState();
    if (st) stopPlayback(st);
  }

  // Public API (used by renderer/app.js glue)
  window.CodeonAetMap = {
    renderForSession,
    renderForCurrentSession,
    fitCurrent,
    onAetViewModeChanged
  };
})();
