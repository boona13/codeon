// ---- CHUNK 2/6 from hoisted.js (AST statement boundaries; order preserved) ----

// Safety JP line stripper for renderer side - handles cases where backend might miss stripping
// Format: JP: <node_type> | <target> | <why> [| outcome: ... | risk: ...]
function stripJpLinesFromText(text) {
  if (typeof text !== 'string' || !text) return text;
  // Quick check to avoid expensive processing
  if (!text.toLowerCase().includes('jp:')) return text;
  
  const lines = text.split('\n');
  const kept = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const idx = lower.indexOf('jp:');
    if (idx >= 0) {
      // Check if this looks like a valid JP line
      const candidate = line.slice(idx);
      const parts = candidate.split('|');
      // Valid JP has at least 3 pipe-separated parts
      if (parts.length >= 3) {
        // Keep any prefix text before "JP:"
        const prefix = line.slice(0, idx).trimEnd();
        if (prefix) kept.push(prefix);
        continue; // Skip the JP line itself
      }
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Auto-save all dirty editor tabs after an AI run completes.
 * This ensures files that were streamed by AI are persisted to disk.
 */
async function saveAllDirtyStreamedTabs() {
  try {
    if (!Array.isArray(window.editorTabs) || window.editorTabs.length === 0) {
      return;
    }
    
    const dirtyTabs = window.editorTabs.filter(tab => {
      if (!tab || !tab.model || !tab.absPath) return false;
      try {
        // Check if tab is dirty (has unsaved changes)
        const currentVersion = tab.model.getAlternativeVersionId();
        const savedVersion = tab.savedVersionId || 0;
        return currentVersion !== savedVersion;
      } catch {
        return false;
      }
    });
    
    if (dirtyTabs.length === 0) {
      console.log('[AutoSave] No dirty tabs to save after AI run');
      return;
    }
    
    console.log(`[AutoSave] Saving ${dirtyTabs.length} dirty tabs after AI run...`);
    
    for (const tab of dirtyTabs) {
      try {
        const absPath = tab.absPath;
        const content = tab.model.getValue();
        
        if (!content && content !== '') continue;
        
        if (window.electronAPI && typeof window.electronAPI.writeFile === 'function') {
          const result = await window.electronAPI.writeFile(absPath, content, false);
          
          if (result && result.success) {
            // Mark as saved
            tab.savedVersionId = tab.model.getAlternativeVersionId();
            tab.conflictOnDisk = false;
            if (result.stats && result.stats.modified) {
              tab.lastDiskMtimeMs = new Date(result.stats.modified).getTime();
            }
            console.log(`[AutoSave] ✓ Saved: ${absPath}`);
          } else {
            console.warn(`[AutoSave] ✗ Failed to save: ${absPath}`, result?.error);
          }
        }
      } catch (tabErr) {
        console.warn('[AutoSave] Error saving tab:', tabErr);
      }
    }
    
    // Refresh tabs UI to remove dirty indicators
    if (typeof window.renderEditorTabs === 'function') {
      window.renderEditorTabs();
    }
  } catch (e) {
    console.error('[AutoSave] Error in saveAllDirtyStreamedTabs:', e);
  }
}

async function getAIResponse(userMessage, attachments = [], signal = null, sessionId = null, options = {}) {
  if (!window.electronAPI || typeof window.electronAPI.claudeSdkStart !== 'function') {
    throw new Error('Claude SDK integration not available (missing preload bridge)');
  }
  const sessionIdForRun = sessionId || currentSessionId;
  if (!sessionIdForRun) throw new Error('No active chat session');
  const runState = getRunState(sessionIdForRun);
  const skillIdForRun = options && typeof options.skillId === 'string' ? options.skillId : '';
  
  // Silent mode: Skip all UI streaming/rendering when this is a learning/docs/verification request
  // Content should only appear in the dedicated panels, not the chat
  const _isVerificationRequest = options && options.isVerificationRequest === true;
  const _isLearningRequest = options && (options.isLearningRequest === true || options.isDocumentationRequest === true || _isVerificationRequest === true);
  const _isDocumentationRequest = options && options.isDocumentationRequest === true;
  // Debug log: queue early milestones until the main-process debug logger is created (claudeSdkStart).
  const _dbgQueue = [];
  let _dbgReady = false;
  const _dbgSend = (rid, kind, data) => {
    try {
      if (!window.electronAPI || typeof window.electronAPI.claudeSdkDebugLog !== 'function') return;
      window.electronAPI.claudeSdkDebugLog({ requestId: rid, kind, data: data || null }).catch(() => {});
    } catch { /* ignore */ }
  };
  const _dbg = (kind, data) => {
    try {
      const rid = String(runState?.requestId || '').trim();
      if (!rid) {
        _dbgQueue.push({ kind, data: data || null, at: Date.now() });
        // Cap to avoid runaway memory if something is very wrong before start.
        if (_dbgQueue.length > 50) _dbgQueue.splice(0, _dbgQueue.length - 50);
        return;
      }
      if (!_dbgReady) {
        _dbgQueue.push({ kind, data: data || null, at: Date.now() });
        if (_dbgQueue.length > 200) _dbgQueue.splice(0, _dbgQueue.length - 200);
        return;
      }
      _dbgSend(rid, kind, data || null);
    } catch { /* ignore */ }
  };

  // CRITICAL: streaming UI rendering is gated on `runState.isProcessing === true`
  // (see `renderBufferedStreamingForSession`). Some call paths invoke `getAIResponse`
  // without first calling `setProcessingState(true, sessionId)`, which causes the UX
  // "silent run then dump everything at end". Make this function robust + idempotent.
  try {
    if (runState && runState.isProcessing !== true) {
      if (typeof setProcessingState === 'function') setProcessingState(true, sessionIdForRun);
      else runState.isProcessing = true;
    }
  } catch { /* ignore */ }

  try { _dbg('renderer_getAIResponse_enter', { sessionId: sessionIdForRun, userMessageLen: String(userMessage || '').length }); } catch { /* ignore */ }

  // Skill invocation:
  // - PROJECT skills: use "/<skill-name> ..." slash command (Claude SDK recognizes these)
  // - USER skills: prepend "use {skill name}" directive (Claude applies from skill summaries in context)
  try {
    const msg = String(userMessage || '').trim();
    if (skillIdForRun && msg && !msg.startsWith('/')) {
      if (typeof isProjectSkillId === 'function' && isProjectSkillId(skillIdForRun)) {
        // Project skill: use slash command syntax
        if (typeof skillIdToProjectSkillDir === 'function') {
      const dir = String(skillIdToProjectSkillDir(skillIdForRun) || '').trim();
      const cmdName = dir.split('/').filter(Boolean).pop() || '';
      if (cmdName) userMessage = `/${cmdName} ${msg}`;
        }
      } else if (typeof isUserSkillId === 'function' && isUserSkillId(skillIdForRun)) {
        // User skill: prepend "use {skill name}" directive
        if (typeof applySkillByIdToPrompt === 'function') {
          userMessage = applySkillByIdToPrompt(skillIdForRun, msg);
        }
      }
    }
  } catch { /* ignore */ }

  const hasApiKey = typeof settings.apiKey === 'string' && settings.apiKey.trim().length > 0;
  normalizeClaudeAuthMode();
  const authMode = settings.authMode; // 'claude_ai' | 'api_key'
  const isAuthCommand = /^\/(login|status|logout)\b/i.test(String(userMessage || '').trim());
  const effectiveAuthMode = isAuthCommand ? 'claude_ai' : authMode;

  if (effectiveAuthMode === 'api_key' && !hasApiKey) {
    throw new Error('Anthropic API key not configured');
  }

  // We'll materialize attachments into the workspace after git checkpointing if needed.
  let savedAttachments = [];
  let effectivePrompt = userMessage;
  if (savedAttachments.length > 0) {
    const lines = savedAttachments.map(a => `- ${a.relPath}${a.kind ? ` (${a.kind})` : ''}`);
    effectivePrompt =
      `${userMessage}\n\n` +
      `User attachments (saved into the project):\n` +
      `${lines.join('\n')}\n\n` +
      `Use the Read tool to inspect these files as needed.`;
    window.addConsoleMessage?.(`Attached ${savedAttachments.length} file(s) to Claude via project paths`, 'info', sessionIdForRun);
    // Persist updated attachment metadata (savedPath) without forcing a full flush.
    saveChatHistory().catch(() => {});
  }

  // New run: remove any old persisted partial snapshot for this session.
  clearAssistantPartialSnapshot(sessionIdForRun);

    // Streaming UI: render assistant content as it arrives
    const messagesContainer = document.getElementById('chatMessages');
    let streamingDiv = null;
    let streamedContent = '';
  let lastAssistantFullText = '';
    let streamedThinking = '';
    let didOpenAuthUrl = false;
    const tryOpenFirstUrl = async (rawText) => {
      try {
        if (!isAuthCommand) return;
        if (didOpenAuthUrl) return;
        if (!window.electronAPI || typeof window.electronAPI.openExternal !== 'function') return;
        const raw = String(rawText || '');
        const m = raw.match(/https?:\/\/[^\s]+/i);
        if (!m || !m[0]) return;
        const url = String(m[0]).replace(/[)\],.]+$/g, '');
        if (!/^https?:\/\//i.test(url)) return;
        didOpenAuthUrl = true;
        await window.electronAPI.openExternal(url);
      } catch {
        // ignore
      }
    };
    let thinkingDiv = null;
    let thinkingContentDiv = null;
    let planDiv = null;
    let planContentDiv = null;
  const plannedToolNames = [];
    let toolsCompleted = 0;

    const ensureStreamingDiv = () => {
      if (_isLearningRequest) return null; // Skip UI for learning requests
      if (sessionIdForRun !== currentSessionId) return null; // don't leak output into another tab
      if (streamingDiv && streamingDiv.isConnected) return streamingDiv;
      // Reuse an existing buffered streaming bubble if it was created during tab switch.
      streamingDiv = ensureStreamingBubbleForActiveSession(sessionIdForRun);
      return streamingDiv;
    };

    const ensureThinkingDiv = () => {
      if (_isLearningRequest) return null; // Skip UI for learning requests
      if (sessionIdForRun !== currentSessionId) return null;
      const div = ensureStreamingDiv();
      if (!div) return null;
      if (thinkingDiv && thinkingDiv.isConnected) return thinkingDiv;
      thinkingDiv = ensureStreamingThinkingSection(div);
      // Thinking is now inside message-content as timeline block - use .cc-thinking-content-inline
      thinkingContentDiv = thinkingDiv ? (thinkingDiv.querySelector('.cc-thinking-content-inline') || thinkingDiv.querySelector('.cc-thinking-content')) : null;
      return thinkingDiv;
    };

    const ensurePlanDiv = () => {
      if (_isLearningRequest) return null; // Skip UI for learning requests
      if (sessionIdForRun !== currentSessionId) return null;
      const div = ensureStreamingDiv();
      if (!div) return null;
      if (planDiv && planDiv.isConnected) return planDiv;
      planDiv = ensureStreamingToolsSection(div);
      // Claude Code style: use .cc-thinking-content instead of .thought-content
      planContentDiv = planDiv ? planDiv.querySelector('.cc-thinking-content') : null;
      return planDiv;
    };

    const updateStatusChips = () => {
      // Skills/agent chips are disabled - keep the status banner clean
      try {
        const wrap = document.getElementById('chatStatusChips');
        if (wrap) wrap.innerHTML = '';
      } catch { /* ignore */ }
    };

    const updateStreamingDiv = (content) => {
      if (_isLearningRequest) return; // Skip UI for learning requests
      if (sessionIdForRun !== currentSessionId) return;
      const div = ensureStreamingDiv();
      if (!div) return;
      const contentEl = div.querySelector('.message-content');
      if (contentEl) {
        // Use formatCompletionText for proper human-readable styling
        if (typeof window.formatCompletionText === 'function') {
          contentEl.innerHTML = window.formatCompletionText(content || '', { streaming: false });
        } else {
          contentEl.innerHTML = formatMessage(content || '');
        }
      }
      if (messagesContainer) smartScrollToBottom(messagesContainer);
    };

  // Track thinking blocks for incremental timeline rendering
  // Each thinking block has: { atTextLen, text, startIdx, endIdx }
  let _lastThinkingLen = 0;
  let _thinkingRenderPending = false;
  
  const updateThinking = (thinkingText) => {
    if (_isLearningRequest) return; // Skip UI for learning requests
    if (!thinkingText || !thinkingText.trim()) return;
    if (sessionIdForRun !== currentSessionId) return;
    
    const newLen = thinkingText.length;
    if (newLen <= _lastThinkingLen) return;
    
    // Throttle rendering
    const delta = newLen - _lastThinkingLen;
    if (_thinkingRenderPending && delta < 100) return;
    
    _thinkingRenderPending = true;
    _lastThinkingLen = newLen;
    
    // Track thinking blocks in the stream state for timeline interleaving
    try {
      const st = getRunState(sessionIdForRun);
      const stream = st && st.stream && typeof st.stream === 'object' ? st.stream : null;
      if (stream) {
        if (!Array.isArray(stream.thinkingBlocks)) stream.thinkingBlocks = [];
        
        const lastBlock = stream.thinkingBlocks.length > 0 
          ? stream.thinkingBlocks[stream.thinkingBlocks.length - 1] 
          : null;
        
        if (lastBlock && !lastBlock.ended) {
          // Update existing block's text
          lastBlock.text = thinkingText.slice(lastBlock.startIdx);
          lastBlock.endIdx = thinkingText.length;
        } else {
          // Create new thinking block (first one, or after a tool execution)
          const startIdx = lastBlock ? lastBlock.endIdx : 0;
          const at = String(stream.text || '').length;
          stream.thinkingBlocks.push({
            atTextLen: at,
            startIdx: startIdx,
            endIdx: thinkingText.length,
            text: thinkingText.slice(startIdx),
            timestamp: Date.now(),
            ended: false
          });
        }
        stream.lastUpdatedAt = Date.now();
      }
    } catch { /* ignore */ }
    
    // Use requestAnimationFrame to batch DOM updates
    requestAnimationFrame(() => {
      _thinkingRenderPending = false;
      try {
        scheduleBufferedStreamingRender(sessionIdForRun);
        if (messagesContainer) smartScrollToBottom(messagesContainer);
      } catch { /* ignore */ }
    });
  };

  const updatePlan = () => {
    if (sessionIdForRun !== currentSessionId) return;
    if (!planContentDiv) return;
    const unique = Array.from(new Set(plannedToolNames));
      if (unique.length === 0) return;
    const list = unique
          .slice(0, 12)
          .map(n => `- <code>${escapeHtml(n)}</code>`)
          .join('\n');
    const total = unique.length;
        const done = Math.min(toolsCompleted, total);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        planContentDiv.innerHTML = `
          <div class="tool-status">
        Tools used (${total}):<br/>
            <div class="tool-list">${list}</div>
            <div class="progress-bar-mini"><div class="progress-fill-mini" style="width:${pct}%"></div></div>
            <div style="margin-top:6px; opacity:0.85;">Progress: ${done}/${total}</div>
          </div>
        `;
      if (messagesContainer) smartScrollToBottom(messagesContainer);
    };

    const persistAssistantMessage = (finalContent) => {
      // Finalize the existing run-assistant message in-place (standard timeline model).
      // IMPORTANT: also persist inline diff blocks, thinking/reasoning, and tool execution markers
      // so app restarts preserve the same ordering/structure as the streaming bubble.
      let inlineDiffBlocks = [];
      let toolBlocks = [];
      let thinkingBlocks = [];
      let thinking = '';
      let runMeta = null;
      try {
        const st = getRunState(sessionIdForRun);
        
        // Persist diff blocks (file previews)
        const blocks = Array.isArray(st?.stream?.diffBlocks) ? st.stream.diffBlocks.slice() : [];
        blocks.sort((a, b) => (Number(a?.atTextLen || 0) - Number(b?.atTextLen || 0)));
        const trimmed = blocks.slice(-MAX_STREAM_SNAPSHOT_DIFF_BLOCKS);
        inlineDiffBlocks = trimmed.map(b => ({
          atTextLen: Number(b?.atTextLen || 0),
          filePath: String(b?.filePath || ''),
          toolName: b?.toolName || null,
          timestamp: Number(b?.timestamp || Date.now()),
          diffContent: truncateForSnapshot(typeof b?.diffContent === 'string' ? b.diffContent : '', MAX_STREAM_SNAPSHOT_DIFF_CHARS)
        }));

        // Persist tool execution markers (inline tool cards)
        const tBlocks = Array.isArray(st?.stream?.toolBlocks) ? st.stream.toolBlocks.slice() : [];
        toolBlocks = tBlocks.map(b => ({
          atTextLen: Number(b?.atTextLen || 0),
          toolName: String(b?.toolName || ''),
          toolUseId: String(b?.toolUseId || ''),
          preview: String(b?.preview || ''),
          timestamp: Number(b?.timestamp || Date.now())
        }));

        // Persist thinking blocks for incremental timeline rendering
        const thBlocks = Array.isArray(st?.stream?.thinkingBlocks) ? st.stream.thinkingBlocks.slice() : [];
        thinkingBlocks = thBlocks.map(b => ({
          atTextLen: Number(b?.atTextLen || 0),
          startIdx: Number(b?.startIdx || 0),
          endIdx: Number(b?.endIdx || 0),
          text: String(b?.text || ''),
          timestamp: Number(b?.timestamp || Date.now()),
          ended: b?.ended === true
        }));

        // Persist thinking/reasoning content and duration (for backward compat)
        thinking = String(st?.stream?.thinking || '').trim();
        
        // Persist lightweight run metadata (skills/subagents) for better UX on reload.
        runMeta = (st && st.stream && typeof st.stream.runMeta === 'object') ? st.stream.runMeta : null;
      } catch { /* ignore */ }

      // Calculate thinking duration (Claude Code style: "Thought for Xs")
      let thinkingDurationMs = null;
      try {
        const st = getRunState(sessionIdForRun);
        if (st?.stream?.thinkingStartMs && thinking) {
          thinkingDurationMs = Date.now() - st.stream.thinkingStartMs;
        }
      } catch { /* ignore */ }

      try {
        if (!_isLearningRequest) updateRunAssistantMessage(sessionIdForRun, requestId, {
          content: String(finalContent || ''),
          streaming: false,
          interrupted: false,
          updatedAt: Date.now(),
          inlineDiffBlocks,
          toolBlocks: toolBlocks.length > 0 ? toolBlocks : undefined,
          thinkingBlocks: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          thinking: thinking || undefined,
          thinkingDurationMs: thinkingDurationMs || undefined,
          runMeta: runMeta || undefined
        });
      } catch {
        // ignore
      }
      saveChatHistory(true).catch(() => {});
    };

    const finalizeStreamingDiv = (finalContent) => {
      if (_isLearningRequest) return; // Skip UI for learning requests
      if (sessionIdForRun === currentSessionId) {
        if (thinkingDiv) thinkingDiv.classList.remove('streaming');
        if (planDiv) planDiv.classList.remove('streaming');

        // Preserve inline diff previews: do NOT overwrite the streaming bubble with plain text.
        // Instead, do a final timeline render (full markdown) using the buffered stream.
        const div = ensureStreamingDiv();
        if (div) {
          try {
            const st = getRunState(sessionIdForRun);
            if (st && st.stream && typeof st.stream === 'object') {
              const prev = String(st.stream.text || '');
              const next = String(finalContent || '');
              if (next.length >= prev.length) st.stream.text = next;
              st.stream.lastUpdatedAt = Date.now();
            }
          } catch {
            // ignore
          }
          // Allow final render even if processing flag flips right after.
          scheduleBufferedStreamingRender(sessionIdForRun, { finalize: true, allowWhenNotProcessing: true });
          addCodeBlockActions(div);
          // Fallback: if the timeline renderer didn't insert any text blocks, append final text.
          try {
            const contentText = String(finalContent || '');
            if (contentText.trim()) {
              requestAnimationFrame(() => {
                try {
                  const contentEl = div.querySelector('.message-content');
                  if (!contentEl) return;
                  const hasTextBlock = !!contentEl.querySelector('.cc-content-block[data-block-type="text"], .cc-text-block');
                  if (hasTextBlock) return;
                  const textBlock = document.createElement('div');
                  textBlock.className = 'cc-content-block cc-success';
                  textBlock.dataset.blockType = 'text';
                  if (typeof window.formatCompletionText === 'function') {
                    textBlock.innerHTML = `<div class="cc-text-block">${window.formatCompletionText(contentText, { streaming: false })}</div>`;
                  } else {
                    textBlock.innerHTML = `<div class="cc-text-block">${formatMessage(contentText)}</div>`;
                  }
                  contentEl.appendChild(textBlock);
                } catch { /* ignore */ }
              });
            }
          } catch { /* ignore */ }
          // Promote the streaming bubble into a normal message so future runs don't overwrite it.
          try { div.removeAttribute('data-streaming-session'); } catch { /* ignore */ }
          streamingDiv = div;
        } else {
          // No streaming div yet; create one for display, but do NOT mutate history here
          // (we persist below via persistAssistantMessage to avoid duplicates).
          // Fallback: plain render.
          updateStreamingDiv(finalContent);
        }
      }
      // Always persist to the originating session (even if user switched tabs)
      persistAssistantMessage(finalContent);
    };

  const requestId = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  // Bind this SDK requestId to the originating session so Stop only affects that tab.
  try {
    const st = getRunState(sessionIdForRun);
    if (st) {
      st.requestId = requestId;
      // Mark this run as a learning run so streaming functions can skip UI updates
      st.isLearningRun = _isLearningRequest;
      st.isDocumentationRun = _isDocumentationRequest;
      st.isVerificationRun = _isVerificationRequest;
    }
  } catch {
    // ignore
  }

  // Queue early milestones; we'll flush once the main debug logger exists.
  try { _dbgQueue.push({ kind: 'renderer_request_id_created', data: { sessionId: sessionIdForRun }, at: Date.now() }); } catch { /* ignore */ }

  // STANDARD: persist a single assistant message for this run immediately.
  // This guarantees streamed content is saved and survives app restart mid-run.
  // SKIP for learning requests - learning content should only appear in the Learning panel, not chat.
  if (!_isLearningRequest) {
  try {
    getOrCreateRunAssistantMessage(sessionIdForRun, requestId, { timestamp: Date.now() });
    // Debounced persist (stream journal covers crash safety).
    saveChatHistory().catch(() => {});
  } catch {
    // ignore
    }
  }

  // Run Claude directly in the real workspace (no shadow worktrees).
  try {
    savedAttachments = await materializeAttachmentsForClaude(attachments, sessionIdForRun);
  } catch {
    savedAttachments = [];
  }
  effectivePrompt = userMessage;
  if (savedAttachments.length > 0) {
    const folders = savedAttachments.filter(a => String(a?.kind || '') === 'folder');
    const files = savedAttachments.filter(a => String(a?.kind || '') !== 'folder');
    const fileLines = files.map(a => `- ${a.relPath}${a.kind ? ` (${a.kind})` : ''}`);
    const folderLines = folders.map(a => `- ${a.relPath} (folder)`);
    const parts = [];
    if (fileLines.length > 0) {
      parts.push(`Attached files:\n${fileLines.join('\n')}`);
    }
    if (folderLines.length > 0) {
      parts.push(`Attached folders:\n${folderLines.join('\n')}`);
    }
    const folderFocus = folderLines.length > 0
      ? (folderLines.length === 1
        ? `When the user refers to "this folder", assume it means "${folders[0]?.relPath}" (the attached folder), not the workspace root.`
        : 'If the user refers to "this folder", ask which attached folder they mean.')
      : '';
    const guidance = [
      fileLines.length > 0 ? 'Use the Read tool to inspect attached files as needed.' : '',
      folderLines.length > 0 ? 'Use shell tools like ls/find scoped to the attached folder paths to explore their contents (for example: ls -la <folder>, find <folder> -type f).' : '',
      folderFocus
    ].filter(Boolean).join(' ');
    effectivePrompt =
      `${userMessage}\n\n` +
      `${parts.join('\n\n')}\n\n` +
      `${guidance}`;
    const fileCount = files.length;
    const folderCount = folders.length;
    window.addConsoleMessage?.(`Attached ${fileCount} file(s) and ${folderCount} folder(s) via project paths`, 'info', sessionIdForRun);
    saveChatHistory().catch(() => {});
  }

  if (settings && settings.llmProvider === 'openrouter') {
    try {
      const visionSummaries = await buildOpenRouterVisionSummaries(attachments, sessionIdForRun);
      if (Array.isArray(visionSummaries) && visionSummaries.length > 0) {
        const lines = visionSummaries.map(item => `- ${item.name}: ${item.description}`);
        effectivePrompt =
          `${effectivePrompt}\n\n` +
          `Image attachments (auto-described for OpenRouter vision):\n` +
          `${lines.join('\n')}\n\n` +
          `Use these descriptions as the source of truth for the attached images.`;
        window.addConsoleMessage?.(`Added OpenRouter vision summaries for ${visionSummaries.length} image(s)`, 'info', sessionIdForRun);
      }
    } catch {
      // ignore (fallback to regular prompt)
    }
  }

  // If user pasted absolute paths from the real workspace root, rewrite them to project-relative paths.
  // No shadow-worktree path rewriting needed anymore.

  // Edge case: user hit Stop immediately after Send (before requestId was set / listener attached).
  // If already aborted, cancel this request proactively and surface an AbortError.
  if (signal && signal.aborted) {
    try {
      if (window.electronAPI && typeof window.electronAPI.claudeSdkCancel === 'function') {
        await window.electronAPI.claudeSdkCancel(requestId);
      }
    } catch {
      // ignore
    }
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }

  const currentSession = sessionIdForRun ? chatSessions[sessionIdForRun] : null;
  let resumeSessionId = currentSession && typeof currentSession.claudeSessionId === 'string'
    ? currentSession.claudeSessionId
    : null;
  const meta = sessionIdForRun ? getClaudeSessionMeta(sessionIdForRun) : null;
  let resumeSessionAt = meta && typeof meta.pendingResumeAt === 'string' && meta.pendingResumeAt.trim()
    ? meta.pendingResumeAt.trim()
    : null;
  let forkSession = !!(meta && meta.forkOnNext && resumeSessionId);

  // IMPORTANT: preserve Claude sessions across runs (resume/rewind).
  // Some non-user-triggered actions may need a fresh model session after a workspace restore.
  const forceNewClaudeSession = !!(options && options.forceNewClaudeSession === true);
  if (forceNewClaudeSession) {
    resumeSessionId = null;
    resumeSessionAt = null;
    forkSession = false;
  }

  // Guard against rare event races where the SDK can emit both 'result' and 'done'
  // (or multiple terminal events). Without this, we can persist/render the final message twice.
  let didFinalizeClaudeRun = false;

  const donePromise = new Promise((resolve, reject) => {
    // Renderer-side event receipt debug (throttled)
    let __dbgEvtCount = 0;
    let __dbgTextCount = 0;
    let __dbgThinkingCount = 0;
    claudeSdkHandlers.set(requestId, async (evt) => {
      if (!evt || evt.requestId !== requestId) return;
      try {
        __dbgEvtCount++;
        const t0 = String(evt.type || '');
        if (t0 && t0 !== 'thinking_delta' && t0 !== 'text_delta') {
          _dbg('renderer_evt', { n: __dbgEvtCount, type: t0 });
        } else if (t0 === 'text_delta') {
          __dbgTextCount++;
          if (__dbgTextCount <= 3 || (__dbgTextCount % 200) === 0) {
            _dbg('renderer_text_delta_seen', { n: __dbgTextCount, len: typeof evt.textDelta === 'string' ? evt.textDelta.length : 0 });
          }
        } else if (t0 === 'thinking_delta') {
          __dbgThinkingCount++;
          if (__dbgThinkingCount <= 3 || (__dbgThinkingCount % 300) === 0) {
            _dbg('renderer_thinking_delta_seen', { n: __dbgThinkingCount, len: typeof evt.thinkingDelta === 'string' ? evt.thinkingDelta.length : 0 });
          }
        }
      } catch { /* ignore */ }

      // After finalization, ignore late-arriving streaming updates to avoid
      // re-creating partial snapshots or rendering duplicate content.
      if (didFinalizeClaudeRun) {
        const t = evt.type;
        if (
          t === 'text_delta' ||
          t === 'thinking_delta' ||
          t === 'assistant_message' ||
          t === 'tool_progress' ||
          t === 'file_diff'
        ) {
          return;
        }
      }

      if (evt.type === 'started') {
        if (!_isLearningRequest) window.addConsoleMessage?.('Claude started…', 'processing', sessionIdForRun);
        if (!_isLearningRequest) {
          try {
            // Ensure the streaming bubble exists immediately so the UI never looks empty.
            ensureStreamingDiv();
            scheduleBufferedStreamingRender(sessionIdForRun);
            _dbg('renderer_started_rendered_placeholder', { ok: true });
          } catch { /* ignore */ }
        }
        return;
      }

      if (evt.type === 'init') {
        try {
          window.codeonRunTelemetry?.startRun?.({ sessionId: sessionIdForRun, requestId });
          if (!_isLearningRequest) updateStatusChips();
        } catch { /* ignore */ }
        if (!_isLearningRequest) {
          try {
            ensureStreamingDiv();
            scheduleBufferedStreamingRender(sessionIdForRun);
            _dbg('renderer_init_rendered_placeholder', { ok: true });
          } catch { /* ignore */ }
        }
        if (evt.sessionId && sessionIdForRun && chatSessions[sessionIdForRun]) {
          chatSessions[sessionIdForRun].claudeSessionId = evt.sessionId;
          // If we forked/resumed-at for restore, clear the pending flags now that we have the new forked session.
          const m = getClaudeSessionMeta(sessionIdForRun);
          if (m) {
            m.pendingResumeAt = null;
            m.forkOnNext = false;
          }
          // Persist session metadata (debounced)
      saveChatHistory();
    }
        if (evt.model) {
          window.addConsoleMessage?.(`Claude session initialized (${evt.model})`, 'info', sessionIdForRun);
        }
        return;
      }

      // ─────────────────────────────────────────────────────────────────────────────
      // STREAM_EVENT - Process raw Anthropic events via ContentBlockTimeline
      // 
      // ARCHITECTURE FIX: This is now the SINGLE processing path for stream events.
      // Previous implementation had a dual-processing bug where events went through
      // StreamAssembler AND text_delta/thinking_delta handlers, causing:
      //   - Race conditions
      //   - Text fragmentation (cut mid-word)
      //   - "Mismatched content block type" errors
      // 
      // The ContentBlockTimeline maintains proper content block ordering and renders
      // based on block sequence (not text positions). This eliminates the root cause.
      // ─────────────────────────────────────────────────────────────────────────────
      if (evt.type === 'stream_event' && evt.event) {
        // Skip ALL timeline/stream processing for learning requests - content should go to learning tab only
        if (_isLearningRequest) return;
        try {
          // Initialize timeline for this request if not already done
          if (window.TimelineIntegration && typeof window.TimelineIntegration.initializeTimeline === 'function') {
            // Check if we already have a timeline for this request
            const existingTimeline = window._contentBlockTimelines?.get(requestId);
            if (!existingTimeline) {
              if (!window._contentBlockTimelines) window._contentBlockTimelines = new Map();
              
              const timelineEntry = window.TimelineIntegration.initializeTimeline(requestId, sessionIdForRun);
              if (timelineEntry) {
                window._contentBlockTimelines.set(requestId, timelineEntry);
                
                // Mark that we're using the new timeline for this request
                // This will skip the legacy text_delta/thinking_delta handlers
                window._usingNewTimeline = window._usingNewTimeline || new Set();
                window._usingNewTimeline.add(requestId);
              }
            }
            
            // Process through the ContentBlockTimeline (single processing path)
            const parentToolUseId = evt.parentToolUseId || null;
            window.TimelineIntegration.processTimelineEvent(requestId, evt.event, parentToolUseId);
            
            // Update local variables from timeline for backwards compatibility
            const text = window.TimelineIntegration.getTimelineText(requestId);
            const thinking = window.TimelineIntegration.getTimelineThinking(requestId);
            if (text) {
              streamedContent = text;
              if (runState && runState.stream) {
                runState.stream.text = text;
                runState.stream.lastUpdatedAt = Date.now();
              }
            }
            if (thinking) {
              streamedThinking = thinking;
              if (runState && runState.stream) {
                runState.stream.thinking = thinking;
                if (!runState.stream.thinkingStartMs) {
                  runState.stream.thinkingStartMs = Date.now();
                }
              }
            }
          } else {
            // Fallback to legacy StreamAssembler if new system not available
            if (!window._streamAssemblers) window._streamAssemblers = new Map();
            let assembler = window._streamAssemblers.get(requestId);
            if (!assembler && typeof window.StreamAssembler === 'function') {
              assembler = new window.StreamAssembler((betaMessageId, parentToolUseId) => {
                if (!window._assembledMessages) window._assembledMessages = new Map();
                const key = `${requestId}_${betaMessageId || 'root'}`;
                let msg = window._assembledMessages.get(key);
                if (!msg) {
                  msg = new window.AssembledMessage('assistant', [], { betaMessageId, parentToolUseId });
                  window._assembledMessages.set(key, msg);
                  msg.onUpdate(() => {
                    const text = msg.getText();
                    const thinking = msg.getThinking();
                    if (runState && runState.stream) {
                      if (text) { runState.stream.text = text; streamedContent = text; }
                      if (thinking) { runState.stream.thinking = thinking; streamedThinking = thinking; }
                      runState.stream.lastUpdatedAt = Date.now();
                    }
                    scheduleBufferedStreamingRender(sessionIdForRun);
                  });
                }
                return msg;
              });
              window._streamAssemblers.set(requestId, assembler);
            }
            if (assembler) {
              assembler.processStreamEvent(evt.event, evt.parentToolUseId || null);
            }
          }
        } catch (streamErr) {
          console.warn('[ContentBlockTimeline] Error processing stream_event:', streamErr);
        }
        // CRITICAL FIX: Return here to prevent dual processing
        // The legacy text_delta/thinking_delta handlers should NOT also process these events
        return;
      }

      if (evt.type === 'sdk_message_uuid') {
        const uuid = typeof evt.uuid === 'string' ? evt.uuid.trim() : '';
        if (!uuid || !sessionIdForRun) return;
        // Ignore replayed UUID emissions during resume to avoid corrupting our mapping.
        if (evt.isReplay === true) return;

        // Persist UUIDs onto our timeline so Restore can truly rewind Claude via resumeSessionAt.
        if (evt.role === 'assistant') {
          const m = getClaudeSessionMeta(sessionIdForRun);
          if (m) m.lastAssistantUuid = uuid;
          try {
            const sessId = (chatSessions && chatSessions[sessionIdForRun] && typeof chatSessions[sessionIdForRun].claudeSessionId === 'string' && chatSessions[sessionIdForRun].claudeSessionId.trim())
              ? chatSessions[sessionIdForRun].claudeSessionId.trim()
              : null;
            if (!_isLearningRequest) updateRunAssistantMessage(sessionIdForRun, requestId, { claudeUuid: uuid, ...(sessId ? { claudeSessionId: sessId } : {}) });
            if (!_isLearningRequest) saveChatHistory().catch(() => {});
          } catch { /* ignore */ }
        } else if (evt.role === 'user') {
          try {
            const st = getRunState(sessionIdForRun);
            const pendingSeq = st && typeof st.pendingUserSeq === 'number' ? st.pendingUserSeq : null;
            const timeline = ensureSessionMessages(sessionIdForRun);
            let target = null;
            if (pendingSeq != null) {
              target = timeline.find(m => m && m.role === 'user' && m.seq === pendingSeq);
            }
            // CRITICAL: do not "guess" a target user message. This can corrupt restore/rewind mapping,
            // especially for non-user-triggered runs.
            if (pendingSeq == null) return;
            if (!target) return;
            if (target) {
              const sessId = (chatSessions && chatSessions[sessionIdForRun] && typeof chatSessions[sessionIdForRun].claudeSessionId === 'string' && chatSessions[sessionIdForRun].claudeSessionId.trim())
                ? chatSessions[sessionIdForRun].claudeSessionId.trim()
                : null;
              target.claudeUuid = uuid;
              if (sessId) target.claudeSessionId = sessId;
              try { if (st) st.pendingUserSeq = null; } catch { /* ignore */ }
              saveChatHistory().catch(() => {});
            }
          } catch { /* ignore */ }
        }
        return;
      }

      const isClaudeRateLimitError = (v) => {
        const raw = String(v || '');
        const primary = (() => {
          const idx = raw.toLowerCase().indexOf('what to do:');
          return idx >= 0 ? raw.slice(0, idx) : raw;
        })();
        const s = primary.toLowerCase();
        // If we have explicit forbidden markers, don't mislabel as rate limit.
        if (s.includes('status code 403') || /\b403\b/.test(s)) return false;
        return (
          s.includes('rate_limit') ||
          s.includes('rate limit') ||
          s.includes('too many requests') ||
          s.includes('status code 429') ||
          /\b429\b/.test(s)
        );
      };

      if (evt.type === 'assistant_error') {
        const rawErr = evt.error != null ? String(evt.error) : '';
        const msg = rawErr ? `Claude error: ${rawErr}` : 'Claude error';
        // Rate limit errors often surface as an assistant_error and then a terminal result with subtype=success.
        // Avoid double error spam; let the terminal result render the final UI once.
        if (rawErr && isClaudeRateLimitError(rawErr)) {
          try {
            const st = getRunState(sessionIdForRun);
            if (st) st.pendingClaudeTerminalError = { kind: 'rate_limit', error: rawErr, at: Date.now() };
          } catch { /* ignore */ }
          window.addConsoleMessage?.(msg, 'error', sessionIdForRun);
          return;
        }
        if (shouldSuppressClaudeTechnicalErrors() && isAuthOrRuntimeSetupError(msg)) {
          openAuthGateModal({
            statusText: 'Sign in required',
            subtitleText: 'Click “Sign in with Claude.ai” to set up login, then try again.'
          });
          addSystemMessage('⚠️ Claude sign-in required. Use “Sign in with Claude.ai” to continue.', true, { sessionId: sessionIdForRun });
          return;
        }
        window.addConsoleMessage?.(msg, 'error', sessionIdForRun);
        // Surface in chat (non-fatal; we keep streaming if possible)
        addSystemMessage(`❌ ${msg}`, true, { sessionId: sessionIdForRun });
        return;
      }

      if (evt.type === 'auth_status') {
        // Keep auth noise out of the console for normal users; rely on the auth gate + Settings status.
        if (!shouldSuppressClaudeTechnicalErrors() && typeof window.addConsoleMessage === 'function') {
          const lines = Array.isArray(evt.output) ? evt.output.join('\n') : '';
          const msg = evt.error ? `Claude auth error: ${evt.error}` : (lines || 'Claude authenticating...');
          window.addConsoleMessage(msg, evt.error ? 'error' : 'processing', sessionIdForRun);
        }

        // If auth status includes a URL (browser login), open it once to reduce friction.
        const raw = Array.isArray(evt.output) ? evt.output.join('\n') : '';
        await tryOpenFirstUrl(raw);
        return;
      }

      if (evt.type === 'thinking_delta') {
        // Skip ALL rendering for learning requests - content should go to learning tab only
        if (_isLearningRequest) return;
        // SAFETY: Skip if using new ContentBlockTimeline (stream_event already handled this)
        if (window._usingNewTimeline && window._usingNewTimeline.has(requestId)) {
          return;
        }
        // PERF: SDK can emit high-frequency thinking deltas. Prefer delta accumulation locally
        // (avoids sending full growing strings over IPC).
        const deltaRaw = (typeof evt.thinkingDelta === 'string') ? evt.thinkingDelta : '';
        if (deltaRaw) {
          streamedThinking += deltaRaw;
        } else if (typeof evt.thinking === 'string') {
          // Back-compat: some SDK versions may still send full snapshots.
          streamedThinking = evt.thinking || streamedThinking;
        }
        if (runState && runState.stream) {
          const prev = String(runState.stream.thinking || '');
          const next = String(streamedThinking || '');
          // Monotonic update: never allow shrinking (prevents "letters disappear")
          if (next.length >= prev.length) runState.stream.thinking = next;
          runState.stream.lastUpdatedAt = Date.now();
          
          // Track thinking start time for duration calculation (Claude Code style: "Thought for Xs")
          if (!runState.stream.thinkingStartMs && next.length > 0) {
            runState.stream.thinkingStartMs = Date.now();
          }
        }
        updateThinking(streamedThinking);
        scheduleStreamJournalPersist(sessionIdForRun);
        scheduleAssistantPartialSnapshot(sessionIdForRun);
        return;
      }

      if (evt.type === 'text_delta') {
        // Skip ALL rendering for learning requests - content should go to learning tab only
        if (_isLearningRequest) return;
        // SAFETY: Skip if using new ContentBlockTimeline (stream_event already handled this)
        if (window._usingNewTimeline && window._usingNewTimeline.has(requestId)) {
          return;
        }
        const deltaRaw = (typeof evt.textDelta === 'string') ? evt.textDelta : '';
        const stStream = (runState && runState.stream && typeof runState.stream === 'object') ? runState.stream : null;
        // Keep a local buffer, but prefer the canonical runState.stream.text (so separators persist).
        streamedContent = String(stStream?.text || streamedContent || '');

        if (deltaRaw) {
          // If we just completed a tool, the next text chunk means the model is now "writing".
          // Keep this low-frequency so it doesn't flicker.
          try {
            if (!_isLearningRequest) { // Skip status for learning requests
              const st = getRunState(sessionIdForRun);
              if (st && st.uiStatusWritingOnNextTextDelta === true) {
                st.uiStatusWritingOnNextTextDelta = false;
                _setRunUiStatus(sessionIdForRun, 'Writing…', { kind: 'writing' });
              } else if (!st || !String(st.uiStatus || '').trim()) {
                _setRunUiStatus(sessionIdForRun, 'Writing…', { kind: 'writing' });
              }
            }
          } catch { /* ignore */ }
          // ROBUSTNESS: Some SDK versions can occasionally emit snapshot-like content
          // via the delta channel (or resend overlapping text). When that happens,
          // we should REPLACE the current streamed text (not append), otherwise
          // the user sees repeated sentences.
          const mergeIncomingDelta = (prevText, incoming) => {
            const prev = String(prevText || '');
            const inc = String(incoming || '');
            if (!inc) return prev;
            if (!prev) return inc;

            // Exact prefix relationships (fast path)
            if (prev.startsWith(inc)) return prev;         // already have it
            if (inc.startsWith(prev)) return inc;          // snapshot replaces

            // Snapshot-like detection with minor differences:
            // If the two strings share a large common prefix, prefer the longer one.
            const commonPrefixLen = (a, b, max = 4096) => {
              const n = Math.min(max, a.length, b.length);
              let i = 0;
              for (; i < n; i++) {
                if (a.charCodeAt(i) !== b.charCodeAt(i)) break;
              }
              return i;
            };
            const cpl = commonPrefixLen(prev, inc, 4096);
            if (cpl >= 160 && inc.length > prev.length) {
              return inc;
            }
            if (cpl >= 160 && prev.length >= inc.length) {
              return prev;
            }

            // Overlap merge: find the longest suffix of prev that is a prefix of inc, then append remainder.
            const MAX_OVERLAP = 2048;
            const max = Math.min(MAX_OVERLAP, prev.length, inc.length);
            for (let k = max; k >= 8; k--) {
              const suffix = prev.slice(prev.length - k);
              if (inc.startsWith(suffix)) {
                return prev + inc.slice(k);
              }
            }
            // No overlap: treat as normal delta append.
            return prev + inc;
          };

          // FIRST: merge the raw delta with existing content (handles snapshot/overlap detection).
          let baseMerged = mergeIncomingDelta(streamedContent, deltaRaw);
          
          // SAFETY: Strip any JP (justification plan) lines that leaked through backend
          baseMerged = stripJpLinesFromText(baseMerged);
          
          if (baseMerged === streamedContent) {
            // No visible change (duplicate/already-have-it scenario), skip.
            return;
          }

          // SECOND: apply section breaks and spacing fixes to the NEW portion only.
          let finalText = baseMerged;
          const addedPortion = baseMerged.slice(streamedContent.length);
          
          // If we just executed a tool and new text is arriving, insert a separator.
          if (stStream && stStream.needsSectionBreak === true && addedPortion.trim()) {
            const sep = streamedContent && streamedContent.trim() ? '\n\n---\n\n' : '';
            finalText = streamedContent + sep + addedPortion;
            stStream.needsSectionBreak = false;
          }

          // Micro-fix: avoid "app.Now" style concatenation when the delta lacks leading whitespace.
          if (finalText === baseMerged) {
            // No separator was added, so check if we need spacing.
            const lastCh = streamedContent ? streamedContent.slice(-1) : '';
            const firstChDelta = deltaRaw ? deltaRaw[0] : '';
            if (lastCh && firstChDelta && !/\s/.test(lastCh) && !/\s/.test(firstChDelta)) {
              // Only insert after sentence-ending punctuation, and only if next chunk starts a new sentence.
              if (/[.!?:;]/.test(lastCh) && /[A-Z]/.test(firstChDelta)) {
                finalText = streamedContent + ' ' + addedPortion;
              }
            }
          }

          streamedContent = finalText;
        } else if (typeof evt.text === 'string' && evt.text.length > streamedContent.length) {
          // Fallback: some SDK versions can omit textDelta; use full text snapshot.
          streamedContent = evt.text;
        }

        if (stStream) {
          stStream.text = streamedContent;
          stStream.lastUpdatedAt = Date.now();
        }
        // Persist streamed assistant content in-place on the run's assistant message.
        try {
          if (!_isLearningRequest) updateRunAssistantMessage(sessionIdForRun, requestId, {
            content: String(runState?.stream?.text || streamedContent || ''),
            streaming: true,
            interrupted: false,
            updatedAt: Date.now()
          });
          maybeForcePersistNow(sessionIdForRun);
        } catch { /* ignore */ }
        scheduleStreamJournalPersist(sessionIdForRun);
        // Render via buffered timeline so any inlined diff previews stay in the right position.
        scheduleBufferedStreamingRender(sessionIdForRun);
        ensureStreamingDiv();
        // Some /login flows print the verification URL into the assistant stream.
        await tryOpenFirstUrl(streamedContent);
        scheduleAssistantPartialSnapshot(sessionIdForRun);
        return;
      }

      if (evt.type === 'assistant_message') {
        // Some SDK runs may not emit stream deltas; render the full assistant message if provided.
        if (typeof evt.text === 'string' && evt.text.trim()) {
          // SAFETY: Strip any JP lines that leaked through
          lastAssistantFullText = stripJpLinesFromText(evt.text);
          if (runState && runState.stream) {
            const prev = String(runState.stream.text || '');
            const next = String(lastAssistantFullText || '');
            // Only use full snapshots when we have no streaming buffer yet.
            if (!prev) runState.stream.text = next;
            runState.stream.lastUpdatedAt = Date.now();
          }
          try {
            if (!_isLearningRequest) {
              updateRunAssistantMessage(sessionIdForRun, requestId, {
                content: String(runState?.stream?.text || lastAssistantFullText || ''),
                streaming: true,
                interrupted: false,
                updatedAt: Date.now()
              });
              maybeForcePersistNow(sessionIdForRun);
            }
          } catch { /* ignore */ }
          try {
            if (!_isLearningRequest &&
                window._usingNewTimeline && window._usingNewTimeline.has(requestId) &&
                window.TimelineIntegration && typeof window.TimelineIntegration.injectFinalText === 'function') {
              window.TimelineIntegration.injectFinalText(requestId, lastAssistantFullText);
            }
          } catch { /* ignore */ }
          if (!_isLearningRequest) scheduleBufferedStreamingRender(sessionIdForRun);
          ensureStreamingDiv();
          if (!_isLearningRequest) await tryOpenFirstUrl(lastAssistantFullText);
        }
        return;
      }

      if (evt.type === 'tool_progress') {
        if (evt.toolName) {
          try { if (!_isLearningRequest) _setRunUiStatus(sessionIdForRun, `Running: ${String(evt.toolName || '').trim()}`, { kind: 'tool' }); } catch { /* ignore */ }
          plannedToolNames.push(evt.toolName);
          toolsCompleted += 1;
          if (runState && runState.stream) {
            runState.stream.plannedToolNames = [...plannedToolNames];
            runState.stream.toolsCompleted = toolsCompleted;
            runState.stream.lastUpdatedAt = Date.now();
          }
          ensurePlanDiv();
          updatePlan();
        }
        if (typeof window.addConsoleMessage === 'function') {
          window.addConsoleMessage(`Tool: ${evt.toolName}`, 'processing', sessionIdForRun);
        }
        scheduleAssistantPartialSnapshot(sessionIdForRun);
        return;
      }

      if (evt.type === 'permission_mode_changed') {
        try {
          const mode = (evt && typeof evt.permissionMode === 'string') ? evt.permissionMode : '';
          const allowed = new Set(['plan', 'default', 'acceptEdits', 'bypassPermissions']);
          const nextMode = allowed.has(mode) ? mode : 'acceptEdits';
          if (settings && typeof settings === 'object') {
            settings.permissionMode = nextMode;
            if (nextMode !== 'plan') settings.lastNonPlanPermissionMode = nextMode;
          }
          try {
            const permissionModeComposerInput = document.getElementById('permissionModeComposerInput');
            if (permissionModeComposerInput) permissionModeComposerInput.value = nextMode;
          } catch { /* ignore */ }
          try {
            const permissionModeInput = document.getElementById('permissionModeInput');
            if (permissionModeInput) permissionModeInput.value = nextMode;
          } catch { /* ignore */ }
          if (typeof saveSettings === 'function') {
            try { saveSettings(); } catch { /* ignore */ }
          }
          try { if (typeof window.renderLearningPanel === 'function') window.renderLearningPanel(); } catch { /* ignore */ }
          try { if (typeof window.renderDocsPanel === 'function') window.renderDocsPanel(); } catch { /* ignore */ }
          window.addConsoleMessage?.(`Permission mode updated: ${nextMode}`, 'info', sessionIdForRun);
        } catch { /* ignore */ }
        return;
      }

      if (evt.type === 'tool_executed') {
        try {
          window.codeonRunTelemetry?.recordToolExecuted?.({ sessionId: sessionIdForRun, requestId, evt });
          // Mirror to run state for persistence (best-effort; kept tiny).
          const st = getRunState(sessionIdForRun);
          if (st && st.stream) {
            const meta = window.codeonRunTelemetry?.getSummary?.({ sessionId: sessionIdForRun, requestId });
            if (meta) st.stream.runMeta = meta;
          }
          updateStatusChips();
          
          // Add to timeline for real-time rendering (show tool executions as they happen)
          if (window.TimelineIntegration && typeof window.TimelineIntegration.addExecutedTool === 'function') {
            window.TimelineIntegration.addExecutedTool(requestId, {
              toolName: evt.toolName || 'Tool',
              toolUseId: evt.toolUseId || null,
              preview: evt.preview || '',
              receipt: evt.receipt || null,
              input: evt.input || null
            });
          }
        } catch { /* ignore */ }
        // Log every tool completion to the in-app console for transparency/debuggability.
        const name = evt.toolName || 'tool';
        const preview = typeof evt.preview === 'string' ? evt.preview : '';
        const receipt = evt && typeof evt.receipt === 'object' ? evt.receipt : null;
        const cwd = receipt && typeof receipt.cwd === 'string' ? receipt.cwd : '';
        const exitCode = receipt && typeof receipt.exitCode === 'number' ? receipt.exitCode : null;
        const net = receipt && receipt.networkPolicy && typeof receipt.networkPolicy === 'object' ? receipt.networkPolicy : null;
        const netMode = net && typeof net.mode === 'string' ? net.mode : '';
        const suffixParts = [];
        if (cwd) suffixParts.push(`cwd=${cwd}`);
        if (typeof exitCode === 'number') suffixParts.push(`exit=${exitCode}`);
        if (name === 'WebFetch' && netMode) suffixParts.push(`net=${netMode}`);
        const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(', ')})` : '';
        window.addConsoleMessage?.(`Tool executed: ${name}${preview}${suffix}`, 'info', sessionIdForRun);

        // Mirror AI Bash tool executions into the Terminal panel (per-chat AI tab; no tab spam).
        // IMPORTANT: This is log-only mirroring and does NOT execute the command again (prevents breaking Claude loop).
        try {
          if (name === 'Bash' || name === 'TaskOutput') {
            window.codeonAiBashBridge?.handleToolExecuted?.(evt, sessionIdForRun);
          }
        } catch { /* ignore */ }

        // Chat-only UX: show what just ran, and then flip to "Writing…" on the next delta.
        try {
          const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
          const clamp = (s, n = 88) => (s.length > n ? (s.slice(0, n - 1) + '…') : s);
          let detail = '';
          const p = String(preview || '');
          if (name === 'Bash') {
            const m = p.match(/Command:\s*([\s\S]*)/i);
            detail = m && m[1] ? oneLine(m[1].split('\n')[0]) : oneLine(p);
          } else if (name === 'WebFetch') {
            const m = p.match(/URL(?:s)?:\s*([\s\S]*)/i) || p.match(/https?:\/\/[^\s]+/i);
            detail = m ? oneLine(Array.isArray(m) ? (m[1] || m[0]) : m[0]) : oneLine(p);
          } else if (name === 'Read' || name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
            const m = p.match(/File:\s*([\s\S]*)/i);
            detail = m && m[1] ? oneLine(m[1].split('\n')[0]) : oneLine(p);
          } else {
            detail = oneLine(p);
          }
          const label = detail ? `${name} — ${clamp(detail)}` : String(name);
          if (!_isLearningRequest) _setRunUiStatus(sessionIdForRun, `Ran: ${label}`, { kind: 'tool', setWritingNext: true });
        } catch { /* ignore */ }

        // Couple tool execution to the streaming transcript by inserting a tool marker "block"
        // at the current text length. This prevents action narration from blending across tools.
        try {
          const st = getRunState(sessionIdForRun);
          const stream = st && st.stream && typeof st.stream === 'object' ? st.stream : null;
          if (stream) {
            // Mark current thinking block as ended (tool breaks the thinking)
            // This allows new thinking after the tool to be a separate timeline item
            if (Array.isArray(stream.thinkingBlocks) && stream.thinkingBlocks.length > 0) {
              const lastThinking = stream.thinkingBlocks[stream.thinkingBlocks.length - 1];
              if (lastThinking && !lastThinking.ended) {
                lastThinking.ended = true;
              }
            }
            
            if (!Array.isArray(stream.toolBlocks)) stream.toolBlocks = [];
            const at = String(stream.text || '').length;
            stream.toolBlocks.push({
              atTextLen: at,
              toolName: String(name || ''),
              toolInputSummary: (typeof evt.toolInputSummary === 'string') ? evt.toolInputSummary : '',
              preview: String(preview || ''),
              receipt: (evt && typeof evt.receipt === 'object') ? evt.receipt : null,
              toolOutput: (typeof evt.toolOutput === 'string') ? evt.toolOutput : '',
              toolOutputTruncated: evt && evt.toolOutputTruncated === true,
              taskId: (typeof evt.taskId === 'string') ? evt.taskId : '',
              toolUseId: typeof evt.toolUseId === 'string' ? evt.toolUseId : '',
              timestamp: Date.now()
            });
            // Bound growth (streaming-only; receipts are persisted separately).
            const MAX_TOOL_BLOCKS = 200;
            if (stream.toolBlocks.length > MAX_TOOL_BLOCKS) stream.toolBlocks = stream.toolBlocks.slice(-MAX_TOOL_BLOCKS);
            stream.lastUpdatedAt = Date.now();
          }
        } catch { /* ignore */ }
        // Render immediately so the user sees the tool boundary as it happens.
        try { scheduleBufferedStreamingRender(sessionIdForRun); } catch { /* ignore */ }

        // Persist an execution receipt into the session timeline for auditability across restarts.
        try {
          const sid = String(sessionIdForRun || '').trim();
          const toolUseId = typeof evt.toolUseId === 'string' ? evt.toolUseId : '';
          if (sid && toolUseId) {
            ensureMessageSeqInitialized(sid);
            const timeline = ensureSessionMessages(sid);

            // De-dupe: if the receipt already exists for this toolUseId, do nothing.
            const exists = timeline.some(m => m && m.role === 'tool_receipt' && m.toolUseId === toolUseId);
            if (!exists) {
              timeline.push({
                role: 'tool_receipt',
                timestamp: Date.now(),
                seq: nextMessageSeq(sid),
                runRequestId: String(requestId || ''),
                toolName: String(name || ''),
                toolUseId,
                preview,
                receipt: receipt || null
              });

              // Bound receipts to avoid unbounded growth (keep newest N).
              const MAX_TOOL_RECEIPTS_PER_SESSION = 400;
              let receiptCount = 0;
              const next = [];
              for (let i = timeline.length - 1; i >= 0; i--) {
                const m = timeline[i];
                if (m && m.role === 'tool_receipt') {
                  receiptCount++;
                  if (receiptCount > MAX_TOOL_RECEIPTS_PER_SESSION) continue;
                }
                next.push(m);
              }
              next.reverse();
              if (next.length !== timeline.length) {
                replaceSessionMessages(sid, next);
              }
              saveChatHistory(); // debounced
            }
          }
        } catch {
          // ignore
        }
        return;
      }

      if (evt.type === 'sdk_hook') {
        try {
          window.codeonRunTelemetry?.recordSdkHook?.({ sessionId: sessionIdForRun, requestId, evt });
          const st = getRunState(sessionIdForRun);
          if (st && st.stream) {
            const meta = window.codeonRunTelemetry?.getSummary?.({ sessionId: sessionIdForRun, requestId });
            if (meta) st.stream.runMeta = meta;
          }
          updateStatusChips();
        } catch { /* ignore */ }
        try {
          const hook = String(evt.hookEventName || '').trim();
          if (hook === 'SubagentStart' || hook === 'SubagentStop') {
            const agentType = String(evt.agentType || '').trim();
            const agentId = String(evt.agentId || '').trim().slice(0, 12);
            if (hook === 'SubagentStart') {
              // Show agent type with optional short ID for better identification
              let statusText = 'Subagent…';
              if (agentType && agentId) statusText = `${agentType}: ${agentId}`;
              else if (agentType) statusText = `${agentType}…`;
              else if (agentId) statusText = `Subagent: ${agentId}`;
              if (!_isLearningRequest) _setRunUiStatus(sessionIdForRun, statusText, { kind: 'subagent' });
            }
            if (hook === 'SubagentStop' && !_isLearningRequest) _setRunUiStatus(sessionIdForRun, 'Writing…', { kind: 'writing' });
          }
        } catch { /* ignore */ }
        return;
      }

      if (evt.type === 'gate_event') {
        try {
          const kind = String(evt.kind || '').trim();
          if (kind === 'lock_block') {
            const fp = typeof evt.filePath === 'string' ? evt.filePath.trim() : '';
            // Dedupe: rapid retries can spam this event.
            try {
              const k = `lock_block:${String(sessionIdForRun || '')}:${fp || ''}`;
              const now = Date.now();
              if (!window.__codeonGateEventDedupe || typeof window.__codeonGateEventDedupe !== 'object') window.__codeonGateEventDedupe = {};
              const last = Number(window.__codeonGateEventDedupe[k] || 0);
              if (Number.isFinite(last) && (now - last) < 2500) return;
              window.__codeonGateEventDedupe[k] = now;
            } catch { /* ignore */ }
            if (fp) {
              addMessage('system_action', `🔒 Blocked edit due to lock: \`${fp}\` (skipping this file; unlock to allow edits)`, null, null, true);
              try { showToast(`Blocked edit (locked): ${fp}`, 2600); } catch { /* ignore */ }
            } else {
              addMessage('system_action', `🔒 Blocked edit due to lock (skipping; unlock to allow edits)`, null, null, true);
              try { showToast('Blocked edit (locked)', 2600); } catch { /* ignore */ }
            }
          }
        } catch { /* ignore */ }
        return;
      }

      if (evt.type === 'file_diff') {
        // Show diff previews for Claude file mutations (Edit/Write/etc.)
        if (evt.filePath && typeof evt.diffContent === 'string') {
          // Status banner: show a terse "Updated: file (+a -r)" line.
          try {
            const fpRaw = String(evt.filePath || '');
            const fpRel = isProbablyAbsolutePath(fpRaw) ? getRelPath(fpRaw) : fpRaw;
            const fp = normalizeRelPathForDiffPreview(fpRel);
            const stats = countDiffStats(String(evt.diffContent || ''));
            const statStr = stats.isNewFile ? `+${stats.added}` : `+${stats.added} -${stats.removed}`;
            if (fp && !_isLearningRequest) _setRunUiStatus(sessionIdForRun, `Updated: ${fp} (${statStr})`, { kind: 'diff' });
            
            // SYNC: Track streaming file in FileSyncController
            try {
              const absPath = isProbablyAbsolutePath(fpRaw) ? fpRaw : resolveToWorkspaceAbsPath(fpRaw);
              if (absPath && window.FileSyncController?.markFileAsStreaming) {
                window.FileSyncController.markFileAsStreaming(absPath, sessionIdForRun);
              }
            } catch { /* ignore */ }
          } catch { /* ignore */ }
          
          // Add diff to ContentBlockTimeline if using new system
          try {
            if (window._usingNewTimeline && window._usingNewTimeline.has(requestId) && 
                window.TimelineIntegration && typeof window.TimelineIntegration.addDiffBlock === 'function') {
              window.TimelineIntegration.addDiffBlock(requestId, {
                filePath: evt.filePath,
                diffContent: evt.diffContent,
                toolName: evt.toolName || null
              });
            }
          } catch { /* ignore */ }
          
          // Also update legacy runState for backwards compatibility
          try {
            const st = getRunState(sessionIdForRun);
            if (st && st.stream) {
              const fullText = String(st.stream.text || '');
              const blocks = Array.isArray(st.stream.diffBlocks) ? st.stream.diffBlocks : [];
              blocks.push({
                atTextLen: fullText.length,
                filePath: evt.filePath,
                diffContent: evt.diffContent,
                toolName: evt.toolName || null,
                persisted: true,
                timestamp: Date.now()
              });
              st.stream.diffBlocks = blocks;
              st.stream.lastUpdatedAt = Date.now();
            }
          } catch {
            // ignore
          }

          // Persist diff previews immediately (so app restarts mid-run don't lose them).
          // We do NOT render as separate messages during the run (the streaming bubble already shows inline diffs).
          addFilePreviewMessageFromDiff(sessionIdForRun, evt.filePath, evt.diffContent, evt.toolName || '', {
            renderNow: false,
            timestamp: Date.now()
          })
            .catch(() => {});

          // If the tab is active, redraw the buffered streaming bubble so the diff appears in-place
          // and subsequent text continues after it.
          scheduleBufferedStreamingRender(sessionIdForRun);
          window.addConsoleMessage?.(`Diff: ${evt.filePath}`, 'info', sessionIdForRun);
        }
        scheduleAssistantPartialSnapshot(sessionIdForRun);
        return;
      }

      if (evt.type === 'done') {
        if (didFinalizeClaudeRun) return;
        didFinalizeClaudeRun = true;
        
        // Finalize the timeline (do final render) BEFORE cleanup
        // SKIP for learning requests - learning content should only appear in the Learning panel
        if (!_isLearningRequest) {
        try {
          if (window.TimelineIntegration && typeof window.TimelineIntegration.finalizeTimeline === 'function') {
            window.TimelineIntegration.finalizeTimeline(requestId, sessionIdForRun);
          }
        } catch { /* ignore */ }
        }
        
        try {
          const meta = window.codeonRunTelemetry?.getSummary?.({ sessionId: sessionIdForRun, requestId });
          const st = getRunState(sessionIdForRun);
          if (meta && st && st.stream) st.stream.runMeta = meta;
          updateStatusChips();
        } catch { /* ignore */ }
        // Fallback completion if SDK doesn't emit a result message.
        const streamFinal = (() => {
          try {
            const st = getRunState(sessionIdForRun);
            return String(st?.stream?.text || streamedContent || '');
          } catch { return String(streamedContent || ''); }
        })();
        const rawFinal = (typeof evt.finalText === 'string' && evt.finalText.trim())
          ? evt.finalText
          : (streamFinal.trim() ? streamFinal : (lastAssistantFullText || streamedContent || ''));
        // SAFETY: Strip any JP lines that leaked through
        const final = stripJpLinesFromText(rawFinal);
        try {
          if (!_isLearningRequest &&
              window._usingNewTimeline && window._usingNewTimeline.has(requestId) &&
              window.TimelineIntegration && typeof window.TimelineIntegration.injectFinalText === 'function') {
            window.TimelineIntegration.injectFinalText(requestId, final, { force: !streamFinal.trim() });
          }
        } catch { /* ignore */ }
        finalizeStreamingDiv(final || '(No output)');
        
        // CRITICAL: Cleanup ContentBlockTimeline AFTER finalizeStreamingDiv
        // This ensures the new timeline renderer is used for the final render,
        // not the legacy renderer (which doesn't have tool_use blocks)
        try {
          if (window._contentBlockTimelines) {
            window._contentBlockTimelines.delete(requestId);
          }
          if (window._usingNewTimeline) {
            window._usingNewTimeline.delete(requestId);
          }
        } catch { /* ignore */ }
        // Cleanup StreamAssembler for this request (legacy fallback)
        try {
          if (window._streamAssemblers && window._streamAssemblers.has(requestId)) {
            const assembler = window._streamAssemblers.get(requestId);
            if (assembler && typeof assembler.reset === 'function') assembler.reset();
            window._streamAssemblers.delete(requestId);
          }
          // Cleanup assembled messages
          if (window._assembledMessages) {
            for (const key of window._assembledMessages.keys()) {
              if (key.startsWith(`${requestId}_`)) {
                window._assembledMessages.delete(key);
              }
            }
          }
        } catch { /* ignore */ }
        // Final message persisted; clear any partial snapshot.
        clearAssistantPartialSnapshot(sessionIdForRun);
        // Persist any diff previews captured during the run (so they appear in history on reload)
        // SKIP for learning requests - learning content should only appear in the Learning panel
        if (!_isLearningRequest) {
        try {
          await flushStreamDiffBlocksToHistory(sessionIdForRun);
        } catch {
          // non-fatal
          }
        }
        claudeSdkHandlers.delete(requestId);
        try { const st = getRunState(sessionIdForRun); if (st) { st.requestId = null; st.isLearningRun = false; st.isDocumentationRun = false; st.isVerificationRun = false; } } catch { /* ignore */ }
        setProcessingState(false, sessionIdForRun);
        try { window.codeonRunTelemetry?.clearRun?.({ sessionId: sessionIdForRun, requestId }); } catch { /* ignore */ }
        try { await clearStreamJournal(sessionIdForRun); } catch { /* ignore */ }
        // Clear buffers now that the run is complete
        if (runState) {
          resetStreamBuffer(sessionIdForRun);
        }
        
        // SYNC: Clear streaming state for files that were written during this run
        try {
          if (window.FileSyncController?.getStreamingFilesForSession && 
              window.FileSyncController?.clearFileStreamingState) {
            const streamingFiles = window.FileSyncController.getStreamingFilesForSession(sessionIdForRun);
            for (const absPath of streamingFiles) {
              window.FileSyncController.clearFileStreamingState(absPath);
            }
          }
        } catch { /* ignore */ }
        
        // AUTO-SAVE: Save all dirty editor tabs that may have been modified during AI streaming
        try {
          await saveAllDirtyStreamedTabs();
        } catch (saveErr) {
          console.warn('[Done] Error saving streamed tabs:', saveErr);
        }
        
        renderChatTabs();
        
        // Process queued messages - auto-send next queued message after run completes
        try {
          if (typeof processMessageQueueAfterRunComplete === 'function') {
            processMessageQueueAfterRunComplete(sessionIdForRun);
          }
        } catch { /* ignore */ }
        
        resolve(final || '');
        return;
      }

      if (evt.type === 'permission_request') {
        try {
          const toolName = String(evt.toolName || 'tool').trim() || 'tool';
          if (!_isLearningRequest) _setRunUiStatus(sessionIdForRun, `Waiting for permission: ${toolName}`, { kind: 'permission' });
        } catch { /* ignore */ }
        const st = getRunState(sessionIdForRun);
        const chain = st && st.permissionPromptChain ? st.permissionPromptChain : Promise.resolve();
        // Per-session ordering + global mutex so dialogs never overlap.
        const nextChain = chain.then(() => {
          permissionDialogChain = permissionDialogChain.then(async () => {
          try {
            const toolName = evt.toolName || 'tool';
            const inputObj = evt.input && typeof evt.input === 'object' ? evt.input : null;
            const isPause = String(toolName || '') === '__PAUSE_BEFORE_TOOL__';
            const pausedNextTool = isPause && inputObj && typeof inputObj.nextToolName === 'string' ? inputObj.nextToolName : '';
            const pausedInput = isPause && inputObj && inputObj.nextToolInput && typeof inputObj.nextToolInput === 'object' ? inputObj.nextToolInput : null;
            const cmd =
              (pausedInput && typeof pausedInput.command === 'string') ? pausedInput.command :
              ((pausedInput && typeof pausedInput.cmd === 'string') ? pausedInput.cmd :
                (inputObj && typeof inputObj.command === 'string' ? inputObj.command :
                  (inputObj && typeof inputObj.cmd === 'string' ? inputObj.cmd : '')));
            const url =
              (pausedInput && typeof pausedInput.url === 'string') ? pausedInput.url :
              ((pausedInput && typeof pausedInput.uri === 'string') ? pausedInput.uri :
                (inputObj && typeof inputObj.url === 'string' ? inputObj.url :
                  (inputObj && typeof inputObj.uri === 'string' ? inputObj.uri : '')));
            const urls =
              (pausedInput && Array.isArray(pausedInput.urls)) ? pausedInput.urls.filter(u => typeof u === 'string').slice(0, 4)
                : (inputObj && Array.isArray(inputObj.urls) ? inputObj.urls.filter(u => typeof u === 'string').slice(0, 4) : null);
            const lockedPaths =
              (pausedInput && Array.isArray(pausedInput.lockedPaths))
                ? pausedInput.lockedPaths.filter(p => typeof p === 'string').slice(0, 8)
                : (inputObj && Array.isArray(inputObj.lockedPaths) ? inputObj.lockedPaths.filter(p => typeof p === 'string').slice(0, 8) : null);

            let preview = '';
            const shownTool = isPause ? (pausedNextTool || 'tool') : toolName;
            if (shownTool === 'Bash' && cmd) {
              preview = `\n\nCommand:\n${cmd}`;
              if (lockedPaths && lockedPaths.length > 0) {
                const total = pausedInput && Array.isArray(pausedInput.lockedPaths)
                  ? pausedInput.lockedPaths.length
                  : (inputObj && Array.isArray(inputObj.lockedPaths) ? inputObj.lockedPaths.length : lockedPaths.length);
                preview += `\n\nLocked files (Bash may modify them):\n${lockedPaths.join('\n')}${(total > lockedPaths.length) ? `\n... (+${total - lockedPaths.length} more)` : ''}`;
              }
            } else if (shownTool === 'WebFetch') {
              const list = urls && urls.length > 0 ? urls : (url ? [url] : []);
              if (list.length > 0) {
                preview = `\n\nURL${list.length > 1 ? 's' : ''}:\n${list.join('\n')}${(urls && Array.isArray(inputObj.urls) && inputObj.urls.length > list.length) ? `\n... (+${inputObj.urls.length - list.length} more)` : ''}`;
              }
            } else {
              const fp =
                (pausedInput && typeof pausedInput.file_path === 'string') ? pausedInput.file_path
                  : (inputObj && typeof inputObj.file_path === 'string' ? inputObj.file_path : '');
              if (fp && (shownTool === 'Read' || shownTool === 'Write' || shownTool === 'Edit' || shownTool === 'MultiEdit' || shownTool === 'NotebookEdit')) {
                preview = `\n\nFile:\n${fp}`;
              }
            }

            if (toolName === 'AskUserQuestion') {
              let response = null;
              const questions = inputObj && Array.isArray(inputObj.questions) ? inputObj.questions : [];
              if (typeof window.openAskUserQuestionModal === 'function') {
                response = await window.openAskUserQuestionModal({
                  questions,
                  titleText: 'Claude needs your input'
                });
              }
              const allow = !!(response && response.allow === true);
              const answers = (response && response.answers && typeof response.answers === 'object') ? response.answers : null;

              window.addConsoleMessage?.(
                allow ? 'Answered Claude questions' : 'Declined to answer Claude questions',
                allow ? 'success' : 'error',
                sessionIdForRun
              );

              if (window.electronAPI && typeof window.electronAPI.claudeSdkPermissionRespond === 'function') {
                await window.electronAPI.claudeSdkPermissionRespond({
                  requestId,
                  permissionRequestId: evt.permissionRequestId,
                  allow: !!allow,
                  toolName: String(toolName || ''),
                  answers
                });
              }
              return;
            }

            window.addConsoleMessage?.(
              isPause ? `Paused before ${shownTool}` : `Permission requested for ${toolName}`,
              'processing',
              sessionIdForRun
            );

            const isExitPlanMode = toolName === 'ExitPlanMode';
            const confirmMessage = isPause
                ? `Paused before running "${shownTool}".\n\nContinue or Skip?${preview}`
              : (isExitPlanMode
                ? `Exit plan mode and allow edits/commands?\n\nThis will turn off read-only restrictions and let Claude run tools.${preview}`
                : `Allow Claude to run "${toolName}"?${preview}`);
            const confirmTitle = isPause ? 'Paused' : (isExitPlanMode ? 'Exit Plan Mode' : 'Tool Permission');
            const confirmOpts = isPause
              ? { confirmText: 'Continue', cancelText: 'Skip' }
              : (isExitPlanMode ? { confirmText: 'Exit plan mode', cancelText: 'Stay in plan mode' } : undefined);
            const allow = await customConfirm(confirmMessage, confirmTitle, confirmOpts);

            if (window.electronAPI && typeof window.electronAPI.claudeSdkPermissionRespond === 'function') {
              await window.electronAPI.claudeSdkPermissionRespond({
                requestId,
                permissionRequestId: evt.permissionRequestId,
                allow: !!allow,
                toolName: String(toolName || '')
              });
            }

            window.addConsoleMessage?.(
              isPause ? (allow ? `Continue: ${shownTool}` : `Skip: ${shownTool}`) : (allow ? `Allowed ${toolName}` : `Denied ${toolName}`),
              allow ? 'success' : 'error',
              sessionIdForRun
            );
        } catch (e) {
            window.addConsoleMessage?.(`Permission prompt failed: ${e?.message || String(e)}`, 'error', sessionIdForRun);
            try {
              if (window.electronAPI && typeof window.electronAPI.claudeSdkPermissionRespond === 'function') {
                await window.electronAPI.claudeSdkPermissionRespond({
                  requestId,
                  permissionRequestId: evt.permissionRequestId,
                  allow: false,
                  toolName: String(evt.toolName || '')
                });
              }
            } catch {
              // ignore
            }
          }
          });
          return permissionDialogChain;
        });
        if (st) st.permissionPromptChain = nextChain;
        nextChain.catch(() => {});
        return;
      }

      if (evt.type === 'todo_write') {
        if (sessionIdForRun === currentSessionId) {
          setTodoList(evt.todos, { persist: true });
        } else if (sessionIdForRun) {
          ensureMessageSeqInitialized(sessionIdForRun);
          const timeline = ensureSessionMessages(sessionIdForRun);
          const nextTimeline = timeline.filter(m => !(m && m.role === 'todo_state'));
          nextTimeline.push({
            role: 'todo_state',
            todos: Array.isArray(evt.todos) ? evt.todos : [],
            timestamp: Date.now(),
            seq: nextMessageSeq(sessionIdForRun)
          });
          replaceSessionMessages(sessionIdForRun, nextTimeline);
          saveChatHistory(true).catch(() => {});
        }
        window.addConsoleMessage?.(`Tasks updated (${Array.isArray(evt.todos) ? evt.todos.length : 0})`, 'info', sessionIdForRun);
        return;
      }

      if (evt.type === 'result') {
        if (didFinalizeClaudeRun) return;
        try {
          // Snapshot final run meta into state before we finalize/persist.
          const meta = window.codeonRunTelemetry?.getSummary?.({ sessionId: sessionIdForRun, requestId });
          const st = getRunState(sessionIdForRun);
          if (meta && st && st.stream) st.stream.runMeta = meta;
          updateStatusChips();
        } catch { /* ignore */ }
        // Prefer the streamed buffer: it includes our section breaks (`---`) and matches what the user saw.
        const streamFinal = (() => {
          try {
            const st = getRunState(sessionIdForRun);
            return String(st?.stream?.text || streamedContent || '');
          } catch { return String(streamedContent || ''); }
        })();
        const final = streamFinal.trim()
          ? streamFinal
          : (typeof evt.result === 'string' ? evt.result : (streamedContent || ''));
        const isFailure = (evt.subtype && evt.subtype !== 'success') || evt.isError === true || (Array.isArray(evt.errors) && evt.errors.length > 0);

        if (!isFailure) {
          try {
            if (!_isLearningRequest &&
                window._usingNewTimeline && window._usingNewTimeline.has(requestId) &&
                window.TimelineIntegration && typeof window.TimelineIntegration.injectFinalText === 'function') {
              window.TimelineIntegration.injectFinalText(requestId, final, { force: !streamFinal.trim() });
            }
          } catch { /* ignore */ }
          didFinalizeClaudeRun = true;
          
          // Finalize the timeline (do final render) BEFORE cleanup
          // SKIP for learning requests - learning content should only appear in the Learning panel
          if (!_isLearningRequest) {
          try {
            if (window.TimelineIntegration && typeof window.TimelineIntegration.finalizeTimeline === 'function') {
              window.TimelineIntegration.finalizeTimeline(requestId, sessionIdForRun);
            }
          } catch { /* ignore */ }
          }
          
          finalizeStreamingDiv(final);
          
          // CRITICAL: Cleanup ContentBlockTimeline AFTER finalizeStreamingDiv
          // This ensures the new timeline renderer is used for the final render
          try {
            if (window._contentBlockTimelines) {
              window._contentBlockTimelines.delete(requestId);
            }
            if (window._usingNewTimeline) {
              window._usingNewTimeline.delete(requestId);
            }
          } catch { /* ignore */ }
          // Cleanup StreamAssembler for this request (legacy fallback)
          try {
            if (window._streamAssemblers && window._streamAssemblers.has(requestId)) {
              const assembler = window._streamAssemblers.get(requestId);
              if (assembler && typeof assembler.reset === 'function') assembler.reset();
              window._streamAssemblers.delete(requestId);
            }
            if (window._assembledMessages) {
              for (const key of window._assembledMessages.keys()) {
                if (key.startsWith(`${requestId}_`)) {
                  window._assembledMessages.delete(key);
                }
              }
            }
          } catch { /* ignore */ }
          
          // CRITICAL: Collect run metadata BEFORE flushing diff blocks (which clears the data)
          // This data is needed for Learning/Docs/Verification features
          const _collectedToolsUsed = [];
          const _collectedFilesModified = [];
          let _collectedRestoreCheckpointHash = '';
          try {
            const runSt = typeof getRunState === 'function' ? getRunState(sessionIdForRun) : null;
            if (runSt && runSt.stream) {
              // Get actual tool names from toolBlocks
              const toolBlocks = Array.isArray(runSt.stream.toolBlocks) ? runSt.stream.toolBlocks : [];
              for (const tb of toolBlocks) {
                const name = String(tb?.toolName || '').trim();
                if (name && !_collectedToolsUsed.includes(name)) _collectedToolsUsed.push(name);
              }
              // Get file paths from diffBlocks (actual file modifications)
              const diffBlocks = Array.isArray(runSt.stream.diffBlocks) ? runSt.stream.diffBlocks : [];
              for (const db of diffBlocks) {
                const path = String(db?.filePath || '').trim();
                if (path && !_collectedFilesModified.includes(path)) _collectedFilesModified.push(path);
              }
            }
            // Checkpoint hash
            if (runSt && runSt.processCommitHash) {
              _collectedRestoreCheckpointHash = String(runSt.processCommitHash);
            }
          } catch { /* ignore */ }
          // Also collect from skills telemetry
          try {
            const runMeta = window.codeonRunTelemetry?.getSummary?.({ sessionId: sessionIdForRun, requestId });
            if (runMeta?.skills?.length) {
              for (const s of runMeta.skills) {
                const name = String(s?.name || '').trim();
                if (name && !_collectedToolsUsed.includes(name)) _collectedToolsUsed.push(name);
              }
            }
          } catch { /* ignore */ }
          // Also collect from message history (backup source)
          try {
            const msgs = typeof ensureSessionMessages === 'function' ? ensureSessionMessages(sessionIdForRun) : [];
            const previews = msgs.filter(m => m?.role === 'file_preview');
            for (const p of previews.slice(-10)) {
              const path = String(p?.path || '').trim();
              if (path && !_collectedFilesModified.includes(path)) _collectedFilesModified.push(path);
            }
            const receipts = msgs.filter(m => m?.role === 'tool_receipt' && m?.runRequestId === requestId);
            for (const r of receipts.slice(-20)) {
              const name = String(r?.toolName || '').trim();
              if (name && !_collectedToolsUsed.includes(name)) _collectedToolsUsed.push(name);
            }
          } catch { /* ignore */ }

          // Final message persisted; clear any partial snapshot.
          clearAssistantPartialSnapshot(sessionIdForRun);
          // Persist any diff previews captured during the run (so they appear in history on reload)
          // SKIP for learning requests - learning content should only appear in the Learning panel
          if (!_isLearningRequest) {
          try {
            await flushStreamDiffBlocksToHistory(sessionIdForRun);
          } catch {
            // non-fatal
            }
          }
          claudeSdkHandlers.delete(requestId);
          try { const st = getRunState(sessionIdForRun); if (st) { st.requestId = null; st.isLearningRun = false; st.isDocumentationRun = false; st.isVerificationRun = false; } } catch { /* ignore */ }
          // Clear buffers now that the run is complete
          if (runState) {
            resetStreamBuffer(sessionIdForRun);
          }
          window.addConsoleMessage?.('Claude finished', 'success', sessionIdForRun);
          // Force persistence so history survives app close/restart even if the debounce timer doesn't fire.
          // SKIP for learning requests - learning content should only appear in the Learning panel
          if (!_isLearningRequest) saveChatHistory(true).catch(() => {});
          try { window.codeonRunTelemetry?.clearRun?.({ sessionId: sessionIdForRun, requestId }); } catch { /* ignore */ }
          try { await clearStreamJournal(sessionIdForRun); } catch { /* ignore */ }
          // Mark AI run completed to trigger post-run scan blackout (prevents crashes)
          try { if (typeof window.markAiRunCompletedForProblems === 'function') window.markAiRunCompletedForProblems(); } catch { /* ignore */ }
          
          // Process queued messages - auto-send next queued message after run completes
          try {
            if (typeof processMessageQueueAfterRunComplete === 'function') {
              processMessageQueueAfterRunComplete(sessionIdForRun);
            }
          } catch { /* ignore */ }
          
          // Trigger Learning / Docs features if enabled (generate educational explanation + documentation updates)
          // IMPORTANT: Skip if this is already a learning/docs request to avoid infinite loop!
          const isLearningRequest = (options && options.isLearningRequest === true) || 
                                    (typeof userMessage === 'string' && userMessage.trim().startsWith('/learn'));
          const isDocumentationRequest = (options && options.isDocumentationRequest === true) ||
                                         (typeof userMessage === 'string' && userMessage.trim().startsWith('/docs'));
          const isVerificationRequest = (options && options.isVerificationRequest === true);
          const skipLearning = options && options.skipLearning === true;
          const skipDocs = options && options.skipDocs === true;
          const skipProofedEdits = options && options.skipProofedEdits === true;
          const isInternalFollowup = isLearningRequest || isDocumentationRequest || isVerificationRequest;
          try {
            const runPayload = {
              sessionId: sessionIdForRun,
              runRequestId: requestId,
              originalPrompt: userMessage || '',
              toolsUsed: _collectedToolsUsed,
              filesModified: _collectedFilesModified,
              durationMs: 0, // Duration not tracked at this level
              restoreCheckpointHash: _collectedRestoreCheckpointHash,
              isInternalFollowup
            };

            if (!isInternalFollowup && !skipLearning && typeof window._onLearningRunCompleted === 'function') {
              window._onLearningRunCompleted(runPayload);
            }
            if (!isInternalFollowup && !skipDocs && typeof window._onDocumentationRunCompleted === 'function') {
              window._onDocumentationRunCompleted(runPayload);
            }
            if (!isInternalFollowup && !skipProofedEdits && typeof window._onProofedEditsRunCompleted === 'function') {
              window._onProofedEditsRunCompleted(runPayload);
            }
          } catch { /* ignore */ }
          
          resolve(final);
          return;
        }

        // Edge-case failures: show a clear UI error block and stop.
        didFinalizeClaudeRun = true;
        // NOTE: timeline teardown is intentionally DEFERRED until after we render the
        // error into the timeline (see below). Cleaning it up here made
        // `error_during_execution` failures invisible in the chat thread whenever the
        // new timeline was active — the error only reached the console/activity feed.
        // Cleanup StreamAssembler for this request (failure path - legacy fallback)
        try {
          if (window._streamAssemblers && window._streamAssemblers.has(requestId)) {
            const assembler = window._streamAssemblers.get(requestId);
            if (assembler && typeof assembler.reset === 'function') assembler.reset();
            window._streamAssemblers.delete(requestId);
          }
          if (window._assembledMessages) {
            for (const key of window._assembledMessages.keys()) {
              if (key.startsWith(`${requestId}_`)) {
                window._assembledMessages.delete(key);
              }
            }
          }
        } catch { /* ignore */ }
        const formatErr = (e) => {
          if (typeof e === 'string') return e;
          if (e && typeof e === 'object') {
            const code = e.code || e.type || e.name;
            const msg = typeof e.message === 'string' ? e.message : '';
            if (code && msg) return `${code}: ${msg}`;
            if (msg) return msg;
            if (code) return String(code);
            try { return JSON.stringify(e); } catch { return String(e); }
          }
          return String(e);
        };
        let errs = Array.isArray(evt.errors) ? evt.errors.map(formatErr) : (evt.errors ? [formatErr(evt.errors)] : []);
        const denials = Array.isArray(evt.permissionDenials) ? evt.permissionDenials : [];
        // Failure is terminal; clear any partial snapshot.
        clearAssistantPartialSnapshot(sessionIdForRun);

        // Pull any pending terminal error that we stashed from assistant_error to avoid double-spam.
        let pendingTerminal = null;
        try {
          const st = getRunState(sessionIdForRun);
          pendingTerminal = st && st.pendingClaudeTerminalError ? st.pendingClaudeTerminalError : null;
          if (st) st.pendingClaudeTerminalError = null;
        } catch { /* ignore */ }
        if (pendingTerminal && pendingTerminal.error) {
          const pe = String(pendingTerminal.error || '').trim();
          if (pe && !errs.some(x => String(x).includes(pe))) errs = [pe, ...errs];
        }

        const rateLimited = isClaudeRateLimitError((pendingTerminal && pendingTerminal.error) || errs.join('\n'));
        const failureLabel =
          (evt.subtype && evt.subtype !== 'success')
            ? evt.subtype
            : (rateLimited ? 'rate_limit' : 'error');

        const buildClaudeAiLimitMessage = () => {
          try {
            const now = new Date();
            const reset = new Date(now);
            reset.setHours(6, 0, 0, 0);
            if (reset.getTime() <= now.getTime()) reset.setDate(reset.getDate() + 1);
            const t = reset.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            return `You've hit your limit for Claude messages. Limits will reset at ${t}. View your usage details.`;
          } catch {
            return `You've hit your limit for Claude messages. View your usage details.`;
          }
        };

        const authMode = (settings && typeof settings.authMode === 'string') ? settings.authMode : '';
        const fullErrorText = (rateLimited && authMode === 'claude_ai')
          ? buildClaudeAiLimitMessage()
          : (() => {
              const parts = [];
              parts.push(`Claude failed (${failureLabel})`);
              if (errs.length > 0) parts.push(`Errors:\n- ${errs.join('\n- ')}`);
              if (denials.length > 0) {
                const d = denials.slice(0, 6).map(x => `- ${x.tool_name || 'tool'} (${x.tool_use_id || 'unknown'}): denied`).join('\n');
                parts.push(`Permission denials:\n${d}${denials.length > 6 ? `\n... (+${denials.length - 6} more)` : ''}`);
              }
              return parts.join('\n\n');
            })();

        // Persist the error into the run's assistant message (single-source-of-truth),
        // instead of creating extra system messages that can double-spam the UI.
        const errorBlockText = `**Error**\n\n${fullErrorText}`;
        // Render the error INTO the active timeline bubble (mirrors the success path),
        // so a silent `error_during_execution` actually shows up in the chat thread.
        // This must happen BEFORE we tear the timeline down.
        try {
          if (window._usingNewTimeline && window._usingNewTimeline.has(requestId) && window.TimelineIntegration) {
            if (typeof window.TimelineIntegration.injectFinalText === 'function') {
              window.TimelineIntegration.injectFinalText(requestId, errorBlockText, { force: true });
            }
            if (typeof window.TimelineIntegration.finalizeTimeline === 'function') {
              window.TimelineIntegration.finalizeTimeline(requestId, sessionIdForRun);
            }
          }
        } catch { /* ignore */ }
        finalizeStreamingDiv(errorBlockText);
        // Now that the error is rendered + persisted, tear down the timeline/buffers.
        try {
          if (window.TimelineIntegration && typeof window.TimelineIntegration.cleanupTimeline === 'function') {
            window.TimelineIntegration.cleanupTimeline(requestId);
          }
          if (window._contentBlockTimelines) window._contentBlockTimelines.delete(requestId);
          if (window._usingNewTimeline) window._usingNewTimeline.delete(requestId);
        } catch { /* ignore */ }
        try {
          const err0 = (pendingTerminal && pendingTerminal.error) ? String(pendingTerminal.error) : (errs[0] || '');
          const retryAfterSeconds = parseRetryAfterSecondsFromText(
            String((pendingTerminal && pendingTerminal.error) || '') + '\n' + errs.join('\n')
          );
          if (rateLimited && retryAfterSeconds && retryAfterSeconds > 0) {
            claudeGlobalBackoffUntilMs = Math.max(claudeGlobalBackoffUntilMs, Date.now() + (retryAfterSeconds * 1000));
          }

          // If this is an auth/runtime gating error, show the auth modal (instead of just dying).
          if (shouldSuppressClaudeTechnicalErrors() && isAuthOrRuntimeSetupError(err0)) {
            openAuthGateModal({
              statusText: 'Sign in required',
              subtitleText: 'Click “Sign in with Claude.ai” to set up login, then try again.'
            });
          } else if (sessionIdForRun === currentSessionId) {
            // Show an actionable retry card for *any* retryable transient failure (403/unzip, offline, etc).
            const info = classifyClaudeTransientFailure(err0);
            if (info && info.retryable) {
              const diag = (() => {
                try {
                  return window.codeonClaudeDiagnostics?.buildClaudeDiagnosticsPayload?.({
                    sessionId: sessionIdForRun,
                    requestId,
                    kind: info.kind,
                    failureLabel,
                    errorText: err0,
                    permissionDenials: denials,
                    settings,
                    workspaceRoot: currentFolder || null
                  }) || null;
                } catch { return null; }
              })();
              addClaudeTransientRetryCard(sessionIdForRun, {
                title: info.title,
                subtitle: info.subtitle,
                errorText: err0,
                retryAfterSeconds,
                kind: info.kind,
                requestId: typeof requestId === 'string' ? requestId : null,
                diagnostics: diag
              });
            }
          }
        } catch { /* ignore */ }
        window.addConsoleMessage?.(fullErrorText, 'error', sessionIdForRun);

        claudeSdkHandlers.delete(requestId);
        try { const st = getRunState(sessionIdForRun); if (st) { st.requestId = null; st.isLearningRun = false; st.isDocumentationRun = false; st.isVerificationRun = false; } } catch { /* ignore */ }
        try { window.codeonRunTelemetry?.clearRun?.({ sessionId: sessionIdForRun, requestId }); } catch { /* ignore */ }
        // Mark AI run completed (even on failure) to trigger post-run scan blackout
        try { if (typeof window.markAiRunCompletedForProblems === 'function') window.markAiRunCompletedForProblems(); } catch { /* ignore */ }

        const errObj = new Error(fullErrorText);
        errObj._uiShown = true;
        reject(errObj);
        return;
      }

      if (evt.type === 'error') {
        if (didFinalizeClaudeRun) return;
        didFinalizeClaudeRun = true;
        // NOTE: timeline teardown is DEFERRED until after we render the error into it
        // (see below), so the error is actually visible in the chat thread when the new
        // timeline is active instead of silently vanishing.

        const errTextRaw = evt.error || 'Claude SDK error';
        const errText = String(errTextRaw || '').trim() || 'Claude SDK error';
        const missingId = parseClaudeMissingConversationId(errText);
        const missingAnchorUuid = parseClaudeMissingResumeAnchorUuid(errText);
        // Important: some SDK versions surface the real API failure only in the assistant text
        // (e.g. "API Error: 400 ... Invalid data in redacted_thinking block") while `evt.error`
        // is a generic "unknown". Use both channels for detection.
        const _invalidThinkingDetectText = (() => {
          try {
            const parts = [];
            if (errText) parts.push(errText);
            const p = String(runState?.stream?.text || lastAssistantFullText || streamedContent || '').trim();
            if (p) parts.push(p);
            return parts.join('\n\n');
          } catch {
            return errText;
          }
        })();
        const invalidThinkingTag =
          (!missingId && !missingAnchorUuid && typeof parseClaudeInvalidRedactedThinkingBlock === 'function')
            ? parseClaudeInvalidRedactedThinkingBlock(_invalidThinkingDetectText)
            : null;

        if (missingId) {
          // Recoverable edge case: resume pointer points to a conversation that no longer exists.
          // Clear local resume state so the next run (or Retry button) starts fresh.
          clearClaudeResumeStateForSession(sessionIdForRun);
          try { addClaudeMissingConversationRecoveryCard(sessionIdForRun, missingId); } catch { /* ignore */ }
        }
        if (!missingId && missingAnchorUuid) {
          // Recoverable edge case: resumeSessionAt points to a message UUID that no longer exists.
          // Keep sessionId, but drop the resume-at anchor so the user can retry without rewinding.
          clearClaudeResumeAnchorForSession(sessionIdForRun);
          try { addClaudeMissingResumeAnchorRecoveryCard(sessionIdForRun, missingAnchorUuid); } catch { /* ignore */ }
        }
        if (!missingId && !missingAnchorUuid && invalidThinkingTag) {
          // Recoverable edge case: Claude/Anthropic refused resumed history due to malformed thinking blocks.
          // Force a fresh session for this chat.
          clearClaudeResumeStateForSession(sessionIdForRun);
          try { addClaudeInvalidThinkingRecoveryCard(sessionIdForRun, { errorText: errText }); } catch { /* ignore */ }
        }

        // Finalize whatever we have (prevents an empty/blank assistant bubble).
        const partial = String(runState?.stream?.text || lastAssistantFullText || streamedContent || '').trim();
        const finalContent = missingId
          ? (
              partial
                ? `${partial}\n\n---\n\n**Claude session lost**\n\nClaude could not resume the previous conversation.\n\nClick **Retry (new session)** below.`
                : `**Claude session lost**\n\nClaude could not resume the previous conversation.\n\nClick **Retry (new session)** below.`
            )
          : (missingAnchorUuid
              ? (
                  partial
                    ? `${partial}\n\n---\n\n**Claude rewind anchor missing**\n\nClaude could not resume from the requested message UUID.\n\nClick **Retry** below to continue without rewinding.`
                    : `**Claude rewind anchor missing**\n\nClaude could not resume from the requested message UUID.\n\nClick **Retry** below to continue without rewinding.`
                )
              : (invalidThinkingTag
                  ? (
                      partial
                        ? `${partial}\n\n---\n\n**Claude session corrupted**\n\nClaude could not resume this chat due to an internal “thinking” history error.\n\nClick **Retry (new session)** below.`
                        : `**Claude session corrupted**\n\nClaude could not resume this chat due to an internal “thinking” history error.\n\nClick **Retry (new session)** below.`
                    )
              : (
                  partial
                    ? `${partial}\n\n---\n\n**Error**\n\n${errText}`
                    : `**Error**\n\n${errText}`
                )));

        // Render the error into the active timeline bubble BEFORE tearing it down,
        // otherwise it never shows up in the chat thread when the new timeline is active.
        if (!_isLearningRequest) {
          try {
            if (window._usingNewTimeline && window._usingNewTimeline.has(requestId) && window.TimelineIntegration) {
              if (typeof window.TimelineIntegration.injectFinalText === 'function') {
                window.TimelineIntegration.injectFinalText(requestId, finalContent, { force: true });
              }
              if (typeof window.TimelineIntegration.finalizeTimeline === 'function') {
                window.TimelineIntegration.finalizeTimeline(requestId, sessionIdForRun);
              }
            }
          } catch { /* ignore */ }
          try { finalizeStreamingDiv(finalContent); } catch { /* ignore */ }
        }
        // Now tear down the timeline/buffers for this request.
        try {
          if (window.TimelineIntegration && typeof window.TimelineIntegration.cleanupTimeline === 'function') {
            window.TimelineIntegration.cleanupTimeline(requestId);
          }
          if (window._contentBlockTimelines) window._contentBlockTimelines.delete(requestId);
          if (window._usingNewTimeline) window._usingNewTimeline.delete(requestId);
        } catch { /* ignore */ }
        try {
          if (!_isLearningRequest) updateRunAssistantMessage(sessionIdForRun, requestId, {
            content: String(partial || ''),
            streaming: false,
            interrupted: true,
            updatedAt: Date.now()
          });
        } catch { /* ignore */ }

        // Persist diff previews captured so far.
        // SKIP for learning requests - learning content should only appear in the Learning panel
        if (!_isLearningRequest) {
        try { await flushStreamDiffBlocksToHistory(sessionIdForRun); } catch { /* ignore */ }
        }
        try { clearAssistantPartialSnapshot(sessionIdForRun); } catch { /* ignore */ }

        claudeSdkHandlers.delete(requestId);
        try { const st = getRunState(sessionIdForRun); if (st) { st.requestId = null; st.isLearningRun = false; st.isDocumentationRun = false; st.isVerificationRun = false; } } catch { /* ignore */ }
        try { if (runState) resetStreamBuffer(sessionIdForRun); } catch { /* ignore */ }
        setProcessingState(false, sessionIdForRun);
        try { window.codeonRunTelemetry?.clearRun?.({ sessionId: sessionIdForRun, requestId }); } catch { /* ignore */ }
        try { await clearStreamJournal(sessionIdForRun); } catch { /* ignore */ }
        // Mark AI run completed (even on error) to trigger post-run scan blackout
        try { if (typeof window.markAiRunCompletedForProblems === 'function') window.markAiRunCompletedForProblems(); } catch { /* ignore */ }

        if (shouldSuppressClaudeTechnicalErrors() && isAuthOrRuntimeSetupError(errText)) {
          openAuthGateModal({
            statusText: 'Sign in required',
            subtitleText: 'Click “Sign in with Claude.ai” to set up login, then try again.'
          });
          window.addConsoleMessage?.('Claude sign-in required. Click “Sign in with Claude.ai” in the popup.', 'error', sessionIdForRun);
          addSystemMessage('⚠️ Claude sign-in required. Click “Sign in with Claude.ai” to continue.', true, { sessionId: sessionIdForRun });
          const errObj2 = new Error('Claude sign-in required');
          errObj2._uiShown = true;
          reject(errObj2);
          return;
        }
        if (!missingId && !missingAnchorUuid && !invalidThinkingTag) {
          window.addConsoleMessage?.(`Claude error: ${errText}`, 'error', sessionIdForRun);
          addSystemMessage(`❌ Claude error: ${errText}`, true, { sessionId: sessionIdForRun });
        } else if (missingId) {
          window.addConsoleMessage?.(`Claude session not found; cleared stored session and offered retry. (${missingId})`, 'error', sessionIdForRun);
          addSystemMessage(`⚠️ Claude session not found. Cleared stored session; you can retry with a fresh session.`, true, { sessionId: sessionIdForRun });
        } else if (missingAnchorUuid) {
          window.addConsoleMessage?.(`Claude rewind anchor not found; cleared resume-at pointer and offered retry. (${missingAnchorUuid})`, 'error', sessionIdForRun);
          addSystemMessage(`⚠️ Claude rewind anchor not found. Cleared resume-at pointer; you can retry.`, true, { sessionId: sessionIdForRun });
        } else if (invalidThinkingTag) {
          window.addConsoleMessage?.(`Claude session corrupted by thinking history; cleared stored session and offered retry.`, 'error', sessionIdForRun);
          addSystemMessage(`⚠️ Claude session corrupted (thinking history). Cleared stored session; retry with a fresh session.`, true, { sessionId: sessionIdForRun });
        }

        // Offer Retry for transient failures (offline/network/server hiccups).
        try {
          if (!missingId && !missingAnchorUuid && sessionIdForRun === currentSessionId) {
            const info = classifyClaudeTransientFailure(errText);
            // Don't offer retry for auth/setup gating errors (we show the auth gate modal instead).
            if (info && !(shouldSuppressClaudeTechnicalErrors() && isAuthOrRuntimeSetupError(errText))) {
              const retryAfterSeconds = parseRetryAfterSecondsFromText(errText);
              const diag = (() => {
                try {
                  return window.codeonClaudeDiagnostics?.buildClaudeDiagnosticsPayload?.({
                    sessionId: sessionIdForRun,
                    requestId,
                    kind: info.kind,
                    failureLabel: info.kind,
                    errorText: errText,
                    permissionDenials: [],
                    settings,
                    workspaceRoot: currentFolder || null
                  }) || null;
                } catch { return null; }
              })();
              addClaudeTransientRetryCard(sessionIdForRun, {
                title: info.title,
                subtitle: info.subtitle,
                errorText: errText,
                retryAfterSeconds,
                kind: info.kind,
                requestId: typeof requestId === 'string' ? requestId : null,
                diagnostics: diag
              });
              if (info.kind === 'rate_limit' && retryAfterSeconds && retryAfterSeconds > 0) {
                claudeGlobalBackoffUntilMs = Math.max(claudeGlobalBackoffUntilMs, Date.now() + (retryAfterSeconds * 1000));
              }
            }
          }
        } catch { /* ignore */ }

        const errObj = new Error(errText);
        errObj._uiShown = true;
        reject(errObj);
      }

      // MCP status events (debug visibility so users trust MCP wiring)
      // SDK 0.2.x adds per-server `error` field for failed connections
      if (evt && evt.type === 'mcp_status') {
        try {
          const sid = evt.sessionId || sessionIdForRun;
          const err = evt.error ? String(evt.error) : '';
          if (err) {
            window.addConsoleMessage?.(`MCP status error: ${err}`, 'error', sid);
          } else {
            const serversAny = evt.mcpServers;
            const names = [];
            const errors = [];
            try {
              if (Array.isArray(serversAny)) {
                for (const s of serversAny) {
                  const name = String(s?.name || '').trim();
                  if (name) names.push(name);
                  // SDK 0.2.x: check for per-server error field
                  if (s?.error) {
                    errors.push(`${name || 'unknown'}: ${String(s.error)}`);
                  }
                }
              } else if (serversAny && typeof serversAny === 'object') {
                // Some SDKs may return a map keyed by server name.
                for (const [k, v] of Object.entries(serversAny)) {
                  const name = String(k || '').trim();
                  if (name) names.push(name);
                  if (v?.error) {
                    errors.push(`${name}: ${String(v.error)}`);
                  }
                }
              }
            } catch { /* ignore */ }
            window.addConsoleMessage?.(`MCP servers (Claude Code): ${names.length ? names.join(', ') : 'none'}`, 'info', sid);
            // Surface per-server errors (new in SDK 0.2.x)
            if (errors.length > 0) {
              for (const errMsg of errors) {
                window.addConsoleMessage?.(`MCP server error: ${errMsg}`, 'error', sid);
              }
            }
          }
        } catch { /* ignore */ }
      }

      if (evt && evt.type === 'mcp_set_servers') {
        try {
          const sid = evt.sessionId || sessionIdForRun;
          if (evt.error) {
            window.addConsoleMessage?.(`MCP set servers error: ${String(evt.error)}`, 'error', sid);
          }
        } catch { /* ignore */ }
      }
    });
  });

  // Wire cancellation from the existing AbortController path
  if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', async () => {
      try {
        await window.electronAPI.claudeSdkCancel(requestId);
      } catch {
        // ignore
      }
    }, { once: true });
  }

  // Determine auth for this run:
  // - api_key: use the configured API key
  // - claude_ai: force keyless flow (Claude.ai OAuth / stored auth)
  const apiKeyForRun =
    effectiveAuthMode === 'claude_ai'
      ? ''
      : (hasApiKey ? String(settings.apiKey || '') : '');

  // Claude Code semantics:
  // - Skills are discovered/loaded by Claude Code (via SKILL.md) and applied via progressive disclosure.
  // - Subagents are managed by Claude Code (/agent) and invoked automatically or explicitly.
  //
  // We therefore DO NOT inject skill/agent instructions into the prompt.

  // Pause-before-next-tool can be pre-enabled (applies at run start).
  try {
    const wantPause = !!(window._pauseBeforeNextToolBySession && window._pauseBeforeNextToolBySession[sessionIdForRun] === true);
    if (wantPause && window.electronAPI && typeof window.electronAPI.claudeSdkSetRunControl === 'function') {
      await window.electronAPI.claudeSdkSetRunControl({ requestId, uiSessionId: sessionIdForRun, pauseBeforeNextTool: true });
    }
    try { _syncAetPauseButtonUI(sessionIdForRun); } catch { /* ignore */ }
  } catch { /* ignore */ }

  // Context Inspector: capture exactly what we send to the Claude SDK at run start (redacted).
  try {
    const networkMode = (settings && typeof settings.networkPolicyMode === 'string') ? settings.networkPolicyMode : 'allow_all';
    const allowlist = Array.isArray(settings && settings.networkAllowlist) ? settings.networkAllowlist : [];
    const maxBudgetUsd = (() => {
      try {
        const v = settings && typeof settings.maxBudgetUsd !== 'undefined' ? Number(settings.maxBudgetUsd) : 0;
        return (Number.isFinite(v) && v > 0) ? v : null;
      } catch {
        return null;
      }
    })();

    // Ensure permission mode reflects the composer selector at send time.
    try {
      const permissionModeComposerInput = document.getElementById('permissionModeComposerInput');
      if (permissionModeComposerInput) {
        const raw = String(permissionModeComposerInput.value || '').trim().toLowerCase();
        const allowed = new Set(['plan', 'default', 'acceptedits', 'bypasspermissions']);
        if (allowed.has(raw)) {
          const normalized = raw === 'acceptedits' ? 'acceptEdits' : (raw === 'bypasspermissions' ? 'bypassPermissions' : raw);
          const prevMode = (settings && typeof settings.permissionMode === 'string') ? settings.permissionMode : '';
          settings.permissionMode = normalized;
          if (normalized !== 'plan') settings.lastNonPlanPermissionMode = normalized;
          else if (prevMode && prevMode !== 'plan') settings.lastNonPlanPermissionMode = prevMode;
          try {
            const permissionModeInput = document.getElementById('permissionModeInput');
            if (permissionModeInput) permissionModeInput.value = normalized;
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    window.codeonContextSnapshots?.record?.({
      sessionId: sessionIdForRun,
      requestId,
      prompt: {
        userMessage: String(userMessage || ''),
        effectivePrompt: String(effectivePrompt || '')
      },
      attachments: Array.isArray(savedAttachments) ? savedAttachments.map(a => ({
        relPath: String(a?.relPath || ''),
        kind: a?.kind ? String(a.kind) : null
      })) : [],
      claudeSdkStart: {
        requestId,
        uiSessionId: sessionIdForRun,
        promptLength: String(effectivePrompt || '').length,
        permissionMode: (settings && typeof settings.permissionMode === 'string' ? settings.permissionMode : 'acceptEdits'),
        networkPolicySummary: `${networkMode}${allowlist.length ? ` (${allowlist.length} allowlist)` : ''}`,
        model: (settings && typeof settings.claudeModel === 'string') ? settings.claudeModel : '',
        maxBudgetUsd,
        authMode: String(effectiveAuthMode || ''),
        apiKeyPresent: !!(apiKeyForRun && String(apiKeyForRun).trim()),
        resumeSessionId: resumeSessionId || null,
        resumeSessionAt: resumeSessionAt || null,
        forkSession: !!forkSession
      }
    });
  } catch { /* ignore */ }

  const startRes = await window.electronAPI.claudeSdkStart({
    requestId,
    uiSessionId: sessionIdForRun,
    aetParentRunId: (options && typeof options.aetParentRunId === 'string') ? options.aetParentRunId : null,
    aetParentNodeId: (options && typeof options.aetParentNodeId === 'string') ? options.aetParentNodeId : null,
    aetIntervention: (options && typeof options.aetIntervention === 'object') ? options.aetIntervention : null,
    restoreCheckpointHash: (() => {
      try {
        const st = getRunState(sessionIdForRun);
        return st && st.processCommitHash ? String(st.processCommitHash) : null;
      } catch {
        return null;
      }
    })(),
    prompt: effectivePrompt,
    apiKey: apiKeyForRun,
    model: (settings && typeof settings.claudeModel === 'string') ? settings.claudeModel : '',
    // OpenRouter provider settings (use llmProvider to determine if OpenRouter is active)
    useOpenRouter: settings && settings.llmProvider === 'openrouter',
    openrouterApiKey: (settings && typeof settings.openrouterApiKey === 'string') ? settings.openrouterApiKey : '',
    openrouterModel: (settings && typeof settings.openrouterModel === 'string') ? settings.openrouterModel : '',
    // Codex (ChatGPT-subscription) provider settings
    useCodex: settings && settings.llmProvider === 'codex',
    codexModel: (settings && typeof settings.codexModel === 'string') ? settings.codexModel : '',
    permissionMode: (settings && typeof settings.permissionMode === 'string' ? settings.permissionMode : 'acceptEdits'),
    resumePermissionMode: (settings && typeof settings.lastNonPlanPermissionMode === 'string' && settings.lastNonPlanPermissionMode.trim())
      ? settings.lastNonPlanPermissionMode
      : 'acceptEdits',
    networkPolicy: {
      mode: (settings && typeof settings.networkPolicyMode === 'string') ? settings.networkPolicyMode : 'allow_all',
      allowlist: Array.isArray(settings && settings.networkAllowlist) ? settings.networkAllowlist : []
    },
    maxBudgetUsd: (() => {
      try {
        const v = settings && typeof settings.maxBudgetUsd !== 'undefined' ? Number(settings.maxBudgetUsd) : 0;
        return (Number.isFinite(v) && v > 0) ? v : null;
      } catch {
        return null;
      }
    })(),
    resumeSessionId,
    resumeSessionAt,
    forkSession,
    debugLog: true
  });

  // Flush queued milestones now that the main process debug logger is created.
  try {
    _dbgReady = true;
    for (const item of _dbgQueue.splice(0)) {
      _dbgSend(requestId, item.kind, { ...(item.data || {}), _at: item.at });
    }
  } catch { /* ignore */ }
  try { _dbg('renderer_after_claudeSdkStart', { startRes: startRes && typeof startRes === 'object' ? { success: startRes.success === true, debugLogPath: startRes.debugLogPath || null } : null }); } catch { /* ignore */ }

  if (!startRes || startRes.success !== true) {
    claudeSdkHandlers.delete(requestId);
        try { const st = getRunState(sessionIdForRun); if (st) { st.requestId = null; st.isLearningRun = false; st.isDocumentationRun = false; st.isVerificationRun = false; } } catch { /* ignore */ }
    try { const st = getRunState(sessionIdForRun); if (st) { st.requestId = null; st.isLearningRun = false; st.isDocumentationRun = false; st.isVerificationRun = false; } } catch { /* ignore */ }
    const errText = String(startRes?.error || 'Failed to start Claude SDK query');
    const missingId = parseClaudeMissingConversationId(errText);
    const missingAnchorUuid = parseClaudeMissingResumeAnchorUuid(errText);
    const invalidThinkingTag =
      (!missingId && !missingAnchorUuid && typeof parseClaudeInvalidRedactedThinkingBlock === 'function')
        ? parseClaudeInvalidRedactedThinkingBlock(errText)
        : null;
    if (missingId) {
      clearClaudeResumeStateForSession(sessionIdForRun);
      try { addClaudeMissingConversationRecoveryCard(sessionIdForRun, missingId); } catch { /* ignore */ }
      const e = new Error(errText);
      e._uiShown = true;
      throw e;
    }
    if (!missingId && missingAnchorUuid) {
      clearClaudeResumeAnchorForSession(sessionIdForRun);
      try { addClaudeMissingResumeAnchorRecoveryCard(sessionIdForRun, missingAnchorUuid); } catch { /* ignore */ }
      const e = new Error(errText);
      e._uiShown = true;
      throw e;
    }
    if (!missingId && !missingAnchorUuid && invalidThinkingTag) {
      clearClaudeResumeStateForSession(sessionIdForRun);
      try { addClaudeInvalidThinkingRecoveryCard(sessionIdForRun, { errorText: errText }); } catch { /* ignore */ }
      const e = new Error(errText);
      e._uiShown = true;
      throw e;
    }
    throw new Error(errText);
  }

  // Only create the streaming bubble if we're still on the originating session tab.
  ensureStreamingDiv();
  return await donePromise;
}
