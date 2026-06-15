// VERIFICATION PANEL UI (Proofed Edits)
(function () {
  'use strict';

  if (window._verificationPanelUI) return;

  const $ = (id) => document.getElementById(id);
  const _trim = (s) => (typeof s === 'string' ? s.trim() : '');

  const ICONS = {
    shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"></path>
      <polyline points="9 12 11 14 15 10"></polyline>
    </svg>`
  };

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

  function _getSettings() {
    try {
      if (window.appSettings && typeof window.appSettings === 'object') return window.appSettings;
      if (window.settings && typeof window.settings === 'object') return window.settings;
    } catch { /* ignore */ }
    return null;
  }

  function _formatTime(ts) {
    try { return new Date(Number(ts || Date.now())).toLocaleString(); } catch { return '—'; }
  }

  function _statusBadge(status) {
    const s = String(status || '').trim();
    if (s === 'passed') return { cls: 'verif-status--passed', label: 'Verified' };
    if (s === 'failed') return { cls: 'verif-status--failed', label: 'Failed' };
    if (s === 'running') return { cls: 'verif-status--running', label: 'Running' };
    return { cls: 'verif-status--skipped', label: 'Skipped' };
  }

  function renderVerificationPanel() {
    const panel = $('verificationManagerPanel');
    if (!panel) return;

    const st = window._proofedEditsState;
    const sid = _trim(window.currentSessionId || '');
    const entries = st && sid ? st.getEntriesForSession(sid) : [];
    const sessionEnabled = st && typeof st.isVerificationEnabled === 'function'
      ? st.isVerificationEnabled(sid)
      : false;

    const list = entries.map((entry) => {
      const badge = _statusBadge(entry.status);
      const summary = _trim(entry.summary) || 'No summary available.';
      const time = _formatTime(entry.updatedAt || entry.timestamp);
      const viewDisabled = entry.status === 'running';
      return `
        <div class="verif-row" data-run-id="${_escapeAttr(entry.runRequestId)}">
          <div class="verif-row-main">
            <div class="verif-row-title">
              <span class="verif-status ${badge.cls}">${_escapeHtml(badge.label)}</span>
              <span class="verif-row-time">${_escapeHtml(time)}</span>
            </div>
            <div class="verif-row-summary">${_escapeHtml(summary)}</div>
          </div>
          <div class="verif-row-actions">
            <button class="btn-secondary verif-view-btn" type="button" ${viewDisabled ? 'disabled' : ''}>View</button>
            <button class="btn-secondary verif-rerun-btn" type="button">Rerun</button>
          </div>
        </div>
      `;
    }).join('');

    const emptyState = `
      <div class="verif-empty">
        <div class="verif-empty-icon">${ICONS.shield}</div>
        <div class="verif-empty-title">${sessionEnabled ? 'No Verifications Yet' : 'Auto-verify is Off'}</div>
        <div class="verif-empty-desc">
          ${sessionEnabled
            ? 'Run an AI task that edits files and a verification report will appear here.'
            : 'Enable auto-verify to run lint/typecheck/tests after each AI change and issue a safety certificate for this session.'}
        </div>
        ${sessionEnabled ? '' : '<button class="btn-primary verif-empty-action" id="verifEnableBtn" type="button">Enable Auto-verify</button>'}
      </div>
    `;

    panel.innerHTML = `
      <div class="mcp-manager-container verif">
        <div class="codeon-panel-topbar">
          <div class="codeon-panel-titlewrap">
            <div class="codeon-panel-title">
              ${ICONS.shield}
              <span>Verification</span>
              <span class="codeon-panel-title-pill verif-title-pill">Proofed Edits</span>
            </div>
            <div class="codeon-panel-subtitle">Session-scoped verification results for this chat.</div>
          </div>
          <div class="codeon-panel-actions">
            <label class="verif-toggle" title="Enable auto-verify for this session">
              <input type="checkbox" id="verificationSessionToggle" ${sessionEnabled ? 'checked' : ''} />
              <span class="verif-toggle-label">Auto-verify</span>
            </label>
          </div>
        </div>
        <div class="verif-body">
          ${entries.length ? list : emptyState}
        </div>
      </div>
    `;

    const toggle = $('verificationSessionToggle');
    if (toggle && st && typeof st.setVerificationEnabled === 'function') {
      toggle.addEventListener('change', () => {
        st.setVerificationEnabled(toggle.checked === true, sid);
      });
    }

    const enableBtn = $('verifEnableBtn');
    if (enableBtn && st && typeof st.setVerificationEnabled === 'function') {
      enableBtn.addEventListener('click', () => {
        st.setVerificationEnabled(true, sid);
        renderVerificationPanel();
      });
    }

    const rows = Array.from(panel.querySelectorAll('.verif-row'));
    rows.forEach((row) => {
      const rid = row.dataset.runId;
      if (!rid || !st) return;
      const viewBtn = row.querySelector('.verif-view-btn');
      const rerunBtn = row.querySelector('.verif-rerun-btn');
      if (viewBtn) {
        viewBtn.addEventListener('click', () => {
          const entry = st.getEntry(sid, rid);
          if (entry) window._proofedEdits?.openCertificate?.(entry);
        });
      }
      if (rerunBtn) {
        rerunBtn.addEventListener('click', () => {
          const entry = st.getEntry(sid, rid);
          if (entry) window._proofedEdits?.runVerification?.(entry, { rerun: true });
        });
      }
    });
  }

  function showVerificationManager() {
    const panel = $('verificationManagerPanel');
    if (!panel) return;
    panel.style.display = 'flex';
    renderVerificationPanel();
  }

  function hideVerificationManager() {
    const panel = $('verificationManagerPanel');
    if (!panel) return;
    panel.style.display = 'none';
  }

  window._verificationPanelUI = {
    render: renderVerificationPanel,
    show: showVerificationManager,
    hide: hideVerificationManager
  };

  window.renderVerificationPanel = renderVerificationPanel;
  window.showVerificationManager = showVerificationManager;
  window.hideVerificationManager = hideVerificationManager;
})();
