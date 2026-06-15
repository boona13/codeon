// Plugins tab UI (dedicated middle-tab panel)
// Compact, single-column design optimized for the constrained middle panel area.

(function () {
  'use strict';

  const state = {
    view: 'marketplace', // 'marketplace' | 'installed'
    query: '',
    expanded: null // plugin key for inline expansion
  };

  function $(id) { return document.getElementById(id); }

  function escape(t) {
    try { return escapeHtml(String(t || '')); } catch { return String(t || ''); }
  }

  function escAttr(t) {
    try { return escapeAttr(String(t || '')); } catch { return String(t || '').replace(/"/g, '&quot;'); }
  }

  function _gitUrl(src) {
    const s = src && typeof src === 'object' ? src : null;
    if (!s) return '';
    if (s.source === 'github' && s.repo) return `https://github.com/${String(s.repo).trim()}.git`;
    if (s.source === 'url' && s.url) return String(s.url).trim();
    return '';
  }

  async function _localPluginPath(entry) {
    const cache = (typeof getCachedMarketplace === 'function') ? getCachedMarketplace() : null;
    const meta = cache?.meta, cacheDir = meta?.cacheDir || '';
    if (!cacheDir) return '';
    const mkt = cache?.marketplace;
    const root = mkt?.metadata?.pluginRoot || '';
    const src = typeof entry?.source === 'string' ? entry.source.trim() : '';
    if (!src) return '';
    const rel = root ? `${root.replace(/\/+$/, '')}/${src.replace(/^\.?\/?/, '')}` : src.replace(/^\.?\/?/, '');
    try {
      if (window.electronAPI?.path?.join) return await window.electronAPI.path.join(cacheDir, rel);
    } catch { /* ignore */ }
    return `${cacheDir.replace(/\/+$/, '')}/${rel}`;
  }

  async function _showPluginReadme(pluginName, pluginPath) {
    // Try to read README.md from the plugin directory
    let content = '';
    let title = pluginName || 'Plugin Info';
    
    try {
      if (pluginPath && window.electronAPI) {
        // Try different README file names
        const readmeNames = ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'readme.txt'];
        const isAbsolute = pluginPath.startsWith('/') || pluginPath.includes('/.claude/');
        
        for (const name of readmeNames) {
          try {
            const readmePath = `${pluginPath.replace(/\/+$/, '')}/${name}`;
            let res;
            if (isAbsolute) {
              // Absolute path (user plugin from cache or installed) - use dedicated API
              res = await window.electronAPI.userClaudeReadAbsFile?.(readmePath);
            } else {
              // Relative path (project plugin)
              res = await window.electronAPI.readFile?.(readmePath);
            }
            if (res?.success && res.content) {
              content = res.content;
              break;
            }
          } catch { /* try next */ }
        }
      }
    } catch (err) {
      console.warn('[Plugins] Error reading README:', err);
    }

    if (!content) {
      content = `# ${title}\n\nNo README available for this plugin.`;
    }

    // Render markdown to HTML (simple conversion)
    const htmlContent = _simpleMarkdownToHtml(content);

    // Show in modal
    _showReadmeModal(title, htmlContent);
  }

  function _simpleMarkdownToHtml(md) {
    let html = escape(md);
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Code blocks
    html = html.replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    return `<p>${html}</p>`;
  }

  function _showReadmeModal(title, htmlContent) {
    // Remove existing modal if any
    const existing = document.getElementById('plgReadmeModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'plgReadmeModal';
    modal.className = 'plg-readme-modal';
    modal.innerHTML = `
      <div class="plg-readme-backdrop" data-action="plg-readme-close"></div>
      <div class="plg-readme-content">
        <div class="plg-readme-header">
          <h3>${escape(title)}</h3>
          <button class="plg-readme-close" data-action="plg-readme-close" type="button">✕</button>
        </div>
        <div class="plg-readme-body">${htmlContent}</div>
      </div>
    `;
    document.body.appendChild(modal);

    // Auto-close on Escape
    const onKey = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  async function _ensureMarketplace() {
    try {
      if (typeof ensureOfficialMarketplaceAdded === 'function') await ensureOfficialMarketplaceAdded();
      if (typeof loadMarketplaceSources === 'function') await loadMarketplaceSources();
      const c = (typeof getCachedMarketplace === 'function') ? getCachedMarketplace() : null;
      if (!c && typeof syncActiveMarketplace === 'function') await syncActiveMarketplace();
    } catch { /* ignore */ }
  }

  function renderPluginsManager() {
    const panel = $('pluginsManagerPanel');
    if (!panel) return;

    const mkt = (typeof getActiveMarketplace === 'function') ? getActiveMarketplace() : null;
    const cache = (typeof getCachedMarketplace === 'function') ? getCachedMarketplace() : null;
    const mktObj = cache?.marketplace;
    const projectPlugins = (typeof getProjectPluginsForLibrary === 'function') ? getProjectPluginsForLibrary() : [];
    const userPlugins = (typeof getUserPluginsForLibrary === 'function') ? getUserPluginsForLibrary() : [];
    const installedCount = (projectPlugins?.length || 0) + (userPlugins?.length || 0);

    panel.innerHTML = `
      <div class="mcp-manager-container plg">
        <div class="codeon-panel-topbar">
          <div class="codeon-panel-titlewrap">
            <div class="codeon-panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <path d="M3.3 7l8.7 5 8.7-5"></path>
                <path d="M12 22V12"></path>
              </svg>
              <span>Plugins</span>
              <span class="codeon-panel-title-pill">Claude Code</span>
            </div>
            <div class="codeon-panel-subtitle">Browse marketplaces and manage installed plugins.</div>
          </div>
          <div class="codeon-panel-actions">
            <button class="btn-secondary" id="plgRefresh" type="button">Refresh</button>
            <button class="btn-secondary" id="plgSync" type="button">Sync</button>
          </div>
        </div>

        <div class="plg-controls">
          <div class="plg-tabs">
            <button class="plg-tab ${state.view === 'marketplace' ? 'active' : ''}" type="button" data-plg-tab="marketplace">Marketplace</button>
            <button class="plg-tab ${state.view === 'installed' ? 'active' : ''}" type="button" data-plg-tab="installed">Installed${installedCount ? ` (${installedCount})` : ''}</button>
          </div>
          <div class="plg-search">
            <input class="plg-search-input" id="plgSearch" type="text" placeholder="Search…" value="${escAttr(state.query)}" />
          </div>
        </div>

        <div class="plg-body" id="plgBody"></div>

        <div class="plg-footer">
          <details class="plg-manual">
            <summary>Install from Git URL</summary>
            <div class="plg-manual-form">
              <select id="plgManualScope" class="plg-select">
                <option value="user">User (~/.claude)</option>
                <option value="project">Project</option>
              </select>
              <input id="plgManualUrl" class="plg-input" placeholder="https://github.com/org/repo.git" />
              <button class="plg-btn-primary" id="plgManualInstall" type="button">Install</button>
            </div>
          </details>
        </div>
      </div>
    `;

    _renderBody({ mkt, mktObj, projectPlugins, userPlugins });
  }

  function _renderBody({ mkt, mktObj, projectPlugins, userPlugins }) {
    const body = $('plgBody');
    if (!body) return;
    const q = state.query.trim().toLowerCase();

    if (state.view === 'marketplace') {
      const entries = (typeof getMarketplacePluginEntries === 'function') ? getMarketplacePluginEntries(mktObj) : [];
      const list = q ? entries.filter(p => `${p?.name || ''} ${p?.description || ''}`.toLowerCase().includes(q)) : entries;

      if (!mkt) {
        body.innerHTML = `<div class="plg-empty">Loading…</div>`;
        return;
      }
      if (!mktObj) {
        body.innerHTML = `<div class="plg-empty">Marketplace not synced.<br><button class="plg-link-btn" id="plgSyncInline" type="button">Sync now</button></div>`;
        return;
      }
      if (!list.length) {
        body.innerHTML = `<div class="plg-empty">No plugins found.</div>`;
        return;
      }

      body.innerHTML = list.slice(0, 100).map((p) => {
        const name = escape(p.name || 'Plugin');
        const desc = escape(p.description || '');
        const cat = p.category ? `<span class="plg-cat">${escape(p.category)}</span>` : '';
        const srcObj = p.source && typeof p.source === 'object' ? p.source : null;
        const git = _gitUrl(srcObj);
        const isLocal = !git && typeof p.source === 'string' && p.source.trim();
        const srcLbl = git
          ? (srcObj?.source === 'github' ? escape(srcObj.repo) : 'Git')
          : (isLocal ? 'Bundled' : '—');
        const canInstall = git || isLocal;
        const expanded = state.expanded === p.name;
        return `
          <div class="plg-row${expanded ? ' expanded' : ''}" data-key="${escAttr(p.name)}">
            <div class="plg-row-main" data-action="plg-toggle" data-key="${escAttr(p.name)}">
              <div class="plg-row-info">
                <span class="plg-row-name">${name}</span>
                ${cat}
                <span class="plg-row-src">${srcLbl}</span>
              </div>
              <span class="plg-row-chevron">${expanded ? '▾' : '▸'}</span>
            </div>
            ${expanded ? `
              <div class="plg-row-detail">
                <div class="plg-row-desc">${desc || 'No description.'}</div>
                <div class="plg-row-actions">
                  <button class="plg-btn-sm" data-action="plg-info" data-key="${escAttr(p.name)}" data-src="${escAttr(typeof p.source === 'string' ? p.source : '')}" type="button">Info</button>
                  <button class="plg-btn-primary" data-action="plg-install" data-key="${escAttr(p.name)}" type="button" ${canInstall ? '' : 'disabled'}>Install</button>
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
      return;
    }

    // Installed
    const all = [...(projectPlugins || []), ...(userPlugins || [])];
    const list = q ? all.filter(p => `${p?.name || ''} ${p?.dirName || ''} ${p?.pluginRootPath || ''}`.toLowerCase().includes(q)) : all;

    if (!list.length) {
      body.innerHTML = `<div class="plg-empty">No installed plugins.</div>`;
      return;
    }

    body.innerHTML = list.map((p) => {
      const name = escape(p.name || p.dirName || 'Plugin');
      const scope = p.scope === 'user' ? 'User' : 'Project';
      const enabled = p.enabled === true;
      const expanded = state.expanded === p.id;
      return `
        <div class="plg-row${expanded ? ' expanded' : ''}" data-key="${escAttr(p.id)}">
          <div class="plg-row-main" data-action="plg-toggle" data-key="${escAttr(p.id)}">
            <div class="plg-row-info">
              <span class="plg-row-name">${name}</span>
              <span class="plg-cat">${scope}</span>
              <span class="plg-status ${enabled ? 'on' : 'off'}">${enabled ? '●' : '○'}</span>
            </div>
            <span class="plg-row-chevron">${expanded ? '▾' : '▸'}</span>
          </div>
          ${expanded ? `
            <div class="plg-row-detail">
              <div class="plg-row-desc mono">${escape(p.pluginRootPath || '')}</div>
              <div class="plg-row-actions">
                <button class="plg-btn-sm" data-action="plg-info-installed" data-key="${escAttr(p.name || p.dirName)}" data-root="${escAttr(p.pluginRootPath)}" data-scope="${escAttr(p.scope)}" type="button">Info</button>
                <button class="plg-btn-sm" data-action="${enabled ? 'plg-disable' : 'plg-enable'}" data-scope="${escAttr(p.scope)}" data-root="${escAttr(p.pluginRootPath)}" data-rel="${escAttr(p.userRelDir || '')}" type="button">${enabled ? 'Disable' : 'Enable'}</button>
                <button class="plg-btn-sm" data-action="plg-reveal" data-scope="${escAttr(p.scope)}" data-root="${escAttr(p.pluginRootPath)}" type="button">Reveal</button>
                <button class="plg-btn-danger" data-action="plg-uninstall" data-scope="${escAttr(p.scope)}" data-root="${escAttr(p.pluginRootPath)}" data-rel="${escAttr(p.userRelDir || '')}" type="button">Remove</button>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  async function showPluginsManager() {
    const panel = $('pluginsManagerPanel');
    if (!panel) return;
    panel.style.display = 'flex';
    await _ensureMarketplace();
    try {
      await loadProjectPlugins();
    } catch { /* ignore */ }
    renderPluginsManager();
  }

  function hidePluginsManager() {
    const panel = $('pluginsManagerPanel');
    if (panel) panel.style.display = 'none';
  }

  async function _installFromRepo({ repoUrl, dirName, scope }) {
    const repo = String(repoUrl || '').trim();
    if (!repo) throw new Error('Missing repo URL.');
    const sc = scope === 'project' ? 'project' : 'user';
    const folder = String(dirName || '').trim();

    if (sc === 'user') {
      if (!window.electronAPI?.userClaudePluginInstallGit) throw new Error('Install API unavailable.');
      const r = await window.electronAPI.userClaudePluginInstallGit({ repoUrl: repo, dirName: folder });
      if (!r?.success) throw new Error(r?.error || 'Install failed.');
      try { await enableUserPlugin(String(r.destAbs || '').trim()); } catch { /* ignore */ }
      return;
    }

    if (!window.electronAPI?.createDirectory || !window.electronAPI?.runTerminalCommandInDir) throw new Error('APIs unavailable.');
    await window.electronAPI.createDirectory('.claude/plugins');
    const guess = repo.split('/').filter(Boolean).pop() || 'plugin';
    const safe = (folder || guess).replace(/\.git$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    if (!safe) throw new Error('Invalid folder name.');
    const q = window.Codeon?.utils?.shellQuote || ((s) => `'${String(s).replace(/'/g, `'"'"'`)}'`);
    const cmd = `git clone --depth 1 ${q(repo)} ${q(safe)}`;
    const rr = await window.electronAPI.runTerminalCommandInDir({ command: cmd, workingDir: '.claude/plugins', timeoutMs: 180000, waitForCompletion: true });
    if (!rr?.success) throw new Error(rr?.error || 'Clone failed.');
    try { await enableProjectPlugin(`.claude/plugins/${safe}`); } catch { /* ignore */ }
  }

  function _bindOnce() {
    if (window.__plgBound) return;
    window.__plgBound = true;

    document.addEventListener('click', async (e) => {
      const btn = e.target?.closest?.('button, [data-action]');
      if (!btn) return;
      const id = btn.id || '';
      const action = btn.dataset?.action || '';

      // Header buttons
      if (id === 'plgRefresh') {
        e.preventDefault();
        try { await loadProjectPlugins(); } catch { /* ignore */ }
        renderPluginsManager();
        try { showToast('Refreshed'); } catch { /* ignore */ }
        return;
      }
      if (id === 'plgSync' || id === 'plgSyncInline') {
        e.preventDefault();
        try {
          await _ensureMarketplace();
          if (typeof syncActiveMarketplace === 'function') await syncActiveMarketplace();
          renderPluginsManager();
          try { showToast('Synced'); } catch { /* ignore */ }
        } catch (err) {
          await customAlert(String(err?.message || err), 'Sync');
        }
        return;
      }

      // Manual install from Git
      if (id === 'plgManualInstall') {
        e.preventDefault();
        try {
          const scope = String($('plgManualScope')?.value || 'user').trim();
          const repoUrl = String($('plgManualUrl')?.value || '').trim();
          if (!repoUrl) throw new Error('Please enter a Git URL.');
          await _installFromRepo({ repoUrl, scope });
          await loadProjectPlugins?.();
          renderPluginsManager();
          try { showToast('Installed'); } catch { /* ignore */ }
        } catch (err) {
          await customAlert(String(err?.message || err), 'Install');
        }
        return;
      }

      // Tabs
      if (btn.dataset?.plgTab) {
        e.preventDefault();
        state.view = btn.dataset.plgTab;
        state.expanded = null;
        renderPluginsManager();
        return;
      }

      // Toggle expand
      if (action === 'plg-toggle') {
        e.preventDefault();
        const key = btn.dataset?.key || '';
        state.expanded = state.expanded === key ? null : key;
        _reRenderBody();
        return;
      }

      // Info (marketplace plugin)
      if (action === 'plg-info') {
        e.preventDefault();
        try {
          const nm = String(btn.dataset?.key || '').trim();
          const src = String(btn.dataset?.src || '').trim();
          if (!nm) return;
          // Resolve path from marketplace cache
          const cache = getCachedMarketplace?.();
          const entries = getMarketplacePluginEntries?.(cache?.marketplace) || [];
          const entry = entries.find(x => x?.name === nm);
          const pluginPath = entry ? await _localPluginPath(entry) : '';
          await _showPluginReadme(nm, pluginPath);
        } catch (err) {
          console.error('[Plugins] Info error:', err);
        }
        return;
      }

      // Info (installed plugin)
      if (action === 'plg-info-installed') {
        e.preventDefault();
        try {
          const nm = String(btn.dataset?.key || '').trim();
          const root = String(btn.dataset?.root || '').trim();
          if (!nm || !root) return;
          await _showPluginReadme(nm, root);
        } catch (err) {
          console.error('[Plugins] Info error:', err);
        }
        return;
      }

      // Close readme modal
      if (action === 'plg-readme-close') {
        e.preventDefault();
        const modal = document.getElementById('plgReadmeModal');
        if (modal) modal.remove();
        return;
      }

      // Install
      if (action === 'plg-install') {
        e.preventDefault();
        const nm = String(btn.dataset?.key || '').trim();
        if (!nm) return;
        try {
          const cache = getCachedMarketplace?.();
          const entries = getMarketplacePluginEntries?.(cache?.marketplace) || [];
          const entry = entries.find(x => x?.name === nm);
          if (!entry) throw new Error('Plugin not found.');

          const srcObj = entry.source && typeof entry.source === 'object' ? entry.source : null;
          const git = _gitUrl(srcObj);
          const isLocal = !git && typeof entry.source === 'string' && entry.source.trim();
          if (!git && !isLocal) throw new Error('Unsupported source.');

          const ok = await customConfirm(`Install "${nm}"?`, 'Install');
          if (!ok) return;

          if (git) {
            await _installFromRepo({ repoUrl: git, dirName: nm, scope: 'user' });
          } else {
            if (!window.electronAPI?.userClaudePluginInstallFromDir) throw new Error('API unavailable.');
            const srcAbs = await _localPluginPath(entry);
            if (!srcAbs) throw new Error('Cannot resolve path.');
            const r = await window.electronAPI.userClaudePluginInstallFromDir({ srcAbs, dirName: nm });
            if (!r?.success) throw new Error(r?.error || 'Install failed.');
            try { await enableUserPlugin(String(r.destAbs || '').trim()); } catch { /* ignore */ }
          }
          await loadProjectPlugins?.();
          renderPluginsManager();
          try { showToast('Installed'); } catch { /* ignore */ }
        } catch (err) {
          await customAlert(String(err?.message || err), 'Install');
        }
        return;
      }

      // Enable/Disable
      if (action === 'plg-enable' || action === 'plg-disable') {
        e.preventDefault();
        try {
          const scope = btn.dataset?.scope || '';
          const root = btn.dataset?.root || '';
          if (!root) throw new Error('Missing path.');
          const enable = action === 'plg-enable';
          if (scope === 'user') {
            if (enable) await enableUserPlugin(root);
            else await disableUserPlugin(root);
          } else {
            if (enable) await enableProjectPlugin(root);
            else await disableProjectPlugin(root);
          }
          await loadProjectPlugins?.();
          renderPluginsManager();
          try { showToast(enable ? 'Enabled' : 'Disabled'); } catch { /* ignore */ }
        } catch (err) {
          await customAlert(String(err?.message || err), 'Plugins');
        }
        return;
      }

      // Reveal
      if (action === 'plg-reveal') {
        e.preventDefault();
        try {
          const scope = btn.dataset?.scope || '';
          const root = btn.dataset?.root || '';
          if (!window.electronAPI?.revealInFinder) return;
          if (scope === 'user') {
            await window.electronAPI.revealInFinder(root);
          } else {
            const abs = window.electronAPI.path?.join && window.currentFolder
              ? await window.electronAPI.path.join(window.currentFolder, root)
              : root;
            await window.electronAPI.revealInFinder(abs);
          }
        } catch { /* ignore */ }
        return;
      }

      // Uninstall
      if (action === 'plg-uninstall') {
        e.preventDefault();
        try {
          const scope = btn.dataset?.scope || '';
          const root = btn.dataset?.root || '';
          const rel = btn.dataset?.rel || '';
          const ok = await customConfirm('Remove this plugin?', 'Remove');
          if (!ok) return;

          if (scope === 'user') {
            try { await disableUserPlugin(root); } catch { /* ignore */ }
            const ur = rel || root?.split('/').filter(Boolean).pop() || '';
            if (!ur) throw new Error('Missing dir.');
            const r = await window.electronAPI.userClaudePluginUninstall({ rel: ur });
            if (!r?.success) throw new Error(r?.error || 'Failed.');
          } else {
            try { await disableProjectPlugin(root); } catch { /* ignore */ }
            const r = await window.electronAPI.deleteFile(root);
            if (!r?.success) throw new Error(r?.error || 'Failed.');
          }
          await loadProjectPlugins?.();
          renderPluginsManager();
          try { showToast('Removed'); } catch { /* ignore */ }
        } catch (err) {
          await customAlert(String(err?.message || err), 'Remove');
        }
      }
    }, true);

    document.addEventListener('input', (e) => {
      if (e.target?.id === 'plgSearch') {
        state.query = e.target.value || '';
        _reRenderBody();
      }
    }, true);
  }

  function _reRenderBody() {
    const mkt = getActiveMarketplace?.();
    const cache = getCachedMarketplace?.();
    const mktObj = cache?.marketplace;
    const projectPlugins = getProjectPluginsForLibrary?.() || [];
    const userPlugins = getUserPluginsForLibrary?.() || [];
    _renderBody({ mkt, mktObj, projectPlugins, userPlugins });
  }

  _bindOnce();

  window.renderPluginsManager = renderPluginsManager;
  window.showPluginsManager = showPluginsManager;
  window.hidePluginsManager = hidePluginsManager;
})();
