// ---- CHUNK 3/6 from hoisted.js (AST statement boundaries; order preserved) ----


async function createGeneratedImagePreviewElement(result, args) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message generated-image-preview';

  const filePath = result.filePath || args.filename;
  const fileName = String(filePath || '').split(/[/\\]/).pop() || '';

  // Read the generated image to show preview
  let imageDataUrl = '';
  try {
    const fullPath = `${window.currentFolder}/${filePath}`;
    const readResult = await window.electronAPI.readFile(fullPath);
    if (readResult.success) {
      // Determine mime type from extension
      const ext = filePath.split('.').pop().toLowerCase();
      let mimeType = 'image/png';
      if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
      if (ext === 'webp') mimeType = 'image/webp';
      if (ext === 'gif') mimeType = 'image/gif';

      // Use content directly (it's base64 for images now)
      imageDataUrl = `data:${mimeType};base64,${readResult.content}`;
    }
  } catch (e) {
    console.error('Failed to read generated image:', e);
  }

  const safeFilePathAttr = escapeAttr(filePath);
  const safeFileNameHtml = escapeHtml(fileName);
  const safeFilePathHtml = escapeHtml(String(filePath || ''));

  messageDiv.innerHTML = `
    <div class="generated-image-header">
      <div class="generated-image-header-top">
        <span class="generated-image-action">✨ Generated Image</span>
        <button class="file-preview-open-btn" data-path="${safeFilePathAttr}">Open File</button>
      </div>
      <span class="generated-image-path">${safeFileNameHtml}</span>
    </div>
    <div class="generated-image-content">
      ${imageDataUrl ? `<img src="${imageDataUrl}" alt="${escapeAttr(fileName)}" class="generated-image-preview-img">` : '<p>Image generated successfully</p>'}
    </div>
    <div class="generated-image-stats">
      <span>📁 ${safeFilePathHtml}</span>
      <span>•</span>
      <span>🎨 AI Generated</span>
    </div>
  `;

  // Add click handler for open button
  const openBtn = messageDiv.querySelector('.file-preview-open-btn');
  if (openBtn) {
    openBtn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent bubbling
      const fullPath = `${window.currentFolder}/${filePath}`;
      try {
        if (window.electronAPI && typeof window.electronAPI.openPath === 'function') {
          await window.electronAPI.openPath(fullPath);
        } else if (window.electronAPI && typeof window.electronAPI.revealInFinder === 'function') {
          await window.electronAPI.revealInFinder(fullPath);
        }
      } catch {
        // ignore
      }
    });
  }

  // Click image to open Lightbox
  const img = messageDiv.querySelector('.generated-image-preview-img');
  if (img) {
    img.addEventListener('click', () => {
      openLightbox(imageDataUrl);
    });
  }

  return messageDiv;
}


function openLightbox(imageUrl) {
  const lightbox = document.getElementById('imageLightbox');
  const img = document.getElementById('lightboxImage');
  const closeBtn = document.getElementById('lightboxClose');

  img.src = imageUrl;
  lightbox.style.display = 'flex';

  // Close handlers
  const close = () => {
    lightbox.style.display = 'none';
    img.src = '';
    try { document.removeEventListener('keydown', onKeyDown); } catch { /* ignore */ }
  };

  closeBtn.onclick = close;
  lightbox.onclick = (e) => {
    if (e.target === lightbox) close();
  };

  // Escape key
  const onKeyDown = (e) => {
    try {
      if (e && e.key === 'Escape') close();
    } catch {
      // ignore
    }
  };
  document.addEventListener('keydown', onKeyDown);
}


// Show generated image preview (legacy / fallback)
async function showGeneratedImagePreview(result, args) {
  const messagesContainer = document.getElementById('chatMessages');
  const element = await createGeneratedImagePreviewElement(result, args);
  messagesContainer.appendChild(element);
}


function formatGitDiff(diffContent) {
  if (!diffContent || !diffContent.trim()) {
    return '<div class="diff-no-changes">No changes</div>';
  }

  const lines = diffContent.split('\n');
  let html = '<div class="diff-content">';
  
  for (const line of lines) {
    const escapedLine = escapeHtml(line);
    
    if (line.startsWith('+++') || line.startsWith('---')) {
      // File headers
      html += `<div class="diff-line diff-file-header">${escapedLine}</div>`;
    } else if (line.startsWith('@@')) {
      // Hunk headers
      html += `<div class="diff-line diff-hunk-header">${escapedLine}</div>`;
    } else if (line.startsWith('+')) {
      // Added lines (green)
      html += `<div class="diff-line diff-added">${escapedLine}</div>`;
    } else if (line.startsWith('-')) {
      // Removed lines (red)
      html += `<div class="diff-line diff-removed">${escapedLine}</div>`;
    } else {
      // Context lines
      html += `<div class="diff-line diff-context">${escapedLine}</div>`;
    }
  }
  
  html += '</div>';
  return html;
}


// Get last commit hash
async function getLastCommitHash() {
  try {
    const result = await window.electronAPI.runTerminalCommand('git rev-parse HEAD', true);
    if (result.success && result.output) {
      return result.output.trim();
    }
  } catch (e) {
    console.error('Failed to get commit hash:', e);
  }
  return null;
}


async function ensureGitOnMainBranch() {
  try {
    if (!window.electronAPI) return;
    // If HEAD is detached, create/switch to main at current HEAD.
    const headCheck = await window.electronAPI.runTerminalCommand('git symbolic-ref -q HEAD', true);
    if (!headCheck.success) {
      await window.electronAPI.runTerminalCommand('git checkout -B main', true);
    }
  } catch {
    // ignore
  }
}


async function maybeCommitAICheckpoint(reason = 'Claude run') {
  try {
    if (!window.electronAPI) return null;

    // Only commit if there are changes.
    const status = await window.electronAPI.runTerminalCommand('git status --porcelain', true);
    const changes = status && status.success && typeof status.output === 'string' ? status.output.trim() : '';
    if (!changes) return null;

    await ensureGitOnMainBranch();

    const safeReason = String(reason || 'Claude run').replace(/"/g, '\'').slice(0, 120);
    const subject = `[AI-Agent-Checkpoint] ${safeReason}`;
    const body = `Timestamp: ${Date.now()}`;

    const commitRes = await window.electronAPI.runTerminalCommand(
      `git add -A && git reset -q -- .ai-agent >/dev/null 2>&1 || true; git commit -m "${subject}" -m "${body}"`,
      true
    );
    if (!commitRes || commitRes.success !== true) return null;
    return await getLastCommitHash();
  } catch {
    return null;
  }
}


// Save chat history to file system (Desktop App)
async function saveChatHistory(force = false) {
  // Capture stable refs up front (tab switching can change globals mid-await).
  const folder = currentFolder;
  const sid = String(currentSessionId || '').trim();
  if (!folder || !sid) {
    console.warn('[Chat History] Cannot save: currentFolder or currentSessionId not set');
    return;
  }

  const isHydrated = hydratedChatSessionId === sid;
  let isProcessing = false;
  try {
    isProcessing = (typeof isSessionProcessing === 'function') ? !!isSessionProcessing(sid) : false;
  } catch { /* ignore */ }

  // Canonical persistence: a single timeline per session (`chatSessions[sessionId].messages`).
  // IMPORTANT: only write from `chatHistory` when it actually reflects the current session.
  if (chatSessions[sid]) {
    if (isHydrated) {
      // Migrate any legacy uiMetadata into the canonical timeline before persisting.
      migrateLegacyUiMetadataIntoMessages(sid);
      const timeline = Array.isArray(chatHistory) ? chatHistory : ensureSessionMessages(sid);
      const deduped = dedupeMessagesStable(timeline);
      replaceSessionMessages(sid, deduped);
    } else {
      // If not hydrated (common on startup), don't overwrite persisted session messages.
      ensureSessionMessages(sid);
    }
    chatSessions[sid].timestamp = Date.now();
  }

  try {
    const count = Array.isArray(chatSessions?.[sid]?.messages) ? chatSessions[sid].messages.length : 0;
    // PERF: avoid JSON.stringify size logging; it becomes expensive as sessions grow.
    if (!isProcessing) console.log(`[Chat History] Saving - ${count} message(s)`);
    
    const persist = async () => {
      if (!window.electronAPI) return;

      // Codeon-style workspace-scoped persistence (SQLite KV)
      const chatState = buildPersistedChatState();
      const kvResult = await window.electronAPI.storageStoreObject(folder, CODEON_CHAT_STATE_KEY, chatState);

      // Back-compat: keep writing legacy chat-sessions.json (per-project)
      let legacyApiResult = { success: true };
      // PERF: during active runs, avoid redundant legacy writes (KV + stream journal cover safety).
      if (force || !isProcessing) {
        legacyApiResult = await window.electronAPI.saveChatHistory(folder, chatSessions);
      }

      if (kvResult.success && legacyApiResult.success) {
        if (!isProcessing) console.log(`[Chat History] ✅ Stored ${CODEON_CHAT_STATE_KEY} in workspace storage`);
      } else {
        console.error('[Save] Failed:', kvResult.error || legacyApiResult.error);
        showToast('Failed to save chat history', 3000);
      }
    };

    if (force) {
      // Persist immediately
      if (chatPersistTimer) clearTimeout(chatPersistTimer);
      chatPersistTimer = null;
      await persist();
      // Also persist UI metadata on forced flushes (quit path / explicit flush).
      try { await saveUIMetadataNow(true); } catch { /* ignore */ }
    } else {
      // Debounced persist
      if (chatPersistTimer) clearTimeout(chatPersistTimer);
      // During tool-heavy runs, persist less frequently to keep UI responsive.
      const delayMs = isProcessing ? Math.max(CHAT_PERSIST_DEBOUNCE_MS, 2500) : CHAT_PERSIST_DEBOUNCE_MS;
      chatPersistTimer = setTimeout(() => {
        persist().catch(e => console.error('[Chat History] Debounced persist failed:', e));
      }, delayMs);
    }
  } catch (e) {
    console.error('[Chat History] Failed to save:', e);
    showToast('Error saving chat history', 3000);
  }
}


function _buildUIMetadataSnapshot() {
  try {
    // Keep the file small and robust; cap to avoid unbounded growth.
    const capObject = (obj, maxKeys) => {
      if (!obj || typeof obj !== 'object') return {};
      const out = {};
      const keys = Object.keys(obj).slice(0, maxKeys);
      for (const k of keys) out[k] = obj[k];
      return out;
    };

    const aet = {
      // Graph viewport (per run)
      graphViewportByRunId: capObject(typeof executionTimelineGraphViewportByRunId === 'object' ? executionTimelineGraphViewportByRunId : {}, 300),
      // Drawer selection (per run)
      selectedNodeByRunId: capObject(typeof executionTimelineSelectedNodeByRunId === 'object' ? executionTimelineSelectedNodeByRunId : {}, 300),
      // Feed/graph mode (per session)
      viewModeBySession: capObject(typeof executionTimelineViewModeBySession === 'object' ? executionTimelineViewModeBySession : {}, 80),
      // Active run selection (per session)
      activeRunBySession: capObject(typeof executionTimelineActiveRunBySession === 'object' ? executionTimelineActiveRunBySession : {}, 80),
      // Filters (per session)
      filtersBySession: capObject(typeof executionTimelineFiltersBySession === 'object' ? executionTimelineFiltersBySession : {}, 80),
      // Panel prefs (per session)
      panelPrefsBySession: capObject(typeof executionTimelinePanelPrefsBySession === 'object' ? executionTimelinePanelPrefsBySession : {}, 80)
    };

    return { v: 2, updatedAt: Date.now(), aet };
  } catch {
    return { v: 2, updatedAt: Date.now(), aet: {} };
  }
}


function scheduleUIMetadataSave(delayMs = 500) {
  try {
    if (!window.currentFolder) return;
    if (!window.electronAPI || typeof window.electronAPI.saveUIMetadata !== 'function') return;
    if (uiMetadataSaveTimer) clearTimeout(uiMetadataSaveTimer);
    uiMetadataSaveTimer = setTimeout(() => {
      uiMetadataSaveTimer = null;
      saveUIMetadataNow(false).catch(() => {});
    }, Math.max(50, Number(delayMs) || 500));
  } catch {
    // ignore
  }
}


async function saveUIMetadataNow(force = false) {
  try {
    if (!window.currentFolder) return;
    if (!window.electronAPI || typeof window.electronAPI.saveUIMetadata !== 'function') return;
    // Always save the latest snapshot (even if force=false).
    uiMetadataState = _buildUIMetadataSnapshot();
    await window.electronAPI.saveUIMetadata(window.currentFolder, uiMetadataState);
    if (force) {
      // Helpful for dev verification; keep logs quiet otherwise.
      if (aetDebugEnabled()) console.log('[UI Metadata] Saved');
    }
  } catch (e) {
    if (force) console.warn('[UI Metadata] Save failed:', e?.message || String(e));
  }
}


function applyUIMetadataState(loaded) {
  try {
    if (!loaded || typeof loaded !== 'object') return;
    if (Number(loaded.v) !== 2) return;
    const aet = loaded.aet && typeof loaded.aet === 'object' ? loaded.aet : {};
    // Restore AET UI state (best-effort).
    if (aet.graphViewportByRunId && typeof aet.graphViewportByRunId === 'object') {
      Object.assign(executionTimelineGraphViewportByRunId, aet.graphViewportByRunId);
    }
    if (aet.selectedNodeByRunId && typeof aet.selectedNodeByRunId === 'object') {
      Object.assign(executionTimelineSelectedNodeByRunId, aet.selectedNodeByRunId);
    }
    if (aet.viewModeBySession && typeof aet.viewModeBySession === 'object') {
      Object.assign(executionTimelineViewModeBySession, aet.viewModeBySession);
    }
    if (aet.activeRunBySession && typeof aet.activeRunBySession === 'object') {
      Object.assign(executionTimelineActiveRunBySession, aet.activeRunBySession);
    }
    if (aet.filtersBySession && typeof aet.filtersBySession === 'object') {
      Object.assign(executionTimelineFiltersBySession, aet.filtersBySession);
    }
    if (aet.panelPrefsBySession && typeof aet.panelPrefsBySession === 'object') {
      Object.assign(executionTimelinePanelPrefsBySession, aet.panelPrefsBySession);
    }
  } catch {
    // ignore
  }
}


// Load all chat sessions for current project from file system (Desktop App)
async function loadChatSessions() {
  if (!currentFolder) return;

  try {
    if (window.electronAPI) {
      // Prefer Codeon-style workspace storage
      const stored = await window.electronAPI.storageGetObject(currentFolder, CODEON_CHAT_STATE_KEY);

      let loadedFromCodeon = false;
      if (stored && stored.success && stored.value) {
        loadedFromCodeon = applyPersistedChatState(stored.value);
      }

      // Fallback: legacy file-based sessions
      const apiResult = loadedFromCodeon
        ? { success: true, sessions: chatSessions }
        : await window.electronAPI.loadChatHistory(currentFolder);
      const uiResult = await window.electronAPI.loadUIMetadata(currentFolder);
      
      if (apiResult.success) {
        if (!loadedFromCodeon) {
          chatSessions = apiResult.sessions || {};

          // Migration: only truncate HUGE tool result payloads on load (aligns with Codeon caps)
          let truncatedTools = 0;
          for (const sessionId in chatSessions) {
            const session = chatSessions[sessionId];
            if (session.history && Array.isArray(session.history)) {
              session.history = session.history.map(msg => {
                if (msg && msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > MAX_TOOL_RESULT_CHARS) {
                  truncatedTools++;
                  return { ...msg, content: truncateToolResultForStorage(msg.content) };
                }
                return msg;
              });
            }
          }
          if (truncatedTools > 0) {
            console.log(`[Chat History] Migration: truncated ${truncatedTools} oversized tool results`);
          }
        }

        console.log(`[Chat History] ✅ Loaded ${Object.keys(chatSessions).length} session(s)`);
      } else {
        console.error('[Chat History] Load failed:', apiResult.error);
        chatSessions = {};
      }

      if (uiResult.success) {
        const loaded = uiResult.metadata && typeof uiResult.metadata === 'object' ? uiResult.metadata : {};
        // New format (v2): persisted UI state (AET viewport, selections, etc.)
        if (Number(loaded.v) === 2) {
          uiMetadataState = loaded;
          uiMetadata = {}; // legacy migration container (unused)
          console.log('[UI Metadata] ✅ Loaded UI state (v2)');
        } else {
          // Legacy format: uiMetadata keyed by sessionId (migration only)
          uiMetadata = loaded;
          uiMetadataState = { v: 2, updatedAt: 0, aet: {} };
          console.log(`[UI Metadata] ✅ Loaded legacy metadata for ${Object.keys(uiMetadata).length} session(s)`);
        }
      } else {
        console.warn('[UI Metadata] Load failed (might not exist yet):', uiResult.error);
        uiMetadata = {};
        uiMetadataState = { v: 2, updatedAt: 0, aet: {} };
      }

      // Migration to canonical single-timeline model:
      // - ensure every session has `messages[]`
      // - merge any legacy `uiMetadata[sessionId]` entries into that timeline
      try {
        for (const sid of Object.keys(chatSessions || {})) {
          ensureSessionMessages(sid);
          migrateLegacyUiMetadataIntoMessages(sid);
          // Back-compat: keep history aligned so older code paths don't break.
          if (chatSessions[sid]) chatSessions[sid].history = chatSessions[sid].messages;
          // If the app was closed mid-stream, mark the last streaming assistant message as interrupted
          // so it renders as a stable, persisted message on reopen.
          try {
            const msgs = chatSessions[sid] && Array.isArray(chatSessions[sid].messages) ? chatSessions[sid].messages : [];
            for (const m of msgs) {
              if (m && m.role === 'assistant' && m.streaming === true) {
                m.streaming = false;
                m.interrupted = true;
              }
            }
          } catch {
            // ignore
          }
          // Merge any high-frequency stream journal state (crash-safe tail) into the timeline.
          try { await hydrateStreamJournalIntoTimeline(sid); } catch { /* ignore */ }
        }
      } catch {
        // ignore
      }
      // After migration, do not rely on uiMetadata anymore.
      uiMetadata = {};
      // Restore persisted UI state (AET viewport, selected nodes, etc.)
      try { applyUIMetadataState(uiMetadataState); } catch { /* ignore */ }
      // Ensure the file exists post-migration (best-effort).
      try { await saveUIMetadataNow(true); } catch { /* ignore */ }
    }
  } catch (e) {
    console.error('[Chat History] Failed to load:', e);
    chatSessions = {};
    uiMetadata = {};
    uiMetadataState = { v: 2, updatedAt: 0, aet: {} };
  }

  // Migration: give older "Chat N" sessions a meaningful name based on the first user message/attachment.
  try {
    let renamed = 0;
    for (const sessionId of Object.keys(chatSessions || {})) {
      const s = chatSessions[sessionId];
      if (!s || !isDefaultSessionName(s.name)) continue;
      const timeline = Array.isArray(s.messages) ? s.messages : (Array.isArray(s.history) ? s.history : []);
      const firstUser = timeline.find(m => m && m.role === 'user' && ((typeof m.content === 'string' && m.content.trim()) || (Array.isArray(m.attachments) && m.attachments.length > 0)));
      if (!firstUser) continue;
      const derived = deriveSessionTitleFromMessage(firstUser.content, firstUser.attachments);
      if (!derived || derived === 'New chat') continue;
      s.name = makeUniqueSessionName(derived, sessionId);
      renamed++;
    }
    if (renamed > 0) {
      await saveChatHistory(true);
    }
  } catch {
    // non-fatal
  }

  // If no sessions exist, create a default one
  if (Object.keys(chatSessions).length === 0) {
    createNewChatSession();
  } else {
    // Prefer opening the most recent OPEN session (closed sessions remain accessible via dropdown)
    const openIds = Object.keys(chatSessions).filter(id => chatSessions[id] && chatSessions[id].isClosed !== true);
    const pickFrom = openIds.length > 0 ? openIds : Object.keys(chatSessions);
    const mostRecent = pickFrom.reduce((prev, curr) => {
      return (chatSessions[curr]?.timestamp || 0) > (chatSessions[prev]?.timestamp || 0) ? curr : prev;
    });

    // If the most recent is closed (happens only when all are closed), start a fresh one.
    if (chatSessions[mostRecent] && chatSessions[mostRecent].isClosed === true) {
      await createNewChatSession();
    } else {
      await switchToSession(mostRecent);
    }
  }

  renderChatTabs();
  renderChatDropdown();

  // Startup: if git has an in-progress operation (e.g. cherry-pick conflicts), surface recovery UI.
  let gitBlocked = false;
  try {
    const g = await getGitInProgressState();
    if (g && g.inProgress === true) {
      gitBlocked = true;
      addSystemMessage(`⚠️ Git ${g.op} is in progress. Resolve/abort it before continuing.`);
      addGitOpRecoveryMessage(currentSessionId, { op: g.op, conflictFiles: g.conflictFiles || [], note: 'Startup recovery detected an interrupted git operation.' });
    }
  } catch { /* ignore */ }

  void gitBlocked;

  // If we loaded from legacy format, immediately migrate to Codeon storage (best-effort)
  if (window.electronAPI && currentFolder) {
    try {
      const stored = await window.electronAPI.storageGetObject(currentFolder, CODEON_CHAT_STATE_KEY);
      const hasCodeon = stored && stored.success && stored.value && stored.value.v === CODEON_CHAT_STATE_VERSION;
      if (!hasCodeon) {
        await saveChatHistory(true);
      }
    } catch (e) {
      console.warn('[Chat History] Migration to Codeon storage failed (non-fatal):', e);
    }
  }
}


// Create a new chat session
async function createNewChatSession(name = null) {
  const sessionId = 'session_' + Date.now();

  let sessionName = name;
  if (!sessionName) {
    sessionName = makeUniqueSessionName('New chat');
  }

  chatSessions[sessionId] = {
    name: sessionName,
    // Cursor-like behavior: allow the app to auto-derive titles until the user renames explicitly.
    autoName: true,
    // Canonical timeline
    messages: [],
    // Back-compat: older persisted formats used `history`
    history: [],
    timestamp: Date.now(),
    createdAt: Date.now(),
    summary: undefined,
    summaryUpTo: 0,
    // Claude Code session isolation: each chat tab should start as a fresh Claude session.
    claudeSessionId: null,
    claudeMeta: {
      lastAssistantUuid: null,
      pendingResumeAt: null,
      forkOnNext: false
    }
  };

  // Initialize monotonic ordering for this session.
  messageSeqBySession[sessionId] = 0;

  currentSessionId = sessionId;
  window.currentSessionId = currentSessionId;
  chatHistory = ensureSessionMessages(currentSessionId);
  hydratedChatSessionId = currentSessionId;

  // Persist immediately so brand-new sessions (even with no messages yet) survive app restart.
  await saveChatHistory(true);
  renderChatTabs();
  scrollChatTabIntoView(sessionId, { behavior: 'smooth' });
  renderChatDropdown();
  restoreTodosForSession(currentSessionId);
  restoreConsoleForSession(currentSessionId);
  restoreAgentForSession(currentSessionId);
  renderAgentPillForSession(currentSessionId);
  clearPendingSkillForSession(currentSessionId);
  renderSkillSelectForSession(currentSessionId);
  renderSkillPillForSession(currentSessionId);
  try { renderMessageQueueUI(currentSessionId); } catch { /* ignore */ }
  renderConsoleForSession(currentSessionId);
  try { renderReceiptsForSession(currentSessionId); } catch { /* ignore */ }
  try { refreshSkillScriptsForSession(currentSessionId); } catch { /* ignore */ }
  updateImportExportButtonsForSession(currentSessionId);
  renderAttachmentPreview();
  updateSendButtonForCurrentSession();

  // Best-effort load of read_file cache for new session (will just be empty)
  if (window.readFileCacheService && window.currentFolder) {
    window.readFileCacheService.loadSession(window.currentFolder, currentSessionId).catch(() => {});
  }

  // Clear UI
  const messagesContainer = document.getElementById('chatMessages');
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
}


function scrollChatTabIntoView(sessionId = currentSessionId, { behavior = 'smooth' } = {}) {
  const tabsContainer = document.getElementById('chatTabs');
  if (!tabsContainer) return;
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const esc = (window.CSS && typeof window.CSS.escape === 'function')
    ? window.CSS.escape(sid)
    : sid.replace(/"/g, '\\"');
  const tabEl =
    tabsContainer.querySelector(`.chat-tab[data-session-id="${esc}"]`) ||
    tabsContainer.querySelector('.chat-tab.active');
  if (!tabEl) return;

  // Defer to ensure layout is up-to-date after DOM updates.
  requestAnimationFrame(() => {
    try {
      tabEl.scrollIntoView({ behavior, block: 'nearest', inline: 'end' });
    } catch {
      // Fallback: approximate scroll to end
      try { tabsContainer.scrollLeft = tabsContainer.scrollWidth; } catch { /* ignore */ }
    }
  });
}
