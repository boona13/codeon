(function () {
  // Cursor-inspired: derive a meaningful, stable chat tab title using heuristics
  // (no AI dependency; safe to run without affecting the agent loop).

  const DEFAULT_MAX_LEN = 44;

  function firstLine(text) {
    const s = String(text || '');
    const idx = s.indexOf('\n');
    return (idx >= 0 ? s.slice(0, idx) : s).trim();
  }

  function sanitizeTitle(text) {
    let t = String(text || '');
    if (!t) return '';
    // Strip think blocks (Cursor-style)
    t = t.replace(/<think>([\s\S]*?)<\/think>/gi, '$1');
    t = t.replace(/<think>([\s\S]*)$/gi, '$1');
    // Strip code fences
    t = t.replace(/```[\s\S]*?```/g, ' ');
    // Strip inline backticks
    t = t.replace(/`+/g, '');
    // Convert markdown images/links into visible text
    t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Remove headings / quotes / list markers
    t = t.replace(/(^|\n)\s{0,3}#{1,6}\s*/g, '$1');
    t = t.replace(/(^|\n)\s{0,3}>\s?/g, '$1');
    t = t.replace(/(^|\n)\s{0,3}([-*+]|\d+\.)\s+/g, '$1');
    // Remove emphasis markers
    t = t.replace(/(\*\*|__|~~|\*|_)/g, '');
    // Collapse whitespace
    t = t.replace(/\|/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  function truncate(text, maxLen = DEFAULT_MAX_LEN) {
    const s = String(text || '').trim();
    const m = Number.isFinite(Number(maxLen)) && Number(maxLen) > 8 ? Number(maxLen) : DEFAULT_MAX_LEN;
    if (s.length <= m) return s;
    return s.slice(0, m - 1).trimEnd() + '…';
  }

  function normalizeForPlaceholderCheck(candidate) {
    // Normalize aggressively so we catch "Please, see attached files." etc.
    let c = String(candidate || '').trim().toLowerCase();
    // Replace punctuation with spaces, keep alnum
    c = c.replace(/[^a-z0-9]+/g, ' ');
    c = c.replace(/\s+/g, ' ').trim();
    return c;
  }

  function isPlaceholderTitle(candidate) {
    const c = normalizeForPlaceholderCheck(candidate);
    if (!c) return true;

    // Ultra-generic acknowledgements / non-asks (bad tab titles)
    const generic = new Set([
      'ok',
      'okay',
      'k',
      'thanks',
      'thank you',
      'thx',
      'hi',
      'hello',
      'hey',
      'yo',
      'test'
    ]);
    if (generic.has(c)) return true;

    // Common "attachment-only" / "filler" prompts
    const attachmentPlaceholders = new Set([
      'see attached',
      'see attachment',
      'see attached file',
      'see attached files',
      'see attached folder',
      'see attached folders',
      'attached',
      'attachment',
      'attached file',
      'attached files',
      'attached folder',
      'attached folders',
      'files attached',
      'folder attached',
      'please see attached',
      'please see attached files',
      'please check attached',
      'please check attached files',
      'please review attached',
      'please review attached files',
      'please analyze attached',
      'please analyze attached files',
      'analyze attached files',
      'review attached files',
      'check attached files',
      'look at attached files',
      'look at the attached files'
    ]);
    if (attachmentPlaceholders.has(c)) return true;

    // “Continue” without context (also common from recovery)
    const continuePlaceholders = new Set([
      'continue',
      'please continue',
      'go on',
      'proceed',
      'continue please'
    ]);
    if (continuePlaceholders.has(c)) return true;

    // Too-short low-signal titles (avoid "pls", "help", etc.)
    if (c.length <= 4) return true;

    return false;
  }

  function isDefaultSessionName(name) {
    const n = String(name || '').trim();
    if (!n) return true;
    if (/^Chat\s+\d+$/.test(n)) return true;
    if (/^New chat(\s*\(\d+\))?$/.test(n)) return true;
    return false;
  }

  function makeUniqueSessionName(baseName, chatSessions, excludeSessionId) {
    const base = String(baseName || 'New chat').trim() || 'New chat';
    const sessions = chatSessions && typeof chatSessions === 'object' ? chatSessions : {};
    const existing = new Set(
      Object.entries(sessions)
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

  function deriveBestTitleFromSessionMessages(messages) {
    const msgs = Array.isArray(messages) ? messages : [];
    // Choose the first non-placeholder user message as the long-lived title.
    for (const m of msgs) {
      if (!m || m.role !== 'user') continue;
      const raw = sanitizeTitle(firstLine(m.content || ''));
      const t = truncate(raw, DEFAULT_MAX_LEN);
      if (t && !isPlaceholderTitle(t)) return t;
    }
    return '';
  }

  function maybeAutoRenameSession({
    sessionId,
    chatSessions,
    reason = '',
    // Optional: when typing, only used if the session has no user messages yet.
    draftText = ''
  } = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    const sessions = chatSessions && typeof chatSessions === 'object' ? chatSessions : null;
    if (!sessions || !sessions[sid]) return null;

    const sess = sessions[sid];
    const currentName = String(sess.name || '').trim();

    // Never override user-renamed sessions.
    if (sess.autoName === false) return null;

    // If we don't have explicit autoName tracking yet, treat default names as auto.
    const isAuto = sess.autoName === true || (typeof sess.autoName === 'undefined' && isDefaultSessionName(currentName));
    if (!isAuto) return null;

    const msgs = Array.isArray(sess.messages) ? sess.messages : (Array.isArray(sess.history) ? sess.history : []);
    const hasAnyUser = msgs.some(m => m && m.role === 'user');

    // Draft preview: only when creating a new chat (no user turns yet) and we have non-empty draft.
    if (!hasAnyUser && draftText && String(draftText).trim()) {
      const raw = sanitizeTitle(firstLine(draftText));
      const t = truncate(raw, DEFAULT_MAX_LEN);
      if (t && !isPlaceholderTitle(t) && t !== currentName) {
        // NOTE: do not persist uniqueness for draft; keep it simple and reversible.
        return { name: t, mode: 'draft' };
      }
    }

    const best = deriveBestTitleFromSessionMessages(msgs);
    if (!best) return null;
    if (best === currentName) return null;

    const unique = makeUniqueSessionName(best, sessions, sid);
    if (!unique || unique === currentName) return null;
    return { name: unique, mode: 'auto', reason: String(reason || '') };
  }

  window.codeonSessionTitles = {
    maybeAutoRenameSession,
    isPlaceholderTitle
  };
})();


