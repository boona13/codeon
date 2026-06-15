// ============================================================================
// STREAM JOURNAL (Workspace storage, high-frequency, small payload)
// ============================================================================
// PERF: This writes the full streamed text/thinking via IPC. Keep it low-frequency to avoid UI jank
// during tool-heavy runs (especially with multiple open chat tabs).
const STREAM_JOURNAL_DEBOUNCE_MS = 700;
let streamJournalTimerBySession = {}; // { [sid]: timeoutId }
let streamJournalLastSigBySession = {}; // { [sid]: string }

function streamJournalKey(sessionId) {
  return `${CODEON_CHAT_STREAM_KEY_PREFIX}${String(sessionId || '').trim()}`;
}

function scheduleStreamJournalPersist(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !window.electronAPI || !currentFolder) return;
  const st = getRunState(sid);
  if (!st || st.isProcessing !== true) return;
  if (streamJournalTimerBySession[sid]) return;

  streamJournalTimerBySession[sid] = setTimeout(async () => {
    try {
      const st2 = getRunState(sid);
      if (!st2 || st2.isProcessing !== true) return;
      const rid = String(st2.requestId || '').trim();
      const text = String(st2.stream?.text || '');
      const thinking = String(st2.stream?.thinking || '');
      const sig = `${rid}|t:${text.length}|k:${thinking.length}|u:${Number(st2.stream?.lastUpdatedAt || 0)}`;
      if (streamJournalLastSigBySession[sid] === sig) return;
      streamJournalLastSigBySession[sid] = sig;
      await window.electronAPI.storageStoreObject(currentFolder, streamJournalKey(sid), {
        v: 1,
        sessionId: sid,
        requestId: rid,
        text,
        thinking,
        updatedAt: Date.now()
      });
    } catch {
      // ignore
    } finally {
      try { clearTimeout(streamJournalTimerBySession[sid]); } catch { /* ignore */ }
      delete streamJournalTimerBySession[sid];
    }
  }, STREAM_JOURNAL_DEBOUNCE_MS);
}

async function clearStreamJournal(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !window.electronAPI || !currentFolder) return;
  try { await window.electronAPI.storageRemoveKey(currentFolder, streamJournalKey(sid)); } catch { /* ignore */ }
  delete streamJournalLastSigBySession[sid];
  if (streamJournalTimerBySession[sid]) {
    try { clearTimeout(streamJournalTimerBySession[sid]); } catch { /* ignore */ }
    delete streamJournalTimerBySession[sid];
  }
}

async function hydrateStreamJournalIntoTimeline(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !window.electronAPI || !currentFolder) return;
  try {
    const res = await window.electronAPI.storageGetObject(currentFolder, streamJournalKey(sid));
    const st = res && res.success ? res.value : null;
    if (!st || typeof st !== 'object') return;
    const rid = typeof st.requestId === 'string' ? st.requestId.trim() : '';
    const text = typeof st.text === 'string' ? st.text : '';
    const thinking = typeof st.thinking === 'string' ? st.thinking : '';
    if (!rid || (!text && !thinking)) return;

    // Patch the run assistant message if it exists; otherwise patch the last assistant message.
    const msgs = ensureSessionMessages(sid);
    let target =
      msgs.find(m => m && m.role === 'assistant' && (m.runRequestId === rid || m.id === runAssistantMessageId(rid))) ||
      [...msgs].reverse().find(m => m && m.role === 'assistant');
    if (!target) return;

    if (text && (!target.content || String(target.content).length < text.length)) {
      target.content = text;
    }
    // Store thinking in provider_metadata for recovery UI if needed (non-breaking).
    if (thinking) {
      const pm = target.provider_metadata && typeof target.provider_metadata === 'object' ? target.provider_metadata : {};
      pm.thought = thinking;
      target.provider_metadata = pm;
    }
    target.streaming = false;
    target.interrupted = true;
  } catch {
    // ignore
  }
}

function dedupeMessagesStable(messages) {
  // Prefer seq for dedupe when present; fall back to a compact signature.
  const seen = new Set();
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object') continue;
    const seq = (typeof m.seq === 'number' && Number.isFinite(m.seq) && m.seq > 0) ? m.seq : null;
    const ts = (typeof m.timestamp === 'number' && Number.isFinite(m.timestamp)) ? m.timestamp : 0;
    const role = String(m.role || '');
    const key =
      seq != null
        ? `${role}|seq:${seq}`
        : `${role}|ts:${ts}|fp:${String(m.filePath || '')}|id:${String(m.id || '')}|len:${typeof m.content === 'string' ? m.content.length : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function clampSummary(summary) {
  if (typeof summary !== 'string') return undefined;
  const trimmed = summary.trim();
  if (!trimmed) return undefined;
  const maxLen = Math.max(MIN_SUMMARY_CHARS, MAX_SUMMARY_CHARS);
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.substring(0, maxLen) + `…(truncated)…`;
}

function truncateToolResultForStorage(content) {
  if (content == null) return content;
  const asString = typeof content === 'string' ? content : JSON.stringify(content);
  if (asString.length <= MAX_TOOL_RESULT_CHARS) return content;
  const over = asString.length - MAX_TOOL_RESULT_CHARS;
  const truncated = asString.substring(0, MAX_TOOL_RESULT_CHARS) + `…(truncated ${over} chars)…`;
  // Preserve original type if it was a string; otherwise store as string
  return truncated;
}

function stripRawFileFromAttachments(msg) {
  if (!msg || !msg.attachments || !Array.isArray(msg.attachments) || msg.attachments.length === 0) return msg;
  const clean = { ...msg };
  clean.attachments = msg.attachments.map(att => {
    if (!att || typeof att !== 'object') return att;
    const { file: _file, ...rest } = att; // raw DOM File breaks IPC cloning
    return rest;
  });
  return clean;
}

function buildPersistedChatState() {
  const sessionsArray = Object.entries(chatSessions).map(([id, s]) => {
    const title = s?.name || 'Chat';
    const updatedAt = typeof s?.timestamp === 'number' ? s.timestamp : Date.now();
    const createdAt = typeof s?.createdAt === 'number' ? s.createdAt : undefined;
    const isClosed = s?.isClosed === true ? true : undefined;
    const closedAt = typeof s?.closedAt === 'number' ? s.closedAt : undefined;

    const summary = clampSummary(s?.summary);
    const summaryUpTo = typeof s?.summaryUpTo === 'number' ? s.summaryUpTo : undefined;

    // Claude Code conversation continuity (persisted so Claude can resume across app restarts)
    const claudeSessionId =
      typeof s?.claudeSessionId === 'string' && s.claudeSessionId.trim()
        ? s.claudeSessionId.trim()
        : null;
    const claudeMetaIn = (s?.claudeMeta && typeof s.claudeMeta === 'object') ? s.claudeMeta : null;
    const claudeMeta = claudeMetaIn ? {
      lastAssistantUuid: (typeof claudeMetaIn.lastAssistantUuid === 'string' && claudeMetaIn.lastAssistantUuid.trim())
        ? claudeMetaIn.lastAssistantUuid.trim()
        : null,
      pendingResumeAt: (typeof claudeMetaIn.pendingResumeAt === 'string' && claudeMetaIn.pendingResumeAt.trim())
        ? claudeMetaIn.pendingResumeAt.trim()
        : null,
      forkOnNext: claudeMetaIn.forkOnNext === true
    } : null;

    const rawMessages = Array.isArray(s?.messages)
      ? s.messages
      : (Array.isArray(s?.history) ? s.history : []);
    const keptMessages = rawMessages.slice(-MAX_MESSAGES_PER_SESSION).map(m => {
      const cleanMsg = stripRawFileFromAttachments({ ...m });
      if (cleanMsg.role === 'tool' && cleanMsg.content != null) {
        cleanMsg.content = truncateToolResultForStorage(cleanMsg.content);
      }
      return cleanMsg;
    });

    const droppedCount = Math.max(0, rawMessages.length - keptMessages.length);
    const adjustedSummaryUpTo =
      typeof summaryUpTo === 'number' ? Math.max(0, summaryUpTo - droppedCount) : undefined;

    return {
      id,
      title,
      updatedAt,
      createdAt,
      isClosed,
      closedAt,
      summary,
      summaryUpTo: adjustedSummaryUpTo,
      messages: keptMessages,
      ...(claudeSessionId ? { claudeSessionId } : {}),
      ...(claudeMeta ? { claudeMeta } : {})
    };
  });

  sessionsArray.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const boundedSessions = sessionsArray.slice(0, MAX_SESSIONS);

  const activeSessionId =
    (currentSessionId && boundedSessions.some(s => s.id === currentSessionId))
      ? currentSessionId
      : (boundedSessions[0]?.id || '');

  return {
    v: CODEON_CHAT_STATE_VERSION,
    activeSessionId,
    sessions: boundedSessions
  };
}

function applyPersistedChatState(persisted) {
  if (!persisted || persisted.v !== CODEON_CHAT_STATE_VERSION || !Array.isArray(persisted.sessions)) {
    return false;
  }

  const nextSessions = {};
  for (const s of persisted.sessions) {
    if (!s || typeof s.id !== 'string') continue;
    const claudeSessionId =
      typeof s.claudeSessionId === 'string' && s.claudeSessionId.trim()
        ? s.claudeSessionId.trim()
        : null;
    const claudeMetaIn = (s.claudeMeta && typeof s.claudeMeta === 'object') ? s.claudeMeta : null;
    const claudeMeta = {
      lastAssistantUuid: (claudeMetaIn && typeof claudeMetaIn.lastAssistantUuid === 'string' && claudeMetaIn.lastAssistantUuid.trim())
        ? claudeMetaIn.lastAssistantUuid.trim()
        : null,
      pendingResumeAt: (claudeMetaIn && typeof claudeMetaIn.pendingResumeAt === 'string' && claudeMetaIn.pendingResumeAt.trim())
        ? claudeMetaIn.pendingResumeAt.trim()
        : null,
      forkOnNext: !!(claudeMetaIn && claudeMetaIn.forkOnNext === true)
    };
    nextSessions[s.id] = {
      name: s.title || 'Chat',
      // Canonical timeline
      messages: Array.isArray(s.messages) ? s.messages : [],
      // Back-compat: keep `history` aligned with `messages` for older code paths
      history: Array.isArray(s.messages) ? s.messages : [],
      timestamp: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : undefined,
      isClosed: s.isClosed === true ? true : undefined,
      closedAt: typeof s.closedAt === 'number' ? s.closedAt : undefined,
      summary: typeof s.summary === 'string' ? s.summary : undefined,
      summaryUpTo: typeof s.summaryUpTo === 'number' ? s.summaryUpTo : undefined,
      // Restore Claude continuity info (safe defaults for older persisted states)
      claudeSessionId,
      claudeMeta
    };
  }

  chatSessions = nextSessions;
  currentSessionId = (persisted.activeSessionId && chatSessions[persisted.activeSessionId])
    ? persisted.activeSessionId
    : (Object.keys(chatSessions)[0] || null);
  window.currentSessionId = currentSessionId;
  return true;
}

function isDefaultSessionName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (/^Chat\s+\d+$/.test(n)) return true;
  if (/^New chat(\s*\(\d+\))?$/.test(n)) return true;
  return false;
}

function normalizeTitleText(text) {
  if (typeof text !== 'string') return '';
  let t = text;
  // Strip code blocks (often huge / unhelpful for titles)
  t = t.replace(/```[\s\S]*?```/g, ' ');
  // Collapse whitespace/newlines
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function deriveSessionTitleFromMessage(content, attachments = []) {
  const raw = normalizeTitleText(content || '');
  const lowered = raw.toLowerCase();

  // Avoid placeholders becoming the title
  const isPlaceholder = (() => {
    try {
      if (window.codeonSessionTitles && typeof window.codeonSessionTitles.isPlaceholderTitle === 'function') {
        return window.codeonSessionTitles.isPlaceholderTitle(raw);
      }
    } catch { /* ignore */ }
    return (
      lowered === 'see attached files' ||
      lowered === 'please analyze the attached files'
    );
  })();

  if (raw && !isPlaceholder) {
    const maxLen = 44;
    return raw.length > maxLen ? raw.slice(0, maxLen - 1).trimEnd() + '…' : raw;
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    const first = attachments.find(a => a && typeof a.name === 'string' && a.name.trim()) || null;
    const firstName = first ? first.name.trim() : 'attachments';
    const extra = Math.max(0, attachments.length - 1);
    const base = extra > 0 ? `${firstName} +${extra}` : firstName;
    const maxLen = 44;
    return base.length > maxLen ? base.slice(0, maxLen - 1).trimEnd() + '…' : base;
  }

  return 'New chat';
}

function makeUniqueSessionName(baseName, excludeSessionId = null) {
  const base = String(baseName || 'New chat').trim() || 'New chat';
  const existing = new Set(
    Object.entries(chatSessions || {})
      .filter(([id]) => (excludeSessionId ? id !== excludeSessionId : true))
      .map(([, s]) => String(s?.name || '').trim())
      .filter(Boolean)
  );

  if (!existing.has(base)) return base;
  let counter = 2;
  while (counter < 9999) {
    const candidate = `${base} (${counter})`;
    if (!existing.has(candidate)) return candidate;
    counter++;
  }
  return `${base} (${Date.now()})`;
}

// Smart Auto-Scroll: Only scroll if user is already at/near bottom
// Prevents interrupting users who scrolled up to read old messages
const SCROLL_THRESHOLD = 150; // pixels from bottom
let __chatAutoScrollFollow = true; // "stick to bottom" mode
let __chatAutoScrollBoundEl = null;

function isUserNearBottom(container) {
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
  return distanceFromBottom <= SCROLL_THRESHOLD;
}

function bindChatAutoScrollOnce(container) {
  try {
    const el = container;
    if (!el) return;
    if (__chatAutoScrollBoundEl === el) return;
    __chatAutoScrollBoundEl = el;
    if (el.__codeonAutoScrollBound) return;
    el.__codeonAutoScrollBound = true;
    // Initialize follow state based on current scroll position.
    __chatAutoScrollFollow = isUserNearBottom(el);
    el.addEventListener('scroll', () => {
      try {
        if (el.__codeonAutoScrollByUs) return;
        __chatAutoScrollFollow = isUserNearBottom(el);
      } catch {
        // ignore
      }
    }, { passive: true });
  } catch {
    // ignore
  }
}

// FLICKER-FREE: Throttled scroll to prevent layout thrashing
let _scrollRafId = null;
let _lastScrollAt = 0;
const SCROLL_THROTTLE_MS = 150; // Don't scroll more than ~6fps

function scrollChatToBottom(container) {
  if (!container) return;
  
  // Throttle scroll updates
  const now = Date.now();
  if (_scrollRafId || (now - _lastScrollAt < SCROLL_THROTTLE_MS)) {
    return; // Skip - already pending or too soon
  }
  
  try {
    container.__codeonAutoScrollByUs = true;
    _scrollRafId = requestAnimationFrame(() => {
      _scrollRafId = null;
      _lastScrollAt = Date.now();
      try { container.scrollTop = container.scrollHeight; } catch { /* ignore */ }
      setTimeout(() => { try { container.__codeonAutoScrollByUs = false; } catch { /* ignore */ } }, 0);
    });
  } catch {
    try { container.scrollTop = container.scrollHeight; } catch { /* ignore */ }
    try { container.__codeonAutoScrollByUs = false; } catch { /* ignore */ }
  }
}

function smartScrollToBottom(container, { force = false } = {}) {
  if (!container) return;
  bindChatAutoScrollOnce(container);
  // Only auto-scroll if user is "following" OR if force is requested (e.g. after sending a message).
  if (force || __chatAutoScrollFollow) {
    scrollChatToBottom(container);
  }
}

// Expose globals for tools
window.currentFolder = null;
window.currentFile = null;
window.editor = null;
window.diffEditor = null;

