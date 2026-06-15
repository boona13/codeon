// Lightweight perf utilities for the renderer (no bundler / no imports).
// Exposes `window.codeonPerf` for modules to use.
(function () {
  if (window.codeonPerf) return;

  const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const now = () => {
    try {
      return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
    } catch {
      return Date.now();
    }
  };

  const microtask = (fn) => {
    try {
      Promise.resolve().then(fn);
    } catch {
      setTimeout(fn, 0);
    }
  };

  const idle = (fn, { timeout = 250 } = {}) => {
    try {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => {
          try { fn(); } catch { /* ignore */ }
        }, { timeout });
        return;
      }
    } catch { /* ignore */ }
    setTimeout(() => { try { fn(); } catch { /* ignore */ } }, 0);
  };

  const isDebugEnabled = () => {
    try {
      if (window.__CODEON_PERF_DEBUG === true) return true;
      if (window.localStorage && window.localStorage.getItem('codeon_perf_debug') === '1') return true;
    } catch { /* ignore */ }
    return false;
  };

  const mark = (name) => {
    try {
      if (!isDebugEnabled()) return;
      if (typeof performance === 'undefined' || !performance || typeof performance.mark !== 'function') return;
      performance.mark(String(name || 'mark'));
    } catch { /* ignore */ }
  };

  const measure = (name, startMark, endMark) => {
    try {
      if (!isDebugEnabled()) return null;
      if (typeof performance === 'undefined' || !performance || typeof performance.measure !== 'function') return null;
      const n = String(name || 'measure');
      const s = String(startMark || '');
      const e = String(endMark || '');
      const entry = (s && e) ? performance.measure(n, s, e)
        : (s ? performance.measure(n, s) : performance.measure(n));
      return entry || null;
    } catch {
      return null;
    }
  };

  const stats = {
    longTasks: { count: 0, maxMs: 0, last: [] }
  };

  const observeLongTasks = ({ maxEntries = 30 } = {}) => {
    try {
      if (!isDebugEnabled()) return;
      if (typeof PerformanceObserver !== 'function') return;
      const obs = new PerformanceObserver((list) => {
        try {
          const entries = list.getEntries ? list.getEntries() : [];
          for (const e of entries) {
            const d = Number(e && e.duration) || 0;
            stats.longTasks.count += 1;
            if (d > stats.longTasks.maxMs) stats.longTasks.maxMs = d;
            stats.longTasks.last.push({ at: Date.now(), duration: d, name: String(e && e.name || '') });
            if (stats.longTasks.last.length > maxEntries) stats.longTasks.last = stats.longTasks.last.slice(-maxEntries);
            // Keep logs opt-in only.
            console.warn(`[Perf] Long task: ${Math.round(d)}ms`, e);
          }
        } catch { /* ignore */ }
      });
      obs.observe({ entryTypes: ['longtask'] });
      return obs;
    } catch {
      return null;
    }
  };

  // Run a loop but yield to the browser periodically to keep the UI responsive.
  // `work(item)` may be sync or async.
  const runChunked = async (items, work, { budgetMs = 10 } = {}) => {
    const list = Array.isArray(items) ? items : [];
    const fn = typeof work === 'function' ? work : async () => {};
    let t0 = now();
    for (const it of list) {
      await fn(it);
      const t1 = now();
      if ((t1 - t0) >= budgetMs) {
        t0 = t1;
        await raf();
      }
    }
  };

  window.codeonPerf = { raf, now, microtask, idle, runChunked, isDebugEnabled, mark, measure, observeLongTasks, stats };

  // Opt-in instrumentation (no UX impact unless explicitly enabled).
  // Enable via: localStorage.setItem('codeon_perf_debug','1') then reload.
  try {
    if (isDebugEnabled()) {
      observeLongTasks();
    }
  } catch { /* ignore */ }
})();


