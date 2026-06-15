// ---- GENERATED: hoisted declarations extracted from git/git-operations.js ----


function withGitOperationLock(fn) {
  const run = typeof fn === 'function' ? fn : async () => {};
  const next = gitOperationChain.then(run, run);
  // Never let the chain break permanently.
  gitOperationChain = next.catch(() => {});
  return next;
}


function getRunningSessionIds({ exceptSessionId = null } = {}) {
  const except = String(exceptSessionId || '').trim();
  const ids = [];
  try {
    for (const [sid, st] of Object.entries(runStateBySession || {})) {
      if (!sid) continue;
      if (except && sid === except) continue;
      if (st && st.isProcessing === true) ids.push(sid);
    }
  } catch {
    // ignore
  }
  return ids;
}


async function abortSessionRunNoRestore(sessionId, reason = '') {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const st = getRunState(sid);
  if (!st) return;
  // Clear any partial snapshot state.
  try { clearAssistantPartialSnapshot(sid); } catch { /* ignore */ }
  // Abort local controller
  if (st.abortController) {
    try { st.abortController.abort(); } catch { /* ignore */ }
    st.abortController = null;
  }
  // Cancel Claude SDK query if active
  if (st.requestId && window.electronAPI && typeof window.electronAPI.claudeSdkCancel === 'function') {
    try { await window.electronAPI.claudeSdkCancel(st.requestId); } catch { /* ignore */ }
    st.requestId = null;
  }
  // Do NOT restore. Another operation is about to mutate git globally.
  st.processCommitHash = null;
  setProcessingState(false, sid);
  window.addConsoleMessage?.(`Run stopped${reason ? `: ${reason}` : ''}`, 'error', sid);
  try { window._cancelLearningGeneration?.({ sessionId: sid, reason: reason || 'Stopped' }); } catch { /* ignore */ }
  try { window._cancelDocsGeneration?.({ sessionId: sid, reason: reason || 'Stopped' }); } catch { /* ignore */ }
}


function getRunState(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  if (!runStateBySession[sid] || typeof runStateBySession[sid] !== 'object') {
    runStateBySession[sid] = {
      isProcessing: false,
      abortController: null,
      requestId: null,
      processCommitHash: null,
      permissionPromptChain: Promise.resolve(),
      // Stream buffers (in-memory only). Lets inactive tabs accumulate deltas without DOM writes.
      stream: {
        text: '',
        thinking: '',
        plannedToolNames: [],
        toolsCompleted: 0,
        diffBlocks: [], // [{ atTextLen, filePath, diffContent, toolName, timestamp }]
        toolBlocks: [], // [{ atTextLen, toolName, preview, receipt, toolUseId, timestamp }]
        lastUpdatedAt: 0
      }
    };
  }
  if (!runStateBySession[sid].permissionPromptChain) {
    runStateBySession[sid].permissionPromptChain = Promise.resolve();
  }
  if (!runStateBySession[sid].stream || typeof runStateBySession[sid].stream !== 'object') {
    runStateBySession[sid].stream = {
      text: '',
      thinking: '',
      plannedToolNames: [],
      toolsCompleted: 0,
      diffBlocks: [],
      toolBlocks: [],
      lastUpdatedAt: 0
    };
  }
  return runStateBySession[sid];
}


function isSessionProcessing(sessionId) {
  const st = getRunState(sessionId);
  return !!(st && st.isProcessing === true);
}


function resetStreamBuffer(sessionId) {
  const st = getRunState(sessionId);
  if (!st) return;
  st.stream = {
    text: '',
    thinking: '',
    plannedToolNames: [],
    toolsCompleted: 0,
    diffBlocks: [],
    toolBlocks: [],
    lastUpdatedAt: Date.now()
  };
}


function maybeForcePersistNow(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const now = Date.now();
  const last = Number(streamSnapshotLastForcedSaveAtBySession[sid] || 0);
  if (now - last < STREAM_SNAPSHOT_FORCE_SAVE_MIN_INTERVAL_MS) return;
  streamSnapshotLastForcedSaveAtBySession[sid] = now;
  // PERF: avoid forced full-history saves during runs (expensive). Rely on stream journal + debounced chat state.
  saveChatHistory().catch(() => {});
}


function truncateForSnapshot(text, maxChars) {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  const over = s.length - maxChars;
  return s.slice(0, maxChars) + `…(truncated ${over} chars)…`;
}


// (Legacy) Previously persisted a separate `assistant_partial` snapshot.
// Kept only to avoid breaking older runs; new streaming persistence updates the run's assistant message in-place.
function _upsertAssistantPartialSnapshot(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  ensureMessageSeqInitialized(sid);
  const st = getRunState(sid);
  if (!st || st.isProcessing !== true || !st.stream) return;

  const stream = st.stream;
  const text = truncateForSnapshot(stream.text || '', MAX_STREAM_SNAPSHOT_TEXT_CHARS);
  const thinking = truncateForSnapshot(stream.thinking || '', MAX_STREAM_SNAPSHOT_THINKING_CHARS);
  const plannedToolNames = Array.isArray(stream.plannedToolNames) ? stream.plannedToolNames.slice(0, 60) : [];
  const toolsCompleted = Number(stream.toolsCompleted || 0);
  const rawBlocks = Array.isArray(stream.diffBlocks) ? stream.diffBlocks.slice(-MAX_STREAM_SNAPSHOT_DIFF_BLOCKS) : [];
  const diffBlocks = rawBlocks.map(b => ({
    atTextLen: Number(b?.atTextLen || 0),
    filePath: String(b?.filePath || ''),
    toolName: b?.toolName || null,
    timestamp: Number(b?.timestamp || Date.now()),
    diffContent: truncateForSnapshot(typeof b?.diffContent === 'string' ? b.diffContent : '', MAX_STREAM_SNAPSHOT_DIFF_CHARS)
  }));

  // If there's nothing meaningful, don't persist noise.
  if (!text.trim() && !thinking.trim() && plannedToolNames.length === 0 && diffBlocks.length === 0) return;

  const sig = [
    String(st.requestId || ''),
    String(text.length),
    String(thinking.length),
    String(plannedToolNames.length),
    String(toolsCompleted),
    String(diffBlocks.length)
  ].join('|');
  if (streamSnapshotLastSigBySession[sid] === sig) return;
  streamSnapshotLastSigBySession[sid] = sig;

  const timeline = ensureSessionMessages(sid);
  const existing = timeline.find(m => m && m.role === 'assistant_partial');
  if (existing && typeof existing === 'object') {
    // Keep original timestamp/seq so it doesn't "jump" in the timeline; just update payload.
    existing.updatedAt = Date.now();
    existing.requestId = st.requestId || existing.requestId || null;
    existing.content = text;
    existing.stream = { text, thinking, plannedToolNames, toolsCompleted, diffBlocks };
  } else {
    timeline.push({
      role: 'assistant_partial',
      timestamp: Date.now(),
      seq: nextMessageSeq(sid),
      requestId: st.requestId || null,
      content: text,
      stream: {
        text,
        thinking,
        plannedToolNames,
        toolsCompleted,
        diffBlocks
      }
    });
  }
  saveChatHistory(); // debounced
  maybeForcePersistNow(sid);
}


function scheduleAssistantPartialSnapshot(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const st = getRunState(sid);
  if (!st || st.isProcessing !== true) return;
  // Best-effort immediate persist of the streaming assistant message so very fast quits still have something.
  try {
    const rid = String(st.requestId || '').trim();
    if (rid) {
      updateRunAssistantMessage(sid, rid, {
        content: String(st.stream?.text || ''),
        streaming: true,
        interrupted: false,
        updatedAt: Date.now()
      });
    }
  } catch { /* ignore */ }
  if (streamSnapshotTimerBySession[sid]) return;
  streamSnapshotTimerBySession[sid] = setTimeout(() => {
    try {
      const st2 = getRunState(sid);
      const rid2 = st2 ? String(st2.requestId || '').trim() : '';
      if (rid2) {
        updateRunAssistantMessage(sid, rid2, {
          content: String(st2.stream?.text || ''),
          streaming: true,
          interrupted: false,
          updatedAt: Date.now()
        });
      }
    } catch { /* ignore */ }
    try { clearTimeout(streamSnapshotTimerBySession[sid]); } catch { /* ignore */ }
    delete streamSnapshotTimerBySession[sid];
  }, STREAM_SNAPSHOT_DEBOUNCE_MS);
}


function clearAssistantPartialSnapshot(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (streamSnapshotTimerBySession[sid]) {
    try { clearTimeout(streamSnapshotTimerBySession[sid]); } catch { /* ignore */ }
    delete streamSnapshotTimerBySession[sid];
  }
  delete streamSnapshotLastSigBySession[sid];
  delete streamSnapshotLastForcedSaveAtBySession[sid];
  try {
    const msgs = ensureSessionMessages(sid);
    const before = msgs.length;
    const next = msgs.filter(m => !(m && m.role === 'assistant_partial'));
    replaceSessionMessages(sid, next);
    if (next.length !== before) {
      saveChatHistory(); // debounced
    }
  } catch {
    // ignore
  }

  // If a persisted partial snapshot was rendered into the DOM (e.g. tab switch mid-run),
  // remove it immediately to avoid duplicates alongside the live streaming bubble.
  if (sid === currentSessionId) {
    try {
      const container = document.getElementById('chatMessages');
      if (container) {
        container.querySelectorAll('.assistant-partial-snapshot').forEach(el => {
          try { el.remove(); } catch { /* ignore */ }
        });
      }
    } catch {
      // ignore
    }
  }
}


async function flushStreamDiffBlocksToHistory(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const st = getRunState(sid);
  if (!st || !st.stream) return;
  const blocks = Array.isArray(st.stream.diffBlocks) ? st.stream.diffBlocks.slice() : [];
  if (blocks.length === 0) return;

  // Persist in chronological order (best effort).
  blocks.sort((a, b) => (Number(a?.timestamp || 0) - Number(b?.timestamp || 0)));
  for (const b of blocks) {
    if (b && b.persisted === true) continue; // already persisted on receipt
    const fp = String(b?.filePath || '').trim();
    const diff = typeof b?.diffContent === 'string' ? b.diffContent : '';
    if (!fp || !diff.trim()) continue;
    // Persist only; do not render now (streaming bubble already contains inline diffs).
    await addFilePreviewMessageFromDiff(sid, fp, diff, b?.toolName || '', { renderNow: false, timestamp: Number(b?.timestamp || Date.now()) });
  }

  // Clear to avoid double-persist.
  st.stream.diffBlocks = [];
}


function ensureStreamingBubbleForActiveSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid !== currentSessionId) return null;
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return null;
  const st = getRunState(sid);
  
  // SKIP for learning runs - learning content should only appear in the Learning panel, not chat
  if (st && st.isLearningRun === true) return null;
  
  const placement = st && typeof st.streamingPlacement === 'string' ? st.streamingPlacement : 'after_user';

  let div = messagesContainer.querySelector(`.message.assistant[data-streaming-session="${CSS.escape(sid)}"]`);
  if (div && div.isConnected) {
    // Important: if a stale streaming bubble exists (e.g. prior run finalized off-tab),
    // ensure it is positioned where the user expects streaming to appear.
    try {
      if (placement === 'after_latest') {
        if (messagesContainer.lastElementChild !== div) {
          messagesContainer.appendChild(div);
        }
      } else {
      const users = messagesContainer.querySelectorAll('.message.user');
      const lastUser = users && users.length ? users[users.length - 1] : null;
      if (lastUser && lastUser.nextElementSibling !== div) {
        lastUser.insertAdjacentElement('afterend', div);
      } else if (!lastUser && div.parentElement !== messagesContainer) {
        // Prefer placing streaming output inside the latest turn if present.
        try {
          const turn = (typeof getLastChatTurn === 'function') ? getLastChatTurn(messagesContainer) : null;
          if (turn) turn.appendChild(div);
          else messagesContainer.appendChild(div);
        } catch {
          messagesContainer.appendChild(div);
          }
        }
      }
    } catch { /* ignore */ }
    return div;
  }

  div = document.createElement('div');
  div.className = 'message assistant';
  div.dataset.streamingSession = sid;
  div.innerHTML = `
    <div class="message-content">
      <div class="stream-placeholder" data-stream-placeholder="1" style="opacity:0.8; font-style:italic;">
        Working…
      </div>
    </div>
  `;
  // Place the streaming bubble where the user expects:
  // - normal sends: right after the latest user message
  // - retries: after the latest message (so it doesn't appear "above" the error/retry UI)
  try {
    if (placement === 'after_latest') {
      messagesContainer.appendChild(div);
    } else {
    const users = messagesContainer.querySelectorAll('.message.user');
    const lastUser = users && users.length ? users[users.length - 1] : null;
    if (lastUser) lastUser.insertAdjacentElement('afterend', div);
    else {
      try {
        const turn = (typeof getLastChatTurn === 'function') ? getLastChatTurn(messagesContainer) : null;
        if (turn) turn.appendChild(div);
        else messagesContainer.appendChild(div);
      } catch {
        messagesContainer.appendChild(div);
        }
      }
    }
  } catch {
    try {
      const turn = (typeof getLastChatTurn === 'function') ? getLastChatTurn(messagesContainer) : null;
      if (turn) turn.appendChild(div);
      else messagesContainer.appendChild(div);
    } catch {
      messagesContainer.appendChild(div);
    }
  }
  smartScrollToBottom(messagesContainer);
  return div;
}


/**
 * Get or create the current (latest) thinking block for streaming updates.
 * This function ensures there's always a thinking block ready to receive new content.
 * 
 * For incremental timeline behavior:
 * - If no thinking blocks exist, create one
 * - If the latest thinking block is "full" (has significant content), allow creating new ones
 * - Returns the block's details element for compatibility
 * 
 * @param {HTMLElement} streamingDiv - The streaming message container
 * @param {Object} options - Options for block creation
 * @param {boolean} options.forceNew - If true, always create a new block
 * @param {string} options.title - Optional title for new segment
 */
function ensureStreamingThinkingSection(streamingDiv, options = {}) {
  if (!streamingDiv) return null;
  const contentEl = streamingDiv.querySelector('.message-content');
  if (!contentEl) return null;
  
  const { forceNew = false, title = null } = options;
  
  // Get all existing thinking blocks
  const existingBlocks = contentEl.querySelectorAll('.cc-content-block[data-block-type="thinking"]');
  const lastBlock = existingBlocks.length > 0 ? existingBlocks[existingBlocks.length - 1] : null;
  
  // Return existing block if present and not forcing new
  if (lastBlock && lastBlock.isConnected && !forceNew) {
    return lastBlock.querySelector('.cc-thinking-inline') || lastBlock;
  }
  
  // Create new thinking block
  const segmentIndex = existingBlocks.length;
  const thinkingBlock = createThinkingTimelineBlock('', false, { title, segmentIndex });
  
  // Insert at the end so thinking stays as the latest timeline block
  if (lastBlock && lastBlock.isConnected) {
    lastBlock.insertAdjacentElement('afterend', thinkingBlock);
    } else {
      contentEl.appendChild(thinkingBlock);
  }
  
  return thinkingBlock.querySelector('.cc-thinking-inline') || thinkingBlock;
}

/**
 * Strip JP lines from text (renderer-side safety filter)
 * JP format: JP: <node_type> | <target> | <why> [| outcome: ... | risk: ...]
 */
function stripJpLinesFromTextLocal(text) {
  if (typeof text !== 'string' || !text) return text;
  if (!text.toLowerCase().includes('jp:')) return text;
  const lines = text.split('\n');
  const kept = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const idx = lower.indexOf('jp:');
    if (idx >= 0) {
      const candidate = line.slice(idx);
      const parts = candidate.split('|');
      if (parts.length >= 3) {
        const prefix = line.slice(0, idx).trimEnd();
        if (prefix) kept.push(prefix);
        continue;
      }
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Create a thinking block as a timeline item INSIDE message-content
 * This is rendered as a cc-content-block so it's part of the timeline
 * 
 * @param {string} thinkingText - The thinking text to display
 * @param {boolean} isFinalized - Whether the thinking is complete
 * @param {Object} options - Additional options
 * @param {string} options.title - Optional title for the segment
 * @param {number} options.segmentIndex - Optional index for multiple segments
 */
function createThinkingTimelineBlock(thinkingText, isFinalized = false, options = {}) {
  const { title = null, segmentIndex = 0 } = options;
  
  const block = document.createElement('div');
  block.className = 'cc-content-block cc-success';
  block.dataset.blockType = 'thinking';
  block.dataset.streamBlockKind = 'thinking';
  block.dataset.segmentIndex = String(segmentIndex);
  
  const details = document.createElement('details');
  details.className = 'cc-thinking-inline';
  details.open = !isFinalized; // Open during streaming, closed when done
  
  // Determine label
  let labelText = isFinalized ? 'Thought' : 'Thinking...';
  if (title) {
    labelText = title;
  }
  
  details.innerHTML = `
    <summary class="cc-thinking-summary-inline">
      <span class="cc-thinking-label">${escapeHtml(labelText)}</span>
      <svg class="cc-thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </summary>
    <div class="cc-thinking-content-inline"></div>
  `;
  
  const contentDiv = details.querySelector('.cc-thinking-content-inline');
  if (contentDiv && thinkingText) {
    // Use formatThinkingText if available, otherwise fallback
    if (typeof window.formatThinkingText === 'function') {
      contentDiv.innerHTML = window.formatThinkingText(thinkingText, { streaming: !isFinalized });
    } else if (isFinalized && typeof formatMessage === 'function') {
      contentDiv.innerHTML = formatMessage(thinkingText);
    } else {
      // Fallback: escape and preserve newlines
      contentDiv.innerHTML = escapeHtml(thinkingText).replace(/\n/g, '<br>');
    }
  }
  
  block.appendChild(details);
  return block;
}

/**
 * Update the thinking section label based on state (Claude Code style)
 * - "Thinking..." when isCurrentlyThinking
 * - "Thought for Xs" when complete with duration
 */
function updateThinkingLabel(thinkingDiv, { isCurrentlyThinking = false, durationMs = null } = {}) {
  if (!thinkingDiv) return;
  const label = thinkingDiv.querySelector('.cc-thinking-label');
  if (!label) return;
  
  if (isCurrentlyThinking) {
    label.textContent = 'Thinking...';
  } else if (durationMs !== null && durationMs > 0) {
    const secs = Math.round(durationMs / 1000);
    label.textContent = secs > 0 ? `Thought for ${secs}s` : 'Thinking';
  } else {
    label.textContent = 'Thinking';
  }
}


// Legacy function - kept for backward compatibility but no longer used
function ensureStreamingToolsSection(streamingDiv) {
  if (!streamingDiv) return null;
  let planDiv = streamingDiv.querySelector(`.cc-thinking[data-streaming-kind="tools"]`);
  if (planDiv && planDiv.isConnected) return planDiv;
  planDiv = document.createElement('details');
  planDiv.className = 'cc-thinking';
  planDiv.dataset.streamingKind = 'tools';
  planDiv.open = true;
  planDiv.innerHTML = `
    <summary class="cc-thinking-summary">
      <span class="cc-thinking-label">Running tools...</span>
      <svg class="cc-thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </summary>
    <div class="cc-thinking-content"></div>
  `;
  // Now insert inside message-content at the end, not before it
  const contentEl = streamingDiv.querySelector('.message-content');
  if (contentEl) {
    contentEl.appendChild(planDiv);
  } else {
    streamingDiv.appendChild(planDiv);
  }
  return planDiv;
}


function renderBufferedStreamingForSession(sessionId, { finalize = false, allowWhenNotProcessing = false } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid !== currentSessionId) return;
  const st = getRunState(sid);
  if (!st || (st.isProcessing !== true && !allowWhenNotProcessing)) return;

  // SKIP for learning runs - learning content should only appear in the Learning panel, not chat
  if (st.isLearningRun === true) return;

  // SKIP if using the new ContentBlockTimeline system
  // The new system has its own incremental renderer that prevents flickering
  try {
    const reqId = st && st.requestId;
    if (reqId && window._usingNewTimeline && window._usingNewTimeline.has(reqId)) {
      // Delegate to new timeline renderer
      if (window.TimelineIntegration) {
        if (finalize) {
          window.TimelineIntegration.finalizeTimeline(reqId, sid);
        } else {
          window.TimelineIntegration.scheduleTimelineRender(reqId, sid);
        }
      }
      return;
    }
  } catch { /* ignore and fall through to legacy */ }

  const stream = st.stream && typeof st.stream === 'object' ? st.stream : null;
  if (!stream) return;

  const streamingDiv = ensureStreamingBubbleForActiveSession(sid);
  if (!streamingDiv) return;

  // Render content as a timeline (text segments + diff previews + thinking).
  // IMPORTANT: during streaming, do incremental/append-only updates to avoid flicker.
  // We only do a full rebuild on finalize.
  // CRITICAL: Strip JP lines from streaming text to hide internal planning lines
  const contentEl = streamingDiv.querySelector('.message-content');
  if (contentEl) {
    const rawText = String(stream.text || '');
    const fullText = stripJpLinesFromTextLocal(rawText);
    const diffBlocksRaw = Array.isArray(stream.diffBlocks) ? stream.diffBlocks.slice() : [];
    const toolBlocksRaw = Array.isArray(stream.toolBlocks) ? stream.toolBlocks.slice() : [];
    const thinkingBlocksRaw = Array.isArray(stream.thinkingBlocks) ? stream.thinkingBlocks.slice() : [];
    const blocks = [
      ...diffBlocksRaw.map(b => ({ kind: 'diff', ...b })),
      ...toolBlocksRaw.map(b => ({ kind: 'tool', ...b })),
      ...thinkingBlocksRaw.map(b => ({ kind: 'thinking', ...b }))
    ];
    // Hide placeholder as soon as we have anything meaningful to show.
    try {
      const ph = contentEl.querySelector('[data-stream-placeholder="1"]');
      if (ph && (finalize || (fullText && fullText.trim()) || (blocks && blocks.length > 0))) {
        ph.remove();
      }
    } catch { /* ignore */ }
    blocks.sort((a, b) => {
      const da = Number(a?.atTextLen || 0);
      const db = Number(b?.atTextLen || 0);
      if (da !== db) return da - db;
      // Stable-ish order for same insertion point: timestamp, then toolUseId/name.
      const ta = Number(a?.timestamp || 0);
      const tb = Number(b?.timestamp || 0);
      if (ta !== tb) return ta - tb;
      const ua = String(a?.toolUseId || '');
      const ub = String(b?.toolUseId || '');
      if (ua !== ub) return ua.localeCompare(ub);
      return String(a?.toolName || '').localeCompare(String(b?.toolName || ''));
    });

    // Per-session incremental DOM state for streaming renders.
    if (!window.__streamDomStateBySession || typeof window.__streamDomStateBySession !== 'object') {
      window.__streamDomStateBySession = {}; // { [sid]: { renderedBlockCount, tailStart } }
    }
    const domState = window.__streamDomStateBySession[sid] && typeof window.__streamDomStateBySession[sid] === 'object'
      ? window.__streamDomStateBySession[sid]
      : { renderedBlockCount: 0, tailStart: 0 };
    // Back-compat: old state name
    if (typeof domState.renderedBlockCount !== 'number' && typeof domState.renderedDiffCount === 'number') {
      domState.renderedBlockCount = domState.renderedDiffCount;
    }
    window.__streamDomStateBySession[sid] = domState;

    const clampAt = (n) => {
      const v = Number(n || 0);
      if (!Number.isFinite(v)) return 0;
      return Math.max(0, Math.min(fullText.length, v));
    };

    const appendFilePreviewInline = (b) => {
      const fp = normalizeRelPathForDiffPreview(b?.filePath || '');
      const diff = typeof b?.diffContent === 'string' ? b.diffContent : '';
      if (!fp || !diff.trim()) return;
      if (isHiddenOrInternalPathForDiffPreview(fp)) return;

      const ext = getFileExtFromPath(fp);
      const badgeClass = getFilePreviewBadgeClass(ext);
      const { added, removed, isNewFile } = countDiffStats(diff);
      const diffStat = renderDiffStatHtml({ added, removed, isNewFile });
      const diffClass = (isNewFile || added > removed) ? 'stat-added' : 'stat-modified';

      // PERF: diff rendering is expensive; only render when user expands.
      const isCollapsed = true;
      let didRenderDiff = false;

      const messageDiv = document.createElement('div');
      messageDiv.className = 'message file-preview compact-cursor-style';
      messageDiv.innerHTML = `
        <div class="file-preview-header" data-file-path="${escapeHtml(fp)}">
          <button class="file-collapse-toggle" title="Toggle diff">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="file-badge badge-${badgeClass}">${ext.toUpperCase()}</div>
          <span class="file-preview-path">${escapeHtml(fp)}</span>
          <span class="file-diff-stat ${diffClass}" title="Open full diff">${diffStat}</span>
          <div class="file-header-spacer"></div>
          <button class="file-preview-open-btn-icon" data-path="${escapeHtml(fp)}" title="Open File">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </button>
        </div>
        <div class="file-preview-content" style="display: ${isCollapsed ? 'none' : 'block'}"></div>
      `;

      // Wire handlers (same behavior as history file_preview messages)
      const collapseToggle = messageDiv.querySelector('.file-collapse-toggle');
      const contentDiv = messageDiv.querySelector('.file-preview-content');
      if (collapseToggle && contentDiv) {
        const ensureDiffRendered = () => {
          if (didRenderDiff) return;
          didRenderDiff = true;
          contentDiv.innerHTML = formatGitDiff(diff);
        };
        collapseToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const isCurrentlyCollapsed = contentDiv.style.display === 'none';
          if (isCurrentlyCollapsed) {
            ensureDiffRendered();
            contentDiv.style.display = 'block';
            collapseToggle.classList.add('expanded');
          } else {
            contentDiv.style.display = 'none';
            collapseToggle.classList.remove('expanded');
          }
        });
      }

      const openBtn = messageDiv.querySelector('.file-preview-open-btn-icon');
      if (openBtn) {
        openBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const rel = String(openBtn.dataset.path || '').trim();
          if (!rel || !window.currentFolder) return;
          const relNorm = normalizeRelPathForDiffPreview(rel);
          await openRelPathFromChat(relNorm, { jumpToDiff: true, diffContent: diff });
        });
      }

      const statEl = messageDiv.querySelector('.file-diff-stat');
      if (statEl) {
        statEl.addEventListener('click', async (e) => {
          e.stopPropagation();
          await openFullDiffForRelPath(fp);
        });
      }

      contentEl.appendChild(messageDiv);
      return messageDiv;
    };

    const formatToolForCard = (b) => {
      const toolNameRaw = String(b?.toolName || 'Tool').trim() || 'Tool';
      const inputSummary = (typeof b?.toolInputSummary === 'string') ? b.toolInputSummary : '';
      let rawPreview = inputSummary || (typeof b?.preview === 'string' ? b.preview : '');
      if (rawPreview.startsWith(': ')) rawPreview = rawPreview.slice(2);
      const preview = String(rawPreview || '');
      const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const clamp = (s, n = 220) => (s.length > n ? (s.slice(0, n - 1) + '…') : s);

      let displayName = toolNameRaw;
      let detail = '';
      let filePath = '';
      const toolOutput = (typeof b?.toolOutput === 'string') ? b.toolOutput : '';
      const taskId = (typeof b?.taskId === 'string') ? b.taskId.trim() : '';

      // File ops: show file path if possible
      if (toolNameRaw === 'Write' || toolNameRaw === 'Edit' || toolNameRaw === 'MultiEdit' || toolNameRaw === 'NotebookEdit') {
        displayName = toolNameRaw;
        // Usually preview is already `: <relpath>` from service; keep it if not JSON.
        try {
          const parsed = JSON.parse(preview);
          filePath = String(parsed?.file_path || parsed?.filePath || parsed?.path || '').trim();
        } catch {
          filePath = preview.includes('/') ? preview.trim() : '';
          if (!filePath) {
            const m = preview.match(/["']?(?:file_?path|path)["']?\s*[:=]\s*["']?([^"'\s,}]+)/i);
            if (m) filePath = String(m[1] || '').trim();
          }
        }
        if (!filePath) detail = clamp(oneLine(preview), 220);
      } else if (toolNameRaw === 'Read' || toolNameRaw.toLowerCase() === 'read') {
        displayName = 'Read';
        try {
          const parsed = JSON.parse(preview);
          filePath = String(parsed?.file_path || parsed?.filePath || parsed?.path || '').trim();
        } catch {
          filePath = preview.trim();
        }
      } else if (toolNameRaw === 'Bash' || toolNameRaw.toLowerCase() === 'bash') {
        displayName = 'Bash';
        try {
          const parsed = JSON.parse(preview);
          detail = String(parsed?.command || parsed?.cmd || '').trim();
        } catch {
          detail = preview;
        }
        detail = clamp(oneLine(detail), 220);
        try {
          const exitCode = b?.receipt && typeof b.receipt.exitCode === 'number' ? b.receipt.exitCode : null;
          if (typeof exitCode === 'number') detail = clamp(`${detail} (exit=${exitCode})`, 220);
        } catch { /* ignore */ }
        if (taskId) {
          detail = clamp(`${detail} (task=${taskId.slice(0, 10)})`, 220);
        } else {
          const out = String(toolOutput || '').trim();
          if (out) {
            const first = out.split('\n')[0] || '';
            if (first) detail = clamp(`${detail} — ${oneLine(first)}`, 220);
          }
        }
      } else if (toolNameRaw === 'WebFetch' || toolNameRaw.toLowerCase() === 'webfetch') {
        displayName = 'WebFetch';
        detail = clamp(oneLine(preview), 220);
      } else if (toolNameRaw === 'TodoWrite' || toolNameRaw === 'todo_write') {
        displayName = 'TodoWrite';
        detail = clamp(oneLine(preview), 220);
      } else if (toolNameRaw === 'Grep' || toolNameRaw === 'Glob' || toolNameRaw.toLowerCase() === 'grep' || toolNameRaw.toLowerCase() === 'glob') {
        displayName = toolNameRaw.charAt(0).toUpperCase() + toolNameRaw.slice(1);
        detail = clamp(oneLine(preview), 220);
      } else {
        detail = clamp(oneLine(preview), 220);
      }

      if (!filePath && !detail) {
        const out = String(toolOutput || '').trim();
        if (out) detail = clamp(oneLine(out.split('\n')[0] || out), 220);
      }

      return { displayName, filePath, detail };
    };

    if (finalize) {
      // Finalize: Claude Code style - INTERLEAVE text with blocks based on atTextLen position
      // Timeline: [thinking] -> [text 0..pos1] -> [tool1] -> [thinking] -> [text pos1..pos2] -> [tool2] -> [remaining text]
      contentEl.innerHTML = '';
      
      // Collect and tag all blocks (filter out Write/Edit tools if we have diffs)
      const diffBlocks = blocks.filter(b => b && b.kind === 'diff');
      const thinkingBlocks = blocks.filter(b => b && b.kind === 'thinking');
      const toolBlocksFiltered = blocks.filter(b => {
        if (!b || b.kind !== 'tool') return false;
        const name = String(b?.toolName || '').toLowerCase();
        if ((name === 'write' || name === 'edit') && diffBlocks.length > 0) return false;
        return true;
      });
      
      // Combine all blocks to interleave (including thinking blocks)
      const allBlocks = [...diffBlocks, ...toolBlocksFiltered, ...thinkingBlocks].sort((a, b) => {
        const posA = Number(a?.atTextLen || 0);
        const posB = Number(b?.atTextLen || 0);
        if (posA !== posB) return posA - posB;
        // Thinking blocks should come before other blocks at the same position
        if (a.kind === 'thinking' && b.kind !== 'thinking') return -1;
        if (b.kind === 'thinking' && a.kind !== 'thinking') return 1;
        // Stable order: timestamp, then toolUseId
        const tA = Number(a?.timestamp || 0);
        const tB = Number(b?.timestamp || 0);
        return tA - tB;
      });
      
      // Helper to append a text segment
      const appendTextSegment = (text) => {
        if (!text || !text.trim()) return;
        const textBlock = document.createElement('div');
        textBlock.className = 'cc-content-block cc-success';
        textBlock.dataset.blockType = 'text';
        textBlock.innerHTML = `<div class="cc-text-block">${formatMessage(text)}</div>`;
        contentEl.appendChild(textBlock);
      };
      
      // Helper to append a thinking block
      const appendThinkingBlockFinalize = (b) => {
        const thinkingText = String(b?.text || '').trim();
        if (!thinkingText) return;
        
        const thinkingBlock = createThinkingTimelineBlock(thinkingText, true);
        contentEl.appendChild(thinkingBlock);
      };
      
      // Helper to append a tool block
      const appendToolBlockFinalize = (b) => {
        const toolBlock = document.createElement('div');
        toolBlock.className = 'cc-content-block cc-success';
        toolBlock.dataset.blockType = 'tool';

        const { displayName, filePath, detail } = formatToolForCard(b);
        let innerHtml = '<div class="cc-tool-block"><div class="cc-tool-header">';
        innerHtml += `<span class="cc-tool-name">${escapeHtml(displayName)}</span>`;
        if (filePath) innerHtml += `<span class="cc-tool-detail">${escapeHtml(filePath)}</span>`;
        else if (detail) innerHtml += `<span class="cc-tool-detail">${escapeHtml(detail)}</span>`;
        innerHtml += '</div></div>';
        toolBlock.innerHTML = innerHtml;
        
        contentEl.appendChild(toolBlock);
      };
      
      // INTERLEAVE: Render text segments between blocks at their atTextLen positions
      let textCursor = 0;
      
      for (const b of allBlocks) {
        const pos = Math.max(0, Math.min(fullText.length, Number(b?.atTextLen || 0)));
        
        // Render any text BEFORE this block's insertion point
        if (pos > textCursor) {
          appendTextSegment(fullText.slice(textCursor, pos));
          textCursor = pos;
        }
        
        // Render the block (diff, tool, or thinking)
        if (b.kind === 'diff') {
          appendFilePreviewInline(b);
        } else if (b.kind === 'tool') {
          appendToolBlockFinalize(b);
        } else if (b.kind === 'thinking') {
          appendThinkingBlockFinalize(b);
        }
      }
      
      // Render any remaining text after the last block
      if (textCursor < fullText.length) {
        appendTextSegment(fullText.slice(textCursor));
      }
      
      // If no blocks at all AND we didn't render any text above, render the full text
      // (This handles edge case where text exists but textCursor didn't advance)
      if (allBlocks.length === 0 && textCursor === 0 && fullText.trim()) {
        appendTextSegment(fullText);
      }
      
      // Reset incremental state for next run
      domState.renderedBlockCount = blocks.length;
      domState.tailStart = fullText.length;
      domState.textLen = fullText.length;
    } else {
      // Streaming: interleave text segments with tool/diff blocks as they appear.
      // This matches Claude Code's timeline behavior and prevents "completion text" from
      // being appended into the first text block after tool execution.

      // Streaming DOM markers:
      // - `data-stream-text="1"`: a text segment created during streaming
      // - `data-stream-tail="1"`: the active text segment receiving deltas
      const clampAt = (n) => {
        const v = Number(n || 0);
        if (!Number.isFinite(v)) return 0;
        return Math.max(0, Math.min(fullText.length, v));
      };
      const ensureTailTextSegment = (startIdx) => {
        let tail = contentEl.querySelector('.cc-content-block[data-stream-text="1"][data-stream-tail="1"]');
        if (tail && tail.isConnected) return tail;

        const tb = document.createElement('div');
        tb.className = 'cc-content-block cc-success';
        tb.dataset.blockType = 'text';
        tb.dataset.streamText = '1';
        tb.dataset.streamTail = '1';
        const start = clampAt(startIdx);
        tb.dataset.tailStart = String(start);
        tb.dataset.tailEnd = String(start);
        tb.innerHTML = '<div class="cc-text-block" style="white-space: pre-wrap"></div>';

        // Insert near the top (after placeholder if present), but do not wipe existing blocks.
        const ph = contentEl.querySelector('[data-stream-placeholder="1"]');
        if (ph && ph.isConnected && ph.nextSibling) contentEl.insertBefore(tb, ph.nextSibling);
        else contentEl.appendChild(tb);
        return tb;
      };
      const updateTailEnd = (tailEl, endIdx) => {
        if (!tailEl) return false;
        const start = clampAt(Number(tailEl.dataset.tailStart || 0));
        const end = clampAt(endIdx);
        let prevEnd = Number(tailEl.dataset.tailEnd || start);
        if (!Number.isFinite(prevEnd) || prevEnd < start) prevEnd = start;
        if (end < prevEnd) return false; // would require splitting already-rendered text
        const textNode = tailEl.querySelector('.cc-text-block');
        if (!textNode) return false;
        if (end > prevEnd) {
          // Use formatCompletionTextStreaming for proper human-readable styling
          // This converts **bold** and *italic* while avoiding full markdown parsing flicker
          const segmentText = fullText.slice(start, end);
          if (typeof window.formatCompletionTextStreaming === 'function') {
            textNode.innerHTML = window.formatCompletionTextStreaming(segmentText);
          } else {
            // Fallback: escape and preserve newlines
            textNode.innerHTML = escapeHtml(segmentText).replace(/\n/g, '<br>');
          }
          tailEl.dataset.tailEnd = String(end);
        }
        return true;
      };
      const endTailAndStartNew = (tailEl, newStart) => {
        if (tailEl) {
          try { delete tailEl.dataset.streamTail; } catch { /* ignore */ }
        }
        const tb = document.createElement('div');
        tb.className = 'cc-content-block cc-success';
        tb.dataset.blockType = 'text';
        tb.dataset.streamText = '1';
        tb.dataset.streamTail = '1';
        const start = clampAt(newStart);
        tb.dataset.tailStart = String(start);
        tb.dataset.tailEnd = String(start);
        tb.innerHTML = '<div class="cc-text-block" style="white-space: pre-wrap"></div>';
        return tb;
      };
      const insertToolBlockAfter = (afterEl, b) => {
        const toolBlock = document.createElement('div');
        toolBlock.className = 'cc-content-block cc-success';
        toolBlock.dataset.blockType = 'tool';
        toolBlock.dataset.toolId = String(b?.toolUseId || '');
        toolBlock.dataset.streamBlockKind = 'tool';
        const { displayName, filePath, detail } = formatToolForCard(b);
        let innerHtml = '<div class="cc-tool-block"><div class="cc-tool-header">';
        innerHtml += `<span class="cc-tool-name">${escapeHtml(displayName)}</span>`;
        if (filePath) innerHtml += `<span class="cc-tool-detail">${escapeHtml(filePath)}</span>`;
        else if (detail) innerHtml += `<span class="cc-tool-detail">${escapeHtml(detail)}</span>`;
        innerHtml += '</div></div>';
        toolBlock.innerHTML = innerHtml;
        if (afterEl && afterEl.parentElement === contentEl) afterEl.insertAdjacentElement('afterend', toolBlock);
        else contentEl.appendChild(toolBlock);
        return toolBlock;
      };
      const insertDiffBlockAfter = (afterEl, b) => {
        const el = appendFilePreviewInline(b);
        if (el && afterEl && afterEl.parentElement === contentEl) {
          try { afterEl.insertAdjacentElement('afterend', el); } catch { /* ignore */ }
        }
        return el;
      };
      const insertThinkingBlockAfter = (afterEl, b) => {
        const thinkingText = String(b?.text || '').trim();
        if (!thinkingText) return null;
        
        const thinkingBlock = createThinkingTimelineBlock(thinkingText, b.ended === true);
        thinkingBlock.dataset.streamBlockKind = 'thinking';
        thinkingBlock.dataset.thinkingIdx = String(b?.startIdx || 0);
        
        if (afterEl && afterEl.parentElement === contentEl) {
          afterEl.insertAdjacentElement('afterend', thinkingBlock);
        } else {
          contentEl.appendChild(thinkingBlock);
        }
        return thinkingBlock;
      };
      const rebuildStreamingTimeline = () => {
        // Safe rebuild (rare): ensures block insertion points are correct even if events arrived out-of-order.
        contentEl.innerHTML = '';
        let cursor = 0;
        const diffBlocks = blocks.filter(x => x && x.kind === 'diff');
        const thinkingBlksLocal = blocks.filter(x => x && x.kind === 'thinking');
        const toolBlocksFiltered = blocks.filter(x => {
          if (!x || x.kind !== 'tool') return false;
          const nm = String(x?.toolName || '').toLowerCase();
          if ((nm === 'write' || nm === 'edit') && diffBlocks.length > 0) return false;
          return true;
        });
        const allBlocks = [...diffBlocks, ...toolBlocksFiltered, ...thinkingBlksLocal].sort((a, b) => {
          const posA = Number(a?.atTextLen || 0);
          const posB = Number(b?.atTextLen || 0);
          if (posA !== posB) return posA - posB;
          // Thinking blocks should come before other blocks at the same position
          if (a.kind === 'thinking' && b.kind !== 'thinking') return -1;
          if (b.kind === 'thinking' && a.kind !== 'thinking') return 1;
          const tA = Number(a?.timestamp || 0);
          const tB = Number(b?.timestamp || 0);
          return tA - tB;
        });

        const appendTextSeg = (s, e) => {
          const raw = s < e ? fullText.slice(s, e) : '';
          if (!raw) return null;
          const tb = document.createElement('div');
          tb.className = 'cc-content-block cc-success';
          tb.dataset.blockType = 'text';
          tb.dataset.streamText = '1';
          // Use formatCompletionTextStreaming for proper human-readable styling
          const formatted = (typeof window.formatCompletionTextStreaming === 'function')
            ? window.formatCompletionTextStreaming(raw)
            : formatMessageStreamingSafe(raw);
          tb.innerHTML = `<div class="cc-text-block" style="white-space: pre-wrap">${formatted}</div>`;
          contentEl.appendChild(tb);
          return tb;
        };

        for (const blk of allBlocks) {
          const pos = clampAt(blk?.atTextLen || 0);
          if (pos > cursor) {
            appendTextSeg(cursor, pos);
            cursor = pos;
          }
          if (blk.kind === 'diff') {
            appendFilePreviewInline(blk);
          } else if (blk.kind === 'tool') {
            insertToolBlockAfter(contentEl.lastElementChild, blk);
          } else if (blk.kind === 'thinking') {
            insertThinkingBlockAfter(contentEl.lastElementChild, blk);
          }
        }
        if (cursor < fullText.length) appendTextSeg(cursor, fullText.length);

        // Ensure we always have an active tail for future deltas.
        const tail = endTailAndStartNew(null, fullText.length);
        contentEl.appendChild(tail);

        domState.renderedBlockCount = blocks.length;
      };

      // Ensure a tail exists (even if text is still empty).
      let tail = ensureTailTextSegment(Number(domState.tailStart || 0));
      const hasDiffBlocksForThisStream = blocks.some(x => x && x.kind === 'diff');

      // Append new blocks in order, splitting the tail when needed.
      for (let i = Number(domState.renderedBlockCount || 0); i < blocks.length; i++) {
        const b = blocks[i];
        // Match Claude Code UX: if we have diff previews, suppress redundant Write/Edit tool cards.
        if (hasDiffBlocksForThisStream && b && b.kind === 'tool') {
          const nm = String(b?.toolName || '').toLowerCase();
          if (nm === 'write' || nm === 'edit' || nm === 'multiedit' || nm === 'notebookedit') continue;
        }
        const pos = clampAt(b?.atTextLen || 0);

        // If we already rendered beyond this insertion point (rare out-of-order event), rebuild.
        const currentTailEnd = Number(tail?.dataset?.tailEnd || 0);
        if (Number.isFinite(currentTailEnd) && pos < currentTailEnd) {
          rebuildStreamingTimeline();
          tail = ensureTailTextSegment(fullText.length);
          break;
        }

        // Render text up to the insertion point into the current tail.
        if (!updateTailEnd(tail, pos)) {
          rebuildStreamingTimeline();
          tail = ensureTailTextSegment(fullText.length);
          break;
        }

        // Insert the new block after the tail, then start a new tail after it.
        let inserted = null;
        if (b.kind === 'tool') inserted = insertToolBlockAfter(tail, b);
        else if (b.kind === 'diff') inserted = insertDiffBlockAfter(tail, b);
        else if (b.kind === 'thinking') inserted = insertThinkingBlockAfter(tail, b);

        const newTail = endTailAndStartNew(tail, pos);
        if (inserted && inserted.parentElement === contentEl) inserted.insertAdjacentElement('afterend', newTail);
        else contentEl.appendChild(newTail);
        tail = newTail;
      }

      // Update counters and append any remaining text delta.
      domState.renderedBlockCount = blocks.length;
      try { domState.tailStart = Number(tail?.dataset?.tailStart || 0); } catch { /* ignore */ }
      if (tail) updateTailEnd(tail, fullText.length);
      
      // Update existing thinking blocks with latest content
      // This handles the case where thinking content grows between renders
      const thinkingBlocksInStream = blocks.filter(b => b && b.kind === 'thinking');
      const thinkingBlocksInDom = contentEl.querySelectorAll('.cc-content-block[data-block-type="thinking"]');
      
      thinkingBlocksInDom.forEach((domBlock, idx) => {
        const streamBlock = thinkingBlocksInStream[idx];
        if (!streamBlock) return;
        
        const contentDiv = domBlock.querySelector('.cc-thinking-content-inline');
        if (!contentDiv) return;
        
        const currentLen = Number(contentDiv.dataset.thinkingLen || 0);
        const newText = String(streamBlock.text || '');
        
        if (newText.length > currentLen) {
          // Update content with proper formatting
          if (typeof window.formatThinkingText === 'function') {
            contentDiv.innerHTML = window.formatThinkingText(newText, { streaming: !streamBlock.ended });
          } else {
            contentDiv.innerHTML = escapeHtml(newText).replace(/\n/g, '<br>');
          }
          contentDiv.dataset.thinkingLen = String(newText.length);
          
          // Update label if ended
          if (streamBlock.ended) {
            const label = domBlock.querySelector('.cc-thinking-label');
            if (label) label.textContent = 'Thought';
          }
        }
      });
    }
  }

  // Render tools (if any) - ONLY if content actually changed
  const names = Array.isArray(stream.plannedToolNames) ? stream.plannedToolNames : [];
  const unique = Array.from(new Set(names));
  if (unique.length > 0) {
    const planDiv = ensureStreamingToolsSection(streamingDiv);
    const planContent = planDiv ? planDiv.querySelector('.cc-thinking-content') : null;
    const planLabel = planDiv ? planDiv.querySelector('.cc-thinking-label') : null;
    if (planContent) {
      const total = unique.length;
      const done = Math.min(Number(stream.toolsCompleted || 0), total);
      // Check if tools actually changed to avoid unnecessary innerHTML updates
      const prevToolSig = planContent.dataset.toolSig || '';
      const newToolSig = `${total}_${done}`;
      if (finalize || prevToolSig !== newToolSig) {
        const list = unique
          .slice(0, 12)
          .map(n => `- <code>${escapeHtml(String(n))}</code>`)
          .join('\n');
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        
        // Update label (Claude Code style)
        if (planLabel) {
          planLabel.textContent = finalize ? `Used ${total} tool${total === 1 ? '' : 's'}` : `Running tools...`;
        }
        
        planContent.innerHTML = `
          <div class="tool-status">
            Tools used (${total}):<br/>
            <div class="tool-list">${list}</div>
            <div class="progress-bar-mini"><div class="progress-fill-mini" style="width:${pct}%"></div></div>
            <div style="margin-top:6px; opacity:0.85;">Progress: ${done}/${total}</div>
          </div>
        `;
        planContent.dataset.toolSig = newToolSig;
      }
    }
  }

  // Clean up empty streaming bubbles
  // If the message-content is empty (no actual content blocks), remove the entire bubble
  if (contentEl) {
    const hasContent = contentEl.querySelector('.cc-content-block, .file-preview, .cc-thinking');
    const hasPlaceholder = contentEl.querySelector('[data-stream-placeholder="1"]');
    const hasText = contentEl.textContent && contentEl.textContent.trim();
    
    if (!hasContent && !hasPlaceholder && !hasText) {
      // Empty bubble - remove it
      try {
        streamingDiv.remove();
      } catch { /* ignore */ }
    }
  }

  // Only scroll if not already at bottom (prevents layout thrashing)
  const messagesContainer = document.getElementById('chatMessages');
  if (messagesContainer && !finalize) {
    // Check if user is near bottom before auto-scrolling
    const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 100;
    if (isNearBottom) {
      smartScrollToBottom(messagesContainer);
    }
  } else if (messagesContainer && finalize) {
    smartScrollToBottom(messagesContainer);
  }
}

/**
 * FLICKER-FREE streaming render scheduler.
 * Uses requestAnimationFrame for all DOM updates and prevents concurrent renders.
 * 
 * NOTE: When using the new ContentBlockTimeline system, this function is SKIPPED
 * because the new system has its own incremental renderer.
 */
function scheduleBufferedStreamingRender(sessionId, opts = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;

  // SKIP if using the new ContentBlockTimeline system for the current session's request
  // The new system has its own incremental renderer that prevents flickering
  try {
    const st = getRunState(sid);
    const reqId = st && st.requestId;
    if (reqId && window._usingNewTimeline && window._usingNewTimeline.has(reqId)) {
      // New timeline is handling rendering for this request - skip legacy renderer
      // But if finalizing, let the new timeline know
      if (opts && opts.finalize === true && window.TimelineIntegration) {
        window.TimelineIntegration.finalizeTimeline(reqId, sid);
      }
      return;
    }
  } catch { /* ignore and fall through to legacy */ }

  // If finalizing, use requestAnimationFrame but with high priority
  if (opts && opts.finalize === true) {
    // Cancel any pending timer
    if (streamRenderTimerBySession[sid]) {
      clearTimeout(streamRenderTimerBySession[sid]);
      delete streamRenderTimerBySession[sid];
    }
    // Use RAF to batch with other DOM updates
    requestAnimationFrame(() => {
      streamRenderInProgress[sid] = false; // Allow finalize to run
      try { renderBufferedStreamingForSession(sid, opts); } catch { /* ignore */ }
    });
    return;
  }

  // Merge options
  if (!streamRenderPendingOptsBySession[sid] || typeof streamRenderPendingOptsBySession[sid] !== 'object') {
    streamRenderPendingOptsBySession[sid] = {};
  }
  if (opts && opts.allowWhenNotProcessing === true) {
    streamRenderPendingOptsBySession[sid].allowWhenNotProcessing = true;
  }

  // Skip if already scheduled or render in progress
  if (streamRenderTimerBySession[sid] || streamRenderInProgress[sid]) return;

  // Calculate delay based on last render time
  const now = Date.now();
  const last = Number(streamRenderLastAtBySession[sid] || 0);
  const delay = Math.max(0, STREAM_RENDER_MIN_INTERVAL_MS - (now - last));

  streamRenderTimerBySession[sid] = setTimeout(() => {
    delete streamRenderTimerBySession[sid];
    
    // Use requestAnimationFrame to sync with browser paint cycle
    requestAnimationFrame(() => {
      // Prevent concurrent renders
      if (streamRenderInProgress[sid]) return;
      streamRenderInProgress[sid] = true;
      
      try {
        // Check if content actually changed (skip no-op renders)
        const st = getRunState(sid);
        const stream = st?.stream;
        const contentHash = stream
          ? `${(stream.text || '').length}_${(stream.thinking || '').length}_${(stream.diffBlocks || []).length}_${(stream.toolBlocks || []).length}`
          : '';
        
        if (contentHash && contentHash === streamRenderLastContentHash[sid]) {
          // Content unchanged - skip render entirely
          streamRenderInProgress[sid] = false;
          return;
        }
        streamRenderLastContentHash[sid] = contentHash;
        
        streamRenderLastAtBySession[sid] = Date.now();
        const pending = streamRenderPendingOptsBySession[sid] || {};
        streamRenderPendingOptsBySession[sid] = {};
        
        renderBufferedStreamingForSession(sid, pending);
      } catch { /* ignore */ }
      
      streamRenderInProgress[sid] = false;
    });
  }, delay);
}


function getClaudeSessionMeta(sessionId) {
  if (!sessionId || !chatSessions || !chatSessions[sessionId]) return null;
  if (!chatSessions[sessionId].claudeMeta || typeof chatSessions[sessionId].claudeMeta !== 'object') {
    chatSessions[sessionId].claudeMeta = {
      lastAssistantUuid: null,
      pendingResumeAt: null,
      forkOnNext: false
    };
  }
  return chatSessions[sessionId].claudeMeta;
}
