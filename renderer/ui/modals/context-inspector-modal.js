(function () {
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtJson(obj) {
    try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
  }

  function getEls() {
    return {
      modal: document.getElementById('contextInspectorModal'),
      body: document.getElementById('contextInspectorBody'),
      closeBtn: document.getElementById('closeContextInspectorButton'),
      copyBtn: document.getElementById('contextInspectorCopyBtn'),
      copyPromptBtn: document.getElementById('contextInspectorCopyPromptBtn'),
      copyReqBtn: document.getElementById('contextInspectorCopyRequestIdBtn'),
      select: document.getElementById('contextInspectorSelect')
    };
  }

  function renderSnapshot(snapshot) {
    const { body, select } = getEls();
    if (!body) return;
    if (!snapshot) {
      body.innerHTML = `<div class="context-inspector-empty">No captured context yet. Run the agent once, then open this inspector.</div>`;
      if (select) select.innerHTML = '';
      return;
    }

    const rid = String(snapshot.requestId || '').trim();
    const sid = String(snapshot.sessionId || '').trim();
    const prompt = snapshot.prompt && typeof snapshot.prompt === 'object' ? snapshot.prompt : {};
    const startArgs = snapshot.claudeSdkStart && typeof snapshot.claudeSdkStart === 'object' ? snapshot.claudeSdkStart : {};
    const attachments = Array.isArray(snapshot.attachments) ? snapshot.attachments : [];

    body.innerHTML = `
      <div class="context-inspector-grid">
        <div class="context-inspector-section">
          <div class="context-inspector-section-title">Run</div>
          <div class="context-inspector-kv"><div class="k">sessionId</div><div class="v mono">${esc(sid || '—')}</div></div>
          <div class="context-inspector-kv"><div class="k">requestId</div><div class="v mono">${esc(rid || '—')}</div></div>
          <div class="context-inspector-kv"><div class="k">capturedAt</div><div class="v mono">${esc(snapshot.capturedAt || '—')}</div></div>
        </div>

        <div class="context-inspector-section">
          <div class="context-inspector-section-title">Continuity</div>
          <div class="context-inspector-kv"><div class="k">resumeSessionId</div><div class="v mono">${esc(startArgs.resumeSessionId || '—')}</div></div>
          <div class="context-inspector-kv"><div class="k">resumeSessionAt</div><div class="v mono">${esc(startArgs.resumeSessionAt || '—')}</div></div>
          <div class="context-inspector-kv"><div class="k">forkSession</div><div class="v mono">${esc(String(startArgs.forkSession ?? '—'))}</div></div>
        </div>

        <div class="context-inspector-section">
          <div class="context-inspector-section-title">Settings (sent)</div>
          <div class="context-inspector-kv"><div class="k">permissionMode</div><div class="v mono">${esc(startArgs.permissionMode || '—')}</div></div>
          <div class="context-inspector-kv"><div class="k">networkPolicy</div><div class="v mono">${esc(startArgs.networkPolicySummary || '—')}</div></div>
          <div class="context-inspector-kv"><div class="k">model</div><div class="v mono">${esc(startArgs.model || '—')}</div></div>
          <div class="context-inspector-kv"><div class="k">maxBudgetUsd</div><div class="v mono">${esc(startArgs.maxBudgetUsd ?? '—')}</div></div>
          <div class="context-inspector-kv"><div class="k">authMode</div><div class="v mono">${esc(startArgs.authMode || '—')}</div></div>
        </div>

        <div class="context-inspector-section context-inspector-section--wide">
          <div class="context-inspector-section-title">Prompt (sent)</div>
          <div class="context-inspector-note">This is the exact <code>prompt</code> string passed to <code>claudeSdkStart</code> (after agent/skill injection and attachment listing).</div>
          <pre class="context-inspector-pre">${esc(String(prompt.effectivePrompt || ''))}</pre>
        </div>

        <div class="context-inspector-section context-inspector-section--wide">
          <div class="context-inspector-section-title">Attachments (sent)</div>
          <div class="context-inspector-note">These are the project-relative paths Claude can read via the <code>Read</code> tool.</div>
          ${
            attachments.length
              ? `<ul class="context-inspector-list">${attachments.map(a => `<li><code>${esc(a.relPath || '')}</code>${a.kind ? ` <span class="pill">${esc(a.kind)}</span>` : ''}</li>`).join('')}</ul>`
              : `<div class="context-inspector-empty">No attachments</div>`
          }
        </div>

        <div class="context-inspector-section context-inspector-section--wide">
          <div class="context-inspector-section-title">Raw payload (redacted)</div>
          <pre class="context-inspector-pre">${esc(fmtJson(snapshot))}</pre>
        </div>
      </div>
    `;
  }

  function refreshSelect(sessionId) {
    const { select } = getEls();
    if (!select) return;
    const sid = String(sessionId || '').trim();
    const list = window.codeonContextSnapshots?.listForSession?.(sid) || [];
    select.innerHTML = '';
    for (const snap of list) {
      const opt = document.createElement('option');
      opt.value = String(snap.requestId || '');
      const when = String(snap.capturedAt || '');
      opt.textContent = `${(snap.requestId || '').slice(0, 8)} — ${when}`;
      select.appendChild(opt);
    }
  }

  function openForSession(sessionId) {
    const { modal, select } = getEls();
    if (!modal) return;
    const sid = String(sessionId || '').trim();
    refreshSelect(sid);
    const snap = window.codeonContextSnapshots?.getLatestForSession?.(sid) || null;
    renderSnapshot(snap);
    modal.style.display = 'flex';
    if (select && snap && snap.requestId) {
      try { select.value = String(snap.requestId); } catch { /* ignore */ }
    }
  }

  function close() {
    const { modal } = getEls();
    if (!modal) return;
    modal.style.display = 'none';
  }

  function bind() {
    const btn = document.getElementById('contextInspectorButton');
    const { modal, closeBtn, copyBtn, copyPromptBtn, copyReqBtn, select } = getEls();

    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { openForSession(window.currentSessionId || null); } catch { /* ignore */ }
      });
    }

    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); close(); });
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    if (select) {
      select.addEventListener('change', () => {
        try {
          const rid = String(select.value || '').trim();
          const snap = window.codeonContextSnapshots?.getByRequestId?.(rid) || null;
          renderSnapshot(snap);
        } catch { /* ignore */ }
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          const sid = String(window.currentSessionId || '').trim();
          const snap = window.codeonContextSnapshots?.getLatestForSession?.(sid) || null;
          if (!snap) return;
          await navigator.clipboard.writeText(fmtJson(snap));
          window.showToast?.('Context copied');
        } catch {
          window.showToast?.('Failed to copy');
        }
      });
    }

    if (copyPromptBtn) {
      copyPromptBtn.addEventListener('click', async () => {
        try {
          const sid = String(window.currentSessionId || '').trim();
          const snap = window.codeonContextSnapshots?.getLatestForSession?.(sid) || null;
          const p = snap?.prompt?.effectivePrompt ? String(snap.prompt.effectivePrompt) : '';
          await navigator.clipboard.writeText(p);
          window.showToast?.('Prompt copied');
        } catch {
          window.showToast?.('Failed to copy');
        }
      });
    }

    if (copyReqBtn) {
      copyReqBtn.addEventListener('click', async () => {
        try {
          const sid = String(window.currentSessionId || '').trim();
          const snap = window.codeonContextSnapshots?.getLatestForSession?.(sid) || null;
          const rid = snap?.requestId ? String(snap.requestId) : '';
          await navigator.clipboard.writeText(rid);
          window.showToast?.('Request id copied');
        } catch {
          window.showToast?.('Failed to copy');
        }
      });
    }
  }

  window.codeonContextInspectorModal = { openForSession, close };

  // Bind once the DOM is ready. app.js also runs after this file, so be conservative.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    try { bind(); } catch { /* ignore */ }
  }
})();


