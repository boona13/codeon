// ============================================================================
// DOCS PANEL UI (Codeon Documentation Mode)
// ============================================================================

(function () {
  'use strict';

  if (window._docsPanelUI) return;

  const markedParser = (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function')
    ? window.marked.parse
    : null;

  function $(id) { return document.getElementById(id); }

  function escape(t) {
    try { return window.escapeHtml(String(t || '')); } catch { return String(t || ''); }
  }

  function escAttr(t) {
    try { return window.escapeAttr(String(t || '')); } catch { return String(t || '').replace(/"/g, '&quot;'); }
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function truncate(s, max = 80) {
    const str = String(s || '').trim();
    if (str.length <= max) return str;
    return str.slice(0, max - 1) + '…';
  }

  function getProjectName() {
    try {
      const p = String(window.currentFolder || '').trim();
      if (!p) return 'Project';
      const parts = p.split(/[/\\]/).filter(Boolean);
      return parts[parts.length - 1] || 'Project';
    } catch {
      return 'Project';
    }
  }

  function isDocumentationModeEnabled() {
    try {
      const s = window.appSettings || {};
      if (s.permissionMode === 'plan') return false;
      const ds = window._docsState;
      if (ds && typeof ds.isDocsEnabled === 'function') {
        return ds.isDocsEnabled();
      }
      return false;
    } catch {
      return false;
    }
  }

  async function setDocumentationModeEnabled(enabled) {
    try {
      const s = window.appSettings || {};
      if (s.permissionMode === 'plan' && enabled) {
        try { window.showToast?.('Documentation Mode is disabled in Plan Mode.'); } catch { /* ignore */ }
        return;
      }
      const ds = window._docsState;
      if (ds && typeof ds.setDocsEnabled === 'function') {
        ds.setDocsEnabled(enabled === true);
      }
    } catch { /* ignore */ }
  }

  const ICONS = {
    docs: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
    </svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M23 4v6h-6"></path>
      <path d="M1 20v-6h6"></path>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>`,
    back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>`,
    spinner: `<svg class="docs-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"></circle>
    </svg>`,
    checkCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>`,
    alertCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`
  };

  function renderStatusBadge(status) {
    const map = {
      pending: { icon: ICONS.clock, label: 'Pending', cls: 'docs-status--pending' },
      generating: { icon: ICONS.spinner, label: 'Generating...', cls: 'docs-status--generating' },
      completed: { icon: ICONS.checkCircle, label: 'Ready', cls: 'docs-status--completed' },
      error: { icon: ICONS.alertCircle, label: 'Error', cls: 'docs-status--error' }
    };
    const s = map[status] || map.pending;
    return `<span class="docs-status ${s.cls}">${s.icon}<span>${s.label}</span></span>`;
  }

  function renderDocsPanel() {
    const panel = $('docsManagerPanel');
    if (!panel) return;

    const ds = window._docsState;
    const view = ds ? ds.getView() : 'list';

    if (view === 'detail') {
      _renderDetailView(panel);
      return;
    }
    if (view === 'web') {
      _renderWebView(panel);
      return;
    }

    const isPlanMode = (window.appSettings && window.appSettings.permissionMode === 'plan');
    const pid = ds?.getProjectId ? ds.getProjectId() : '';
    const entries = ds ? ds.getEntriesForProject(pid) : [];
    const sessionEnabled = ds && typeof ds.isDocsEnabled === 'function' ? ds.isDocsEnabled() : false;
    const isEnabled = !isPlanMode && sessionEnabled;
    const learningBusy = window._learningState?.isGenerating?.() === true;
    const hasPending = entries.some(e => e && (e.status === 'pending' || e.status === 'generating'));
    const showLearningWait = learningBusy && hasPending;

    panel.innerHTML = `
      <div class="mcp-manager-container docs">
        <div class="codeon-panel-topbar">
          <div class="codeon-panel-titlewrap">
            <div class="codeon-panel-title">
              ${ICONS.docs}
              <span>Docs</span>
              <span class="codeon-panel-title-pill">Auto-docs</span>
            </div>
            <div class="codeon-panel-subtitle">Keep product docs updated automatically after each AI run.</div>
          </div>
          <div class="codeon-panel-actions">
            <label class="docs-toggle ${isPlanMode ? 'is-disabled' : ''}" title="${isPlanMode ? 'Disabled in Plan Mode' : 'Enable auto-docs for this session'}">
              <input type="checkbox" id="docsEnableToggle" ${sessionEnabled ? 'checked' : ''} ${isPlanMode ? 'disabled' : ''} />
              <span class="docs-toggle-label">Auto-doc</span>
            </label>
            ${showLearningWait ? `<span class="docs-wait-badge" title="Waiting for Learning Mode to finish">Waiting on Learning…</span>` : ''}
            ${entries.length ? `<button class="btn-secondary" id="docsWebBtn" type="button">Web Preview</button>` : ''}
          </div>
        </div>

        <div class="docs-body" id="docsBody">
          ${entries.length === 0 ? _renderEmptyState(isEnabled, isPlanMode) : _renderEntryList(entries)}
        </div>
      </div>
    `;

    _bindListEvents();
  }

  function _renderEmptyState(isEnabled, isPlanMode) {
    if (isPlanMode) {
      return `
        <div class="docs-empty">
          <div class="docs-empty-icon">${ICONS.docs}</div>
          <div class="docs-empty-title">Documentation Mode Disabled</div>
          <div class="docs-empty-desc">
            Documentation Mode is unavailable in Plan Mode.
            <br>Switch agent mode to Default or Accept Edits to enable it.
          </div>
        </div>
      `;
    }
    if (!isEnabled) {
      return `
        <div class="docs-empty">
          <div class="docs-empty-icon">${ICONS.docs}</div>
          <div class="docs-empty-title">Auto-docs are Off</div>
          <div class="docs-empty-desc">
            Turn it on to auto-document new features and keep your docs complete.
          </div>
          <button class="btn-primary" id="docsEnableBtn" type="button">Enable Auto-docs</button>
        </div>
      `;
    }
    return `
      <div class="docs-empty">
        <div class="docs-empty-icon">${ICONS.docs}</div>
        <div class="docs-empty-title">No Documentation Updates Yet</div>
        <div class="docs-empty-desc">
          Run an AI task that changes files and a documentation update will appear here.
        </div>
      </div>
    `;
  }

  function _renderEntryList(entries) {
    let html = '<div class="docs-list-view">';
    for (const entry of entries) {
      const title = entry?.content?.title || entry?.originalPrompt || 'Documentation Update';
      const summary = entry?.content?.summary || entry?.originalPrompt || '';
      const time = formatTimestamp(entry.timestamp);
      const status = entry.status || 'pending';
      const canView = status === 'completed';
      const isGenerating = status === 'generating';

      html += `
        <div class="docs-row ${canView ? 'docs-row--clickable' : ''}" data-run-id="${escAttr(entry.runRequestId)}">
          <div class="docs-row-main">
            <div class="docs-row-info">
              <span class="docs-row-title">${escape(truncate(title, 80))}</span>
              <span class="docs-row-summary">${escape(truncate(summary, 120))}</span>
            </div>
            <div class="docs-row-meta">
              ${renderStatusBadge(status)}
              <span class="docs-row-time">${escape(time)}</span>
              ${canView ? `<span class="docs-row-action">${ICONS.chevronRight}</span>` : ''}
            </div>
          </div>
          ${isGenerating ? `<div class="docs-row-progress"><div class="docs-progress-bar"></div></div>` : ''}
        </div>
      `;
    }
    html += '</div>';
    return html;
  }

  function _renderDetailView(panel) {
    const ds = window._docsState;
    const pid = ds?.getProjectId ? ds.getProjectId() : '';
    const entry = ds ? ds.getActiveEntry(pid) : null;

    if (!entry || !entry.content) {
      ds?.setView('list');
      renderDocsPanel();
      return;
    }

    const title = entry?.content?.title || 'Documentation Update';
    const markdown = entry?.content?.rawMarkdown || '';

    panel.innerHTML = `
      <div class="mcp-manager-container docs docs--detail">
        <div class="codeon-panel-topbar codeon-panel-topbar--stack">
          <div class="docs-detail-header">
            <button class="docs-back-btn" id="docsBackBtn" type="button" title="Back to list">
              ${ICONS.back}
            </button>
            <div class="codeon-panel-titlewrap">
              <div class="codeon-panel-title">
                ${ICONS.docs}
                <span>Docs</span>
              </div>
              <div class="codeon-panel-subtitle">${escape(truncate(title, 120))}</div>
            </div>
            <button class="docs-delete-btn" id="docsDeleteBtn" type="button" title="Delete this update">
              ${ICONS.trash}
            </button>
          </div>
        </div>

        <div class="docs-detail-body" id="docsDetailBody">
          <article class="docs-article">
            ${_formatMarkdown(markdown)}
          </article>
          ${_renderMetadataSection(entry.metadata)}
        </div>
      </div>
    `;

    _bindDetailEvents(entry);
  }

  function _renderWebView(panel) {
    const ds = window._docsState;
    const pid = ds?.getProjectId ? ds.getProjectId() : '';
    const entries = ds ? ds.getEntriesForProject(pid) : [];
    const projectName = getProjectName();
    const markdown = _buildWebDocMarkdown(entries, projectName);
    const isPlanMode = (window.appSettings && window.appSettings.permissionMode === 'plan');
    const isEnabled = isDocumentationModeEnabled();

    panel.innerHTML = `
      <div class="mcp-manager-container docs docs--web">
        <div class="codeon-panel-topbar codeon-panel-topbar--stack">
          <div class="docs-detail-header">
            <button class="docs-back-btn" id="docsWebBackBtn" type="button" title="Back to list">
              ${ICONS.back}
            </button>
            <div class="codeon-panel-titlewrap">
              <div class="codeon-panel-title">
                ${ICONS.docs}
                <span>Docs</span>
              </div>
              <div class="codeon-panel-subtitle">${escape(projectName)} · Web Preview</div>
            </div>
            <div class="docs-web-actions">
              <button class="btn-secondary" id="docsCopyMarkdownBtn" type="button">Copy Markdown</button>
              <button class="btn-primary" id="docsCopyHtmlBtn" type="button">Copy HTML</button>
            </div>
          </div>
        </div>

        <div class="docs-web-body" id="docsWebBody">
          ${entries.length ? `<article class="docs-article">${_formatMarkdown(markdown)}</article>` : _renderEmptyState(isEnabled, isPlanMode)}
        </div>
      </div>
    `;

    _bindWebEvents(markdown, projectName);
  }

  function _renderMetadataSection(metadata) {
    if (!metadata) return '';
    const tools = metadata.toolsUsed || [];
    const files = metadata.filesModified || [];
    if (!tools.length && !files.length) return '';

    let html = `
      <div class="docs-meta-footer">
        <div class="docs-meta-grid">
    `;
    if (tools.length) {
      html += `
        <div class="docs-meta-item">
          <span class="docs-meta-label">Tools:</span>
          <span class="docs-meta-value">${tools.map(t => escape(t)).join(', ')}</span>
        </div>
      `;
    }
    if (files.length) {
      html += `
        <div class="docs-meta-item">
          <span class="docs-meta-label">Files:</span>
          <span class="docs-meta-value">${files.slice(0, 6).map(f => escape(f)).join(', ')}${files.length > 6 ? ` (+${files.length - 6} more)` : ''}</span>
        </div>
      `;
    }
    html += '</div></div>';
    return html;
  }

  function _buildWebDocMarkdown(entries, projectName) {
    const name = projectName || 'Project';
    const parts = [];
    parts.push(`# ${name} Documentation`);
    parts.push(`_Generated by Codeon Documentation Mode on ${new Date().toLocaleString()}_`);
    parts.push(``);
    parts.push(`## Feature Updates`);
    parts.push(``);
    for (const entry of entries.slice().reverse()) {
      const raw = entry?.content?.rawMarkdown || '';
      if (!raw) continue;
      parts.push(raw);
      parts.push(`\n---\n`);
    }
    return parts.join('\n');
  }

  function _buildWebDocHtml(markdown, projectName) {
    const bodyHtml = _formatMarkdown(markdown);
    const title = escape(projectName || 'Project') + ' Documentation';
    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg1: #0f172a;
      --bg2: #1e293b;
      --bg3: #0f1419;
      --text: #f1f5f9;
      --muted: #cbd5e1;
      --accent: #22d3ee;
      --card: rgba(15, 23, 42, 0.7);
      --border: rgba(148, 163, 184, 0.2);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: radial-gradient(1200px 600px at 20% -10%, rgba(34, 211, 238, 0.18), transparent),
                  linear-gradient(135deg, var(--bg1), var(--bg2), var(--bg3));
      color: var(--text);
      padding: 40px 24px;
    }
    .doc-shell {
      max-width: 960px;
      margin: 0 auto;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 32px;
      backdrop-filter: blur(10px);
      box-shadow: 0 18px 45px rgba(0, 0, 0, 0.35);
    }
    h1, h2, h3, h4 { color: var(--text); }
    h1 { font-size: 2rem; margin-bottom: 0.6rem; }
    h2 { margin-top: 2rem; }
    p, li { color: var(--muted); line-height: 1.6; }
    code { background: rgba(15, 23, 42, 0.6); padding: 2px 6px; border-radius: 6px; }
    pre { background: rgba(2, 6, 23, 0.8); padding: 14px; border-radius: 12px; overflow: auto; }
    a { color: var(--accent); }
    hr { border: 0; border-top: 1px solid var(--border); margin: 24px 0; }
  </style>
</head>
<body>
  <div class="doc-shell">
    ${bodyHtml}
  </div>
</body>
</html>
    `.trim();
  }

  function _formatMarkdown(text) {
    if (!text) return '';
    if (markedParser) {
      try {
        const html = markedParser(text);
        return html
          .replace(/<h1/g, '<h1 class="docs-h1"')
          .replace(/<h2/g, '<h2 class="docs-h2"')
          .replace(/<h3/g, '<h3 class="docs-h3"')
          .replace(/<h4/g, '<h4 class="docs-h4"')
          .replace(/<pre>/g, '<pre class="docs-code-block">')
          .replace(/<code>/g, '<code class="docs-inline-code">')
          .replace(/<ul>/g, '<ul class="docs-list">')
          .replace(/<ol>/g, '<ol class="docs-list">')
          .replace(/<p>/g, '<p class="docs-paragraph">');
      } catch {
        // fall through
      }
    }
    let html = escape(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code class="docs-inline-code">$1</code>');
    html = html.replace(/\n\n/g, '</p><p class="docs-paragraph">');
    html = html.replace(/\n/g, '<br>');
    return `<p class="docs-paragraph">${html}</p>`;
  }

  // === Event Bindings ===
  function _bindListEvents() {
    const panel = $('docsManagerPanel');
    if (!panel || panel.__docsBound) return;
    panel.__docsBound = true;

    panel.addEventListener('click', (e) => {
      const t = e.target;
      if (!t) return;

      if (t.id === 'docsEnableBtn' || t.closest('#docsEnableBtn')) {
        e.preventDefault();
        if (window.appSettings && window.appSettings.permissionMode === 'plan') {
          try { window.showToast?.('Documentation Mode is disabled in Plan Mode.'); } catch { /* ignore */ }
          return;
        }
        setDocumentationModeEnabled(true).then(() => renderDocsPanel());
        return;
      }

      if (t.id === 'docsWebBtn' || t.closest('#docsWebBtn')) {
        e.preventDefault();
        window._docsState?.setView('web');
        renderDocsPanel();
        return;
      }

      const row = t.closest('.docs-row--clickable');
      if (row) {
        const runId = row.dataset.runId;
        if (runId) {
          window._docsState?.setActiveEntry(runId);
          renderDocsPanel();
        }
      }
    });

    panel.addEventListener('change', (e) => {
      if (e.target?.id === 'docsEnableToggle') {
        if (window.appSettings && window.appSettings.permissionMode === 'plan') {
          e.target.checked = false;
          try { window.showToast?.('Documentation Mode is disabled in Plan Mode.'); } catch { /* ignore */ }
          return;
        }
        const checked = e.target.checked;
        setDocumentationModeEnabled(checked).then(() => {
          setTimeout(() => renderDocsPanel(), 50);
        });
      }
    });
  }

  function _bindDetailEvents(entry) {
    const backBtn = $('docsBackBtn');
    const deleteBtn = $('docsDeleteBtn');

    if (backBtn && !backBtn.__docsBound) {
      backBtn.__docsBound = true;
      backBtn.addEventListener('click', () => {
        window._docsState?.setView('list');
        renderDocsPanel();
      });
    }

    if (deleteBtn && !deleteBtn.__docsBound) {
      deleteBtn.__docsBound = true;
      deleteBtn.addEventListener('click', async () => {
        try {
          const confirm = window.customConfirm
            ? await window.customConfirm('Delete this documentation update?', 'Delete Documentation')
            : window.confirm('Delete this documentation update?');
          if (confirm) {
            const pid = window._docsState?.getProjectId?.() || '';
            window._docsState?.deleteEntry(pid, entry.runRequestId);
            window._docsState?.setView('list');
            renderDocsPanel();
          }
        } catch { /* ignore */ }
      });
    }
  }

  function _bindWebEvents(markdown, projectName) {
    const backBtn = $('docsWebBackBtn');
    const copyMdBtn = $('docsCopyMarkdownBtn');
    const copyHtmlBtn = $('docsCopyHtmlBtn');

    if (backBtn && !backBtn.__docsBound) {
      backBtn.__docsBound = true;
      backBtn.addEventListener('click', () => {
        window._docsState?.setView('list');
        renderDocsPanel();
      });
    }

    if (copyMdBtn && !copyMdBtn.__docsBound) {
      copyMdBtn.__docsBound = true;
      copyMdBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(markdown || '');
          window.showToast?.('Documentation copied (Markdown)');
        } catch {
          window.showToast?.('Failed to copy Markdown');
        }
      });
    }

    if (copyHtmlBtn && !copyHtmlBtn.__docsBound) {
      copyHtmlBtn.__docsBound = true;
      copyHtmlBtn.addEventListener('click', async () => {
        try {
          const html = _buildWebDocHtml(markdown, projectName);
          await navigator.clipboard.writeText(html);
          window.showToast?.('Documentation copied (HTML)');
        } catch {
          window.showToast?.('Failed to copy HTML');
        }
      });
    }
  }

  // === Panel Show/Hide ===
  function showDocsPanel() {
    const panel = $('docsManagerPanel');
    if (panel) {
      panel.style.display = 'flex';
      renderDocsPanel();
    }
  }

  function hideDocsPanel() {
    const panel = $('docsManagerPanel');
    if (panel) {
      panel.style.display = 'none';
    }
  }

  window._docsPanelUI = {
    render: renderDocsPanel,
    show: showDocsPanel,
    hide: hideDocsPanel
  };

  window.renderDocsPanel = renderDocsPanel;
  window.showDocsManager = showDocsPanel;
  window.hideDocsManager = hideDocsPanel;
})();
