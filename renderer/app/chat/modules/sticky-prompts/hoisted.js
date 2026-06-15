// ---- GENERATED: hoisted declarations extracted from app/chat/sticky-prompts.js ----
function getLastChatTurn(messagesContainer) {
  if (!messagesContainer) return null;
  try {
    const direct = messagesContainer.querySelectorAll(':scope > .chat-turn');
    if (direct && direct.length) return direct[direct.length - 1];
  } catch { /* ignore */ }
  try {
    const turns = messagesContainer.querySelectorAll('.chat-turn');
    return turns && turns.length ? turns[turns.length - 1] : null;
  } catch {
    return null;
  }
}


function appendChatNode(messagesContainer, node, { roleHint = '' } = {}) {
  if (!messagesContainer || !node) return;
  const role = String(roleHint || '').trim();

  // A new user message always starts a new "turn" container.
  if (role === 'user') {
    const turn = document.createElement('div');
    turn.className = 'chat-turn';
    messagesContainer.appendChild(turn);
    turn.appendChild(node);
    return;
  }

  // Otherwise, append to the most recent turn if it exists; fallback to root.
  const turn = getLastChatTurn(messagesContainer);
  if (turn) turn.appendChild(node);
  else messagesContainer.appendChild(node);
}


/**
 * Create a timeline-style block for system_action messages (pause, lock, unlock, resume, etc.)
 * Returns the DOM element or null if fallback to card style is needed.
 */
function _createSystemActionTimelineBlock(content, msgId) {
  if (!content || typeof content !== 'string') return null;
  
  // Parse the action type and text from the content
  // Format examples: "⏸ Pause-before-next-tool enabled", "▶️ Pause-before-next-tool disabled"
  // "🔒 Locked file: `path`", "🔓 Unlocked file: `path`", "⏩ Resume from node: **title**"
  const isPauseEnabled = content.includes('Pause-before-next-tool enabled');
  const isPauseDisabled = content.includes('Pause-before-next-tool disabled');
  const isLock = content.includes('Locked file') || (content.includes('Locked ') && content.includes('file'));
  const isUnlock = content.includes('Unlocked file') || (content.includes('Unlocked ') && content.includes('file'));
  const isResume = content.includes('Resume from node');
  const isBlocked = content.includes('Blocked edit');
  
  // Determine action label and detail text
  let actionLabel = '';
  let actionDetail = '';
  let bulletClass = 'cc-success'; // green bullet default
  
  if (isPauseEnabled) {
    actionLabel = 'Pause';
    actionDetail = 'Pause-before-next-tool enabled';
    bulletClass = 'cc-warning'; // amber/yellow for pause
  } else if (isPauseDisabled) {
    actionLabel = 'Resume';
    actionDetail = 'Pause-before-next-tool disabled';
    bulletClass = 'cc-success'; // green for resume
  } else if (isLock) {
    actionLabel = 'Lock';
    // Extract file path from content like "🔒 Locked file: `path`"
    const match = content.match(/`([^`]+)`/);
    actionDetail = match ? match[1] : content.replace(/^[^\s]+\s*/, '').replace(/`/g, '');
    bulletClass = 'cc-warning';
  } else if (isUnlock) {
    actionLabel = 'Unlock';
    const match = content.match(/`([^`]+)`/);
    actionDetail = match ? match[1] : content.replace(/^[^\s]+\s*/, '').replace(/`/g, '');
    bulletClass = 'cc-success';
  } else if (isResume) {
    actionLabel = 'Resume';
    // Extract node title from content like "⏩ Resume from node: **title**"
    const match = content.match(/\*\*([^*]+)\*\*/);
    actionDetail = match ? match[1] : content.replace(/^[^\s]+\s*/, '');
    bulletClass = 'cc-success';
  } else if (isBlocked) {
    actionLabel = 'Blocked';
    const match = content.match(/`([^`]+)`/);
    actionDetail = match ? match[1] : 'Edit blocked due to lock';
    bulletClass = 'cc-error'; // red for blocked
  } else {
    // Unknown action type - return null to fallback to card style
    return null;
  }
  
  // Create timeline-style block
  const blockDiv = document.createElement('div');
  blockDiv.className = `cc-content-block ${bulletClass}`;
  blockDiv.dataset.blockType = 'action';
  if (msgId) blockDiv.id = msgId;
  
  // Build inner HTML similar to tool blocks
  let innerHtml = '<div class="cc-action-block"><div class="cc-action-header">';
  innerHtml += `<span class="cc-action-name">${escapeHtml(actionLabel)}</span>`;
  if (actionDetail) {
    innerHtml += `<span class="cc-action-detail">${escapeHtml(actionDetail)}</span>`;
  }
  innerHtml += '</div></div>';
  
  blockDiv.innerHTML = innerHtml;
  return blockDiv;
}


function buildMessageAttachmentsElement(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) return null;

  const attachmentsDiv = document.createElement('div');
  attachmentsDiv.className = 'message-attachments';

  list.forEach(attachment => {
    const ctRaw = attachment && typeof attachment.contentType === 'string' ? attachment.contentType : '';
    const ct = String(ctRaw || '').trim();
    const isWorkspaceFolder = ct === 'workspace_folder';
    const isWorkspaceFile = ct === 'workspace_file' || (!ct && typeof attachment?.workspacePath === 'string' && attachment.workspacePath.trim());
    const isProblemContext = ct === 'problem_context';
    const isPastedCode = ct === 'pasted_code';

    const attachmentEl = document.createElement('div');
    attachmentEl.className = `message-attachment ${ct || ''}`;

    if (ct === 'image' && attachment.dataUrl) {
      // Build DOM directly (avoid innerHTML injection) and validate URL scheme.
      const url = String(attachment.dataUrl || '').trim();
      const name = String(attachment.name || '').trim();
      const img = document.createElement('img');
      img.alt = name;
      img.title = name;
      if (/^data:image\//i.test(url) || /^blob:/i.test(url)) {
        img.src = url;
        img.addEventListener('click', () => {
          try {
            if (typeof openLightbox === 'function') openLightbox(url);
            else window.open(url, '_blank');
          } catch { /* ignore */ }
        });
      } else {
        // Unsafe scheme; show a placeholder label instead of trying to render.
        img.alt = name || 'Image';
      }
      try { attachmentEl.replaceChildren(img); } catch { attachmentEl.appendChild(img); }
    } else if (ct === 'pdf') {
      attachmentEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>${escapeHtml(attachment.name)}</span>
      `;
    } else if (isWorkspaceFolder) {
      const display = (typeof attachment.workspacePath === 'string' && attachment.workspacePath.trim())
        ? String(attachment.workspacePath).trim()
        : String(attachment.name || '').trim();
      attachmentEl.innerHTML = `
        <div class="message-attachment-pill-row">
          <span class="message-attachment-pill-badge">Folder</span>
          <span class="message-attachment-pill-name" title="${escapeAttr(display)}">${escapeHtml(display)}</span>
        </div>
      `;
      attachmentEl.classList.add('pill');
    } else if (isWorkspaceFile) {
      const display = (typeof attachment.workspacePath === 'string' && attachment.workspacePath.trim())
        ? String(attachment.workspacePath).trim()
        : String(attachment.name || '').trim();
      attachmentEl.innerHTML = `
        <div class="message-attachment-pill-row">
          <span class="message-attachment-pill-badge">File</span>
          <span class="message-attachment-pill-name" title="${escapeAttr(display)}">${escapeHtml(display)}</span>
        </div>
      `;
      attachmentEl.classList.add('pill');
    } else if (isProblemContext) {
      attachmentEl.innerHTML = `
        <div class="message-attachment-pill-row">
          <span class="message-attachment-pill-badge">Context</span>
          <span class="message-attachment-pill-name" title="${escapeAttr(attachment.name)}">${escapeHtml(attachment.name)}</span>
        </div>
      `;
      attachmentEl.classList.add('pill');
    } else if (isPastedCode) {
      attachmentEl.innerHTML = `
        <div class="message-attachment-pill-row">
          <span class="message-attachment-pill-badge">Code</span>
          <span class="message-attachment-pill-name" title="${escapeAttr(attachment.name)}">${escapeHtml(attachment.name)}</span>
        </div>
      `;
      attachmentEl.classList.add('pill');
    } else {
      attachmentEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <span>${escapeHtml(attachment.name)}</span>
      `;
    }

    attachmentsDiv.appendChild(attachmentEl);
  });

  return attachmentsDiv;
}


function wireUserMessageCollapse(messageDiv) {
  if (!messageDiv) return;
  try {
    if (!messageDiv.classList.contains('user')) return;
    const contentEl = messageDiv.querySelector('.message-content');
    const textEl = messageDiv.querySelector('.message-text');
    if (!contentEl || !textEl) return;

    // Avoid double-binding on re-render.
    if (messageDiv.dataset.userCollapseWired === '1') return;
    messageDiv.dataset.userCollapseWired = '1';

    const rawText = String(textEl.textContent || '').trim();
    if (!rawText) return;

    // Create toggle button (hidden unless overflowing).
    const bar = document.createElement('div');
    bar.className = 'user-expand-bar';
    const btn = document.createElement('button');
    btn.className = 'user-expand-toggle';
    btn.type = 'button';
    btn.title = 'Expand/collapse message';
    btn.textContent = '⌄';
    bar.appendChild(btn);
    contentEl.appendChild(bar);

    const setExpanded = (expanded) => {
      const isExpanded = !!expanded;
      messageDiv.classList.toggle('is-expanded', isExpanded);
      textEl.classList.toggle('is-collapsed', !isExpanded);
    };

    // Default collapsed initially; we'll remove it if not needed.
    setExpanded(false);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isExpanded = messageDiv.classList.contains('is-expanded');
      setExpanded(!isExpanded);
    });

    // Determine if clamping is necessary.
    const measure = () => {
      try {
        // Height when collapsed
        setExpanded(false);
        const collapsedH = textEl.getBoundingClientRect().height;

        // Height when expanded (full)
        setExpanded(true);
        const fullH = textEl.getBoundingClientRect().height;

        const needs = fullH > collapsedH + 2;
        if (!needs) {
          // Not long enough; leave expanded and hide toggle bar
          messageDiv.classList.remove('is-collapsible');
          setExpanded(true);
          return;
        }

        // Long message; show toggle bar and revert to collapsed default
        messageDiv.classList.add('is-collapsible');
        setExpanded(false);
      } catch {
        // ignore
      }
    };

    // Wait for layout to settle.
    requestAnimationFrame(() => requestAnimationFrame(measure));
  } catch {
    // ignore
  }
}


function removeTurnAndFollowingFromMessage(messageElement) {
  if (!messageElement) return;
  try {
    const turn = messageElement.closest('.chat-turn');
    if (turn && turn.parentElement) {
      let cur = turn;
      while (cur) {
        const next = cur.nextElementSibling;
        cur.remove();
        cur = next;
      }
      return;
    }
  } catch { /* ignore */ }

  // Fallback (older flat layout): remove this node and following siblings.
  try {
    let cur = messageElement;
    while (cur) {
      const next = cur.nextElementSibling;
      cur.remove();
      cur = next;
    }
  } catch { /* ignore */ }
}


function addMessage(role, content, id = null, restoreHash = null, save = true, attachments = [], skills = []) {
  const messagesContainer = document.getElementById('chatMessages');
  // Safety: make sure chatHistory belongs to the current session before reading/appending.
  ensureHydratedChatHistoryForCurrentSession('addMessage');
  ensureMessageSeqInitialized(currentSessionId);
  const hadPriorUserMessage = role === 'user' ? chatHistory.some(m => m && m.role === 'user') : false;

  // Remove welcome message if present
  const welcome = messagesContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  // Don't create bubble if there is no content and no attachments (and not an error)
  // This prevents "empty bubbles" after reasoning cards
  if (!content && (!attachments || attachments.length === 0)) {
    return;
  }

  // Also check if content is only whitespace
  if (typeof content === 'string' && content.trim().length === 0 && (!attachments || attachments.length === 0)) {
    return;
  }

  // Handle system_action messages as timeline items (not card bubbles)
  if (role === 'system_action') {
    const contentStr = String(content || '');
    const timelineBlock = _createSystemActionTimelineBlock(contentStr, id);
    if (timelineBlock) {
      appendChatNode(messagesContainer, timelineBlock, { roleHint: 'assistant' });
      smartScrollToBottom(messagesContainer, { force: false });
      // Add to history
      chatHistory.push({
        role,
        content: contentStr,
        id,
        timestamp: Date.now(),
        seq: nextMessageSeq(currentSessionId)
      });
      if (save) saveChatHistory();
      return;
    }
    // Fallback to card style if timeline block couldn't be created
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  if (role === 'user') messageDiv.classList.add('sticky-message');
  if (id) messageDiv.id = id;
  // Persist checkpoint hash on the DOM node so AET <-> Chat can stay strongly coupled.
  // (Used to locate the exact user message when restoring from AET nodes.)
  if (role === 'user' && restoreHash) {
    try { messageDiv.dataset.commitHash = String(restoreHash || '').trim(); } catch { /* ignore */ }
  }

  const messageContentDiv = document.createElement('div');
  messageContentDiv.className = 'message-content';

  // Sticky prompt UX: keep *all* user attachments inside the bubble so they don't overlap other messages while sticky.
  // Also render them ABOVE the message text.
  if (role === 'user') {
    const attachmentsEl = buildMessageAttachmentsElement(attachments);
    if (attachmentsEl) messageContentDiv.appendChild(attachmentsEl);
  }

  const textDiv = document.createElement('div');
  textDiv.className = 'message-text';
  textDiv.innerHTML = formatMessage(content);
  messageContentDiv.appendChild(textDiv);

  messageDiv.appendChild(messageContentDiv);

  // Add Restore Button to User Messages
  if (role === 'user' && restoreHash) {
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'restore-btn restore-btn--icon restore-btn--float';
    restoreBtn.title = 'Restore to this checkpoint';
    restoreBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
        <path d="M3 3v5h5"></path>
      </svg>
    `;
    restoreBtn.onclick = () => restoreToUserCheckpoint(restoreHash, messageDiv, content, attachments);
    messageDiv.appendChild(restoreBtn);
  }

  appendChatNode(messagesContainer, messageDiv, { roleHint: role });
  if (role === 'user') {
    wireUserMessageCollapse(messageDiv);
  }

  // Add action buttons to code blocks if this is an AI message
  if (role === 'assistant') {
    addCodeBlockActions(messageDiv);
  }

  // Auto-scroll only if user is following the stream; force after sending a message.
  smartScrollToBottom(messagesContainer, { force: role === 'user' });

  // Add to history (with attachments)
  // CRITICAL: Do NOT truncate user messages here. We need the full content for the API.
  // Truncation should only happen when selecting *historical* context for the prompt,
  // but the primary (latest) message must be intact.
  chatHistory.push({ 
    role, 
    content: content, // ✅ Full content (truncation handled in prompt generation if needed)
    id, 
    commitHash: restoreHash, 
    attachments,
    skills: Array.isArray(skills) ? skills : [],
    timestamp: Date.now(),
    seq: nextMessageSeq(currentSessionId),
    // Linkage to Claude Code rewind/resume features:
    // For user messages, record the last assistant UUID *before* this user turn, so we can resume from that point.
    ...(role === 'user' && currentSessionId ? { claudeResumeFrom: (getClaudeSessionMeta(currentSessionId)?.lastAssistantUuid || null) } : {})
  });

  // Auto-name tab from the first user message (instead of Chat 1 / Chat 2…)
  if (
    role === 'user' &&
    !hadPriorUserMessage &&
    currentSessionId &&
    chatSessions[currentSessionId] &&
    isDefaultSessionName(chatSessions[currentSessionId].name)
  ) {
    const derived = deriveSessionTitleFromMessage(content, attachments);
    chatSessions[currentSessionId].name = makeUniqueSessionName(derived, currentSessionId);
    renderChatTabs();
    renderChatDropdown();
  }
  // Cursor-like: keep auto-named sessions meaningful (handles placeholder first messages).
  try {
    const sid = currentSessionId;
    if (role === 'user' && sid && chatSessions && chatSessions[sid] && chatSessions[sid].autoName !== false) {
      const res = window.codeonSessionTitles?.maybeAutoRenameSession?.({
        sessionId: sid,
        chatSessions,
        reason: 'user_message'
      });
      if (res && res.name && String(res.name).trim() && String(res.name).trim() !== String(chatSessions[sid].name || '').trim()) {
        chatSessions[sid].name = String(res.name).trim();
        // Keep in auto mode unless the user explicitly renames.
        if (typeof chatSessions[sid].autoName === 'undefined') chatSessions[sid].autoName = true;
        renderChatTabs();
        renderChatDropdown();
      }
    }
  } catch { /* ignore */ }

  if (save) saveChatHistory();
}


async function _ensureSafeForGlobalGitRestore({ actionTitle = 'Git Restore' } = {}) {
  try {
    if (!window.electronAPI) throw new Error('Missing electronAPI');

    // Block restores while git operations are in progress (merge/rebase/cherry-pick).
    const g = await getGitInProgressState();
    if (g && g.inProgress === true) {
      try {
        addGitOpRecoveryMessage(currentSessionId, {
          op: String(g.op || 'git'),
          conflictFiles: Array.isArray(g.conflictFiles) ? g.conflictFiles : [],
          beforeCommit: '',
          note: `Restore blocked: Git ${String(g.op || 'operation')} in progress. Resolve or abort first.`
        });
      } catch { /* ignore */ }

      const conflicts = Array.isArray(g.conflictFiles) ? g.conflictFiles.filter(Boolean).slice(0, 12) : [];
      const conflictText = conflicts.length
        ? `\n\nConflicts:\n- ${conflicts.join('\n- ')}${(Array.isArray(g.conflictFiles) && g.conflictFiles.length > 12) ? `\n- … (+${g.conflictFiles.length - 12} more)` : ''}`
        : '';
      await customAlert(
        `Cannot restore while Git ${String(g.op || 'operation')} is in progress.\n\nResolve conflicts (or abort the operation), then try again.${conflictText}`,
        actionTitle
      );
      return false;
    }

    // Git is global: stop *all* running sessions (including current) before restoring.
    const running = getRunningSessionIds({ exceptSessionId: null });
    if (running.length > 0) {
      const ok = await customConfirm(
        `A chat is currently running (${running.length}).\n\n` +
        `Restoring a checkpoint resets the entire workspace and will invalidate running runs.\n\n` +
        `Stop the running chat(s) and continue?`,
        actionTitle
      );
      if (!ok) return false;
      for (const sid of running) {
        await abortSessionRunNoRestore(sid, 'Stopped because you restored a checkpoint');
      }
    }

    return true;
  } catch (e) {
    await customAlert(`Restore preflight failed: ${e?.message || String(e)}`, actionTitle);
    return false;
  }
}


// Restore to a user checkpoint (Undo/Retry)
async function restoreToUserCheckpoint(commitHash, messageElement, content, attachments = [], skipConfirmation = false) {
  const matchesHash = (a, b) => {
    const x = String(a || '').trim();
    const y = String(b || '').trim();
    if (!x || !y) return false;
    return x === y || x.startsWith(y) || y.startsWith(x);
  };

  if (!skipConfirmation) {
    const confirmed = await customConfirm('Restore project to this state and retry?\n\nThis will:\n• Discard all changes after this point\n• Delete subsequent chat messages\n• Restore files to this checkpoint');

    if (!confirmed) {
      return;
    }
  }

  try {
    const ok = await _ensureSafeForGlobalGitRestore({ actionTitle: 'Git Restore' });
    if (!ok) return;

    // 1. Restore Git State (force checkout to discard local changes)

    const result = await withGitOperationLock(async () => {
      // First, stash any uncommitted changes
      await window.electronAPI.runTerminalCommand('git stash --include-untracked', true);

      // Then checkout the commit (force)
      const r = await window.electronAPI.runTerminalCommand(`git checkout -f ${commitHash}`, true);
      // Reset workspace to match checkpoint (remove all untracked + ignored files).
      await window.electronAPI.runTerminalCommand('git clean -fdx', true);
      // Avoid leaving the repo in detached HEAD (keeps subsequent checkpoints/commits consistent)
      await ensureGitOnMainBranch();
      return r;
    });

    if (!result.success) {
      await customAlert(`Failed to restore: ${result.error || result.output}`);
      return;
    }

    // Refresh the file tree to show restored state
    if (window.refreshFileTree) {
      await window.refreshFileTree();
    }

    // 2. Update UI
    // If messageElement is null (e.g. from Stop button), we need to find the last user message
    if (!messageElement) {
      try {
        // Prefer locating by checkpoint hash to keep Chat <-> AET coupled.
        const els = Array.from(document.querySelectorAll('.message.user[data-commit-hash]'));
        const matchEl = els.find((el) => matchesHash(el?.dataset?.commitHash, commitHash));
        if (matchEl) messageElement = matchEl;
      } catch { /* ignore */ }
      if (!messageElement) {
        const messages = Array.from(document.querySelectorAll('.message.user'));
        // With "Stop", we essentially want to undo the CURRENT request.
        // The current request is the LAST user message.
        messageElement = messages[messages.length - 1];
      }
    }

    if (messageElement) {
      removeTurnAndFollowingFromMessage(messageElement);
    }

    // 3. Update Chat History (Remove from array)
    // If content is null (from Stop), remove last user message and everything after
    let index = -1;
    if (content) {
      index = chatHistory.findIndex(m => m.content === content && m.role === 'user' && m.commitHash === commitHash);
    } else {
      // Prefer finding the user message that owns this checkpoint hash.
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        const m = chatHistory[i];
        if (!m || m.role !== 'user') continue;
        if (typeof m.commitHash === 'string' && matchesHash(m.commitHash, commitHash)) {
          index = i;
          break;
        }
      }
      // Fallback: last user message (Stop behavior)
      if (index === -1) {
        for (let i = chatHistory.length - 1; i >= 0; i--) {
          if (chatHistory[i].role === 'user') {
            index = i;
            break;
          }
        }
      }
    }

    if (index !== -1) {
      const _restoreMsg = chatHistory[index];
      if (!content && _restoreMsg && typeof _restoreMsg.content === 'string') {
        content = _restoreMsg.content; // Retrieve content for input population
      }
      if ((!attachments || !Array.isArray(attachments) || attachments.length === 0) && _restoreMsg && Array.isArray(_restoreMsg.attachments)) {
        attachments = _restoreMsg.attachments;
      }

      // Remove this message and everything after it
      chatHistory.splice(index);
      saveChatHistory();

      // Also discard any AET runs that happened after the restored point, so the Execution Timeline
      // does not keep showing "future" runs for this chat session.
      try {
        const projectPath = window.currentFolder ? String(window.currentFolder) : null;
        // Strong coupling: also truncate the run that contains this checkpoint node, so nodes after it disappear.
        if (projectPath && window.electronAPI) {
          let didTruncate = false;
          try {
            if (
              typeof window.electronAPI.executionTimelineLoadSession === 'function' &&
              typeof window.electronAPI.executionTimelineTruncateAfterNode === 'function'
            ) {
              const res = await window.electronAPI.executionTimelineLoadSession(projectPath, currentSessionId);
              const runs = (res && res.success === true && Array.isArray(res.runs)) ? res.runs : [];
              for (const r of runs) {
                const nodes = r && Array.isArray(r.nodes) ? r.nodes : [];
                const ck = nodes.find(n => matchesHash(n?.gitCheckpointHash || n?.payload?.commitHash, commitHash));
                if (ck && r && r.id && ck.id) {
                  await window.electronAPI.executionTimelineTruncateAfterNode(
                    projectPath,
                    currentSessionId,
                    String(r.id),
                    String(ck.id),
                    'Chat restore & retry'
                  );
                  didTruncate = true;
                  break;
                }
              }
            }
          } catch { /* ignore */ }
          // Fallback: discard later runs by timestamp if we couldn't locate the checkpoint node.
          if (!didTruncate && typeof window.electronAPI.executionTimelineDiscardAfter === 'function') {
            const cutoff = typeof _restoreMsg?.timestamp === 'number' && Number.isFinite(_restoreMsg.timestamp) ? _restoreMsg.timestamp : Date.now();
            await window.electronAPI.executionTimelineDiscardAfter(projectPath, currentSessionId, cutoff, 'Chat restore & retry');
          }
        }
        // Refresh in-memory AET runs (best-effort)
        try { if (currentSessionId) loadExecutionTimelineForSession(currentSessionId).catch(() => {}); } catch { /* ignore */ }
      } catch { /* ignore */ }
      
      // IMPORTANT: Also rewind Claude conversation context to match the restored point.
      // We do this by resuming the existing Claude session at the LAST kept Claude message UUID,
      // and forking to a new session so subsequent turns don't include the "discarded" messages.
      if (currentSessionId && chatSessions[currentSessionId]) {
        const meta = getClaudeSessionMeta(currentSessionId);
        if (meta) {
          // Find the last kept conversational message (user/assistant) that has a Claude UUID.
          let resumeAt = null;
          let resumeSessionIdForRestore = null;
          try {
            for (let i = chatHistory.length - 1; i >= 0; i--) {
              const m = chatHistory[i];
              if (!m) continue;
              if (m.role !== 'user' && m.role !== 'assistant') continue;
              const u = typeof m.claudeUuid === 'string' && m.claudeUuid.trim() ? m.claudeUuid.trim() : null;
              if (u) {
                resumeAt = u;
                const sid = typeof m.claudeSessionId === 'string' && m.claudeSessionId.trim() ? m.claudeSessionId.trim() : null;
                resumeSessionIdForRestore = sid;
                break;
              }
            }
          } catch { /* ignore */ }

          meta.pendingResumeAt = resumeAt;
          meta.forkOnNext = true;
          // If we don't have a resume point (e.g. restoring to before the first turn), clear session so we start fresh.
          // If we do have a resume point, ensure we also restore the correct Claude session id that produced it.
          if (!resumeAt) {
            chatSessions[currentSessionId].claudeSessionId = null;
          } else {
            chatSessions[currentSessionId].claudeSessionId = resumeSessionIdForRestore || null;
          }
        }
      }
    }

    // Always rebuild diff highlight cache after a restore attempt.
    // (Even if we couldn't locate the exact message index, the workspace contents changed.)
    try { rebuildLastDiffCacheForSession(currentSessionId); } catch { /* ignore */ }
    try { refreshDiffDecorationsForAllOpenTabs(); } catch { /* ignore */ }

    // 4. Populate Input and restore attachments
    const input = document.getElementById('chatInput');
    if (content) {
      input.value = content;
      input.style.height = 'auto';
    }
    input.focus();

    // Restore attachments to pending state (passed as parameter)
    if (attachments && attachments.length > 0) {
      setPendingAttachments(currentSessionId, [...attachments]);
      renderAttachmentPreview();
    } else {
      // Clear any existing attachments
      setPendingAttachments(currentSessionId, []);
      renderAttachmentPreview();
    }

    // 5. Refresh File Tree
    if (window.refreshFileTree) await window.refreshFileTree();
    if (window.currentFile) await window.openFile(window.currentFile);

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

      showToast('Project restored successfully');

    // Restored to checkpoint

  } catch (e) {
    console.error('Error restoring checkpoint:', e);
    await customAlert(`Error restoring checkpoint:\n\n${e?.message || String(e)}`, 'Restore Failed');
  }
}


function formatMessage(content) {
  // 1. Extract code blocks to protect them from formatting and escaping
  const codeBlocks = [];
  let codeBlockId = 0;
  
  // Match code blocks: ```lang\ncode``` or ```\ncode``` or ```code```
  let protectedContent = content.replace(/```(\w+)?[\n\r]?([\s\S]*?)```/g, (_match, lang, code) => {
    // Trim leading newline from code if present
    const trimmedCode = code.replace(/^[\n\r]/, '');
    const placeholder = `__CODE_BLOCK_${codeBlockId++}__`;
    codeBlocks.push({
      placeholder,
      html: `<div class="code-block-container" data-code-id="code-${placeholder}" data-language="${lang || 'text'}"><pre><code class="language-${lang || 'text'}" data-code="${encodeURIComponent(trimmedCode)}">${escapeHtml(trimmedCode)}</code></pre></div>`
    });
    return placeholder;
  });

  // 2. Escape HTML in the rest of the content (Prevent XSS and file loading bugs)
  protectedContent = escapeHtml(protectedContent);

  // 3. Apply Markdown Formatting to the safe text
  let formatted = protectedContent
    // Headings
    .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Inline code (also supports clickable file links for better UX)
    .replace(/`([^`]+)`/g, (_m, inner) => {
      const rawInner = unescapeHtml(inner);
      const cleaned = cleanFileToken(rawInner);
      if (looksLikeUrlToken(cleaned)) {
        const href = normalizeUrlToken(cleaned);
        return `<a class="chat-url-link" data-chat-url-link="1" href="${escapeAttr(href)}" rel="noopener noreferrer" target="_blank"><code>${inner}</code></a>`;
      }
      if (looksLikeRelFilePathToken(cleaned)) {
        return `<code class="chat-file-link" data-chat-file-link="1">${inner}</code>`;
      }
      return `<code>${inner}</code>`;
    })
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Line breaks
    .replace(/\n/g, '<br>');

  // 4. Restore Code Blocks
  codeBlocks.forEach(block => {
    formatted = formatted.replace(block.placeholder, block.html);
  });

  return formatted;
}


function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


function escapeAttr(text) {
  // Safe for inclusion inside double-quoted HTML attributes.
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function unescapeHtml(text) {
  const div = document.createElement('div');
  div.innerHTML = String(text ?? '');
  return div.textContent || '';
}

function looksLikeUrlToken(token) {
  const s = String(token || '').trim();
  if (!s) return false;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^mailto:/i.test(s);
}

function normalizeUrlToken(token) {
  return String(token || '').trim();
}


// Streaming-safe formatter: avoids markdown re-parsing flicker while deltas are still arriving.
// We only fully format markdown once the final assistant message is complete.
function formatMessageStreamingSafe(content) {
  const safe = escapeHtml(String(content || ''));
  return safe.replace(/\n/g, '<br>');
}
