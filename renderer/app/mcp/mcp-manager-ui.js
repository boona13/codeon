// MCP Manager UI
// User interface for managing MCP (Model Context Protocol) servers

(function () {
  'use strict';

  let currentEditingServerId = null;
  let selectedServerId = null;
  let _prevEditorVis = null; // { editorDisplay, diffDisplay, emptyDisplay }
  let editorMode = 'form';

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function mcpAlert(message, titleText = 'MCP') {
    try {
      if (typeof window.customAlert === 'function') return window.customAlert(String(message || ''), titleText);
    } catch { /* ignore */ }
    try { window.alert(String(message || '')); } catch { /* ignore */ }
    return Promise.resolve(true);
  }

  function mcpConfirm(message, titleText = 'MCP', opts = {}) {
    try {
      if (typeof window.customConfirm === 'function') return window.customConfirm(String(message || ''), titleText, opts);
    } catch { /* ignore */ }
    try { return Promise.resolve(window.confirm(String(message || ''))); } catch { /* ignore */ }
    return Promise.resolve(false);
  }

  function normalizeMcpServerKey(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 48);
  }

  function getEditorModeEls() {
    return {
      modeBtns: Array.from(document.querySelectorAll('[data-mcp-editor-mode]')),
      formFields: document.getElementById('mcpEditorFormFields'),
      jsonFields: document.getElementById('mcpEditorJsonFields'),
      jsonInput: document.getElementById('mcpServerJson')
    };
  }

  function normalizeServerType(rawType, cfg = {}) {
    const raw = String(rawType || '').trim().toLowerCase();
    if (raw === 'http') return 'sse';
    if (raw === 'sse' || raw === 'stdio') return raw;
    if (cfg && typeof cfg === 'object') {
      if (cfg.command) return 'stdio';
      if (cfg.url) return 'sse';
    }
    return 'stdio';
  }

  function coerceEnvValue(envVal) {
    if (!envVal) return {};
    if (typeof envVal === 'object' && !Array.isArray(envVal)) return envVal;
    if (typeof envVal === 'string') {
      try {
        const parsed = JSON.parse(envVal);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }

  function normalizeServerConfig(rawCfg, nameHint = '') {
    const cfg = (rawCfg && typeof rawCfg === 'object') ? rawCfg : {};
    const nameRaw = String(cfg.name || nameHint || '').trim();
    const name = normalizeMcpServerKey(nameRaw);
    const type = normalizeServerType(cfg.type, cfg);
    const command = String(cfg.command || '').trim();
    const url = String(cfg.url || '').trim();
    const args = Array.isArray(cfg.args) ? cfg.args.map(v => String(v)) : [];
    const env = coerceEnvValue(cfg.env);
    const headers = (cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)) ? cfg.headers : {};
    const description = String(cfg.description || '').trim();
    const enabled = (typeof cfg.enabled === 'boolean') ? cfg.enabled : true;

    return {
      name,
      type,
      command: type === 'stdio' ? command : undefined,
      args: type === 'stdio' ? args : undefined,
      env: type === 'stdio' ? env : undefined,
      url: type === 'sse' ? url : undefined,
      headers: type === 'sse' ? headers : undefined,
      description,
      enabled
    };
  }

  function parseServerJsonInput(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Invalid JSON');
    }

    // Support .mcp.json format: { mcpServers: { key: cfg, ... } } or array
    if (parsed && typeof parsed === 'object' && parsed.mcpServers) {
      const servers = parsed.mcpServers;
      if (Array.isArray(servers)) {
        return servers.map(cfg => normalizeServerConfig(cfg));
      }
      if (servers && typeof servers === 'object') {
        return Object.entries(servers).map(([key, cfg]) => normalizeServerConfig(cfg, key));
      }
    }

    // Support direct array of servers
    if (Array.isArray(parsed)) {
      return parsed.map(cfg => normalizeServerConfig(cfg));
    }

    // Support a single server object
    if (parsed && typeof parsed === 'object') {
      return [normalizeServerConfig(parsed)];
    }

    return [];
  }

  function buildServerConfigFromForm({ allowInvalidEnv = false } = {}) {
    const nameRaw = document.getElementById('mcpServerName').value.trim();
    const name = normalizeMcpServerKey(nameRaw);
    const type = document.getElementById('mcpServerType').value;
    const command = document.getElementById('mcpServerCommand').value.trim();
    const argsText = document.getElementById('mcpServerArgs').value.trim();
    const envText = document.getElementById('mcpServerEnv').value.trim();
    const url = document.getElementById('mcpServerUrl').value.trim();
    const description = document.getElementById('mcpServerDescription').value.trim();
    const enabled = document.getElementById('mcpServerEnabled').checked;

    const args = argsText ? argsText.split('\n').map(a => a.trim()).filter(Boolean) : [];
    const env = envText ? coerceEnvValue(envText) : {};

    return {
      name,
      type,
      command: type === 'stdio' ? command : undefined,
      args: type === 'stdio' ? args : undefined,
      env: type === 'stdio' ? (env || (allowInvalidEnv ? envText : {})) : undefined,
      url: type === 'sse' ? url : undefined,
      headers: type === 'sse' ? getHeadersObjectFromEditor() : undefined,
      description,
      enabled
    };
  }

  function applyServerConfigToForm(server) {
    if (!server) return;
    document.getElementById('mcpServerName').value = server.name || '';
    document.getElementById('mcpServerType').value = server.type || 'stdio';
    document.getElementById('mcpServerCommand').value = server.command || '';
    document.getElementById('mcpServerArgs').value = (server.args || []).join('\n');
    document.getElementById('mcpServerEnv').value = server.env ? JSON.stringify(server.env, null, 2) : '';
    document.getElementById('mcpServerUrl').value = server.url || '';
    setHeadersEditorFromObject(server.headers || {});
    document.getElementById('mcpServerDescription').value = server.description || '';
    document.getElementById('mcpServerEnabled').checked = server.enabled !== false;

    const typeSelect = document.getElementById('mcpServerType');
    if (typeSelect) typeSelect.onchange?.();
  }

  function syncJsonFromForm() {
    const { jsonInput } = getEditorModeEls();
    if (!jsonInput) return;
    const cfg = buildServerConfigFromForm({ allowInvalidEnv: true });
    jsonInput.value = JSON.stringify(cfg, null, 2);
  }

  async function syncFormFromJson() {
    const { jsonInput } = getEditorModeEls();
    if (!jsonInput) return true;
    let configs;
    try {
      configs = parseServerJsonInput(jsonInput.value);
    } catch (err) {
      await mcpAlert(err?.message || 'Invalid JSON');
      return false;
    }
    if (!configs.length) {
      await mcpAlert('No MCP server config found in JSON');
      return false;
    }
    if (configs.length > 1) {
      await mcpAlert('JSON contains multiple servers. Switch to JSON mode to save them.');
      return false;
    }
    const envOk = (configs[0].type !== 'stdio') || (configs[0].env && typeof configs[0].env === 'object');
    if (!envOk) {
      await mcpAlert('Invalid JSON in environment variables');
      return false;
    }
    applyServerConfigToForm(configs[0]);
    return true;
  }

  async function setEditorMode(mode, { syncJson = false, syncForm = false } = {}) {
    const next = (mode === 'json') ? 'json' : 'form';
    if (editorMode === next && !syncJson && !syncForm) return;

    if (next === 'form' && syncForm) {
      const ok = await syncFormFromJson();
      if (!ok) return;
    }

    editorMode = next;
    const { modeBtns, formFields, jsonFields } = getEditorModeEls();
    modeBtns.forEach(btn => {
      const isActive = btn.getAttribute('data-mcp-editor-mode') === next;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (formFields) formFields.style.display = next === 'form' ? 'block' : 'none';
    if (jsonFields) jsonFields.style.display = next === 'json' ? 'block' : 'none';

    if (next === 'json' && syncJson) {
      syncJsonFromForm();
    }
  }

  function getHeadersEditorEls() {
    return {
      host: document.getElementById('mcpServerHeadersEditor'),
      addBtn: document.getElementById('mcpHeadersAddBtn')
    };
  }

  function addHeaderRow({ key = '', value = '' } = {}) {
    const { host } = getHeadersEditorEls();
    if (!host) return;

    const row = document.createElement('div');
    row.className = 'mcp-headers-row';
    row.innerHTML = `
      <input class="form-input mcp-headers-key" type="text" placeholder="Header name" data-mcp-header-key="1" />
      <input class="form-input mcp-headers-value" type="text" placeholder="Header value" data-mcp-header-value="1" />
      <button class="icon-button mcp-headers-remove" type="button" title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `.trim();

    const keyEl = row.querySelector('[data-mcp-header-key="1"]');
    const valEl = row.querySelector('[data-mcp-header-value="1"]');
    if (keyEl) keyEl.value = String(key || '');
    if (valEl) valEl.value = String(value || '');

    const rm = row.querySelector('.mcp-headers-remove');
    if (rm) rm.addEventListener('click', () => { try { row.remove(); } catch { /* ignore */ } });

    host.appendChild(row);
  }

  function setHeadersEditorFromObject(obj) {
    const { host } = getHeadersEditorEls();
    if (!host) return;
    host.innerHTML = '';

    const headers = (obj && typeof obj === 'object') ? obj : {};
    const entries = Object.entries(headers);
    if (!entries.length) {
      // show one empty row for convenience
      addHeaderRow({ key: '', value: '' });
      return;
    }
    for (const [k, v] of entries) {
      addHeaderRow({ key: String(k || ''), value: (v == null ? '' : String(v)) });
    }
  }

  function getHeadersObjectFromEditor() {
    const { host } = getHeadersEditorEls();
    if (!host) return {};
    const rows = Array.from(host.querySelectorAll('.mcp-headers-row'));
    const out = {};
    for (const row of rows) {
      const k = String(row.querySelector('[data-mcp-header-key="1"]')?.value || '').trim();
      const v = String(row.querySelector('[data-mcp-header-value="1"]')?.value || '');
      if (!k) continue;
      out[k] = v;
    }
    return out;
  }

  // Render MCP manager interface
  function renderMcpManager() {
    const mcpPanel = document.getElementById('mcpManagerPanel');
    if (!mcpPanel) {
      console.warn('[MCP UI] Panel element not found');
      return;
    }

    const servers = window.getMcpServers?.() || [];

    // Render only the main panel content (modals are now top-level in index.html)
    mcpPanel.innerHTML = `
      <div class="mcp-manager-container">
        <div class="mcp-manager-topbar">
          <div class="mcp-manager-titlewrap">
            <div class="mcp-manager-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 1v6m0 6v6"></path>
                <path d="M1 12h6m6 0h6"></path>
              </svg>
              <span>Model Context Protocol</span>
              <span class="mcp-manager-title-pill">MCP</span>
            </div>
            <div class="mcp-manager-subtitle">Connect external tools and services to your assistant</div>
          </div>

          <div class="mcp-manager-actions">
            <button class="btn-secondary" id="mcpImportPresetBtn" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              Import preset
            </button>
            <button class="btn-primary" id="mcpAddServerBtn" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Add server
            </button>
          </div>
        </div>

        <div class="mcp-servers-list" id="mcpServersList">
          ${servers.length === 0 ? renderEmptyState() : servers.map(renderServerCard).join('')}
        </div>
      </div>
    `;

    // Populate the preset modal (it's now a separate top-level element)
    renderPresetsModal();

    // Bind events
    bindMcpManagerEvents();
  }

  // Render presets into the preset modal
  function renderPresetsModal() {
    const presetsGrid = document.getElementById('mcpPresetsGrid');
    if (presetsGrid) {
      presetsGrid.innerHTML = renderPresets();
    }
  }

  function renderEmptyState() {
    return `
      <div class="mcp-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 64px; height: 64px; opacity: 0.3;">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M12 1v6m0 6v6"></path>
          <path d="M1 12h6m6 0h6"></path>
        </svg>
        <h3>No MCP Servers</h3>
        <p>Add MCP servers to extend Claude's capabilities with external tools and data sources.</p>
        <div class="mcp-empty-actions">
          <button class="btn-primary" id="mcpEmptyAddBtn" type="button">Add server</button>
          <button class="btn-secondary" id="mcpEmptyImportBtn" type="button">Import preset</button>
        </div>
      </div>
    `;
  }

  function renderServerCard(server) {
    const status = window.getMcpServerStatus?.(server.id) || { status: 'disconnected' };
    const statusClass = status.status === 'connected' ? 'success' : 
                       status.status === 'connecting' ? 'warning' :
                       status.status === 'error' ? 'error' : 'default';
    const statusText = status.status === 'connected' ? 'Connected' :
                      status.status === 'connecting' ? 'Connecting...' :
                      status.status === 'error' ? 'Error' : 'Disconnected';

    return `
      <div class="mcp-server-card" data-server-id="${escapeHtml(server.id)}">
        <div class="mcp-server-header">
          <div class="mcp-server-info">
            <h3 class="mcp-server-name">${escapeHtml(server.name)}</h3>
            <span class="mcp-server-badge badge-${statusClass}">${statusText}</span>
          </div>
          <div class="mcp-server-actions">
            ${status.status === 'connected' ? 
              `<button class="btn-secondary btn-sm mcp-disconnect-btn" data-server-id="${escapeHtml(server.id)}" title="Disconnect">
                Disconnect
              </button>` :
              `<button class="btn-primary btn-sm mcp-connect-btn" data-server-id="${escapeHtml(server.id)}" title="Connect">
                Connect
              </button>`
            }
            <button class="icon-button mcp-edit-btn" data-server-id="${escapeHtml(server.id)}" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="icon-button mcp-delete-btn" data-server-id="${escapeHtml(server.id)}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
        ${server.description ? `<p class="mcp-server-description">${escapeHtml(server.description)}</p>` : ''}
        <div class="mcp-server-meta">
          <span class="mcp-server-meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            ${escapeHtml(server.type || 'stdio')}
          </span>
          ${server.command ? `
            <span class="mcp-server-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
              ${escapeHtml(server.command)}
            </span>
          ` : ''}
        </div>
        ${status.status === 'error' && status.error ? `
          <div class="mcp-server-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            ${escapeHtml(status.error)}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderPresets() {
    const presets = [
      {
        name: 'GitHub',
        description: 'Access GitHub repositories, issues, and pull requests',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
        icon: 'github'
      },
      {
        name: 'Supabase',
        description: 'Query and manage Supabase databases and storage',
        type: 'sse',
        url: 'https://mcp.supabase.com/mcp',
        icon: 'database'
      },
      {
        name: 'PostgreSQL',
        description: 'Query and manage PostgreSQL databases',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres'],
        env: { POSTGRES_CONNECTION_STRING: '' },
        icon: 'database'
      },
      {
        name: 'Slack',
        description: 'Send messages and manage Slack workspaces',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-slack'],
        env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
        icon: 'slack'
      },
      {
        name: 'Google Drive',
        description: 'Access and manage Google Drive files',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-gdrive'],
        env: { GDRIVE_CLIENT_ID: '', GDRIVE_CLIENT_SECRET: '' },
        icon: 'cloud'
      },
      {
        name: 'Brave Search',
        description: 'Search the web using Brave Search API',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: { BRAVE_API_KEY: '' },
        icon: 'search'
      },
      {
        name: 'File System',
        description: 'Read and write files on your local system',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: {},
        icon: 'folder'
      },
      {
        name: 'Puppeteer',
        description: 'Browser automation and web scraping',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-puppeteer'],
        env: {},
        icon: 'browser'
      },
      {
        name: 'Sequential Thinking',
        description: 'Extended chain-of-thought reasoning',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
        env: {},
        icon: 'brain'
      }
    ];

    return presets.map(preset => `
      <div class="mcp-preset-card" data-preset-name="${escapeHtml(preset.name)}">
        <div class="mcp-preset-icon" aria-hidden="true">
          ${getPresetIcon(preset.icon)}
        </div>
        <div class="mcp-preset-main">
          <div class="mcp-preset-name">${escapeHtml(preset.name)}</div>
          <div class="mcp-preset-description">${escapeHtml(preset.description)}</div>
        </div>
        <div class="mcp-preset-actions">
          <button class="btn-primary btn-sm mcp-import-preset-btn"
            type="button"
            data-preset='${JSON.stringify(preset).replace(/'/g, '&apos;')}'>
            Import
          </button>
        </div>
      </div>
    `).join('');
  }

  function getPresetIcon(icon) {
    const icons = {
      github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>',
      database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>',
      slack: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 15a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2h2v2zm1 0a2 2 0 0 1 2-2a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2a2 2 0 0 1-2-2v-5zm2-8a2 2 0 0 1-2-2a2 2 0 0 1 2-2a2 2 0 0 1 2 2v2H9zm0 1a2 2 0 0 1 2 2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2a2 2 0 0 1 2-2h5zm8 2a2 2 0 0 1 2-2a2 2 0 0 1 2 2a2 2 0 0 1-2 2h-2v-2zm-1 0a2 2 0 0 1-2 2a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2a2 2 0 0 1 2 2v5zm-2 8a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2v-2h2zm0-1a2 2 0 0 1-2-2a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2a2 2 0 0 1-2 2h-5z"/></svg>',
      cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>',
      folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
      search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>',
      browser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"></rect><path d="M2 9h20"></path></svg>',
      brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path></svg>'
    };
    return icons[icon] || icons.folder;
  }

  function bindMcpManagerEvents() {
    // Add server button
    const addBtn = document.getElementById('mcpAddServerBtn');
    if (addBtn) {
      addBtn.onclick = () => openServerEditor();
    }

    // Import preset button
    const importBtn = document.getElementById('mcpImportPresetBtn');
    if (importBtn) {
      importBtn.onclick = () => openPresetModal();
    }

    // Empty state actions
    const emptyAddBtn = document.getElementById('mcpEmptyAddBtn');
    if (emptyAddBtn) {
      emptyAddBtn.onclick = () => openServerEditor();
    }
    const emptyImportBtn = document.getElementById('mcpEmptyImportBtn');
    if (emptyImportBtn) {
      emptyImportBtn.onclick = () => openPresetModal();
    }

    // Server actions (delegated events)
    const serversList = document.getElementById('mcpServersList');
    if (serversList) {
      serversList.onclick = async (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        const serverId = target.getAttribute('data-server-id');
        if (!serverId) return;

        if (target.classList.contains('mcp-connect-btn')) {
          await handleConnect(serverId);
        } else if (target.classList.contains('mcp-disconnect-btn')) {
          await handleDisconnect(serverId);
        } else if (target.classList.contains('mcp-edit-btn')) {
          openServerEditor(serverId);
        } else if (target.classList.contains('mcp-delete-btn')) {
          await handleDelete(serverId);
        }
      };
    }

    // Editor modal events
    bindEditorModalEvents();
    bindPresetModalEvents();
  }

  function bindEditorModalEvents() {
    const modal = document.getElementById('mcpEditorModal');
    if (!modal) return;

    // Close button
    const closeBtn = document.getElementById('mcpEditorCloseBtn');
    if (closeBtn) {
      closeBtn.onclick = () => closeServerEditor();
    }

    // Cancel button
    const cancelBtn = document.getElementById('mcpEditorCancelBtn');
    if (cancelBtn) {
      cancelBtn.onclick = () => closeServerEditor();
    }

    // Save button
    const saveBtn = document.getElementById('mcpEditorSaveBtn');
    if (saveBtn) {
      saveBtn.onclick = () => handleSaveServer();
    }

    // Server type change
    const typeSelect = document.getElementById('mcpServerType');
    if (typeSelect) {
      typeSelect.onchange = () => {
        const isStdio = typeSelect.value === 'stdio';
        const stdioFields = document.getElementById('mcpStdioFields');
        const sseFields = document.getElementById('mcpSseFields');
        if (stdioFields) stdioFields.style.display = isStdio ? 'block' : 'none';
        if (sseFields) sseFields.style.display = isStdio ? 'none' : 'block';
      };
    }

    // Headers add button
    const { addBtn } = getHeadersEditorEls();
    if (addBtn && !addBtn.__codeonBound) {
      addBtn.__codeonBound = true;
      addBtn.addEventListener('click', () => addHeaderRow({ key: '', value: '' }));
    }

    // Mode toggle
    const { modeBtns } = getEditorModeEls();
    modeBtns.forEach((btn) => {
      if (btn.__codeonBound) return;
      btn.__codeonBound = true;
      btn.addEventListener('click', async () => {
        const mode = btn.getAttribute('data-mcp-editor-mode');
        await setEditorMode(mode, {
          syncJson: mode === 'json',
          syncForm: mode === 'form'
        });
      });
    });
  }

  function bindPresetModalEvents() {
    // Close button
    const closeBtn = document.getElementById('mcpPresetCloseBtn');
    if (closeBtn) {
      closeBtn.onclick = () => closePresetModal();
    }

    // Import preset buttons (delegated)
    const presetsGrid = document.getElementById('mcpPresetsGrid');
    if (presetsGrid) {
      presetsGrid.onclick = (e) => {
        const btn = e.target.closest('.mcp-import-preset-btn');
        if (!btn) return;
        
        try {
          const preset = JSON.parse(btn.getAttribute('data-preset'));
          importPreset(preset);
        } catch (err) {
          console.error('[MCP UI] Failed to parse preset:', err);
        }
      };
    }
  }

  function openServerEditor(serverId = null) {
    currentEditingServerId = serverId;
    const modal = document.getElementById('mcpEditorModal');
    const title = document.getElementById('mcpEditorTitle');
    
    if (!modal) return;

    // Set title
    if (title) {
      title.textContent = serverId ? 'Edit MCP Server' : 'Add MCP Server';
    }

    // Load server data if editing
    if (serverId) {
      const server = window.getMcpServer?.(serverId);
      if (server) {
        applyServerConfigToForm(server);
      }
    } else {
      // Reset form
      document.getElementById('mcpServerName').value = '';
      document.getElementById('mcpServerType').value = 'stdio';
      document.getElementById('mcpServerCommand').value = '';
      document.getElementById('mcpServerArgs').value = '';
      document.getElementById('mcpServerEnv').value = '';
      document.getElementById('mcpServerUrl').value = '';
      setHeadersEditorFromObject({});
      document.getElementById('mcpServerDescription').value = '';
      document.getElementById('mcpServerEnabled').checked = true;

      // Trigger type change
      const typeSelect = document.getElementById('mcpServerType');
      if (typeSelect) typeSelect.onchange?.();
    }

    setEditorMode('form', { syncJson: true });
    modal.style.display = 'flex';
  }

  function closeServerEditor() {
    const modal = document.getElementById('mcpEditorModal');
    if (modal) modal.style.display = 'none';
    currentEditingServerId = null;
    editorMode = 'form';
  }

  function openPresetModal() {
    const modal = document.getElementById('mcpPresetModal');
    if (modal) modal.style.display = 'flex';
  }

  function closePresetModal() {
    const modal = document.getElementById('mcpPresetModal');
    if (modal) modal.style.display = 'none';
  }

  async function handleSaveServer() {
    try {
      if (editorMode === 'json') {
        const jsonText = document.getElementById('mcpServerJson').value.trim();
        if (!jsonText) {
          await mcpAlert('Paste a server JSON payload');
          return;
        }

        let configs;
        try {
          configs = parseServerJsonInput(jsonText);
        } catch (err) {
          await mcpAlert(err?.message || 'Invalid JSON');
          return;
        }

        if (!configs.length) {
          await mcpAlert('No MCP server config found in JSON');
          return;
        }

        if (currentEditingServerId && configs.length !== 1) {
          await mcpAlert('Editing requires a single server config.');
          return;
        }

        for (const cfg of configs) {
          if (!cfg.name) {
            await mcpAlert('Server name is required');
            return;
          }
          if (cfg.type === 'stdio' && !cfg.command) {
            await mcpAlert('Command is required for stdio servers');
            return;
          }
          if (cfg.type === 'sse' && !cfg.url) {
            await mcpAlert('Server URL is required for HTTP/SSE servers');
            return;
          }
          if (cfg.type === 'stdio' && cfg.env === null) {
            await mcpAlert('Invalid JSON in environment variables');
            return;
          }
        }

        if (currentEditingServerId && configs.length === 1) {
          configs[0].id = currentEditingServerId;
        }

        for (const cfg of configs) {
          await window.saveMcpServer?.(cfg);
        }

        closeServerEditor();
        renderMcpManager();
        return;
      }

      const nameRaw = document.getElementById('mcpServerName').value.trim();
      const name = normalizeMcpServerKey(nameRaw);
      const type = document.getElementById('mcpServerType').value;
      const command = document.getElementById('mcpServerCommand').value.trim();
      const argsText = document.getElementById('mcpServerArgs').value.trim();
      const envText = document.getElementById('mcpServerEnv').value.trim();
      const url = document.getElementById('mcpServerUrl').value.trim();
      const description = document.getElementById('mcpServerDescription').value.trim();
      const enabled = document.getElementById('mcpServerEnabled').checked;

      if (!name) {
        await mcpAlert('Server name is required');
        return;
      }
      // Ensure the field reflects the actual key Claude Code will use.
      if (nameRaw !== name) {
        try { document.getElementById('mcpServerName').value = name; } catch { /* ignore */ }
      }

      if (type === 'stdio' && !command) {
        await mcpAlert('Command is required for stdio servers');
        return;
      }

      if (type === 'sse' && !url) {
        await mcpAlert('Server URL is required for HTTP/SSE servers');
        return;
      }

      // Parse args
      const args = argsText ? argsText.split('\n').map(a => a.trim()).filter(Boolean) : [];

      // Parse env
      let env = {};
      if (envText) {
        try {
          env = JSON.parse(envText);
        } catch (err) {
          await mcpAlert('Invalid JSON in environment variables');
          return;
        }
      }

      const headers = (type === 'sse') ? getHeadersObjectFromEditor() : {};

      const serverConfig = {
        name,
        type,
        command: type === 'stdio' ? command : undefined,
        args: type === 'stdio' ? args : undefined,
        env: type === 'stdio' ? env : undefined,
        url: type === 'sse' ? url : undefined,
        headers: type === 'sse' ? headers : undefined,
        description,
        enabled
      };

      // If editing, preserve the ID
      if (currentEditingServerId) {
        serverConfig.id = currentEditingServerId;
      }

      await window.saveMcpServer?.(serverConfig);
      closeServerEditor();
      renderMcpManager(); // Refresh list
      
      console.log('[MCP UI] Server saved:', name);
    } catch (err) {
      console.error('[MCP UI] Failed to save server:', err);
      await mcpAlert('Failed to save server: ' + (err?.message || String(err)));
    }
  }

  async function handleConnect(serverId) {
    try {
      console.log('[MCP UI] Connecting to server:', serverId);
      
      // Update UI to show connecting state
      renderMcpManager();

      const result = await window.connectMcpServer?.(serverId);
      
      if (result?.success) {
        console.log('[MCP UI] Connected successfully');
      } else {
        await mcpAlert('Failed to connect: ' + (result?.error || 'Unknown error'));
      }

      // Refresh UI
      renderMcpManager();
    } catch (err) {
      console.error('[MCP UI] Connection error:', err);
      await mcpAlert('Failed to connect: ' + (err?.message || String(err)));
      renderMcpManager();
    }
  }

  async function handleDisconnect(serverId) {
    try {
      console.log('[MCP UI] Disconnecting from server:', serverId);
      
      const result = await window.disconnectMcpServer?.(serverId);
      
      if (result?.success) {
        console.log('[MCP UI] Disconnected successfully');
      } else {
        await mcpAlert('Failed to disconnect: ' + (result?.error || 'Unknown error'));
      }

      // Refresh UI
      renderMcpManager();
    } catch (err) {
      console.error('[MCP UI] Disconnect error:', err);
      await mcpAlert('Failed to disconnect: ' + (err?.message || String(err)));
      renderMcpManager();
    }
  }

  async function handleDelete(serverId) {
    try {
      const server = window.getMcpServer?.(serverId);
      if (!server) return;

      const ok = await mcpConfirm(`Delete MCP server "${server.name}"?\n\nThis cannot be undone.`, 'Delete server', { confirmText: 'Delete', cancelText: 'Cancel' });
      if (!ok) {
        return;
      }

      await window.deleteMcpServer?.(serverId);
      renderMcpManager(); // Refresh list
      
      console.log('[MCP UI] Server deleted:', server.name);
    } catch (err) {
      console.error('[MCP UI] Failed to delete server:', err);
      await mcpAlert('Failed to delete server: ' + (err?.message || String(err)));
    }
  }

  function importPreset(preset) {
    closePresetModal();
    openServerEditor();

    const normalized = normalizeServerConfig(preset, preset?.name || '');
    applyServerConfigToForm({
      ...normalized,
      description: String(preset?.description || '')
    });
    setEditorMode('form', { syncJson: true });
  }

  function showMcpManager() {
    const panel = document.getElementById('mcpManagerPanel');
    if (panel) {
      panel.style.display = 'flex';
    }

    // Hide editor and diff editor when MCP is shown
    const editor = document.getElementById('editor');
    const diffEditor = document.getElementById('diffEditor');
    const emptyState = document.getElementById('editorEmptyState');
    try {
      if (_prevEditorVis == null) {
        // Capture current state so we can restore correctly (diff view vs normal editor vs empty state).
        _prevEditorVis = {
          editorDisplay: editor ? editor.style.display : null,
          diffDisplay: diffEditor ? diffEditor.style.display : null,
          emptyDisplay: emptyState ? emptyState.style.display : null,
          // Also track computed visibility in case inline style is empty.
          editorWasVisible: editor ? (getComputedStyle(editor).display !== 'none') : false,
          diffWasVisible: diffEditor ? (getComputedStyle(diffEditor).display !== 'none') : false,
          emptyWasVisible: emptyState ? (getComputedStyle(emptyState).display !== 'none') : false
        };
      }
    } catch { /* ignore */ }
    if (editor) editor.style.display = 'none';
    if (diffEditor) diffEditor.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
  }

  function hideMcpManager() {
    const panel = document.getElementById('mcpManagerPanel');
    if (panel) {
      panel.style.display = 'none';
    }

    // Restore whichever view was active before MCP (editor vs diff vs empty state).
    const editor = document.getElementById('editor');
    const diffEditor = document.getElementById('diffEditor');
    const emptyState = document.getElementById('editorEmptyState');
    const prev = _prevEditorVis;
    _prevEditorVis = null;
    try {
      if (prev && typeof prev === 'object') {
        if (editor) editor.style.display = (prev.editorDisplay != null && prev.editorDisplay !== '') ? prev.editorDisplay : (prev.editorWasVisible ? 'block' : 'none');
        if (diffEditor) diffEditor.style.display = (prev.diffDisplay != null && prev.diffDisplay !== '') ? prev.diffDisplay : (prev.diffWasVisible ? 'block' : 'none');
        if (emptyState) emptyState.style.display = (prev.emptyDisplay != null && prev.emptyDisplay !== '') ? prev.emptyDisplay : (prev.emptyWasVisible ? 'flex' : 'none');
      } else {
        // Sensible default if we don't know: show normal editor.
        if (editor) editor.style.display = 'block';
        if (diffEditor) diffEditor.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
      }
    } catch { /* ignore */ }

    // Force Monaco to re-layout after being unhidden (common cause of a blank editor surface).
    try {
      requestAnimationFrame(() => {
        try { window.editor?.layout?.(); } catch { /* ignore */ }
        try { window.diffEditor?.layout?.(); } catch { /* ignore */ }
      });
    } catch { /* ignore */ }

    // Close any open modals
    closeServerEditor();
    closePresetModal();
  }

  // Export to window
  window.renderMcpManager = renderMcpManager;
  window.showMcpManager = showMcpManager;
  window.hideMcpManager = hideMcpManager;

  console.log('[MCP UI] Manager UI initialized');
})();

