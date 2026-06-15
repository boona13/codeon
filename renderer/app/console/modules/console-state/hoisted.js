// ---- GENERATED: hoisted declarations extracted from app/console/console-state.js ----
 // { [sessionId]: { type, title } }

function getConsoleMessages(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return [];
  const arr = consoleMessagesBySession[sid];
  return Array.isArray(arr) ? arr : [];
}


function setConsoleMessages(sessionId, next) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  consoleMessagesBySession[sid] = Array.isArray(next) ? next : [];
}


function setConsoleIndicatorState(sessionId, { type = 'idle', title = '' } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  consoleIndicatorBySession[sid] = { type: String(type || 'idle'), title: String(title || '') };
}


function getConsoleIndicatorState(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { type: 'idle', title: '' };
  const st = consoleIndicatorBySession[sid];
  if (st && typeof st === 'object') return { type: st.type || 'idle', title: st.title || '' };
  return { type: 'idle', title: '' };
}


function persistConsoleState(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  ensureMessageSeqInitialized(sid);
  const msgs = getConsoleMessages(sid).slice(-MAX_CONSOLE_MESSAGES_PER_SESSION);
  const ind = getConsoleIndicatorState(sid);
  const timeline = ensureSessionMessages(sid);
  // Replace previous console snapshot for this session (keep only latest).
  const next = timeline.filter(m => !(m && m.role === 'console_state'));
  next.push({
    role: 'console_state',
    timestamp: Date.now(),
    seq: nextMessageSeq(sid),
    messages: msgs,
    indicator: ind
  });
  replaceSessionMessages(sid, next);
  saveChatHistory(); // debounced
}

function schedulePersistConsoleState(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (consolePersistTimerBySession && consolePersistTimerBySession[sid]) return;
  if (!consolePersistTimerBySession || typeof consolePersistTimerBySession !== 'object') {
    // runtime should define this; guard anyway.
    consolePersistTimerBySession = {};
  }
  consolePersistTimerBySession[sid] = setTimeout(() => {
    try { persistConsoleState(sid); } catch { /* ignore */ }
    try { clearTimeout(consolePersistTimerBySession[sid]); } catch { /* ignore */ }
    try { delete consolePersistTimerBySession[sid]; } catch { /* ignore */ }
  }, (typeof CONSOLE_PERSIST_DEBOUNCE_MS === 'number' ? CONSOLE_PERSIST_DEBOUNCE_MS : 900));
}


function restoreConsoleForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const timeline = (chatSessions && chatSessions[sid] && Array.isArray(chatSessions[sid].messages))
    ? chatSessions[sid].messages
    : [];
  const snap = [...timeline].reverse().find(m => m && m.role === 'console_state' && Array.isArray(m.messages));
  const msgs = snap ? snap.messages : [];
  setConsoleMessages(sid, msgs.slice(-MAX_CONSOLE_MESSAGES_PER_SESSION));
  const ind = snap && snap.indicator && typeof snap.indicator === 'object' ? snap.indicator : { type: 'idle', title: '' };
  setConsoleIndicatorState(sid, { type: ind.type || 'idle', title: ind.title || '' });
}


function applyConsoleIndicatorForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  const state = getConsoleIndicatorState(sid);
  const consoleIndicator = document.querySelector('.console-indicator');
  if (!consoleIndicator) return;
  consoleIndicator.className = 'console-indicator';
  if (state.type && state.type !== 'idle') {
    consoleIndicator.classList.add(state.type);
  }
  consoleIndicator.title = state.title || '';
}


function renderConsoleForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  const consoleContent = document.getElementById('consoleContent');
  if (!consoleContent) return;
  consoleContent.innerHTML = '';
  const msgs = getConsoleMessages(sid);
  const frag = document.createDocumentFragment();
  for (const m of msgs) {
    if (!m) continue;
    const item = document.createElement('div');
    const type = String(m.type || 'info');
    const ts = typeof m.ts === 'number' ? m.ts : Date.now();
    const time = new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    item.className = `console-item ${type}`;
    item.innerHTML = `
      <span class="timestamp">[${time}]</span>
      <span class="content">${String(m.message || '')}</span>
    `;
    frag.appendChild(item);
  }
  consoleContent.appendChild(frag);
  consoleContent.scrollTop = consoleContent.scrollHeight;
  applyConsoleIndicatorForSession(sid);
}

function _isConsoleNearBottom(consoleContent) {
  try {
    const el = consoleContent;
    if (!el) return true;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distance = scrollHeight - (scrollTop + clientHeight);
    return distance <= 120;
  } catch {
    return true;
  }
}

function _flushConsoleDomForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid !== currentSessionId) return;
  const consoleContent = document.getElementById('consoleContent');
  if (!consoleContent) return;
  const pending = consolePendingDomBySession && Array.isArray(consolePendingDomBySession[sid])
    ? consolePendingDomBySession[sid]
    : [];
  if (pending.length === 0) return;
  consolePendingDomBySession[sid] = [];

  const shouldFollow = _isConsoleNearBottom(consoleContent);
  const frag = document.createDocumentFragment();
  for (const m of pending) {
    if (!m) continue;
    const item = document.createElement('div');
    const type = String(m.type || 'info');
    const ts = typeof m.ts === 'number' ? m.ts : Date.now();
    const time = new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    item.className = `console-item ${type}`;
    item.innerHTML = `
      <span class="timestamp">[${time}]</span>
      <span class="content">${String(m.message || '')}</span>
    `;
    frag.appendChild(item);
  }
  consoleContent.appendChild(frag);
  if (shouldFollow) {
    try { consoleContent.scrollTop = consoleContent.scrollHeight; } catch { /* ignore */ }
  }
  applyConsoleIndicatorForSession(sid);
}


function addConsoleMessageForSession(message, type = 'info', sessionId = currentSessionId, { persist = true } = {}) {
  const sid = String(sessionId || currentSessionId || '').trim();
  if (!sid) return;
  const arr = getConsoleMessages(sid).slice();
  arr.push({ ts: Date.now(), type: String(type || 'info'), message: String(message || '') });
  const bounded = arr.slice(-MAX_CONSOLE_MESSAGES_PER_SESSION);
  setConsoleMessages(sid, bounded);

  // Update indicator state for this session
  const indicatorType = (type === 'processing' || type === 'success' || type === 'error') ? type : 'idle';
  setConsoleIndicatorState(sid, { type: indicatorType, title: String(message || '') });

  // Render only if this is the active session (no bleed)
  if (sid === currentSessionId) {
    // PERF: batch DOM appends + scroll into a single rAF flush.
    if (!consolePendingDomBySession || typeof consolePendingDomBySession !== 'object') {
      consolePendingDomBySession = {};
    }
    if (!consolePendingDomBySession[sid] || !Array.isArray(consolePendingDomBySession[sid])) {
      consolePendingDomBySession[sid] = [];
    }
    consolePendingDomBySession[sid].push({ ts: Date.now(), type: String(type || 'info'), message: String(message || '') });

    if (!consoleRenderRafBySession || typeof consoleRenderRafBySession !== 'object') {
      consoleRenderRafBySession = {};
    }
    if (!consoleRenderRafBySession[sid]) {
      consoleRenderRafBySession[sid] = requestAnimationFrame(() => {
        try { consoleRenderRafBySession[sid] = 0; } catch { /* ignore */ }
        try { _flushConsoleDomForSession(sid); } catch { /* ignore */ }
      });
    }
  }

  if (persist) schedulePersistConsoleState(sid);
}


function getPendingAttachments(sessionId = currentSessionId) {
  if (!sessionId) return [];
  const arr = pendingAttachmentsBySession[sessionId];
  return Array.isArray(arr) ? arr : [];
}


function setPendingAttachments(sessionId, next) {
  if (!sessionId) return;
  pendingAttachmentsBySession[sessionId] = Array.isArray(next) ? next : [];
}


function normalizeTodoStatus(status) {
  if (status === 'in_progress') return 'in-progress';
  if (status === 'in-progress') return 'in-progress';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}


function setTodoList(todos, { persist = true } = {}) {
  const next = Array.isArray(todos) ? todos : [];
  currentTodoList = next.map(t => ({
    content: String(t?.content || '').trim(),
    status: normalizeTodoStatus(t?.status),
    activeForm: String(t?.activeForm || '')
  })).filter(t => t.content.length > 0);

  renderTodoList();

  if (persist && currentSessionId) {
    ensureMessageSeqInitialized(currentSessionId);
    const timeline = ensureSessionMessages(currentSessionId);
    // Replace previous todo state snapshot for this session (keep only latest).
    const nextTimeline = timeline.filter(m => !(m && m.role === 'todo_state'));
    nextTimeline.push({
      role: 'todo_state',
      todos: currentTodoList,
      timestamp: Date.now(),
      seq: nextMessageSeq(currentSessionId)
    });
    replaceSessionMessages(currentSessionId, nextTimeline);
    saveChatHistory(); // debounced
  }
}


function restoreTodosForSession(sessionId) {
  const msgs = (chatSessions && sessionId && chatSessions[sessionId] && Array.isArray(chatSessions[sessionId].messages))
    ? chatSessions[sessionId].messages
    : [];
  // Find latest todo snapshot for session
  const last = [...msgs].reverse().find(m => m && m.role === 'todo_state' && Array.isArray(m.todos));
  setTodoList(last ? last.todos : [], { persist: false });
}


function parseSimpleFrontmatterMarkdown(mdText) {
  const raw = String(mdText || '');
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const lines = raw.split('\n');
  if (lines.length < 3) return { meta: {}, body: raw };
  if (lines[0].trim() !== '---') return { meta: {}, body: raw };
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx < 0) return { meta: {}, body: raw };
  const metaLines = lines.slice(1, endIdx);
  const bodyLines = lines.slice(endIdx + 1);
  const meta = {};
  for (const l of metaLines) {
    const line = String(l || '');
    const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (!key) continue;
    meta[key] = val;
  }
  return { meta, body: bodyLines.join('\n') };
}


function flattenFileTreeEntries(entries) {
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


function getActiveAgentId(sessionId = currentSessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return '';
  const v = activeAgentIdBySession[sid];
  return typeof v === 'string' ? v : '';
}


function getActiveAgent(sessionId = currentSessionId) {
  const id = getActiveAgentId(sessionId);
  if (!id) return null;
  const a = Array.isArray(availableAgents) ? availableAgents.find(x => x && x.id === id) : null;
  return a || null;
}


function isUserAgentId(agentId) {
  return String(agentId || '').startsWith('user:');
}


function isProjectAgentId(agentId) {
  return String(agentId || '').startsWith('.claude/agents/');
}


function userAgentRelPath(agentId) {
  return String(agentId || '').replace(/^user:/, '');
}


function isUserSkillId(skillId) {
  return String(skillId || '').startsWith('user:');
}


function isProjectSkillId(skillId) {
  return String(skillId || '').startsWith('.claude/skills/');
}


function updateImportExportButtonsForSession(sessionId = currentSessionId) {
  const sid = String(sessionId || '').trim();
  const agentImportBtn = document.getElementById('agentImportButton');
  const agentExportBtn = document.getElementById('agentExportButton');
  const skillImportBtn = document.getElementById('skillImportButton');
  const skillExportBtn = document.getElementById('skillExportButton');

  const agentId = getActiveAgentId(sid);
  const agentImportEnabled = !!(agentId && isUserAgentId(agentId));
  const agentExportEnabled = !!(agentId && isProjectAgentId(agentId));
  if (agentImportBtn) { agentImportBtn.disabled = !agentImportEnabled; agentImportBtn.style.display = agentImportEnabled ? '' : 'none'; }
  if (agentExportBtn) { agentExportBtn.disabled = !agentExportEnabled; agentExportBtn.style.display = agentExportEnabled ? '' : 'none'; }

  const skillId = getPendingSkillId(sid);
  const skillImportEnabled = !!(skillId && isUserSkillId(skillId));
  const skillExportEnabled = !!(skillId && isProjectSkillId(skillId));
  if (skillImportBtn) { skillImportBtn.disabled = !skillImportEnabled; skillImportBtn.style.display = skillImportEnabled ? '' : 'none'; }
  if (skillExportBtn) { skillExportBtn.disabled = !skillExportEnabled; skillExportBtn.style.display = skillExportEnabled ? '' : 'none'; }
}


function renderAgentSelectForSession(sessionId = currentSessionId) {
  const select = document.getElementById('agentSelect');
  if (!select) return;

  const current = getActiveAgentId(sessionId);
  const agents = Array.isArray(availableAgents) ? availableAgents.slice() : [];

  // Rebuild options (small list; simplest and avoids stale DOM).
  select.innerHTML = '';
  const optDefault = document.createElement('option');
  optDefault.value = '';
  optDefault.textContent = 'Default agent';
  select.appendChild(optDefault);

  for (const a of agents) {
    if (!a || typeof a !== 'object') continue;
    const opt = document.createElement('option');
    opt.value = String(a.id || '');
    opt.textContent = String(a.name || a.id || 'Agent');
    select.appendChild(opt);
  }

  select.value = current || '';
}


function setActiveAgentForSession(sessionId, agentId, { persist = true } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const id = String(agentId || '').trim();
  activeAgentIdBySession[sid] = id;
  if (sid === currentSessionId) renderAgentSelectForSession(sid);
  if (sid === currentSessionId) updateImportExportButtonsForSession(sid);
  if (sid === currentSessionId) renderAgentPillForSession(sid);

  if (!persist) return;
  try {
    ensureMessageSeqInitialized(sid);
    const timeline = ensureSessionMessages(sid);
    const nextTimeline = timeline.filter(m => !(m && m.role === 'agent_state'));
    nextTimeline.push({
      role: 'agent_state',
      agentId: id || '',
      timestamp: Date.now(),
      seq: nextMessageSeq(sid)
    });
    replaceSessionMessages(sid, nextTimeline);
    saveChatHistory(); // debounced
  } catch {
    // ignore
  }
}


function renderAgentPillForSession(sessionId = currentSessionId) {
  const pillArea = document.getElementById('agentPillArea');
  if (!pillArea) return;
  
  const agentId = getActiveAgentId(sessionId);
  const agent = agentId ? getActiveAgent(sessionId) : null;
  
  if (!agent) {
    pillArea.style.display = 'none';
    pillArea.innerHTML = '';
    return;
  }
  
  const escapeHtml = (str) => String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeAttr = (str) => String(str || '').replace(/"/g, '&quot;');
  
  const displayName = String(agent.name || 'Agent').trim();
  const description = String(agent.description || '').trim();
  
  pillArea.style.display = 'flex';
  pillArea.innerHTML = `
    <div class="agent-pill-item" title="${escapeAttr(description || displayName)}">
      <span class="agent-pill-badge">Agent</span>
      <span class="agent-pill-name">${escapeHtml(displayName)}</span>
      <button class="agent-pill-remove" data-agent-id="${escapeAttr(agent.id)}" title="Remove agent">×</button>
    </div>
  `;
  
  // Add remove handler
  const removeBtn = pillArea.querySelector('.agent-pill-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setActiveAgentForSession(sessionId, '', { persist: true });
    });
  }
}


function restoreAgentForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const msgs = (chatSessions && chatSessions[sid] && Array.isArray(chatSessions[sid].messages))
    ? chatSessions[sid].messages
    : [];
  const last = [...msgs].reverse().find(m => m && m.role === 'agent_state' && typeof m.agentId === 'string');
  const agentId = last ? String(last.agentId || '').trim() : '';
  activeAgentIdBySession[sid] = agentId;
  if (sid === currentSessionId) renderAgentSelectForSession(sid);
  if (sid === currentSessionId) renderAgentPillForSession(sid);
}


async function loadProjectAgents() {
  availableAgents = [];
  if (!window.electronAPI || typeof window.electronAPI.listDir !== 'function' || typeof window.electronAPI.readFile !== 'function') {
    renderAgentSelectForSession(currentSessionId);
    return;
  }
  if (!currentFolder) {
    renderAgentSelectForSession(currentSessionId);
    return;
  }

  // Project-scoped agents live in `.claude/agents/*.md`
  const res = await window.electronAPI.listDir('.claude/agents', { maxDepth: 4 });
  if (!res || res.success !== true || !Array.isArray(res.files)) {
    renderAgentSelectForSession(currentSessionId);
    return;
  }
  const entries = flattenFileTreeEntries(res.files);
  const mdFiles = entries
    .filter(e => e && e.type === 'file' && typeof e.path === 'string' && e.path.toLowerCase().endsWith('.md'))
    .map(e => e.path);

  const agents = [];
  for (const p of mdFiles.slice(0, 60)) {
    try {
      // `p` is relative to `.claude/agents` base in listDirectory; build a project-relative path.
      const rel = `.claude/agents/${String(p || '').replace(/^\.?\//, '')}`;
      const rr = await window.electronAPI.readFile(rel);
      if (!rr || rr.success !== true || typeof rr.content !== 'string') continue;
      const { meta, body } = parseSimpleFrontmatterMarkdown(rr.content);
      const name = String(meta.name || meta.title || '').trim() || String(p).replace(/\.md$/i, '');
      const description = String(meta.description || '').trim();
      const instructions = String(body || '').trim();
      const id = rel;
      agents.push({ id, name, description, instructions, sourcePath: rel });
    } catch {
      // ignore bad agent file
    }
  }

  agents.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  // Merge user-level agents (~/.claude/agents) after project-level ones
  let userAgents = [];
  try { userAgents = await loadUserAgents(); } catch { userAgents = []; }
  availableAgents = [...agents, ...(Array.isArray(userAgents) ? userAgents : [])];
  renderAgentSelectForSession(currentSessionId);
}


async function loadUserAgents() {
  if (!window.electronAPI || typeof window.electronAPI.userClaudeListAgents !== 'function' || typeof window.electronAPI.userClaudeReadAgent !== 'function') {
    return [];
  }
  const res = await window.electronAPI.userClaudeListAgents();
  if (!res || res.success !== true || !Array.isArray(res.files)) return [];
  const entries = flattenFileTreeEntries(res.files);
  const mdFiles = entries
    .filter(e => e && e.type === 'file' && typeof e.path === 'string' && e.path.toLowerCase().endsWith('.md'))
    .map(e => e.path);

  const agents = [];
  for (const p of mdFiles.slice(0, 80)) {
    try {
      const rr = await window.electronAPI.userClaudeReadAgent(p);
      if (!rr || rr.success !== true || typeof rr.content !== 'string') continue;
      const { meta, body } = parseSimpleFrontmatterMarkdown(rr.content);
      const name = String(meta.name || meta.title || '').trim() || String(p).replace(/\.md$/i, '');
      const description = String(meta.description || '').trim();
      const instructions = String(body || '').trim();
      const id = `user:${p}`;
      agents.push({ id, name, description, instructions, sourcePath: `~/.claude/agents/${p}` });
    } catch {
      // ignore
    }
  }
  agents.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return agents;
}


function applyActiveAgentToPrompt(sessionId, userPrompt) {
  const p = String(userPrompt || '');
  const agent = getActiveAgent(sessionId);
  if (!agent || !agent.instructions) return p;
  const name = String(agent.name || 'Agent').trim();
  const instructions = String(agent.instructions || '').trim();
  if (!instructions) return p;

  // Keep bounded to avoid exploding prompt size.
  const maxChars = 12_000;
  const bounded = instructions.length > maxChars ? instructions.slice(0, maxChars) + '\n…(truncated)…' : instructions;
  return (
    `ACTIVE AGENT: ${name}\n` +
    `---\n` +
    `${bounded}\n` +
    `---\n\n` +
    p
  );
}


function getPendingSkillId(sessionId = currentSessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return '';
  const v = pendingSkillIdBySession[sid];
  return typeof v === 'string' ? v : '';
}


function getPendingSkill(sessionId = currentSessionId) {
  const id = getPendingSkillId(sessionId);
  if (!id) return null;
  const s = Array.isArray(availableSkills) ? availableSkills.find(x => x && x.id === id) : null;
  return s || null;
}


function setPendingSkillForSession(sessionId, skillId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const id = String(skillId || '').trim();
  pendingSkillIdBySession[sid] = id;
  if (sid === currentSessionId) renderSkillSelectForSession(sid);
  if (sid === currentSessionId) updateImportExportButtonsForSession(sid);
  if (sid === currentSessionId) renderSkillPillForSession(sid);
  refreshSkillScriptsForSession(sid).catch(() => {});
}


function clearPendingSkillForSession(sessionId) {
  setPendingSkillForSession(sessionId, '');
}


function renderSkillPillForSession(sessionId = currentSessionId) {
  const pillArea = document.getElementById('skillPillArea');
  if (!pillArea) return;
  
  const skillId = getPendingSkillId(sessionId);
  const skill = skillId ? getPendingSkill(sessionId) : null;
  
  if (!skill) {
    pillArea.style.display = 'none';
    pillArea.innerHTML = '';
    return;
  }
  
  const escapeHtml = (str) => String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeAttr = (str) => String(str || '').replace(/"/g, '&quot;');
  
  const displayName = String(skill.name || 'Skill').trim();
  const description = String(skill.description || '').trim();
  
  pillArea.style.display = 'flex';
  pillArea.innerHTML = `
    <div class="skill-pill-item" title="${escapeAttr(description || displayName)}">
      <span class="skill-pill-badge">Skill</span>
      <span class="skill-pill-name">${escapeHtml(displayName)}</span>
      <button class="skill-pill-remove" data-skill-id="${escapeAttr(skill.id)}" title="Remove skill">×</button>
    </div>
  `;
  
  // Add remove handler
  const removeBtn = pillArea.querySelector('.skill-pill-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearPendingSkillForSession(sessionId);
    });
  }
}


function renderSkillSelectForSession(sessionId = currentSessionId) {
  const select = document.getElementById('skillSelect');
  if (!select) return;
  const current = getPendingSkillId(sessionId);
  const skills = Array.isArray(availableSkills) ? availableSkills.slice() : [];

  select.innerHTML = '';
  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = 'No skill';
  select.appendChild(optNone);

  for (const s of skills) {
    if (!s || typeof s !== 'object') continue;
    const opt = document.createElement('option');
    opt.value = String(s.id || '');
    opt.textContent = String(s.name || s.id || 'Skill');
    select.appendChild(opt);
  }
  select.value = current || '';
}


function tokenizeForSuggestions(text) {
  const raw = String(text || '').toLowerCase();
  const words = raw.split(/[^a-z0-9_]+/g).map(w => w.trim()).filter(Boolean);
  const stop = new Set(['the','a','an','and','or','to','for','of','in','on','with','without','is','are','be','as','at','it','this','that','i','we','you','please','can','could','should','would','help']);
  return words.filter(w => w.length >= 3 && !stop.has(w)).slice(0, 50);
}


function scoreSkillForText(skill, tokens) {
  if (!skill || typeof skill !== 'object') return 0;
  const hay = `${skill.name || ''}\n${skill.description || ''}\n${skill.instructions || ''}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (hay.includes(t)) score += 1;
  }
  return score;
}


function computeSkillSuggestions(text, { limit = 4 } = {}) {
  const tokens = tokenizeForSuggestions(text);
  if (tokens.length === 0) return [];
  const skills = Array.isArray(availableSkills) ? availableSkills.slice() : [];
  const ranked = skills
    .map(s => ({ skill: s, score: scoreSkillForText(s, tokens) }))
    .filter(x => x.score > 0 && x.skill && x.skill.id)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.skill);
  return ranked;
}


function renderSkillSuggestionsForText(text, sessionId = currentSessionId) {
  const sid = String(sessionId || '').trim();
  const wrap = document.getElementById('skillSuggestions');
  if (!wrap) return;

  // If a skill is already selected for next message, hide suggestions.
  if (getPendingSkillId(sid)) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  const suggestions = computeSkillSuggestions(text, { limit: 4 });
  if (!suggestions || suggestions.length === 0) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  wrap.style.display = '';
  wrap.innerHTML = `
    <div class="skill-suggestions-title">Suggested skills</div>
    <div class="skill-suggestions-row" id="skillSuggestionsRow"></div>
  `;
  const row = document.getElementById('skillSuggestionsRow');
  if (!row) return;
  for (const s of suggestions) {
    const chip = document.createElement('div');
    chip.className = 'skill-suggestion-chip';
    chip.textContent = String(s.name || 'Skill');
    chip.title = s.description ? String(s.description) : '';
    chip.addEventListener('click', () => {
      try {
        setPendingSkillForSession(sid, String(s.id || ''));
        const select = document.getElementById('skillSelect');
        if (select) select.value = String(s.id || '');
        wrap.style.display = 'none';
        wrap.innerHTML = '';
      } catch {
        // ignore
      }
    });
    row.appendChild(chip);
  }
}


async function loadProjectSkills() {
  availableSkills = [];
  const skills = [];

  // Load project-level skills (only if a project folder is open)
  if (window.electronAPI && typeof window.electronAPI.listDir === 'function' && typeof window.electronAPI.readFile === 'function' && currentFolder) {
    try {
      const res = await window.electronAPI.listDir('.claude/skills', { maxDepth: 6 });
      if (res && res.success === true && Array.isArray(res.files)) {
        const entries = flattenFileTreeEntries(res.files);
        const skillMd = entries.filter(e => {
          if (!e || e.type !== 'file') return false;
          const name = typeof e.name === 'string' ? e.name.toLowerCase() : '';
          return name === 'skill.md';
        });

        for (const e of skillMd.slice(0, 80)) {
          try {
            const relFile = `.claude/skills/${String(e.path || '').replace(/^\.?\//, '')}`;
            const rr = await window.electronAPI.readFile(relFile);
            if (!rr || rr.success !== true || typeof rr.content !== 'string') continue;
            const { meta, body } = parseSimpleFrontmatterMarkdown(rr.content);
            const filePathParts = String(e.path || '').split('/').filter(Boolean);
            const dirName = filePathParts.length >= 2 ? filePathParts[filePathParts.length - 2] : 'Skill';
            const skillDir = filePathParts.length >= 2 ? filePathParts.slice(0, -1).join('/') : dirName;
            const id = `.claude/skills/${skillDir}`;
            const name = String(meta.name || meta.title || '').trim() || dirName;
            const description = String(meta.description || '').trim();
            const whenToUse = String(meta.when_to_use || meta.whenToUse || '').trim();
            const instructions = String(body || '').trim();
            skills.push({ id, name, description, whenToUse, instructions, skillFilePath: relFile });
          } catch {
            // ignore invalid skill
          }
        }
      }
    } catch {
      // ignore project skill loading errors
    }
  }

  skills.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  // ALWAYS load user-level skills (~/.claude/skills) regardless of project state
  let userSkills = [];
  try {
    userSkills = await loadUserSkills();
  } catch {
    userSkills = [];
  }

  availableSkills = [...skills, ...(Array.isArray(userSkills) ? userSkills : [])];
  renderSkillSelectForSession(currentSessionId);
}


async function loadUserSkills() {
  if (!window.electronAPI || typeof window.electronAPI.userClaudeListSkills !== 'function' || typeof window.electronAPI.userClaudeReadSkillMd !== 'function') {
    return [];
  }
  const res = await window.electronAPI.userClaudeListSkills();
  if (!res || res.success !== true || !Array.isArray(res.files)) return [];

  const entries = flattenFileTreeEntries(res.files);
  const skillMdEntries = entries.filter(e => {
    if (!e || e.type !== 'file') return false;
    const name = typeof e.name === 'string' ? e.name.toLowerCase() : '';
    return name === 'skill.md';
  });

  const skills = [];
  for (const e of skillMdEntries.slice(0, 120)) {
    try {
      const relSkillMd = String(e.path || '').replace(/^\.?\//, '');
      const rr = await window.electronAPI.userClaudeReadSkillMd(relSkillMd);
      if (!rr || rr.success !== true || typeof rr.content !== 'string') continue;
      const { meta, body } = parseSimpleFrontmatterMarkdown(rr.content);
      const parts = relSkillMd.split('/').filter(Boolean);
      const dirName = parts.length >= 2 ? parts[parts.length - 2] : 'Skill';
      const skillDir = parts.length >= 2 ? parts.slice(0, -1).join('/') : dirName;
      const id = `user:${skillDir}`;
      const name = String(meta.name || meta.title || '').trim() || dirName;
      const description = String(meta.description || '').trim();
      const whenToUse = String(meta.when_to_use || meta.whenToUse || '').trim();
      const instructions = String(body || '').trim();
      console.log(`[Skills] Loaded user skill: id="${id}", name="${name}"`);
      skills.push({ id, name, description, whenToUse, instructions, skillFilePath: `~/.claude/skills/${relSkillMd}` });
    } catch {
      // ignore
    }
  }

  skills.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return skills;
}


function applySkillByIdToPrompt(skillId, userPrompt) {
  const p = String(userPrompt || '');
  const id = String(skillId || '').trim();
  if (!id) {
    console.log('[Skills] applySkillByIdToPrompt: no skillId provided');
    return p;
  }
  const skill = Array.isArray(availableSkills) ? availableSkills.find(s => s && s.id === id) : null;
  if (!skill) {
    console.warn('[Skills] applySkillByIdToPrompt: skill not found', { skillId: id });
    return p;
  }
  // Use folder name for AI (more consistent/predictable), display name for UI
  const folderName = skillIdToProjectSkillDir(id) || String(skill.name || 'Skill').trim();
  console.log(`[Skills] Applying skill directive: "use ${folderName} skill"`);
  // Simple directive - Claude already has skill summaries in context
  return `use ${folderName} skill\n\n${p}`;
}


function getToolReceiptsForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !chatSessions || !chatSessions[sid]) return [];
  const msgs = ensureSessionMessages(sid);
  return Array.isArray(msgs) ? msgs.filter(m => m && m.role === 'tool_receipt') : [];
}


function clearReceiptsForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !chatSessions || !chatSessions[sid]) return;
  const msgs = ensureSessionMessages(sid);
  const next = Array.isArray(msgs) ? msgs.filter(m => !(m && m.role === 'tool_receipt')) : [];
  replaceSessionMessages(sid, next);
  saveChatHistory(true).catch(() => {});
  renderReceiptsForSession(sid);
  window.addConsoleMessage?.('Receipts cleared', 'info', sid);
}


function renderReceiptsForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  const listEl = document.getElementById('receiptsList');
  const searchEl = document.getElementById('receiptsSearchInput');
  const filterEl = document.getElementById('receiptsToolFilter');
  if (!listEl) return;

  const receipts = getToolReceiptsForSession(sid);

  // Populate tool filter options based on session receipts
  if (filterEl) {
    const current = String(filterEl.value || '');
    const toolNames = [...new Set(receipts.map(r => String(r.toolName || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    filterEl.innerHTML = '';
    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = 'All tools';
    filterEl.appendChild(optAll);
    for (const t of toolNames) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      filterEl.appendChild(opt);
    }
    // Restore selection if possible
    filterEl.value = toolNames.includes(current) ? current : '';
  }

  const q = searchEl ? String(searchEl.value || '').trim().toLowerCase() : '';
  const toolFilter = filterEl ? String(filterEl.value || '') : '';

  const filtered = receipts.filter(r => {
    if (toolFilter && String(r.toolName || '') !== toolFilter) return false;
    if (!q) return true;
    const preview = String(r.preview || '');
    const toolName = String(r.toolName || '');
    const receipt = r && typeof r.receipt === 'object' ? r.receipt : null;
    const cwd = receipt && typeof receipt.cwd === 'string' ? receipt.cwd : '';
    const net = receipt && receipt.networkPolicy && typeof receipt.networkPolicy === 'object' ? receipt.networkPolicy : null;
    const netMode = net && typeof net.mode === 'string' ? net.mode : '';
    const allowlist = net && Array.isArray(net.allowlist) ? net.allowlist.join(',') : '';
    const hay = `${toolName}\n${preview}\n${cwd}\n${netMode}\n${allowlist}`.toLowerCase();
    return hay.includes(q);
  });

  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const div = document.createElement('div');
    div.className = 'receipt-empty';
    div.textContent = receipts.length === 0 ? 'No receipts yet for this chat session.' : 'No receipts match your filter.';
    listEl.appendChild(div);
    return;
  }

  // Show newest first
  const sorted = filtered.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  for (const r of sorted.slice(0, 600)) {
    const toolName = String(r.toolName || 'Tool');
    const when = typeof r.timestamp === 'number' ? new Date(r.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const receipt = r && typeof r.receipt === 'object' ? r.receipt : null;
    const cwd = receipt && typeof receipt.cwd === 'string' ? receipt.cwd : '';
    const exitCode = receipt && typeof receipt.exitCode === 'number' ? receipt.exitCode : null;
    const net = receipt && receipt.networkPolicy && typeof receipt.networkPolicy === 'object' ? receipt.networkPolicy : null;
    const netMode = net && typeof net.mode === 'string' ? net.mode : '';

    const metaLines = [];
    if (r.toolUseId) metaLines.push(`toolUseId: ${r.toolUseId}`);
    if (cwd) metaLines.push(`cwd: ${cwd}`);
    if (typeof exitCode === 'number') metaLines.push(`exitCode: ${exitCode}`);
    if (netMode) metaLines.push(`network: ${netMode}`);
    if (r.preview) metaLines.push(`preview: ${String(r.preview)}`);

    const item = document.createElement('div');
    item.className = 'receipt-item';
    item.innerHTML = `
      <div class="receipt-title">
        <span>${escapeHtml(toolName)}</span>
        <span style="opacity:0.7; font-weight:400;">${escapeHtml(when)}</span>
      </div>
      <div class="receipt-meta">${escapeHtml(metaLines.join('\n'))}</div>
    `;
    listEl.appendChild(item);
  }
}


function renderTodoList() {
  const listEl = document.getElementById('tasksList');
  const pendingEl = document.getElementById('tasksPending');
  const inProgressEl = document.getElementById('tasksInProgress');
  const completedEl = document.getElementById('tasksCompleted');
  const badgeEl = document.querySelector('.console-tab[data-tab="tasks"] .todo-badge');

  if (!listEl || !pendingEl || !inProgressEl || !completedEl) return;

  const pending = currentTodoList.filter(t => t.status === 'pending').length;
  const inProgress = currentTodoList.filter(t => t.status === 'in-progress').length;
  const completed = currentTodoList.filter(t => t.status === 'completed').length;

  pendingEl.textContent = String(pending);
  inProgressEl.textContent = String(inProgress);
  completedEl.textContent = String(completed);

  const openCount = pending + inProgress;
  if (badgeEl) {
    badgeEl.textContent = String(openCount);
    badgeEl.style.display = openCount > 0 ? '' : 'none';
  }

  if (currentTodoList.length === 0) {
    listEl.innerHTML = `
      <div class="tasks-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px; opacity: 0.3;">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <p>No tasks yet</p>
        <span>Tasks will appear here when the AI uses Claude Code's Todo tool</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  currentTodoList.forEach((t, idx) => {
    const div = document.createElement('div');
    const statusClass = t.status;
    let icon = '•';
    if (statusClass === 'in-progress') icon = '⟳';
    if (statusClass === 'completed') icon = '✓';
    if (statusClass === 'cancelled') icon = '⨯';

    div.className = `task-item ${statusClass}`;
    div.innerHTML = `
      <div class="task-icon">${icon}</div>
      <div class="task-content">
        <div class="task-text">${escapeHtml(t.content)}</div>
        <div class="task-id">#${idx + 1}${t.activeForm ? ` · ${escapeHtml(t.activeForm)}` : ''}</div>
      </div>
    `;
    listEl.appendChild(div);
  });
}

function initConsoleTabsAndTasks() {
  const tabs = Array.from(document.querySelectorAll('.console-tab'));
  const logContent = document.getElementById('consoleContent');
  const tasksContent = document.getElementById('tasksContent');
  const receiptsContent = document.getElementById('receiptsContent');
  const terminalContent = document.getElementById('terminalContent');
  const problemsContent = document.getElementById('problemsContent');

  if (tabs.length > 0 && logContent && tasksContent && receiptsContent) {
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const target = tab.getAttribute('data-tab');
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        logContent.classList.remove('active');
        tasksContent.classList.remove('active');
        receiptsContent.classList.remove('active');
        try { terminalContent?.classList?.remove?.('active'); } catch { /* ignore */ }
        try { problemsContent?.classList?.remove?.('active'); } catch { /* ignore */ }

        if (target === 'tasks') {
          tasksContent.classList.add('active');
        } else if (target === 'receipts') {
          receiptsContent.classList.add('active');
          try { renderReceiptsForSession(currentSessionId); } catch { /* ignore */ }
        } else if (target === 'terminal') {
          if (terminalContent) terminalContent.classList.add('active');
          try { window.codeonTerminalPanel?.onTabActivated?.(); } catch { /* ignore */ }
        } else if (target === 'problems') {
          if (problemsContent) problemsContent.classList.add('active');
          try { renderProblemsView(); } catch { /* ignore */ }
          // Kick off a project-wide scan (debounced) so badge/results stay updated even when not on this tab.
          try { scheduleProjectProblemsScan('opened-problems'); } catch { /* ignore */ }
        } else {
          logContent.classList.add('active');
        }
      });
    });
  }

  const tasksClear = document.getElementById('tasksClear');
  if (tasksClear) {
    tasksClear.addEventListener('click', (e) => {
      e.preventDefault();
      setTodoList([], { persist: true });
      window.addConsoleMessage?.('Tasks cleared', 'info', currentSessionId);
    });
  }

  const receiptsSearch = document.getElementById('receiptsSearchInput');
  if (receiptsSearch) {
    receiptsSearch.addEventListener('input', () => {
      try { renderReceiptsForSession(currentSessionId); } catch { /* ignore */ }
    });
  }
  const receiptsFilter = document.getElementById('receiptsToolFilter');
  if (receiptsFilter) {
    receiptsFilter.addEventListener('change', () => {
      try { renderReceiptsForSession(currentSessionId); } catch { /* ignore */ }
    });
  }
  const receiptsClear = document.getElementById('receiptsClear');
  if (receiptsClear) {
    receiptsClear.addEventListener('click', (e) => {
      e.preventDefault();
      try { clearReceiptsForSession(currentSessionId); } catch { /* ignore */ }
    });
  }
}

// ========== MESSAGE QUEUE ==========
// Queue follow-up messages while AI is running

function getMessageQueue(sessionId = currentSessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return [];
  const arr = messageQueueBySession[sid];
  return Array.isArray(arr) ? arr : [];
}

function setMessageQueue(sessionId, queue) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  messageQueueBySession[sid] = Array.isArray(queue) ? queue : [];
}

function addToMessageQueue(sessionId, text, attachments = []) {
  const sid = String(sessionId || '').trim();
  if (!sid || !text) return null;
  
  const id = `mq_${++messageQueueIdCounter}_${Date.now()}`;
  const item = {
    id,
    text: String(text).trim(),
    attachments: Array.isArray(attachments) ? attachments : [],
    createdAt: Date.now()
  };
  
  const queue = getMessageQueue(sid);
  queue.push(item);
  setMessageQueue(sid, queue);
  
  renderMessageQueueUI(sid);
  return item;
}

function removeFromMessageQueue(sessionId, itemId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !itemId) return;
  
  const queue = getMessageQueue(sid);
  const idx = queue.findIndex(m => m.id === itemId);
  if (idx >= 0) {
    queue.splice(idx, 1);
    setMessageQueue(sid, queue);
    renderMessageQueueUI(sid);
  }
}

function editMessageInQueue(sessionId, itemId, newText) {
  const sid = String(sessionId || '').trim();
  if (!sid || !itemId) return;
  
  const queue = getMessageQueue(sid);
  const item = queue.find(m => m.id === itemId);
  if (item) {
    item.text = String(newText || '').trim();
    setMessageQueue(sid, queue);
    renderMessageQueueUI(sid);
  }
}

function reorderMessageInQueue(sessionId, itemId, direction) {
  const sid = String(sessionId || '').trim();
  if (!sid || !itemId) return;
  
  const queue = getMessageQueue(sid);
  const idx = queue.findIndex(m => m.id === itemId);
  if (idx < 0) return;
  
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= queue.length) return;
  
  // Swap
  [queue[idx], queue[newIdx]] = [queue[newIdx], queue[idx]];
  setMessageQueue(sid, queue);
  renderMessageQueueUI(sid);
}

function clearMessageQueue(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  setMessageQueue(sid, []);
  renderMessageQueueUI(sid);
}

function shiftMessageQueue(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  
  const queue = getMessageQueue(sid);
  if (!queue.length) return null;
  
  const item = queue.shift();
  setMessageQueue(sid, queue);
  renderMessageQueueUI(sid);
  return item;
}

const _queueDeferTimersBySession = Object.create(null);

function _getPendingDocsEntryForSession(sessionId) {
  try {
    const sid = String(sessionId || '').trim();
    const ds = window._docsState;
    if (!sid || !ds || typeof ds.getEntriesForProject !== 'function' || typeof ds.getProjectId !== 'function') return null;
    if (typeof ds.isDocsEnabled === 'function' && ds.isDocsEnabled(sid) !== true) return null;
    const pid = String(ds.getProjectId() || '').trim();
    if (!pid) return null;
    const entries = ds.getEntriesForProject(pid) || [];
    return entries.find(e => e && e.sessionId === sid && (e.status === 'pending' || e.status === 'generating')) || null;
  } catch {
    return null;
  }
}

function _shouldDeferQueueForDocs(sessionId) {
  const pending = _getPendingDocsEntryForSession(sessionId);
  if (!pending) return false;
  const learningBusy = !!(window._learningState?.isGenerating?.() === true);
  const docsBusy = !!(window._docsState?.isGenerating?.() === true);
  // If docs are pending or generating (often waiting on learning), defer queued send.
  return pending.status === 'pending' || pending.status === 'generating' || learningBusy || docsBusy;
}

function _scheduleQueueRetry(sessionId, delayMs = 1000) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (_queueDeferTimersBySession[sid]) return;
  _queueDeferTimersBySession[sid] = setTimeout(() => {
    delete _queueDeferTimersBySession[sid];
    processMessageQueueAfterRunComplete(sid);
  }, delayMs);
}

function renderMessageQueueUI(sessionId = currentSessionId) {
  const sid = String(sessionId || currentSessionId || '').trim();
  const container = document.getElementById('messageQueueContainer');
  if (!container) return;
  
  const queue = getMessageQueue(sid);
  
  if (!queue || queue.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  
  container.style.display = 'block';
  
  const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };
  
  const truncate = (str, len = 80) => {
    const s = String(str || '').trim().replace(/\n/g, ' '); // Replace newlines with spaces for preview
    return s.length > len ? s.slice(0, len) + '…' : s;
  };
  
  let html = `
    <div class="message-queue-header" id="messageQueueHeader">
      <span class="queue-toggle-icon">▼</span>
      <span class="queue-count">${queue.length} Queued</span>
    </div>
    <div class="message-queue-items" id="messageQueueItems">
  `;
  
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const canMoveUp = i > 0;
    const canMoveDown = i < queue.length - 1;
    
    html += `
      <div class="message-queue-item" data-id="${item.id}">
        <span class="queue-item-radio"></span>
        <span class="queue-item-text" title="${escapeHtml(item.text)}">${escapeHtml(truncate(item.text))}</span>
        <div class="queue-item-actions">
          <button class="queue-action-btn queue-send-now" data-id="${item.id}" title="Send now (abort current)">
            ↵ send now
          </button>
          <button class="queue-action-btn queue-edit" data-id="${item.id}" title="Edit message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="queue-action-btn queue-move-up ${canMoveUp ? '' : 'disabled'}" data-id="${item.id}" title="Move up" ${canMoveUp ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="18 15 12 9 6 15"/>
            </svg>
          </button>
          <button class="queue-action-btn queue-move-down ${canMoveDown ? '' : 'disabled'}" data-id="${item.id}" title="Move down" ${canMoveDown ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <button class="queue-action-btn queue-delete" data-id="${item.id}" title="Remove from queue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }
  
  html += '</div>';
  container.innerHTML = html;
  
  // Wire up event listeners
  wireMessageQueueEvents(sid);
}

function wireMessageQueueEvents(sessionId) {
  const container = document.getElementById('messageQueueContainer');
  if (!container) return;
  
  // Toggle collapse
  const header = container.querySelector('#messageQueueHeader');
  const items = container.querySelector('#messageQueueItems');
  if (header && items) {
    header.addEventListener('click', () => {
      items.classList.toggle('collapsed');
      const icon = header.querySelector('.queue-toggle-icon');
      if (icon) icon.textContent = items.classList.contains('collapsed') ? '▶' : '▼';
    });
  }
  
  // Send now buttons
  container.querySelectorAll('.queue-send-now').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      sendQueuedMessageNow(sessionId, id);
    });
  });
  
  // Edit buttons
  container.querySelectorAll('.queue-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      showEditQueuedMessageModal(sessionId, id);
    });
  });
  
  // Move up buttons
  container.querySelectorAll('.queue-move-up:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      reorderMessageInQueue(sessionId, id, 'up');
    });
  });
  
  // Move down buttons
  container.querySelectorAll('.queue-move-down:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      reorderMessageInQueue(sessionId, id, 'down');
    });
  });
  
  // Delete buttons
  container.querySelectorAll('.queue-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      removeFromMessageQueue(sessionId, id);
    });
  });
}

async function sendQueuedMessageNow(sessionId, itemId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !itemId) return;
  
  const queue = getMessageQueue(sid);
  const item = queue.find(m => m.id === itemId);
  if (!item) return;
  
  // Remove from queue first
  removeFromMessageQueue(sid, itemId);
  
  // Check if there's a run in progress
  const wasRunning = typeof isSessionProcessing === 'function' && isSessionProcessing(sid);
  
  if (wasRunning) {
    // Get the current requestId BEFORE stopping (needed to clean up timeline)
    let oldRequestId = null;
    try {
      const st = typeof getRunState === 'function' ? getRunState(sid) : null;
      oldRequestId = st?.requestId || null;
    } catch { /* ignore */ }
    
    // Stop current run using the SAME stop path as the composer Stop button.
    // Prefer abortSessionRunNoRestore (it's the "hard stop" helper used elsewhere), then fallback.
    try {
      if (typeof abortSessionRunNoRestore === 'function') {
        await abortSessionRunNoRestore(sid, 'Abort & Send');
      } else if (typeof window.stopProcessing === 'function') {
        await window.stopProcessing(sid);
      } else if (typeof window.stopCurrentRun === 'function') {
        await window.stopCurrentRun(sid);
      }
    } catch (err) {
      console.warn('[MessageQueue] Error stopping current run:', err);
    }
    
    // CRITICAL: Clean up the OLD timeline to prevent delta type mismatches
    // The new run will create a fresh timeline with a new requestId
    if (oldRequestId) {
      try {
        if (window.TimelineIntegration && typeof window.TimelineIntegration.cleanupTimeline === 'function') {
          window.TimelineIntegration.cleanupTimeline(oldRequestId);
        }
        if (window._contentBlockTimelines) {
          window._contentBlockTimelines.delete(oldRequestId);
        }
        if (window._usingNewTimeline) {
          window._usingNewTimeline.delete(oldRequestId);
        }
        if (window._streamAssemblers && window._streamAssemblers.has(oldRequestId)) {
          const assembler = window._streamAssemblers.get(oldRequestId);
          if (assembler && typeof assembler.reset === 'function') assembler.reset();
          window._streamAssemblers.delete(oldRequestId);
        }
      } catch { /* ignore */ }
    }
    
    // CRITICAL: Clear the TODO list so the AI doesn't try to continue old tasks
    try {
      setTodoList([], { persist: true });
    } catch { /* ignore */ }
    
    // Reset stream buffer for this session
    try {
      if (typeof resetStreamBuffer === 'function') {
        resetStreamBuffer(sid);
      }
    } catch { /* ignore */ }
    
    // CRITICAL: Clear Claude resume ANCHOR (not the whole session!)
    // This prevents Claude from resuming mid-tool from the aborted run
    // but KEEPS the conversation history intact
    try {
      if (typeof clearClaudeResumeAnchorForSession === 'function') {
        clearClaudeResumeAnchorForSession(sid);
      }
    } catch { /* ignore */ }
    
    // CRITICAL: Remove the streaming bubble from DOM (the old run's timeline UI)
    // The bubble is identified by data-streaming-session attribute
    try {
      const messagesContainer = document.getElementById('chatMessages');
      if (messagesContainer) {
        // Remove the streaming bubble for THIS session specifically
        const streamingBubble = messagesContainer.querySelector(`.message.assistant[data-streaming-session="${CSS.escape(sid)}"]`);
        if (streamingBubble) {
          streamingBubble.remove();
        }
        
        // Also remove any generic streaming bubbles
        const allStreamingBubbles = messagesContainer.querySelectorAll('.message.assistant.streaming');
        allStreamingBubbles.forEach(el => el.remove());
      }
    } catch { /* ignore */ }
    
    // Wait for the run to fully stop and all pending renders to complete
    let attempts = 0;
    const maxAttempts = 20; // 2 seconds max
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const stillRunning = typeof isSessionProcessing === 'function' && isSessionProcessing(sid);
      if (!stillRunning) break;
      attempts++;
    }
    
    // Extra delay for any final DOM updates to flush
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  // Verify session is no longer processing before sending
  const stillProcessing = typeof isSessionProcessing === 'function' && isSessionProcessing(sid);
  if (stillProcessing) {
    console.warn('[MessageQueue] Session still processing after stop, aborting send');
    // Re-add to queue since we couldn't send
    addToMessageQueue(sid, item.text, item.attachments);
    return;
  }
  
  // CRITICAL: One more clear of resume anchor right before sending
  // This ensures we don't resume from the aborted point
  try {
    if (typeof clearClaudeResumeAnchorForSession === 'function') {
      clearClaudeResumeAnchorForSession(sid);
    }
  } catch { /* ignore */ }
  
  // Now send the message
  try {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.value = item.text;
      // Restore attachments if any
      if (item.attachments && item.attachments.length > 0) {
        try {
          setPendingAttachments(sid, item.attachments);
        } catch { /* ignore */ }
      }
      // Trigger send
      if (typeof window.triggerSendMessage === 'function') {
        window.triggerSendMessage();
      }
    }
  } catch (err) {
    console.error('[MessageQueue] Error sending queued message:', err);
  }
}

function showEditQueuedMessageModal(sessionId, itemId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !itemId) return;
  
  const queue = getMessageQueue(sid);
  const item = queue.find(m => m.id === itemId);
  if (!item) return;
  
  // Find the queue item element
  const container = document.getElementById('messageQueueContainer');
  if (!container) return;
  
  const itemEl = container.querySelector(`.message-queue-item[data-id="${itemId}"]`);
  if (!itemEl) return;
  
  const textEl = itemEl.querySelector('.queue-item-text');
  if (!textEl) return;
  
  // Already editing?
  if (itemEl.querySelector('.queue-edit-input')) return;
  
  // Create inline input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'queue-edit-input';
  input.value = item.text;
  input.placeholder = 'Edit message...';
  
  // Replace text with input
  const originalDisplay = textEl.style.display;
  textEl.style.display = 'none';
  textEl.parentNode.insertBefore(input, textEl);
  
  // Focus and select all
  input.focus();
  input.select();
  
  // Save function
  const saveEdit = () => {
    const newText = input.value.trim();
    if (newText && newText !== item.text) {
      editMessageInQueue(sid, itemId, newText);
    } else {
      // Restore without saving
      input.remove();
      textEl.style.display = originalDisplay;
    }
  };
  
  // Cancel function
  const cancelEdit = () => {
    input.remove();
    textEl.style.display = originalDisplay;
  };
  
  // Event listeners
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  });
  
  input.addEventListener('blur', () => {
    // Small delay to allow click events to fire first
    setTimeout(() => {
      if (document.body.contains(input)) {
        saveEdit();
      }
    }, 100);
  });
}

// Called when AI run completes - auto-send next queued message
function processMessageQueueAfterRunComplete(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  
  const queue = getMessageQueue(sid);
  if (!queue || queue.length === 0) return;

  // If docs are still pending/generating for this session, wait for them to finish
  if (_shouldDeferQueueForDocs(sid)) {
    try { window.generatePendingDocs?.(); } catch { /* ignore */ }
    _scheduleQueueRetry(sid, 1000);
    return;
  }
  
  // Small delay before sending next message
  setTimeout(() => {
    const nextItem = shiftMessageQueue(sid);
    if (!nextItem) return;
    
    try {
      const chatInput = document.getElementById('chatInput');
      if (chatInput) {
        chatInput.value = nextItem.text;
        // Restore attachments if any
        if (nextItem.attachments && nextItem.attachments.length > 0) {
          try {
            setPendingAttachments(sid, nextItem.attachments);
          } catch { /* ignore */ }
        }
        // Trigger send
        if (typeof window.triggerSendMessage === 'function') {
          window.triggerSendMessage();
        }
      }
    } catch { /* ignore */ }
  }, 500);
}

// Expose globally
window.getMessageQueue = getMessageQueue;
window.addToMessageQueue = addToMessageQueue;
window.removeFromMessageQueue = removeFromMessageQueue;
window.clearMessageQueue = clearMessageQueue;
window.renderMessageQueueUI = renderMessageQueueUI;
window.processMessageQueueAfterRunComplete = processMessageQueueAfterRunComplete;
