// ---- GENERATED: hoisted declarations extracted from app/agents/agents-skills-library-ui.js ----
 // agents | skills | scripts

function slugifyName(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  const cleaned = s
    .replace(/[^a-z0-9-_ ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return cleaned.slice(0, 64);
}


async function ensureUniqueProjectPath(desiredPath) {
  const base = String(desiredPath || '').trim();
  if (!base) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot) : '';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${stem}-${i + 1}${ext}`;
    try {
      const rr = await window.electronAPI.readFile(candidate);
      if (rr && rr.success === true) continue; // exists
    } catch {
      // ignore
    }
    return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}


function showAgentSkillLibrary() {
  const modal = document.getElementById('agentSkillLibraryModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
}


function hideAgentSkillLibrary() {
  const modal = document.getElementById('agentSkillLibraryModal');
  if (!modal) return;
  modal.style.display = 'none';
  document.body.classList.remove('modal-open');
}


function switchAgentSkillLibraryTab(tab) {
  const t = String(tab || '').trim();
  if (!['agents', 'skills', 'scripts'].includes(t)) return;
  agentSkillLibraryActiveTab = t;
  const tabs = document.querySelectorAll('#agentSkillLibraryTabs .library-tab');
  tabs.forEach(btn => {
    const isActive = String(btn.dataset.tab || '') === t;
    btn.classList.toggle('active', isActive);
  });
  const pa = document.getElementById('libraryPanelAgents');
  const ps = document.getElementById('libraryPanelSkills');
  const pr = document.getElementById('libraryPanelScripts');
  if (pa) pa.style.display = t === 'agents' ? '' : 'none';
  if (ps) ps.style.display = t === 'skills' ? '' : 'none';
  if (pr) pr.style.display = t === 'scripts' ? '' : 'none';
}


function getProjectAgentsForLibrary() {
  return (Array.isArray(availableAgents) ? availableAgents : []).filter(a => a && isProjectAgentId(a.id));
}


function getUserAgentsForLibrary() {
  return (Array.isArray(availableAgents) ? availableAgents : []).filter(a => a && isUserAgentId(a.id));
}


function getProjectSkillsForLibrary() {
  return (Array.isArray(availableSkills) ? availableSkills : []).filter(s => s && isProjectSkillId(s.id));
}


function getUserSkillsForLibrary() {
  return (Array.isArray(availableSkills) ? availableSkills : []).filter(s => s && isUserSkillId(s.id));
}


async function createAgentFromLibrary({ location, name, description, instructions }) {
  const loc = location === 'user' ? 'user' : 'project';
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Agent name is required.');
  const desc = String(description || '').trim();
  const body = String(instructions || '').trim();
  const front = `---\nname: ${nm}\ndescription: ${desc}\n---\n`;
  const content = `${front}\n${body}\n`;

  if (loc === 'user') {
    if (!window.electronAPI || typeof window.electronAPI.userClaudeWriteFile !== 'function') {
      throw new Error('User Claude write API is not available.');
    }
    const slug = slugifyName(nm) || 'agent';
    const rel = `created/${slug}.md`;
    const wr = await window.electronAPI.userClaudeWriteFile({ area: 'agents', relPath: rel, content, isBase64: false });
    if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to write user agent.');
    return { kind: 'user', id: `user:${rel}` };
  }

  if (!window.electronAPI || typeof window.electronAPI.createDirectory !== 'function' || typeof window.electronAPI.writeFile !== 'function') {
    throw new Error('Project file APIs are not available.');
  }
  await window.electronAPI.createDirectory('.claude/agents');
  const slug = slugifyName(nm) || 'agent';
  let path = `.claude/agents/${slug}.md`;
  path = await ensureUniqueProjectPath(path);
  const wr = await window.electronAPI.writeFile(path, content, false);
  if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to write project agent.');
  return { kind: 'project', id: path, path };
}


async function createSkillFromLibrary({ location, displayName, dirName, description, whenToUse, instructions }) {
  const loc = location === 'user' ? 'user' : 'project';
  const nm = String(displayName || '').trim();
  if (!nm) throw new Error('Skill name is required.');
  const dir = String(dirName || '').trim() || slugifyName(nm) || 'Skill';
  const desc = String(description || '').trim();
  const wtu = String(whenToUse || '').trim();
  const body = String(instructions || '').trim();
  // Build frontmatter with optional when_to_use
  const frontmatterLines = [`name: ${nm}`, `description: ${desc}`];
  if (wtu) frontmatterLines.push(`when_to_use: ${wtu}`);
  const content = `---\n${frontmatterLines.join('\n')}\n---\n\n${body}\n`;

  if (loc === 'user') {
    if (!window.electronAPI || typeof window.electronAPI.userClaudeWriteFile !== 'function') {
      throw new Error('User Claude write API is not available.');
    }
    // Claude Code docs use SKILL.md as the skill entrypoint. Keep compatibility by
    // writing new skills with that canonical name.
    const rel = `${dir}/SKILL.md`;
    const wr = await window.electronAPI.userClaudeWriteFile({ area: 'skills', relPath: rel, content, isBase64: false });
    if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to write user skill.');
    return { kind: 'user', id: `user:${dir}` };
  }

  if (!window.electronAPI || typeof window.electronAPI.createDirectory !== 'function' || typeof window.electronAPI.writeFile !== 'function') {
    throw new Error('Project file APIs are not available.');
  }
  const base = `.claude/skills/${dir}`;
  await window.electronAPI.createDirectory(base);
  const wr = await window.electronAPI.writeFile(`${base}/SKILL.md`, content, false);
  if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to write project skill.');
  return { kind: 'project', id: `.claude/skills/${dir}`, skillFilePath: `${base}/SKILL.md` };
}


async function editAgentFromLibrary(agentId) {
  const agent = (Array.isArray(availableAgents) ? availableAgents : []).find(a => a && a.id === agentId);
  if (!agent) throw new Error('Agent not found.');

  // Populate the create form with existing data
  const locationSelect = document.getElementById('libAgentLocation');
  const nameInput = document.getElementById('libAgentName');
  const descInput = document.getElementById('libAgentDesc');
  const bodyInput = document.getElementById('libAgentBody');
  const createBtn = document.getElementById('libCreateAgentBtn');

  if (!locationSelect || !nameInput || !descInput || !bodyInput || !createBtn) {
    throw new Error('Edit form elements not found.');
  }

  // Set form values
  locationSelect.value = isUserAgentId(agentId) ? 'user' : 'project';
  locationSelect.disabled = true; // Can't change location when editing
  nameInput.value = agent.name || '';
  descInput.value = agent.description || '';
  bodyInput.value = agent.instructions || '';

  // Change button text to indicate edit mode
  const originalText = createBtn.textContent;
  createBtn.textContent = 'Update';
  createBtn.dataset.editMode = 'true';
  createBtn.dataset.editId = agentId;

  // Wait for user to click Update or cancel
  return new Promise((resolve) => {
    const originalHandler = createBtn.onclick;
    const cleanup = () => {
      createBtn.textContent = originalText;
      createBtn.dataset.editMode = '';
      createBtn.dataset.editId = '';
      locationSelect.disabled = false;
      createBtn.onclick = originalHandler;
    };

    // Store resolve function so the actual handler can call it
    createBtn.dataset.editResolve = 'pending';
    window._agentEditResolve = resolve;
    window._agentEditCleanup = cleanup;
  });
}


async function deleteAgentFromLibrary(agentId) {
  const agent = (Array.isArray(availableAgents) ? availableAgents : []).find(a => a && a.id === agentId);
  if (!agent) throw new Error('Agent not found.');

  const confirmed = await customConfirm(
    `Delete "${agent.name || 'Agent'}"? This cannot be undone.`,
    'Delete Agent',
    { confirmText: 'Delete', cancelText: 'Cancel' }
  );
  if (!confirmed) return null;

  if (isUserAgentId(agentId)) {
    const rel = agentId.replace(/^user:/, '');
    const dr = await window.electronAPI.userClaudeDeleteFile({ area: 'agents', relPath: rel });
    if (!dr || dr.success !== true) throw new Error(dr?.error || 'Failed to delete user agent.');
  } else {
    const dr = await window.electronAPI.deleteFile(agentId);
    if (!dr || dr.success !== true) throw new Error(dr?.error || 'Failed to delete project agent.');
  }

  return { success: true };
}


async function editSkillFromLibrary(skillId) {
  const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === skillId);
  if (!skill) throw new Error('Skill not found.');

  // Populate the create form with existing data
  const locationSelect = document.getElementById('libSkillLocation');
  const nameInput = document.getElementById('libSkillName');
  const dirInput = document.getElementById('libSkillDir');
  const descInput = document.getElementById('libSkillDesc');
  const whenToUseInput = document.getElementById('libSkillWhenToUse');
  const bodyInput = document.getElementById('libSkillBody');
  const createBtn = document.getElementById('libCreateSkillBtn');

  if (!locationSelect || !nameInput || !dirInput || !descInput || !bodyInput || !createBtn) {
    throw new Error('Edit form elements not found.');
  }

  // Set form values
  locationSelect.value = isUserSkillId(skillId) ? 'user' : 'project';
  locationSelect.disabled = true; // Can't change location when editing
  nameInput.value = skill.name || '';
  
  // Extract dir from skillId
  let dirName = '';
  if (isUserSkillId(skillId)) {
    dirName = skillId.replace(/^user:/, '');
  } else {
    dirName = skillId.replace(/^\.claude\/skills\//, '');
  }
  dirInput.value = dirName;
  dirInput.disabled = true; // Can't change directory when editing
  
  descInput.value = skill.description || '';
  if (whenToUseInput) whenToUseInput.value = skill.whenToUse || '';
  bodyInput.value = skill.instructions || '';

  // Change button text to indicate edit mode
  const originalText = createBtn.textContent;
  createBtn.textContent = 'Update';
  createBtn.dataset.editMode = 'true';
  createBtn.dataset.editId = skillId;

  // Wait for user to click Update or cancel
  return new Promise((resolve) => {
    const originalHandler = createBtn.onclick;
    const cleanup = () => {
      createBtn.textContent = originalText;
      createBtn.dataset.editMode = '';
      createBtn.dataset.editId = '';
      locationSelect.disabled = false;
      dirInput.disabled = false;
      createBtn.onclick = originalHandler;
    };

    // Store resolve function so the actual handler can call it
    createBtn.dataset.editResolve = 'pending';
    window._skillEditResolve = resolve;
    window._skillEditCleanup = cleanup;
  });
}


async function deleteSkillFromLibrary(skillId) {
  const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === skillId);
  if (!skill) throw new Error('Skill not found.');

  const confirmed = await customConfirm(
    `Delete "${skill.name || 'Skill'}" and all its scripts? This cannot be undone.`,
    'Delete Skill',
    { confirmText: 'Delete', cancelText: 'Cancel' }
  );
  if (!confirmed) return null;

  if (isUserSkillId(skillId)) {
    const dir = skillId.replace(/^user:/, '');
    const dr = await window.electronAPI.userClaudeDeleteFile({ area: 'skills', relPath: dir });
    if (!dr || dr.success !== true) throw new Error(dr?.error || 'Failed to delete user skill.');
  } else {
    const dr = await window.electronAPI.deleteFile(skillId);
    if (!dr || dr.success !== true) throw new Error(dr?.error || 'Failed to delete project skill.');
  }

  return { success: true };
}


async function deleteScriptFromLibrary(scriptPath, scriptName) {
  const confirmed = await customConfirm(
    `Delete script "${scriptName || scriptPath}"? This cannot be undone.`,
    'Delete Script',
    { confirmText: 'Delete', cancelText: 'Cancel' }
  );
  if (!confirmed) return null;

  const dr = await window.electronAPI.deleteFile(scriptPath);
  if (!dr || dr.success !== true) throw new Error(dr?.error || 'Failed to delete script.');

  return { success: true };
}


function renderAgentSkillLibrary() {
  const agentsPanel = document.getElementById('libraryPanelAgents');
  const skillsPanel = document.getElementById('libraryPanelSkills');
  const scriptsPanel = document.getElementById('libraryPanelScripts');
  if (!agentsPanel || !skillsPanel || !scriptsPanel) return;

  const projectAgents = getProjectAgentsForLibrary();
  const userAgents = getUserAgentsForLibrary();
  const projectSkills = getProjectSkillsForLibrary();
  const userSkills = getUserSkillsForLibrary();

  agentsPanel.innerHTML = `
    <div class="library-grid">
      <div class="library-card">
        <div class="library-card-header">
          <div class="library-card-title">Create agent</div>
        </div>
        <div class="library-card-body">
          <div class="form-group">
            <label for="libAgentLocation">Location</label>
            <select id="libAgentLocation" class="form-input">
              <option value="project">Project (recommended)</option>
              <option value="user">User (~/.claude)</option>
            </select>
            <small class="form-help">Project agents can be committed and shared. User agents are personal across projects.</small>
          </div>
          <div class="form-group">
            <label for="libAgentName">Name</label>
            <input id="libAgentName" class="form-input" placeholder="e.g., Security Reviewer" />
          </div>
          <div class="form-group">
            <label for="libAgentDesc">Description</label>
            <input id="libAgentDesc" class="form-input" placeholder="What this agent is for" />
          </div>
          <div class="form-group">
            <label for="libAgentBody">Instructions</label>
            <textarea id="libAgentBody" class="form-input" rows="8" placeholder="Write the agent instructions here..."></textarea>
          </div>
          <div class="library-form-actions">
            <button class="btn-primary" id="libCreateAgentBtn" type="button">Create</button>
          </div>
          <small class="form-help">You never need to manually browse the hidden <code>.claude</code> folder — the app manages these for you.</small>
        </div>
      </div>
      <div class="library-card">
        <div class="library-card-header">
          <div class="library-card-title">Existing agents</div>
        </div>
        <div class="library-card-body">
          <div class="library-item-title" style="margin-bottom:8px;">Project agents</div>
          <div class="library-list" id="libProjectAgentsList"></div>
          <div style="height:12px;"></div>
          <div class="library-item-title" style="margin-bottom:8px;">User agents (~/.claude)</div>
          <div class="library-list" id="libUserAgentsList"></div>
        </div>
      </div>
    </div>
  `;

  skillsPanel.innerHTML = `
    <div class="library-grid">
      <div class="library-card">
        <div class="library-card-header">
          <div class="library-card-title">Create skill</div>
        </div>
        <div class="library-card-body">
          <div class="form-group">
            <label for="libSkillLocation">Location</label>
            <select id="libSkillLocation" class="form-input">
              <option value="project">Project (recommended)</option>
              <option value="user">User (~/.claude)</option>
            </select>
          </div>
          <div class="library-form-row">
            <div class="form-group">
              <label for="libSkillName">Name</label>
              <input id="libSkillName" class="form-input" placeholder="e.g., PR Summary" />
            </div>
            <div class="form-group">
              <label for="libSkillDir">Folder name</label>
              <input id="libSkillDir" class="form-input" placeholder="e.g., PRSummary" />
              <small class="form-help">Auto-filled from name if left blank.</small>
            </div>
          </div>
          <div class="form-group">
            <label for="libSkillDesc">Description</label>
            <input id="libSkillDesc" class="form-input" placeholder="What this skill is for" />
          </div>
          <div class="form-group">
            <label for="libSkillWhenToUse">When to use</label>
            <input id="libSkillWhenToUse" class="form-input" placeholder="e.g., When writing code that handles user authentication" />
            <small class="form-help">Tells the AI when to automatically apply this skill.</small>
          </div>
          <div class="form-group">
            <label for="libSkillBody">Instructions</label>
            <textarea id="libSkillBody" class="form-input" rows="8" placeholder="Write the skill instructions here..."></textarea>
          </div>
          <div class="library-form-actions">
            <button class="btn-primary" id="libCreateSkillBtn" type="button">Create</button>
          </div>
          <small class="form-help">Skills live at <code>.claude/skills/&lt;SkillDir&gt;/SKILL.md</code>.</small>
        </div>
      </div>
      <div class="library-card">
        <div class="library-card-header">
          <div class="library-card-title">Existing skills</div>
        </div>
        <div class="library-card-body">
          <div class="library-item-title" style="margin-bottom:8px;">Project skills</div>
          <div class="library-list" id="libProjectSkillsList"></div>
          <div style="height:12px;"></div>
          <div class="library-item-title" style="margin-bottom:8px;">User skills (~/.claude)</div>
          <div class="library-list" id="libUserSkillsList"></div>
        </div>
      </div>
    </div>
  `;

  scriptsPanel.innerHTML = `
    <div class="library-grid">
      <div class="library-card">
        <div class="library-card-header">
          <div class="library-card-title">Scripts</div>
        </div>
        <div class="library-card-body">
          <div class="form-group">
            <label for="libScriptsSkillSelect">Project skill</label>
            <select id="libScriptsSkillSelect" class="form-input"></select>
            <small class="form-help">Scripts are stored under <code>.claude/skills/&lt;SkillDir&gt;/scripts/</code>.</small>
          </div>
          <div class="form-group">
            <label>Existing scripts</label>
            <div class="library-list" id="libScriptsList"></div>
          </div>
        </div>
      </div>
      <div class="library-card">
        <div class="library-card-header">
          <div class="library-card-title">Create script</div>
        </div>
        <div class="library-card-body">
          <div class="library-form-row">
            <div class="form-group">
              <label for="libScriptName">File name</label>
              <input id="libScriptName" class="form-input" placeholder="e.g., list-tree.sh" />
            </div>
            <div class="form-group">
              <label for="libScriptType">Template</label>
              <select id="libScriptType" class="form-input">
                <option value="sh">Shell (.sh)</option>
                <option value="js">Node (.js)</option>
                <option value="py">Python (.py)</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="libScriptBody">Content</label>
            <textarea id="libScriptBody" class="form-input" rows="10"></textarea>
          </div>
          <div class="library-form-actions">
            <button class="btn-primary" id="libCreateScriptBtn" type="button">Create</button>
          </div>
          <small class="form-help">Scripts can be run via the header <b>Agent &amp; Skills</b> menu (runs in your workspace).</small>
        </div>
      </div>
    </div>
  `;

  // Render agent lists
  const pa = document.getElementById('libProjectAgentsList');
  const ua = document.getElementById('libUserAgentsList');
  if (pa) pa.innerHTML = projectAgents.length ? '' : `<div class="library-item-sub">No project agents yet.</div>`;
  if (ua) ua.innerHTML = userAgents.length ? '' : `<div class="library-item-sub">No user agents found in ~/.claude/agents.</div>`;
  for (const a of projectAgents) {
    const el = document.createElement('div');
    el.className = 'library-item';
    el.innerHTML = `
      <div>
        <div class="library-item-title">${escapeHtml(String(a.name || 'Agent'))}</div>
        <div class="library-item-sub">${escapeHtml(String(a.description || a.id || ''))}</div>
      </div>
      <div class="library-item-actions">
        <button class="btn-secondary" data-action="use-agent" data-id="${escapeAttr(a.id)}" type="button">Use</button>
        <button class="btn-secondary" data-action="open-agent" data-id="${escapeAttr(a.id)}" type="button">Open</button>
        <button class="btn-secondary" data-action="edit-agent" data-id="${escapeAttr(a.id)}" type="button">Edit</button>
        <button class="btn-secondary" data-action="delete-agent" data-id="${escapeAttr(a.id)}" type="button">Delete</button>
      </div>
    `;
    pa?.appendChild(el);
  }
  for (const a of userAgents) {
    const el = document.createElement('div');
    el.className = 'library-item';
    el.innerHTML = `
      <div>
        <div class="library-item-title">${escapeHtml(String(a.name || 'Agent'))}</div>
        <div class="library-item-sub">${escapeHtml(String(a.description || a.sourcePath || ''))}</div>
      </div>
      <div class="library-item-actions">
        <button class="btn-secondary" data-action="use-agent" data-id="${escapeAttr(a.id)}" type="button">Use</button>
        <button class="btn-secondary" data-action="import-agent" data-id="${escapeAttr(a.id)}" type="button">Import</button>
        <button class="btn-secondary" data-action="edit-agent" data-id="${escapeAttr(a.id)}" type="button">Edit</button>
        <button class="btn-secondary" data-action="delete-agent" data-id="${escapeAttr(a.id)}" type="button">Delete</button>
      </div>
    `;
    ua?.appendChild(el);
  }

  // Render skill lists
  const ps = document.getElementById('libProjectSkillsList');
  const us = document.getElementById('libUserSkillsList');
  if (ps) ps.innerHTML = projectSkills.length ? '' : `<div class="library-item-sub">No project skills yet.</div>`;
  if (us) us.innerHTML = userSkills.length ? '' : `<div class="library-item-sub">No user skills found in ~/.claude/skills.</div>`;
  for (const s of projectSkills) {
    const el = document.createElement('div');
    el.className = 'library-item';
    el.innerHTML = `
      <div>
        <div class="library-item-title">${escapeHtml(String(s.name || 'Skill'))}</div>
        <div class="library-item-sub">${escapeHtml(String(s.description || s.id || ''))}</div>
      </div>
      <div class="library-item-actions">
        <button class="btn-secondary" data-action="use-skill" data-id="${escapeAttr(s.id)}" type="button">Use</button>
        <button class="btn-secondary" data-action="open-skill" data-id="${escapeAttr(s.id)}" type="button">Open</button>
        <button class="btn-secondary" data-action="edit-skill" data-id="${escapeAttr(s.id)}" type="button">Edit</button>
        <button class="btn-secondary" data-action="delete-skill" data-id="${escapeAttr(s.id)}" type="button">Delete</button>
      </div>
    `;
    ps?.appendChild(el);
  }
  for (const s of userSkills) {
    const el = document.createElement('div');
    el.className = 'library-item';
    el.innerHTML = `
      <div>
        <div class="library-item-title">${escapeHtml(String(s.name || 'Skill'))}</div>
        <div class="library-item-sub">${escapeHtml(String(s.description || s.skillFilePath || ''))}</div>
      </div>
      <div class="library-item-actions">
        <button class="btn-secondary" data-action="use-skill" data-id="${escapeAttr(s.id)}" type="button">Use</button>
        <button class="btn-secondary" data-action="import-skill" data-id="${escapeAttr(s.id)}" type="button">Import</button>
        <button class="btn-secondary" data-action="edit-skill" data-id="${escapeAttr(s.id)}" type="button">Edit</button>
        <button class="btn-secondary" data-action="delete-skill" data-id="${escapeAttr(s.id)}" type="button">Delete</button>
      </div>
    `;
    us?.appendChild(el);
  }

  // Populate scripts skill select (project skills only)
  const sel = document.getElementById('libScriptsSkillSelect');
  if (sel) {
    sel.innerHTML = '';
    for (const s of projectSkills) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = String(s.name || s.id || 'Skill');
      sel.appendChild(opt);
    }
    if (projectSkills.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No project skills available';
      sel.appendChild(opt);
      sel.disabled = true;
    } else {
      sel.disabled = false;
    }
  }
}


async function refreshScriptsListForLibrary() {
  const list = document.getElementById('libScriptsList');
  const sel = document.getElementById('libScriptsSkillSelect');
  if (!list || !sel) return;
  const skillId = String(sel.value || '').trim();
  list.innerHTML = `<div class="library-item-sub">Loading…</div>`;
  if (!skillId) {
    list.innerHTML = `<div class="library-item-sub">Select a project skill.</div>`;
    return;
  }
  const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === skillId);
  if (!skill) {
    list.innerHTML = `<div class="library-item-sub">Skill not found.</div>`;
    return;
  }
  let scripts = [];
  try { scripts = await listSkillScriptsForSkill(skill); } catch { scripts = []; }
  if (!scripts || scripts.length === 0) {
    list.innerHTML = `<div class="library-item-sub">No scripts found for this skill.</div>`;
    return;
  }
  list.innerHTML = '';
  for (const sc of scripts) {
    const el = document.createElement('div');
    el.className = 'library-item';
    el.innerHTML = `
      <div>
        <div class="library-item-title">${escapeHtml(sc.name)}</div>
        <div class="library-item-sub">${escapeHtml(sc.relPath)}</div>
      </div>
      <div class="library-item-actions">
        <button class="btn-secondary" data-action="open-script" data-path="${escapeAttr(sc.relPath)}" type="button">Open</button>
        <button class="btn-secondary" data-action="delete-script" data-path="${escapeAttr(sc.relPath)}" data-name="${escapeAttr(sc.name)}" type="button">Delete</button>
      </div>
    `;
    list.appendChild(el);
  }
}


function startOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatAgeShort(ts) {
  const t = typeof ts === 'number' ? ts : 0;
  if (!t) return '';
  const delta = Date.now() - t;
  if (delta < 30_000) return 'now';
  if (delta < 60_000) return `${Math.max(1, Math.floor(delta / 1000))}s`;
  if (delta < 60 * 60_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (delta < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(delta / (60 * 60_000)))}h`;
  const d = new Date(t);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}


function getSessionDisplayMeta(session) {
  const timeline = Array.isArray(session?.messages)
    ? session.messages
    : (Array.isArray(session?.history) ? session.history : []);
  const msgCount = timeline.filter(m => m && (m.role === 'user' || m.role === 'assistant')).length;
  const updatedAt = typeof session?.timestamp === 'number' ? session.timestamp : 0;
  const age = formatAgeShort(updatedAt);
  const msgPart = msgCount > 0 ? `${msgCount} msgs` : '0 msgs';
  const meta = age ? `${age} · ${msgPart}` : msgPart;
  return { meta, msgCount, updatedAt };
}


function getFilePreviewBadgeClass(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  const known = new Set(['js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'html', 'json', 'py', 'md']);
  return known.has(e) ? e : 'default';
}


function getFileExtFromPath(p) {
  const s = String(p || '');
  const base = s.split(/[/\\]/).pop() || s;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'file';
  return base.slice(dot + 1).toLowerCase();
}


function normalizeRelPathForDiffPreview(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}


function isHiddenOrInternalPathForDiffPreview(relPath) {
  const p = normalizeRelPathForDiffPreview(relPath);
  if (!p || p === '.') return true;
  // Internal UI/session state (never show in code diffs)
  if (p === '.ai-agent' || p.startsWith('.ai-agent/') || p.includes('/.ai-agent/')) return true;
  // Git internals
  if (p === '.git' || p.startsWith('.git/') || p.includes('/.git/')) return true;
  // Any hidden segment (dotfiles / dotfolders)
  const parts = p.split('/').filter(Boolean);
  return parts.some(seg => seg.startsWith('.') && seg !== '.' && seg !== '..');
}


function countDiffStats(diffContent) {
  const diff = typeof diffContent === 'string' ? diffContent : '';
  let added = 0;
  let removed = 0;
  const lines = diff.split('\n');
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  const isNewFile = diff.includes('new file mode') || diff.includes('--- /dev/null');
  return { added, removed, isNewFile };
}


function renderDiffStatHtml({ added = 0, removed = 0, isNewFile = false } = {}) {
  const a = Number(added || 0);
  const r = Number(removed || 0);
  const aSafe = Number.isFinite(a) ? Math.max(0, Math.floor(a)) : 0;
  const rSafe = Number.isFinite(r) ? Math.max(0, Math.floor(r)) : 0;
  const plus = `<span class="diff-plus">+${aSafe}</span>`;
  if (isNewFile) return plus;
  const minus = `<span class="diff-minus">-${rSafe}</span>`;
  return `${plus} ${minus}`;
}


async function addFilePreviewMessageFromDiff(sessionId, filePath, diffContent, toolName = '', { renderNow = true, timestamp = null } = {}) {
  const sid = sessionId || currentSessionId;
  if (!sid) return;
  ensureMessageSeqInitialized(sid);
  const relPath = normalizeRelPathForDiffPreview(filePath);
  if (!relPath) return;
  if (isHiddenOrInternalPathForDiffPreview(relPath)) return;
  const diff = typeof diffContent === 'string' ? diffContent : '';
  if (!diff.trim()) return;

  const existing = ensureSessionMessages(sid);
  const last = [...existing].reverse().find(m => m && m.role === 'file_preview' && m.filePath === relPath);
  if (last && last.diffContent === diff) return; // de-dupe identical consecutive previews

  const ext = getFileExtFromPath(relPath);
  const badgeClass = getFilePreviewBadgeClass(ext);
  const { added, removed, isNewFile } = countDiffStats(diff);
  const diffStat = isNewFile
    ? `+${added}`
    : `+${added} -${removed}`;
  const diffClass = (isNewFile || added > removed) ? 'stat-added' : 'stat-modified';

  const msg = {
    role: 'file_preview',
    timestamp: (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) ? timestamp : Date.now(),
    seq: nextMessageSeq(sid),
    filePath: relPath,
    fileName: relPath,
    fileExt: ext,
    badgeClass,
    diffStat,
    diffClass,
    diffContent: diff,
    toolName: toolName || undefined
  };

  // Cache last diff per file so opening from explorer/chat can highlight lines consistently.
  try {
    lastDiffByRelPath[relPath] = { diffContent: diff, timestamp: msg.timestamp };
  } catch { /* ignore */ }

  // If the file is already open in a tab, apply/refresh decorations immediately (persisted on the model).
  try {
    const abs = resolveToWorkspaceAbsPath(relPath);
    const tab = findTabByAbsPath(abs);
    if (tab) syncDiffDecorationsForTab(tab);
  } catch { /* ignore */ }

  // Editor tab actions (Done / Done for all) depend on whether diffs exist.
  // Ensure we refresh the tab bar when a new diff arrives.
  try { if (sid === currentSessionId) renderEditorTabs(); } catch { /* ignore */ }

  // Render immediately only if this is the active session tab (prevents cross-tab leaks)
  // and the caller wants immediate rendering.
  if (renderNow && sid === currentSessionId) {
    try {
      await renderMessageToUI(msg);
    } catch {
      // ignore
    }
  }

  // Persist in canonical timeline so it survives reload and tab switches
  ensureSessionMessages(sid).push(msg);
  saveChatHistory(); // debounced
  // Best-effort: force flush occasionally so diffs aren't lost on app close.
  maybeForcePersistNow(sid);
}


function groupLabelForTimestamp(ts) {
  const t = typeof ts === 'number' ? ts : 0;
  if (!t) return 'Earlier';
  const todayStart = startOfLocalDay(Date.now());
  const yesterdayStart = todayStart - 24 * 60 * 60_000;
  if (t >= todayStart) return 'Today';
  if (t >= yesterdayStart) return 'Yesterday';
  const d = new Date(t);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}


function renderChatSessionsPopoverList() {
  const listEl = document.getElementById('chatSessionsList');
  if (!listEl) return;

  const q = String(chatSessionsSearchQuery || '').trim().toLowerCase();
  const sessions = Object.entries(chatSessions || {}).map(([id, s]) => ({
    id,
    name: String(s?.name || 'Chat'),
    isClosed: s?.isClosed === true,
    updatedAt: typeof s?.timestamp === 'number' ? s.timestamp : 0,
    session: s
  }));

  const filtered = q
    ? sessions.filter(s => s.name.toLowerCase().includes(q))
    : sessions;

  filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  // Build groups: Today, Yesterday, then older dates in recency order.
  const groups = new Map(); // label -> items[]
  const orderedLabels = [];
  for (const s of filtered) {
    const label = groupLabelForTimestamp(s.updatedAt);
    if (!groups.has(label)) {
      groups.set(label, []);
      orderedLabels.push(label);
    }
    groups.get(label).push(s);
  }

  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '14px 12px';
    empty.style.color = 'var(--text-tertiary)';
    empty.style.fontSize = '0.875rem';
    empty.textContent = 'No chats found';
    listEl.appendChild(empty);
    return;
  }

  for (const label of orderedLabels) {
    const group = document.createElement('div');
    group.className = 'chat-sessions-group';
    const title = document.createElement('div');
    title.className = 'chat-sessions-group-title';
    title.textContent = label;
    group.appendChild(title);

    const items = groups.get(label) || [];
    for (const item of items) {
      const meta = getSessionDisplayMeta(item.session);
      const row = document.createElement('div');
      row.className = `chat-session-row ${item.id === currentSessionId ? 'active' : ''}`;

      row.innerHTML = `
        <div class="chat-session-row-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="chat-session-row-main">
          <div class="chat-session-row-title">${escapeHtml(item.name)}</div>
          <div class="chat-session-row-sub">
            ${item.id === currentSessionId ? '<span class="chat-session-pill current">Current</span>' : ''}
            ${item.isClosed ? '<span class="chat-session-pill closed">Closed</span>' : ''}
            <span>${escapeHtml(meta.meta)}</span>
          </div>
        </div>
        <div class="chat-session-row-actions">
          <button class="chat-session-action-btn" data-action="rename" title="Rename">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            </svg>
          </button>
          <button class="chat-session-action-btn danger" data-action="delete" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      `;

      row.addEventListener('click', async () => {
        closeChatSessionsPopover();
        if (item.isClosed) openChatSession(item.id);
        await switchToSession(item.id);
      });

      row.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const action = btn.getAttribute('data-action');
          if (action === 'rename') {
            await renameChatSession(item.id);
            renderChatDropdown();
            return;
          }
          if (action === 'delete') {
            if (await customConfirm(`Delete "${item.name}" permanently? This cannot be undone.`, 'Delete Chat')) {
              deleteChatSession(item.id);
              renderChatDropdown();
            }
          }
        });
      });

      group.appendChild(row);
    }

    listEl.appendChild(group);
  }
}


function showContextMenu(e, targetPath, isFolder, targetEl) {
  const menu = document.getElementById('contextMenu');
  if (!menu) return;

  contextMenuTarget = targetEl || null;
  contextMenuPath = targetPath || null;
  contextMenuIsFolder = !!isFolder;

  // Toggle menu items based on context (folder vs file vs empty space)
  const newFile = document.getElementById('ctxNewFile');
  const newFolder = document.getElementById('ctxNewFolder');
  const openDiffHead = document.getElementById('ctxOpenDiffHead');
  const cut = document.getElementById('ctxCut');
  const copy = document.getElementById('ctxCopy');
  const paste = document.getElementById('ctxPaste');
  const duplicate = document.getElementById('ctxDuplicate');
  const rename = document.getElementById('ctxRename');
  const del = document.getElementById('ctxDelete');
  const reveal = document.getElementById('ctxRevealInFinder');

  const isTreeRoot = !!(targetEl && targetEl.id === 'fileTree');
  const canCreate = contextMenuIsFolder; // folders + fileTree background
  const canMutate = !!(targetEl && targetEl.classList && targetEl.classList.contains('file-item')) && !isTreeRoot;

  const selectedCount = explorerSelectedAbsPaths && explorerSelectedAbsPaths.size > 0 ? explorerSelectedAbsPaths.size : 0;
  const clipboardCount = explorerClipboard && Array.isArray(explorerClipboard.absPaths) ? explorerClipboard.absPaths.length : 0;
  const canClipboardSource = canMutate && (selectedCount > 0 || !!contextMenuPath);
  const canPaste = canCreate && clipboardCount > 0;

  if (newFile) newFile.style.display = canCreate ? '' : 'none';
  if (newFolder) newFolder.style.display = canCreate ? '' : 'none';
  if (openDiffHead) openDiffHead.style.display = (!contextMenuIsFolder && canMutate) ? '' : 'none';
  if (cut) cut.style.display = canMutate ? '' : 'none';
  if (copy) copy.style.display = canMutate ? '' : 'none';
  if (paste) paste.style.display = canCreate ? '' : 'none';
  if (duplicate) duplicate.style.display = canMutate ? '' : 'none';
  if (rename) rename.style.display = canMutate ? '' : 'none';
  if (del) del.style.display = canMutate ? '' : 'none';
  if (reveal) reveal.style.display = (contextMenuPath && !isTreeRoot) ? '' : 'none';

  // Enable/disable items (CSS uses `.disabled`)
  if (cut) cut.classList.toggle('disabled', !canClipboardSource);
  if (copy) copy.classList.toggle('disabled', !canClipboardSource);
  if (duplicate) duplicate.classList.toggle('disabled', !canClipboardSource);
  if (paste) paste.classList.toggle('disabled', !canPaste);

  // Position
  const x = typeof e.clientX === 'number' ? e.clientX : 0;
  const y = typeof e.clientY === 'number' ? e.clientY : 0;

  menu.style.display = 'block';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Keep within viewport
  const rect = menu.getBoundingClientRect();
  const pad = 8;
  let left = x;
  let top = y;
  if (rect.right > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
  if (rect.bottom > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}


function showChatTabContextMenu(e, sessionId) {
  const menu = document.getElementById('chatTabContextMenu');
  if (!menu) return;

  chatTabContextSessionId = sessionId;

  // Toggle "Close other chats" visibility
  const closeOthers = document.getElementById('chatCtxCloseOthers');
  if (closeOthers) {
    const openCount = Object.keys(chatSessions || {}).filter(id => chatSessions[id] && chatSessions[id].isClosed !== true).length;
    closeOthers.style.display = openCount > 1 ? '' : 'none';
  }

  // Position
  const x = typeof e.clientX === 'number' ? e.clientX : 0;
  const y = typeof e.clientY === 'number' ? e.clientY : 0;

  menu.style.display = 'block';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Keep within viewport
  const rect = menu.getBoundingClientRect();
  const pad = 8;
  let left = x;
  let top = y;
  if (rect.right > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
  if (rect.bottom > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}


function setEditorReadOnly(isReadOnly) {
  if (!editor || typeof editor.updateOptions !== 'function') return;
  try {
    editor.updateOptions({ readOnly: !!isReadOnly });
  } catch {
    // ignore
  }
}


function formatChatTranscriptMarkdown(sessionId) {
  const session = sessionId && chatSessions ? chatSessions[sessionId] : null;
  if (!session) return '# Chat\n\n(Unknown session)\n';

  const title = String(session.name || 'Chat').trim() || 'Chat';
  const merged = Array.isArray(session.messages)
    ? session.messages.slice().sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0))
    : (Array.isArray(session.history) ? session.history.slice().sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0)) : []);

  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');

  for (const msg of merged) {
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${roleLabel}`);
    lines.push('');

    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.trim()) {
      lines.push(content);
      lines.push('');
    }

    const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
    if (atts.length > 0) {
      lines.push('**Attachments:**');
      for (const a of atts) {
        const name = String(a?.name || '').trim() || '(unnamed)';
        const pathStr = String(a?.savedPath || a?.workspacePath || '').trim();
        const suffix = pathStr ? ` — \`${pathStr}\`` : '';
        lines.push(`- ${name}${suffix}`);
      }
      lines.push('');
    }
  }

  if (lines.length <= 2) {
    lines.push('(No messages yet)');
    lines.push('');
  }

  return lines.join('\n');
}

async function openChatSessionAsEditor(sessionId) {
  if (!sessionId || !chatSessions || !chatSessions[sessionId]) return;
  // Ensure we're looking at the right session in the UI too.
  if (sessionId !== currentSessionId) {
    await switchToSession(sessionId);
  }

  const md = formatChatTranscriptMarkdown(sessionId);
  if (!editor) return;

  // Exit diff view if active
  if (typeof exitDiffView === 'function') exitDiffView();

  setEditorReadOnly(true);
  isChatEditorView = true;
  currentFile = null;

  try {
    editor.setValue(md);
    monaco.editor.setModelLanguage(editor.getModel(), 'markdown');
  } catch {
    // ignore
  }

  const filePathEl = document.getElementById('currentFilePath');
  if (filePathEl) filePathEl.textContent = `Chat: ${chatSessions[sessionId].name || 'Chat'}`;
}


async function renameChatSession(sessionId) {
  if (!sessionId || !chatSessions || !chatSessions[sessionId]) return;
  const currentName = String(chatSessions[sessionId].name || 'Chat');
  const next = await customPrompt('Enter a new chat name:', currentName, 'Rename Chat');
  const trimmed = typeof next === 'string' ? next.trim() : '';
  if (!trimmed) return;
  chatSessions[sessionId].name = makeUniqueSessionName(trimmed, sessionId);
  // Mark as user-controlled so auto-title logic never overwrites it.
  try { chatSessions[sessionId].autoName = false; } catch { /* ignore */ }
  await saveChatHistory(true);
  renderChatTabs();
  renderChatDropdown();
}


async function closeOtherChatSessions(keepSessionId) {
  if (!keepSessionId || !chatSessions || !chatSessions[keepSessionId]) return;

  // Keep selected open
  chatSessions[keepSessionId].isClosed = undefined;
  chatSessions[keepSessionId].closedAt = undefined;
  chatSessions[keepSessionId].timestamp = Date.now();

  for (const id of Object.keys(chatSessions)) {
    if (id === keepSessionId) continue;
    const s = chatSessions[id];
    if (!s || s.isClosed === true) continue;
    s.isClosed = true;
    s.closedAt = Date.now();
    s.timestamp = Date.now();
  }

  // Switch to kept session if needed (ensures UI reflects it)
  if (currentSessionId !== keepSessionId) {
    await switchToSession(keepSessionId);
  }

  await saveChatHistory(true);
  renderChatTabs();
  renderChatDropdown();
}


function exitDiffView() {
  const editorEl = document.getElementById('editor');
  const diffEditorEl = document.getElementById('diffEditor');
  if (!editorEl || !diffEditorEl) return;

  // If diff editor isn't visible, nothing to do.
  const isDiffVisible = diffEditorEl.style.display !== 'none' && diffEditorEl.style.display !== '';
  if (!isDiffVisible) return;

  editorEl.style.display = 'block';
  diffEditorEl.style.display = 'none';

  // Restore default file path styling
  const filePathEl = document.getElementById('currentFilePath');
  if (filePathEl) filePathEl.style.color = '';

  try {
    if (diffEditor && typeof diffEditor.setModel === 'function') diffEditor.setModel(null);
  } catch (_e) { /* ignore */ }

  // Dispose diff models to avoid memory leaks
  try { diffModels?.original?.dispose?.(); } catch { /* ignore */ }
  try { diffModels?.modified?.dispose?.(); } catch { /* ignore */ }
  diffModels = null;

  // SYNC: Clear diff state in FileSyncController so pseudo-tab is removed
  try {
    if (window.FileSyncController?.clearDiffState) {
      window.FileSyncController.clearDiffState();
    }
  } catch { /* ignore */ }

  // Refresh editor tabs to remove diff pseudo-tab
  try {
    if (typeof renderEditorTabs === 'function') {
      renderEditorTabs();
    }
  } catch { /* ignore */ }

  // Problems panel can include diff diagnostics; refresh after closing diff.
  scheduleRenderProblemsView();
}


function customAlert(message, titleText = 'Alert') {
  return showCustomDialog({
    titleText,
    messageText: message,
    mode: 'alert',
    confirmText: 'OK'
  });
}


function customConfirm(message, titleText = 'Confirm', opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const confirmText = typeof o.confirmText === 'string' && o.confirmText.trim() ? o.confirmText : 'OK';
  const cancelText = typeof o.cancelText === 'string' && o.cancelText.trim() ? o.cancelText : 'Cancel';
  return showCustomDialog({
    titleText,
    messageText: message,
    mode: 'confirm',
    confirmText,
    cancelText
  });
}


function customPrompt(message, defaultValue = '', titleText = 'Input Required') {
  return showCustomDialog({
    titleText,
    messageText: message,
    mode: 'prompt',
    defaultValue,
    confirmText: 'OK',
    cancelText: 'Cancel'
  });
}


function showCustomDialog({ titleText, messageText, mode, defaultValue = '', confirmText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('customDialog');
    const title = document.getElementById('dialogTitle');
    const msg = document.getElementById('dialogMessage');
    const input = document.getElementById('dialogInput');
    const confirmBtn = document.getElementById('dialogConfirmButton');
    const cancelBtn = document.getElementById('dialogCancelButton');

    if (!dialog || !title || !msg || !input || !confirmBtn || !cancelBtn) {
      // Fallback to native dialogs if DOM isn't ready.
      if (mode === 'prompt') return resolve(window.prompt(messageText, defaultValue));
      if (mode === 'confirm') return resolve(window.confirm(messageText));
      window.alert(messageText);
      return resolve(true);
    }

    title.textContent = String(titleText || '');
    msg.textContent = String(messageText || '');
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    const isPrompt = mode === 'prompt';
    const isConfirm = mode === 'confirm';

    input.style.display = isPrompt ? 'block' : 'none';
    input.value = isPrompt ? String(defaultValue || '') : '';

    cancelBtn.style.display = (isPrompt || isConfirm) ? '' : 'none';
    dialog.style.display = 'flex';

    const cleanup = (value) => {
      dialog.style.display = 'none';
      input.style.display = 'none';
      cancelBtn.style.display = '';
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
      resolve(value);
    };

    confirmBtn.onclick = () => cleanup(isPrompt ? (input.value || '') : true);
    cancelBtn.onclick = () => cleanup(isPrompt ? null : false);

    input.onkeydown = (ev) => {
      if (ev.key === 'Enter') cleanup(input.value || '');
      if (ev.key === 'Escape') cleanup(null);
    };

    // Focus
    setTimeout(() => {
      if (isPrompt) input.focus();
      else confirmBtn.focus();
    }, 0);
  });
}
 // { [sessionId]: number }

function ensureSessionMessages(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !chatSessions || !chatSessions[sid]) return [];
  if (!Array.isArray(chatSessions[sid].messages)) {
    // Back-compat: older versions used `history` as the main timeline.
    chatSessions[sid].messages = Array.isArray(chatSessions[sid].history) ? chatSessions[sid].history.slice() : [];
  }
  return chatSessions[sid].messages;
}


function replaceSessionMessages(sessionId, nextMessages) {
  const sid = String(sessionId || '').trim();
  if (!sid || !chatSessions || !chatSessions[sid]) return;
  const arr = Array.isArray(nextMessages) ? nextMessages : [];
  chatSessions[sid].messages = arr;
  // Back-compat: keep history aligned for any remaining legacy code paths.
  chatSessions[sid].history = arr;
  if (sid === currentSessionId) {
    chatHistory = arr;
  }
}


function runAssistantMessageId(requestId) {
  const rid = String(requestId || '').trim();
  return rid ? `assistant_run_${rid}` : '';
}


function getOrCreateRunAssistantMessage(sessionId, requestId, { timestamp = null } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid || !chatSessions || !chatSessions[sid]) return null;
  const rid = String(requestId || '').trim();
  if (!rid) return null;
  ensureMessageSeqInitialized(sid);
  const id = runAssistantMessageId(rid);
  const timeline = ensureSessionMessages(sid);
  const existing = timeline.find(m => m && m.role === 'assistant' && (m.id === id || m.runRequestId === rid));
  if (existing) return existing;
  const msg = {
    role: 'assistant',
    id,
    runRequestId: rid,
    streaming: true,
    interrupted: false,
    timestamp: (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) ? timestamp : Date.now(),
    seq: nextMessageSeq(sid),
    content: ''
  };
  timeline.push(msg);
  return msg;
}


function updateRunAssistantMessage(sessionId, requestId, patch = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid || !chatSessions || !chatSessions[sid]) return null;
  const rid = String(requestId || '').trim();
  if (!rid) return null;
  const id = runAssistantMessageId(rid);
  const timeline = ensureSessionMessages(sid);
  let msg = timeline.find(m => m && m.role === 'assistant' && (m.id === id || m.runRequestId === rid));
  if (!msg) msg = getOrCreateRunAssistantMessage(sid, rid);
  if (!msg) return null;
  Object.assign(msg, patch);
  return msg;
}


function _inlineDiffKey(filePath, diffContent) {
  const fp = normalizeRelPathForDiffPreview(String(filePath || '').trim());
  const dc = String(diffContent || '');
  if (!fp || !dc.trim()) return '';
  return `${fp}:${simpleSig(dc)}`;
}


function _buildInlineDiffKeySetForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  const set = new Set();
  if (!sid) return set;
  try {
    const msgs = ensureSessionMessages(sid);
    for (const m of msgs) {
      if (!m || m.role !== 'assistant') continue;
      const blocks = Array.isArray(m.inlineDiffBlocks) ? m.inlineDiffBlocks : null;
      if (!blocks || blocks.length === 0) continue;
      for (const b of blocks) {
        const k = _inlineDiffKey(b?.filePath, b?.diffContent);
        if (k) set.add(k);
      }
    }
  } catch { /* ignore */ }
  return set;
}


function migrateLegacyUiMetadataIntoMessages(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || !chatSessions || !chatSessions[sid]) return;
  const msgs = ensureSessionMessages(sid);
  const legacy = (uiMetadata && Array.isArray(uiMetadata[sid])) ? uiMetadata[sid] : [];
  if (legacy.length === 0) return;
  // Merge, sort once, and dedupe. After migration we stop relying on `uiMetadata`.
  const merged = dedupeMessagesStable(msgs.concat(legacy)).sort(compareTimeline);
  replaceSessionMessages(sid, merged);
}


function getMaxSeqForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return 0;
  let maxSeq = 0;
  try {
    const all = (chatSessions && chatSessions[sid] && Array.isArray(chatSessions[sid].messages))
      ? chatSessions[sid].messages
      : ((chatSessions && chatSessions[sid] && Array.isArray(chatSessions[sid].history)) ? chatSessions[sid].history : []);
    for (const m of all) {
      const s = m && typeof m.seq === 'number' ? m.seq : 0;
      if (s > maxSeq) maxSeq = s;
    }
  } catch {
    // ignore
  }
  return maxSeq;
}


function ensureMessageSeqInitialized(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (typeof messageSeqBySession[sid] === 'number' && Number.isFinite(messageSeqBySession[sid])) return;
  messageSeqBySession[sid] = getMaxSeqForSession(sid);
}


function nextMessageSeq(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return 0;
  ensureMessageSeqInitialized(sid);
  messageSeqBySession[sid] = Number(messageSeqBySession[sid] || 0) + 1;
  return messageSeqBySession[sid];
}


function compareTimeline(a, b) {
  const timeA = a && typeof a.timestamp === 'number' ? a.timestamp : 0;
  const timeB = b && typeof b.timestamp === 'number' ? b.timestamp : 0;
  if (timeA !== timeB) return timeA - timeB;
  const seqA = a && typeof a.seq === 'number' ? a.seq : 0;
  const seqB = b && typeof b.seq === 'number' ? b.seq : 0;
  if (seqA !== seqB) return seqA - seqB;
  return 0;
}


function cleanupStaleAssistantPartialSnapshot(sessionId) {
  const sid = String(sessionId || '').trim();
  const msgs = (chatSessions && chatSessions[sid] && Array.isArray(chatSessions[sid].messages))
    ? chatSessions[sid].messages
    : [];
  if (!sid || !Array.isArray(msgs) || msgs.length === 0) return;
  const partial = msgs.find(m => m && m.role === 'assistant_partial');
  if (!partial) return;

  try {
    const all = msgs.filter(m => !(m && m.role === 'assistant_partial'));

    // Keep partial only if it is the *latest* item in the timeline.
    let hasLater = false;
    for (const m of all) {
      if (!m) continue;
      if (compareTimeline(partial, m) < 0) { hasLater = true; break; }
    }
    if (!hasLater) return;

    replaceSessionMessages(sid, msgs.filter(m => !(m && m.role === 'assistant_partial')));
    saveChatHistory(); // debounced cleanup
  } catch {
    // ignore
  }
}


// Ensure in-memory `chatHistory` represents the current session before we append to it.
// This is a safety net against rare timing edges during startup/session switches.
function ensureHydratedChatHistoryForCurrentSession(reason = '') {
  try {
    if (!currentSessionId) return;
    if (hydratedChatSessionId === currentSessionId) return;
    migrateLegacyUiMetadataIntoMessages(currentSessionId);
    const msgs = ensureSessionMessages(currentSessionId);
    ensureMessageSeqInitialized(currentSessionId);
    cleanupStaleAssistantPartialSnapshot(currentSessionId);
    chatHistory = msgs;
    hydratedChatSessionId = currentSessionId;
    console.warn(`[Chat History] Re-hydrated chatHistory for ${currentSessionId}${reason ? ` (${reason})` : ''}`);
  } catch (e) {
    console.warn('[Chat History] Failed to re-hydrate chatHistory (non-fatal):', e);
  }
}
