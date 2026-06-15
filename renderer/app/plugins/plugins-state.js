// Claude Code Plugins: project (.claude/plugins) + user (~/.claude/plugins)
// This file is intentionally small and stateful (plain <script> environment, no bundler).

let availablePlugins = []; // [{ id, scope, dirName, name, description, version, pluginRootPath, manifestPath, enabled }]

// Local helper (duplicated from console-state because load order)
function _flattenPluginFileTree(entries) {
  const out = [];
  const stack = Array.isArray(entries) ? entries.slice() : [];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    out.push(n);
    if (Array.isArray(n.children)) {
      for (const c of n.children) stack.push(c);
    }
  }
  return out;
}

function _normalizePluginPathForCompare(p) {
  const s = String(p || '').trim().replace(/\\/g, '/');
  if (!s) return '';
  return s.replace(/^\.\//, '').replace(/\/+$/, '');
}

function _getPluginsArrayFromSettings(settingsObj) {
  const obj = settingsObj && typeof settingsObj === 'object' ? settingsObj : null;
  const arr = obj && Array.isArray(obj.plugins) ? obj.plugins : [];
  return arr.filter(x => x && typeof x === 'object' && String(x.type || '') === 'local' && typeof x.path === 'string');
}

function _settingsHasPluginPath(settingsObj, desiredPath) {
  const want = _normalizePluginPathForCompare(desiredPath);
  if (!want) return false;
  const arr = _getPluginsArrayFromSettings(settingsObj);
  for (const p of arr) {
    const got = _normalizePluginPathForCompare(p.path);
    if (!got) continue;
    if (got === want) return true;
  }
  return false;
}

function _ensurePluginInSettingsObj(settingsObj, pluginPath) {
  const base = (settingsObj && typeof settingsObj === 'object') ? settingsObj : {};
  const obj = { ...base };
  const plugins = _getPluginsArrayFromSettings(obj);
  const want = _normalizePluginPathForCompare(pluginPath);
  if (!want) return obj;
  if (_settingsHasPluginPath(obj, want)) return obj;
  obj.plugins = [...plugins, { type: 'local', path: pluginPath }];
  return obj;
}

function _removePluginFromSettingsObj(settingsObj, pluginPath) {
  const base = (settingsObj && typeof settingsObj === 'object') ? settingsObj : {};
  const obj = { ...base };
  const want = _normalizePluginPathForCompare(pluginPath);
  const existing = Array.isArray(obj.plugins) ? obj.plugins : [];
  obj.plugins = existing.filter((x) => {
    if (!x || typeof x !== 'object') return true;
    if (String(x.type || '') !== 'local') return true;
    const got = _normalizePluginPathForCompare(x.path);
    return got !== want;
  });
  return obj;
}

async function readProjectClaudeSettingsJson() {
  if (!window.electronAPI || typeof window.electronAPI.readFile !== 'function') return { exists: false, obj: null };
  try {
    const rr = await window.electronAPI.readFile('.claude/settings.json');
    if (!rr || rr.success !== true || typeof rr.content !== 'string') return { exists: false, obj: null };
    try {
      return { exists: true, obj: JSON.parse(rr.content) };
    } catch {
      return { exists: true, obj: null };
    }
  } catch {
    return { exists: false, obj: null };
  }
}

async function writeProjectClaudeSettingsJson(obj) {
  if (!window.electronAPI || typeof window.electronAPI.createDirectory !== 'function' || typeof window.electronAPI.writeFile !== 'function') {
    throw new Error('Project file APIs are not available.');
  }
  await window.electronAPI.createDirectory('.claude');
  const content = JSON.stringify(obj && typeof obj === 'object' ? obj : {}, null, 2) + '\n';
  const wr = await window.electronAPI.writeFile('.claude/settings.json', content, false);
  if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to write .claude/settings.json');
  return { success: true };
}

async function readUserClaudeSettingsJson() {
  if (!window.electronAPI || typeof window.electronAPI.userClaudeReadSettingsJson !== 'function') return { exists: false, obj: null };
  const rr = await window.electronAPI.userClaudeReadSettingsJson();
  if (!rr || rr.success !== true) return { exists: false, obj: null };
  if (rr.parsed && typeof rr.parsed === 'object') return { exists: rr.exists === true, obj: rr.parsed };
  if (typeof rr.content === 'string' && rr.content.trim()) {
    try { return { exists: rr.exists === true, obj: JSON.parse(rr.content) }; } catch { /* ignore */ }
  }
  return { exists: rr.exists === true, obj: null };
}

async function writeUserClaudeSettingsJson(obj) {
  if (!window.electronAPI || typeof window.electronAPI.userClaudeWriteSettingsJson !== 'function') {
    throw new Error('User Claude settings API is not available.');
  }
  const wr = await window.electronAPI.userClaudeWriteSettingsJson({ obj: obj && typeof obj === 'object' ? obj : {} });
  if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to write ~/.claude/settings.json');
  return { success: true };
}

function _parsePluginManifest(parsed, fallbackName) {
  const obj = parsed && typeof parsed === 'object' ? parsed : {};
  const name = String(obj.name || '').trim() || String(fallbackName || '').trim() || 'Plugin';
  const description = String(obj.description || '').trim();
  const version = String(obj.version || '').trim();
  return { name, description, version };
}

async function loadProjectPlugins() {
  const plugins = [];

  // Load project plugins only if a project folder is open
  const hasProjectFolder = currentFolder && window.electronAPI && typeof window.electronAPI.listDir === 'function' && typeof window.electronAPI.readFile === 'function';
  
  if (hasProjectFolder) {
    // Determine enablement based on project .claude/settings.json (if present)
    let projectSettingsObj = null;
    try { projectSettingsObj = (await readProjectClaudeSettingsJson()).obj; } catch { projectSettingsObj = null; }

    const res = await window.electronAPI.listDir('.claude/plugins', { maxDepth: 10 });
    if (res && res.success === true && Array.isArray(res.files)) {
      const entries = _flattenPluginFileTree(res.files);
      const manifestFiles = entries
        .filter(e => e && e.type === 'file' && typeof e.path === 'string' && e.path.replace(/\\/g, '/').endsWith('/.claude-plugin/plugin.json'))
        .map(e => String(e.path || ''));

      for (const relUnderPlugins of manifestFiles.slice(0, 120)) {
        try {
          const manifestPath = `.claude/plugins/${relUnderPlugins.replace(/^\.?\//, '')}`;
          const rr = await window.electronAPI.readFile(manifestPath);
          if (!rr || rr.success !== true || typeof rr.content !== 'string') continue;
          let parsed = null;
          try { parsed = JSON.parse(rr.content); } catch { parsed = null; }
          const dirName = relUnderPlugins.split('/')[0] || '';
          const pluginRootPath = `.claude/plugins/${dirName}`;
          const meta = _parsePluginManifest(parsed, dirName);
          const enabled = _settingsHasPluginPath(projectSettingsObj, pluginRootPath) || _settingsHasPluginPath(projectSettingsObj, `./${pluginRootPath}`);
          plugins.push({
            id: `project:${pluginRootPath}`,
            scope: 'project',
            dirName,
            name: meta.name,
            description: meta.description,
            version: meta.version,
            pluginRootPath,
            manifestPath,
            enabled
          });
        } catch {
          // ignore
        }
      }
    }
  }

  // ALWAYS load user plugins (they exist in ~/.claude/plugins regardless of project)
  let userPlugins = [];
  try {
    userPlugins = await loadUserPlugins();
  } catch {
    userPlugins = [];
  }
  
  availablePlugins = [...plugins, ...(Array.isArray(userPlugins) ? userPlugins : [])];
  return availablePlugins;
}

async function loadUserPlugins() {
  const plugins = [];
  if (!window.electronAPI) return plugins;
  if (typeof window.electronAPI.userClaudeListPlugins !== 'function') return plugins;
  if (typeof window.electronAPI.userClaudeReadPluginManifest !== 'function') return plugins;

  let userSettingsObj = null;
  try { userSettingsObj = (await readUserClaudeSettingsJson()).obj; } catch { userSettingsObj = null; }

  const res = await window.electronAPI.userClaudeListPlugins();
  if (!res || res.success !== true || !Array.isArray(res.files)) return plugins;
  const entries = _flattenPluginFileTree(res.files);
  const manifestFiles = entries
    .filter(e => e && e.type === 'file' && typeof e.path === 'string' && e.path.replace(/\\/g, '/').endsWith('/.claude-plugin/plugin.json'))
    .map(e => String(e.path || ''));

  for (const relUnderPlugins of manifestFiles.slice(0, 200)) {
    try {
      const rr = await window.electronAPI.userClaudeReadPluginManifest({ rel: relUnderPlugins });
      if (!rr || rr.success !== true) continue;
      const parsed = rr.parsed && typeof rr.parsed === 'object' ? rr.parsed : null;
      const dirName = relUnderPlugins.split('/')[0] || '';
      const manifestAbs = typeof rr.path === 'string' ? rr.path : '';
      // pluginRootAbs = <destAbs> (parent of ".claude-plugin")
      const pluginRootAbs = manifestAbs ? manifestAbs.replace(/\\/g, '/').replace(/\/\.claude-plugin\/plugin\.json$/, '') : '';
      const meta = _parsePluginManifest(parsed, dirName);
      const enabled = _settingsHasPluginPath(userSettingsObj, pluginRootAbs);
      plugins.push({
        id: `user:${dirName}`,
        scope: 'user',
        dirName,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        pluginRootPath: pluginRootAbs || `~/.claude/plugins/${dirName}`,
        manifestPath: manifestAbs || `~/.claude/plugins/${dirName}/.claude-plugin/plugin.json`,
        userRelDir: dirName,
        enabled
      });
    } catch {
      // ignore
    }
  }

  plugins.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return plugins;
}

function getProjectPluginsForLibrary() {
  return (Array.isArray(availablePlugins) ? availablePlugins : []).filter(p => p && p.scope === 'project');
}

function getUserPluginsForLibrary() {
  return (Array.isArray(availablePlugins) ? availablePlugins : []).filter(p => p && p.scope === 'user');
}

async function enableProjectPlugin(pluginRootPath) {
  const { obj } = await readProjectClaudeSettingsJson();
  const next = _ensurePluginInSettingsObj(obj || {}, pluginRootPath);
  await writeProjectClaudeSettingsJson(next);
}

async function disableProjectPlugin(pluginRootPath) {
  const { obj } = await readProjectClaudeSettingsJson();
  const next = _removePluginFromSettingsObj(obj || {}, pluginRootPath);
  await writeProjectClaudeSettingsJson(next);
}

async function enableUserPlugin(pluginRootAbsPath) {
  const { obj } = await readUserClaudeSettingsJson();
  const next = _ensurePluginInSettingsObj(obj || {}, pluginRootAbsPath);
  await writeUserClaudeSettingsJson(next);
}

async function disableUserPlugin(pluginRootAbsPath) {
  const { obj } = await readUserClaudeSettingsJson();
  const next = _removePluginFromSettingsObj(obj || {}, pluginRootAbsPath);
  await writeUserClaudeSettingsJson(next);
}

