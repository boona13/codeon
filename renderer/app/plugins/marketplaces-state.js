// Codeon-managed Claude Code plugin marketplaces.
// This is NOT Claude Code's internal marketplace registry; it's a simple source list used to populate a plugin browser UI.

let marketplaceSources = []; // [{ id, source: {source:'github'|'git', repo|url, ref?, path? }, addedAt }]
let marketplaceCache = {};   // { [id]: { loadedAt, marketplace } }
let activeMarketplaceId = '';

function _mkMarketplaceId(src) {
  const s = src && typeof src === 'object' ? src : null;
  if (!s) return '';
  const kind = String(s.source || '').trim();
  if (kind === 'github') {
    const repo = String(s.repo || '').trim();
    return repo ? `github:${repo}` : '';
  }
  if (kind === 'git') {
    const url = String(s.url || '').trim();
    return url ? `git:${url}` : '';
  }
  return '';
}

function _defaultOfficialMarketplaceSource() {
  // Claude Code CLI suggests: /plugin marketplace add anthropics/claude-code
  return { source: 'github', repo: 'anthropics/claude-code', path: '.claude-plugin/marketplace.json' };
}

async function loadMarketplaceSources() {
  marketplaceSources = [];
  if (!window.electronAPI || typeof window.electronAPI.userClaudeMarketplacesGet !== 'function') return marketplaceSources;
  const rr = await window.electronAPI.userClaudeMarketplacesGet();
  if (!rr || rr.success !== true) return marketplaceSources;
  const obj = rr.parsed && typeof rr.parsed === 'object' ? rr.parsed : null;
  const arr = obj && Array.isArray(obj.sources) ? obj.sources : [];
  marketplaceSources = arr
    .map((x) => {
      const src = x && typeof x.source === 'object' ? x.source : null;
      const id = _mkMarketplaceId(src);
      if (!id) return null;
      return {
        id,
        source: src,
        addedAt: typeof x.addedAt === 'string' ? x.addedAt : ''
      };
    })
    .filter(Boolean);

  if (activeMarketplaceId && !marketplaceSources.some(m => m.id === activeMarketplaceId)) {
    activeMarketplaceId = marketplaceSources[0]?.id || '';
  } else if (!activeMarketplaceId) {
    activeMarketplaceId = marketplaceSources[0]?.id || '';
  }

  return marketplaceSources;
}

async function saveMarketplaceSources() {
  if (!window.electronAPI || typeof window.electronAPI.userClaudeMarketplacesSet !== 'function') return;
  const payload = { sources: marketplaceSources.map(m => ({ source: m.source, addedAt: m.addedAt || new Date().toISOString() })) };
  const wr = await window.electronAPI.userClaudeMarketplacesSet({ obj: payload });
  if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to save marketplaces.');
}

async function ensureOfficialMarketplaceAdded() {
  await loadMarketplaceSources();
  const src = _defaultOfficialMarketplaceSource();
  const id = _mkMarketplaceId(src);
  if (!id) return { added: false };
  if (marketplaceSources.some(m => m.id === id)) return { added: false };
  marketplaceSources = [
    { id, source: src, addedAt: new Date().toISOString() },
    ...marketplaceSources
  ];
  activeMarketplaceId = id;
  await saveMarketplaceSources();
  return { added: true, id };
}

async function addMarketplaceFromInput(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Marketplace source is required.');

  // Accept:
  // - owner/repo  -> github
  // - https://...git -> git
  let src = null;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) {
    src = { source: 'github', repo: raw, path: '.claude-plugin/marketplace.json' };
  } else if (/^https?:\/\/.+\.git$/i.test(raw)) {
    src = { source: 'git', url: raw, path: '.claude-plugin/marketplace.json' };
  } else {
    throw new Error('Invalid marketplace source. Use owner/repo or a .git URL.');
  }

  const id = _mkMarketplaceId(src);
  if (!id) throw new Error('Invalid marketplace source.');
  await loadMarketplaceSources();
  if (marketplaceSources.some(m => m.id === id)) {
    activeMarketplaceId = id;
    return { added: false, id };
  }
  marketplaceSources = [...marketplaceSources, { id, source: src, addedAt: new Date().toISOString() }];
  activeMarketplaceId = id;
  await saveMarketplaceSources();
  return { added: true, id };
}

function setActiveMarketplace(id) {
  const mid = String(id || '').trim();
  if (!mid) return;
  activeMarketplaceId = mid;
}

function getActiveMarketplace() {
  return marketplaceSources.find(m => m && m.id === activeMarketplaceId) || null;
}

async function syncActiveMarketplace() {
  const m = getActiveMarketplace();
  if (!m) throw new Error('No marketplace selected.');
  if (!window.electronAPI || typeof window.electronAPI.userClaudeMarketplaceSync !== 'function') {
    throw new Error('Marketplace sync API is not available.');
  }
  const rr = await window.electronAPI.userClaudeMarketplaceSync({ source: m.source });
  if (!rr || rr.success !== true) throw new Error(rr?.error || 'Failed to sync marketplace.');
  const marketplace = rr.parsed && typeof rr.parsed === 'object' ? rr.parsed : null;
  marketplaceCache[m.id] = { loadedAt: new Date().toISOString(), marketplace, meta: rr };
  return marketplaceCache[m.id];
}

function getCachedMarketplace(id = activeMarketplaceId) {
  const mid = String(id || '').trim();
  return marketplaceCache[mid] || null;
}

function getMarketplacePluginEntries(marketplaceObj) {
  const m = marketplaceObj && typeof marketplaceObj === 'object' ? marketplaceObj : null;
  const plugins = m && Array.isArray(m.plugins) ? m.plugins : [];
  return plugins.filter(Boolean);
}

async function removeMarketplaceById(id) {
  const mid = String(id || '').trim();
  if (!mid) return { removed: false };
  // Don't allow removing the official marketplace (keep UX sane).
  if (mid === 'github:anthropics/claude-code') return { removed: false };
  await loadMarketplaceSources();
  const before = marketplaceSources.length;
  marketplaceSources = marketplaceSources.filter(m => m && m.id !== mid);
  if (marketplaceSources.length === before) return { removed: false };
  if (activeMarketplaceId === mid) activeMarketplaceId = marketplaceSources[0]?.id || '';
  await saveMarketplaceSources();
  try { delete marketplaceCache[mid]; } catch { /* ignore */ }
  return { removed: true };
}

