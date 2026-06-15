// Plugins Library UI (inside Agents & Skills Library modal)
// Renders a "Plugins" tab/panel and wires actions via delegated click handler in editor-tabs.

function _escape(t) {
  try { return escapeHtml(String(t || '')); } catch { return String(t || ''); }
}

function _escapeAttrSafe(t) {
  try { return escapeAttr(String(t || '')); } catch { return String(t || '').replace(/"/g, '&quot;'); }
}

function renderPluginsLibraryPanel() {
  const panel = document.getElementById('libraryPanelPlugins');
  if (!panel) return;

  const projectPlugins = getProjectPluginsForLibrary();
  const userPlugins = getUserPluginsForLibrary();
  const activeMkt = (typeof getActiveMarketplace === 'function') ? getActiveMarketplace() : null;
  const cached = (typeof getCachedMarketplace === 'function') ? getCachedMarketplace() : null;
  const mktObj = cached && cached.marketplace ? cached.marketplace : null;
  const mktPlugins = (typeof getMarketplacePluginEntries === 'function') ? getMarketplacePluginEntries(mktObj) : [];

  panel.innerHTML = `
    <div class="library-grid">
      <div class="library-card">
        <div class="library-card-header">
          <div class="library-card-title">Marketplace</div>
        </div>
        <div class="library-card-body">
          <div class="library-item-sub" style="margin-bottom:10px;">
            Browse official/community plugins via a Claude Code <code>marketplace.json</code>.
          </div>
          <div class="library-form-row">
            <div class="form-group">
              <label for="libMarketplaceSelect">Marketplace</label>
              <select id="libMarketplaceSelect" class="form-input"></select>
            </div>
            <div class="form-group">
              <label>&nbsp;</label>
              <div class="library-form-actions" style="justify-content:flex-end;">
                <button class="btn-secondary" id="libAddOfficialMarketplaceBtn" type="button">Add official</button>
                <button class="btn-secondary" id="libSyncMarketplaceBtn" type="button">Sync</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="libAddMarketplaceInput">Add marketplace (community)</label>
            <input id="libAddMarketplaceInput" class="form-input" placeholder="owner/repo or https://...repo.git" />
            <small class="form-help">We’ll clone and read <code>.claude-plugin/marketplace.json</code>.</small>
            <div class="library-form-actions" style="margin-top:8px;">
              <button class="btn-secondary" id="libAddMarketplaceBtn" type="button">Add marketplace</button>
            </div>
          </div>
          <div class="form-group">
            <label for="libMarketplaceSearch">Search plugins</label>
            <input id="libMarketplaceSearch" class="form-input" placeholder="Search by name…" />
          </div>
          <div class="library-form-actions">
            <button class="btn-secondary" id="libRefreshPluginsBtn" type="button">Refresh installed</button>
          </div>
          <div style="height:14px;"></div>
          <div class="library-item-title" style="margin-bottom:8px;">Install from Git (advanced)</div>
          <div class="form-group">
            <label for="libPluginInstallScope">Location</label>
            <select id="libPluginInstallScope" class="form-input">
              <option value="project">Project</option>
              <option value="user">User (~/.claude)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="libPluginRepoUrl">Git repo URL</label>
            <input id="libPluginRepoUrl" class="form-input" placeholder="https://github.com/org/repo.git" />
          </div>
          <div class="form-group">
            <label for="libPluginDirName">Folder name (optional)</label>
            <input id="libPluginDirName" class="form-input" placeholder="Defaults to repo name" />
          </div>
          <div class="library-form-actions">
            <button class="btn-secondary" id="libInstallPluginBtn" type="button">Install from Git</button>
          </div>
          <div class="library-item-sub" style="margin-top:10px;">
            <strong>Security note:</strong> plugins may include hooks and scripts that run commands. Only install plugins you trust.
          </div>
          <div style="height:12px;"></div>
          <div class="library-item-title" style="margin-bottom:8px;">Marketplace plugins</div>
          <div class="library-list" id="libMarketplacePluginsList"></div>
        </div>
      </div>

      <div class="library-card">
        <div class="library-card-header">
          <div class="library-card-title">Installed plugins</div>
        </div>
        <div class="library-card-body">
          <div class="library-item-title" style="margin-bottom:8px;">Project plugins</div>
          <div class="library-list" id="libProjectPluginsList"></div>
          <div style="height:12px;"></div>
          <div class="library-item-title" style="margin-bottom:8px;">User plugins (~/.claude)</div>
          <div class="library-list" id="libUserPluginsList"></div>
        </div>
      </div>
    </div>
  `;

  // Populate marketplaces dropdown
  const mSel = document.getElementById('libMarketplaceSelect');
  if (mSel && typeof marketplaceSources !== 'undefined') {
    const srcs = Array.isArray(marketplaceSources) ? marketplaceSources : [];
    if (!srcs.length) {
      mSel.innerHTML = `<option value="">No marketplaces yet</option>`;
    } else {
      mSel.innerHTML = srcs.map(m => {
        const label = m.id.startsWith('github:') ? m.id.replace(/^github:/, '') : m.id.replace(/^(git:)/, '');
        const selected = activeMkt && m.id === activeMkt.id ? 'selected' : '';
        return `<option value="${_escapeAttrSafe(m.id)}" ${selected}>${_escape(label)}</option>`;
      }).join('');
    }
  }

  // Bind marketplace select + search each render (elements are replaced on re-render)
  try {
    if (mSel) {
      mSel.onchange = () => {
        try {
          const val = String(mSel.value || '').trim();
          if (!val) return;
          if (typeof setActiveMarketplace === 'function') setActiveMarketplace(val);
          try { window._codeonMarketplaceSearchQuery = String(document.getElementById('libMarketplaceSearch')?.value || ''); } catch { /* ignore */ }
          renderAgentSkillLibrary();
          switchAgentSkillLibraryTab('plugins');
        } catch { /* ignore */ }
      };
    }
    const search = document.getElementById('libMarketplaceSearch');
    if (search) {
      const prev = typeof window._codeonMarketplaceSearchQuery === 'string' ? window._codeonMarketplaceSearchQuery : '';
      search.value = prev;
      search.oninput = () => {
        try {
          window._codeonMarketplaceSearchQuery = String(search.value || '');
          // re-render just the plugins panel to apply filter
          if (typeof renderPluginsLibraryPanel === 'function') renderPluginsLibraryPanel();
        } catch { /* ignore */ }
      };
    }
  } catch { /* ignore */ }

  // Marketplace plugin list
  const mpl = document.getElementById('libMarketplacePluginsList');
  if (mpl) {
    if (!activeMkt) {
      mpl.innerHTML = `<div class="library-item-sub">Add a marketplace to see plugins.</div>`;
    } else if (!mktObj) {
      const label = _escape(activeMkt.id.replace(/^github:/, '').replace(/^git:/, ''));
      mpl.innerHTML = `<div class="library-item-sub">Marketplace <strong>${label}</strong> not loaded yet. Click <strong>Sync</strong>.</div>`;
    } else if (!mktPlugins || mktPlugins.length === 0) {
      mpl.innerHTML = `<div class="library-item-sub">No plugins found in this marketplace.</div>`;
    } else {
      const q = (typeof window._codeonMarketplaceSearchQuery === 'string' ? window._codeonMarketplaceSearchQuery : '').trim().toLowerCase();
      const filtered = q
        ? mktPlugins.filter(plg => String(plg?.name || '').toLowerCase().includes(q))
        : mktPlugins;
      const renderMktPlugin = (plg) => {
        const name = _escape(plg.name || '');
        const desc = _escape(plg.description || '');
        const category = plg.category ? `<span class="codeon-panel-title-pill" style="margin-left:8px;">${_escape(plg.category)}</span>` : '';
        const tags = Array.isArray(plg.tags) && plg.tags.length
          ? `<div class="library-item-sub" style="margin-top:6px;">${plg.tags.slice(0, 6).map(t => `<span class="codeon-panel-title-pill" style="margin-right:6px;">${_escape(t)}</span>`).join('')}</div>`
          : '';
        const src = plg.source && typeof plg.source === 'object' ? plg.source : null;
        const srcLabel = src
          ? (src.source === 'github' ? `GitHub: ${src.repo}` : (src.source === 'url' ? `Git: ${src.url}` : `Source: ${src.source}`))
          : (typeof plg.source === 'string' ? `Local: ${plg.source}` : '');
        const installable = !!(src && (src.source === 'github' || src.source === 'url'));
        return `
          <div class="library-item">
            <div>
              <div class="library-item-title">${name}${category}</div>
              ${desc ? `<div class="library-item-sub">${desc}</div>` : ''}
              <div class="library-item-sub mono" style="margin-top:6px;">${_escape(srcLabel)}</div>
              ${tags}
            </div>
            <div class="library-item-actions">
              <button class="btn-secondary" data-action="marketplace-install-plugin" data-marketplace="${_escapeAttrSafe(activeMkt.id)}" data-plugin="${_escapeAttrSafe(plg.name || '')}" type="button" ${installable ? '' : 'disabled'}>Install</button>
            </div>
          </div>
        `;
      };
      mpl.innerHTML = filtered.slice(0, 200).map(renderMktPlugin).join('');
    }
  }

  const pl = document.getElementById('libProjectPluginsList');
  const ul = document.getElementById('libUserPluginsList');
  if (!pl || !ul) return;

  const renderItem = (p) => {
    const name = _escape(p.name || p.dirName || 'Plugin');
    const version = p.version ? `<span class="codeon-panel-title-pill" style="margin-left:8px;">v${_escape(p.version)}</span>` : '';
    const desc = p.description ? `<div class="library-item-sub">${_escape(p.description)}</div>` : `<div class="library-item-sub">${_escape(p.pluginRootPath || '')}</div>`;
    const enabled = p.enabled === true;
    const toggleLabel = enabled ? 'Disable' : 'Enable';
    const toggleAction = enabled ? 'disable-plugin' : 'enable-plugin';
    const openBtn = p.scope === 'project'
      ? `<button class="btn-secondary" data-action="open-plugin-manifest" data-path="${_escapeAttrSafe(p.manifestPath)}" type="button">Open</button>`
      : '';

    return `
      <div class="library-item">
        <div>
          <div class="library-item-title">${name}${version}</div>
          ${desc}
          <div class="library-item-sub mono" style="margin-top:6px;">${_escape(p.pluginRootPath || '')}</div>
        </div>
        <div class="library-item-actions">
          <button class="btn-secondary" data-action="${toggleAction}" data-scope="${_escapeAttrSafe(p.scope)}" data-root="${_escapeAttrSafe(p.pluginRootPath)}" type="button">${toggleLabel}</button>
          ${openBtn}
          <button class="btn-secondary" data-action="reveal-plugin" data-scope="${_escapeAttrSafe(p.scope)}" data-root="${_escapeAttrSafe(p.pluginRootPath)}" data-rel="${_escapeAttrSafe(p.userRelDir || '')}" type="button">Reveal</button>
          <button class="btn-secondary" data-action="uninstall-plugin" data-scope="${_escapeAttrSafe(p.scope)}" data-root="${_escapeAttrSafe(p.pluginRootPath)}" data-rel="${_escapeAttrSafe(p.userRelDir || '')}" type="button">Uninstall</button>
        </div>
      </div>
    `;
  };

  if (!projectPlugins || projectPlugins.length === 0) {
    pl.innerHTML = `<div class="library-item-sub">No project plugins found.</div>`;
  } else {
    pl.innerHTML = projectPlugins.map(renderItem).join('');
  }
  if (!userPlugins || userPlugins.length === 0) {
    ul.innerHTML = `<div class="library-item-sub">No user plugins found.</div>`;
  } else {
    ul.innerHTML = userPlugins.map(renderItem).join('');
  }
}

