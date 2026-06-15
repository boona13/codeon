// AET Run Map — deterministic radial layout (mindmap feel)
//
// Layout goals:
// - root at center
// - ring1: goal/outcome/tools (+ optional pinboard)
// - ring2: files
// - ring3: diffs/blocks/pins
//
// Returns:
// - positions: { [nodeId]: { x, y, r, theta } }
// - bounds: { minX, minY, maxX, maxY }

(function () {
  function _hash32(str) {
    try {
      const s = String(str || '');
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
      }
      return h >>> 0;
    } catch {
      return 0;
    }
  }

  function _stableSort(list, keyFn) {
    return list
      .map((v, i) => ({ v, i, k: keyFn(v) }))
      .sort((a, b) => (a.k < b.k ? -1 : (a.k > b.k ? 1 : (a.i - b.i))))
      .map(o => o.v);
  }

  function _updateBounds(bounds, x, y) {
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
  }

  function layoutRadial(graph) {
    const g = graph && typeof graph === 'object' ? graph : {};
    const nodes = Array.isArray(g.nodes) ? g.nodes : [];
    const edges = Array.isArray(g.edges) ? g.edges : [];
    if (nodes.length === 0) return { positions: {}, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

    const positions = Object.create(null);
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    const root = nodes.find(n => n && n.type === 'root_run') || nodes[0];
    if (!root) return { positions: {}, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

    positions[root.id] = { x: 0, y: 0, r: 0, theta: 0 };
    _updateBounds(bounds, 0, 0);

    const byType = (t) => nodes.filter(n => n && n.type === t);
    const goal = byType('goal')[0] || null;
    const outcome = byType('outcome')[0] || null;
    const tools = _stableSort(byType('tool'), n => String(n.label || n.id));
    const files = _stableSort(byType('file'), n => String(n.label || n.id));
    const diffs = _stableSort(byType('diff'), n => String(n.id));
    const blocks = _stableSort(byType('block'), n => String(n.id));
    const pinboard = byType('pinboard')[0] || null;
    const pins = _stableSort(byType('pin'), n => String(n.label || n.id));

    const r1 = 250;
    const r2 = 520;
    const r3 = 820;

    const setPolar = (node, r, theta) => {
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      positions[node.id] = { x, y, r, theta };
      _updateBounds(bounds, x, y);
    };

    // Ring 1: reserve goal/outcome at fixed angles
    const GOAL_TH = -Math.PI / 2;
    const OUT_TH = Math.PI / 2;
    if (goal) setPolar(goal, r1, GOAL_TH);
    if (outcome) setPolar(outcome, r1, OUT_TH);
    if (pinboard) setPolar(pinboard, r1, GOAL_TH + 0.45);

    // Tools distributed around the circle excluding small gaps near goal/outcome
    const gap = 0.48;
    const arcs = [
      { start: GOAL_TH + gap, end: OUT_TH - gap },
      { start: OUT_TH + gap, end: GOAL_TH + 2 * Math.PI - gap }
    ];
    const toolCount = tools.length;
    const totalSpan = (arcs[0].end - arcs[0].start) + (arcs[1].end - arcs[1].start);
    const maxPerRing = 42;
    const ringStep = 95;
    const ringCount = Math.max(1, Math.ceil(toolCount / maxPerRing));
    for (let ring = 0; ring < ringCount; ring++) {
      const startIdx = ring * maxPerRing;
      const endIdx = Math.min(toolCount, startIdx + maxPerRing);
      const slice = tools.slice(startIdx, endIdx);
      const n = slice.length;
      const span0 = arcs[0].end - arcs[0].start;
      const radius = r1 + ring * ringStep;
      for (let i = 0; i < n; i++) {
        const tool = slice[i];
        const u = n === 1 ? 0.5 : (i / (n - 1));
        const dist = u * totalSpan;
        let theta;
        if (dist <= span0) theta = arcs[0].start + dist;
        else theta = arcs[1].start + (dist - span0);
        // stable jitter to reduce exact overlaps
        const j = ((_hash32(tool.id) % 997) / 997 - 0.5) * 0.09;
        setPolar(tool, radius, theta + j);
      }
    }

    // Ring 2: files around full circle
    const fileCount = files.length;
    for (let i = 0; i < fileCount; i++) {
      const f = files[i];
      const theta = -Math.PI + (2 * Math.PI) * (fileCount === 1 ? 0.5 : (i / fileCount));
      const j = ((_hash32(f.id) % 997) / 997 - 0.5) * 0.05;
      setPolar(f, r2, theta + j);
    }

    // Helper: angle of a node if placed, else deterministic by id
    const angleOf = (nodeId) => {
      const p = positions[nodeId];
      if (p) return p.theta;
      const h = _hash32(nodeId);
      return -Math.PI + (2 * Math.PI) * ((h % 1000) / 1000);
    };

    // Build parent links for diffs/blocks/pins (use edges)
    const parentsByChild = Object.create(null); // childId -> parentId (first)
    for (const e of edges) {
      if (!e || !e.from || !e.to) continue;
      // Prefer file->diff, tool->file, tool->block, pin->file, etc.
      if (!parentsByChild[e.to]) parentsByChild[e.to] = e.from;
    }

    const placeClusterAroundParent = (arr, radius, spread) => {
      const grouped = new Map(); // parentId -> node[]
      for (const n of arr) {
        const parent = parentsByChild[n.id] || '';
        const key = parent || 'root';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(n);
      }
      for (const [parentId, list] of grouped.entries()) {
        const base = angleOf(parentId === 'root' ? root.id : parentId);
        const count = list.length;
        const sorted = _stableSort(list, n => String(n.id));
        for (let i = 0; i < count; i++) {
          const n = sorted[i];
          const u = count === 1 ? 0 : (i / (count - 1) - 0.5);
          const theta = base + u * spread;
          const j = ((_hash32(n.id) % 997) / 997 - 0.5) * 0.04;
          setPolar(n, radius, theta + j);
        }
      }
    };

    // Ring 3: diffs + blocks around their parents (spread based on density)
    const heavy = (diffs.length + blocks.length) > 120;
    placeClusterAroundParent(diffs, r3, heavy ? 1.2 : 0.9);
    placeClusterAroundParent(blocks, r3, heavy ? 1.2 : 0.9);

    // Pins: place slightly inside ring3 so they don't collide with diff/blob cluster
    placeClusterAroundParent(pins, r3 - 120, 0.7);

    // Finalize bounds padding
    if (bounds.minX === Infinity) {
      bounds.minX = 0; bounds.minY = 0; bounds.maxX = 0; bounds.maxY = 0;
    }
    const pad = 160;
    bounds.minX -= pad; bounds.minY -= pad; bounds.maxX += pad; bounds.maxY += pad;

    // Ensure every node has a position (fallback)
    for (const n of nodes) {
      if (!n || positions[n.id]) continue;
      const theta = angleOf(n.id);
      const r = n.type === 'file' ? r2 : (n.type === 'tool' ? r1 : r3);
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      positions[n.id] = { x, y, r, theta };
      _updateBounds(bounds, x, y);
    }

    return { positions, bounds };
  }

  window.CodeonAetMapLayout = { layoutRadial };
})();


