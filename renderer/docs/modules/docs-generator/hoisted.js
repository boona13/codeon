// ============================================================================
// DOCS GENERATOR (Codeon Documentation Mode)
// Generates documentation updates after AI runs
// ============================================================================

(function () {
  'use strict';

  if (window._docsGenerator) return;

  // === Helpers ===
  const _trim = (s) => (typeof s === 'string' ? s.trim() : '');
  const _sid = () => _trim(window.currentSessionId || '');
  const _retryTimers = Object.create(null);
  const MAX_BUSY_DEFERS = 300; // seconds (1 retry per second)
  const BUSY_RETRY_MS = 1000;

  function _escapeHtml(text) {
    try { return window.escapeHtml(String(text || '')); } catch { /* ignore */ }
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _escapeAttr(text) {
    try { return window.escapeAttr(String(text || '')); } catch { /* ignore */ }
    return String(text || '').replace(/"/g, '&quot;');
  }

  function _projectNameFromPath(path) {
    const p = _trim(path);
    if (!p) return 'Project';
    const parts = p.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || 'Project';
  }

  function _stripMarkdown(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_>#-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // === Add Docs Link Card to Chat ===
  function _addDocsLinkCardToChat(sessionId, runRequestId, content, { isLoading = false } = {}) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid) return;
    if (sid !== window.currentSessionId) return;

    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;

    const cardId = `docs-link-card-${sid}-${rid}`;
    let linkCard = messagesContainer.querySelector(`#${CSS.escape(cardId)}`);
    const isNewCard = !linkCard;

    if (isNewCard) {
      linkCard = document.createElement('div');
      linkCard.id = cardId;
      linkCard.className = 'message assistant docs-link-card';
    }

    if (isLoading) {
      linkCard.classList.add('docs-link-card--loading');
      linkCard.innerHTML = `
        <div class="docs-link-card-content">
          <div class="docs-link-card-icon docs-link-card-icon--loading">
            <svg class="docs-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
              <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
            </svg>
          </div>
          <div class="docs-link-card-body">
            <div class="docs-link-card-title">Generating Documentation...</div>
            <div class="docs-link-card-summary docs-link-card-summary--loading">Capturing feature details and usage notes</div>
          </div>
        </div>
      `;
      linkCard.style.cursor = 'default';
    } else {
      linkCard.classList.remove('docs-link-card--loading');

      let summarySnippet = 'New documentation update is ready.';
      try {
        if (content && content.summary) {
          const raw = _stripMarkdown(content.summary || '');
          summarySnippet = raw.length > 120 ? raw.slice(0, 117) + '...' : raw;
        }
      } catch { /* ignore */ }

      linkCard.innerHTML = `
        <div class="docs-link-card-content">
          <div class="docs-link-card-icon docs-link-card-icon--success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
          </div>
          <div class="docs-link-card-body">
            <div class="docs-link-card-title">Documentation Updated</div>
            <div class="docs-link-card-summary">${_escapeHtml(summarySnippet)}</div>
          </div>
          <button class="docs-link-card-btn" type="button" title="View in Docs tab">
            View
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      `;

      const btn = linkCard.querySelector('.docs-link-card-btn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            if (typeof window._activateDocsTab === 'function') {
              window._activateDocsTab();
            }
            const ds = window._docsState;
            if (ds && typeof ds.setActiveEntry === 'function') {
              ds.setActiveEntry(rid);
            }
            try { window._onDocsStateUpdate?.(); } catch { /* ignore */ }
          } catch { /* ignore */ }
        });
      }

      linkCard.style.cursor = 'pointer';
      linkCard.addEventListener('click', (e) => {
        if (e.target === btn || btn?.contains(e.target)) return;
        btn?.click();
      });
    }

    if (isNewCard) {
      messagesContainer.appendChild(linkCard);
      try {
        linkCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch { /* ignore */ }
    }
  }

  function _updateDocsLinkCardError(sessionId, runRequestId, errorMessage) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid) return;
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    const cardId = `docs-link-card-${sid}-${rid}`;
    const linkCard = messagesContainer.querySelector(`#${CSS.escape(cardId)}`);
    if (!linkCard) return;

    linkCard.classList.add('docs-link-card--error');
    linkCard.innerHTML = `
      <div class="docs-link-card-content">
        <div class="docs-link-card-icon docs-link-card-icon--error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <div class="docs-link-card-body">
          <div class="docs-link-card-title">Documentation Generation Failed</div>
          <div class="docs-link-card-summary docs-link-card-summary--error">${_escapeHtml(errorMessage || 'Unknown error')}</div>
        </div>
      </div>
    `;
  }

  function _removeDocsLinkCard(sessionId, runRequestId) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return;
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    const cardId = `docs-link-card-${sid}-${rid}`;
    const linkCard = messagesContainer.querySelector(`#${CSS.escape(cardId)}`);
    if (linkCard && linkCard.parentNode) {
      linkCard.parentNode.removeChild(linkCard);
    }
  }

  function _cleanupDocsEntry(pid, sid, rid) {
    try { window._docsState?.deleteEntry?.(pid, rid); } catch { /* ignore */ }
    try { _removeDocsLinkCard(sid, rid); } catch { /* ignore */ }
  }

  // === Collect Run Context ===
  function _collectRunContext(sessionId, runRequestId) {
    const context = {
      prompt: '',
      toolsUsed: [],
      filesModified: [],
      toolDetails: [],
      projectPath: '',
      projectName: ''
    };

    try {
      const sid = _trim(sessionId || _sid());
      const rid = _trim(runRequestId);
      const projectPath = _trim(window.currentFolder || '');
      context.projectPath = projectPath;
      context.projectName = _projectNameFromPath(projectPath);

      const msgs = typeof window.ensureSessionMessages === 'function'
        ? window.ensureSessionMessages(sid)
        : [];
      const userMsgs = msgs.filter(m => m && m.role === 'user');
      if (userMsgs.length > 0) {
        const lastUser = userMsgs[userMsgs.length - 1];
        context.prompt = _trim(lastUser.content || '');
      }

      const receipts = typeof window.getToolReceiptsForSession === 'function'
        ? window.getToolReceiptsForSession(sid)
        : [];

      const relevantReceipts = rid
        ? receipts.filter(r => r && (r.runRequestId === rid || !r.runRequestId))
        : receipts.slice(-20);

      const toolSet = new Set();
      const fileSet = new Set();

      for (const r of relevantReceipts) {
        if (!r) continue;
        const toolName = _trim(r.toolName);
        if (toolName) toolSet.add(toolName);

        if (r.receipt && typeof r.receipt === 'object') {
          const filePath = _trim(r.receipt.file_path || r.receipt.filePath || r.receipt.path || '');
          if (filePath && !filePath.startsWith('.ai-agent')) {
            fileSet.add(filePath);
          }
        }

        if (toolName && r.preview) {
          context.toolDetails.push({
            tool: toolName,
            preview: _trim(r.preview).slice(0, 300)
          });
        }
      }

      context.toolsUsed = Array.from(toolSet);
      context.filesModified = Array.from(fileSet).slice(0, 12);

      const filePreviews = msgs.filter(m => m && m.role === 'file_preview');
      for (const fp of filePreviews.slice(-10)) {
        if (fp.path && !fp.path.startsWith('.ai-agent')) {
          if (!fileSet.has(fp.path)) {
            context.filesModified.push(fp.path);
          }
        }
      }
    } catch (e) {
      console.warn('[Docs] Error collecting run context:', e);
    }

    return context;
  }

  // === Build Documentation Prompt ===
  function _buildDocumentationPrompt(context) {
    let prompt = `📚 **DOCUMENTATION MODE**\n\n`;
    prompt += `You are writing documentation updates for the project "${context.projectName || 'Project'}".\n`;
    prompt += `The AI just completed this task:\n"${context.prompt || 'The previous coding task'}"\n\n`;

    if (context.toolsUsed.length > 0) {
      prompt += `Tools used: ${context.toolsUsed.join(', ')}\n`;
    }
    if (context.filesModified.length > 0) {
      prompt += `Files modified: ${context.filesModified.join(', ')}\n`;
    }
    if (context.toolDetails.length > 0) {
      prompt += `\nRecent actions:\n`;
      for (const td of context.toolDetails.slice(0, 6)) {
        prompt += `- ${td.tool}: ${td.preview}\n`;
      }
    }

    prompt += `\n---\n\n`;
    prompt += `Write a documentation update in Markdown. Be concise but complete.\n`;
    prompt += `Use this exact structure:\n\n`;
    prompt += `## Feature: <short title>\n`;
    prompt += `### Overview\n`;
    prompt += `What changed and why it matters.\n\n`;
    prompt += `### User Workflow\n`;
    prompt += `Describe the user-facing behavior and flows.\n\n`;
    prompt += `### Usage\n`;
    prompt += `Steps, commands, or UI actions needed to use the feature.\n\n`;
    prompt += `### Configuration\n`;
    prompt += `Settings, flags, or files to adjust (or "Not applicable").\n\n`;
    prompt += `### Files\n`;
    prompt += `List the most important files touched (use backticks).\n\n`;
    prompt += `### Notes\n`;
    prompt += `Edge cases, limitations, or follow-ups.\n\n`;
    prompt += `Rules:\n`;
    prompt += `- Keep headings exactly as shown.\n`;
    prompt += `- Do not mention internal tools, system prompts, or that you are an AI.\n`;
    prompt += `- Use bullet lists where appropriate.\n`;
    prompt += `- Keep it suitable to be merged into final docs without rewriting.\n`;

    return prompt;
  }

  // === Parse Documentation Response ===
  function _parseDocumentationResponse(text) {
    const raw = _trim(text || '');
    const content = {
      rawMarkdown: raw,
      title: '',
      summary: ''
    };
    if (!raw) return content;

    try {
      const titleMatch = raw.match(/^#{1,3}\s*(.+)$/m);
      if (titleMatch) content.title = _trim(titleMatch[1] || '');

      const overviewMatch = raw.match(/###\s*Overview[\s\S]*?(?=\n###|\n##|\n#|$)/i);
      if (overviewMatch) {
        const cleaned = _stripMarkdown(overviewMatch[0].replace(/###\s*Overview/i, ''));
        if (cleaned) content.summary = cleaned;
      }

      if (!content.summary) {
        const firstParagraph = raw.split(/\n\n+/).find(p => _stripMarkdown(p).length > 30);
        content.summary = _stripMarkdown(firstParagraph || raw).slice(0, 280);
      }
    } catch (e) {
      console.warn('[Docs] Failed to parse response:', e);
    }

    return content;
  }

  function _cleanupSilentRunUi(sessionId) {
    try {
      const banner = document.getElementById('chatStatusBanner');
      if (banner) banner.style.display = 'none';
    } catch { /* ignore */ }

    try {
      if (typeof window.setProcessingState === 'function') {
        window.setProcessingState(false, sessionId);
      }
    } catch { /* ignore */ }

    try {
      if (typeof window.updateSendButtonForCurrentSession === 'function') {
        window.updateSendButtonForCurrentSession();
      }
    } catch { /* ignore */ }

    try {
      if (typeof window.renderChatTabs === 'function') {
        window.renderChatTabs();
      }
    } catch { /* ignore */ }
  }

  // === Generate Documentation Update ===
  async function generateDocumentationUpdate({ projectId, sessionId, runRequestId, _deferCount = 0 }) {
    const ds = window._docsState;
    if (!ds) {
      console.warn('[Docs] State module not available');
      return;
    }

    const pid = _trim(projectId || ds.getProjectId?.() || '');
    const sid = _trim(sessionId || _sid());
    const rid = _trim(runRequestId);
    if (!pid || !rid) {
      console.warn('[Docs] Missing projectId or runRequestId');
      return;
    }

    let entry = ds.getEntry(pid, rid);
    if (!entry) {
      entry = ds.createEntry({ projectId: pid, sessionId: sid, runRequestId: rid, originalPrompt: '' });
    }

    if (entry.status === 'completed') return;
    if (entry.status === 'generating') return;

    // If another run is in progress (or Learning/Verification is running), defer to avoid overlap.
    try {
      const busy = (typeof window.isSessionProcessing === 'function' && window.isSessionProcessing(sid)) ||
        (window._learningState?.isGenerating?.() === true) ||
        (window._proofedEditsState?.isVerificationRunning?.(sid) === true);
      if (busy) {
        const next = Number(_deferCount || 0) + 1;
        const key = `${pid}:${sid}:${rid}`;
        if (next === 1) {
          console.debug('[Docs] Deferring generation; another run is busy.');
        }
        if (!_retryTimers[key] && next <= MAX_BUSY_DEFERS) {
          _retryTimers[key] = setTimeout(() => {
            delete _retryTimers[key];
            generateDocumentationUpdate({ projectId: pid, sessionId: sid, runRequestId: rid, _deferCount: next });
          }, BUSY_RETRY_MS);
        }
        if (next > MAX_BUSY_DEFERS) {
          console.warn('[Docs] Deferral timeout; leaving entry pending.');
        }
        return;
      }
    } catch { /* ignore */ }

    if (typeof window.getAIResponse !== 'function') {
      console.warn('[Docs] getAIResponse not available');
      ds.setEntryError(pid, rid, 'Chat system not available');
      return;
    }

    ds.setEntryGenerating(pid, rid);
    try { window._onDocsStateUpdate?.(); } catch { /* ignore */ }

    try {
      _addDocsLinkCardToChat(sid, rid, null, { isLoading: true });
    } catch { /* ignore */ }

    try {
      const context = _collectRunContext(sid, rid);
      ds.updateEntry(pid, rid, {
        originalPrompt: context.prompt,
        metadata: {
          toolsUsed: context.toolsUsed,
          filesModified: context.filesModified,
          durationMs: entry.metadata?.durationMs || 0
        }
      });

      const docsPrompt = _buildDocumentationPrompt(context);

      const response = await window.getAIResponse(
        docsPrompt,
        [],
        null,
        sid,
        {
          isDocumentationRequest: true,
          skipCheckpoint: true
        }
      );

      const content = _parseDocumentationResponse(response || '');
      ds.setEntryCompleted(pid, rid, content);

      try { _addDocsLinkCardToChat(sid, rid, content); } catch { /* ignore */ }
    } catch (e) {
      console.error('[Docs] Generation failed:', e);
      const errMsg = String(e?.message || 'Generation failed');
      
      // Check if this is a provider/network error (404, timeout, etc.) - don't spam user with cards
      const isProviderError = /404|not found|timeout|network|ECONNREFUSED|rate.?limit/i.test(errMsg);
      
      if (isProviderError) {
        // Silently clean up - don't show error card for provider issues
        console.warn('[Docs] Provider error, cleaning up silently:', errMsg.slice(0, 100));
      } else {
        // For other errors, still show the error card briefly
        try {
          _updateDocsLinkCardError(sid, rid, errMsg);
        } catch { /* ignore */ }
      }
      
      _cleanupDocsEntry(pid, sid, rid);
    }

    _cleanupSilentRunUi(sid);
    try { window._onDocsStateUpdate?.(); } catch { /* ignore */ }
  }

  // === Expose API ===
  window._docsGenerator = {
    generate: generateDocumentationUpdate,
    collectContext: _collectRunContext,
    buildPrompt: _buildDocumentationPrompt,
    parseResponse: _parseDocumentationResponse
  };

  window._generateDocumentationUpdate = generateDocumentationUpdate;

  // Cancel any in-flight docs generation for a session (cleans UI/state)
  window._cancelDocsGeneration = function ({ sessionId = null, runRequestId = null, reason: _reason = 'Cancelled' } = {}) {
    try {
      const ds = window._docsState;
      if (!ds) return;
      const sid = _trim(sessionId || _sid());
      const pid = ds.getProjectId ? ds.getProjectId() : '';
      if (!sid || !pid) return;
      let rid = _trim(runRequestId);
      if (!rid && typeof ds.getEntriesForProject === 'function') {
        const entries = ds.getEntriesForProject(pid) || [];
        const target = entries.find(e => e && e.sessionId === sid && (e.status === 'generating' || e.status === 'pending'));
        if (target && target.runRequestId) rid = target.runRequestId;
      }
      if (!rid) return;
      try { ds.deleteEntry(pid, rid); } catch { /* ignore */ }
      try { if (ds.getView && ds.getView() === 'detail') ds.setView('list'); } catch { /* ignore */ }
      try { _removeDocsLinkCard(sid, rid); } catch { /* ignore */ }
      try { window._onDocsStateUpdate?.(); } catch { /* ignore */ }
    } catch { /* ignore */ }
  };
})();
