// ---- CHUNK 5/6 from hoisted.js (AST statement boundaries; order preserved) ----



// Switch to a specific chat session
async function switchToSession(sessionId) {
  if (!chatSessions[sessionId]) return;
  const wasEditorAetOpen = executionTimelineEditorOpen === true;
  const prevSid = String(currentSessionId || '').trim();
  const prevMode = prevSid ? _getAetViewMode(prevSid) : 'feed';
  const __perf = (window.codeonPerf && typeof window.codeonPerf === 'object') ? window.codeonPerf : null;
  const __debugPerf = !!(__perf && typeof __perf.isDebugEnabled === 'function' && __perf.isDebugEnabled());
  const __tSwitchStart = __debugPerf && __perf && typeof __perf.now === 'function' ? __perf.now() : 0;
  // Cancellation token: if the user switches sessions again while we're still rendering/debouncing,
  // we should stop doing work for the stale session to keep the UI buttery smooth.
  try {
    if (typeof window.__codeonSessionSwitchToken !== 'number') window.__codeonSessionSwitchToken = 0;
    window.__codeonSessionSwitchToken += 1;
  } catch { /* ignore */ }
  const _switchToken = Number(window.__codeonSessionSwitchToken || 0);
  const _isStaleSwitch = () => {
    try {
      return Number(window.__codeonSessionSwitchToken || 0) !== _switchToken
        || String(currentSessionId || '').trim() !== String(sessionId || '').trim();
    } catch {
      return true;
    }
  };

  // --------------------------------------------------------------------------
  // PERF: Cache chat DOM per session to make tab switching O(1) in the common case.
  // We stash the current `#chatMessages` children into a DocumentFragment and restore them
  // when switching back, so we don't re-run markdown rendering for the whole transcript.
  // --------------------------------------------------------------------------
  const _getChatDomCache = () => {
    if (!window.__codeonChatDomCache || typeof window.__codeonChatDomCache !== 'object') {
      window.__codeonChatDomCache = { bySession: {}, lru: [] };
    }
    return window.__codeonChatDomCache;
  };
  const _touchChatDomCache = (sid) => {
    const cache = _getChatDomCache();
    const id = String(sid || '').trim();
    if (!id) return;
    const next = (cache.lru || []).filter(x => x !== id);
    next.unshift(id);
    cache.lru = next;
    // Keep memory bounded. We retain DOM for only the most recently used sessions.
    const MAX = 10;
    if (cache.lru.length > MAX) {
      const evict = cache.lru.slice(MAX);
      cache.lru = cache.lru.slice(0, MAX);
      for (const e of evict) {
        try { delete cache.bySession[e]; } catch { /* ignore */ }
      }
    }
  };
  const _stashChatDomForSession = (sid) => {
    const id = String(sid || '').trim();
    if (!id) return;
    const container = document.getElementById('chatMessages');
    if (!container) return;
    // Capture scroll state BEFORE moving nodes.
    const wasNearBottom = isUserNearBottom(container);
    const scrollTop = container.scrollTop;
    // PERF: use native Range.extractContents() (fast) instead of JS while-loop node moves.
    let frag = null;
    try {
      const r = document.createRange();
      r.selectNodeContents(container);
      frag = r.extractContents();
    } catch {
      frag = document.createDocumentFragment();
      try { frag.append(...Array.from(container.childNodes || [])); } catch { /* ignore */ }
      while (container.firstChild) frag.appendChild(container.firstChild);
    }
    const cache = _getChatDomCache();
    cache.bySession[id] = {
      fragment: frag,
      scrollTop,
      wasNearBottom,
      renderedCount: (chatSessions && chatSessions[id] && Array.isArray(chatSessions[id].messages))
        ? chatSessions[id].messages.length
        : 0,
      at: Date.now()
    };
    _touchChatDomCache(id);
  };
  const _restoreChatDomForSession = (sid) => {
    const id = String(sid || '').trim();
    if (!id) return false;
    const container = document.getElementById('chatMessages');
    if (!container) return false;
    const cache = _getChatDomCache();
    const entry = cache.bySession && cache.bySession[id] ? cache.bySession[id] : null;
    if (!entry || !entry.fragment) return false;
    // Restore DOM.
    try { container.appendChild(entry.fragment); } catch { return false; }
    // Restore scroll position (preserve reading position if user had scrolled up).
    try {
      if (entry.wasNearBottom) container.scrollTop = container.scrollHeight;
      else container.scrollTop = Math.min(Number(entry.scrollTop || 0), container.scrollHeight);
    } catch { /* ignore */ }
    _touchChatDomCache(id);
    return true;
  };
  const _maybeAppendNewMessagesAfterRestore = async (sid) => {
    const id = String(sid || '').trim();
    if (!id) return;
    if (_isStaleSwitch()) return;
    const cache = _getChatDomCache();
    const entry = cache.bySession && cache.bySession[id] ? cache.bySession[id] : null;
    const renderedCount = entry && Number.isFinite(Number(entry.renderedCount)) ? Number(entry.renderedCount) : 0;
    const msgs = ensureSessionMessages(id);
    const total = Array.isArray(msgs) ? msgs.length : 0;
    if (total <= renderedCount) return;

    // Build inline diff keys to filter duplicates (same as full restore path)
    const inlineDiffKeys = _buildInlineDiffKeySetForSession(id);

    // Render only the newly appended tail (keeps cache coherent without full rebuild).
    // Yield to the browser to avoid freezing if a burst of messages arrived off-tab.
    const tail = msgs.slice(renderedCount);
    const runner = window.codeonPerf && typeof window.codeonPerf.runChunked === 'function'
      ? window.codeonPerf.runChunked
      : async (items, fn) => { for (const it of items) { await fn(it); } };
    await runner(tail, async (msg) => {
      if (_isStaleSwitch()) return;
      // During an active run, avoid rendering persisted snapshots that would duplicate the live bubble.
      if (msg && isSessionProcessing(id)) {
        if (msg.role === 'assistant_partial' || msg.role === 'file_preview') return;
        if (msg.role === 'assistant' && msg.streaming === true) return;
      }
      // Filter file_preview messages that match inline diffs in assistant messages
      if (msg && msg.role === 'file_preview' && inlineDiffKeys && inlineDiffKeys.size > 0) {
        const fp = normalizeRelPathForDiffPreview(msg.filePath || msg.fileName || '');
        const dc = truncateForSnapshot(typeof msg.diffContent === 'string' ? msg.diffContent : '', MAX_STREAM_SNAPSHOT_DIFF_CHARS);
        const k = _inlineDiffKey(fp, dc);
        if (k && inlineDiffKeys.has(k)) return;
      }
      await renderMessageToUI(msg);
    }, { budgetMs: 8 });

    try { if (entry) entry.renderedCount = total; } catch { /* ignore */ }
  };
  const _finalizeStaleStreamingBubbleIfNeeded = () => {
    // If a run finished while this session was inactive, we can finalize the streaming bubble
    // on-demand when switching back (without rebuilding the whole transcript).
    try {
      const sid = String(currentSessionId || '').trim();
      if (!sid) return;
      const st = getRunState(sid);
      if (!st || st.isProcessing === true) return;
      const container = document.getElementById('chatMessages');
      if (!container) return;
      const sel = `.message.assistant[data-streaming-session="${CSS.escape(sid)}"]`;
      const bubble = container.querySelector(sel);
      if (!bubble) return;
      // Render final markdown into the bubble and promote it to a normal message.
      try { renderBufferedStreamingForSession(sid, { finalize: true, allowWhenNotProcessing: true }); } catch { /* ignore */ }
      try { bubble.removeAttribute('data-streaming-session'); } catch { /* ignore */ }
      try { addCodeBlockActions(bubble); } catch { /* ignore */ }
    } catch { /* ignore */ }
  };

  // Save current session before switching (will trigger split in saveChatHistory)
  if (currentSessionId && chatSessions[currentSessionId]) {
    // Only save if the current in-memory chatHistory actually represents the current session.
    if (hydratedChatSessionId === currentSessionId) {
      // PERF: do not block tab switching on disk/IPC persistence.
      // First, sync in-memory `chatHistory` into this session's canonical timeline.
      try {
        migrateLegacyUiMetadataIntoMessages(currentSessionId);
        const timeline = Array.isArray(chatHistory) ? chatHistory : ensureSessionMessages(currentSessionId);
        const deduped = dedupeMessagesStable(timeline);
        replaceSessionMessages(currentSessionId, deduped);
        chatSessions[currentSessionId].timestamp = Date.now();
      } catch { /* ignore */ }
      // Then persist async (safe: saveChatHistory snapshots sid/folder internally).
      try {
        if (window.codeonPerf && typeof window.codeonPerf.idle === 'function') {
          window.codeonPerf.idle(() => { saveChatHistory(true).catch(() => {}); }, { timeout: 600 });
        } else {
          setTimeout(() => { saveChatHistory(true).catch(() => {}); }, 0);
        }
      } catch { /* ignore */ }
    }
  }

  // Stash DOM for the previous session so we can restore instantly later.
  if (prevSid && prevSid !== String(sessionId || '').trim()) {
    try { _stashChatDomForSession(prevSid); } catch { /* ignore */ }
  }

  currentSessionId = sessionId;
  window.currentSessionId = currentSessionId;

  // Ensure seq counter is aligned with persisted history so ordering remains stable.
  ensureMessageSeqInitialized(currentSessionId);
  cleanupStaleAssistantPartialSnapshot(currentSessionId);

  // Best-effort load of read_file cache for this session (non-blocking)
  if (window.readFileCacheService && window.currentFolder) {
    window.readFileCacheService.loadSession(window.currentFolder, currentSessionId).catch(() => {});
  }

  // Canonical: single timeline per session. Migrate any legacy uiMetadata once.
  migrateLegacyUiMetadataIntoMessages(sessionId);
  chatHistory = ensureSessionMessages(sessionId);
  console.log(`[Session Switch] Loaded ${chatHistory.length} message(s) for ${sessionId}`);
  hydratedChatSessionId = currentSessionId;

  // Clear and restore UI
  const messagesContainer = document.getElementById('chatMessages');
  // Try fast-path restore: reuse cached DOM for this session.
  const restored = (() => {
    try { return _restoreChatDomForSession(sessionId) === true; } catch { return false; }
  })();

  if (!restored) {
    try { messagesContainer.replaceChildren(); } catch { messagesContainer.innerHTML = ''; }

  if (chatHistory.length === 0) {
    messagesContainer.innerHTML = `
      <div class="welcome-message">
        <h3>👋 Welcome to Codeon</h3>
        <p>I'm your AI coding assistant. I can help you:</p>
        <ul>
          <li>✨ Write and refactor code</li>
          <li>🐛 Debug and fix issues</li>
          <li>📝 Explain complex concepts</li>
          <li>🚀 Optimize performance</li>
          <li>💡 Suggest improvements</li>
        </ul>
        <p>Ask me anything about your code!</p>
      </div>
    `;
  } else {
    // If we have assistant messages that already embed diff cards inline (`inlineDiffBlocks`),
    // avoid rendering duplicate standalone `file_preview` messages for the same diff.
    const inlineDiffKeys = _buildInlineDiffKeySetForSession(sessionId);

    // CRITICAL FIX: Sort messages by timeline order (timestamp, then seq) before rendering.
    // During streaming, messages (user, assistant, file_preview, tool_receipt, etc.) are added
    // to the timeline array as they occur. But file_preview messages are flushed at the END
    // of the run via flushStreamDiffBlocksToHistory, giving them later seq numbers.
    // Without sorting, the visual order on restore won't match what the user saw during streaming.
    // The assistant message (with embedded inlineDiffBlocks for proper text interleaving) should
    // appear in its correct position, and file_preview messages should be filtered out when they
    // match the inline diffs.
    const sortedMessages = Array.isArray(chatHistory) ? chatHistory.slice().sort(compareTimeline) : [];

    // Render messages without modifying chatHistory.
    // PERF: time-slice so we never freeze the UI on large histories.
    const runner = window.codeonPerf && typeof window.codeonPerf.runChunked === 'function'
      ? window.codeonPerf.runChunked
      : async (items, fn) => { for (const it of items) { await fn(it); } };
    await runner(sortedMessages, async (msg) => {
      if (_isStaleSwitch()) return;
      // If this session has an active run, skip persisted partial snapshots to avoid
      // rendering the same stream+diffs twice (we render the live streaming bubble below).
      if (msg && isSessionProcessing(sessionId)) {
        // During an active run, the live streaming bubble renders inline diffs and partial content.
        // Rendering persisted snapshots and file_preview messages here causes duplicates when switching tabs.
        if (msg.role === 'assistant_partial' || msg.role === 'file_preview') return;
        // Also skip the persisted streaming assistant message during an active run
        // (the streaming bubble is the live representation).
        if (msg.role === 'assistant' && msg.streaming === true) return;
      }
      if (msg && msg.role === 'file_preview' && inlineDiffKeys && inlineDiffKeys.size > 0) {
        const fp = normalizeRelPathForDiffPreview(msg.filePath || msg.fileName || '');
        const dc = truncateForSnapshot(typeof msg.diffContent === 'string' ? msg.diffContent : '', MAX_STREAM_SNAPSHOT_DIFF_CHARS);
        const k = _inlineDiffKey(fp, dc);
        if (k && inlineDiffKeys.has(k)) return;
      }
      await renderMessageToUI(msg);
    }, { budgetMs: 10 });

    // Track how many messages we rendered so cache restore can append only new tail messages.
    try {
      const cache = _getChatDomCache();
      if (cache && cache.bySession) {
        if (!cache.bySession[sessionId]) cache.bySession[sessionId] = {};
        cache.bySession[sessionId].renderedCount = Array.isArray(chatHistory) ? chatHistory.length : 0;
      }
      _touchChatDomCache(sessionId);
    } catch { /* ignore */ }
  }
  } else {
    // Cache restore path: if new messages arrived while inactive, append only the tail.
    try { await _maybeAppendNewMessagesAfterRestore(sessionId); } catch { /* ignore */ }
    // If a run finalized off-tab, promote + finalize the streaming bubble now.
    try { _finalizeStaleStreamingBubbleIfNeeded(); } catch { /* ignore */ }
  }

  // Scroll behavior:
  // - If we restored cached DOM, preserve scroll position (already handled).
  // - If we rebuilt, keep the existing behavior of jumping to bottom.
  if (!restored) {
    try { messagesContainer.scrollTop = messagesContainer.scrollHeight; } catch { /* ignore */ }
  }

  // Fast visual updates first (tab highlight + scroll into view).
  renderChatTabs();
  scrollChatTabIntoView(sessionId, { behavior: 'auto' });

  // Defer heavier secondary UI updates to keep tab switching buttery smooth.
  const deferIdle = (fn) => {
    try {
      if (window.codeonPerf && typeof window.codeonPerf.idle === 'function') {
        window.codeonPerf.idle(fn, { timeout: 250 });
        return;
      }
    } catch { /* ignore */ }
    setTimeout(() => { try { fn(); } catch { /* ignore */ } }, 0);
  };

  deferIdle(() => {
    // Run these in small time slices, and cancel immediately if the user switches again.
    const tasks = [
      () => { try { restoreTodosForSession(sessionId); } catch { /* ignore */ } },
      () => { try { restoreConsoleForSession(sessionId); } catch { /* ignore */ } },
      () => { try { restoreAgentForSession(sessionId); } catch { /* ignore */ } },
      () => { try { renderAgentPillForSession(sessionId); } catch { /* ignore */ } },
      () => { try { renderSkillSelectForSession(sessionId); } catch { /* ignore */ } },
      () => { try { renderSkillPillForSession(sessionId); } catch { /* ignore */ } },
      () => { try { renderMessageQueueUI(sessionId); } catch { /* ignore */ } },
      () => { try { renderConsoleForSession(sessionId); } catch { /* ignore */ } },
      () => { try { renderReceiptsForSession(sessionId); } catch { /* ignore */ } },
      () => { try { refreshSkillScriptsForSession(sessionId); } catch { /* ignore */ } },
      // Refresh explorer for this session (can be heavy) — renderFileTree is now internally cached/lazy.
      () => { try { renderFileTree(workspaceFileTreeSnapshot || []); } catch { /* ignore */ } },
      () => { try { updateImportExportButtonsForSession(sessionId); } catch { /* ignore */ } },
      () => { try { renderAttachmentPreview(); } catch { /* ignore */ } },
      // Refresh send/stop button state for the newly active tab
      () => { try { updateSendButtonForCurrentSession(); } catch { /* ignore */ } },
      () => { try { _syncAetPauseButtonUI(sessionId); } catch { /* ignore */ } },
      // If this session has an in-flight run, render the buffered streaming bubble immediately
      // (deltas were collected while the tab was inactive).
      () => { try { renderBufferedStreamingForSession(sessionId); } catch { /* ignore */ } }
    ];
    const runner = window.codeonPerf && typeof window.codeonPerf.runChunked === 'function'
      ? window.codeonPerf.runChunked
      : async (items, fn) => { for (const it of items) { await fn(it); } };
    runner(tasks, async (t) => {
      if (_isStaleSwitch()) return;
      if (typeof t === 'function') t();
    }, { budgetMs: 6 }).catch(() => {});
  });

  // Best-effort: load AET runs for this session (non-blocking)
  try {
    // If the user has the graph open, keep it open and make it follow the newly selected session.
    if (wasEditorAetOpen) {
      try {
        const next = (prevMode === 'map' || prevMode === 'graph') ? prevMode : 'graph';
        _setAetViewMode(sessionId, next);
      } catch { /* ignore */ }
      try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }
    }
    // Render immediately (may show empty/loading) then refresh when load completes.
    try { renderExecutionTimelineForSession(sessionId); } catch { /* ignore */ }
    loadExecutionTimelineForSession(sessionId).catch(() => {});
  } catch { /* ignore */ }
  try { _syncAetViewToggleUI(); } catch { /* ignore */ }

  // Rebuild diff cache from this session's persisted file previews, then reapply decorations
  // to all open file models so highlights are stable across tab switches.
  deferIdle(() => {
    try {
      if (_isStaleSwitch()) return;
      rebuildLastDiffCacheForSession(sessionId);
      refreshDiffDecorationsForAllOpenTabs();
      const active = findTabByKey(activeEditorTabKey);
      if (active) syncDiffDecorationsForTab(active);
    } catch { /* ignore */ }
  });

  // Keep the chat status banner in sync when switching tabs.
  deferIdle(() => {
    try { if (_isStaleSwitch()) return; } catch { /* ignore */ }
    try { _refreshChatStatusBannerForCurrentSession(); } catch { /* ignore */ }
  });

  // Optional perf logging (opt-in only via `localStorage.codeon_perf_debug=1`).
  try {
    if (__debugPerf) {
      const t1 = __perf && typeof __perf.now === 'function' ? __perf.now() : Date.now();
      console.debug(`[Perf] switchToSession(${String(sessionId)}) took ${Math.round(t1 - __tSwitchStart)}ms (restored=${restored ? 'yes' : 'no'})`);
    }
  } catch { /* ignore */ }
}


function openChatSession(sessionId) {
  if (!sessionId || !chatSessions || !chatSessions[sessionId]) return;
  chatSessions[sessionId].isClosed = undefined;
  chatSessions[sessionId].closedAt = undefined;
  chatSessions[sessionId].timestamp = Date.now();
  saveChatHistory(true).catch(() => {});
  renderChatTabs();
  renderChatDropdown();
}


async function closeChatSession(sessionId) {
  if (!sessionId || !chatSessions || !chatSessions[sessionId]) return;

  chatSessions[sessionId].isClosed = true;
  chatSessions[sessionId].closedAt = Date.now();
  chatSessions[sessionId].timestamp = Date.now();

  // If closing the active session, switch to another open session (or create one)
  if (currentSessionId === sessionId) {
    const openIds = Object.keys(chatSessions).filter(id => chatSessions[id] && chatSessions[id].isClosed !== true && id !== sessionId);
    if (openIds.length > 0) {
      const next = openIds.reduce((prev, curr) => {
        const a = chatSessions[prev]?.timestamp || 0;
        const b = chatSessions[curr]?.timestamp || 0;
        return b > a ? curr : prev;
      });
      await switchToSession(next);
    } else {
      await createNewChatSession();
    }
  }

  await saveChatHistory(true);
  renderChatTabs();
  renderChatDropdown();
}


// Delete a chat session
function deleteChatSession(sessionId) {
  if (Object.keys(chatSessions).length === 1) {
    alert('Cannot delete the last chat session');
    return;
  }

  delete chatSessions[sessionId];
  // Also delete any pending attachments for this session
  if (pendingAttachmentsBySession && pendingAttachmentsBySession[sessionId]) {
    delete pendingAttachmentsBySession[sessionId];
  }
  // Also delete per-session run/console caches (prevents leakage + memory growth)
  if (runStateBySession && runStateBySession[sessionId]) {
    delete runStateBySession[sessionId];
  }
  if (consoleMessagesBySession && consoleMessagesBySession[sessionId]) {
    delete consoleMessagesBySession[sessionId];
  }
  if (consoleIndicatorBySession && consoleIndicatorBySession[sessionId]) {
    delete consoleIndicatorBySession[sessionId];
  }

  // If deleting current session, switch to another
  if (currentSessionId === sessionId) {
    const remainingIds = Object.keys(chatSessions);
    if (remainingIds.length > 0) {
      switchToSession(remainingIds[0]);
    }
  }

  saveChatHistory();
  renderChatTabs();
  renderChatDropdown();
}


// Render chat tabs
function renderChatTabs() {
  const tabsContainer = document.getElementById('chatTabs');
  if (!tabsContainer) return;

  // PERF: build off-DOM then swap children in one go.
  try { tabsContainer.replaceChildren(); } catch { tabsContainer.innerHTML = ''; }
  const frag = document.createDocumentFragment();

  Object.keys(chatSessions).filter(id => chatSessions[id] && chatSessions[id].isClosed !== true).forEach(sessionId => {
    const session = chatSessions[sessionId];
    const tab = document.createElement('div');
    tab.className = `chat-tab ${sessionId === currentSessionId ? 'active' : ''}`;
    tab.dataset.sessionId = sessionId;
    const isRunning = isSessionProcessing(sessionId);
    tab.innerHTML = `
      <div class="chat-tab-label" title="${escapeHtml(session.name)}">
        ${isRunning ? '<span class="chat-tab-icon" aria-hidden="true">⏳</span>' : ''}
        <span class="chat-tab-title">${escapeHtml(session.name)}</span>
      </div>
      <button class="chat-tab-close" data-session="${sessionId}">×</button>
    `;

    const labelEl = tab.querySelector('.chat-tab-label');
    if (labelEl) labelEl.addEventListener('click', () => switchToSession(sessionId));
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideContextMenu();
      showChatTabContextMenu(e, sessionId);
    });
    tab.querySelector('.chat-tab-close').addEventListener('click', async (e) => {
      e.stopPropagation();
      // Power action: Shift/Alt-click to delete permanently (kept for hygiene).
      if (e.shiftKey || e.altKey) {
        if (await customConfirm(`Delete "${session.name}" permanently? This cannot be undone.`)) {
        deleteChatSession(sessionId);
        }
        return;
      }
      if (await customConfirm(`Close "${session.name}"? You can reopen it from the dropdown.`)) {
        await closeChatSession(sessionId);
      }
    });

    frag.appendChild(tab);
  });
  tabsContainer.appendChild(frag);
}

function renderChatDropdown() {
  const dropdown = document.getElementById('chatSessionDropdown');
  // Keep legacy select in sync (hidden), but render Cursor-style popover list as primary UI.
  if (dropdown) {
  dropdown.innerHTML = '<option value="">Switch Chat...</option>';

    const allIds = Object.keys(chatSessions || {});
    const openIds = allIds
      .filter(id => chatSessions[id] && chatSessions[id].isClosed !== true)
      .sort((a, b) => (chatSessions[b]?.timestamp || 0) - (chatSessions[a]?.timestamp || 0));
    const closedIds = allIds
      .filter(id => chatSessions[id] && chatSessions[id].isClosed === true)
      .sort((a, b) => (chatSessions[b]?.timestamp || 0) - (chatSessions[a]?.timestamp || 0));

    const openGroup = document.createElement('optgroup');
    openGroup.label = 'Open chats';
    openIds.forEach(sessionId => {
    const session = chatSessions[sessionId];
    const option = document.createElement('option');
    option.value = sessionId;
    option.textContent = session.name;
      if (sessionId === currentSessionId) option.selected = true;
      openGroup.appendChild(option);
    });
    if (openIds.length > 0) dropdown.appendChild(openGroup);

    const closedGroup = document.createElement('optgroup');
    closedGroup.label = 'Closed chats';
    closedIds.forEach(sessionId => {
      const session = chatSessions[sessionId];
      const option = document.createElement('option');
      option.value = sessionId;
      option.textContent = `${session.name} (closed)`;
      if (sessionId === currentSessionId) option.selected = true;
      closedGroup.appendChild(option);
    });
    if (closedIds.length > 0) dropdown.appendChild(closedGroup);
  }

  const titleEl = document.getElementById('chatSessionsTriggerTitle');
  const metaEl = document.getElementById('chatSessionsTriggerMeta');
  // Trigger is icon-only now; these nodes may not exist.
  if (titleEl) {
    const session = currentSessionId && chatSessions ? chatSessions[currentSessionId] : null;
    titleEl.textContent = session ? String(session.name || 'Chat') : 'Chats';
  }
  if (metaEl) {
    const session = currentSessionId && chatSessions ? chatSessions[currentSessionId] : null;
    const meta = session ? getSessionDisplayMeta(session).meta : '';
    metaEl.textContent = meta;
  }

  renderChatSessionsPopoverList();
}


// Restore to a specific checkpoint
async function restoreToCheckpoint(commitHash) {
  let skipConfirmation = false;
  try {
    // Backwards compatible: allow restoreToCheckpoint(hash, true) or restoreToCheckpoint(hash, { skipConfirmation: true })
    const arg = arguments && arguments.length >= 2 ? arguments[1] : null;
    if (arg === true) skipConfirmation = true;
    if (arg && typeof arg === 'object' && arg.skipConfirmation === true) skipConfirmation = true;
  } catch { /* ignore */ }

  if (!skipConfirmation) {
    const confirmed = await customConfirm(
      `Restore project to this checkpoint?\n\nThis will discard any uncommitted changes.`,
      'Restore Checkpoint'
    );
    if (!confirmed) return false;
  }

  try {
    const ok = await _ensureSafeForGlobalGitRestore({ actionTitle: 'Git Restore' });
    if (!ok) return false;

    const result = await withGitOperationLock(async () => {
      // Stash any uncommitted changes (including untracked) to avoid checkout failures.
      await window.electronAPI.runTerminalCommand('git stash --include-untracked', true);
      const r = await window.electronAPI.runTerminalCommand(`git checkout -f ${commitHash}`, true);
      // Reset workspace to match checkpoint (remove all untracked + ignored files).
      await window.electronAPI.runTerminalCommand('git clean -fdx', true);
      await ensureGitOnMainBranch();
      return r;
    });

    if (result && result.success) {
      // Refresh file tree and editor
      if (window.refreshFileTree) await window.refreshFileTree();
      
      // SYNC: Clean up editor tabs for files that no longer exist after restore
      try {
        if (window.FileSyncController?.handleCheckpointRestore) {
          await window.FileSyncController.handleCheckpointRestore();
        }
      } catch { /* ignore */ }
      
      // Re-open current file if it still exists, otherwise open first available tab
      if (window.currentFile) {
        try {
          const exists = await window.electronAPI?.getFileStats?.(window.currentFile);
          if (exists?.success) {
            await window.openFile(window.currentFile);
          } else {
            // File no longer exists - currentFile was already cleared by handleCheckpointRestore
            // Try to activate the first remaining tab if any
            if (window.editorTabs?.length > 0) {
              const firstTab = window.editorTabs[0];
              if (firstTab && typeof activateEditorTab === 'function') {
                await activateEditorTab(firstTab.key);
              }
            }
          }
        } catch {
          // Fallback: try to open the file anyway
          await window.openFile(window.currentFile);
        }
      }

      // Sync docs state from workspace (docs are git-tracked)
      try {
        await window._docsState?.reloadFromWorkspace?.({ clearIfMissing: true });
        window._onDocsStateUpdate?.();
      } catch { /* ignore */ }

      // Sync learning state from workspace (if present)
      try {
        await window._learningState?.reloadFromWorkspace?.({ clearIfMissing: true });
        window.renderLearningPanel?.();
      } catch { /* ignore */ }

      // Sync proofed edits state from workspace (if present)
      try {
        await window._proofedEditsState?.reloadFromWorkspace?.({ clearIfMissing: true });
        window.renderVerificationPanel?.();
      } catch { /* ignore */ }

      addSystemMessage(`✅ Restored to checkpoint: ${commitHash.substring(0, 7)}`);
      return true;
    }

    addSystemMessage(`❌ Failed to restore: ${result?.error || result?.output || 'Unknown error'}`, true);
    return false;
  } catch (e) {
    addSystemMessage(`❌ Error restoring: ${e?.message || String(e)}`, true);
    return false;
  }
}


function addSystemMessage(message, isError = false, { sessionId = currentSessionId } = {}) {
  // Prevent cross-tab leaks: only render system messages in the active session tab.
  if (sessionId && sessionId !== currentSessionId) return;
  const messagesContainer = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message system ${isError ? 'error' : ''}`;
  messageDiv.innerHTML = `
    <div class="message-content system-message">${escapeHtml(message)}</div>
  `;
  appendChatNode(messagesContainer, messageDiv, { roleHint: 'assistant' });
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
