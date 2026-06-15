// Interactive terminal panel (xterm.js in renderer + node-pty in main via IPC)
// Keep renderer/app.js changes minimal: this file self-initializes and hooks into the existing bottom panel tab system.

(function () {
  'use strict';

  const LOG_PREFIX = '[TerminalPanel]';
  const THEME_STORAGE_KEY = 'codeon.terminalTheme';

  function $(id) {
    return document.getElementById(id);
  }

  function safeText(s) {
    return String(s == null ? '' : s);
  }

  function getTerminalCtor() {
    try {
      // UMD builds sometimes export Terminal as a function or as { Terminal }
      if (typeof window.Terminal === 'function') return window.Terminal;
      if (window.Terminal && typeof window.Terminal.Terminal === 'function') return window.Terminal.Terminal;
      return null;
    } catch {
      return null;
    }
  }

  function getFitAddonCtor() {
    try {
      // UMD builds usually export FitAddon as { FitAddon }
      if (window.FitAddon && typeof window.FitAddon.FitAddon === 'function') return window.FitAddon.FitAddon;
      if (typeof window.FitAddon === 'function') return window.FitAddon;
      return null;
    } catch {
      return null;
    }
  }

  function hasTerminalAPI() {
    const api = window.electronAPI;
    return !!(
      api &&
      typeof api.terminalCreate === 'function' &&
      typeof api.terminalKill === 'function' &&
      typeof api.terminalWrite === 'function' &&
      typeof api.terminalResize === 'function' &&
      typeof api.onTerminalData === 'function' &&
      typeof api.onTerminalExit === 'function'
    );
  }

  function setOverlay(msg) {
    const overlay = $('terminalOverlay');
    if (!overlay) return;
    const text = safeText(msg).trim();
    overlay.textContent = text;
    overlay.style.display = text ? '' : 'none';
  }

  function setStatus(text) {
    const el = $('terminalStatus');
    if (!el) return;
    el.textContent = safeText(text) || '—';
  }

  function setKillEnabled(enabled) {
    const btn = $('terminalKillBtn');
    if (btn) btn.disabled = enabled !== true;
  }

  function tryCall(fn) {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  function getThemePresets() {
    // xterm theme API: https://xtermjs.org/docs/api/terminal/interfaces/itheme/
    // Keep this list small and high-quality; these are popular developer themes.
    return {
      codeonDark: {
        background: '#0b1220',
        foreground: '#e5e7eb',
        cursor: '#22d3ee',
        selectionBackground: 'rgba(34, 211, 238, 0.25)',
        black: '#0b1220',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#a78bfa',
        cyan: '#22d3ee',
        white: '#e5e7eb',
        brightBlack: '#334155',
        brightRed: '#fca5a5',
        brightGreen: '#6ee7b7',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#c4b5fd',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      vscodeDark: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selectionBackground: 'rgba(38, 79, 120, 0.55)',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
      oneDark: {
        background: '#282c34',
        foreground: '#abb2bf',
        cursor: '#61afef',
        selectionBackground: 'rgba(97, 175, 239, 0.22)',
        black: '#282c34',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#e5c07b',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#abb2bf',
        brightBlack: '#5c6370',
        brightRed: '#e06c75',
        brightGreen: '#98c379',
        brightYellow: '#e5c07b',
        brightBlue: '#61afef',
        brightMagenta: '#c678dd',
        brightCyan: '#56b6c2',
        brightWhite: '#ffffff',
      },
      dracula: {
        background: '#282a36',
        foreground: '#f8f8f2',
        cursor: '#ff79c6',
        selectionBackground: 'rgba(189, 147, 249, 0.28)',
        black: '#21222c',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#6272a4',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff',
      },
      gruvboxDark: {
        background: '#282828',
        foreground: '#ebdbb2',
        cursor: '#fabd2f',
        selectionBackground: 'rgba(250, 189, 47, 0.20)',
        black: '#282828',
        red: '#cc241d',
        green: '#98971a',
        yellow: '#d79921',
        blue: '#458588',
        magenta: '#b16286',
        cyan: '#689d6a',
        white: '#a89984',
        brightBlack: '#928374',
        brightRed: '#fb4934',
        brightGreen: '#b8bb26',
        brightYellow: '#fabd2f',
        brightBlue: '#83a598',
        brightMagenta: '#d3869b',
        brightCyan: '#8ec07c',
        brightWhite: '#ebdbb2',
      }
    };
  }

  function getSelectedThemeId() {
    try {
      const v = String(localStorage.getItem(THEME_STORAGE_KEY) || '').trim();
      return v || 'codeonDark';
    } catch {
      return 'codeonDark';
    }
  }

  function setSelectedThemeId(themeId) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, String(themeId || 'codeonDark'));
    } catch {
      // ignore
    }
  }

  function getCurrentTheme() {
    const presets = getThemePresets();
    const id = getSelectedThemeId();
    return presets[id] || presets.codeonDark;
  }

  function applyThemeToAllSessions() {
    const theme = getCurrentTheme();
    try {
      // Keep host background in sync with theme
      const hostFrame = $('terminalXtermHost');
      if (hostFrame && theme && theme.background) hostFrame.style.background = String(theme.background);
    } catch { /* ignore */ }

    for (const s of _sessions.values()) {
      try { s.term?.setOption?.('theme', theme); } catch { /* ignore */ }
      try { if (s.term?.options) s.term.options.theme = theme; } catch { /* ignore */ }
    }
  }

  // Sessions (multi-terminal tabs)
  // sessionId == terminalId (from main) for simplicity.
  let _started = false; // whether we have bootstrapped subscriptions + UI
  let _activeSessionId = null;
  let _sessions = new Map(); // Map<sessionId, { terminalId, term, fit, hostEl, title, status, mode }>
  let _sessionOrder = []; // string[]
  let _resizeObs = null;
  let _unsubscribeFns = [];
  let _lastProject = null;
  let _terminalTabCtxSessionId = null;
  let _terminalTabCtxBound = false;

  function getActiveSession() {
    if (!_activeSessionId) return null;
    return _sessions.get(String(_activeSessionId)) || null;
  }

  function getTerminalTabContextMenuEls() {
    return {
      menu: $('terminalTabContextMenu'),
      close: $('terminalCtxClose'),
      closeOthers: $('terminalCtxCloseOthers'),
    };
  }

  function hideTerminalTabContextMenu() {
    const { menu } = getTerminalTabContextMenuEls();
    if (menu) menu.style.display = 'none';
    _terminalTabCtxSessionId = null;
  }

  function positionContextMenuAt(menu, x, y) {
    if (!menu) return;
    // Ensure it can be measured
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const rect = menu.getBoundingClientRect();
    const pad = 10;
    let left = Math.round(Number(x || 0));
    let top = Math.round(Number(y || 0));
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = '';
  }

  function showTerminalTabContextMenu(e, sessionId) {
    const { menu, closeOthers } = getTerminalTabContextMenuEls();
    if (!menu) return;
    try { e?.preventDefault?.(); } catch { /* ignore */ }
    try { e?.stopPropagation?.(); } catch { /* ignore */ }

    _terminalTabCtxSessionId = String(sessionId || '');

    // Disable "close others" when there aren't others.
    try {
      const hasOthers = _sessionOrder.filter(x => x && x !== _terminalTabCtxSessionId).length > 0;
      if (closeOthers) closeOthers.classList.toggle('disabled', !hasOthers);
    } catch { /* ignore */ }

    // Portal to <body> to avoid clipping by panels
    try { if (menu.parentElement !== document.body) document.body.appendChild(menu); } catch { /* ignore */ }

    positionContextMenuAt(menu, e?.clientX, e?.clientY);
    menu.style.display = 'block';
  }

  function bindTerminalTabContextMenuOnce() {
    if (_terminalTabCtxBound) return;
    _terminalTabCtxBound = true;
    const { menu, close, closeOthers } = getTerminalTabContextMenuEls();
    if (!menu) return;

    // Actions
    if (close && !close.__codeonBound) {
      close.__codeonBound = true;
      close.addEventListener('click', async (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
        const sid = String(_terminalTabCtxSessionId || '');
        hideTerminalTabContextMenu();
        if (!sid) return;
        await closeSession(sid, 'ctx-close');
      });
    }
    if (closeOthers && !closeOthers.__codeonBound) {
      closeOthers.__codeonBound = true;
      closeOthers.addEventListener('click', async (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch { /* ignore */ }
        const sid = String(_terminalTabCtxSessionId || '');
        hideTerminalTabContextMenu();
        if (!sid) return;
        const toClose = _sessionOrder.filter(x => x && x !== sid);
        for (const id of toClose) {
          // sequential to avoid hammering IPC
          await closeSession(id, 'ctx-close-others');
        }
      });
    }

    // Hide on outside click / escape / blur
    document.addEventListener('mousedown', (e) => {
      try {
        if (!menu || menu.style.display === 'none') return;
        if (e?.target && e.target.closest && e.target.closest('#terminalTabContextMenu')) return;
        hideTerminalTabContextMenu();
      } catch { /* ignore */ }
    }, true);
    document.addEventListener('keydown', (e) => {
      try {
        if (e.key === 'Escape') hideTerminalTabContextMenu();
      } catch { /* ignore */ }
    }, true);
    window.addEventListener('blur', () => {
      try { hideTerminalTabContextMenu(); } catch { /* ignore */ }
    });
    window.addEventListener('resize', () => {
      try { hideTerminalTabContextMenu(); } catch { /* ignore */ }
    });
  }

  function setActiveSession(sessionId) {
    const sid = String(sessionId || '');
    if (!sid || !_sessions.has(sid)) return;
    _activeSessionId = sid;

    // Toggle DOM
    for (const [id, s] of _sessions.entries()) {
      try {
        s.hostEl?.classList?.toggle?.('active', id === sid);
      } catch {
        // ignore
      }
    }
    renderTabs();

    // Fit after visibility change
    setTimeout(() => fitAndResizeBestEffort(), 30);
  }

  async function killSessionById(terminalId, reason = '') {
    const api = window.electronAPI;
    const id = String(terminalId || '');
    if (!id) return;
    if (api && typeof api.terminalKill === 'function') {
      try {
        await api.terminalKill({ terminalId: id, reason: String(reason || '') });
      } catch {
        // ignore
      }
    }
  }

  async function closeSession(sessionId, reason = '') {
    const sid = String(sessionId || '');
    const s = _sessions.get(sid);
    if (!s) return;

    // Kill PTY first
    if (s.mode === 'pty') {
      await killSessionById(s.terminalId, reason);
    }

    // Dispose xterm
    try { s.term?.dispose?.(); } catch { /* ignore */ }
    try { s.hostEl?.remove?.(); } catch { /* ignore */ }
    _sessions.delete(sid);
    _sessionOrder = _sessionOrder.filter(x => x !== sid);

    // Pick next active
    if (_activeSessionId === sid) {
      _activeSessionId = _sessionOrder.length ? _sessionOrder[_sessionOrder.length - 1] : null;
    }
    if (_activeSessionId) setActiveSession(_activeSessionId);
    renderTabs();
    updateToolbarState();
  }

  async function closeAllSessions(reason = '') {
    const ids = Array.from(_sessionOrder);
    for (const id of ids) {
      // sequential to avoid hammering IPC
      await closeSession(id, reason);
    }
    setStatus('Not started');
    setOverlay('');
  }

  function fitAndResizeBestEffort() {
    const api = window.electronAPI;
    const s = getActiveSession();
    if (!s || !s.term || !s.fit || !s.terminalId || !api || typeof api.terminalResize !== 'function') return;

    try { s.fit.fit(); } catch { /* ignore */ }

    let dims = null;
    try { dims = s.fit.proposeDimensions?.(); } catch { dims = null; }
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;

    try {
      api.terminalResize(s.terminalId, dims.cols, dims.rows);
    } catch {
      // ignore
    }
  }

  function updateToolbarState() {
    const s = getActiveSession();
    setKillEnabled(!!(s && s.mode === 'pty' && s.terminalId));
  }

  function renderTabs() {
    const tabsEl = $('terminalTabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    for (const sid of _sessionOrder) {
      const s = _sessions.get(sid);
      if (!s) continue;
      const btn = document.createElement('div');
      btn.className = 'terminal-tab' + (sid === _activeSessionId ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', sid === _activeSessionId ? 'true' : 'false');
      btn.title = s.status ? `${s.title} — ${s.status}` : s.title;
      btn.innerHTML = `<span>${escapeHtml(s.title)}</span><span class="terminal-tab-close" title="Close">×</span>`;
      btn.addEventListener('click', (e) => {
        const t = e && e.target;
        if (t && t.classList && t.classList.contains('terminal-tab-close')) {
          e.preventDefault();
          e.stopPropagation();
          closeSession(sid, 'close-tab');
          return;
        }
        setActiveSession(sid);
      });
      btn.addEventListener('contextmenu', (e) => {
        showTerminalTabContextMenu(e, sid);
      });
      tabsEl.appendChild(btn);
    }
  }

  function escapeHtml(str) {
    const s = String(str ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function createSession() {
    const hostFrame = $('terminalXtermHost');
    const hostRoot = $('terminalXtermInner');
    if (!hostFrame || !hostRoot) return null;

    const TerminalCtor = getTerminalCtor();
    const FitAddonCtor = getFitAddonCtor();
    if (!TerminalCtor || !FitAddonCtor) return null;

    setOverlay('');
    setStatus('Starting…');

    // Spawn PTY first
    let createRes = null;
    try {
      createRes = await window.electronAPI.terminalCreate({ cols: 80, rows: 24 });
    } catch (e) {
      setOverlay('Failed to start terminal.\n\n' + safeText(e && e.message ? e.message : e));
      setStatus('Failed');
      return null;
    }

    if (!createRes || createRes.success !== true || !createRes.terminalId) {
      let msg = safeText(createRes && createRes.error ? createRes.error : 'Unknown error');
      try {
        const details = createRes && createRes.details ? createRes.details : null;
        if (details) msg += '\n\n' + safeText(JSON.stringify(details, null, 2));
      } catch { /* ignore */ }
      setOverlay('Failed to start terminal.\n\n' + msg);
      setStatus('Failed');
      return null;
    }

    const terminalId = String(createRes.terminalId);
    _lastProject = safeText(createRes.projectPath || '');

    // Create a per-session host
    const sessionHost = document.createElement('div');
    sessionHost.className = 'terminal-session';
    sessionHost.dataset.terminalId = terminalId;
    hostRoot.appendChild(sessionHost);

    // Create UI terminal
    const term = new TerminalCtor({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      theme: getCurrentTheme(),
      scrollback: 5000,
      convertEol: true,
    });
    const fit = new FitAddonCtor();
    try { term.loadAddon(fit); } catch { /* ignore */ }
    term.open(sessionHost);

    // Keystrokes -> PTY
    term.onData((data) => {
      try {
        window.electronAPI.terminalWrite(terminalId, data);
      } catch {
        // ignore
      }
    });

    // Register session (PTY-backed)
    const nextIndex = _sessionOrder.length + 1;
    const title = `Term ${nextIndex}`;
    const session = { terminalId, term, fit, hostEl: sessionHost, title, status: 'Running', mode: 'pty' };
    _sessions.set(terminalId, session);
    _sessionOrder.push(terminalId);

    // Activate it
    setActiveSession(terminalId);
    sessionHost.classList.add('active');
    setStatus('Running');
    updateToolbarState();

    // Observe hostFrame for resize
    if (!_resizeObs) {
      try {
        _resizeObs = new ResizeObserver(() => {
          tryCall(() => fitAndResizeBestEffort());
        });
        _resizeObs.observe(hostFrame);
      } catch {
        _resizeObs = null;
      }
      window.addEventListener('resize', fitAndResizeBestEffort);
    }

    // Fit + resize now
    setTimeout(() => fitAndResizeBestEffort(), 30);
    return session;
  }

  function ensureLogSession(sessionId, title) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    const existing = _sessions.get(sid);
    if (existing) return existing;

    const hostRoot = $('terminalXtermInner');
    if (!hostRoot) return null;

    const TerminalCtor = getTerminalCtor();
    const FitAddonCtor = getFitAddonCtor();
    if (!TerminalCtor || !FitAddonCtor) return null;

    const sessionHost = document.createElement('div');
    sessionHost.className = 'terminal-session';
    sessionHost.dataset.terminalId = sid;
    hostRoot.appendChild(sessionHost);

    const term = new TerminalCtor({
      cursorBlink: false,
      disableStdin: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      theme: getCurrentTheme(),
      scrollback: 8000,
      convertEol: true,
    });
    const fit = new FitAddonCtor();
    try { term.loadAddon(fit); } catch { /* ignore */ }
    term.open(sessionHost);

    const sess = {
      terminalId: null,
      term,
      fit,
      hostEl: sessionHost,
      title: String(title || 'AI Bash'),
      status: 'Log',
      mode: 'log'
    };
    _sessions.set(sid, sess);
    _sessionOrder.push(sid);
    renderTabs();
    return sess;
  }

  function activateTerminalPanel() {
    try {
      const tab = document.querySelector('.console-tab[data-tab="terminal"]');
      if (tab) tab.click();
    } catch {
      // ignore
    }
  }

  function ensureAiBashSession(chatSessionId, { reveal = true } = {}) {
    const sid = String(chatSessionId || '').trim();
    if (!sid) return null;
    if (!_started) {
      // Lazily start subscriptions so we can render logs even if the user never opened the terminal panel.
      try { startSessionIfNeeded(); } catch { /* ignore */ }
    }
    const key = `ai-bash:${sid}`;
    const short = sid.length > 6 ? sid.slice(0, 6) : sid;
    const title = `AI Bash · ${short}`;
    const sess = ensureLogSession(key, title);
    if (!sess) return null;
    setActiveSession(key);
    if (reveal) activateTerminalPanel();
    updateToolbarState();
    setTimeout(() => fitAndResizeBestEffort(), 30);
    return key;
  }

  function appendToSession(sessionKey, text) {
    const key = String(sessionKey || '').trim();
    const s = _sessions.get(key);
    if (!s || !s.term) return;
    const out = String(text == null ? '' : text);
    if (!out) return;
    try {
      // Normalize to CRLF-ish for terminal rendering
      const normalized = out.replace(/\r?\n/g, '\r\n');
      s.term.write(normalized);
    } catch {
      // ignore
    }
  }

  async function startSessionIfNeeded() {
    if (_started) return;

    const hostFrame = $('terminalXtermHost');
    const host = $('terminalXtermInner');
    if (!hostFrame || !host) {
      console.warn(LOG_PREFIX, 'Missing terminal host elements');
      return;
    }

    if (!hasTerminalAPI()) {
      setOverlay(
        'Terminal is not available.\n\n' +
          'Missing IPC API: electronAPI.terminalCreate / terminalWrite / terminalResize.\n' +
          'Make sure preload + main terminal IPC are wired, and dependencies are installed.'
      );
      setStatus('Unavailable');
      return;
    }

    _started = true;
    setOverlay('');
    setStatus('Not started');

    // Subscribe once and route PTY -> correct terminal tab
    const onDataUnsub = window.electronAPI.onTerminalData((payload) => {
      try {
        if (!payload || !payload.terminalId) return;
        const tid = String(payload.terminalId);
        const s = _sessions.get(tid);
        if (!s || !s.term) return;
        const chunk = safeText(payload.data);
        if (chunk) s.term.write(chunk);
      } catch {
        // ignore
      }
    });
    const onExitUnsub = window.electronAPI.onTerminalExit((payload) => {
      try {
        if (!payload || !payload.terminalId) return;
        const tid = String(payload.terminalId);
        const s = _sessions.get(tid);
        if (!s) return;
        const code = Number(payload.exitCode);
        s.status = Number.isFinite(code) ? `Exited (${code})` : 'Exited';
        if (tid === _activeSessionId) {
          setStatus(s.status);
          updateToolbarState();
        }
        renderTabs();
      } catch {
        // ignore
      }
    });
    if (typeof onDataUnsub === 'function') _unsubscribeFns.push(onDataUnsub);
    if (typeof onExitUnsub === 'function') _unsubscribeFns.push(onExitUnsub);
  }

  function isTerminalTabActive() {
    const content = $('terminalContent');
    return !!(content && content.classList.contains('active'));
  }

  function maybeStartOnActivate() {
    if (!isTerminalTabActive()) return;
    startSessionIfNeeded().then(() => {
      // If no sessions yet, auto-create the first one on first open
      if (_sessionOrder.length === 0) {
        createSession().catch(() => { /* ignore */ });
      }
      // Fit after the tab becomes visible (layout settles)
      setTimeout(() => fitAndResizeBestEffort(), 50);
    });
  }

  function bindButtons() {
    const newBtn = $('terminalNewBtn');
    const clearBtn = $('terminalClearBtn');
    const killBtn = $('terminalKillBtn');

    if (newBtn) {
      newBtn.addEventListener('click', async () => {
        await startSessionIfNeeded();
        await createSession();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        try {
          const s = getActiveSession();
          if (s && s.term) {
            s.term.clear();
            // Many CLIs expect a fresh prompt redraw; send a newline
            if (s.terminalId) window.electronAPI.terminalWrite(s.terminalId, '\r');
          }
        } catch {
          // ignore
        }
      });
    }

    if (killBtn) {
      killBtn.addEventListener('click', async () => {
        const s = getActiveSession();
        if (!s) return;
        setStatus('Stopping…');
        await closeSession(s.terminalId, 'user-kill');
        if (_sessionOrder.length === 0) {
          setStatus('Stopped');
        } else {
          const a = getActiveSession();
          setStatus(a && a.status ? a.status : 'Running');
        }
      });
    }
  }

  function bindThemeSelect() {
    const sel = $('terminalThemeSelect');
    if (!sel) return;
    const presets = getThemePresets();
    const saved = getSelectedThemeId();
    if (presets[saved]) sel.value = saved;
    else sel.value = 'codeonDark';

    sel.addEventListener('change', () => {
      const next = String(sel.value || 'codeonDark');
      setSelectedThemeId(presets[next] ? next : 'codeonDark');
      applyThemeToAllSessions();
      // Fit after theme change (font metrics can change subtly depending on colors + padding)
      setTimeout(() => fitAndResizeBestEffort(), 30);
    });

    // Apply at startup (handles first session creation)
    applyThemeToAllSessions();
  }

  function bindTabActivationHook() {
    // The main app toggles .active on #terminalContent; observe it so we can lazily start/focus
    const content = $('terminalContent');
    if (!content) return;

    const obs = new MutationObserver(() => {
      maybeStartOnActivate();
    });
    obs.observe(content, { attributes: true, attributeFilter: ['class'] });

    // Also hook the tab click (helps when the class toggles quickly)
    const tab = document.querySelector('.console-tab[data-tab="terminal"]');
    if (tab) {
      tab.addEventListener('click', () => {
        setTimeout(() => maybeStartOnActivate(), 0);
      });
    }
  }

  function bindProjectSwitchRestart() {
    const api = window.electronAPI;
    if (!api || typeof api.onFolderOpened !== 'function') return;

    api.onFolderOpened((data) => {
      try {
        const nextProject = safeText(data && (data.path || data.folderPath || data.projectPath));
        if (!nextProject) return;
        if (_lastProject && nextProject === _lastProject) return;
        _lastProject = nextProject;

        // Close all sessions on project change (so cwd stays correct + safe)
        if (_started && _sessionOrder.length > 0) {
          setStatus('Project changed — closing terminals…');
          closeAllSessions('project-changed').catch(() => { /* ignore */ });
        }
      } catch {
        // ignore
      }
    });
  }

  function init() {
    const content = $('terminalContent');
    const hostFrame = $('terminalXtermHost');
    const host = $('terminalXtermInner');
    if (!content || !hostFrame || !host) return;

    bindTerminalTabContextMenuOnce();
    bindButtons();
    bindThemeSelect();
    bindTabActivationHook();
    bindProjectSwitchRestart();

    // If the Terminal tab is already active on load, start immediately.
    maybeStartOnActivate();
  }

  // Expose a tiny hook (optional) and self-init.
  window.codeonTerminalPanel = {
    init,
    onTabActivated: () => {
      maybeStartOnActivate();
    },
    // Public API (best-effort) used by other renderer modules:
    ensureAiBashSession,
    appendToSession,
    activateTerminalPanel
  };

  // Scripts are loaded at end of body; DOM is ready enough.
  try {
    init();
  } catch (e) {
    console.warn(LOG_PREFIX, 'Init failed:', e);
  }
})();


