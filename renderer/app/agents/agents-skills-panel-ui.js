// Agents & Skills Panel UI (compact design, like Plugins tab)
// Embedded in middle panel, replaces the old modal-based library

(function () {
  'use strict';

  const state = {
    view: 'agents', // 'agents' | 'skills' | 'scripts'
    query: '',
    expanded: null, // item id for inline expansion
    editMode: null, // { type: 'agent'|'skill', id: string } when editing
    scriptsSkillId: null // selected skill for scripts view
  };

  function $(id) { return document.getElementById(id); }

  function escape(t) {
    try { return escapeHtml(String(t || '')); } catch { return String(t || ''); }
  }

  function escAttr(t) {
    try { return escapeAttr(String(t || '')); } catch { return String(t || '').replace(/"/g, '&quot;'); }
  }

  // === Main Render ===
  function renderAgentsSkillsManager() {
    const panel = $('agentsSkillsManagerPanel');
    if (!panel) return;

    const projectAgents = (typeof getProjectAgentsForLibrary === 'function') ? getProjectAgentsForLibrary() : [];
    const userAgents = (typeof getUserAgentsForLibrary === 'function') ? getUserAgentsForLibrary() : [];
    const projectSkills = (typeof getProjectSkillsForLibrary === 'function') ? getProjectSkillsForLibrary() : [];
    const userSkills = (typeof getUserSkillsForLibrary === 'function') ? getUserSkillsForLibrary() : [];

    const agentsCount = (projectAgents?.length || 0) + (userAgents?.length || 0);
    const skillsCount = (projectSkills?.length || 0) + (userSkills?.length || 0);

    const newLabel = state.view === 'agents' ? 'New Agent'
      : state.view === 'skills' ? 'New Skill'
      : 'New Script';

    panel.innerHTML = `
      <div class="mcp-manager-container asl">
        <div class="codeon-panel-topbar">
          <div class="codeon-panel-titlewrap">
            <div class="codeon-panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M4 21v-2a4 4 0 0 1 3-3.87"></path>
                <circle cx="12" cy="7" r="4"></circle>
                <path d="M16 21v-2a4 4 0 0 0-4-4H12a4 4 0 0 0-4 4v2"></path>
              </svg>
              <span>Agents &amp; Skills</span>
              <span class="codeon-panel-title-pill">Library</span>
            </div>
            <div class="codeon-panel-subtitle">Manage agents, skills, and scripts for this project.</div>
          </div>
          <div class="codeon-panel-actions">
            <button class="btn-secondary" id="aslRefresh" data-action="asl-refresh" type="button">Refresh</button>
            <button class="btn-primary" id="aslNewBtn" data-action="asl-new" type="button">${newLabel}</button>
          </div>
        </div>

        <div class="asl-controls">
          <div class="asl-tabs">
            <button class="asl-tab ${state.view === 'agents' ? 'active' : ''}" type="button" data-asl-tab="agents">Agents${agentsCount ? ` (${agentsCount})` : ''}</button>
            <button class="asl-tab ${state.view === 'skills' ? 'active' : ''}" type="button" data-asl-tab="skills">Skills${skillsCount ? ` (${skillsCount})` : ''}</button>
            <button class="asl-tab ${state.view === 'scripts' ? 'active' : ''}" type="button" data-asl-tab="scripts">Scripts</button>
          </div>
          <div class="asl-search">
            <input class="asl-search-input" id="aslSearch" type="text" placeholder="Search…" value="${escAttr(state.query)}" />
          </div>
        </div>

        <div class="asl-body" id="aslBody"></div>
      </div>
    `;

    _renderBody({ projectAgents, userAgents, projectSkills, userSkills });
    _bindOnce();
  }

  function _renderBody({ projectAgents, userAgents, projectSkills, userSkills }) {
    const body = $('aslBody');
    if (!body) return;
    const q = state.query.trim().toLowerCase();

    if (state.view === 'agents') {
      const allAgents = [...(projectAgents || []), ...(userAgents || [])];
      const list = q ? allAgents.filter(a => `${a?.name || ''} ${a?.description || ''}`.toLowerCase().includes(q)) : allAgents;

      if (!list.length) {
        body.innerHTML = `
          <div class="asl-empty">
            No agents found.<br>Create one to get started.
            <div style="margin-top:12px;">
              <button class="btn-primary" data-action="asl-new" type="button">New Agent</button>
            </div>
          </div>
        `;
        return;
      }

      const projectItems = list.filter(a => isProjectAgentId && isProjectAgentId(a.id));
      const userItems = list.filter(a => isUserAgentId && isUserAgentId(a.id));

      let html = '';
      if (projectItems.length) {
        html += `<div class="asl-section"><div class="asl-section-header">Project Agents</div>`;
        html += projectItems.map(a => _renderAgentRow(a)).join('');
        html += `</div>`;
      }
      if (userItems.length) {
        html += `<div class="asl-section"><div class="asl-section-header">User Agents (~/.claude)</div>`;
        html += userItems.map(a => _renderAgentRow(a)).join('');
        html += `</div>`;
      }
      body.innerHTML = html;
      return;
    }

    if (state.view === 'skills') {
      const allSkills = [...(projectSkills || []), ...(userSkills || [])];
      const list = q ? allSkills.filter(s => `${s?.name || ''} ${s?.description || ''}`.toLowerCase().includes(q)) : allSkills;

      if (!list.length) {
        body.innerHTML = `
          <div class="asl-empty">
            No skills found.<br>Create one to get started.
            <div style="margin-top:12px;">
              <button class="btn-primary" data-action="asl-new" type="button">New Skill</button>
            </div>
          </div>
        `;
        return;
      }

      const projectItems = list.filter(s => isProjectSkillId && isProjectSkillId(s.id));
      const userItems = list.filter(s => isUserSkillId && isUserSkillId(s.id));

      let html = '';
      if (projectItems.length) {
        html += `<div class="asl-section"><div class="asl-section-header">Project Skills</div>`;
        html += projectItems.map(s => _renderSkillRow(s)).join('');
        html += `</div>`;
      }
      if (userItems.length) {
        html += `<div class="asl-section"><div class="asl-section-header">User Skills (~/.claude)</div>`;
        html += userItems.map(s => _renderSkillRow(s)).join('');
        html += `</div>`;
      }
      body.innerHTML = html;
      return;
    }

    // Scripts view
    const allProjectSkills = projectSkills || [];
    body.innerHTML = `
      <div class="asl-scripts-skill">
        <label>Skill:</label>
        <select id="aslScriptsSkillSelect">
          ${allProjectSkills.length === 0 ? '<option value="">No project skills</option>' : 
            allProjectSkills.map(s => `<option value="${escAttr(s.id)}" ${s.id === state.scriptsSkillId ? 'selected' : ''}>${escape(s.name || s.id)}</option>`).join('')}
        </select>
      </div>
      <div id="aslScriptsList" class="asl-scripts-list"></div>
    `;

    // Load scripts for selected skill
    _loadScriptsForSelectedSkill();
  }

  function _renderAgentRow(agent) {
    const name = escape(agent.name || 'Agent');
    const desc = escape(agent.description || '');
    const isUser = isUserAgentId && isUserAgentId(agent.id);
    const expanded = state.expanded === agent.id;

    return `
      <div class="asl-row${expanded ? ' expanded' : ''}" data-key="${escAttr(agent.id)}">
        <div class="asl-row-main" data-action="asl-toggle" data-key="${escAttr(agent.id)}">
          <div class="asl-row-info">
            <span class="asl-row-name">${name}</span>
            <span class="asl-row-badge ${isUser ? 'user' : ''}">${isUser ? 'User' : 'Project'}</span>
          </div>
          <span class="asl-row-chevron">${expanded ? '▾' : '▸'}</span>
        </div>
        ${expanded ? `
          <div class="asl-row-detail">
            ${desc ? `<div class="asl-row-desc">${desc}</div>` : ''}
            <div class="asl-row-path">${escape(agent.id)}</div>
            <div class="asl-row-actions">
              <button class="asl-btn-sm" data-action="asl-use-agent" data-id="${escAttr(agent.id)}" type="button">Use</button>
              ${!isUser ? `<button class="asl-btn-sm" data-action="asl-open-agent" data-id="${escAttr(agent.id)}" type="button">Open</button>` : ''}
              <button class="asl-btn-sm" data-action="asl-edit-agent" data-id="${escAttr(agent.id)}" type="button">Edit</button>
              ${isUser ? `<button class="asl-btn-sm" data-action="asl-import-agent" data-id="${escAttr(agent.id)}" type="button">Import</button>` : ''}
              <button class="asl-btn-danger" data-action="asl-delete-agent" data-id="${escAttr(agent.id)}" type="button">Delete</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function _renderSkillRow(skill) {
    const name = escape(skill.name || 'Skill');
    const desc = escape(skill.description || '');
    const isUser = isUserSkillId && isUserSkillId(skill.id);
    const expanded = state.expanded === skill.id;

    return `
      <div class="asl-row${expanded ? ' expanded' : ''}" data-key="${escAttr(skill.id)}">
        <div class="asl-row-main" data-action="asl-toggle" data-key="${escAttr(skill.id)}">
          <div class="asl-row-info">
            <span class="asl-row-name">${name}</span>
            <span class="asl-row-badge ${isUser ? 'user' : ''}">${isUser ? 'User' : 'Project'}</span>
          </div>
          <span class="asl-row-chevron">${expanded ? '▾' : '▸'}</span>
        </div>
        ${expanded ? `
          <div class="asl-row-detail">
            ${desc ? `<div class="asl-row-desc">${desc}</div>` : ''}
            <div class="asl-row-path">${escape(skill.skillFilePath || skill.id)}</div>
            <div class="asl-row-actions">
              <button class="asl-btn-sm" data-action="asl-use-skill" data-id="${escAttr(skill.id)}" type="button">Use</button>
              ${!isUser ? `<button class="asl-btn-sm" data-action="asl-open-skill" data-id="${escAttr(skill.id)}" type="button">Open</button>` : ''}
              <button class="asl-btn-sm" data-action="asl-edit-skill" data-id="${escAttr(skill.id)}" type="button">Edit</button>
              ${isUser ? `<button class="asl-btn-sm" data-action="asl-import-skill" data-id="${escAttr(skill.id)}" type="button">Import</button>` : ''}
              <button class="asl-btn-danger" data-action="asl-delete-skill" data-id="${escAttr(skill.id)}" type="button">Delete</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  async function _loadScriptsForSelectedSkill() {
    const list = $('aslScriptsList');
    const sel = $('aslScriptsSkillSelect');
    if (!list || !sel) return;

    const skillId = sel.value;
    state.scriptsSkillId = skillId;

    if (!skillId) {
      list.innerHTML = `<div class="asl-empty">Select a project skill to view its scripts.</div>`;
      return;
    }

    list.innerHTML = `<div class="asl-empty">Loading…</div>`;

    const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === skillId);
    if (!skill) {
      list.innerHTML = `<div class="asl-empty">Skill not found.</div>`;
      return;
    }

    let scripts = [];
    try {
      if (typeof listSkillScriptsForSkill === 'function') {
        scripts = await listSkillScriptsForSkill(skill);
      }
    } catch { scripts = []; }

    if (!scripts || scripts.length === 0) {
      list.innerHTML = `<div class="asl-empty">No scripts found for this skill.</div>`;
      return;
    }

    list.innerHTML = scripts.map(sc => {
      const expanded = state.expanded === sc.relPath;
      return `
        <div class="asl-row${expanded ? ' expanded' : ''}" data-key="${escAttr(sc.relPath)}">
          <div class="asl-row-main" data-action="asl-toggle" data-key="${escAttr(sc.relPath)}">
            <div class="asl-row-info">
              <span class="asl-row-name">${escape(sc.name)}</span>
            </div>
            <span class="asl-row-chevron">${expanded ? '▾' : '▸'}</span>
          </div>
          ${expanded ? `
            <div class="asl-row-detail">
              <div class="asl-row-path">${escape(sc.relPath)}</div>
              <div class="asl-row-actions">
                <button class="asl-btn-sm" data-action="asl-open-script" data-path="${escAttr(sc.relPath)}" type="button">Open</button>
                <button class="asl-btn-danger" data-action="asl-delete-script" data-path="${escAttr(sc.relPath)}" data-name="${escAttr(sc.name)}" type="button">Delete</button>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  // === Event Binding ===
  let _bound = false;
  function _bindOnce() {
    if (_bound) return;
    _bound = true;

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset?.action || '';

      // Modal close should always work (modals are global, not inside the panel)
      if (action === 'asl-close') {
        _closeAllModals();
        return;
      }
      const panel = $('agentsSkillsManagerPanel');
      if (!panel || panel.style.display === 'none') return;

      // Tab switching
      if (action === 'asl-toggle') {
        const key = btn.dataset?.key || '';
        if (!key) return;
        state.expanded = state.expanded === key ? null : key;
        renderAgentsSkillsManager();
        return;
      }

      // New + Refresh (topbar / empty states)
      if (action === 'asl-refresh') {
        await _refresh();
        return;
      }
      if (action === 'asl-new') {
        if (state.view === 'agents') _openAgentModal();
        else if (state.view === 'skills') _openSkillModal();
        else _openScriptModal();
        return;
      }

      // Agent actions
      if (action === 'asl-use-agent') {
        const id = btn.dataset?.id;
        if (id && typeof setSelectedAgentById === 'function') {
          setSelectedAgentById(id);
          if (typeof customAlert === 'function') await customAlert(`Agent "${_getAgentName(id)}" is now active.`, 'Agent Selected');
        }
        return;
      }
      if (action === 'asl-open-agent') {
        const id = btn.dataset?.id;
        // Project agents live in `.claude/agents/*.md` inside the workspace, so `openFile()` works.
        if (id && typeof openFile === 'function') await openFile(id);
        return;
      }
      if (action === 'asl-edit-agent') {
        const id = btn.dataset?.id;
        if (id) _openAgentModal(id);
        return;
      }
      if (action === 'asl-import-agent') {
        const id = btn.dataset?.id;
        if (id && typeof importUserAgentToProject === 'function') {
          try {
            await importUserAgentToProject(id);
            await _refresh();
            if (typeof customAlert === 'function') await customAlert('Agent imported to project.', 'Success');
          } catch (err) {
            if (typeof customAlert === 'function') await customAlert(err.message || 'Import failed.', 'Error');
          }
        }
        return;
      }
      if (action === 'asl-delete-agent') {
        const id = btn.dataset?.id;
        if (id && typeof deleteAgentFromLibrary === 'function') {
          try {
            const result = await deleteAgentFromLibrary(id);
            if (result) {
              await _refresh();
            }
          } catch (err) {
            if (typeof customAlert === 'function') await customAlert(err.message || 'Delete failed.', 'Error');
          }
        }
        return;
      }

      // Skill actions
      if (action === 'asl-use-skill') {
        const id = btn.dataset?.id;
        if (id && typeof setSelectedSkillById === 'function') {
          setSelectedSkillById(id);
          if (typeof customAlert === 'function') await customAlert(`Skill "${_getSkillName(id)}" is now active.`, 'Skill Selected');
        }
        return;
      }
      if (action === 'asl-open-skill') {
        const id = btn.dataset?.id;
        // Project skills should open the SKILL.md entrypoint file.
        if (id && typeof openFile === 'function') {
          const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === id);
          let path = String(skill?.skillFilePath || '').trim();
          if (!path) {
            const raw = String(id || '').trim();
            if (raw.toLowerCase().endsWith('.md')) path = raw;
            else path = `${raw.replace(/\/+$/, '')}/SKILL.md`;
          }
          await openFile(path);
        }
        return;
      }
      if (action === 'asl-edit-skill') {
        const id = btn.dataset?.id;
        if (id) _openSkillModal(id);
        return;
      }
      if (action === 'asl-import-skill') {
        const id = btn.dataset?.id;
        if (id && typeof importUserSkillToProject === 'function') {
          try {
            await importUserSkillToProject(id);
            await _refresh();
            if (typeof customAlert === 'function') await customAlert('Skill imported to project.', 'Success');
          } catch (err) {
            if (typeof customAlert === 'function') await customAlert(err.message || 'Import failed.', 'Error');
          }
        }
        return;
      }
      if (action === 'asl-delete-skill') {
        const id = btn.dataset?.id;
        if (id && typeof deleteSkillFromLibrary === 'function') {
          try {
            const result = await deleteSkillFromLibrary(id);
            if (result) {
              await _refresh();
            }
          } catch (err) {
            if (typeof customAlert === 'function') await customAlert(err.message || 'Delete failed.', 'Error');
          }
        }
        return;
      }

      // Script actions
      if (action === 'asl-open-script') {
        const path = btn.dataset?.path;
        if (path && typeof openFile === 'function') await openFile(path);
        return;
      }
      if (action === 'asl-delete-script') {
        const path = btn.dataset?.path;
        const name = btn.dataset?.name;
        if (path && typeof deleteScriptFromLibrary === 'function') {
          try {
            const result = await deleteScriptFromLibrary(path, name);
            if (result) {
              await _loadScriptsForSelectedSkill();
            }
          } catch (err) {
            if (typeof customAlert === 'function') await customAlert(err.message || 'Delete failed.', 'Error');
          }
        }
        return;
      }

    });

    // Tab buttons
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-asl-tab]');
      if (!tab) return;
      const panel = $('agentsSkillsManagerPanel');
      if (!panel || panel.style.display === 'none') return;
      const view = tab.dataset?.aslTab;
      if (view && ['agents', 'skills', 'scripts'].includes(view)) {
        state.view = view;
        state.expanded = null;
        state.query = '';
        renderAgentsSkillsManager();
      }
    });

    // Search input
    document.addEventListener('input', (e) => {
      if (e.target.id === 'aslSearch') {
        state.query = e.target.value || '';
        // Debounce render
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(() => renderAgentsSkillsManager(), 150);
      }
    });

    // Scripts skill select
    document.addEventListener('change', (e) => {
      if (e.target.id === 'aslScriptsSkillSelect') {
        _loadScriptsForSelectedSkill();
      }
    });

    // Escape to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        _closeAllModals();
      }
    });
  }
  let _searchDebounce = null;

  // === Modal Handlers ===
  function _openAgentModal(editId = null) {
    const modal = $('aslAgentModal');
    const title = $('aslAgentModalTitle');
    const loc = $('aslAgentLocation');
    const name = $('aslAgentName');
    const desc = $('aslAgentDesc');
    const body = $('aslAgentBody');
    const saveBtn = $('aslAgentSaveBtn');
    if (!modal || !title || !loc || !name || !desc || !body || !saveBtn) return;

    state.editMode = editId ? { type: 'agent', id: editId } : null;

    if (editId) {
      title.textContent = 'Edit Agent';
      saveBtn.textContent = 'Update';
      const agent = (Array.isArray(availableAgents) ? availableAgents : []).find(a => a && a.id === editId);
      if (agent) {
        loc.value = (isUserAgentId && isUserAgentId(editId)) ? 'user' : 'project';
        loc.disabled = true;
        name.value = agent.name || '';
        desc.value = agent.description || '';
        body.value = agent.instructions || '';
      }
    } else {
      title.textContent = 'Create Agent';
      saveBtn.textContent = 'Create';
      loc.value = 'project';
      loc.disabled = false;
      name.value = '';
      desc.value = '';
      body.value = '';
    }

    modal.style.display = 'flex';
    name.focus();

    // Save handler
    saveBtn.onclick = async () => {
      const nm = name.value.trim();
      if (!nm) {
        if (typeof customAlert === 'function') await customAlert('Agent name is required.', 'Validation');
        return;
      }
      try {
        if (state.editMode?.type === 'agent') {
          await _updateAgent(state.editMode.id, { name: nm, description: desc.value, instructions: body.value });
        } else {
          await createAgentFromLibrary({ location: loc.value, name: nm, description: desc.value, instructions: body.value });
        }
        _closeAllModals();
        await _refresh();
      } catch (err) {
        if (typeof customAlert === 'function') await customAlert(err.message || 'Failed to save agent.', 'Error');
      }
    };
  }

  function _openSkillModal(editId = null) {
    const modal = $('aslSkillModal');
    const title = $('aslSkillModalTitle');
    const loc = $('aslSkillLocation');
    const name = $('aslSkillName');
    const dir = $('aslSkillDir');
    const desc = $('aslSkillDesc');
    const body = $('aslSkillBody');
    const saveBtn = $('aslSkillSaveBtn');
    if (!modal || !title || !loc || !name || !dir || !desc || !body || !saveBtn) return;

    state.editMode = editId ? { type: 'skill', id: editId } : null;

    if (editId) {
      title.textContent = 'Edit Skill';
      saveBtn.textContent = 'Update';
      const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === editId);
      if (skill) {
        loc.value = (isUserSkillId && isUserSkillId(editId)) ? 'user' : 'project';
        loc.disabled = true;
        name.value = skill.name || '';
        // Extract dir from skill id
        let dirName = '';
        if (isUserSkillId && isUserSkillId(editId)) {
          dirName = editId.replace(/^user:/, '');
        } else {
          dirName = editId.replace(/^\.claude\/skills\//, '');
        }
        dir.value = dirName;
        dir.disabled = true;
        desc.value = skill.description || '';
        body.value = skill.instructions || '';
      }
    } else {
      title.textContent = 'Create Skill';
      saveBtn.textContent = 'Create';
      loc.value = 'project';
      loc.disabled = false;
      name.value = '';
      dir.value = '';
      dir.disabled = false;
      desc.value = '';
      body.value = '';
    }

    modal.style.display = 'flex';
    name.focus();

    saveBtn.onclick = async () => {
      const nm = name.value.trim();
      if (!nm) {
        if (typeof customAlert === 'function') await customAlert('Skill name is required.', 'Validation');
        return;
      }
      try {
        if (state.editMode?.type === 'skill') {
          await _updateSkill(state.editMode.id, { displayName: nm, description: desc.value, instructions: body.value });
        } else {
          await createSkillFromLibrary({ location: loc.value, displayName: nm, dirName: dir.value, description: desc.value, instructions: body.value });
        }
        _closeAllModals();
        await _refresh();
      } catch (err) {
        if (typeof customAlert === 'function') await customAlert(err.message || 'Failed to save skill.', 'Error');
      }
    };
  }

  function _openScriptModal() {
    const modal = $('aslScriptModal');
    const skillSel = $('aslScriptSkill');
    const name = $('aslScriptName');
    const type = $('aslScriptType');
    const body = $('aslScriptBody');
    const saveBtn = $('aslScriptSaveBtn');
    if (!modal || !skillSel || !name || !type || !body || !saveBtn) return;

    // Populate skills
    const projectSkills = (typeof getProjectSkillsForLibrary === 'function') ? getProjectSkillsForLibrary() : [];
    skillSel.innerHTML = projectSkills.length === 0
      ? '<option value="">No project skills</option>'
      : projectSkills.map(s => `<option value="${escAttr(s.id)}">${escape(s.name || s.id)}</option>`).join('');
    skillSel.disabled = projectSkills.length === 0;

    name.value = '';
    type.value = 'sh';
    body.value = _getScriptTemplate('sh');

    modal.style.display = 'flex';
    name.focus();

    type.onchange = () => {
      if (!body.value.trim() || body.value === _getScriptTemplate('sh') || body.value === _getScriptTemplate('js') || body.value === _getScriptTemplate('py')) {
        body.value = _getScriptTemplate(type.value);
      }
    };

    saveBtn.onclick = async () => {
      const skillId = skillSel.value;
      const fileName = name.value.trim();
      if (!skillId) {
        if (typeof customAlert === 'function') await customAlert('Select a skill first.', 'Validation');
        return;
      }
      if (!fileName) {
        if (typeof customAlert === 'function') await customAlert('Script file name is required.', 'Validation');
        return;
      }
      try {
        await _createScript(skillId, fileName, body.value);
        _closeAllModals();
        await _loadScriptsForSelectedSkill();
      } catch (err) {
        if (typeof customAlert === 'function') await customAlert(err.message || 'Failed to create script.', 'Error');
      }
    };
  }

  function _getScriptTemplate(type) {
    if (type === 'sh') return '#!/bin/bash\n\n# Your script here\n';
    if (type === 'js') return '#!/usr/bin/env node\n\n// Your script here\n';
    if (type === 'py') return '#!/usr/bin/env python3\n\n# Your script here\n';
    return '';
  }

  function _closeAllModals() {
    ['aslAgentModal', 'aslSkillModal', 'aslScriptModal'].forEach(id => {
      const m = $(id);
      if (m) m.style.display = 'none';
    });
    state.editMode = null;
  }

  // === Data Operations ===
  async function _refresh() {
    try {
      if (typeof loadProjectAgents === 'function') await loadProjectAgents();
      if (typeof loadProjectSkills === 'function') await loadProjectSkills();
    } catch { /* ignore */ }
    renderAgentsSkillsManager();
  }

  async function _updateAgent(agentId, { name, description, instructions }) {
    const agent = (Array.isArray(availableAgents) ? availableAgents : []).find(a => a && a.id === agentId);
    if (!agent) throw new Error('Agent not found.');

    const front = `---\nname: ${name}\ndescription: ${description}\n---\n`;
    const content = `${front}\n${instructions}\n`;

    if (isUserAgentId && isUserAgentId(agentId)) {
      const rel = agentId.replace(/^user:/, '');
      if (!window.electronAPI?.userClaudeWriteFile) throw new Error('API not available.');
      const wr = await window.electronAPI.userClaudeWriteFile({ area: 'agents', relPath: rel, content, isBase64: false });
      if (!wr?.success) throw new Error(wr?.error || 'Failed to update agent.');
    } else {
      if (!window.electronAPI?.writeFile) throw new Error('API not available.');
      const wr = await window.electronAPI.writeFile(agentId, content, false);
      if (!wr?.success) throw new Error(wr?.error || 'Failed to update agent.');
    }
  }

  async function _updateSkill(skillId, { displayName, description, instructions }) {
    const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === skillId);
    if (!skill) throw new Error('Skill not found.');

    const content = `---\nname: ${displayName}\ndescription: ${description}\n---\n\n${instructions}\n`;

    if (isUserSkillId && isUserSkillId(skillId)) {
      const dir = skillId.replace(/^user:/, '');
      if (!window.electronAPI?.userClaudeWriteFile) throw new Error('API not available.');
      const wr = await window.electronAPI.userClaudeWriteFile({ area: 'skills', relPath: `${dir}/SKILL.md`, content, isBase64: false });
      if (!wr?.success) throw new Error(wr?.error || 'Failed to update skill.');
    } else {
      const skillPath = skill.skillFilePath || `${skillId}/SKILL.md`;
      if (!window.electronAPI?.writeFile) throw new Error('API not available.');
      const wr = await window.electronAPI.writeFile(skillPath, content, false);
      if (!wr?.success) throw new Error(wr?.error || 'Failed to update skill.');
    }
  }

  async function _createScript(skillId, fileName, content) {
    const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === skillId);
    if (!skill) throw new Error('Skill not found.');

    const base = skillId.replace(/\/+$/, '');
    const scriptsDir = `${base}/scripts`;
    const filePath = `${scriptsDir}/${fileName}`;

    if (!window.electronAPI?.createDirectory || !window.electronAPI?.writeFile) {
      throw new Error('File APIs not available.');
    }

    await window.electronAPI.createDirectory(scriptsDir);
    const wr = await window.electronAPI.writeFile(filePath, content, false);
    if (!wr?.success) throw new Error(wr?.error || 'Failed to create script.');
  }

  function _getAgentName(id) {
    const agent = (Array.isArray(availableAgents) ? availableAgents : []).find(a => a && a.id === id);
    return agent?.name || 'Agent';
  }

  function _getSkillName(id) {
    const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === id);
    return skill?.name || 'Skill';
  }

  // === Public API ===
  async function showAgentsSkillsManager() {
    const panel = $('agentsSkillsManagerPanel');
    if (!panel) return;
    panel.style.display = 'flex';
    await _refresh();
  }

  function hideAgentsSkillsManager() {
    const panel = $('agentsSkillsManagerPanel');
    if (panel) panel.style.display = 'none';
    _closeAllModals();
  }

  // Expose to window
  window.showAgentsSkillsManager = showAgentsSkillsManager;
  window.hideAgentsSkillsManager = hideAgentsSkillsManager;
  window.renderAgentsSkillsManager = renderAgentsSkillsManager;

  // === Legacy compat: redirect old modal functions ===
  // These are called by existing code and should now work with the panel
  window.showAgentSkillLibrary = showAgentsSkillsManager;
  window.hideAgentSkillLibrary = hideAgentsSkillsManager;
  window.renderAgentSkillLibrary = renderAgentsSkillsManager;
})();
