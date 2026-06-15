// ---- CHUNK 6/7 from hoisted.js (AST statement boundaries; order preserved) ----



async function explorerEnsureLocksCacheFresh() {
  try {
    const projectPath = window.currentFolder ? String(window.currentFolder) : '';
    if (!projectPath || !window.electronAPI || typeof window.electronAPI.executionLocksGet !== 'function') return;
    const cache = window._aetLocksCache && window._aetLocksCache[projectPath];
    const age = cache && Number.isFinite(Number(cache.at)) ? (Date.now() - Number(cache.at)) : Number.POSITIVE_INFINITY;
    if (age < 1500) { // avoid spamming IPC during rapid refreshes
      explorerSyncLocksFromCache();
      return;
    }
    const res = await window.electronAPI.executionLocksGet(projectPath);
    if (res && res.success === true && res.locks && typeof res.locks === 'object') {
      if (!window._aetLocksCache) window._aetLocksCache = {};
      window._aetLocksCache[projectPath] = { locks: res.locks, at: Date.now() };
      explorerSyncLocksFromCache();
    }
  } catch { /* ignore */ }
}


// Render file tree
function renderFileTree(files) {
  const fileTree = document.getElementById('fileTree');
  if (!fileTree) return;
  const __perf = (window.codeonPerf && typeof window.codeonPerf === 'object') ? window.codeonPerf : null;
  const __debugPerf = !!(__perf && typeof __perf.isDebugEnabled === 'function' && __perf.isDebugEnabled());
  const __t0 = __debugPerf && __perf && typeof __perf.now === 'function' ? __perf.now() : 0;

  // PERF: If the snapshot reference hasn't changed, don't rebuild the entire explorer DOM.
  // This is especially important on chat session switches (explorer is global, not per-chat).
  try {
    if (window.__codeonExplorerLastFilesRef === files && fileTree.dataset && fileTree.dataset.rendered === '1') {
      try { explorerSyncFileTreeClasses(); } catch { /* ignore */ }
      try { explorerSyncLocksFromCache(); } catch { /* ignore */ }
      return;
    }
    window.__codeonExplorerLastFilesRef = files;
  } catch { /* ignore */ }

  try { fileTree.replaceChildren(); } catch { fileTree.innerHTML = ''; }

  // Root context menu + root click/drag handlers should work even when the folder is empty.
  // (Previously we returned early for the "Empty folder" UI and never bound these.)
  const bindRootHandlers = (ulEl) => {
    try {
      // Root context menu (right-click on background / empty state).
      // Use `.on*` to avoid duplicate listeners on refresh.
      fileTree.oncontextmenu = (e) => {
        try {
          if (!e || !currentFolder) return;
          const t = e.target;
          // If right-clicking a real row, let that row's handler handle it.
          if (t && t.closest && t.closest('.file-item')) return;
          const isBackground =
            (t === fileTree) ||
            (ulEl && t === ulEl) ||
            (t && t.closest && t.closest('.empty-state'));
          if (!isBackground) return;
          e.preventDefault();
          e.stopPropagation();
          explorerHasFocus = true;
          // VS Code-like: right-click blank space clears selection first.
          explorerClearSelection();
          showContextMenu(e, currentFolder, true, fileTree);
        } catch { /* ignore */ }
      };

      fileTree.onclick = (e) => {
        try {
          if (!e) return;
          const t = e.target;
          const isBackground =
            (t === fileTree) ||
            (ulEl && t === ulEl) ||
            (t && t.closest && t.closest('.empty-state'));
          if (!isBackground) return;
          explorerHasFocus = true;
          explorerClearSelection();
        } catch { /* ignore */ }
      };

      // Root drag/drop target (drop into workspace root) — keep working even when empty.
      fileTree.ondragover = (e) => {
        try {
          if (!e) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = (explorerIsMac() ? (e.altKey ? 'copy' : 'move') : (e.ctrlKey ? 'copy' : 'move'));
          fileTree.classList.add('drop-target');
        } catch { /* ignore */ }
      };
      fileTree.ondragleave = () => {
        try { fileTree.classList.remove('drop-target'); } catch { /* ignore */ }
      };
      fileTree.ondrop = async (e) => {
        try {
          if (!e) return;
          e.preventDefault();
          e.stopPropagation();
          fileTree.classList.remove('drop-target');
          const dt = e.dataTransfer;
          if (!dt) return;
          const raw = dt.getData('application/x-aiagent-explorer');
          if (!raw) return;
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch { parsed = null; }
          const paths = parsed && Array.isArray(parsed.absPaths) ? parsed.absPaths.map(String).filter(Boolean) : [];
          if (!paths.length) return;
          const copy = explorerIsMac() ? !!e.altKey : !!e.ctrlKey;
          await explorerMoveOrCopyAbsPaths(paths, currentFolder, { copy });
        } catch { /* ignore */ }
      };
    } catch { /* ignore */ }
  };

  if (!files || files.length === 0) {
    fileTree.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="empty-icon">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <p>Empty folder</p>
      </div>
    `;
    bindRootHandlers(null);
    try { explorerSyncFileTreeClasses(); } catch { /* ignore */ }
    try { fileTree.dataset.rendered = '1'; } catch { /* ignore */ }
    return;
  }

  // Hide internal app state from the explorer UI.
  const stripInternalTopLevel = (nodes) => {
    const arr = Array.isArray(nodes) ? nodes : [];
    const out = [];
    for (const n of arr) {
      if (!n) continue;
      const rel = String(n.path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
      if (rel === '.ai-agent' || rel.startsWith('.ai-agent/')) continue;
      if (rel === '.git' || rel.startsWith('.git/')) continue;
      out.push(n);
    }
    return out;
  };
  files = stripInternalTopLevel(files);

  // Filter children lazily (big perf win on large repos).
  const _getVisibleChildren = (dirItem) => {
    if (!dirItem || dirItem.type !== 'directory') return [];
    try {
      if (Array.isArray(dirItem.__codeonVisibleChildren)) return dirItem.__codeonVisibleChildren;
    } catch { /* ignore */ }
    const raw = Array.isArray(dirItem.children) ? dirItem.children : [];
    const out = [];
    for (const n of raw) {
      if (!n) continue;
      const rel = String(n.path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
      if (rel === '.ai-agent' || rel.startsWith('.ai-agent/')) continue;
      if (rel === '.git' || rel.startsWith('.git/')) continue;
      out.push(n);
    }
    try { dirItem.__codeonVisibleChildren = out; } catch { /* ignore */ }
    return out;
  };

  const ul = document.createElement('div');
  for (const item of (files || [])) {
    ul.appendChild(createFileTreeItem(item, 0, { _getVisibleChildren }));
  }
  fileTree.appendChild(ul);

  // Rehydrate lock indicators after initial render / app restart (locks persist on disk in .ai-agent/locks.json).
  // This is intentionally best-effort and async; it updates the lock toggle icons in-place.
  try {
    const p = explorerEnsureLocksCacheFresh();
    if (p && typeof p.then === 'function') p.catch(() => {});
  } catch { /* ignore */ }

  bindRootHandlers(ul);

  explorerSyncFileTreeClasses();
  try { fileTree.dataset.rendered = '1'; } catch { /* ignore */ }
  try {
    if (__debugPerf) {
      const t1 = __perf && typeof __perf.now === 'function' ? __perf.now() : Date.now();
      console.debug(`[Perf] renderFileTree: ${Math.round(t1 - __t0)}ms`);
    }
  } catch { /* ignore */ }
}

function createFileTreeItem(item, depth = 0, ctx = null) {
  const container = document.createElement('div');
  const _getVisibleChildren = ctx && typeof ctx._getVisibleChildren === 'function'
    ? ctx._getVisibleChildren
    : (x) => (x && Array.isArray(x.children) ? x.children : []);

  if (item.type === 'directory') {
    // Check if folder has children
    const visibleChildren = _getVisibleChildren(item);
    const hasChildren = Array.isArray(visibleChildren) && visibleChildren.length > 0;

    // Creating folder UI element

    const folder = document.createElement('div');
    folder.className = 'file-item folder-item';
    folder.dataset.path = item.path;
    folder.dataset.name = item.name;
    folder.dataset.absPath = explorerAbsFromRel(item.path);
    folder.dataset.expanded = 'false';
    folder.dataset.hasChildren = hasChildren ? 'true' : 'false';
    folder.style.paddingLeft = `${depth * 16 + 8}px`;
    folder.setAttribute('draggable', 'true');

    // Create expand/collapse icon (chevron)
    const expandIcon = document.createElement('span');
    expandIcon.className = 'file-expand-icon';
    expandIcon.textContent = hasChildren ? '›' : '';
    expandIcon.style.visibility = hasChildren ? 'visible' : 'hidden';

    // Create file type icon
    const typeIcon = document.createElement('span');
    typeIcon.className = 'file-type-icon';
    typeIcon.textContent = '📁';

    // Create label
    const label = document.createElement('span');
    label.className = 'file-name';
    label.textContent = item.name;

    folder.appendChild(expandIcon);
    folder.appendChild(typeIcon);
    folder.appendChild(label);

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';
    childrenContainer.style.display = 'none';

    const buildChildrenSync = () => {
      if (!hasChildren) return;
      if (childrenContainer.dataset && childrenContainer.dataset.built === '1') return;
      try { childrenContainer.dataset.built = '1'; } catch { /* ignore */ }
      for (const child of visibleChildren) {
        childrenContainer.appendChild(createFileTreeItem(child, depth + 1, ctx));
      }
    };
    const buildChildrenChunked = () => {
      if (!hasChildren) return;
      if (childrenContainer.dataset && childrenContainer.dataset.built === '1') return;
      try { childrenContainer.dataset.built = '1'; } catch { /* ignore */ }
      const kids = visibleChildren.slice();
      const runner = window.codeonPerf && typeof window.codeonPerf.runChunked === 'function'
        ? window.codeonPerf.runChunked
        : async (items, fn) => { for (const it of items) { await fn(it); } };
      // Cancel any in-flight build for this folder if user collapses/expands quickly.
      try { childrenContainer.__buildToken = (Number(childrenContainer.__buildToken || 0) + 1); } catch { /* ignore */ }
      const token = Number(childrenContainer.__buildToken || 0);
      runner(kids, async (child) => {
        try {
          if (!childrenContainer.isConnected) return;
          if (Number(childrenContainer.__buildToken || 0) !== token) return;
        } catch { /* ignore */ }
        childrenContainer.appendChild(createFileTreeItem(child, depth + 1, ctx));
      }, { budgetMs: 8 }).catch(() => {});
    };

    // Restore expanded state across refreshes
    try {
      const abs = String(folder.dataset.absPath || '').trim();
      const shouldExpand = !!(abs && explorerExpandedAbsDirs && explorerExpandedAbsDirs.has(abs));
      if (hasChildren && shouldExpand) {
        folder.dataset.expanded = 'true';
        // Only build children for folders that are actually expanded (huge perf win).
        buildChildrenSync();
        childrenContainer.style.display = 'block';
        expandIcon.textContent = '⌄';
      }
    } catch { /* ignore */ }

    folder.addEventListener('click', (e) => {
      e.stopPropagation();
      explorerHasFocus = true;
      const abs = String(folder.dataset.absPath || '').trim();
      if (!abs) return;

      const toggle = explorerIsToggleSelectEvent(e);
      const range = !!e.shiftKey;

      if (range) {
        const anchor = explorerAnchorAbsPath || abs;
        const r = explorerRangeAbsBetween(anchor, abs);
        const next = toggle ? new Set([...explorerSelectedAbsPaths, ...r]) : new Set(r);
        explorerReplaceSelection(Array.from(next), { anchorAbs: anchor, focusAbs: abs });
      } else if (toggle) {
        const next = new Set(explorerSelectedAbsPaths || []);
        if (next.has(abs)) next.delete(abs); else next.add(abs);
        explorerReplaceSelection(Array.from(next), { anchorAbs: abs, focusAbs: abs });
      } else {
        explorerReplaceSelection([abs], { anchorAbs: abs, focusAbs: abs });
      }

      // Preserve existing behavior: toggle expand/collapse on plain click
      if (!toggle && !range && hasChildren) {
        const isExpanded = folder.dataset.expanded === 'true';
        const nextExpanded = !isExpanded;
        folder.dataset.expanded = nextExpanded ? 'true' : 'false';
        childrenContainer.style.display = nextExpanded ? 'block' : 'none';
        expandIcon.textContent = nextExpanded ? '⌄' : '›';
        if (nextExpanded) {
          // PERF: only build children when actually expanding.
          buildChildrenChunked();
        } else {
          // Cancel any pending build.
          try { childrenContainer.__buildToken = (Number(childrenContainer.__buildToken || 0) + 1); } catch { /* ignore */ }
        }
        try {
          if (!explorerExpandedAbsDirs) explorerExpandedAbsDirs = new Set();
          if (nextExpanded) explorerExpandedAbsDirs.add(abs);
          else explorerExpandedAbsDirs.delete(abs);
        } catch { /* ignore */ }
      }
    });

    folder.addEventListener('dragstart', (e) => {
      try {
        if (!e || !e.dataTransfer) return;
        e.stopPropagation();
        const abs = String(folder.dataset.absPath || '').trim();
        if (!abs) return;
        // If dragging an unselected item, make it the only selection first.
        if (!explorerSelectedAbsPaths || !explorerSelectedAbsPaths.has(abs)) {
          explorerReplaceSelection([abs], { anchorAbs: abs, focusAbs: abs });
        }
        const absPaths = explorerSelectedAbsList();
        e.dataTransfer.setData('application/x-aiagent-explorer', JSON.stringify({ absPaths }));
        e.dataTransfer.setData('text/plain', absPaths.join('\n'));
        e.dataTransfer.effectAllowed = 'copyMove';
      } catch { /* ignore */ }
    });

    folder.addEventListener('dragover', (e) => {
      try {
        if (!e) return;
        e.preventDefault();
        e.stopPropagation();
        folder.classList.add('drop-target');
        e.dataTransfer.dropEffect = (explorerIsMac() ? (e.altKey ? 'copy' : 'move') : (e.ctrlKey ? 'copy' : 'move'));
      } catch { /* ignore */ }
    });
    folder.addEventListener('dragleave', () => {
      try { folder.classList.remove('drop-target'); } catch { /* ignore */ }
    });
    folder.addEventListener('drop', async (e) => {
      try {
        if (!e) return;
        e.preventDefault();
        e.stopPropagation();
        folder.classList.remove('drop-target');
        const dt = e.dataTransfer;
        if (!dt) return;
        const raw = dt.getData('application/x-aiagent-explorer');
        if (!raw) return;
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        const paths = parsed && Array.isArray(parsed.absPaths) ? parsed.absPaths.map(String).filter(Boolean) : [];
        if (!paths.length) return;
        const copy = explorerIsMac() ? !!e.altKey : !!e.ctrlKey;
        await explorerMoveOrCopyAbsPaths(paths, String(folder.dataset.absPath || '').trim(), { copy });
      } catch { /* ignore */ }
    });

    // Right-click context menu
    folder.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      explorerHasFocus = true;
      const abs = String(folder.dataset.absPath || '').trim();
      if (abs && (!explorerSelectedAbsPaths || !explorerSelectedAbsPaths.has(abs))) {
        explorerReplaceSelection([abs], { anchorAbs: abs, focusAbs: abs });
      }
      showContextMenu(e, abs || (currentFolder + '/' + item.path), true, folder);
    });

    container.appendChild(folder);
    container.appendChild(childrenContainer);
  } else {
    // File item
    const file = document.createElement('div');
    file.className = 'file-item';
    file.dataset.path = item.path;
    file.dataset.name = item.name;
    const fileAbsPath = explorerAbsFromRel(item.path);
    file.dataset.absPath = fileAbsPath;
    file.style.paddingLeft = `${depth * 16 + 8}px`;
    file.setAttribute('draggable', 'true');
    
    // SYNC: Set active class if this is the currently open file
    try {
      if (currentFile && fileAbsPath && normalizeFsPath(currentFile) === normalizeFsPath(fileAbsPath)) {
        file.classList.add('active');
      }
    } catch { /* ignore */ }

    // Expand icon placeholder (empty for files)
    const expandIcon = document.createElement('span');
    expandIcon.className = 'file-expand-icon';
    expandIcon.textContent = '';

    // File type icon with color
    const typeIcon = document.createElement('span');
    typeIcon.className = `file-type-icon ${getFileIconClass(item.name)}`;
    typeIcon.textContent = getFileIconLabel(item.name);

    // File name
    const label = document.createElement('span');
    label.className = 'file-name';
    label.textContent = item.name;

    // Lock toggle (v2.0)
    const lockBtn = document.createElement('button');
    lockBtn.className = 'file-lock-toggle';
    lockBtn.type = 'button';
    lockBtn.title = 'Lock file';
    try { lockBtn.dataset.relPath = String(item.path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim(); } catch { /* ignore */ }
    lockBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2">
        <path d="M7 10V7a5 5 0 0 1 9.9-1"></path>
        <rect x="5" y="10" width="14" height="12" rx="2"></rect>
        <path d="M12 14v4"></path>
        <path d="M17 4l3 3"></path>
      </svg>
    `;

    file.appendChild(expandIcon);
    file.appendChild(typeIcon);
    file.appendChild(label);
    file.appendChild(lockBtn);

    const setLockedUi = (isLocked) => {
      try {
        file.classList.toggle('locked', !!isLocked);
        lockBtn.classList.toggle('locked', !!isLocked);
        lockBtn.title = isLocked ? 'Unlock file' : 'Lock file';
        lockBtn.innerHTML = isLocked
          ? `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2">
              <path d="M7 10V7a5 5 0 0 1 10 0v3"></path>
              <rect x="5" y="10" width="14" height="12" rx="2"></rect>
              <path d="M12 14v4"></path>
            </svg>
          `
          : `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2">
              <path d="M7 10V7a5 5 0 0 1 9.9-1"></path>
              <rect x="5" y="10" width="14" height="12" rx="2"></rect>
              <path d="M12 14v4"></path>
              <path d="M17 4l3 3"></path>
            </svg>
          `;
      } catch { /* ignore */ }
    };

    // Initialize lock state from cache (best-effort).
    try {
      const projectPath = window.currentFolder ? String(window.currentFolder) : '';
      const rel = String(item.path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
      const cache = projectPath && window._aetLocksCache && window._aetLocksCache[projectPath];
      const locks = cache && cache.locks && typeof cache.locks === 'object' ? cache.locks : {};
      setLockedUi(Object.prototype.hasOwnProperty.call(locks, rel));
    } catch { /* ignore */ }

    lockBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (!window.currentFolder || !window.electronAPI) return;
        if (typeof window.electronAPI.executionLocksGet !== 'function' || typeof window.electronAPI.executionLocksSet !== 'function') return;
        const rel = String(item.path || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
        if (!rel) return;

        const res = await window.electronAPI.executionLocksGet(window.currentFolder);
        const locks = (res && res.success === true && res.locks && typeof res.locks === 'object') ? res.locks : {};
        const currentlyLocked = Object.prototype.hasOwnProperty.call(locks, rel);

        const res2 = await window.electronAPI.executionLocksSet(window.currentFolder, {
          paths: [rel],
          locked: !currentlyLocked,
          note: !currentlyLocked ? 'Locked from explorer' : ''
        });
        if (!res2 || res2.success !== true) {
          showToast(res2?.error || 'Failed to update lock');
          return;
        }
        // Update cache + UI
        try {
          if (!window._aetLocksCache) window._aetLocksCache = {};
          window._aetLocksCache[String(window.currentFolder)] = { locks: res2.locks || {}, at: Date.now() };
        } catch { /* ignore */ }
        setLockedUi(!currentlyLocked);
        try { explorerSyncLocksFromCache(); } catch { /* ignore */ }

        try {
          addMessage('system_action', currentlyLocked ? `🔓 Unlocked file: \`${rel}\`` : `🔒 Locked file: \`${rel}\``, null, null, true);
        } catch { /* ignore */ }
        // Persist as an AET node (audit story): lock/unlock from explorer.
        try {
          const sid = currentSessionId;
          const rid = sid ? String(executionTimelineActiveRunBySession[sid] || '').trim() : '';
          if (sid && rid && window.electronAPI && typeof window.electronAPI.executionTimelineAppendNode === 'function') {
            await window.electronAPI.executionTimelineAppendNode(window.currentFolder, sid, rid, 'UserIntervention', {
              title: currentlyLocked ? 'File unlocked' : 'File locked',
              subtype: currentlyLocked ? 'unlock' : 'lock',
              paths: [rel],
              source: 'explorer'
            });
          }
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    });

    file.addEventListener('click', async (e) => {
      e.stopPropagation();
      explorerHasFocus = true;
      const abs = String(file.dataset.absPath || '').trim();
      if (!abs) return;

      const toggle = explorerIsToggleSelectEvent(e);
      const range = !!e.shiftKey;

      if (range) {
        const anchor = explorerAnchorAbsPath || abs;
        const r = explorerRangeAbsBetween(anchor, abs);
        const next = toggle ? new Set([...explorerSelectedAbsPaths, ...r]) : new Set(r);
        explorerReplaceSelection(Array.from(next), { anchorAbs: anchor, focusAbs: abs });
        return; // range-select should not open file
      }
      if (toggle) {
        const next = new Set(explorerSelectedAbsPaths || []);
        if (next.has(abs)) next.delete(abs); else next.add(abs);
        explorerReplaceSelection(Array.from(next), { anchorAbs: abs, focusAbs: abs });
        return; // toggle-select should not open file
      }

      explorerReplaceSelection([abs], { anchorAbs: abs, focusAbs: abs });
          await openFile(abs);

      // Update active state (current file)
      document.querySelectorAll('.file-item').forEach(f => f.classList.remove('active'));
      file.classList.add('active');
    });

    file.addEventListener('dragstart', (e) => {
      try {
        if (!e || !e.dataTransfer) return;
        e.stopPropagation();
        const abs = String(file.dataset.absPath || '').trim();
        if (!abs) return;
        if (!explorerSelectedAbsPaths || !explorerSelectedAbsPaths.has(abs)) {
          explorerReplaceSelection([abs], { anchorAbs: abs, focusAbs: abs });
        }
        const absPaths = explorerSelectedAbsList();
        e.dataTransfer.setData('application/x-aiagent-explorer', JSON.stringify({ absPaths }));
        e.dataTransfer.setData('text/plain', absPaths.join('\n'));
        e.dataTransfer.effectAllowed = 'copyMove';
      } catch { /* ignore */ }
    });

    // Right-click context menu
    file.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      explorerHasFocus = true;
      const abs = String(file.dataset.absPath || '').trim();
      if (abs && (!explorerSelectedAbsPaths || !explorerSelectedAbsPaths.has(abs))) {
        explorerReplaceSelection([abs], { anchorAbs: abs, focusAbs: abs });
      }
      showContextMenu(e, abs || (currentFolder + '/' + item.path), false, file);
    });

    container.appendChild(file);
  }

  return container;
}


// Get file icon class based on extension
function getFileIconClass(fileName) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  return `icon-${extension || 'file'}`;
}


// Get file icon label based on extension
function getFileIconLabel(fileName) {
  const extension = fileName.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'js': return 'JS';
    case 'jsx': return 'JSX';
    case 'ts': return 'TS';
    case 'tsx': return 'TSX';
    case 'json': return '{}';
    case 'md': return 'ℹ';
    case 'css': return 'CSS';
    case 'scss': return 'SCSS';
    case 'html': return '<>';
    case 'py': return 'PY';
    case 'sh': return '$';
    case 'txt': return 'TXT';
    default:
      if (fileName === 'package.json') return '{}';
      if (fileName === 'README.md') return 'ℹ';
      if (fileName.includes('config')) return '⚙';
      return '📄';
  }
}


// Open file
async function openFile(filePath) {
  const absPath = resolveToWorkspaceAbsPath(filePath);
  // Exit diff view if active
  if (typeof exitDiffView === 'function') {
    exitDiffView();
  }

  // If the Execution Timeline Graph is occupying the editor canvas, and the user is opening a file,
  // that is an explicit intent to return to the code editor.
  try {
    if (typeof _closeExecutionTimelineInEditor === 'function') _closeExecutionTimelineInEditor();
    if (typeof _syncAetViewToggleUI === 'function') _syncAetViewToggleUI();
  } catch { /* ignore */ }

  // If we were showing a chat transcript in the editor, restore normal editing.
  if (isChatEditorView) {
    setEditorReadOnly(false);
    isChatEditorView = false;
  }

  if (window.electronAPI) {
    const result = await window.electronAPI.readFile(absPath);
    if (result.success) {
      handleFileOpened({
        path: absPath,
        content: result.content,
        language: result.language,
        name: absPath.split(/[/\\]/).pop(),
        isBase64: result.isBase64 === true
      });
    }
  }
}

async function openGitDiffForFile(absPath, rev = 'HEAD') {
  const abs = normalizeFsPath(absPath);
  if (!abs || !window.currentFolder || !window.electronAPI?.gitShowFile) return;

  // If graph overlay is active, opening a diff should return to the diff editor.
  try {
    if (typeof _closeExecutionTimelineInEditor === 'function') _closeExecutionTimelineInEditor();
    if (typeof _syncAetViewToggleUI === 'function') _syncAetViewToggleUI();
  } catch { /* ignore */ }

  // Exit chat editor view if active
  if (isChatEditorView) {
    setEditorReadOnly(false);
    isChatEditorView = false;
  }

  const editorEl = document.getElementById('editor');
  const diffEditorEl = document.getElementById('diffEditor');
  if (!editorEl || !diffEditorEl || !diffEditor) return;

  editorEl.style.display = 'none';
  diffEditorEl.style.display = 'block';

  const rel = getRelPath(abs);
  const lang = detectMonacoLanguageFromPath(abs);

  const [left, right] = await Promise.all([
    (async () => {
      try {
        const r = await window.electronAPI.gitShowFile({ rev, filePath: abs });
        return r?.success ? String(r.content || '') : '';
      } catch { return ''; }
    })(),
    (async () => {
      try {
        const r = await window.electronAPI.readFile(abs);
        return r?.success ? String(r.content || '') : '';
      } catch { return ''; }
    })()
  ]);

  try {
    // Dispose previous diff models to avoid leaks
    try { diffModels?.original?.dispose?.(); } catch { /* ignore */ }
    try { diffModels?.modified?.dispose?.(); } catch { /* ignore */ }
    diffModels = null;

    const originalModel = monaco.editor.createModel(left, lang);
    const modifiedModel = monaco.editor.createModel(right, lang);
    diffModels = { original: originalModel, modified: modifiedModel };
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  } catch {
    // ignore
  }

  setTopFilePathLabel(`${rel} (diff)`);
  try { diffEditor.layout(); } catch { /* ignore */ }

  // SYNC: Set diff state in FileSyncController for pseudo-tab tracking
  try {
    if (window.FileSyncController?.setDiffState) {
      window.FileSyncController.setDiffState({
        absPath: abs,
        relPath: rel,
        originalContent: left,
        modifiedContent: right,
        diffContent: '',
        baseRef: rev,
        isVirtual: false
      });
    }
  } catch { /* ignore */ }

  // Problems panel can include diff diagnostics; refresh after opening diff.
  scheduleRenderProblemsView();
}


// Handle file opened
function handleFileOpened(data) {
  // Same intent handling for IPC-driven file opens (e.g. explorer click).
  try {
    if (typeof _closeExecutionTimelineInEditor === 'function') _closeExecutionTimelineInEditor();
    if (typeof _syncAetViewToggleUI === 'function') _syncAetViewToggleUI();
  } catch { /* ignore */ }

  const p = normalizeFsPath(resolveToWorkspaceAbsPath(data?.path));
  currentFile = p || null;
  window.currentFile = currentFile;

  // Images/binary: keep existing behavior (file open for preview/attachments), but don't force Monaco tab.
  if (data && data.isBase64 === true) {
    // For now, we won't open binary files in Monaco.
    setTopFilePathLabel(data?.name || 'Binary file');
    return;
  }

  if (editor) {
    if (isChatEditorView) {
      setEditorReadOnly(false);
      isChatEditorView = false;
    }
    // Route through tab system (creates model per file)
    openEditorTabFromFilePayload({
      absPath: p,
      content: String(data?.content || ''),
      language: data?.language
    }).catch(() => {});
  }

  // SYNC: Always reveal the opened file in the explorer
  // This ensures file explorer stays in sync when files are opened from chat, diff, etc.
  // Delay slightly to let the tab system finish first
  if (p) {
    requestAnimationFrame(() => {
      try {
        if (typeof explorerRevealAbsPath === 'function') {
          explorerRevealAbsPath(p);
        }
      } catch { /* ignore */ }
    });
  }
}


// Save current file
async function saveCurrentFile() {
  if (!currentFile || !editor) return;
  const tab = findTabByKey(activeEditorTabKey);
  if (!tab || !tab.model) return;

  const content = tab.model.getValue();
  if (window.electronAPI) {
    const result = await window.electronAPI.writeFile(currentFile, content);
    if (result.success) {
      try { tab.savedVersionId = tab.model.getAlternativeVersionId(); } catch { /* ignore */ }
      tab.conflictOnDisk = false;
      try {
        const st = await window.electronAPI.getFileStats(currentFile);
        const ms = st?.success && st?.stats?.modified ? new Date(st.stats.modified).getTime() : null;
        if (Number.isFinite(ms)) tab.lastDiskMtimeMs = ms;
      } catch { /* ignore */ }
      renderEditorTabs();
    } else {
      await customAlert('Error saving file: ' + result.error, 'Save Failed');
    }
  }
}
