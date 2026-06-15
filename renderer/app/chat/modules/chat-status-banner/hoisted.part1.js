// ---- CHUNK 1/6 from hoisted.js (AST statement boundaries; order preserved) ----
// ---- GENERATED: hoisted declarations extracted from app/chat/chat-status-banner.js ----


function _setChatStatusBannerText(text, { sessionId = currentSessionId } = {}) {
  if (!sessionId || sessionId !== currentSessionId) return;
  const banner = document.getElementById('chatStatusBanner');
  if (!banner) return;
  const t = String(text || '').trim();
  if (!t) return;
  try {
    const prev = String(banner.dataset.lastText || '');
    const now = Date.now();
    const lastAt = Number(banner.dataset.lastAt || 0);
    if (prev === t && (Number.isFinite(lastAt) ? (now - lastAt) : 0) < 1200) return;
    if (Number.isFinite(lastAt) && (now - lastAt) < STATUS_BANNER_MIN_UPDATE_MS) return;
    banner.dataset.lastAt = String(now);
    banner.dataset.lastText = t;
  } catch { /* ignore */ }
  try {
    const textEl = banner.querySelector('.status-banner-text');
    if (textEl) textEl.textContent = t;
  } catch { /* ignore */ }
  try { banner.style.display = 'flex'; } catch { /* ignore */ }
}


function _setRunUiStatus(sessionId, text, { kind = 'info', setWritingNext = false } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const st = getRunState(sid);
  if (st) {
    st.uiStatus = String(text || '').trim();
    st.uiStatusKind = String(kind || 'info');
    st.uiStatusAt = Date.now();
    if (setWritingNext === true) st.uiStatusWritingOnNextTextDelta = true;
  }
  _setChatStatusBannerText(text, { sessionId: sid });
}


function _refreshChatStatusBannerForCurrentSession() {
  const sid = String(currentSessionId || '').trim();
  if (!sid) return;
  const st = getRunState(sid);
  if (!st || st.isProcessing !== true) {
    try { removeTypingIndicator(); } catch { /* ignore */ }
    return;
  }
  const txt = String(st.uiStatus || '').trim() || 'Thinking…';
  _setChatStatusBannerText(txt, { sessionId: sid });
}
