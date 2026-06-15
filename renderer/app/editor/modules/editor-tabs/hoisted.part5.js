// ---- CHUNK 5/7 from hoisted.js (AST statement boundaries; order preserved) ----


function setupResizing() {
  // Sidebar (Left Panel)
  const sidebar = document.getElementById('sidebar');
  const sidebarHandle = document.getElementById('sidebarResize');
  setupPanelResize(sidebar, sidebarHandle, 'right', 150, 600);

  // Chat Panel (Right Panel)
  const chatPanel = document.getElementById('chatPanel');
  const chatHandle = document.getElementById('chatResize');
  // Keep enough width so composer controls don't overlap
  setupPanelResize(chatPanel, chatHandle, 'left', 490, 800);

  // Console Panel (Bottom Panel)
  const consolePanel = document.getElementById('consolePanel');
  const consoleHandle = document.getElementById('consoleResize');
  // Max height should respect the center column height (avoid starving the editor).
  const mainContent = document.querySelector('.main-content');
  const mainH = mainContent?.getBoundingClientRect?.().height || window.innerHeight;
  const maxConsoleH = Math.max(140, mainH - 180); // keep ~180px minimum for editor/tabs
  setupVerticalResize(consolePanel, consoleHandle, 100, maxConsoleH);

  // After any layout-affecting changes (esp. console height), Monaco can get "stale" and clip.
  // This observer forces a relayout whenever the editor column (or console) changes size.
  setupMonacoLayoutObserversOnce();
}

function scheduleMonacoLayout() {
  try {
    if (__monacoLayoutRaf) cancelAnimationFrame(__monacoLayoutRaf);
    __monacoLayoutRaf = requestAnimationFrame(() => {
      __monacoLayoutRaf = 0;
      try { editor?.layout?.(); } catch { /* ignore */ }
      try { diffEditor?.layout?.(); } catch { /* ignore */ }
    });
  } catch {
    // ignore
  }
}


function setupMonacoLayoutObserversOnce() {
  if (window.__monacoLayoutObserversSetup) return;
  window.__monacoLayoutObserversSetup = true;

  scheduleMonacoLayout();
  setTimeout(scheduleMonacoLayout, 0);
  setTimeout(scheduleMonacoLayout, 200);

  // Fallback for cases where Monaco's `automaticLayout` misses grid/flex changes.
  if (typeof ResizeObserver !== 'undefined') {
    try {
      const ro = new ResizeObserver(() => scheduleMonacoLayout());
      const editorContainer = document.querySelector('.editor-container');
      const consolePanel = document.getElementById('consolePanel');
      if (editorContainer) ro.observe(editorContainer);
      if (consolePanel) ro.observe(consolePanel);
      window.__monacoLayoutObserver = ro;
    } catch {
      // ignore
    }
  }

  window.addEventListener('resize', () => scheduleMonacoLayout(), { passive: true });
}


function setupPanelResize(panel, handle, direction, minWidth, maxWidth) {
  if (!panel || !handle) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;

    // Disable transitions during resize for smooth performance
    panel.style.transition = 'none';

    handle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    // Add overlay to prevent events being captured by iframes/editor
    const overlay = document.createElement('div');
    overlay.id = 'resize-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.zIndex = '9999';
    overlay.style.cursor = 'col-resize';
    document.body.appendChild(overlay);
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    e.preventDefault(); // Prevent selection

    let newWidth;
    if (direction === 'right') {
      // Resizing from left side (sidebar)
      const delta = e.clientX - startX;
      newWidth = startWidth + delta;
    } else {
      // Resizing from right side (chat panel) - inverse delta
      const delta = startX - e.clientX;
      newWidth = startWidth + delta;
    }

    // Clamp so resizing always responds immediately, even if the starting width is outside bounds.
    // Without clamping, the panel can appear "stuck" until the cursor crosses into the valid range.
    try {
      const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
      panel.style.width = `${clamped}px`;
      // Force layout update for editors
      if (editor) editor.layout();
      if (diffEditor) diffEditor.layout();
    } catch {
      // ignore
    }
  });

  const stopResize = () => {
    if (isResizing) {
      isResizing = false;
      
      // Re-enable transitions
      panel.style.transition = '';
      
      handle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const overlay = document.getElementById('resize-overlay');
      if (overlay) overlay.remove();

      // Final layout update
      if (editor) editor.layout();
    }
  };

  document.addEventListener('mouseup', stopResize);
  document.addEventListener('mouseleave', (e) => {
    // Only stop if leaving the window
    if (e.relatedTarget === null) stopResize();
  });
}


function setupVerticalResize(panel, handle, minHeight, maxHeight) {
  if (!panel || !handle) return;

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = panel.getBoundingClientRect().height;

    // Disable transitions during resize
    panel.style.transition = 'none';

    handle.classList.add('resizing');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    // Add overlay to prevent events being captured by iframes/editor
    const overlay = document.createElement('div');
    overlay.id = 'resize-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.zIndex = '9999';
    overlay.style.cursor = 'ns-resize';
    document.body.appendChild(overlay);
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    e.preventDefault();

    // Dragging up increases height (negative delta)
    const delta = startY - e.clientY;
    const newHeight = startHeight + delta;

    if (newHeight >= minHeight && newHeight <= maxHeight) {
      panel.style.height = `${newHeight}px`;
      // Force layout update for editor
      if (editor) editor.layout();
    }
  });

  const stopResize = () => {
    if (isResizing) {
      isResizing = false;
      
      // Re-enable transitions
      panel.style.transition = '';
      
      handle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const overlay = document.getElementById('resize-overlay');
      if (overlay) overlay.remove();

      // Final layout update
      if (editor) editor.layout();
    }
  };

  document.addEventListener('mouseup', stopResize);
  document.addEventListener('mouseleave', (e) => {
    if (e.relatedTarget === null) stopResize();
  });
}


// Open folder
async function openFolder() {
  if (window.electronAPI) {
    const result = await window.electronAPI.openFolderDialog();
    if (result.success) {
      await handleFolderOpened(result);
    }
  }
}


// Handle folder opened
async function handleFolderOpened(data) {
  // Safety: pause-before-next-tool should never "stick" across app/window reloads.
  // On macOS, the window can be reopened/reloaded while the main process (and Claude SDK hook state) stays alive.
  // Reset both renderer + main pause state on project open so UI and enforcement never diverge.
  try {
    window._pauseBeforeNextToolBySession = {};
    // Best-effort: clear any pause state cached in the main process.
    if (window.electronAPI && typeof window.electronAPI.claudeSdkResetPauseState === 'function') {
      await window.electronAPI.claudeSdkResetPauseState({ uiSessionId: null });
    }
  } catch { /* ignore */ }

  const nextPath = String(data?.path || '').trim();
  const prevPath = String(currentFolder || '').trim();
  const prevNorm = normalizeFsPath(prevPath).replace(/\/+$/, '');
  const nextNorm = normalizeFsPath(nextPath).replace(/\/+$/, '');

  // If switching projects while another is open (menu-open allows this), fully reset in-memory state
  // to prevent mixing tabs/sessions between workspaces.
  if (prevNorm && nextNorm && prevNorm !== nextNorm) {
    // Guard against data loss: warn if there are unsaved editor tabs or active runs.
    try {
      const dirty = (editorTabs || []).filter(t => t && isTabDirty(t));
      const running = getRunningSessionIds({}); // for the currently loaded workspace
      if (dirty.length > 0 || running.length > 0) {
        const msg =
          `Switch projects?\n\n` +
          (dirty.length > 0 ? `• ${dirty.length} file tab(s) have unsaved changes\n` : '') +
          (running.length > 0 ? `• ${running.length} chat run(s) are still running\n` : '') +
          `\nUnsaved changes may be lost and running chats will be stopped.`;
        const ok = await customConfirm(msg, 'Switch Project');
        if (!ok) return;
      }
    } catch { /* ignore */ }

    // Flush current workspace state before we change currentFolder.
    try { await saveChatHistory(true); } catch { /* ignore */ }

    // Stop any in-flight runs (prevents cross-project event leakage).
    try {
      const running = getRunningSessionIds({});
      for (const sid of running) {
        await abortSessionRunNoRestore(sid, 'Stopped because you switched projects');
      }
    } catch { /* ignore */ }

    // Clear editor state (dispose models to avoid leaks).
    try { if (typeof exitDiffView === 'function') exitDiffView(); } catch { /* ignore */ }
    try {
      for (const tab of editorTabs || []) {
        try { tab?.model?.dispose?.(); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    editorTabs = [];
    activeEditorTabKey = null;
    currentFile = null;
    window.currentFile = null;
    lastDiffByRelPath = {};
    try { setTopFilePathLabel('No file open'); } catch { /* ignore */ }
    try {
      const empty = document.getElementById('editorEmptyState');
      if (empty) empty.style.display = '';
      renderEditorTabs();
      if (editor && typeof editor.setModel === 'function') editor.setModel(null);
    } catch { /* ignore */ }

    // Clear chat/session + per-session caches (these are project-scoped).
    chatHistory = [];
    chatSessions = {};
    currentSessionId = null;
    window.currentSessionId = null;
    hydratedChatSessionId = null;
    uiMetadata = {};
    messageSeqBySession = {};
    pendingAttachmentsBySession = {};
    activeAgentIdBySession = {};
    pendingSkillIdBySession = {};
    availableSkillScriptsBySession = {};
    consoleMessagesBySession = {};
    consoleIndicatorBySession = {};
    currentTodoList = [];
    runStateBySession = {};
    streamSnapshotTimerBySession = {};
    streamSnapshotLastSigBySession = {};
    streamSnapshotLastForcedSaveAtBySession = {};
    streamJournalTimerBySession = {};
    streamJournalLastSigBySession = {};
    streamRenderTimerBySession = {};
    streamRenderLastAtBySession = {};
    streamRenderPendingOptsBySession = {};
    try { window.__streamDomStateBySession = {}; } catch { /* ignore */ }

    // Clear AET (Agent Execution Timeline) data for the previous project
    try {
      if (typeof window.clearExecutionTimelineData === 'function') {
        window.clearExecutionTimelineData();
      }
    } catch { /* ignore */ }

    // Reset middle tab to Code (clears persisted tab from previous project)
    try {
      if (typeof window._resetMiddleTabToCode === 'function') {
        window._resetMiddleTabToCode();
      }
    } catch { /* ignore */ }

    // Clear UI containers so nothing from the previous workspace remains visible.
    try {
      const messagesContainer = document.getElementById('chatMessages');
      if (messagesContainer) messagesContainer.innerHTML = '';
      const tabsEl = document.getElementById('chatTabs');
      if (tabsEl) tabsEl.innerHTML = '';
      try { renderReceiptsForSession(''); } catch { /* ignore */ }
      try { renderConsoleForSession(''); } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  currentFolder = nextPath;
  window.currentFolder = nextPath;  // Expose to tools

  // MCP: ensure per-project MCP config exists so chat providers can see connected servers.
  // Some users connect MCP servers before opening a workspace; persist them as soon as a project opens.
  try {
    if (typeof window.loadMcpServers === 'function') {
      await window.loadMcpServers();
    }
  } catch (e) {
    console.warn('[MCP] Failed to sync MCP servers on project open:', e?.message || e);
  }

  // Hide welcome screen and show main app
  hideWelcomeScreen();

  // Add to recent projects
  await addToRecentProjects(nextPath);

  // Show project name (handle both Unix / and Windows \ path separators)
  const projectName = nextPath.split(/[/\\]/).pop() || nextPath;
  // We now show the project name in the sidebar header (replaces the redundant "Explorer" label).
  try {
    const sidebarTitleEl = document.getElementById('sidebarTitle');
    if (sidebarTitleEl) sidebarTitleEl.textContent = projectName;
  } catch { /* ignore */ }
  // Keep legacy element around but keep it hidden to avoid duplicate labels.
  try {
    const projectNameEl = document.getElementById('projectName');
    if (projectNameEl) {
      projectNameEl.textContent = projectName;
      projectNameEl.style.display = 'none';
    }
  } catch { /* ignore */ }

  workspaceFileTreeSnapshot = Array.isArray(data.files) ? data.files : [];

  // Now that a project is open (and main has currentProject), refresh Claude models list.
  // This fixes the case where the model dropdown only shows Default until the app is reloaded.
  try { refreshClaudeModelComposerSelect({ force: true }); } catch { /* ignore */ }
  renderFileTree(data.files);
  // Reset project problems scan when switching projects
  try {
    projectProblemsState.token++;
    projectProblemsState.status = 'idle';
    projectProblemsState.results = [];
    projectProblemsState.error = '';
    projectProblemsState.scannedFiles = 0;
    projectProblemsState.totalFiles = 0;
    projectProblemsState.truncated = false;
  } catch { /* ignore */ }
  // If Problems is enabled, start a debounced scan so the header count updates without opening the tab.
  try { scheduleProjectProblemsScan('project-open'); } catch { /* ignore */ }

  // Load chat sessions for this project
  await loadChatSessions();

  // Load project-scoped agents (if any)
  try { await loadProjectAgents(); } catch { /* ignore */ }

  // Load project-scoped skills (if any)
  try { await loadProjectSkills(); } catch { /* ignore */ }
  try { await refreshSkillScriptsForSession(currentSessionId); } catch { /* ignore */ }

  // Load type definitions from node_modules/@types for proper TypeScript intellisense
  try {
    if (typeof window.loadProjectTypeDefinitions === 'function') {
      await window.loadProjectTypeDefinitions();
    }
  } catch (e) {
    console.warn('[TypeDefs] Failed to load type definitions:', e?.message || e);
  }

  // UX: Prompt for Claude login after a project opens (only if needed).
  // This avoids confusing console errors and makes the next step obvious for new users.
  try { await maybePromptClaudeLoginOnProjectOpen(); } catch { /* ignore */ }
}


function explorerIsMac() {
  const p = window.electronAPI && typeof window.electronAPI.platform === 'string' ? window.electronAPI.platform : '';
  return p === 'darwin';
}


function explorerIsToggleSelectEvent(e) {
  // VS Code: Cmd on macOS, Ctrl on Windows/Linux
  if (!e) return false;
  return explorerIsMac() ? !!e.metaKey : !!e.ctrlKey;
}


function explorerIsEditableTarget(target) {
  const el = target && target.nodeType === 1 ? target : null;
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  // Monaco editor uses nested DOM; treat anything inside `.monaco-editor` as editable focus.
  if (el.closest && el.closest('.monaco-editor')) return true;
  return false;
}


function explorerAbsFromRel(relPath) {
  const base = String(currentFolder || '').replace(/\/+$/, '');
  const rel = String(relPath || '').replace(/^\/+/, '');
  return normalizeFsPath(`${base}/${rel}`);
}


function explorerExpandAncestorsForRel(relPath) {
  const rel = String(relPath || '').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!rel) return;
  const parts = rel.split('/').filter(Boolean);
  if (parts.length <= 1) return;
  try {
    if (!explorerExpandedAbsDirs) explorerExpandedAbsDirs = new Set();
    for (let i = 1; i < parts.length; i++) {
      const dirRel = parts.slice(0, i).join('/');
      const absDir = explorerAbsFromRel(dirRel);
      if (absDir) explorerExpandedAbsDirs.add(absDir);
    }
  } catch { /* ignore */ }
}


function explorerFindElByAbsPath(absPath) {
  const abs = String(absPath || '').trim();
  if (!abs) return null;
  const root = document.getElementById('fileTree');
  if (!root) return null;
  // Avoid brittle attribute selectors (paths contain slashes/quotes).
  const els = root.querySelectorAll('.file-item');
  for (const el of els) {
    const ds = el && el.dataset ? String(el.dataset.absPath || '').trim() : '';
    if (ds && ds === abs) return el;
  }
  return null;
}

function explorerRevealAbsPath(absPath) {
  const abs = String(absPath || '').trim();
  if (!abs) return;
  
  // Expand ancestors based on rel path.
  try {
    if (currentFolder) {
      const rel = getRelPath(abs);
      explorerExpandAncestorsForRel(rel);
    }
  } catch { /* ignore */ }

  // IMPORTANT: Force a full re-render by invalidating the cache reference.
  // This ensures expanded folders are actually applied to the DOM.
  // Without this, renderFileTree may skip re-building if the file list hasn't changed.
  try {
    window.__codeonExplorerLastFilesRef = null;
  } catch { /* ignore */ }

  // Re-render to apply folder expansion before selecting.
  try { renderFileTree(workspaceFileTreeSnapshot || []); } catch { /* ignore */ }

  // Helper function to find and highlight the file
  const findAndHighlight = () => {
    try {
      explorerReplaceSelection([abs], { anchorAbs: abs, focusAbs: abs });
    } catch { /* ignore */ }

    try {
      const el = explorerFindElByAbsPath(abs);
      if (el) {
        // Scroll to the element
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // Clear all active states
        document.querySelectorAll('.file-item').forEach(f => f.classList.remove('active'));
        // Add active state to this file
        el.classList.add('active');
        return true;
      }
    } catch { /* ignore */ }
    return false;
  };

  // Try immediately
  if (findAndHighlight()) return;

  // If element not found, the DOM might not be ready yet after renderFileTree
  // Try again after a short delay to allow the DOM to update
  requestAnimationFrame(() => {
    if (findAndHighlight()) return;
    
    // Final attempt with longer delay (some tree renders might be async)
    setTimeout(() => {
      findAndHighlight();
    }, 50);
  });
}


function explorerSelectedAbsList() {
  return Array.from(explorerSelectedAbsPaths || []).filter(Boolean);
}


function explorerReplaceSelection(absPaths, { anchorAbs = null, focusAbs = null } = {}) {
  try { explorerSelectedAbsPaths.clear(); } catch { explorerSelectedAbsPaths = new Set(); }
  for (const p of Array.isArray(absPaths) ? absPaths : []) {
    const s = typeof p === 'string' ? p.trim() : '';
    if (s) explorerSelectedAbsPaths.add(s);
  }
  explorerFocusedAbsPath = focusAbs || (explorerSelectedAbsPaths.size ? explorerSelectedAbsList()[0] : null);
  explorerAnchorAbsPath = anchorAbs || explorerFocusedAbsPath;
  explorerSyncFileTreeClasses();
  // Sync explorer lock badges (pre-run and post-reload).
  try { explorerEnsureLocksCacheFresh(); } catch { /* ignore */ }
}


function explorerClearSelection() {
  explorerReplaceSelection([], { anchorAbs: null, focusAbs: null });
}


function explorerClipboardSet(op, absPaths) {
  const list = Array.isArray(absPaths) ? absPaths.filter(Boolean) : [];
  if (!list.length) {
    explorerClipboard = null;
    explorerSyncFileTreeClasses();
    return;
  }
  explorerClipboard = { op: op === 'cut' ? 'cut' : 'copy', absPaths: list, createdAt: Date.now() };
  explorerSyncFileTreeClasses();
}


function explorerClipboardClear() {
  explorerClipboard = null;
  explorerSyncFileTreeClasses();
}


function explorerIsCutAbs(absPath) {
  if (!explorerClipboard || explorerClipboard.op !== 'cut') return false;
  const list = Array.isArray(explorerClipboard.absPaths) ? explorerClipboard.absPaths : [];
  return list.includes(absPath);
}


function explorerSyncFileTreeClasses() {
  const root = document.getElementById('fileTree');
  if (!root) return;
  const items = root.querySelectorAll('.file-item');
  items.forEach(el => {
    const abs = el && el.dataset ? String(el.dataset.absPath || '').trim() : '';
    if (!abs) return;
    el.classList.toggle('selected', explorerSelectedAbsPaths && explorerSelectedAbsPaths.has(abs));
    el.classList.toggle('cut', explorerIsCutAbs(abs));
    // Keep `.active` controlled by file-open logic; don't override it here.
  });
}


function explorerVisibleItemEls() {
  const root = document.getElementById('fileTree');
  if (!root) return [];
  const all = Array.from(root.querySelectorAll('.file-item'));
  // Only visible (skip items in collapsed folder containers)
  return all.filter(el => el && el.offsetParent !== null);
}


function explorerVisibleAbsList() {
  return explorerVisibleItemEls()
    .map(el => (el && el.dataset ? String(el.dataset.absPath || '').trim() : ''))
    .filter(Boolean);
}


function explorerRangeAbsBetween(anchorAbs, focusAbs) {
  const visible = explorerVisibleAbsList();
  const a = visible.indexOf(anchorAbs);
  const b = visible.indexOf(focusAbs);
  if (a === -1 || b === -1) return [focusAbs].filter(Boolean);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return visible.slice(lo, hi + 1);
}


async function explorerCopyOrCutSelection(op = 'copy') {
  const sel = explorerSelectedAbsList();
  if (!sel.length) {
    showToast('Nothing selected');
    return;
  }
  explorerClipboardSet(op === 'cut' ? 'cut' : 'copy', sel);
  showToast(op === 'cut' ? `Cut ${sel.length} item(s)` : `Copied ${sel.length} item(s)`);
}


async function explorerMoveOrCopyAbsPaths(absPaths, destDirAbs, { copy = false } = {}) {
  const dest = normalizeFsPath(String(destDirAbs || '').trim());
  const sources = Array.isArray(absPaths) ? absPaths.map(s => String(s || '').trim()).filter(Boolean) : [];
  if (!dest || !sources.length || !currentFolder) return [];
  if (!window.electronAPI || typeof window.electronAPI.copyPaths !== 'function' || typeof window.electronAPI.movePaths !== 'function') {
    await customAlert('File operations are not available (IPC not wired).', 'File Explorer');
    return [];
  }

  const res = copy
    ? await window.electronAPI.copyPaths(sources, dest, {})
    : await window.electronAPI.movePaths(sources, dest, {});
  if (!res || res.success !== true) {
    await customAlert(`${copy ? 'Copy' : 'Move'} failed.\n\n${res?.error || 'Unknown error'}`, 'File Explorer');
    return [];
  }
  const created = Array.isArray(res.results)
    ? res.results.map(r => r && r.dest ? String(r.dest) : '').filter(Boolean)
    : [];
  await refreshFileTree();
  if (created.length) explorerReplaceSelection(created, { anchorAbs: created[0], focusAbs: created[created.length - 1] });
  return created;
}


async function explorerPasteInto(destDirAbs) {
  const dest = normalizeFsPath(String(destDirAbs || '').trim());
  if (!dest || !currentFolder) return;
  if (!window.electronAPI || typeof window.electronAPI.copyPaths !== 'function' || typeof window.electronAPI.movePaths !== 'function') {
    await customAlert('Clipboard operations are not available (IPC not wired).', 'File Explorer');
    return;
  }
  if (!explorerClipboard || !Array.isArray(explorerClipboard.absPaths) || explorerClipboard.absPaths.length === 0) {
    showToast('Nothing to paste');
    return;
  }

  const op = explorerClipboard.op === 'cut' ? 'cut' : 'copy';
  const sources = explorerClipboard.absPaths.slice();
  try {
    const created = await explorerMoveOrCopyAbsPaths(sources, dest, { copy: op !== 'cut' });
    if (op === 'cut') explorerClipboardClear();
    showToast(op === 'cut' ? 'Moved' : (created.length ? 'Pasted' : 'Nothing pasted'));
  } catch (e) {
    await customAlert(`Paste failed.\n\n${e?.message || String(e)}`, 'File Explorer');
  }
}


async function explorerDuplicateSelection() {
  const sel = explorerSelectedAbsList();
  if (!sel.length) {
    showToast('Nothing selected');
    return;
  }
  if (!window.electronAPI || typeof window.electronAPI.duplicatePath !== 'function') {
    await customAlert('Duplicate is not available (IPC not wired).', 'File Explorer');
    return;
  }
  const created = [];
  for (const src of sel) {
    try {
      const res = await window.electronAPI.duplicatePath(src, {});
      if (res && res.success === true && res.dest) {
        created.push(String(res.dest));
      } else {
        throw new Error(res?.error || 'Duplicate failed');
      }
    } catch (e) {
      await customAlert(`Failed to duplicate:\n\n${src}\n\n${e?.message || String(e)}`, 'File Explorer');
      break;
    }
  }
  await refreshFileTree();
  if (created.length) explorerReplaceSelection(created, { anchorAbs: created[0], focusAbs: created[created.length - 1] });
  if (created.length) showToast(`Duplicated ${created.length} item(s)`);
}


function explorerPreferredPasteDestAbs() {
  // If exactly one folder is selected, paste into it; otherwise paste into workspace root.
  const sel = explorerSelectedAbsList();
  if (sel.length !== 1) return currentFolder;
  const only = sel[0];
  const root = document.getElementById('fileTree');
  if (!root) return currentFolder;
  // Avoid brittle attribute selectors; scan visible items.
  const els = root.querySelectorAll('.file-item.folder-item');
  for (const el of els) {
    const abs = el && el.dataset ? String(el.dataset.absPath || '').trim() : '';
    if (abs && abs === only) return only;
  }
  return currentFolder;
}


async function explorerDeleteSelection() {
  const sel = explorerSelectedAbsList();
  if (!sel.length) return;
  if (!window.electronAPI || typeof window.electronAPI.deleteFile !== 'function') return;
  const msg = sel.length === 1
    ? `Are you sure you want to delete:\n\n${sel[0]}`
    : `Are you sure you want to delete ${sel.length} item(s)?\n\nThis cannot be undone.`;
  const ok = await customConfirm(msg, 'Delete');
  if (!ok) return;

  let deletedCurrent = false;
  const failures = [];
  for (const p of sel) {
    try {
      const res = await window.electronAPI.deleteFile(p);
      if (!res || res.success !== true) failures.push({ path: p, error: res?.error || 'Unknown error' });
      if (currentFile && normalizeFsPath(currentFile) === normalizeFsPath(p)) deletedCurrent = true;
    } catch (e) {
      failures.push({ path: p, error: e?.message || String(e) });
    }
  }

  if (deletedCurrent) {
    currentFile = null;
    window.currentFile = null;
    try { if (editor) editor.setValue(''); } catch { /* ignore */ }
    try { document.getElementById('currentFilePath').textContent = 'No file open'; } catch { /* ignore */ }
    try { document.getElementById('editorEmptyState').style.display = 'flex'; } catch { /* ignore */ }
  }

  await refreshFileTree();
  explorerClearSelection();
  if (failures.length) {
    await customAlert(
      `Some items could not be deleted:\n\n${failures.slice(0, 8).map(f => `${f.path}\n${f.error}`).join('\n\n')}`,
      'Delete'
    );
  } else {
    showToast(sel.length === 1 ? 'Deleted' : `Deleted ${sel.length} item(s)`);
  }
}


async function explorerRenameSingleSelection() {
  const sel = explorerSelectedAbsList();
  if (sel.length !== 1) return;
  const abs = sel[0];
  if (!abs || !window.electronAPI || typeof window.electronAPI.renameFile !== 'function') return;
  const currentName = abs.split(/[/\\]/).pop() || abs;
  const nextName = await customPrompt('Enter new name:', currentName, 'Rename');
  const trimmed = typeof nextName === 'string' ? nextName.trim() : '';
  if (!trimmed || trimmed === currentName) return;
  const parent = abs.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || currentFolder;
  const newAbs = normalizeFsPath(`${parent}/${trimmed}`);
  try {
    const res = await window.electronAPI.renameFile(abs, newAbs);
    if (!res || res.success !== true) {
      await customAlert(`Rename failed.\n\n${res?.error || 'Unknown error'}`, 'Rename');
      return;
    }
    if (currentFile && normalizeFsPath(currentFile) === normalizeFsPath(abs)) {
      currentFile = newAbs;
      window.currentFile = newAbs;
      try { setTopFilePathLabel(getRelPath(newAbs)); } catch { /* ignore */ }
    }
    await refreshFileTree();
    explorerReplaceSelection([newAbs], { anchorAbs: newAbs, focusAbs: newAbs });
    showToast('Renamed');
  } catch (e) {
    await customAlert(`Rename failed.\n\n${e?.message || String(e)}`, 'Rename');
  }
}


function explorerSyncLocksFromCache() {
  try {
    const root = document.getElementById('fileTree');
    const projectPath = window.currentFolder ? String(window.currentFolder) : '';
    if (!root || !projectPath) return;
    const cache = window._aetLocksCache && window._aetLocksCache[projectPath];
    const locks = cache && cache.locks && typeof cache.locks === 'object' ? cache.locks : {};
    const lockedSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2">
        <path d="M7 10V7a5 5 0 0 1 10 0v3"></path>
        <rect x="5" y="10" width="14" height="12" rx="2"></rect>
        <path d="M12 14v4"></path>
      </svg>
    `;
    const unlockedSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2">
        <path d="M7 10V7a5 5 0 0 1 9.9-1"></path>
        <rect x="5" y="10" width="14" height="12" rx="2"></rect>
        <path d="M12 14v4"></path>
        <path d="M17 4l3 3"></path>
      </svg>
    `;
    for (const btn of Array.from(root.querySelectorAll('button.file-lock-toggle'))) {
      const rel = String(btn.dataset.relPath || '').trim();
      if (!rel) continue;
      const isLocked = Object.prototype.hasOwnProperty.call(locks, rel);
      btn.classList.toggle('locked', isLocked);
      btn.title = isLocked ? 'Unlock file' : 'Lock file';
      btn.innerHTML = isLocked ? lockedSvg : unlockedSvg;
      try {
        const row = btn.closest('.file-item');
        if (row) row.classList.toggle('locked', isLocked);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
