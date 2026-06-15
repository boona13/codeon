// ============================================================================
// LEARNING PANEL UI (Codeon Learning Feature)
// Compact design matching Agents & Skills / Plugins / MCP tabs
// ============================================================================

(function () {
  'use strict';

  if (window._learningPanelUI) return;

  // === Markdown Parser (using 'marked' library loaded via script tag) ===
  // The marked library is loaded in index.html before this script
  const markedParser = (typeof marked !== 'undefined' && typeof marked.parse === 'function') ? marked.parse : null;
  if (!markedParser) {
    console.warn('[Learning] marked library not available - markdown will use basic formatting');
  }

  // === Helpers ===
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

  function _stripLearningTitleNoise(text) {
    let s = String(text || '').trim();
    s = s.replace(/^#{1,6}\s*/, '');
    s = s.replace(/^[-*]\s+/, '');
    s = s.replace(/^[^A-Za-z0-9]+/, '');
    return s.trim();
  }

  function _isGenericLearningHeading(title) {
    const s = String(title || '').trim().toLowerCase();
    if (!s) return true;
    const generic = [
      'what happened',
      'the approach',
      'why this approach',
      'technical concepts',
      'how it works',
      'key concepts',
      'concepts to learn',
      'concepts to remember',
      'code worth studying',
      'code highlights',
      'summary',
      'reasoning',
      'technical'
    ];
    return generic.some(g => s.startsWith(g));
  }

  function _deriveLearningTitle(entry) {
    const direct = String(entry?.content?.title || '').trim();
    if (direct) return direct;
    const raw = String(entry?.content?.rawText || '').trim();
    if (raw) {
      const lines = raw.split(/\r?\n/).map(l => String(l || '').trim()).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/learning session\s*[:-]\s*(.+)/i);
        if (m && m[1]) {
          const cleaned = _stripLearningTitleNoise(m[1]);
          if (cleaned) return cleaned;
        }
      }
      const heading = lines.find(l => /^#{1,6}\s+/.test(l));
      if (heading) {
        const cleaned = _stripLearningTitleNoise(heading);
        if (cleaned && !_isGenericLearningHeading(cleaned)) return cleaned;
      }
      const first = lines[0];
      if (first) {
        const cleaned = _stripLearningTitleNoise(first);
        if (cleaned && !_isGenericLearningHeading(cleaned)) return cleaned;
      }
    }
    return String(entry?.originalPrompt || '').trim() || 'AI Task';
  }

  // === Icons ===
  const ICONS = {
    learn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
    </svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M23 4v6h-6"></path>
      <path d="M1 20v-6h6"></path>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>`,
    back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>`,
    spinner: `<svg class="lrn-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
    code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="16 18 22 12 16 6"></polyline>
      <polyline points="8 6 2 12 8 18"></polyline>
    </svg>`,
    lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 18h6"></path>
      <path d="M10 22h4"></path>
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"></path>
    </svg>`,
    fileCode: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
    </svg>`,
    brain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.54"></path>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2"></path>
    </svg>`,
    tool: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
    </svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`
  };

  // === Status Badge ===
  function renderStatusBadge(status) {
    const map = {
      pending: { icon: ICONS.clock, label: 'Pending', cls: 'lrn-status--pending' },
      generating: { icon: ICONS.spinner, label: 'Generating...', cls: 'lrn-status--generating' },
      completed: { icon: ICONS.checkCircle, label: 'Ready', cls: 'lrn-status--completed' },
      error: { icon: ICONS.alertCircle, label: 'Error', cls: 'lrn-status--error' }
    };
    const s = map[status] || map.pending;
    return `<span class="lrn-status ${s.cls}">${s.icon}<span>${s.label}</span></span>`;
  }

  // === Main Render ===
  function renderLearningPanel() {
    const panel = $('learningManagerPanel');
    if (!panel) return;

    const ls = window._learningState;
    const isPlanMode = (window.appSettings && window.appSettings.permissionMode === 'plan');
    const isEnabled = (!isPlanMode && ls) ? ls.isLearningEnabled() : false;
    const view = ls ? ls.getView() : 'list';

    if (view === 'detail') {
      _renderDetailView(panel);
      return;
    }

    // List view
    const sid = String(window.currentSessionId || '').trim();
    const entries = ls ? ls.getEntriesForSession(sid) : [];

    panel.innerHTML = `
      <div class="mcp-manager-container lrn">
        <div class="codeon-panel-topbar">
          <div class="codeon-panel-titlewrap">
            <div class="codeon-panel-title">
              ${ICONS.learn}
              <span>Learning</span>
              <span class="codeon-panel-title-pill">AI Tutor</span>
            </div>
            <div class="codeon-panel-subtitle">Learn what the AI did, why, and how — algorithms, patterns, and concepts.</div>
          </div>
          <div class="codeon-panel-actions">
            <label class="lrn-toggle ${isPlanMode ? 'is-disabled' : ''}" title="${isPlanMode ? 'Disabled in Plan Mode' : 'Enable Learning Mode'}">
              <input type="checkbox" id="lrnEnableToggle" ${isEnabled ? 'checked' : ''} ${isPlanMode ? 'disabled' : ''} />
              <span class="lrn-toggle-label">Auto-learn</span>
            </label>
          </div>
        </div>

        <div class="lrn-body" id="lrnBody">
          ${entries.length === 0 ? _renderEmptyState(isEnabled, isPlanMode) : _renderEntryList(entries)}
        </div>
      </div>
    `;

    _bindListEvents();
  }

  function _renderEmptyState(isEnabled, isPlanMode) {
    if (isPlanMode) {
      return `
        <div class="lrn-empty">
          <div class="lrn-empty-icon">${ICONS.learn}</div>
          <div class="lrn-empty-title">Learning Mode Disabled</div>
          <div class="lrn-empty-desc">
            Learning Mode is unavailable in Plan Mode.
            <br>Switch agent mode to Default or Accept Edits to enable it.
          </div>
        </div>
      `;
    }
    if (!isEnabled) {
      return `
        <div class="lrn-empty">
          <div class="lrn-empty-icon">${ICONS.learn}</div>
          <div class="lrn-empty-title">Learning Mode is Off</div>
          <div class="lrn-empty-desc">
            Enable Learning Mode to get AI explanations after each run.
            <br>Learn what algorithms, design patterns, and concepts were used.
          </div>
          <button class="btn-primary" id="lrnEnableBtn" type="button">Enable Learning</button>
        </div>
      `;
    }
    return `
      <div class="lrn-empty">
        <div class="lrn-empty-icon">${ICONS.lightbulb}</div>
        <div class="lrn-empty-title">No Learning Sessions Yet</div>
        <div class="lrn-empty-desc">
          Run an AI task and a learning explanation will be generated automatically.
          <br>You'll learn what the AI did, why, and how it works.
        </div>
      </div>
    `;
  }

  function _renderEntryList(entries) {
    let html = '<div class="lrn-list">';
    for (const entry of entries) {
      const prompt = truncate(_deriveLearningTitle(entry), 60);
      const time = formatTimestamp(entry.timestamp);
      const status = entry.status || 'pending';
      const canView = status === 'completed';
      const isGenerating = status === 'generating';

      html += `
        <div class="lrn-row ${canView ? 'lrn-row--clickable' : ''}" data-run-id="${escAttr(entry.runRequestId)}">
          <div class="lrn-row-main">
            <div class="lrn-row-info">
              <span class="lrn-row-prompt">${escape(prompt)}</span>
              <span class="lrn-row-time">${escape(time)}</span>
            </div>
            <div class="lrn-row-meta">
              ${renderStatusBadge(status)}
              ${canView ? `<span class="lrn-row-action">${ICONS.chevronRight}</span>` : ''}
            </div>
          </div>
          ${isGenerating ? `<div class="lrn-row-progress"><div class="lrn-progress-bar"></div></div>` : ''}
        </div>
      `;
    }
    html += '</div>';
    return html;
  }

  function _renderDetailView(panel) {
    const ls = window._learningState;
    const entry = ls ? ls.getActiveEntry() : null;

    if (!entry || !entry.content) {
      // Fallback to list
      ls?.setView('list');
      renderLearningPanel();
      return;
    }

    const c = entry.content;
    const prompt = truncate(_deriveLearningTitle(entry), 100);
    
    // Get the full article content - prefer rawText, fallback to combining sections
    const articleContent = c.rawText || _combineContent(c);

    panel.innerHTML = `
      <div class="mcp-manager-container lrn lrn--detail">
        <div class="codeon-panel-topbar codeon-panel-topbar--stack">
          <div class="lrn-detail-header">
            <button class="lrn-back-btn" id="lrnBackBtn" type="button" title="Back to list">
              ${ICONS.back}
            </button>
            <div class="codeon-panel-titlewrap">
              <div class="codeon-panel-title">
                ${ICONS.learn}
                <span>Learning</span>
              </div>
              <div class="codeon-panel-subtitle">${escape(prompt)}</div>
            </div>
            <button class="lrn-delete-btn" id="lrnDeleteBtn" type="button" title="Delete this learning">
              ${ICONS.trash}
            </button>
          </div>
        </div>

        <div class="lrn-detail-body" id="lrnDetailBody">
          <article class="lrn-article">
            ${_formatMarkdown(articleContent)}
          </article>
          ${_renderMetadataSection(entry.metadata)}
        </div>
      </div>
    `;

    _bindDetailEvents(entry);
  }

  // Combine parsed sections back into one article (fallback if rawText not available)
  function _combineContent(c) {
    const parts = [];
    if (c.summary) parts.push(c.summary);
    if (c.reasoning) parts.push(c.reasoning);
    if (c.technical) parts.push(c.technical);
    
    // Add concepts if present
    if (c.concepts && c.concepts.length) {
      parts.push('\n\n## Key Concepts\n');
      for (const concept of c.concepts) {
        parts.push(`\n**${concept.name}** (${concept.category || 'General'})\n${concept.explanation || ''}`);
      }
    }
    
    // Add code highlights if present
    if (c.codeHighlights && c.codeHighlights.length) {
      parts.push('\n\n## Code Highlights\n');
      for (const h of c.codeHighlights) {
        parts.push(`\n**${h.file || 'Code'}**\n\`\`\`\n${h.snippet || ''}\n\`\`\`\n${h.explanation || ''}`);
      }
    }
    
    return parts.join('\n\n');
  }

  function _renderMetadataSection(metadata) {
    if (!metadata) return '';
    const tools = metadata.toolsUsed || [];
    const files = metadata.filesModified || [];
    if (!tools.length && !files.length) return '';

    let html = `
      <div class="lrn-meta-footer">
        <div class="lrn-meta-grid">
    `;
    if (tools.length) {
      html += `
        <div class="lrn-meta-item">
          <span class="lrn-meta-icon">${ICONS.tool}</span>
          <span class="lrn-meta-label">Tools:</span>
          <span class="lrn-meta-value">${tools.map(t => escape(t)).join(', ')}</span>
        </div>
      `;
    }
    if (files.length) {
      html += `
        <div class="lrn-meta-item">
          <span class="lrn-meta-icon">${ICONS.fileCode}</span>
          <span class="lrn-meta-label">Files:</span>
          <span class="lrn-meta-value">${files.slice(0, 5).map(f => escape(f)).join(', ')}${files.length > 5 ? ` (+${files.length - 5} more)` : ''}</span>
        </div>
      `;
    }
    html += '</div></div>';
    return html;
  }

  function _formatMarkdown(text) {
    if (!text) return '';
    
    // Pre-process: remove redundant section markers that we already render as headers
    let cleanedText = text;
    cleanedText = cleanedText.replace(/^#{1,3}\s*\d*\.?\s*(WHAT HAPPENED|THE APPROACH|WHY THIS APPROACH|TECHNICAL CONCEPTS|HOW IT WORKS|KEY CONCEPTS|CONCEPTS TO (?:LEARN|REMEMBER)|CODE (?:WORTH STUDYING|HIGHLIGHTS))[:\s]*$/gim, '');
    
    // Use marked library if available
    if (markedParser) {
      try {
        const html = markedParser(cleanedText);
        // Add our custom classes for styling
        return html
          .replace(/<h1/g, '<h1 class="lrn-h1"')
          .replace(/<h2/g, '<h2 class="lrn-header"')
          .replace(/<h3/g, '<h3 class="lrn-subheader"')
          .replace(/<h4/g, '<h4 class="lrn-subheader"')
          .replace(/<pre>/g, '<pre class="lrn-code-block">')
          .replace(/<code>/g, '<code class="lrn-inline-code">')
          .replace(/<ul>/g, '<ul class="lrn-list">')
          .replace(/<ol>/g, '<ol class="lrn-list">')
          .replace(/<p>/g, '<p class="lrn-paragraph">');
      } catch (e) {
        console.warn('[Learning] Marked parsing failed, falling back to basic formatting:', e);
      }
    }
    
    // Fallback: basic formatting if marked isn't available
    let html = escape(cleanedText);
    // Bold **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    // Inline code `code`
    html = html.replace(/`([^`]+)`/g, '<code class="lrn-inline-code">$1</code>');
    // Line breaks
    html = html.replace(/\n\n/g, '</p><p class="lrn-paragraph">');
    html = html.replace(/\n/g, '<br>');
    return `<p class="lrn-paragraph">${html}</p>`;
  }

  // === Event Bindings ===
  function _bindListEvents() {
    const panel = $('learningManagerPanel');
    if (!panel || panel.__lrnBound) return;
    panel.__lrnBound = true;

    panel.addEventListener('click', (e) => {
      const t = e.target;
      if (!t) return;

      // Enable button
      if (t.id === 'lrnEnableBtn' || t.closest('#lrnEnableBtn')) {
        e.preventDefault();
        if (window.appSettings && window.appSettings.permissionMode === 'plan') {
          try { window.showToast?.('Learning Mode is disabled in Plan Mode.'); } catch { /* ignore */ }
          return;
        }
        window._learningState?.setLearningEnabled(true);
        renderLearningPanel();
        return;
      }

      // Row click (view detail)
      const row = t.closest('.lrn-row--clickable');
      if (row) {
        const runId = row.dataset.runId;
        if (runId) {
          window._learningState?.setActiveEntry(runId);
          renderLearningPanel();
        }
        return;
      }
    });

    panel.addEventListener('change', (e) => {
      if (e.target?.id === 'lrnEnableToggle') {
        if (window.appSettings && window.appSettings.permissionMode === 'plan') {
          e.target.checked = false;
          try { window.showToast?.('Learning Mode is disabled in Plan Mode.'); } catch { /* ignore */ }
          return;
        }
        const checked = e.target.checked;
        window._learningState?.setLearningEnabled(checked);
        // Re-render to update UI state
        setTimeout(() => renderLearningPanel(), 50);
      }
    });
  }

  function _bindDetailEvents(entry) {
    const backBtn = $('lrnBackBtn');
    const deleteBtn = $('lrnDeleteBtn');

    if (backBtn && !backBtn.__lrnBound) {
      backBtn.__lrnBound = true;
      backBtn.addEventListener('click', () => {
        window._learningState?.setView('list');
        renderLearningPanel();
      });
    }

    if (deleteBtn && !deleteBtn.__lrnBound) {
      deleteBtn.__lrnBound = true;
      deleteBtn.addEventListener('click', async () => {
        try {
          const confirm = window.customConfirm 
            ? await window.customConfirm('Delete this learning explanation?', 'Delete Learning')
            : window.confirm('Delete this learning explanation?');
          if (confirm) {
            window._learningState?.deleteEntry(entry.sessionId, entry.runRequestId);
            window._learningState?.setView('list');
            renderLearningPanel();
          }
        } catch { /* ignore */ }
      });
    }
  }

  // === Panel Show/Hide ===
  function showLearningPanel() {
    const panel = $('learningManagerPanel');
    if (panel) {
      panel.style.display = 'flex';
      renderLearningPanel();
    }
  }

  function hideLearningPanel() {
    const panel = $('learningManagerPanel');
    if (panel) {
      panel.style.display = 'none';
    }
  }

  // === Expose API ===
  window._learningPanelUI = {
    render: renderLearningPanel,
    show: showLearningPanel,
    hide: hideLearningPanel
  };

  // Global aliases for middle-tabs integration
  window.renderLearningPanel = renderLearningPanel;
  window.showLearningManager = showLearningPanel;
  window.hideLearningManager = hideLearningPanel;
})();
