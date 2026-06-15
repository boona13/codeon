// ---- GENERATED: hoisted declarations extracted from app/chat/attachments.js ----
async function handleFileSelect(event) {
  const files = Array.from(event.target.files);
  for (const file of files) {
    await addAttachment(file);
  }
  // Clear input so same file can be selected again
  event.target.value = '';
}


function normalizePathSlashes(p) {
  return String(p || '').replace(/\\/g, '/');
}


function stripFileUriPrefix(p) {
  const raw = String(p || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('file://')) return raw;
  // file:///Users/... or file://localhost/Users/...
  let rest = raw.replace(/^file:\/\/(localhost)?/i, '');
  rest = rest.replace(/^\/+/, '/');
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}


function extractWorkspaceDropPaths(dataTransfer) {
  if (!dataTransfer) return [];
  const paths = [];

  // Common: text/uri-list contains file:// URIs
  const uriList = dataTransfer.getData('text/uri-list');
  if (typeof uriList === 'string' && uriList.trim()) {
    uriList
      .split(/\r?\n/g)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .forEach(line => {
        if (line.startsWith('file://')) {
          const p = stripFileUriPrefix(line);
          if (p) paths.push(p);
        }
      });
  }

  // Common: plain text includes a path (relative or absolute) when dragging from a file tree
  const plain = dataTransfer.getData('text/plain');
  if (typeof plain === 'string') {
    const candidate = plain.trim();
    // Avoid treating large pasted code/text drops as file paths.
    if (candidate && candidate.length < 400 && !candidate.includes('\n')) {
      const looksLikePath =
        candidate.startsWith('/') ||
        candidate.startsWith('./') ||
        candidate.startsWith('../') ||
        candidate.includes('/') ||
        candidate.includes('\\');
      if (looksLikePath) {
        paths.push(stripFileUriPrefix(candidate));
      }
    }
  }

  // De-dupe
  const uniq = Array.from(new Set(paths.map(p => normalizePathSlashes(p)).filter(Boolean)));
  return uniq;
}


function basenameFromPath(p) {
  const norm = normalizePathSlashes(p);
  const parts = norm.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : norm;
}


function inferKindFromPath(p) {
  const name = basenameFromPath(p).toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp)$/.test(name)) return 'image';
  return 'text';
}


function resolveFileTokenToRelPath(token) {
  const raw0 = String(token || '').trim();
  if (!raw0) return null;

  // Normalize URL-ish / absolute paths.
  const raw1 = normalizePathSlashes(stripFileUriPrefix(raw0)).trim();
  if (!raw1) return null;

  let rel = null;
  if (raw1.startsWith('/')) {
    rel = toRelativeProjectPath(raw1);
  } else {
    rel = raw1.replace(/^\.\//, '').replace(/^\/+/, '');
  }
  rel = rel ? String(rel).replace(/^\/+/, '').trim() : null;
  if (!rel) rel = null;

  const all = flattenWorkspaceTreeFiles(workspaceFileTreeSnapshot || [], []);

  const relNorm = rel ? normalizeRelPathForDiffPreview(rel) : '';
  if (relNorm) {
    if (all.includes(relNorm)) return relNorm;
  }

  // Smart fallback: if token is just a basename, try to match it.
  const base = basenameFromPath(raw1);
  if (base && base.includes('.') && !base.includes('/') && !base.includes('\\')) {
    const matches = all.filter(p => p === base || p.endsWith('/' + base));
    if (matches.length === 1) return matches[0];
    
    // Multiple matches: use smart heuristics to pick the best one
    if (matches.length > 1) {
      // 1. Prefer recently opened files (check editor tabs)
      const recentPaths = (() => {
        try {
          const tabs = window.editorTabs || [];
          return tabs.map(t => t?.filePath).filter(Boolean).map(p => normalizeRelPathForDiffPreview(p));
        } catch {
          return [];
        }
      })();
      for (const recentPath of recentPaths) {
        if (matches.includes(recentPath)) return recentPath;
      }

      // 2. Prefer common source directories (src/, app/, components/, lib/, etc.)
      const commonDirs = ['src/', 'app/', 'components/', 'lib/', 'pages/', 'views/', 'modules/'];
      for (const dir of commonDirs) {
        const dirMatch = matches.find(p => p.startsWith(dir));
        if (dirMatch) return dirMatch;
      }

      // 3. Prefer shorter paths (likely more important/root-level files)
      const sorted = matches.slice().sort((a, b) => {
        const aDepth = (a.match(/\//g) || []).length;
        const bDepth = (b.match(/\//g) || []).length;
        if (aDepth !== bDepth) return aDepth - bDepth;
        return a.length - b.length;
      });
      return sorted[0];
    }
  }

  return null;
}


function clearClaudeResumeStateForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    if (chatSessions && chatSessions[sid]) {
      chatSessions[sid].claudeSessionId = null;
    }
  } catch { /* ignore */ }
  try {
    const m = getClaudeSessionMeta(sid);
    if (m) {
      m.pendingResumeAt = null;
      m.forkOnNext = false;
      m.lastAssistantUuid = null;
    }
  } catch { /* ignore */ }
  try { saveChatHistory(true).catch(() => {}); } catch { /* ignore */ }
}


function clearClaudeResumeAnchorForSession(sessionId) {
  // Less destructive than `clearClaudeResumeStateForSession`:
  // - keep `claudeSessionId` so the conversation can continue
  // - drop only the resume-at pointer that is causing the crash
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    const m = getClaudeSessionMeta(sid);
    if (m) {
      m.pendingResumeAt = null;
      m.forkOnNext = false;
    }
  } catch { /* ignore */ }
  try { saveChatHistory(true).catch(() => {}); } catch { /* ignore */ }
}


function addClaudeMissingConversationRecoveryCard(sessionId, missingId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;

  const card = document.createElement('div');
  card.className = 'message system claude-recovery';
  const safeId = escapeHtml(String(missingId || '').trim());
  card.innerHTML = `
    <div class="message-header" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <span>⚠️ Claude session not found</span>
      <button class="restore-btn restore-btn--icon claude-recovery-dismiss" title="Dismiss">✕</button>
    </div>
    <div class="message-content" style="margin-top:8px;">
      Claude could not resume the previous conversation (session id: <code>${safeId}</code>).
      <br/><br/>
      I cleared the stored session pointer. Click retry to continue with a fresh session.
    </div>
    <div style="display:flex; gap:10px; margin-top:12px;">
      <button class="btn-primary claude-recovery-retry">Retry (new session)</button>
      <button class="btn-secondary claude-recovery-dismiss2">Dismiss</button>
    </div>
  `;

  const dismiss = () => { try { card.remove(); } catch { /* ignore */ } };
  const dismissBtn = card.querySelector('.claude-recovery-dismiss');
  const dismissBtn2 = card.querySelector('.claude-recovery-dismiss2');
  if (dismissBtn) dismissBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(); });
  if (dismissBtn2) dismissBtn2.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(); });

  const retryBtn = card.querySelector('.claude-recovery-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await retryLastUserMessageWithNewClaudeSession(sid);
        dismiss();
      } catch {
        // ignore (retry handler will surface its own errors)
      }
    });
  }

  // Append under the latest turn
  appendChatNode(messagesContainer, card, { roleHint: 'assistant' });
  try { smartScrollToBottom(messagesContainer); } catch { /* ignore */ }
}


function addClaudeMissingResumeAnchorRecoveryCard(sessionId, missingUuid) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;

  const card = document.createElement('div');
  card.className = 'message system claude-recovery';
  const safeId = escapeHtml(String(missingUuid || '').trim());
  card.innerHTML = `
    <div class="message-header" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <span>⚠️ Claude rewind anchor not found</span>
      <button class="restore-btn restore-btn--icon claude-recovery-dismiss" title="Dismiss">✕</button>
    </div>
    <div class="message-content" style="margin-top:8px;">
      Claude could not resume from a specific message UUID (<code>${safeId}</code>).
      <br/><br/>
      I cleared the resume-at pointer for this chat so you can retry without rewinding.
    </div>
    <div style="display:flex; gap:10px; margin-top:12px;">
      <button class="btn-primary claude-recovery-retry">Retry</button>
      <button class="btn-secondary claude-recovery-dismiss2">Dismiss</button>
    </div>
  `;

  const dismiss = () => { try { card.remove(); } catch { /* ignore */ } };
  const dismissBtn = card.querySelector('.claude-recovery-dismiss');
  const dismissBtn2 = card.querySelector('.claude-recovery-dismiss2');
  if (dismissBtn) dismissBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(); });
  if (dismissBtn2) dismissBtn2.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(); });

  const retryBtn = card.querySelector('.claude-recovery-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        // Retry without forcing a new session; we only cleared resumeSessionAt.
        await retryLastUserMessageAfterTransientClaudeFailure(sid, { forceNewClaudeSession: false });
        dismiss();
      } catch {
        // ignore
      }
    });
  }

  appendChatNode(messagesContainer, card, { roleHint: 'assistant' });
  try { smartScrollToBottom(messagesContainer); } catch { /* ignore */ }
}

function addClaudeInvalidThinkingRecoveryCard(sessionId, { errorText = '' } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;

  const card = document.createElement('div');
  card.className = 'message system claude-recovery';
  const safeErr = escapeHtml(String(errorText || '').trim());
  card.innerHTML = `
    <div class="message-header" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <span>⚠️ Claude session corrupted</span>
      <button class="restore-btn restore-btn--icon claude-recovery-dismiss" title="Dismiss">✕</button>
    </div>
    <div class="message-content" style="margin-top:8px;">
      Claude returned a recoverable API error while resuming this chat:
      <br/>
      <code>${safeErr || 'Invalid redacted_thinking block'}</code>
      <br/><br/>
      I cleared the stored Claude session pointer for this chat. Click retry to continue with a fresh session.
    </div>
    <div style="display:flex; gap:10px; margin-top:12px;">
      <button class="btn-primary claude-recovery-retry">Retry (new session)</button>
      <button class="btn-secondary claude-recovery-dismiss2">Dismiss</button>
    </div>
  `;

  const dismiss = () => { try { card.remove(); } catch { /* ignore */ } };
  const dismissBtn = card.querySelector('.claude-recovery-dismiss');
  const dismissBtn2 = card.querySelector('.claude-recovery-dismiss2');
  if (dismissBtn) dismissBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(); });
  if (dismissBtn2) dismissBtn2.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(); });

  const retryBtn = card.querySelector('.claude-recovery-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await retryLastUserMessageWithNewClaudeSession(sid);
        dismiss();
      } catch {
        // ignore
      }
    });
  }

  appendChatNode(messagesContainer, card, { roleHint: 'assistant' });
  try { smartScrollToBottom(messagesContainer); } catch { /* ignore */ }
}


function classifyClaudeTransientFailure(text) {
  const raw = String(text || '');
  // Our terminal error strings sometimes include a helpful footer "What to do:".
  // That footer can contain words like "rate limit" even when the *actual* root cause is something else (e.g. 403).
  // For classification, only look at the primary error section before that footer.
  const primary = (() => {
    const idx = raw.toLowerCase().indexOf('what to do:');
    return idx >= 0 ? raw.slice(0, idx) : raw;
  })();
  const lower = primary.toLowerCase();

  // If the browser is offline, that dominates everything.
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    return { kind: 'offline', title: '📴 You appear to be offline', subtitle: 'Reconnect to the internet, then retry.', retryable: true };
  }

  // Permission denials should be surfaced clearly (not as rate limit).
  if (lower.includes('permission denials') || lower.includes('permission denied') || /\bdenied\b/.test(lower) && lower.includes('bash')) {
    return { kind: 'permission', title: '🔒 Tool permission denied', subtitle: 'Claude was blocked from running a tool. Allow it (or change permission mode) and retry.', retryable: true };
  }

  // 403 is NOT a rate limit; it's forbidden (often auth or blocked download).
  if (lower.includes('status code 403') || /\b403\b/.test(lower)) {
    return { kind: 'forbidden', title: '🚫 Forbidden (403)', subtitle: 'Claude was blocked from downloading or accessing a required resource.', retryable: true };
  }

  // 404 usually means invalid model or endpoint (e.g., OpenRouter base URL).
  if (lower.includes('not found') && (lower.includes('status code 404') || /\b404\b/.test(lower) || lower.includes('"code":404'))) {
    return { kind: 'not_found', title: '🔎 Not found (404)', subtitle: 'Model or API endpoint not found. Verify provider settings and model name.', retryable: true };
  }

  // Filesystem/path mistakes are not rate limits.
  if (lower.includes('eisdir') || lower.includes('enotdir') || lower.includes('eacces') || lower.includes('eperm')) {
    return { kind: 'filesystem', title: '📁 Local filesystem error', subtitle: 'A tool tried an invalid file operation (e.g. read a directory as a file).', retryable: true };
  }

  if (lower.includes('rate_limit') || lower.includes('rate limit') || lower.includes('too many requests') || /\b429\b/.test(lower) || lower.includes('status code 429')) {
    const authMode = (typeof settings === 'object' && settings && typeof settings.authMode === 'string') ? settings.authMode : '';
    if (authMode === 'claude_ai') {
      return { kind: 'rate_limit', title: "You've hit your limit for Claude messages.", subtitle: 'Limits will reset soon.', retryable: true };
    }
    return { kind: 'rate_limit', title: '⏳ Claude rate limited', subtitle: 'Too many requests were sent in a short time.', retryable: true };
  }

  // Common transient network / DNS / socket issues
  if (
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('eai_again') ||
    lower.includes('enotfound') ||
    lower.includes('enetunreach') ||
    lower.includes('network error') ||
    lower.includes('fetch failed') ||
    lower.includes('socket hang up') ||
    lower.includes('internet') ||
    lower.includes('dns')
  ) {
    return { kind: 'network', title: '🌐 Network error', subtitle: 'Connection hiccup while talking to Claude.', retryable: true };
  }

  // Temporary upstream failures / overloads
  if (
    lower.includes('overloaded') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway') ||
    lower.includes('gateway timeout') ||
    lower.includes('internal server error') ||
    /\b(500|502|503|504)\b/.test(lower)
  ) {
    return { kind: 'server', title: '🛠️ Claude service temporary issue', subtitle: 'Claude is temporarily unavailable. Try again soon.', retryable: true };
  }

  return null;
}

function addClaudeTransientRetryCard(sessionId, { title = '', subtitle = '', errorText = '', retryAfterSeconds = null, kind = '', requestId = null, diagnostics = null } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;

  // Dedupe: only one visible card at a time.
  try {
    messagesContainer.querySelectorAll('.message.system.claude-transient-retry').forEach(el => el.remove());
  } catch { /* ignore */ }

  const retrySecs = Number.isFinite(Number(retryAfterSeconds)) && Number(retryAfterSeconds) > 0 ? Number(retryAfterSeconds) : 0;
  const waitText = String(kind || '') === 'rate_limit'
    ? ''
    : (retrySecs > 0 ? ` Retry in ~${retrySecs}s.` : ' You can retry now.');
  const detailsText = errorText ? String(errorText).trim() : '';
  const detailsFirstLine = detailsText ? detailsText.split('\n')[0] : '';
  const reqId = (typeof requestId === 'string' && requestId.trim()) ? requestId.trim() : '';
  const diagPayload = diagnostics && typeof diagnostics === 'object' ? diagnostics : null;

  // Heuristic: surface one-click remediation actions for common “stops”
  // (permission denials, 403 forbidden / allowlist blocks) so users don't have to hunt Settings.
  const detailsLower = detailsText.toLowerCase();
  const hasPermissionDenial =
    detailsLower.includes('permission denials') ||
    detailsLower.includes('permission denied') ||
    (/\bdenied\b/.test(detailsLower) && (detailsLower.includes('bash') || detailsLower.includes('write') || detailsLower.includes('edit')));
  const has403 = detailsLower.includes('status code 403') || /\b403\b/.test(detailsLower);
  // Only offer a network-policy shortcut if user is currently in a restrictive mode.
  const currentNetMode = (settings && typeof settings.networkPolicyMode === 'string') ? settings.networkPolicyMode : 'allow_all';
  const canRelaxNetwork = has403 && (currentNetMode === 'deny_all' || currentNetMode === 'allowlist');
  const currentPermMode = (settings && typeof settings.permissionMode === 'string') ? settings.permissionMode : 'acceptEdits';
  const canRelaxPermissions = hasPermissionDenial && currentPermMode !== 'acceptEdits' && currentPermMode !== 'bypassPermissions';

  const extraActionsHtml = (() => {
    const btns = [];
    if (reqId) btns.push('<button class="btn-secondary btn-sm claude-transient-copy-request-id">Copy request id</button>');
    if (diagPayload) btns.push('<button class="btn-secondary btn-sm claude-transient-copy-diagnostics">Copy diagnostics</button>');
    // Claude.ai subscription message limit: mirror Claude website wording + link to usage.
    const authMode = (typeof settings === 'object' && settings && typeof settings.authMode === 'string') ? settings.authMode : '';
    if (String(kind || '') === 'rate_limit' && authMode === 'claude_ai') {
      btns.push('<button class="btn-secondary btn-sm claude-transient-open-usage">View your usage details</button>');
    }
    if (canRelaxPermissions) btns.push('<button class="btn-secondary btn-sm claude-transient-fix-permissions">Set permission mode: acceptEdits</button>');
    if (canRelaxNetwork) btns.push('<button class="btn-secondary btn-sm claude-transient-fix-network">Set network policy: allow_all</button>');
    // Always allow jumping to Settings for these kinds of issues.
    if (hasPermissionDenial || has403) btns.push('<button class="btn-secondary btn-sm claude-transient-open-settings">Open Settings</button>');
    if (btns.length === 0) return '';
    return `<div class="claude-transient-actions claude-transient-actions--secondary">${btns.join('')}</div>`;
  })();

  // If we have a deterministic git checkpoint for the last user turn, offer "Retry (restore checkpoint)".
  const lastUserCheckpoint = (() => {
    try {
      const msgs = ensureSessionMessages(sid);
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m && m.role === 'user') {
          const h = typeof m.commitHash === 'string' ? m.commitHash.trim() : '';
          return h || null;
        }
      }
    } catch { /* ignore */ }
    return null;
  })();

  const card = document.createElement('div');
  card.className = 'message system claude-transient-retry';
  const resetAtText = (() => {
    try {
      const authMode = (typeof settings === 'object' && settings && typeof settings.authMode === 'string') ? settings.authMode : '';
      if (String(kind || '') !== 'rate_limit' || authMode !== 'claude_ai') return '';
      const now = new Date();
      const reset = new Date(now);
      reset.setHours(6, 0, 0, 0);
      if (reset.getTime() <= now.getTime()) reset.setDate(reset.getDate() + 1);
      const t = reset.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return ` Limits will reset at ${t}.`;
    } catch {
      return '';
    }
  })();
  card.innerHTML = `
    <div class="claude-transient-header">
      <span class="claude-transient-title">${escapeHtml(String(title || '⚠️ Claude error'))}</span>
      <button class="restore-btn restore-btn--icon claude-transient-dismiss" title="Dismiss">✕</button>
    </div>
    <div class="message-content claude-transient-body">
      ${escapeHtml(String(subtitle || 'This looks temporary.'))}${escapeHtml(resetAtText)}${escapeHtml(waitText)}
      ${reqId ? `<div class="claude-transient-meta"><span>Request id:</span><code>${escapeHtml(reqId)}</code></div>` : ''}
      ${
        detailsText
          ? `<details class="claude-transient-details">
               <summary>Details</summary>
               <div>
                 <code>${escapeHtml(detailsFirstLine || detailsText.slice(0, 240))}</code>
               </div>
             </details>`
          : ''
      }
      ${extraActionsHtml}
    </div>
    <div class="claude-transient-actions">
      <button class="btn-primary btn-sm claude-transient-retry">Retry</button>
      ${lastUserCheckpoint ? '<button class="btn-secondary btn-sm claude-transient-retry-ckpt">Retry (restore checkpoint)</button>' : ''}
      <button class="btn-secondary btn-sm claude-transient-dismiss2">Dismiss</button>
    </div>
  `;

  const dismiss = () => { try { card.remove(); } catch { /* ignore */ } };
  const dismissBtn = card.querySelector('.claude-transient-dismiss');
  const dismissBtn2 = card.querySelector('.claude-transient-dismiss2');
  if (dismissBtn) dismissBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(); });
  if (dismissBtn2) dismissBtn2.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(); });

  const retryBtn = card.querySelector('.claude-transient-retry');
  if (retryBtn) {
    if (retrySecs > 0) {
      retryBtn.disabled = true;
      retryBtn.textContent = `Retry (${retrySecs}s)`;
      const startedAt = Date.now();
      const tick = () => {
        if (!card.isConnected) return;
        const left = Math.max(0, retrySecs - Math.floor((Date.now() - startedAt) / 1000));
        retryBtn.textContent = left > 0 ? `Retry (${left}s)` : 'Retry';
        retryBtn.disabled = left > 0;
        if (left <= 0) {
          // Auto-retry only for true rate limits (optional), because it's the most user-friendly.
          if (String(kind || '') === 'rate_limit') {
            retryBtn.click();
          }
          return;
        }
        setTimeout(tick, 500);
      };
      setTimeout(tick, 500);
    }
    retryBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        retryBtn.disabled = true;
        const started = await retryLastUserMessageAfterTransientClaudeFailure(sid);
        // Dismiss as soon as retry actually starts (or is already running).
        if (started !== false) dismiss();
      } catch {
        // ignore (retry handler will surface its own errors)
      } finally {
        try { retryBtn.disabled = false; } catch { /* ignore */ }
      }
    });
  }

  // Copy requestId / diagnostics (Cursor-style: always available when provided)
  try {
    const btnReq = card.querySelector('.claude-transient-copy-request-id');
    if (btnReq && reqId) {
      btnReq.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(reqId);
          showToast('Request id copied');
        } catch {
          showToast('Failed to copy request id');
        }
      });
    }
  } catch { /* ignore */ }

  // Claude usage details shortcut (Claude.ai subscription message limit)
  try {
    const usageBtn = card.querySelector('.claude-transient-open-usage');
    if (usageBtn && window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
      usageBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await window.electronAPI.openExternal('https://claude.ai/settings/usage');
        } catch {
          // ignore
        }
      });
    }
  } catch { /* ignore */ }

  try {
    const btnDiag = card.querySelector('.claude-transient-copy-diagnostics');
    if (btnDiag && diagPayload && window.codeonClaudeDiagnostics && typeof window.codeonClaudeDiagnostics.formatForClipboard === 'function') {
      btnDiag.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const text = window.codeonClaudeDiagnostics.formatForClipboard(diagPayload);
          await navigator.clipboard.writeText(text);
          showToast('Diagnostics copied');
        } catch {
          showToast('Failed to copy diagnostics');
        }
      });
    }
  } catch { /* ignore */ }

  const retryCkptBtn = card.querySelector('.claude-transient-retry-ckpt');
  if (retryCkptBtn && lastUserCheckpoint) {
    retryCkptBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const ok = await customConfirm(
          `Retry from checkpoint?\n\nThis will restore your workspace to:\n${lastUserCheckpoint.substring(0, 7)}\n\nThen it will retry your last message with a fresh Claude session.`,
          'Retry (restore checkpoint)'
        );
        if (!ok) return;
        retryCkptBtn.disabled = true;
        const started = await retryLastUserMessageAfterTransientClaudeFailure(sid, {
          restoreToCheckpointHash: lastUserCheckpoint,
          forceNewClaudeSession: true
        });
        if (started !== false) dismiss();
      } catch {
        // ignore
      } finally {
        try { retryCkptBtn.disabled = false; } catch { /* ignore */ }
      }
    });
  }

  const openSettingsBtn = card.querySelector('.claude-transient-open-settings');
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { openSettings(); } catch { /* ignore */ }
    });
  }

  const fixPermBtn = card.querySelector('.claude-transient-fix-permissions');
  if (fixPermBtn) {
    fixPermBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        settings.permissionMode = 'acceptEdits';
        await saveSettings();
        showToast('Permission mode set to acceptEdits', 2400);
      } catch { /* ignore */ }
      try {
        // Immediately retry (this is the main point of the shortcut).
        const started = await retryLastUserMessageAfterTransientClaudeFailure(sid);
        if (started !== false) dismiss();
      } catch {
        // ignore
      }
    });
  }

  const fixNetBtn = card.querySelector('.claude-transient-fix-network');
  if (fixNetBtn) {
    fixNetBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        settings.networkPolicyMode = 'allow_all';
        // Keep allowlist (so user can flip back later); just relax mode.
        await saveSettings();
        showToast('Network policy set to allow_all', 2400);
      } catch { /* ignore */ }
      try {
        const started = await retryLastUserMessageAfterTransientClaudeFailure(sid);
        if (started !== false) dismiss();
      } catch {
        // ignore
      }
    });
  }

  // Append under the latest turn
  appendChatNode(messagesContainer, card, { roleHint: 'assistant' });
  try { smartScrollToBottom(messagesContainer); } catch { /* ignore */ }
}


function toRelativeProjectPath(absOrRelPath) {
  const raw = normalizePathSlashes(absOrRelPath).trim();
  if (!raw) return null;
  const root = normalizePathSlashes(window.currentFolder || '').replace(/\/+$/, '');
  if (!root) return null;

  // If absolute within project, convert to relative.
  if (raw.startsWith(root + '/')) {
    return raw.slice(root.length + 1);
  }
  // Already relative (best-effort)
  if (!raw.startsWith('/')) {
    return raw.replace(/^\.\//, '');
  }
  // Absolute but outside project -> reject
  return null;
}


async function addWorkspaceFileAttachment(pathStr) {
  if (!pathStr) return;
  if (!window.currentFolder) {
    alert('Please open a folder first');
    return;
  }

  const rel = toRelativeProjectPath(pathStr);
  if (!rel) {
    showToast('Only files inside the opened project can be attached', 3000);
    return;
  }

  const attachment = {
    id: Date.now() + Math.random(),
    name: basenameFromPath(rel),
    type: '',
    size: null,
    contentType: 'workspace_file',
    workspacePath: rel,
    // For Claude: this is already a project file path, so we can pass it directly to Read.
    savedPath: rel
  };

  const sid = currentSessionId;
  const list = getPendingAttachments(sid);
  setPendingAttachments(sid, [...list, attachment]);
  renderAttachmentPreview();
}

async function addWorkspaceFolderAttachment(pathStr) {
  if (!pathStr) return;
  if (!window.currentFolder) {
    alert('Please open a folder first');
    return;
  }

  const rel = toRelativeProjectPath(pathStr);
  if (!rel) {
    showToast('Only folders inside the opened project can be attached', 3000);
    return;
  }

  try {
    if (window.electronAPI && typeof window.electronAPI.getFileStats === 'function') {
      const res = await window.electronAPI.getFileStats(rel);
      if (!(res && res.success === true && res.stats && res.stats.isDirectory === true)) {
        showToast('Select a folder to attach', 2400);
        return;
      }
    }
  } catch {
    // ignore
  }

  const attachment = {
    id: Date.now() + Math.random(),
    name: basenameFromPath(rel),
    type: '',
    size: null,
    contentType: 'workspace_folder',
    workspacePath: rel,
    savedPath: rel
  };

  const sid = currentSessionId;
  const list = getPendingAttachments(sid);
  setPendingAttachments(sid, [...list, attachment]);
  renderAttachmentPreview();
}


// OpenRouter models with vision/image support (stable selection)
const OPENROUTER_VISION_MODELS = [
  'anthropic/claude-opus-4.8',
  'anthropic/claude-opus-4.8-fast',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-opus-4.5',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.5-pro',
  'openai/gpt-5.5',
  'openai/gpt-5.4',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.3-codex',
  'openai/gpt-5.2-codex',
  'openai/gpt-5.2',
  'google/gemini-3.5-flash',
  'google/gemini-3.1-pro-preview',
  'google/gemini-3.1-flash-lite',
  'google/gemini-3-pro-preview',
  'x-ai/grok-4.3',
  'x-ai/grok-4.20'
];

async function addAttachment(file) {
  const maxSize = 20 * 1024 * 1024; // 20MB limit
  if (file.size > maxSize) {
    showToast(`File "${file.name}" is too large. Maximum size is 20MB.`);
    return;
  }

  const attachment = {
    id: Date.now() + Math.random(),
    name: file.name,
    type: file.type,
    size: file.size
    // file: file - REMOVED: raw File object causes "clone" errors in IPC/JSON serialization
  };

  // Read file content
  if (file.type.startsWith('image/')) {
    // Check if using OpenRouter with a model that doesn't support vision
    if (settings && settings.llmProvider === 'openrouter') {
      const currentModel = settings.openrouterModel || '';
      if (!OPENROUTER_VISION_MODELS.includes(currentModel)) {
        const modelName = currentModel.split('/').pop() || 'Selected model';
        showToast(`❌ Image not supported: "${modelName}" doesn't support images. Switch to a vision model (📷) in Settings.`);
        return; // Block the attachment
      }
    }
    
    // For images, create base64 data URL
    attachment.dataUrl = await readFileAsDataURL(file);
    attachment.contentType = 'image';
  } else if (file.type === 'application/pdf') {
    attachment.dataUrl = await readFileAsDataURL(file);
    attachment.contentType = 'pdf';
  } else {
    // For text files, read as text
    attachment.text = await readFileAsText(file);
    attachment.contentType = 'text';
  }

  const sid = currentSessionId;
  const list = getPendingAttachments(sid);
  setPendingAttachments(sid, [...list, attachment]);
  renderAttachmentPreview();
}


function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}


function sanitizeAttachmentFileName(name) {
  const base = String(name || 'attachment')
    .replace(/[\\/]/g, '_')
    .replace(/[^\w.\-()\s]/g, '_')
    .trim();
  return base.length > 120 ? base.slice(0, 120) : base;
}


function inferLangFromPath(p) {
  const fp = String(p || '').toLowerCase();
  const lid = detectMonacoLanguageFromPath(fp);
  // Map Monaco language ids to common markdown fence hints (best-effort).
  const map = {
    javascript: 'javascript',
    typescript: 'typescript',
    python: 'python',
    html: 'html',
    css: 'css',
    json: 'json',
    markdown: 'markdown',
    xml: 'xml',
    yaml: 'yaml',
    shell: 'bash',
    c: 'c',
    cpp: 'cpp',
    java: 'java',
    go: 'go',
    rust: 'rust',
    php: 'php',
    ruby: 'ruby',
    swift: 'swift',
    kotlin: 'kotlin',
    sql: 'sql',
    csharp: 'csharp',
    dart: 'dart',
    lua: 'lua',
    r: 'r',
    scala: 'scala',
    toml: 'toml'
  };
  return map[lid] || '';
}


function addPastedCodeAttachment({ absPath = '', relPath = '', startLine = 0, endLine = 0, code = '' } = {}) {
  try {
    const sid = currentSessionId;
    if (!sid) return;
    const abs = normalizeFsPath(String(absPath || '').trim());
    const rel = String(relPath || '').trim();
    const s = Math.max(0, Number(startLine || 0));
    const e = Math.max(0, Number(endLine || 0));
    const snippet = String(code || '');
    if (!snippet.trim()) return;

    const pathLabel = rel || abs || 'pasted';
    const base = basenameFromPath(pathLabel);
    const rangeLabel = (s > 0 && e > 0) ? ` (${s}-${e})` : '';
    // Prefer showing the relative path in the pill name (helps the AI locate code precisely).
    const display = rel ? `${rel}${rangeLabel}` : `${base}${rangeLabel}`;
    const lang = inferLangFromPath(pathLabel);

    // Keep recent code pills bounded to avoid clutter.
    const prev = getPendingAttachments(sid);
    const other = prev.filter(a => a && a.contentType !== 'pasted_code');
    const existingPills = prev.filter(a => a && a.contentType === 'pasted_code');
    const kept = existingPills.slice(-4); // keep last 4, add one => 5 max

    const headerLines = [];
    headerLines.push('Pasted code context');
    if (rel) headerLines.push(`File (relative): ${rel}`);
    if (abs) headerLines.push(`File (absolute): ${abs}`);
    if (s > 0 && e > 0) headerLines.push(`Range: L${s}-L${e}`);
    if (lang) headerLines.push(`Language: ${lang}`);

    const text =
      `${headerLines.join('\n')}\n\n` +
      `Code:\n` +
      `\n\`\`\`${lang}\n${snippet.replace(/\s+$/g, '')}\n\`\`\`\n`;

    const attachment = {
      id: Date.now() + Math.random(),
      name: display,
      type: 'text/plain',
      size: text.length,
      contentType: 'pasted_code',
      text,
      meta: { absPath: abs, relPath: rel, startLine: s, endLine: e, lang }
    };

    setPendingAttachments(sid, [...other, ...kept, attachment]);
    renderAttachmentPreview();
  } catch {
    // ignore
  }
}


function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || '');
  const m = raw.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

function inferMimeTypeFromPath(name) {
  const raw = String(name || '').toLowerCase();
  if (raw.endsWith('.png')) return 'image/png';
  if (raw.endsWith('.jpg') || raw.endsWith('.jpeg')) return 'image/jpeg';
  if (raw.endsWith('.gif')) return 'image/gif';
  if (raw.endsWith('.webp')) return 'image/webp';
  if (raw.endsWith('.bmp')) return 'image/bmp';
  if (raw.endsWith('.svg')) return 'image/svg+xml';
  if (raw.endsWith('.pdf')) return 'application/pdf';
  return '';
}

function isVisionAttachment(att) {
  if (!att) return false;
  const ct = String(att.contentType || '').trim();
  if (ct === 'image' || ct === 'pdf') return true;
  const candidate =
    (typeof att.savedPath === 'string' && att.savedPath.trim())
      ? att.savedPath
      : (typeof att.workspacePath === 'string' && att.workspacePath.trim())
        ? att.workspacePath
        : att.name;
  const kind = inferKindFromPath(candidate || '');
  return kind === 'image' || kind === 'pdf';
}

async function getAttachmentDataUrl(att) {
  if (!att) return '';
  const raw = typeof att.dataUrl === 'string' ? att.dataUrl.trim() : '';
  if (raw && raw.startsWith('data:')) return raw;
  const relPath =
    (typeof att.savedPath === 'string' && att.savedPath.trim())
      ? att.savedPath.trim()
      : (typeof att.workspacePath === 'string' && att.workspacePath.trim())
        ? att.workspacePath.trim()
        : '';
  if (!relPath || !window.electronAPI || typeof window.electronAPI.readFile !== 'function') return '';
  const res = await window.electronAPI.readFile(relPath);
  if (!res || res.success !== true || !res.isBase64 || !res.content) return '';
  const mime =
    inferMimeTypeFromPath(relPath) ||
    (typeof att.type === 'string' && att.type.trim() ? att.type.trim() : '') ||
    (String(att.contentType || '') === 'pdf' ? 'application/pdf' : 'application/octet-stream');
  return `data:${mime};base64,${res.content}`;
}

async function buildOpenRouterVisionSummaries(attachments, sessionId = null) {
  try {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    if (!settings || settings.llmProvider !== 'openrouter') return [];
    const model = typeof settings.openrouterModel === 'string' ? settings.openrouterModel.trim() : '';
    const apiKey = typeof settings.openrouterApiKey === 'string' ? settings.openrouterApiKey.trim() : '';
    if (!model || !apiKey) return [];
    if (!OPENROUTER_VISION_MODELS.includes(model)) return [];
    if (!window.electronAPI || typeof window.electronAPI.openrouterDescribeImage !== 'function') return [];

    const sid = String(sessionId || currentSessionId || '').trim();
    const visionAttachments = attachments.filter(isVisionAttachment);
    if (visionAttachments.length === 0) return [];

    const summaries = [];
    for (const att of visionAttachments) {
      if (att && typeof att.openrouterVisionSummary === 'string' && att.openrouterVisionSummary.trim()) {
        summaries.push({
          name: String(att.name || att.workspacePath || 'image'),
          description: att.openrouterVisionSummary.trim()
        });
        continue;
      }

      const dataUrl = await getAttachmentDataUrl(att);
      if (!dataUrl) {
        window.addConsoleMessage?.(`Failed to load image attachment "${att?.name || 'image'}" for OpenRouter vision`, 'warn', sid);
        continue;
      }

      const prompt =
        att && String(att.contentType || '') === 'pdf'
          ? 'Summarize the key visible content in this PDF. Focus on headings, key data, and any readable text.'
          : 'Describe this image factually. Include any visible text and UI labels if present.';
      const resp = await window.electronAPI.openrouterDescribeImage({
        apiKey,
        model,
        dataUrl,
        prompt
      });
      if (resp && resp.success === true && typeof resp.description === 'string' && resp.description.trim()) {
        const description = resp.description.trim();
        try { att.openrouterVisionSummary = description; } catch { /* ignore */ }
        summaries.push({
          name: String(att.name || att.workspacePath || 'image'),
          description
        });
      } else {
        const err = resp && resp.error ? String(resp.error) : 'OpenRouter vision failed';
        window.addConsoleMessage?.(`OpenRouter vision failed for "${att?.name || 'image'}": ${err}`, 'warn', sid);
      }
    }

    return summaries;
  } catch {
    return [];
  }
}

async function _relPathExists(relPath, kind = 'file') {
  try {
    const rp = String(relPath || '').trim();
    if (!rp) return false;
    if (!window.electronAPI || typeof window.electronAPI.getFileStats !== 'function') return false;
    const res = await window.electronAPI.getFileStats(rp);
    const stats = res && res.success === true ? res.stats : null;
    if (!stats) return false;
    if (kind === 'directory') return stats.isDirectory === true;
    return stats.isFile === true;
  } catch {
    return false;
  }
}

function _parentDirFromRelPath(relPath) {
  const s = String(relPath || '').replace(/\\/g, '/');
  const idx = s.lastIndexOf('/');
  if (idx <= 0) return '';
  return s.slice(0, idx);
}

async function materializeAttachmentsForClaude(attachments, sessionId = null) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  if (!window.electronAPI || !window.currentFolder) return [];

  const sid = String(sessionId || window.currentSessionId || '').trim();
  if (!sid) return [];

  const dirRel = `.ai-agent/attachments/${sid}`;

  try {
      if (typeof window.electronAPI.createDirectory !== 'function') return [];
      const cres = await window.electronAPI.createDirectory(dirRel);
      if (!cres || cres.success !== true) return [];
  } catch {
    // ignore
  }

  const saved = [];
  for (const att of attachments) {
    if (!att || !att.name) continue;

    // If this attachment already points to a project file path (e.g. dragged from the workspace file tree),
    // or it was previously materialized, reuse it directly.
    if (typeof att.savedPath === 'string' && att.savedPath.trim()) {
      const relPath = att.savedPath.trim();
      const isFolder = att.contentType === 'workspace_folder';
      const exists = await _relPathExists(relPath, isFolder ? 'directory' : 'file');
      if (exists) {
        const kind = att.contentType === 'workspace_folder'
          ? 'folder'
          : (att.contentType === 'workspace_file'
            ? inferKindFromPath(relPath)
            : ((att.contentType === 'problem_context' || att.contentType === 'pasted_code') ? 'text' : (att.contentType || inferKindFromPath(relPath))));
        saved.push({ relPath, kind });
        continue;
      }

      // Restore flow uses `git stash --include-untracked`, which removes untracked files in `.ai-agent/attachments/...`.
      // After a checkpoint restore, `savedPath` can point to a file the user still *sees* (via dataUrl) but that
      // no longer exists on disk. Rehydrate it from the in-memory payload when possible.
      try {
        const parent = _parentDirFromRelPath(relPath);
        if (parent && typeof window.electronAPI.createDirectory === 'function') {
          await window.electronAPI.createDirectory(parent);
        }

        const isTextLike = att.contentType === 'text' || att.contentType === 'problem_context' || att.contentType === 'pasted_code';
        if (isTextLike) {
          const text = typeof att.text === 'string' ? att.text : '';
          if (text) {
            const wr = await window.electronAPI.writeFile(relPath, text, false);
            if (wr && wr.success === true) {
              saved.push({ relPath, kind: 'text' });
              continue;
            }
          }
        }

        if (att.contentType === 'image' || att.contentType === 'pdf') {
          const parsed = parseDataUrl(att.dataUrl);
          if (parsed && parsed.base64) {
            const wr = await window.electronAPI.writeFile(relPath, parsed.base64, true);
            if (wr && wr.success === true) {
              saved.push({ relPath, kind: att.contentType, mediaType: parsed.mediaType });
              continue;
            }
          }
        }

        // Workspace file/folder paths can't be rehydrated if they were removed by restore.
        if (att.contentType === 'workspace_file' || att.contentType === 'workspace_folder') {
          showToast(`⚠️ Attachment missing after restore: "${relPath}". Please re-attach it.`);
          continue;
        }
      } catch {
        // ignore; fall through to materialize a new file if possible
      }

      // Fall back: clear savedPath so we can rematerialize to a new file path below.
      try { att.savedPath = ''; } catch { /* ignore */ }
    }

    if (att.contentType === 'workspace_file' && typeof att.workspacePath === 'string' && att.workspacePath.trim()) {
      const relPath = att.workspacePath.trim();
      att.savedPath = relPath;
      saved.push({ relPath, kind: inferKindFromPath(relPath) });
      continue;
    }
    if (att.contentType === 'workspace_folder' && typeof att.workspacePath === 'string' && att.workspacePath.trim()) {
      const relPath = att.workspacePath.trim();
      att.savedPath = relPath;
      saved.push({ relPath, kind: 'folder' });
      continue;
    }

    const safeName = sanitizeAttachmentFileName(att.name);
    const stamp = Date.now();
    const isTextLike = att.contentType === 'text' || att.contentType === 'problem_context' || att.contentType === 'pasted_code';
    const fileName = isTextLike
      ? (safeName.toLowerCase().endsWith('.txt') ? safeName : `${safeName}.txt`)
      : safeName;
    const relPath = `${dirRel}/${stamp}_${fileName}`;

    try {
      if (att.contentType === 'text' || att.contentType === 'problem_context' || att.contentType === 'pasted_code') {
        const text = typeof att.text === 'string' ? att.text : '';
        const wr = await window.electronAPI.writeFile(relPath, text, false);
        if (!wr || wr.success !== true) throw new Error(wr?.error || 'write failed');
        att.savedPath = relPath;
        saved.push({ relPath, kind: 'text' });
        continue;
      }

      if (att.contentType === 'image' || att.contentType === 'pdf') {
        const parsed = parseDataUrl(att.dataUrl);
        if (!parsed || !parsed.base64) continue;
        const wr = await window.electronAPI.writeFile(relPath, parsed.base64, true);
        if (!wr || wr.success !== true) throw new Error(wr?.error || 'write failed');
        att.savedPath = relPath;
        saved.push({ relPath, kind: att.contentType, mediaType: parsed.mediaType });
        continue;
      }
    } catch (e) {
      window.addConsoleMessage?.(`Failed to save attachment "${att.name}": ${e?.message || String(e)}`, 'error', sid);
    }
  }

  return saved;
}


function isComposerInlineAttachment(att) {
  const ct = String(att?.contentType || '').trim();
  return ct === 'workspace_file' || ct === 'workspace_folder';
}

function getComposerInlineAttachmentDisplay(att) {
  const raw = typeof att?.workspacePath === 'string' && att.workspacePath.trim()
    ? String(att.workspacePath).trim()
    : String(att?.name || '').trim();
  return raw || '';
}

function buildComposerInlineAttachmentSummary(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const folders = list.filter(a => a && a.contentType === 'workspace_folder');
  const files = list.filter(a => a && a.contentType === 'workspace_file');
  if (folders.length === 0 && files.length === 0) return '';
  const lines = [];
  if (folders.length > 0) {
    const names = folders.map(a => `"${getComposerInlineAttachmentDisplay(a)}"`).join(', ');
    lines.push(`Attached folder${folders.length > 1 ? 's' : ''}: ${names}`);
    if (folders.length === 1) {
      lines.push(`When I say "this folder", I mean "${getComposerInlineAttachmentDisplay(folders[0])}".`);
    }
  }
  if (files.length > 0) {
    const names = files.map(a => `"${getComposerInlineAttachmentDisplay(a)}"`).join(', ');
    lines.push(`Attached file${files.length > 1 ? 's' : ''}: ${names}`);
  }
  return lines.join('\n');
}

function renderComposerInlineChips(attachments) {
  const host = document.getElementById('composerInlineChips');
  if (!host) return;
  const list = Array.isArray(attachments) ? attachments : [];
  const inline = list.filter(isComposerInlineAttachment);
  if (!inline.length) {
    host.style.display = 'none';
    host.innerHTML = '';
    return;
  }

  const folderSvg = `<svg class="composer-inline-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const fileSvg = `<svg class="composer-inline-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;

  host.style.display = 'flex';
  host.innerHTML = inline.map(att => {
    const isFolder = att.contentType === 'workspace_folder';
    const display = getComposerInlineAttachmentDisplay(att);
    const label = isFolder ? 'Folder' : 'File';
    return `
      <span class="composer-inline-chip ${isFolder ? 'workspace_folder' : 'workspace_file'}" data-id="${att.id}" title="${escapeAttr(display)}">
        ${isFolder ? folderSvg : fileSvg}
        <span class="composer-inline-chip-label">${label}</span>
        <span class="composer-inline-chip-name">${escapeHtml(display)}</span>
        <button class="composer-inline-chip-remove" data-id="${att.id}" title="Remove">×</button>
      </span>
    `;
  }).join('');

  host.querySelectorAll('.composer-inline-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseFloat(btn.dataset.id);
      const sid = currentSessionId;
      const next = getPendingAttachments(sid).filter(a => a.id !== id);
      setPendingAttachments(sid, next);
      renderAttachmentPreview();
    });
  });
}

try { window.buildComposerInlineAttachmentSummary = buildComposerInlineAttachmentSummary; } catch { /* ignore */ }


function renderAttachmentPreview() {
  const previewArea = document.getElementById('attachmentPreview');
  const pendingAttachments = getPendingAttachments(currentSessionId);
  renderComposerInlineChips(pendingAttachments);
  const previewAttachments = pendingAttachments.filter(att => !isComposerInlineAttachment(att));

  if (previewAttachments.length === 0) {
    previewArea.style.display = 'none';
    return;
  }

  previewArea.style.display = 'flex';
  previewArea.innerHTML = '';

  previewAttachments.forEach(attachment => {
    const item = document.createElement('div');
    item.className = `attachment-item ${attachment.contentType}`;

    if (attachment.contentType === 'image' && attachment.dataUrl) {
      const safeName = String(attachment.name || 'image').trim() || 'image';
      item.innerHTML = `
        <div class="attachment-pill-row">
          <img src="${attachment.dataUrl}" class="attachment-pill-thumb" alt="${escapeAttr(safeName)}">
          <span class="attachment-pill-name" title="${escapeAttr(safeName)}">${escapeHtml(safeName)}</span>
          <button class="attachment-remove" data-id="${attachment.id}" title="Remove">×</button>
        </div>
      `;
    } else if (attachment.contentType === 'problem_context') {
      // Cursor-like context pill (compact)
      item.innerHTML = `
        <div class="attachment-pill-row">
          <span class="attachment-pill-badge">Context</span>
          <span class="attachment-pill-name" title="${escapeAttr(attachment.name)}">${escapeHtml(attachment.name)}</span>
          <button class="attachment-remove" data-id="${attachment.id}" title="Remove">×</button>
        </div>
      `;
    } else if (attachment.contentType === 'pasted_code') {
      item.innerHTML = `
        <div class="attachment-pill-row">
          <span class="attachment-pill-badge">Code</span>
          <span class="attachment-pill-name" title="${escapeAttr(attachment.name)}">${escapeHtml(attachment.name)}</span>
          <button class="attachment-remove" data-id="${attachment.id}" title="Remove">×</button>
        </div>
      `;
    } else if (attachment.contentType === 'workspace_file') {
      const display = attachment.workspacePath || attachment.name;
      item.innerHTML = `
        <div class="attachment-pill-row">
          <span class="attachment-pill-badge">File</span>
          <span class="attachment-pill-name" title="${escapeAttr(display)}">${escapeHtml(display)}</span>
          <button class="attachment-remove" data-id="${attachment.id}" title="Remove">×</button>
        </div>
      `;
    } else if (attachment.contentType === 'workspace_folder') {
      const display = attachment.workspacePath || attachment.name;
      item.innerHTML = `
        <div class="attachment-pill-row">
          <span class="attachment-pill-badge">Folder</span>
          <span class="attachment-pill-name" title="${escapeAttr(display)}">${escapeHtml(display)}</span>
          <button class="attachment-remove" data-id="${attachment.id}" title="Remove">×</button>
        </div>
      `;
    } else {
      const icon = attachment.contentType === 'pdf' ? '📄' : '📝';
      item.innerHTML = `
        <button class="attachment-remove" data-id="${attachment.id}">×</button>
        <div class="attachment-info" style="flex-direction: column; align-items: center; text-align: center; gap: var(--spacing-sm);">
          <span class="attachment-icon">${icon}</span>
          <span class="attachment-name" title="${attachment.name}">${attachment.name}</span>
        </div>
      `;
    }

    previewArea.appendChild(item);
  });

  // Auto-scroll to the end to show the newly added item
  setTimeout(() => {
    previewArea.scrollLeft = previewArea.scrollWidth;
  }, 100);

  // Add remove handlers
  previewArea.querySelectorAll('.attachment-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseFloat(btn.dataset.id);
      const sid = currentSessionId;
      const next = getPendingAttachments(sid).filter(a => a.id !== id);
      setPendingAttachments(sid, next);
      renderAttachmentPreview();
    });
  });
}


function clearAttachments(sessionId = currentSessionId) {
  const sid = sessionId || currentSessionId;
  if (!sid) return;
  setPendingAttachments(sid, []);
  // Only re-render the preview panel if we're clearing attachments for the active tab.
  if (sid === currentSessionId) {
    renderAttachmentPreview();
  }
}


function addCodeBlockActions(messageDiv) {
  const codeBlocks = messageDiv.querySelectorAll('.code-block-container');

  codeBlocks.forEach(container => {
    // Prevent duplicate buttons
    if (container.querySelector('.code-actions')) return;

    const code = container.querySelector('code');
    if (!code) return;

    // Get code content from data-code attribute (encoded) or fallback to text content
    const dataCode = code.getAttribute('data-code');
    const codeContent = dataCode ? decodeURIComponent(dataCode) : code.textContent || '';
    if (!codeContent.trim()) return;

    // Create copy button only
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'code-actions';
    actionsDiv.innerHTML = `
      <button class="code-action-btn" title="Copy to clipboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy
      </button>
    `;

    container.insertBefore(actionsDiv, container.firstChild);

    // Add event listener
    const copyBtn = actionsDiv.querySelector('.code-action-btn');
    copyBtn.addEventListener('click', () => copyCodeToClipboard(codeContent, copyBtn));
  });
}


function copyCodeToClipboard(code, button) {
  navigator.clipboard.writeText(code).then(() => {
    const originalText = button.innerHTML;
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Copied!
    `;
    setTimeout(() => {
      button.innerHTML = originalText;
    }, 2000);
  });
}


function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}


async function openFullDiffForRelPath(relPath) {
  const rel = normalizeRelPathForDiffPreview(relPath);
  if (!rel || !window.currentFolder) return;

  const abs = resolveToWorkspaceAbsPath(rel);
  
  // PRIORITY 1: Use cached diff content to reconstruct original file
  // This works even when git doesn't have the history (new files, auto-committed changes)
  const cached = lastDiffByRelPath && lastDiffByRelPath[rel] ? lastDiffByRelPath[rel] : null;
  if (cached && cached.diffContent && cached.diffContent.trim()) {
    const success = await openDiffFromCachedContent(abs, rel, cached.diffContent);
    if (success) {
      // SYNC: Reveal file in explorer when diff is opened
      try {
        if (window.FileSyncController?.revealFileInExplorer) {
          window.FileSyncController.revealFileInExplorer(abs);
        } else if (typeof explorerRevealAbsPath === 'function') {
          explorerRevealAbsPath(abs);
        }
      } catch { /* ignore */ }
      return;
    }
  }

  // PRIORITY 2: Use git commit reference if available
  const base = getLastApplyBeforeCommitForSession(currentSessionId);
  if (base) {
    await openGitDiffForFile(abs, base);
    // SYNC: Reveal file in explorer
    try {
      if (window.FileSyncController?.revealFileInExplorer) {
        window.FileSyncController.revealFileInExplorer(abs);
      } else if (typeof explorerRevealAbsPath === 'function') {
        explorerRevealAbsPath(abs);
      }
    } catch { /* ignore */ }
    return;
  }

  // FALLBACK: show HEAD ↔ workspace
  await openGitDiffForFile(abs, 'HEAD');
  // SYNC: Reveal file in explorer
  try {
    if (window.FileSyncController?.revealFileInExplorer) {
      window.FileSyncController.revealFileInExplorer(abs);
    } else if (typeof explorerRevealAbsPath === 'function') {
      explorerRevealAbsPath(abs);
    }
  } catch { /* ignore */ }
}

/**
 * Open diff view using cached diff content by reconstructing the original file.
 * This works even when git doesn't have the history.
 * 
 * @param {string} absPath - Absolute path to the file
 * @param {string} relPath - Relative path for display
 * @param {string} diffContent - Unified diff content
 * @returns {boolean} - True if successfully opened, false otherwise
 */
async function openDiffFromCachedContent(absPath, relPath, diffContent) {
  try {
    // Read current file content
    const readResult = await window.electronAPI.readFile(absPath);
    if (!readResult?.success) return false;
    const currentContent = String(readResult.content || '');
    
    // Reconstruct original by reverse-applying the diff
    const originalContent = reverseApplyUnifiedDiff(currentContent, diffContent);
    if (originalContent === null) return false; // Could not apply diff
    
    // If both are identical, the diff might be stale - fall back to git
    if (originalContent === currentContent) return false;

    // Open the diff editor with reconstructed original vs current
    const editorEl = document.getElementById('editor');
    const diffEditorEl = document.getElementById('diffEditor');
    if (!editorEl || !diffEditorEl || !diffEditor) return false;

    // Hide regular editor, show diff editor
    editorEl.style.display = 'none';
    diffEditorEl.style.display = 'block';

    const lang = typeof detectMonacoLanguageFromPath === 'function' 
      ? detectMonacoLanguageFromPath(absPath) 
      : 'plaintext';

    // Dispose previous diff models
    try { diffModels?.original?.dispose?.(); } catch { /* ignore */ }
    try { diffModels?.modified?.dispose?.(); } catch { /* ignore */ }
    diffModels = null;

    const originalModel = monaco.editor.createModel(originalContent, lang);
    const modifiedModel = monaco.editor.createModel(currentContent, lang);
    diffModels = { original: originalModel, modified: modifiedModel };
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });

    if (typeof setTopFilePathLabel === 'function') {
      setTopFilePathLabel(`${relPath} (diff)`);
    }
    try { diffEditor.layout(); } catch { /* ignore */ }

    // SYNC: Set diff state in FileSyncController for pseudo-tab tracking
    try {
      if (window.FileSyncController?.setDiffState) {
        window.FileSyncController.setDiffState({
          absPath,
          relPath,
          originalContent,
          modifiedContent: currentContent,
          diffContent,
          baseRef: null,
          isVirtual: true
        });
      }
    } catch { /* ignore */ }

    return true;
  } catch (e) {
    console.warn('[openDiffFromCachedContent] Error:', e);
    return false;
  }
}

/**
 * Reverse-apply a unified diff to reconstruct the original file from the current file.
 * 
 * In a unified diff:
 * - Lines starting with '+' were ADDED (in current, not in original)
 * - Lines starting with '-' were REMOVED (in original, not in current)
 * - Lines starting with ' ' are context (in both)
 * 
 * @param {string} currentContent - Current file content
 * @param {string} diffContent - Unified diff content
 * @returns {string|null} - Original file content, or null if could not apply
 */
function reverseApplyUnifiedDiff(currentContent, diffContent) {
  try {
    const currentLines = currentContent.split('\n');
    const result = [];
    let currentLineIndex = 0;
    
    // Parse unified diff hunks
    const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
    const diffLines = diffContent.split('\n');
    
    let i = 0;
    while (i < diffLines.length) {
      const line = diffLines[i];
      
      // Find hunk header
      const match = line.match(hunkRegex);
      if (match) {
        // @@ -oldStart,oldCount +newStart,newCount @@
        // newStart is where the hunk starts in the NEW (current) file
        const newStart = parseInt(match[3], 10); // 1-indexed
        
        // Copy lines from current file up to where this hunk starts
        while (currentLineIndex < newStart - 1 && currentLineIndex < currentLines.length) {
          result.push(currentLines[currentLineIndex]);
          currentLineIndex++;
        }
        
        // Process hunk lines
        i++;
        while (i < diffLines.length) {
          const hunkLine = diffLines[i];
          
          // Stop at next hunk header or diff metadata
          if (hunkLine.match(hunkRegex) || 
              hunkLine.startsWith('diff ') || 
              hunkLine.startsWith('---') || 
              hunkLine.startsWith('+++') ||
              hunkLine.startsWith('index ')) {
            break;
          }
          
          if (hunkLine.startsWith('+')) {
            // Line was ADDED in current - skip it, advance current pointer
            currentLineIndex++;
          } else if (hunkLine.startsWith('-')) {
            // Line was REMOVED from original - add it back to result
            result.push(hunkLine.substring(1));
          } else if (hunkLine.startsWith(' ')) {
            // Context line - exists in both, copy from current and advance
            result.push(currentLines[currentLineIndex] || hunkLine.substring(1));
            currentLineIndex++;
          } else if (hunkLine.startsWith('\\')) {
            // "\ No newline at end of file" - ignore
          } else if (hunkLine.trim() === '') {
            // Empty line in diff (context) - copy from current
            result.push(currentLines[currentLineIndex] || '');
            currentLineIndex++;
          }
          i++;
        }
        continue;
      }
      i++;
    }
    
    // Copy remaining lines after last hunk
    while (currentLineIndex < currentLines.length) {
      result.push(currentLines[currentLineIndex]);
      currentLineIndex++;
    }
    
    return result.join('\n');
  } catch (e) {
    console.warn('[reverseApplyUnifiedDiff] Error:', e);
    return null;
  }
}


async function handleWorkspaceFilesChanged(data) {
  // Keep it cheap: only act when we know what changed.
  const changed = Array.isArray(data?.changed) ? data.changed : [];
  if (!window.currentFolder) return;

  // If watcher overflowed or didn't include paths, avoid doing expensive full scans.
  if (!changed || changed.length === 0) {
    // Best-effort: refresh the currently active tab if it's clean.
    const tab = findTabByKey(activeEditorTabKey);
    if (tab && !isTabDirty(tab)) {
      try {
        const res = await window.electronAPI.readFile(tab.absPath);
        if (res?.success) {
          suppressModelDirtyTracking = true;
          try { invalidateDiffDecorations(tab); } catch { /* ignore */ }
          tab.model.setValue(String(res.content || ''));
          tab.savedVersionId = tab.model.getAlternativeVersionId();
          tab.conflictOnDisk = false;
          try { syncDiffDecorationsForTab(tab); } catch { /* ignore */ }
        }
      } catch {
        // ignore
      } finally {
        suppressModelDirtyTracking = false;
      }
      renderEditorTabs();
    }
    return;
  }

  // Convert rel -> abs and update any open tabs.
  const root = String(window.currentFolder || '').replace(/\/+$/, '');
  const changedAbs = new Set(
    changed
      .map(p => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').trim())
      .filter(Boolean)
      .map(rel => joinFsPath(root, rel))
  );

  let showedDirtyConflictToast = false;
  for (const tab of editorTabs) {
    if (!tab || !tab.absPath || !tab.model) continue;
    const abs = normalizeFsPath(tab.absPath);
    if (!changedAbs.has(abs)) continue;

    // If a file is currently being "typed" into Monaco by our AI streaming animation,
    // skip hot-reloading it from disk to avoid instantly overwriting the animation.
    try {
      const set = window.__codeonActiveCodeStreamingPaths;
      if (set && set instanceof Set) {
        if (set.has(abs) || set.has(getRelPath(abs))) continue;
      }
    } catch { /* ignore */ }

    // If user has unsaved edits, never clobber. Mark conflict so UI can show a red dot.
    if (isTabDirty(tab)) {
      tab.conflictOnDisk = true;
      if (!showedDirtyConflictToast) {
        showedDirtyConflictToast = true;
        showToast('Some open files changed on disk while you have unsaved edits (kept your local changes).');
      }
      continue;
    }

    // Clean tab: hot-reload content immediately (this fixes the “agent changed file but editor didn’t update” issue).
    try {
      const res = await window.electronAPI.readFile(abs);
      if (res?.success) {
        suppressModelDirtyTracking = true;
        try { invalidateDiffDecorations(tab); } catch { /* ignore */ }
        tab.model.setValue(String(res.content || ''));
        tab.savedVersionId = tab.model.getAlternativeVersionId();
        tab.conflictOnDisk = false;
        try { syncDiffDecorationsForTab(tab); } catch { /* ignore */ }
        // Update language in case extension changed (rename, etc.)
        try {
          const lang = res.language || detectMonacoLanguageFromPath(abs);
          monaco.editor.setModelLanguage(tab.model, lang);
        } catch { /* ignore */ }
      }
    } catch {
      // ignore
    } finally {
      suppressModelDirtyTracking = false;
    }
  }

  renderEditorTabs();

  // If Problems is enabled, re-scan (debounced) when relevant files change so badge updates live.
  try {
    const relevant = changed.some(p => isProjectScanLanguage(String(p || '')));
    if (relevant) scheduleProjectProblemsScan('fs-change');
  } catch { /* ignore */ }
}


// (Removed) token counter + cost tracking (Claude SDK wrapper)

// (Removed) indexing overlay (Claude SDK wrapper)

function showTypingIndicator(sessionId = currentSessionId) {
  // Session-scoped: show the status banner above the composer.
  if (sessionId && sessionId !== currentSessionId) return null;
  const banner = document.getElementById('chatStatusBanner');
  if (!banner) return null;
  banner.style.display = 'flex';
  // Default text; real-time events will overwrite this while the run is active.
  try {
    const textEl = banner.querySelector('.status-banner-text');
    if (textEl) textEl.textContent = 'Thinking…';
  } catch { /* ignore */ }
  return `banner-${sessionId || 'unknown'}`;
}


function removeTypingIndicator(_id) {
  const banner = document.getElementById('chatStatusBanner');
  if (banner) banner.style.display = 'none';
}
