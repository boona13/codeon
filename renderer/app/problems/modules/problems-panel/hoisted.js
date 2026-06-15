// ---- GENERATED: hoisted declarations extracted from app/problems/problems-panel.js ----


function scheduleRenderProblemsView() {
  try {
    if (!settings?.enableProblemsPanel) return;
    if (__problemsRenderTimer) clearTimeout(__problemsRenderTimer);
    __problemsRenderTimer = setTimeout(() => {
      __problemsRenderTimer = null;
      try { renderProblemsView(); } catch { /* ignore */ }
    }, 50);
  } catch {
    // ignore
  }
}


function setupProblemsOnce() {
  if (__problemsSetupDone) return;
  __problemsSetupDone = true;

  // React to Monaco diagnostics updates
  try {
    if (typeof monaco !== 'undefined' && monaco?.editor?.onDidChangeMarkers) {
      monaco.editor.onDidChangeMarkers(() => scheduleRenderProblemsView());
    }
  } catch {
    // ignore
  }
}

/**
 * Strip comments from JSONC (JSON with Comments) content.
 * Handles // line comments and /* block comments *\/
 * Used for tsconfig.json, jsconfig.json which support comments.
 */
function stripJsonComments(content) {
  if (!content || typeof content !== 'string') return content;
  
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = '';
  
  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];
    
    // Handle string state (don't strip comments inside strings)
    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      result += char;
      i++;
      continue;
    }
    
    if (inString) {
      result += char;
      // Check for escape sequences
      if (char === '\\' && i + 1 < content.length) {
        result += content[i + 1];
        i += 2;
        continue;
      }
      // Check for end of string
      if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
      i++;
      continue;
    }
    
    // Handle // line comments
    if (char === '/' && next === '/') {
      // Skip until end of line
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
      continue;
    }
    
    // Handle /* block comments */
    if (char === '/' && next === '*') {
      i += 2; // Skip /*
      // Skip until */
      while (i < content.length - 1) {
        if (content[i] === '*' && content[i + 1] === '/') {
          i += 2; // Skip */
          break;
        }
        i++;
      }
      continue;
    }
    
    result += char;
    i++;
  }
  
  return result;
}

function scheduleProjectProblemsScan(reason = 'auto') {
  try {
    if (!settings?.enableProblemsPanel) return;
    if (!settings?.enableTsJsLanguageService && !settings?.enableWebLanguageServices) return;
    if (!window.currentFolder) return;
    
    // Skip if an AI run is active (to prevent interference and memory pressure)
    if (window.__codeonActiveCodeStreamingPaths instanceof Set && window.__codeonActiveCodeStreamingPaths.size > 0) {
      return;
    }
    // Also check for active SDK runs using isSessionProcessing
    try {
      if (typeof isSessionProcessing === 'function' && currentSessionId && isSessionProcessing(currentSessionId)) {
        return;
      }
    } catch { /* ignore */ }
    
    // Skip if a scan is already running
    if (__projectScanLock) {
      return;
    }
    
    const now = Date.now();
    
    // POST-RUN PROTECTION: Skip scanning entirely for 3 minutes after an AI run completes
    // This prevents the TypeScript worker from crashing when processing newly created/modified files
    if (__lastAiRunCompletedAt > 0 && (now - __lastAiRunCompletedAt) < __POST_RUN_SCAN_BLACKOUT_MS) {
      return;
    }
    
    // Enforce cooldown between scans to prevent memory pressure
    if (__projectScanLastCompletedAt > 0 && (now - __projectScanLastCompletedAt) < __PROJECT_SCAN_COOLDOWN_MS) {
      return;
    }
    
    if (__projectScanDebounceTimer) clearTimeout(__projectScanDebounceTimer);
    __projectScanDebounceTimer = setTimeout(() => {
      __projectScanDebounceTimer = null;
      runProjectProblemsScan({ reason }).catch(() => {});
    }, 400);
  } catch {
    // ignore
  }
}

// Called when an AI run completes to start the post-run scan blackout period
function markAiRunCompleted() {
  __lastAiRunCompletedAt = Date.now();
}

// Expose globally so it can be called from chat-status-banner
window.markAiRunCompletedForProblems = markAiRunCompleted;


function flattenWorkspaceTreeFiles(nodes, out = []) {
  const list = Array.isArray(nodes) ? nodes : [];
  for (const n of list) {
    if (!n) continue;
    if (n.type === 'file' && typeof n.path === 'string' && n.path.trim()) {
      out.push(String(n.path).replace(/\\/g, '/').replace(/^\/+/, ''));
      continue;
    }
    if (n.type === 'directory' && Array.isArray(n.children)) {
      flattenWorkspaceTreeFiles(n.children, out);
    }
  }
  return out;
}


function looksLikeRelFilePathToken(token) {
  const s = String(token || '').trim();
  if (!s) return false;
  if (s.length > 260) return false;
  if (s.includes('\n') || s.includes('\r') || s.includes('\t')) return false;
  // Avoid treating URLs as file paths.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^mailto:/i.test(s)) return false;
  // Avoid matching code fragments like "const x = y" or "foo(bar)".
  if (/\s/.test(s)) return false;
  if (s.includes('(') || s.includes(')') || s.includes('{') || s.includes('}') || s.includes(';')) return false;
  // Basic file-ish hint
  return s.includes('/') || /\.[a-z0-9]{1,8}$/i.test(s);
}


function cleanFileToken(raw) {
  let s = String(raw || '').trim();
  // Strip common trailing punctuation from markdown prose
  s = s.replace(/[),.:\]]+$/g, '');
  s = s.replace(/^[[(]+/g, '');
  return s.trim();
}


function parseClaudeMissingConversationId(errText) {
  const s = String(errText || '');
  // Claude Code stderr commonly includes:
  // "No conversation found with session ID: <uuid>"
  const m = s.match(/No conversation found with session ID:\s*([0-9a-fA-F-]{12,})/i);
  return m && m[1] ? String(m[1]).trim() : null;
}


function parseClaudeMissingResumeAnchorUuid(errText) {
  const s = String(errText || '');
  // Claude Code stderr can include:
  // "No message found with message.uuid of: <uuid>"
  const m = s.match(/No message found with message\.uuid of:\s*([0-9a-fA-F-]{12,})/i);
  return m && m[1] ? String(m[1]).trim() : null;
}

function parseClaudeInvalidRedactedThinkingBlock(errText) {
  // Anthropic Messages API can reject a resumed conversation if the stored assistant history
  // includes a malformed `redacted_thinking` block. This tends to surface as:
  //   "messages.1.content.1: Invalid data in redacted_thinking block"
  // We treat this as a recoverable "session corruption" and force a fresh session.
  const s = String(errText || '');
  const lower = s.toLowerCase();
  if (!lower) return null;
  if (!lower.includes('redacted_thinking')) return null;
  if (!lower.includes('invalid data')) return null;
  // Return a short tag so callers can branch / display the right UX.
  return 'redacted_thinking';
}


function flattenWorkspaceTreeEntries(nodes, out = []) {
  const list = Array.isArray(nodes) ? nodes : [];
  for (const n of list) {
    if (!n) continue;
    const typ = String(n.type || '').trim();
    const relRaw = (typeof n.path === 'string' ? n.path : '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    const name = (typeof n.name === 'string' ? n.name : '').trim() || basenameFromPath(relRaw);

    if (typ === 'directory') {
      if (relRaw) out.push({ kind: 'directory', relPath: relRaw, name });
      if (Array.isArray(n.children) && n.children.length) {
        flattenWorkspaceTreeEntries(n.children, out);
      }
      continue;
    }

    if (typ === 'file') {
      if (relRaw) out.push({ kind: 'file', relPath: relRaw, name });
      continue;
    }
  }
  return out;
}


function shouldShowInComposerContextPicker(rel) {
  // Reuse the same safety filters as project scanning to avoid huge lists/freezes.
  try { return shouldProjectScanRelPath(rel); } catch { return true; }
}


function getComposerContextPopoverEls() {
  return {
    popover: document.getElementById('composerContextPopover'),
    list: document.getElementById('composerContextList'),
    categories: document.getElementById('composerContextCategories'),
    title: document.getElementById('composerContextTitle'),
    subtitle: document.getElementById('composerContextSubtitle'),
    backBtn: document.getElementById('composerContextBack'),
    btn: document.getElementById('composerAtButton')
  };
}


function ensureComposerContextPopoverInBody() {
  try {
    const pop = document.getElementById('composerContextPopover');
    if (!pop) return;
    if (pop.parentElement !== document.body) {
      document.body.appendChild(pop);
    }
  } catch {
    // ignore
  }
}


function positionComposerContextPopover() {
  const { popover, btn } = getComposerContextPopoverEls();
  if (!popover || !btn) return;
  const r = btn.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  // Measure width/height so we can keep it on-screen (important when the chat panel is narrow on the right).
  const w = Math.max(260, Math.min(420, Math.round(popRect.width || 420)));
  const h = Math.max(120, Math.round(popRect.height || 320));

  const left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - w - 8));

  // Prefer "exactly above the @ button": bottom of popover aligns to (button top - 8px).
  let top = Math.round(r.top - 8 - h);
  const maxHAbove = Math.max(140, Math.floor(r.top - 16));
  const canFitAbove = top >= 8 && maxHAbove >= 140;

  if (!canFitAbove) {
    // Fallback (still visible): place below if above would be fully off-screen.
    top = Math.round(r.bottom + 8);
  }

  // Clamp within viewport.
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));

  // Cap height to available space (above or below).
  const available = canFitAbove ? Math.max(140, Math.floor(r.top - 16)) : Math.max(140, Math.floor(window.innerHeight - top - 16));

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.maxHeight = `${available}px`;
  popover.style.transform = 'none';
}


function scoreComposerContextEntry(entry, queryLower) {
  const p = String(entry?.relPath || '').toLowerCase();
  const n = String(entry?.name || '').toLowerCase();
  if (!queryLower) return 0;
  if (p === queryLower || n === queryLower) return 1000;
  if (p.startsWith(queryLower) || n.startsWith(queryLower)) return 800;
  if (p.includes('/' + queryLower)) return 650;
  if (p.includes(queryLower) || n.includes(queryLower)) return 500;
  return -1;
}


function getComposerContextFilteredEntries(entries, query) {
  const q = String(query || '').trim().toLowerCase();
  const out = [];
  for (const e of (Array.isArray(entries) ? entries : [])) {
    if (!e || !e.relPath) continue;
    if (!shouldShowInComposerContextPicker(e.relPath)) continue;
    const s = scoreComposerContextEntry(e, q);
    if (q && s < 0) continue;
    out.push({ ...e, __score: s });
  }
  out.sort((a, b) => {
    const ds = (b.__score || 0) - (a.__score || 0);
    if (ds !== 0) return ds;
    // Prefer files over folders when scores tie
    if (a.kind !== b.kind) return (a.kind === 'file') ? -1 : 1;
    return String(a.relPath).localeCompare(String(b.relPath));
  });
  return out.slice(0, 500);
}

function getComposerContextAvailableAgents() {
  return Array.isArray(window.availableAgents)
    ? window.availableAgents
    : (typeof availableAgents !== 'undefined' && Array.isArray(availableAgents) ? availableAgents : []);
}

function getComposerContextAvailableSkills() {
  return Array.isArray(window.availableSkills)
    ? window.availableSkills
    : (typeof availableSkills !== 'undefined' && Array.isArray(availableSkills) ? availableSkills : []);
}

function scoreComposerContextLabel(name, desc, queryLower) {
  const n = String(name || '').toLowerCase();
  const d = String(desc || '').toLowerCase();
  if (!queryLower) return 0;
  if (n === queryLower) return 1000;
  if (n.startsWith(queryLower)) return 800;
  if (n.includes(queryLower)) return 600;
  if (d.startsWith(queryLower)) return 450;
  if (d.includes(queryLower)) return 300;
  return -1;
}

function getComposerContextFilteredAgents(agents, query) {
  const q = String(query || '').trim().toLowerCase();
  const out = [];
  for (const a of (Array.isArray(agents) ? agents : [])) {
    if (!a || !a.id) continue;
    const name = String(a.name || 'Agent').trim();
    const desc = String(a.description || '').trim();
    const s = scoreComposerContextLabel(name, desc, q);
    if (q && s < 0) continue;
    out.push({ id: a.id, name, description: desc, __score: s });
  }
  if (q) {
    out.sort((a, b) => {
      const ds = (b.__score || 0) - (a.__score || 0);
      if (ds !== 0) return ds;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  return out.slice(0, 200);
}

function getComposerContextFilteredSkills(skills, query) {
  const q = String(query || '').trim().toLowerCase();
  const out = [];
  for (const s of (Array.isArray(skills) ? skills : [])) {
    if (!s || !s.id) continue;
    const name = String(s.name || 'Skill').trim();
    const desc = String(s.description || '').trim();
    const score = scoreComposerContextLabel(name, desc, q);
    if (q && score < 0) continue;
    out.push({ id: s.id, name, description: desc, __score: score });
  }
  if (q) {
    out.sort((a, b) => {
      const ds = (b.__score || 0) - (a.__score || 0);
      if (ds !== 0) return ds;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  return out.slice(0, 200);
}

function getComposerContextFileItems(query) {
  const filtered = getComposerContextFilteredEntries(composerContextState.entries, query);
  return filtered.map((e) => ({
    itemType: e.kind === 'directory' ? 'folder' : 'file',
    kind: e.kind,
    relPath: e.relPath,
    name: e.name,
    __score: e.__score || 0
  }));
}

function getComposerContextAgentItems(query) {
  const agents = getComposerContextAvailableAgents();
  const filtered = getComposerContextFilteredAgents(agents, query);
  return filtered.map((a) => ({
    itemType: 'agent',
    id: a.id,
    name: a.name,
    description: a.description,
    __score: a.__score || 0
  }));
}

function getComposerContextSkillItems(query) {
  const skills = getComposerContextAvailableSkills();
  const filtered = getComposerContextFilteredSkills(skills, query);
  return filtered.map((s) => ({
    itemType: 'skill',
    id: s.id,
    name: s.name,
    description: s.description,
    __score: s.__score || 0
  }));
}

function getComposerContextSearchItems(query) {
  const items = [
    ...getComposerContextFileItems(query),
    ...getComposerContextAgentItems(query),
    ...getComposerContextSkillItems(query)
  ];
  const typeOrder = { file: 0, folder: 1, agent: 2, skill: 3 };
  items.sort((a, b) => {
    const ds = (b.__score || 0) - (a.__score || 0);
    if (ds !== 0) return ds;
    const ta = typeOrder[a.itemType] ?? 9;
    const tb = typeOrder[b.itemType] ?? 9;
    if (ta !== tb) return ta - tb;
    const ka = a.relPath || a.name || '';
    const kb = b.relPath || b.name || '';
    return String(ka).localeCompare(String(kb));
  });
  return items.slice(0, 500);
}

function getComposerContextActiveItems() {
  const q = String(composerContextState.query || '');
  const category = composerContextState.category;
  if (!category && q.trim()) return getComposerContextSearchItems(q);
  if (category === 'files') return getComposerContextFileItems(q);
  if (category === 'agents') return getComposerContextAgentItems(q);
  if (category === 'skills') return getComposerContextSkillItems(q);
  return [];
}


function renderComposerContextPopover() {
  const { popover, list, categories, title, subtitle, backBtn } = getComposerContextPopoverEls();
  if (!popover || !list || !categories) return;

  const category = composerContextState.category;
  const q = String(composerContextState.query || '');

  // Show/hide views based on category
  if (!category) {
    if (q.trim()) {
      categories.style.display = 'none';
      list.style.display = '';
      if (backBtn) backBtn.style.display = 'none';
      renderComposerContextSearchList();
      return;
    }
    // Category picker view
    categories.style.display = '';
    list.style.display = 'none';
    if (backBtn) backBtn.style.display = 'none';
    if (title) title.textContent = 'Add Context';
    if (subtitle) subtitle.textContent = 'Select a category';
    return;
  }

  // List view (files, agents, or skills)
  categories.style.display = 'none';
  list.style.display = '';
  if (backBtn) backBtn.style.display = '';

  if (category === 'files') {
    renderComposerContextFilesList();
  } else if (category === 'agents') {
    renderComposerContextAgentsList();
  } else if (category === 'skills') {
    renderComposerContextSkillsList();
  }
}

function renderComposerContextSearchList() {
  const { list, title, subtitle } = getComposerContextPopoverEls();
  if (!list) return;

  if (title) title.textContent = 'Search Results';
  const q = String(composerContextState.query || '');
  if (subtitle) {
    const shown = q.trim() ? `Filter: @${escapeHtml(q.trim())}` : 'Type @ in the input to filter';
    subtitle.innerHTML = shown;
  }

  const items = getComposerContextSearchItems(q);
  composerContextState.activeIndex = Math.max(0, Math.min(composerContextState.activeIndex || 0, Math.max(0, items.length - 1)));

  if (!items.length) {
    list.innerHTML = `<div class="composer-context-empty">No matches.</div>`;
    return;
  }

  const folderSvg = `<svg class="composer-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const fileSvg = `<svg class="composer-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
  const agentSvg = `<svg class="composer-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>`;
  const skillSvg = `<svg class="composer-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

  const activeAgentId = typeof getActiveAgentId === 'function' ? getActiveAgentId(currentSessionId) : '';
  const pendingSkillId = typeof getPendingSkillId === 'function' ? getPendingSkillId(currentSessionId) : '';

  list.innerHTML = items.map((item, idx) => {
    const isActive = idx === composerContextState.activeIndex;
    if (item.itemType === 'agent') {
      const isSelected = item.id === activeAgentId;
      const name = String(item.name || 'Agent').trim();
      const desc = String(item.description || '').trim();
      const scope = String(item.id || '').startsWith('user:') ? 'User' : 'Project';
      return `
        <div class="composer-context-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-type="agent" data-id="${escapeHtml(item.id)}" data-idx="${idx}">
          ${agentSvg}
          <div class="composer-context-text">
            <div class="composer-context-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
            <div class="composer-context-path" title="${escapeHtml(desc)}">${escapeHtml(desc || scope + ' agent')}</div>
          </div>
          ${isSelected ? '<span class="composer-context-badge active">Active</span>' : ''}
        </div>
      `;
    }
    if (item.itemType === 'skill') {
      const isSelected = item.id === pendingSkillId;
      const name = String(item.name || 'Skill').trim();
      const desc = String(item.description || '').trim();
      const scope = String(item.id || '').startsWith('user:') ? 'User' : 'Project';
      return `
        <div class="composer-context-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-type="skill" data-id="${escapeHtml(item.id)}" data-idx="${idx}">
          ${skillSvg}
          <div class="composer-context-text">
            <div class="composer-context-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
            <div class="composer-context-path" title="${escapeHtml(desc)}">${escapeHtml(desc || scope + ' skill')}</div>
          </div>
          ${isSelected ? '<span class="composer-context-badge active">Selected</span>' : ''}
        </div>
      `;
    }

    const kindLabel = item.itemType === 'folder' ? 'folder' : 'file';
    const displayName = item.itemType === 'folder' ? `${item.name || item.relPath}/` : (item.name || item.relPath);
    const displayPath = item.itemType === 'folder' ? `${item.relPath}/` : item.relPath;
    return `
      <div class="composer-context-item ${isActive ? 'active' : ''}" data-kind="${kindLabel}" data-rel="${escapeHtml(item.relPath)}" data-idx="${idx}">
        ${item.itemType === 'folder' ? folderSvg : fileSvg}
        <div class="composer-context-text">
          <div class="composer-context-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
          <div class="composer-context-path" title="${escapeHtml(displayPath)}">${escapeHtml(displayPath)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderComposerContextFilesList() {
  const { list, title, subtitle } = getComposerContextPopoverEls();
  if (!list) return;

  if (title) title.textContent = 'Files & Folders';
  const q = String(composerContextState.query || '');
  if (subtitle) {
    const shown = q.trim() ? `Filter: @${escapeHtml(q.trim())}` : 'Type @ in the input to filter';
    subtitle.innerHTML = shown;
  }

  const filtered = getComposerContextFilteredEntries(composerContextState.entries, q);
  composerContextState.activeIndex = Math.max(0, Math.min(composerContextState.activeIndex || 0, Math.max(0, filtered.length - 1)));

  if (!filtered.length) {
    list.innerHTML = `<div class="composer-context-empty">No files found.</div>`;
    return;
  }

  const folderSvg = `<svg class="composer-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const fileSvg = `<svg class="composer-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;

  list.innerHTML = filtered.map((e, idx) => {
    const isActive = idx === composerContextState.activeIndex;
    const kindLabel = e.kind === 'directory' ? 'folder' : 'file';
    const displayName = e.kind === 'directory' ? `${e.name || e.relPath}/` : (e.name || e.relPath);
    const displayPath = e.kind === 'directory' ? `${e.relPath}/` : e.relPath;
    return `
      <div class="composer-context-item ${isActive ? 'active' : ''}" data-kind="${kindLabel}" data-rel="${escapeHtml(e.relPath)}" data-idx="${idx}">
        ${e.kind === 'directory' ? folderSvg : fileSvg}
        <div class="composer-context-text">
          <div class="composer-context-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
          <div class="composer-context-path" title="${escapeHtml(displayPath)}">${escapeHtml(displayPath)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderComposerContextAgentsList() {
  const { list, title, subtitle } = getComposerContextPopoverEls();
  if (!list) return;

  if (title) title.textContent = 'Agents';
  const q = String(composerContextState.query || '');
  if (subtitle) {
    const shown = q.trim() ? `Filter: @${escapeHtml(q.trim())}` : 'Select an AI persona for this session';
    subtitle.innerHTML = shown;
  }

  const agents = getComposerContextAvailableAgents();
  const activeAgentId = typeof getActiveAgentId === 'function' ? getActiveAgentId(currentSessionId) : '';
  const filtered = getComposerContextFilteredAgents(agents, q);
  composerContextState.activeIndex = Math.max(0, Math.min(composerContextState.activeIndex || 0, Math.max(0, filtered.length - 1)));

  if (!filtered.length) {
    list.innerHTML = q.trim()
      ? `<div class="composer-context-empty">No matches.</div>`
      : `<div class="composer-context-empty">No agents found. Create one in the Agents & Skills library.</div>`;
    return;
  }

  const agentSvg = `<svg class="composer-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>`;

  list.innerHTML = filtered.map((a, idx) => {
    const isActive = idx === composerContextState.activeIndex;
    const isSelected = a.id === activeAgentId;
    const name = String(a.name || 'Agent').trim();
    const desc = String(a.description || '').trim();
    const scope = String(a.id || '').startsWith('user:') ? 'User' : 'Project';
    return `
      <div class="composer-context-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-type="agent" data-id="${escapeHtml(a.id)}" data-idx="${idx}">
        ${agentSvg}
        <div class="composer-context-text">
          <div class="composer-context-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="composer-context-path" title="${escapeHtml(desc)}">${escapeHtml(desc || scope + ' agent')}</div>
        </div>
        ${isSelected ? '<span class="composer-context-badge active">Active</span>' : ''}
      </div>
    `;
  }).join('');
}

function renderComposerContextSkillsList() {
  const { list, title, subtitle } = getComposerContextPopoverEls();
  if (!list) return;

  if (title) title.textContent = 'Skills';
  const q = String(composerContextState.query || '');
  if (subtitle) {
    const shown = q.trim() ? `Filter: @${escapeHtml(q.trim())}` : 'Apply a skill to your next message';
    subtitle.innerHTML = shown;
  }

  const skills = getComposerContextAvailableSkills();
  const pendingSkillId = typeof getPendingSkillId === 'function' ? getPendingSkillId(currentSessionId) : '';
  const filtered = getComposerContextFilteredSkills(skills, q);
  composerContextState.activeIndex = Math.max(0, Math.min(composerContextState.activeIndex || 0, Math.max(0, filtered.length - 1)));

  if (!filtered.length) {
    list.innerHTML = q.trim()
      ? `<div class="composer-context-empty">No matches.</div>`
      : `<div class="composer-context-empty">No skills found. Create one in the Agents & Skills library.</div>`;
    return;
  }

  const skillSvg = `<svg class="composer-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

  list.innerHTML = filtered.map((s, idx) => {
    const isActive = idx === composerContextState.activeIndex;
    const isSelected = s.id === pendingSkillId;
    const name = String(s.name || 'Skill').trim();
    const desc = String(s.description || '').trim();
    const scope = String(s.id || '').startsWith('user:') ? 'User' : 'Project';
    return `
      <div class="composer-context-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-type="skill" data-id="${escapeHtml(s.id)}" data-idx="${idx}">
        ${skillSvg}
        <div class="composer-context-text">
          <div class="composer-context-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="composer-context-path" title="${escapeHtml(desc)}">${escapeHtml(desc || scope + ' skill')}</div>
        </div>
        ${isSelected ? '<span class="composer-context-badge active">Selected</span>' : ''}
      </div>
    `;
  }).join('');
}


async function openComposerContextPopover({ trigger = 'button', atIndex = -1, query = '', category = null } = {}) {
  const { popover } = getComposerContextPopoverEls();
  if (!popover) return;
  if (!window.currentFolder) {
    showToast('Open a folder to pick context', 2500);
    return;
  }

  ensureComposerContextPopoverInBody();

  // Ensure we have a tree snapshot to work with
  try {
    if (!Array.isArray(workspaceFileTreeSnapshot) || workspaceFileTreeSnapshot.length === 0) {
      await refreshFileTree();
    }
  } catch { /* ignore */ }

  composerContextState.open = true;
  composerContextState.trigger = trigger;
  composerContextState.atIndex = Number.isFinite(atIndex) ? atIndex : -1;
  composerContextState.query = String(query || '');
  composerContextState.activeIndex = 0;
  composerContextState.entries = flattenWorkspaceTreeEntries(workspaceFileTreeSnapshot || [], []);
  composerContextState.category = category; // null = show category picker

  // Always force visible (we previously used visibility:hidden for measuring; that can fail-open and look "invisible").
  popover.style.display = 'block';
  popover.style.visibility = 'visible';
  popover.style.opacity = '1';
  try {
    renderComposerContextPopover();
    positionComposerContextPopover();
  } catch (e) {
    console.error('[ComposerContext] Failed to open popover:', e);
    try { showToast(`Context picker failed: ${e?.message || String(e)}`, 3500); } catch { /* ignore */ }
    // Still try to show *something* so it's not invisible.
    try { positionComposerContextPopover(); } catch { /* ignore */ }
  }
}


function closeComposerContextPopover() {
  const { popover } = getComposerContextPopoverEls();
  if (!popover) return;
  popover.style.display = 'none';
  composerContextState.open = false;
  composerContextState.trigger = '';
  composerContextState.atIndex = -1;
  composerContextState.query = '';
  composerContextState.activeIndex = 0;
  composerContextState.category = null;
}

function navigateComposerContextToCategory(category) {
  composerContextState.category = category;
  composerContextState.activeIndex = 0;
  composerContextState.query = '';
  renderComposerContextPopover();
  positionComposerContextPopover();
}

function navigateComposerContextBack() {
  composerContextState.category = null;
  composerContextState.activeIndex = 0;
  composerContextState.query = '';
  renderComposerContextPopover();
  positionComposerContextPopover();
}

async function handleComposerContextAgentPick(agentId) {
  if (!agentId) return;
  if (typeof setActiveAgentForSession === 'function') {
    setActiveAgentForSession(currentSessionId, agentId, { persist: true });
    showToast('Agent selected for this session');
  }
  if (composerContextState.trigger === 'typed') {
    const chatInput = document.getElementById('chatInput');
    if (chatInput && Number.isFinite(composerContextState.atIndex) && composerContextState.atIndex >= 0) {
      const cur = Number(chatInput.selectionStart || 0);
      replaceTextareaRange(chatInput, composerContextState.atIndex, cur, '');
    }
  }
  closeComposerContextPopover();
}

async function handleComposerContextSkillPick(skillId) {
  if (!skillId) return;
  if (typeof setPendingSkillForSession === 'function') {
    setPendingSkillForSession(currentSessionId, skillId);
    showToast('Skill selected (next message)');
  }
  if (composerContextState.trigger === 'typed') {
    const chatInput = document.getElementById('chatInput');
    if (chatInput && Number.isFinite(composerContextState.atIndex) && composerContextState.atIndex >= 0) {
      const cur = Number(chatInput.selectionStart || 0);
      replaceTextareaRange(chatInput, composerContextState.atIndex, cur, '');
    }
  }
  closeComposerContextPopover();
}


function isComposerContextPopoverOpen() {
  const { popover } = getComposerContextPopoverEls();
  return !!(popover && popover.style.display !== 'none' && composerContextState.open === true);
}


function detectAtQueryFromTextarea(text, cursorIndex) {
  const s = String(text || '');
  const cur = Math.max(0, Math.min(Number(cursorIndex || 0), s.length));
  const before = s.slice(0, cur);
  const at = before.lastIndexOf('@');
  if (at < 0) return { active: false };
  const prev = at > 0 ? before[at - 1] : '';
  // Only trigger when @ starts a token (start, whitespace, punctuation)
  if (prev && /[A-Za-z0-9_]/.test(prev)) return { active: false };
  const raw = before.slice(at + 1);
  // Stop at whitespace/newline (Cursor-like)
  if (/\s/.test(raw)) return { active: false };
  return { active: true, atIndex: at, query: raw, cursor: cur };
}


function replaceTextareaRange(textarea, start, end, nextText) {
  try {
    const el = textarea;
    const s = String(el.value || '');
    const a = Math.max(0, Math.min(Number(start || 0), s.length));
    const b = Math.max(0, Math.min(Number(end || 0), s.length));
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    el.value = s.slice(0, lo) + String(nextText || '') + s.slice(hi);
    const nextPos = lo + String(nextText || '').length;
    el.selectionStart = el.selectionEnd = nextPos;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    // ignore
  }
}


async function handleComposerContextPick(relPath, kind) {
  const chatInput = document.getElementById('chatInput');
  if (!relPath) return;

  if (kind === 'folder') {
    // Folder: attach as a folder chip
    if (typeof addWorkspaceFolderAttachment === 'function') {
      await addWorkspaceFolderAttachment(relPath);
    } else {
      await addWorkspaceFileAttachment(relPath);
    }
    if (composerContextState.trigger === 'typed' && chatInput && Number.isFinite(composerContextState.atIndex) && composerContextState.atIndex >= 0) {
      const cur = Number(chatInput.selectionStart || 0);
      replaceTextareaRange(chatInput, composerContextState.atIndex, cur, '');
    }
    closeComposerContextPopover();
    return;
  }

  // File: attach
  await addWorkspaceFileAttachment(relPath);

  // Clean up "@query" token if it was typed-triggered
  if (composerContextState.trigger === 'typed' && chatInput && Number.isFinite(composerContextState.atIndex) && composerContextState.atIndex >= 0) {
    const cur = Number(chatInput.selectionStart || 0);
    replaceTextareaRange(chatInput, composerContextState.atIndex, cur, '');
  }
  closeComposerContextPopover();
}


function shouldProjectScanRelPath(rel) {
  const p = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!p) return false;
  if (
    p.startsWith('.git/') ||
    p.startsWith('node_modules/') ||
    p.startsWith('.ai-agent/') ||
    p.startsWith('.codeon/') ||
    p.startsWith('dist/') ||
    p.startsWith('build/') ||
    p.includes('/node_modules/') ||
    p.includes('/.git/') ||
    p.includes('/.ai-agent/') ||
    p.includes('/.codeon/')
  ) return false;
  return true;
}


function isProjectScanLanguage(rel) {
  const lower = String(rel || '').toLowerCase();
  return (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.html') ||
    lower.endsWith('.htm') ||
    lower.endsWith('.json')
  );
}


function tsDiagMessageToString(msg) {
  try {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    // TypeScript DiagnosticMessageChain
    if (typeof msg.messageText === 'string') return msg.messageText;
    if (typeof msg === 'object' && typeof msg.messageText === 'string') return msg.messageText;
    if (typeof msg === 'object' && msg.messageText) return String(msg.messageText);
    return String(msg);
  } catch {
    return '';
  }
}


function tsCategoryToSeverity(cat) {
  // 0=Warning, 1=Error, 2=Suggestion, 3=Message
  if (cat === 1) return 'error';
  if (cat === 0) return 'warning';
  if (cat === 2) return 'hint';
  return 'info';
}


function computeLineColFromIndex(text, idx) {
  const s = String(text || '');
  const at = Math.max(0, Math.min(Number(idx || 0), s.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < at; i++) {
    if (s.charCodeAt(i) === 10) { line++; col = 1; } else { col++; }
  }
  return { line, col };
}


async function scanHtmlTextForEmbeddedScriptErrors(htmlText, { jsWorkerFactory } = {}) {
  const text = String(htmlText || '');
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  let guard = 0;
  const countNewlinesLocal = (s) => {
    const str = String(s || '');
    let n = 0;
    for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 10) n++;
    return n;
  };
  
  // Safety limit: skip very large HTML files to prevent hangs
  const MAX_HTML_SIZE = 500 * 1024; // 500KB
  if (text.length > MAX_HTML_SIZE) {
    return out;
  }

  if (!jsWorkerFactory || typeof monaco === 'undefined' || !monaco?.editor?.createModel || !monaco?.Uri?.parse) {
    return out;
  }

  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Worker timeout')), ms))
  ]);
  const WORKER_TIMEOUT_MS = 2500;
  
  while ((m = re.exec(text)) && guard++ < 50) {
    const attrsRaw = m[1] || '';
    const body = m[2] || '';
    const attrs = parseScriptAttrs(attrsRaw);
    if (attrs.src) continue;
    if (!shouldCheckScriptType(attrs.type)) continue;
    const code = String(body || '');
    if (!code.trim()) continue;
    
    // Skip extremely large script blocks to prevent worker hangs
    const MAX_SCRIPT_SIZE = 100 * 1024; // 100KB
    if (code.length > MAX_SCRIPT_SIZE) {
      continue;
    }

    const before = text.slice(0, m.index);
    const startLine = countNewlinesLocal(before) + 1;

    let scriptModel = null;
    try {
      const uri = monaco.Uri.parse(`inmemory://project-html-script/${guard}-${Math.random().toString(16).slice(2)}`);
      try { monaco.editor.getModel(uri)?.dispose?.(); } catch { /* ignore */ }
      scriptModel = monaco.editor.createModel(code, 'javascript', uri);
      if (!scriptModel) continue;

      const client = await withTimeout(jsWorkerFactory(uri), WORKER_TIMEOUT_MS);
      const diags = await withTimeout(client.getSyntacticDiagnostics(uri.toString()), WORKER_TIMEOUT_MS);
      if (Array.isArray(diags) && diags.length > 0) {
        for (const d of diags.slice(0, 20)) {
          const start = Number(d?.start || 0);
          const length = Number(d?.length || 1);
          const a = scriptModel.getPositionAt(start);
          const b = scriptModel.getPositionAt(start + Math.max(1, length));
          const msg = tsDiagMessageToString(d?.messageText) || 'Syntax error';
          out.push({
            message: `Embedded <script> JS syntax error: ${msg}`,
            startLineNumber: startLine + a.lineNumber - 1,
            startColumn: a.column,
            endLineNumber: startLine + b.lineNumber - 1,
            endColumn: b.column
          });
          if (out.length >= 20) break;
        }
      }
    } catch {
      // ignore worker errors
    } finally {
      if (scriptModel) {
        try { scriptModel.dispose(); } catch { /* ignore */ }
        scriptModel = null;
      }
    }
    if (out.length >= 20) break;
  }
  return out;
}


async function runProjectProblemsScan({ reason = '' } = {}) {
  if (!window.currentFolder || !window.electronAPI || typeof window.electronAPI.readFile !== 'function') return;
  if (!settings?.enableProblemsPanel) return;
  // Only scan when user opted into language services (keeps default behavior unchanged).
  if (!settings?.enableTsJsLanguageService && !settings?.enableWebLanguageServices) return;
  
  // Prevent concurrent scans
  if (__projectScanLock) {
    console.log('[Problems] Scan skipped - another scan is in progress');
    return;
  }
  
  // Acquire lock
  __projectScanLock = true;
  const scanStartTime = Date.now();

  const token = ++projectProblemsState.token;
  projectProblemsState.status = 'scanning';
  projectProblemsState.startedAt = scanStartTime;
  projectProblemsState.finishedAt = 0;
  projectProblemsState.scannedFiles = 0;
  projectProblemsState.error = '';
  projectProblemsState.truncated = false;
  projectProblemsState.results = [];
  
  // Helper to check if scan should abort (timeout or cancelled)
  const shouldAbort = () => {
    if (token !== projectProblemsState.token) return true; // cancelled
    if (Date.now() - scanStartTime > __PROJECT_SCAN_MAX_DURATION_MS) return true; // timeout
    return false;
  };

  const relListAll = flattenWorkspaceTreeFiles(workspaceFileTreeSnapshot || [], []);
  const relList = relListAll.filter(p => shouldProjectScanRelPath(p) && isProjectScanLanguage(p));
  projectProblemsState.totalFiles = relList.length;
  scheduleRenderProblemsView();

  // Cache current open models to avoid URI collisions + wasted work
  const openAbs = new Set((editorTabs || []).map(t => normalizeFsPath(t?.absPath)).filter(Boolean));

  // TS/JS worker (only if enabled)
  let tsWorkerFactory = null;
  let jsWorkerFactory = null;
  try {
    if (settings.enableTsJsLanguageService === true && typeof monaco !== 'undefined' && monaco?.languages?.typescript) {
      tsWorkerFactory = await monaco.languages.typescript.getTypeScriptWorker();
      jsWorkerFactory = await monaco.languages.typescript.getJavaScriptWorker();
    }
  } catch { /* ignore */ }

  const maxFiles = 1200; // safety cap
  const maxSizeBytes = 300 * 1024; // skip huge files

  try {
  for (const rel of relList.slice(0, maxFiles)) {
    if (shouldAbort()) {
      projectProblemsState.status = 'done';
      projectProblemsState.finishedAt = Date.now();
      return;
    }
    const abs = normalizeFsPath(resolveToWorkspaceAbsPath(rel));
    if (!abs || openAbs.has(abs)) {
      projectProblemsState.scannedFiles++;
      continue;
    }

    // Best-effort size check
    try {
      const st = await window.electronAPI.getFileStats?.(abs);
      const size = st?.success && st?.stats && Number.isFinite(st.stats.size) ? Number(st.stats.size) : null;
      if (Number.isFinite(size) && size > maxSizeBytes) {
        projectProblemsState.scannedFiles++;
        continue;
      }
    } catch { /* ignore */ }

    let content = '';
    try {
      const rr = await window.electronAPI.readFile(abs);
      if (!rr || rr.success !== true || rr.isBase64 === true) {
        projectProblemsState.scannedFiles++;
        continue;
      }
      content = String(rr.content || '');
    } catch {
      projectProblemsState.scannedFiles++;
      continue;
    }

    const lower = rel.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      const errs = await scanHtmlTextForEmbeddedScriptErrors(content, { jsWorkerFactory });
      for (const e of errs) {
        projectProblemsState.results.push({
          absPath: abs,
          relPath: rel,
          fileName: basenameFromPath(rel),
          message: e.message,
          source: 'project-scan',
          code: '',
          severity: 'error',
          startLineNumber: Number(e.startLineNumber || 1),
          startColumn: Number(e.startColumn || 1),
          endLineNumber: Number(e.startLineNumber || 1),
          endColumn: Number(e.startColumn || 2)
        });
      }
      projectProblemsState.scannedFiles++;
      if (projectProblemsState.scannedFiles % 30 === 0) scheduleRenderProblemsView();
      continue;
    }

    if (lower.endsWith('.json')) {
      try {
        // JSONC files (tsconfig, jsconfig, etc.) support comments - strip them before parsing
        const isJsonc = lower.endsWith('tsconfig.json') || 
                        lower.endsWith('jsconfig.json') || 
                        lower.includes('tsconfig.') ||
                        lower.includes('jsconfig.');
        const jsonContent = isJsonc ? stripJsonComments(content) : content;
        JSON.parse(jsonContent);
      } catch (e) {
        const msg = String(e?.message || 'Invalid JSON');
        let pos = null;
        try {
          const m = msg.match(/position\s+(\d+)/i);
          if (m && m[1]) pos = Number(m[1]);
        } catch { /* ignore */ }
        const lc = pos != null ? computeLineColFromIndex(content, pos) : { line: 1, col: 1 };
        projectProblemsState.results.push({
          absPath: abs,
          relPath: rel,
          fileName: basenameFromPath(rel),
          message: `JSON parse error: ${msg}`,
          source: 'project-scan',
          code: '',
          severity: 'error',
          startLineNumber: lc.line,
          startColumn: lc.col,
          endLineNumber: lc.line,
          endColumn: lc.col + 1
        });
      }
      projectProblemsState.scannedFiles++;
      if (projectProblemsState.scannedFiles % 30 === 0) scheduleRenderProblemsView();
      continue;
    }

    // JS/TS via Monaco TS worker (syntactic diagnostics only = fast & safe)
    // Use a separate variable outside try to guarantee disposal in finally
    let model = null;
    try {
      const lang = detectMonacoLanguageFromPath(abs);
      const uri = safeMonacoFileUri(abs) || monaco?.Uri?.parse?.(`inmemory://project/${encodeURIComponent(rel)}`);
      if (!uri || !monaco?.editor?.createModel) {
        projectProblemsState.scannedFiles++;
        continue;
      }

      // Create ephemeral model; must be disposed to avoid memory growth.
      try { model = monaco.editor.createModel(content, lang, uri); } catch { model = null; }
      if (!model) {
        projectProblemsState.scannedFiles++;
        continue;
      }

      const isTs = lower.endsWith('.ts') || lower.endsWith('.tsx');
      const isJs = lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs');
      let diags = [];

      // Add timeout protection for TS worker calls to prevent hangs
      const WORKER_TIMEOUT_MS = 5000;
      const withTimeout = (promise, ms) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Worker timeout')), ms))
      ]);

      try {
        if (isTs && tsWorkerFactory) {
          const client = await withTimeout(tsWorkerFactory(uri), WORKER_TIMEOUT_MS);
          diags = await withTimeout(client.getSyntacticDiagnostics(uri.toString()), WORKER_TIMEOUT_MS);
        } else if (isJs && jsWorkerFactory) {
          const client = await withTimeout(jsWorkerFactory(uri), WORKER_TIMEOUT_MS);
          diags = await withTimeout(client.getSyntacticDiagnostics(uri.toString()), WORKER_TIMEOUT_MS);
        }
      } catch (workerErr) {
        // Worker timed out or crashed - skip this file silently
        diags = [];
      }

      // Cap total results to prevent memory issues
      const MAX_TOTAL_RESULTS = 500;
      if (projectProblemsState.results.length >= MAX_TOTAL_RESULTS) {
        projectProblemsState.truncated = true;
        // Skip adding more results but continue to count scanned files
      } else if (Array.isArray(diags) && diags.length > 0) {
        for (const d of diags.slice(0, 20)) {
          if (projectProblemsState.results.length >= MAX_TOTAL_RESULTS) break;
          const start = Number(d?.start || 0);
          const length = Number(d?.length || 1);
          const a = model.getPositionAt(start);
          const b = model.getPositionAt(start + Math.max(1, length));
          projectProblemsState.results.push({
            absPath: abs,
            relPath: rel,
            fileName: basenameFromPath(rel),
            message: tsDiagMessageToString(d?.messageText) || 'Syntax error',
            source: 'project-scan',
            code: String(d?.code || ''),
            severity: tsCategoryToSeverity(d?.category),
            startLineNumber: a.lineNumber,
            startColumn: a.column,
            endLineNumber: b.lineNumber,
            endColumn: b.column
          });
        }
      }
    } catch {
      // ignore
    } finally {
      // CRITICAL: Always dispose model to prevent memory leaks
      if (model) {
        try { model.dispose(); } catch { /* ignore */ }
        model = null;
      }
    }

    projectProblemsState.scannedFiles++;
    if (projectProblemsState.scannedFiles % 30 === 0) scheduleRenderProblemsView();
  }

  projectProblemsState.truncated = relList.length > maxFiles;
  projectProblemsState.status = 'done';
  projectProblemsState.finishedAt = Date.now();
  projectProblemsState.error = '';
  scheduleRenderProblemsView();
  if (reason) {
    try { window.addConsoleMessage?.(`Project scan complete (${projectProblemsState.results.length} issue(s))`, 'info', currentSessionId); } catch { /* ignore */ }
  }
  } catch (scanErr) {
    // Handle any unexpected errors during scan
    console.warn('[Problems] Scan error:', scanErr);
    projectProblemsState.status = 'error';
    projectProblemsState.error = String(scanErr?.message || scanErr || 'Scan failed');
    projectProblemsState.finishedAt = Date.now();
  } finally {
    // Always release lock and update cooldown timestamp
    __projectScanLock = false;
    __projectScanLastCompletedAt = Date.now();
  }
}


function markerSeverityToKind(sev) {
  // Monaco MarkerSeverity: Hint=1, Info=2, Warning=4, Error=8
  if (sev === 8) return 'error';
  if (sev === 4) return 'warning';
  if (sev === 2) return 'info';
  return 'hint';
}


function problemOriginRank(p) {
  // Lower is higher priority (wins during dedupe)
  // 0 = live editor markers (open file)
  // 1 = diff buffers
  // 2 = project scan (unopened files / cached)
  try {
    if (p && p.__diffModel) return 1;
    if (p && String(p.source || '').trim() === 'project-scan') return 2;
    return 0;
  } catch {
    return 0;
  }
}


function problemDedupeKey(p) {
  try {
    const file =
      String(p?.absPath || '').trim() ||
      String(p?.relPath || '').trim() ||
      String(p?.fileName || '').trim() ||
      '';
    const sev = String(p?.severity || '').trim();
    const msg = String(p?.message || '').trim();
    const code = String(p?.code || '').trim();
    const ln = Number(p?.startLineNumber || 0) || 0;
    const col = Number(p?.startColumn || 0) || 0;
    // Include `code` as a tiebreaker but don't rely on it always being present.
    return `${file}::${ln}:${col}::${sev}::${msg}::${code}`;
  } catch {
    return '';
  }
}


function dedupeProblems(list) {
  const arr = Array.isArray(list) ? list : [];
  const bestByKey = new Map();
  for (const p of arr) {
    if (!p) continue;
    const key = problemDedupeKey(p);
    if (!key) continue;
    const nextRank = problemOriginRank(p);
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, p);
      continue;
    }
    const prevRank = problemOriginRank(prev);
    if (nextRank < prevRank) {
      bestByKey.set(key, p);
      continue;
    }
    // Same rank: prefer the one with more info (code/source), then keep existing.
    if (nextRank === prevRank) {
      const prevScore = (prev.code ? 1 : 0) + (prev.source ? 1 : 0);
      const nextScore = (p.code ? 1 : 0) + (p.source ? 1 : 0);
      if (nextScore > prevScore) bestByKey.set(key, p);
    }
  }
  return Array.from(bestByKey.values());
}


// TypeScript/JavaScript error codes to ignore (false positives in Monaco editor)
// These are module resolution errors and type inference noise that occur because Monaco
// can't resolve Node modules and doesn't have full project context
const __ignoredTsDiagnosticCodes = new Set([
  // Module resolution errors
  '2307',  // Cannot find module 'X'
  '2304',  // Cannot find name 'X'
  '7016',  // Could not find a declaration file for module 'X'
  '2792',  // Cannot find module 'X'. Did you mean to set moduleResolution to 'node16'?
  '2305',  // Module 'X' has no exported member 'Y'
  '2306',  // File 'X' is not a module
  '2311',  // Cannot find namespace 'X'
  '2694',  // Namespace 'X' has no exported member 'Y'
  '2503',  // Cannot find namespace 'X'
  '1259',  // Module 'X' can only be default-imported using the 'esModuleInterop' flag
  '1192',  // Module 'X' has no default export
  '2497',  // This module can only be referenced with ECMAScript imports/exports
  // Type inference noise (common in non-strict projects)
  '7044',  // Parameter 'x' implicitly has an 'any' type, but a better type may be inferred
  '7043',  // Element implicitly has an 'any' type
  '7006',  // Parameter 'x' implicitly has an 'any' type
  '7005',  // Variable 'x' implicitly has an 'any' type
  '7031',  // Binding element 'x' implicitly has an 'any' type
  '7034',  // Variable 'x' implicitly has type 'any'
]);

function shouldIgnoreDiagnostic(marker) {
  if (!marker) return false;
  const code = String(marker.code || '').trim();
  const source = String(marker.source || '').toLowerCase();
  
  // Only filter TypeScript/JavaScript diagnostics
  if (source !== 'ts' && source !== 'typescript' && source !== 'js' && source !== 'javascript') {
    return false;
  }
  
  // Check if this is a module resolution error we should ignore
  if (__ignoredTsDiagnosticCodes.has(code)) {
    return true;
  }
  
  // Also filter by message pattern for any we might have missed
  const msg = String(marker.message || '').toLowerCase();
  if (msg.includes('cannot find module') || 
      msg.includes('cannot find namespace') ||
      msg.includes('could not find a declaration file')) {
    return true;
  }
  
  return false;
}

function getProblemsForOpenTabs() {
  const out = [];
  try {
    if (typeof monaco === 'undefined' || !monaco?.editor?.getModelMarkers) return out;
    for (const tab of (editorTabs || [])) {
      if (!tab || !tab.model) continue;
      const uri = tab.model.uri;
      const markers = monaco.editor.getModelMarkers({ resource: uri }) || [];
      for (const m of markers) {
        // Skip module resolution errors (false positives in Monaco)
        if (shouldIgnoreDiagnostic(m)) continue;
        
        out.push({
          absPath: tab.absPath,
          relPath: tab.relPath,
          fileName: tab.name,
          message: String(m?.message || '').trim(),
          source: String(m?.source || '').trim(),
          code: String(m?.code || '').trim(),
          severity: markerSeverityToKind(m?.severity),
          startLineNumber: Number(m?.startLineNumber || 1),
          startColumn: Number(m?.startColumn || 1),
          endLineNumber: Number(m?.endLineNumber || 1),
          endColumn: Number(m?.endColumn || 1)
        });
      }
    }
  } catch {
    // ignore
  }

  // Also include diff view diagnostics if a diff is currently open.
  // This keeps Problems useful while reviewing git diffs (still low-risk: read-only).
  try {
    if (diffModels && (diffModels.original || diffModels.modified)) {
      const addFrom = (model, label) => {
        if (!model) return;
        const uri = model.uri;
        const markers = monaco.editor.getModelMarkers({ resource: uri }) || [];
        for (const m of markers) {
          // Skip module resolution errors (false positives in Monaco)
          if (shouldIgnoreDiagnostic(m)) continue;
          
          out.push({
            absPath: '', // diff buffers aren't necessarily a real file target
            relPath: label,
            fileName: label,
            message: String(m?.message || '').trim(),
            source: String(m?.source || '').trim(),
            code: String(m?.code || '').trim(),
            severity: markerSeverityToKind(m?.severity),
            startLineNumber: Number(m?.startLineNumber || 1),
            startColumn: Number(m?.startColumn || 1),
            endLineNumber: Number(m?.endLineNumber || 1),
            endColumn: Number(m?.endColumn || 1),
            __diffModel: model
          });
        }
      };
      addFrom(diffModels.original, 'Diff (base)');
      addFrom(diffModels.modified, 'Diff (current)');
    }
  } catch {
    // ignore
  }

  // Project-wide scan results (for unopened files)
  try {
    if (projectProblemsState && Array.isArray(projectProblemsState.results) && projectProblemsState.results.length > 0) {
      out.push(...projectProblemsState.results);
    }
  } catch { /* ignore */ }
  return dedupeProblems(out);
}


async function jumpToProblem(p) {
  const abs = String(p?.absPath || '').trim();
  const line = Number(p?.startLineNumber || 1);
  const col = Number(p?.startColumn || 1);
  // Diff buffers: jump inside diff editor if visible.
  if (!abs && p?.__diffModel) {
    try {
      const diffEditorEl = document.getElementById('diffEditor');
      const isDiffVisible = diffEditorEl && diffEditorEl.style.display === 'block';
      if (isDiffVisible && diffEditor && typeof diffEditor.getModifiedEditor === 'function') {
        const targetEditor = diffEditor.getModifiedEditor();
        targetEditor?.setPosition?.({ lineNumber: line, column: col });
        targetEditor?.revealPositionInCenter?.({ lineNumber: line, column: col });
        targetEditor?.focus?.();
      }
    } catch { /* ignore */ }
    return;
  }
  if (!abs) return;

  // Prefer activating an existing tab; otherwise open the file.
  try {
    const existing = findTabByAbsPath(abs);
    if (existing) {
      await activateEditorTab(abs);
    } else {
      await openFile(abs);
    }
  } catch { /* ignore */ }

  try {
    if (editor && typeof editor.setPosition === 'function') {
      editor.setPosition({ lineNumber: line, column: col });
      editor.revealPositionInCenter?.({ lineNumber: line, column: col });
      editor.focus?.();
    }
  } catch {
    // ignore
  }
}


function buildProblemContextForOpenTab(absPath, line, context = 8) {
  try {
    const tab = findTabByAbsPath(absPath);
    const model = tab?.model;
    if (!model || typeof model.getValue !== 'function') return null;
    const full = String(model.getValue() || '');
    const lines = full.split('\n');
    const ln = Math.max(1, Number(line || 1));
    // Narrow for HTML embedded script errors: keep context within the <script> block.
    let start = Math.max(1, ln - context);
    let end = Math.min(lines.length, ln + context);
    try {
      const lid = String(model.getLanguageId?.() || '').toLowerCase();
      if (lid === 'html') {
        const range = findHtmlScriptBlockRangeForLine(full, ln);
        if (range) {
          start = Math.max(1, range.startLine);
          end = Math.min(lines.length, range.endLine);
          // If the script is huge, fall back to a small window inside it.
          const maxLines = 60;
          if (end - start + 1 > maxLines) {
            start = Math.max(range.startLine, ln - context);
            end = Math.min(range.endLine, ln + context);
          }
        }
      }
    } catch { /* ignore */ }
    const slice = lines.slice(start - 1, end);
    const snippet = slice
      .map((t, i) => `${String(start + i).padStart(4, ' ')} | ${t}`)
      .join('\n');
    return { snippet, startLine: start, endLine: end };
  } catch {
    return null;
  }
}

async function buildProblemContextForFile(absPath, line, context = 8) {
  const abs = normalizeFsPath(String(absPath || '').trim());
  const ln = Math.max(1, Number(line || 1));
  // Prefer open model (fast)
  const open = buildProblemContextForOpenTab(abs, ln, context);
  if (open) return open;
  // Fallback: read from disk and slice lines
  try {
    if (!window.electronAPI || typeof window.electronAPI.readFile !== 'function') return null;
    const rr = await window.electronAPI.readFile(abs);
    if (!rr || rr.success !== true || rr.isBase64 === true) return null;
    const full = String(rr.content || '');
    const lines = full.split('\n');
    let start = Math.max(1, ln - context);
    let end = Math.min(lines.length, ln + context);
    try {
      const lower = abs.toLowerCase();
      if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        const range = findHtmlScriptBlockRangeForLine(full, ln);
        if (range) {
          start = Math.max(1, range.startLine);
          end = Math.min(lines.length, range.endLine);
          const maxLines = 60;
          if (end - start + 1 > maxLines) {
            start = Math.max(range.startLine, ln - context);
            end = Math.min(range.endLine, ln + context);
          }
        }
      }
    } catch { /* ignore */ }
    const slice = lines.slice(start - 1, end);
    const snippet = slice
      .map((t, i) => `${String(start + i).padStart(4, ' ')} | ${t}`)
      .join('\n');
    return { snippet, startLine: start, endLine: end };
  } catch {
    return null;
  }
}


function addProblemContextAttachment({ absPath, relPath, lineNumber, startLine, endLine, snippet, diagnosticMessage }) {
  try {
    const sid = currentSessionId;
    if (!sid) return;
    const abs = normalizeFsPath(String(absPath || '').trim());
    const rel = String(relPath || '').trim();
    const base = basenameFromPath(rel || abs || 'context');
    const s = Number(startLine || lineNumber || 1);
    const e = Number(endLine || lineNumber || s);
    const display = `${base} (${s}-${e})`;

    // Replace any previous problem-context pills to keep UI clean (Cursor-like behavior).
    const prev = getPendingAttachments(sid).filter(a => a && a.contentType !== 'problem_context');

    const text =
      `Problem context\n` +
      (rel ? `File (relative): ${rel}\n` : '') +
      (abs ? `File (absolute): ${abs}\n` : '') +
      `Range: L${s}-L${e}` + (lineNumber ? ` (error at L${Number(lineNumber)})` : '') + `\n` +
      (diagnosticMessage ? `Diagnostic: ${String(diagnosticMessage).trim()}\n` : '') +
      `\nSnippet:\n` +
      `${String(snippet || '').trim()}\n`;

    const attachment = {
      id: Date.now() + Math.random(),
      name: display,
      type: 'text/plain',
      size: text.length,
      contentType: 'problem_context',
      text,
      // helpful metadata (not required by materializer)
      meta: {
        absPath: abs,
        relPath: rel,
        startLine: s,
        endLine: e
      }
    };

    setPendingAttachments(sid, [...prev, attachment]);
    renderAttachmentPreview();
  } catch {
    // ignore
  }
}


function prefillChatForProblemFix(p) {
  try {
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel?.classList?.contains('collapsed')) chatPanel.classList.remove('collapsed');
  } catch { /* ignore */ }

  const input = document.getElementById('chatInput');
  if (!input) return;

  const rel = String(p?.relPath || p?.fileName || p?.absPath || '').trim();
  const line = Number(p?.startLineNumber || 1);
  const sev = String(p?.severity || 'info');
  const msg = String(p?.message || '').trim();

  // Cursor-like UX: attach code context as a pill, not inline in the textarea.
  (async () => {
    try {
      const abs = String(p?.absPath || '').trim();
      if (!abs) return;
      const ctx = await buildProblemContextForFile(abs, line, 8);
      if (ctx && ctx.snippet) {
        addProblemContextAttachment({
          absPath: abs,
          relPath: rel,
          lineNumber: line,
          startLine: ctx.startLine,
          endLine: ctx.endLine,
          snippet: ctx.snippet,
          diagnosticMessage: msg
        });
      }
    } catch { /* ignore */ }
  })();

  const payload =
    `Fix this ${sev} diagnostic in ${rel} at line ${line}:\n` +
    `${msg}\n\n` +
    `(See attached context.)\n\n` +
    `Please make the smallest correct edit(s) to resolve it.`;

  input.value = payload;
  try {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } catch { /* ignore */ }
  try { input.focus(); } catch { /* ignore */ }
}


function normalizeClipboardText(s) {
  return String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}


// Legacy heuristic (kept for potential future opt-in behavior). Not used by default.
function _looksLikeCode(text) {
  const raw = String(text || '');
  const t = raw.trim();
  if (!t) return false;

  // Strong signal: fenced code blocks
  if (t.startsWith('```') || t.includes('\n```')) return true;

  const lines = t.split(/\r?\n/);
  const multi = lines.length >= 2;

  const hasStrongSymbols = /[{}[\];]/.test(t) || /(=>|->|::)/.test(t);
  const hasCodeKeywords = /\b(function|const|let|var|class|import|export|return|if|else|for|while|switch|case|try|catch|throw|async|await|def|package|interface|struct)\b/.test(t);
  const hasHtml = /<\/?[a-z][\s\S]*?>/i.test(t);
  const hasJsonLike = /^\s*[{[][\s\S]*[}\]]\s*$/.test(t) && /:\s*\S/.test(t);
  const hasIndent = /^\s{2,}\S/m.test(t) || /^\t+\S/m.test(t);
  const hasComment = /^\s*(\/\/|\/\*|\*|#)\s*\S/m.test(t);

  const punctCount = (t.match(/[{}()[\];,.<>:=+\-*/\\]/g) || []).length;
  const letterCount = (t.match(/[A-Za-z]/g) || []).length;
  const punctRatio = letterCount ? (punctCount / letterCount) : punctCount;

  let score = 0;
  if (multi) score += 1;
  if (hasStrongSymbols) score += 2;
  if (hasCodeKeywords) score += 2;
  if (hasHtml) score += 2;
  if (hasJsonLike) score += 2;
  if (hasIndent) score += 1;
  if (hasComment) score += 1;
  if (punctRatio > 0.12) score += 1;

  // Reduce false positives for multi-line prose (sentences/paragraphs)
  const endPunctLines = lines.filter(l => /[.!?]["')\]]*\s*$/.test(String(l || '').trim())).length;
  if (multi && endPunctLines >= Math.max(2, Math.floor(lines.length * 0.6)) && !hasStrongSymbols && !hasCodeKeywords && !hasHtml && !hasJsonLike) {
    score -= 3;
  }

  // Single-line short text should not become a code pill.
  if (!multi && t.length < 40 && !hasStrongSymbols && !hasCodeKeywords && !hasHtml && !hasJsonLike) {
    score -= 2;
  }

  return score >= 3;
}


function tryGetEditorSelectionContext() {
  try {
    if (!editor) return null;
    const model = editor.getModel?.();
    if (!model) return null;
    const sel = editor.getSelection?.();
    if (!sel || sel.isEmpty?.()) return null;
    const text = model.getValueInRange(sel);
    const abs = normalizeFsPath(String(currentFile || '').trim());
    const rel = abs ? getRelPath(abs) : '';
    return {
      absPath: abs,
      relPath: rel,
      startLine: sel.startLineNumber,
      endLine: sel.endLineNumber,
      text: String(text || '')
    };
  } catch {
    return null;
  }
}


function buildCodeonClipboardSelectionMeta(selCtx) {
  try {
    if (!selCtx) return '';
    const rel = String(selCtx.relPath || '').trim();
    const abs = String(selCtx.absPath || '').trim();
    const startLine = Number(selCtx.startLine || 0);
    const endLine = Number(selCtx.endLine || 0);
    if (!rel && !abs) return '';
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine <= 0 || endLine <= 0) return '';
    return JSON.stringify({ relPath: rel, absPath: abs, startLine, endLine, v: 1 });
  } catch {
    return '';
  }
}


function parseCodeonClipboardSelectionMeta(raw) {
  try {
    const obj = JSON.parse(String(raw || ''));
    if (!obj || typeof obj !== 'object') return null;
    const rel = typeof obj.relPath === 'string' ? obj.relPath.trim() : '';
    const abs = typeof obj.absPath === 'string' ? obj.absPath.trim() : '';
    const startLine = Number(obj.startLine || 0);
    const endLine = Number(obj.endLine || 0);
    if (!rel && !abs) return null;
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine <= 0 || endLine <= 0) return null;
    return { relPath: rel, absPath: abs, startLine, endLine };
  } catch {
    return null;
  }
}


function normalizeWorkspaceRelPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}


function workspaceTreeHasFileRelPath(relPath) {
  try {
    const target = normalizeWorkspaceRelPath(relPath);
    if (!target) return false;
    const roots = Array.isArray(workspaceFileTreeSnapshot) ? workspaceFileTreeSnapshot : [];
    if (!roots.length) return false;
    const stack = roots.slice();
    let guard = 0;
    // Reduced from 250000 to 50000 to prevent potential hangs on malformed trees
    while (stack.length && guard++ < 50000) {
      const n = stack.pop();
      if (!n) continue;
      const typ = String(n.type || '').trim();
      if (typ === 'file') {
        const p = normalizeWorkspaceRelPath(n.path || '');
        if (p && p === target) return true;
        continue;
      }
      if (typ === 'directory' && Array.isArray(n.children) && n.children.length) {
        for (const c of n.children) stack.push(c);
      }
    }
    return false;
  } catch {
    return false;
  }
}


function looksLikeCodeFilePathForContext(pathStr) {
  try {
    const p = String(pathStr || '').trim();
    if (!p) return false;
    if (p.includes('://')) return false;
    const base = p.split(/[/\\]/).pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return false;
    const ext = base.slice(dot + 1).toLowerCase();
    if (!ext || ext.length > 10) return false;
    return CODE_CONTEXT_HEADER_ALLOWED_EXTS.has(ext);
  } catch {
    return false;
  }
}


function parseFileRangeHeaderFromPastedText(clipText) {
  try {
    const clip = normalizeClipboardText(clipText);
    const lines = clip.split('\n');
    const firstLineRaw = String(lines[0] || '').trim();
    if (!firstLineRaw) return null;

    // Allow "@path (1-2)" (Cursor-like references in chat)
    let first = firstLineRaw;
    if (first.startsWith('@')) first = first.slice(1).trim();

    const patterns = [
      // path (start-end)
      [/^(.+?)\s*\(\s*(\d+)\s*-\s*(\d+)\s*\)\s*$/, (m) => ({ path: m[1], start: m[2], end: m[3] })],
      // path (line)
      [/^(.+?)\s*\(\s*(\d+)\s*\)\s*$/, (m) => ({ path: m[1], start: m[2], end: m[2] })],
      // path:start-end
      [/^(.+?)\s*:\s*(\d+)\s*-\s*(\d+)\s*$/, (m) => ({ path: m[1], start: m[2], end: m[3] })],
      // path:line
      [/^(.+?)\s*:\s*(\d+)\s*$/, (m) => ({ path: m[1], start: m[2], end: m[2] })],
      // path#Lstart-Lend
      [/^(.+?)\s*#\s*L(\d+)\s*-\s*L(\d+)\s*$/, (m) => ({ path: m[1], start: m[2], end: m[3] })],
      // path#Lline
      [/^(.+?)\s*#\s*L(\d+)\s*$/, (m) => ({ path: m[1], start: m[2], end: m[2] })]
    ];

    let parsed = null;
    for (const [re, fn] of patterns) {
      const m = first.match(re);
      if (!m) continue;
      parsed = fn(m);
      break;
    }
    if (!parsed) return null;

    const pathRaw = normalizeFsPath(String(parsed.path || '').trim());
    if (!pathRaw) return null;

    const startLine = Number(parsed.start || 0);
    const endLine = Number(parsed.end || 0);
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine <= 0 || endLine <= 0) return null;

    // Normalize to a workspace-relative path if possible.
    let rel = '';
    let abs = '';
    if (isProbablyAbsolutePath(pathRaw)) {
      abs = pathRaw;
      rel = getRelPath(abs);
    } else {
      rel = pathRaw.replace(/^\.\/+/, '');
    }
    rel = normalizeWorkspaceRelPath(rel);
    if (!rel) return null;
    if (!looksLikeCodeFilePathForContext(rel)) return null;

    // Only treat as context when the referenced file actually exists in the opened workspace.
    if (!workspaceTreeHasFileRelPath(rel)) return null;

    const rest = lines.slice(1).join('\n');
    const code = rest.trim() ? rest : clip;
    return {
      absPath: abs || normalizeFsPath(resolveToWorkspaceAbsPath(rel)),
      relPath: rel,
      startLine,
      endLine,
      code
    };
  } catch {
    return null;
  }
}


function renderProblemsView() {
  const content = document.getElementById('problemsContent');
  const tabEl = document.getElementById('problemsTab');
  const badgeEl = tabEl ? tabEl.querySelector('.problems-badge') : null;

  if (!content || !tabEl) return;

  const enabled = settings?.enableProblemsPanel === true;
  tabEl.style.display = enabled ? '' : 'none';
  content.style.display = enabled ? '' : 'none';

  if (!enabled) {
    content.innerHTML = '';
    if (badgeEl) badgeEl.style.display = 'none';
    return;
  }

  setupProblemsOnce();

  const problems = getProblemsForOpenTabs();
  const count = problems.length;
  if (badgeEl) {
    badgeEl.textContent = String(count);
    badgeEl.style.display = count > 0 ? '' : 'none';
  }

  // Sort: errors -> warnings -> infos -> hints, then file, then line/col
  const sevRank = { error: 0, warning: 1, info: 2, hint: 3 };
  problems.sort((a, b) => {
    const ra = sevRank[a.severity] ?? 9;
    const rb = sevRank[b.severity] ?? 9;
    if (ra !== rb) return ra - rb;
    const fa = String(a.relPath || a.fileName || a.absPath || '');
    const fb = String(b.relPath || b.fileName || b.absPath || '');
    if (fa !== fb) return fa.localeCompare(fb);
    if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber;
    return a.startColumn - b.startColumn;
  });

  // If no problems but project scan is running, show progress.
  if (count === 0 && projectProblemsState.status === 'scanning') {
    const scanned = Number(projectProblemsState.scannedFiles || 0);
    const total = Number(projectProblemsState.totalFiles || 0);
    const pct = total > 0 ? Math.round((scanned / total) * 100) : 0;
    content.innerHTML = `
      <div class="problems-container">
        <div class="problems-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; opacity: 0.3;">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <div>Scanning project… ${pct}%</div>
          <div style="font-size: 12px; color: var(--text-tertiary);">${scanned} / ${total} files</div>
        </div>
      </div>
    `;
    return;
  }

  if (count === 0) {
    content.innerHTML = `
      <div class="problems-container">
        <div class="problems-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; opacity: 0.3;">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4"/>
            <path d="M12 16h.01"/>
          </svg>
          <div>No problems found</div>
          <div style="font-size: 12px; color: var(--text-tertiary);">Diagnostics are shown for currently open editor tabs.</div>
        </div>
      </div>
    `;
    return;
  }

  const aiEnabled = settings?.enableAiQuickFixes === true;
  const list = document.createElement('div');
  list.className = 'problems-list';

  for (const p of problems) {
    const item = document.createElement('div');
    item.className = 'problem-item';

    const metaBits = [];
    const rel = String(p.relPath || p.fileName || '').trim();
    metaBits.push(`${escapeHtml(rel || 'Untitled')} · L${p.startLineNumber}:${p.startColumn}`);
    if (p.source) metaBits.push(`${escapeHtml(p.source)}`);
    if (p.code) metaBits.push(`${escapeHtml(p.code)}`);

    item.innerHTML = `
      <div class="problem-left">
        <div class="problem-sev ${escapeHtml(p.severity)}"></div>
        <div class="problem-text">
          <div class="problem-message">${escapeHtml(p.message || '(no message)')}</div>
          <div class="problem-meta">${metaBits.join(' · ')}</div>
        </div>
      </div>
      <div class="problem-actions"></div>
    `;

    const actions = item.querySelector('.problem-actions');
    if (actions && aiEnabled) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'problem-action-btn';
      btn.textContent = 'Fix with AI';
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { await jumpToProblem(p); } catch { /* ignore */ }
        try { prefillChatForProblemFix(p); } catch { /* ignore */ }
      });
      actions.appendChild(btn);
    }

    item.addEventListener('click', async () => {
      await jumpToProblem(p);
    });

    list.appendChild(item);
  }

  content.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'problems-container';
  wrap.appendChild(list);
  content.appendChild(wrap);
}


function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.style.display = 'none';
  contextMenuTarget = null;
  contextMenuPath = null;
  contextMenuIsFolder = false;
}


function hideChatTabContextMenu() {
  const menu = document.getElementById('chatTabContextMenu');
  if (menu) menu.style.display = 'none';
  chatTabContextSessionId = null;
}


function closeChatSessionsPopover() {
  const pop = document.getElementById('chatSessionsPopover');
  if (!pop) return;
  pop.style.display = 'none';
  pop.style.visibility = '';
}


function openChatSessionsPopover() {
  const pop = document.getElementById('chatSessionsPopover');
  if (!pop) return;
  // Portal the popover to <body> so it can never affect layout or be clipped by panel containers
  if (pop.parentElement !== document.body) {
    document.body.appendChild(pop);
  }

  pop.style.display = 'block';
  pop.style.visibility = 'hidden';

  // Re-render list on open (may change popover size)
  renderChatDropdown();

  // Position near trigger, clamped to viewport (fixed popover)
  const trigger = document.getElementById('chatSessionsTrigger');
  if (trigger) {
    const rect = trigger.getBoundingClientRect();
    const pad = 10;
    const desiredLeft = rect.left;
    const desiredTop = rect.bottom + 8;

    // Measure after showing
    const popRect = pop.getBoundingClientRect();
    let left = desiredLeft;
    let top = desiredTop;

    if (left + popRect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - popRect.width - pad);
    }
    if (left < pad) left = pad;
    if (top + popRect.height > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - popRect.height - 8);
    }
    if (top < pad) top = pad;

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  const input = document.getElementById('chatSessionsSearchInput');
  if (input) {
    input.value = chatSessionsSearchQuery || '';
    setTimeout(() => {
      try { input.focus(); input.select(); } catch { /* ignore */ }
    }, 0);
  }
  pop.style.visibility = 'visible';
}


function toggleChatSessionsPopover() {
  const pop = document.getElementById('chatSessionsPopover');
  if (!pop) return;
  const open = pop.style.display !== 'none' && pop.style.display !== '';
  if (open) closeChatSessionsPopover();
  else openChatSessionsPopover();
}


function closeAssistantToolsPopover() {
  const pop = document.getElementById('assistantToolsPopover');
  if (!pop) return;
  pop.style.display = 'none';
}


function openAssistantToolsPopover() {
  const pop = document.getElementById('assistantToolsPopover');
  if (!pop) return;

  // Portal to <body> so it never affects layout
  if (pop.parentElement !== document.body) {
    document.body.appendChild(pop);
  }

  pop.style.display = 'block';

  const trigger = document.getElementById('assistantToolsButton');
  if (trigger) {
    const rect = trigger.getBoundingClientRect();
    const width = pop.offsetWidth || 420;
    const height = pop.offsetHeight || 320;

    // Prefer right-aligned under header actions
    let left = Math.round(rect.right - width);
    let top = Math.round(rect.bottom + 8);

    const pad = 10;
    const maxLeft = window.innerWidth - width - pad;
    const maxTop = window.innerHeight - height - pad;
    left = Math.max(pad, Math.min(left, maxLeft));
    top = Math.max(pad, Math.min(top, maxTop));

    pop.style.transform = `translate(${left}px, ${top}px)`;
  } else {
    pop.style.transform = `translate(12px, 64px)`;
  }

  // Keep button states accurate when opened
  try { updateImportExportButtonsForSession(currentSessionId); } catch { /* ignore */ }
  try { refreshSkillScriptsForSession(currentSessionId); } catch { /* ignore */ }
}


function toggleAssistantToolsPopover() {
  const pop = document.getElementById('assistantToolsPopover');
  if (!pop) return;
  const open = pop.style.display !== 'none' && pop.style.display !== '';
  if (open) closeAssistantToolsPopover();
  else openAssistantToolsPopover();
}
