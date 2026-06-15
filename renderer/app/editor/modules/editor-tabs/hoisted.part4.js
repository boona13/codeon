// ---- CHUNK 4/7 from hoisted.js (AST statement boundaries; order preserved) ----


function setupEventListeners() {
  // NOTE: This function is called once on startup, but during iterative UI work
  // it may be invoked again (or code may change while the app stays open).
  // We keep the original global guard, but still allow safe, idempotent bindings
  // for new UI elements (like the composer @ picker).
  const alreadyInit = !!window.hasInitializedListeners;
  if (!alreadyInit) window.hasInitializedListeners = true;

  // Chat smart auto-scroll: follow streaming only while user is at/near bottom.
  // If the user scrolls up, we stop auto-following until they return near bottom.
  try {
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) bindChatAutoScrollOnce(messagesContainer);
  } catch { /* ignore */ }

  // Folder operations
  if (!alreadyInit) document.getElementById('openFolderButton').addEventListener('click', openFolder);

  // Settings
  if (!alreadyInit) {
    document.getElementById('settingsButton').addEventListener('click', openSettings);
    document.getElementById('closeSettingsButton').addEventListener('click', closeSettings);
    document.getElementById('saveSettingsButton').addEventListener('click', saveSettingsAndClose);
    document.getElementById('cancelSettingsButton').addEventListener('click', closeSettings);
    document.getElementById('configureApiKey').addEventListener('click', openSettings);
  }

  // Network policy UI: show/hide allowlist field based on selection
  if (!alreadyInit) {
    try {
      const modeEl = document.getElementById('networkPolicyModeInput');
      const allowlistGroup = document.getElementById('networkAllowlistGroup');
      if (modeEl) {
        modeEl.addEventListener('change', () => {
          try {
            const v = String(modeEl.value || '').trim();
            if (allowlistGroup) allowlistGroup.style.display = (v === 'allowlist') ? '' : 'none';
          } catch {
            // ignore
          }
        });
      }
    } catch {
      // ignore
    }
  }

  // Agent mode (permission mode) quick selector in composer
  if (!alreadyInit) {
    try {
      const permissionModeComposerInput = document.getElementById('permissionModeComposerInput');
      if (permissionModeComposerInput) {
        permissionModeComposerInput.addEventListener('change', async () => {
          const raw = String(permissionModeComposerInput.value || '').trim();
          const allowed = new Set(['plan', 'default', 'acceptEdits', 'bypassPermissions']);
          const mode = allowed.has(raw) ? raw : 'acceptEdits';
          const prevMode = (settings && typeof settings.permissionMode === 'string') ? settings.permissionMode : '';
          settings.permissionMode = mode;
          if (mode !== 'plan') settings.lastNonPlanPermissionMode = mode;
          else if (prevMode && prevMode !== 'plan') settings.lastNonPlanPermissionMode = prevMode;
          try {
            const permissionModeInput = document.getElementById('permissionModeInput');
            if (permissionModeInput) permissionModeInput.value = mode;
          } catch { /* ignore */ }
          await saveSettings();
          try { if (typeof window.renderLearningPanel === 'function') window.renderLearningPanel(); } catch { /* ignore */ }
          try { if (typeof window.renderDocsPanel === 'function') window.renderDocsPanel(); } catch { /* ignore */ }
        });
      }
    } catch {
      // ignore
    }
  }

  // Claude model quick selector in composer
  if (!alreadyInit) {
    try {
      const modelEl = document.getElementById('claudeModelComposerInput');
      if (modelEl) {
        // Populate options once on startup
        refreshClaudeModelComposerSelect({ force: false }).catch(() => {});
        modelEl.addEventListener('change', async () => {
          const raw = String(modelEl.value || '').trim();
          const provider = settings?.llmProvider || 'claude_ai';
          
          if (provider === 'openrouter') {
            // For OpenRouter, save to openrouterModel
            settings.openrouterModel = raw;
          } else if (provider === 'codex') {
            // For Codex, save to codexModel
            settings.codexModel = raw || 'codex/gpt-5.5';
          } else {
            // For Anthropic, save to claudeModel
            settings.claudeModel = (raw.toLowerCase() === 'default') ? '' : raw;
          }
          await saveSettings();
        });
      }
    } catch {
      // ignore
    }
  }

  // Claude account helpers
  const loginBtn = document.getElementById('claudeLoginButton');
  if (loginBtn) {
    loginBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      // Dedupe: avoid opening multiple Terminal windows if the handler is triggered twice.
      if (loginBtn.dataset && loginBtn.dataset.inFlight === '1') return;
      if (loginBtn.dataset) loginBtn.dataset.inFlight = '1';
      try { loginBtn.disabled = true; } catch { /* ignore */ }
      closeSettings();
      // Claude Code's /login flow requires a real terminal TTY to reliably open the browser and complete auth.
      // Use the official `setup-token` flow (subscription) in the system Terminal, then return to the app.
      // Show auth gate modal which polls for login success and auto-dismisses.
      openAuthGateModal({
        statusText: 'Opening Terminal…',
        subtitleText: 'Complete the Claude Code "setup-token" flow in Terminal, then come back to Codeon.'
      });
      if (window.electronAPI && typeof window.electronAPI.openClaudeSetupTokenTerminal === 'function') {
        const res = await window.electronAPI.openClaudeSetupTokenTerminal();
        if (!res || res.success !== true) {
          openAuthGateModal({
            statusText: `Failed to open Terminal: ${res?.error || 'Unknown error'}`,
            subtitleText: 'Try again, or use an API key instead.'
          });
        } else {
          // After setup-token, prefer Claude.ai auth (avoid continuing to use API key by default).
          settings.authMode = 'claude_ai';
          await saveSettings();
          applyClaudeAuthSettingsUI({ refreshStatus: true });
          openAuthGateModal({
            statusText: 'Terminal opened. Waiting for sign-in…',
            subtitleText: 'Finish the setup-token flow in Terminal. This popup will close automatically once you are signed in.'
          });
        }
      } else {
        openAuthGateModal({
          statusText: 'Terminal login helper is not available',
          subtitleText: 'Open Settings and configure an API key instead.'
        });
      }
      try { if (loginBtn.dataset) loginBtn.dataset.inFlight = '0'; } catch { /* ignore */ }
      try { loginBtn.disabled = false; } catch { /* ignore */ }
    });
  }

  // Editor tab context menu (idempotent)
  try { bindEditorTabContextMenuOnce(); } catch { /* ignore */ }

  // Auth gate modal actions (shown on project open when login isn't ready)
  const authGateClose = document.getElementById('closeAuthGateButton');
  if (authGateClose) authGateClose.addEventListener('click', closeAuthGateModal);
  const authGateNotNow = document.getElementById('authGateNotNowButton');
  if (authGateNotNow) authGateNotNow.addEventListener('click', closeAuthGateModal);

  const authGateUseApiKey = document.getElementById('authGateUseApiKeyButton');
  if (authGateUseApiKey) {
    authGateUseApiKey.addEventListener('click', async () => {
      try {
        settings.authMode = 'api_key';
        await saveSettings();
        applyClaudeAuthSettingsUI({ refreshStatus: false });
        closeAuthGateModal();
        openSettings();
        try {
          const apiKeyInput = document.getElementById('apiKeyInput');
          apiKeyInput?.focus?.();
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    });
  }

  const authGateSignIn = document.getElementById('authGateSignInButton');
  if (authGateSignIn) {
    authGateSignIn.addEventListener('click', async () => {
      try {
        // Dedupe this click while in flight
        if (authGateSignIn.dataset && authGateSignIn.dataset.inFlight === '1') return;
        if (authGateSignIn.dataset) authGateSignIn.dataset.inFlight = '1';
        try { authGateSignIn.disabled = true; } catch { /* ignore */ }

        // Keep the modal open and start watching; it will auto-dismiss when login is detected.
        openAuthGateModal({
          statusText: 'Opening Terminal…',
          subtitleText: 'Complete the Claude Code “setup-token” flow in Terminal, then come back to Codeon.'
        });
        if (window.electronAPI && typeof window.electronAPI.openClaudeSetupTokenTerminal === 'function') {
          const res = await window.electronAPI.openClaudeSetupTokenTerminal();
          if (!res || res.success !== true) {
            openAuthGateModal({
              statusText: `Failed to open Terminal: ${res?.error || 'Unknown error'}`,
              subtitleText: 'Try again, or use an API key instead.'
            });
          } else {
            settings.authMode = 'claude_ai';
            await saveSettings();
            applyClaudeAuthSettingsUI({ refreshStatus: true });
            openAuthGateModal({
              statusText: 'Terminal opened. Waiting for sign-in…',
              subtitleText: 'Finish the setup-token flow in Terminal. This popup will close automatically once you’re signed in.'
            });
          }
        } else {
          openAuthGateModal({
            statusText: 'Terminal login helper is not available',
            subtitleText: 'Open Settings and configure an API key instead.'
          });
        }
      } catch (e) {
        openAuthGateModal({
          statusText: `Login failed: ${e?.message || String(e)}`,
          subtitleText: 'Try again, or use an API key instead.'
        });
      } finally {
        try { if (authGateSignIn.dataset) authGateSignIn.dataset.inFlight = '0'; } catch { /* ignore */ }
        try { authGateSignIn.disabled = false; } catch { /* ignore */ }
      }
    });
  }

  // LLM Provider radio buttons
  const providerClaudeAi = document.getElementById('providerClaudeAiRadio');
  const providerAnthropic = document.getElementById('providerAnthropicRadio');
  const providerOpenRouter = document.getElementById('providerOpenRouterRadio');
  const providerCodex = document.getElementById('providerCodexRadio');

  [providerClaudeAi, providerAnthropic, providerOpenRouter, providerCodex].forEach(radio => {
    if (radio) {
      radio.addEventListener('change', async () => {
        if (radio.checked) {
          settings.llmProvider = radio.value;
          await saveSettings();
          applyLlmProviderUI();
          if (radio.value === 'claude_ai') {
            applyClaudeAuthSettingsUI({ refreshStatus: true });
          }
          if (radio.value === 'codex') {
            try { refreshCodexStatusUI(); } catch { /* ignore */ }
            try { refreshCodexModelsUI(); } catch { /* ignore */ }
          }
          // Refresh composer model dropdown to show appropriate models
          try {
            refreshClaudeModelComposerSelect({ force: true }).catch(() => {});
          } catch { /* ignore */ }
        }
      });
    }
  });

  // Codex (ChatGPT) login / logout / model controls
  try {
    const codexLoginBtn = document.getElementById('codexLoginButton');
    const codexLogoutBtn = document.getElementById('codexLogoutButton');
    const codexRefreshBtn = document.getElementById('refreshCodexModelsButton');
    const codexModelEl = document.getElementById('codexModelInput');
    let codexPoll = null;

    const stopCodexPoll = () => { if (codexPoll) { clearInterval(codexPoll); codexPoll = null; } };

    if (codexLoginBtn && !codexLoginBtn.dataset.bound) {
      codexLoginBtn.dataset.bound = '1';
      codexLoginBtn.addEventListener('click', async () => {
        if (!window.electronAPI || !window.electronAPI.codex) return;
        codexLoginBtn.disabled = true;
        try {
          const res = await window.electronAPI.codex.login();
          if (!res || !res.success) {
            try { showToast(`Codex sign-in failed: ${res?.error || 'unknown error'}`, 'error'); } catch { /* ignore */ }
          } else {
            // Poll status until connected (the browser completes the OAuth callback).
            stopCodexPoll();
            let ticks = 0;
            codexPoll = setInterval(async () => {
              ticks++;
              await refreshCodexStatusUI();
              try {
                const st = await window.electronAPI.codex.status();
                if (st && st.success && st.status && st.status.connected) {
                  stopCodexPoll();
                  await refreshCodexModelsUI();
                  try { await refreshClaudeModelComposerSelect({ force: true }); } catch { /* ignore */ }
                }
              } catch { /* ignore */ }
              if (ticks > 150) stopCodexPoll(); // ~5 min safety
            }, 2000);
          }
        } finally {
          codexLoginBtn.disabled = false;
        }
      });
    }

    if (codexLogoutBtn && !codexLogoutBtn.dataset.bound) {
      codexLogoutBtn.dataset.bound = '1';
      codexLogoutBtn.addEventListener('click', async () => {
        if (!window.electronAPI || !window.electronAPI.codex) return;
        stopCodexPoll();
        try { await window.electronAPI.codex.logout(); } catch { /* ignore */ }
        await refreshCodexStatusUI();
      });
    }

    if (codexRefreshBtn && !codexRefreshBtn.dataset.bound) {
      codexRefreshBtn.dataset.bound = '1';
      codexRefreshBtn.addEventListener('click', async () => {
        await refreshCodexModelsUI();
        await refreshCodexStatusUI();
        try { await refreshClaudeModelComposerSelect({ force: true }); } catch { /* ignore */ }
      });
    }

    if (codexModelEl && !codexModelEl.dataset.bound) {
      codexModelEl.dataset.bound = '1';
      codexModelEl.addEventListener('change', async () => {
        settings.codexModel = String(codexModelEl.value || '').trim() || 'codex/gpt-5.5';
        await saveSettings();
      });
    }
  } catch { /* ignore */ }

  // (Removed) chat model selector + temperature slider (Claude SDK wrapper uses Claude Code defaults)

  // Attachments
  if (!alreadyInit) {
    document.getElementById('attachmentButton').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
  }

  // Composer @ context picker
  try {
    const atBtn = document.getElementById('composerAtButton');
    if (atBtn) {
      if (atBtn.dataset && atBtn.dataset.bound === '1') {
        // already bound
      } else {
        if (atBtn.dataset) atBtn.dataset.bound = '1';
        atBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isComposerContextPopoverOpen()) closeComposerContextPopover();
        else await openComposerContextPopover({ trigger: 'button', query: '' });
        });
      }
    }

    const popover = document.getElementById('composerContextPopover');
    if (popover) {
      if (popover.dataset && popover.dataset.bound === '1') {
        // already bound
      } else {
        if (popover.dataset) popover.dataset.bound = '1';
        popover.addEventListener('click', async (e) => {
          // Handle back button
          const backBtn = e.target && e.target.closest ? e.target.closest('#composerContextBack') : null;
          if (backBtn) {
            e.preventDefault();
            navigateComposerContextBack();
            return;
          }

          // Handle category selection
          const catEl = e.target && e.target.closest ? e.target.closest('.composer-context-category-item') : null;
          if (catEl) {
            const cat = String(catEl.dataset.category || '').trim();
            if (cat) navigateComposerContextToCategory(cat);
            return;
          }

          // Handle item selection (file/folder, agent, skill)
          const el = e.target && e.target.closest ? e.target.closest('.composer-context-item') : null;
          if (!el) return;

          const itemType = String(el.dataset.type || '').trim();
          const itemId = String(el.dataset.id || '').trim();

          if (itemType === 'agent' && itemId) {
            await handleComposerContextAgentPick(itemId);
            return;
          }
          if (itemType === 'skill' && itemId) {
            await handleComposerContextSkillPick(itemId);
            return;
          }

          // File/folder item
          const rel = String(el.dataset.rel || '').trim();
          const kind = String(el.dataset.kind || '').trim(); // 'file' | 'folder'
          await handleComposerContextPick(rel, kind);
        });
      }
    }

    // Click outside closes the popover
    if (!window.__composerContextOutsideClickBound) {
      window.__composerContextOutsideClickBound = true;
      document.addEventListener('click', (e) => {
        if (!isComposerContextPopoverOpen()) return;
        const { popover, btn } = getComposerContextPopoverEls();
        const t = e.target;
        if (popover && popover.contains(t)) return;
        if (btn && btn.contains(t)) return;
        closeComposerContextPopover();
      });
    }

    if (!window.__composerContextResizeBound) {
      window.__composerContextResizeBound = true;
      window.addEventListener('resize', () => {
        if (isComposerContextPopoverOpen()) positionComposerContextPopover();
      });
    }
  } catch { /* ignore */ }

  // Drag and drop for attachments
  const chatInputWrapper = document.querySelector('.chat-input-wrapper');
  chatInputWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    chatInputWrapper.style.background = 'rgba(20, 184, 166, 0.1)';
  });
  chatInputWrapper.addEventListener('dragleave', (e) => {
    e.preventDefault();
    chatInputWrapper.style.background = '';
  });
  chatInputWrapper.addEventListener('drop', async (e) => {
    e.preventDefault();
    chatInputWrapper.style.background = '';
    const dt = e.dataTransfer;
    const files = Array.from((dt && dt.files) ? dt.files : []);
    if (files.length > 0) {
    for (const file of files) {
      await addAttachment(file);
      }
      return;
    }

    // Support dragging a file from the in-app workspace file explorer (usually comes through as text/plain or text/uri-list)
    const paths = extractWorkspaceDropPaths(dt);
    if (paths.length > 0) {
      for (const p of paths) {
        await addWorkspaceFileAttachment(p);
      }
    }
  });

  // Chat
  document.getElementById('sendButton').addEventListener('click', () => {
    if (currentSessionId && isSessionProcessing(currentSessionId)) {
      stopProcessing(currentSessionId);
    } else {
      sendMessage();
    }
  });
  
  // Agents (project-scoped `.claude/agents`)
  const agentSelect = document.getElementById('agentSelect');
  if (agentSelect) {
    agentSelect.addEventListener('change', async () => {
      try {
        const sid = currentSessionId;
        if (!sid) return;
        const id = String(agentSelect.value || '').trim();
        setActiveAgentForSession(sid, id, { persist: true });
      } catch {
        // ignore
      }
    });
  }

  // Agent import/export
  const agentImportBtn = document.getElementById('agentImportButton');
  if (agentImportBtn) {
    agentImportBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const sid = currentSessionId;
      const agentId = getActiveAgentId(sid);
      if (!agentId || !isUserAgentId(agentId)) return;
      const rel = userAgentRelPath(agentId);
      if (!window.electronAPI || typeof window.electronAPI.userClaudeReadAgent !== 'function') return;
      const rr = await window.electronAPI.userClaudeReadAgent(rel);
      if (!rr || rr.success !== true || typeof rr.content !== 'string') {
        await customAlert(`Failed to read user agent.\n\n${rr?.error || 'Unknown error'}`, 'Agent Import');
        return;
      }
      if (!window.electronAPI || typeof window.electronAPI.createDirectory !== 'function' || typeof window.electronAPI.writeFile !== 'function') {
        await customAlert('Project file APIs are not available.', 'Agent Import');
        return;
      }
      const fileName = rel.split(/[/\\]/).pop() || 'agent.md';
      const targetDir = '.claude/agents/imported';
      await window.electronAPI.createDirectory(targetDir);
      const targetPath = `${targetDir}/${fileName}`;
      const wr = await window.electronAPI.writeFile(targetPath, rr.content, false);
      if (!wr || wr.success !== true) {
        await customAlert(`Failed to write agent into project.\n\n${wr?.error || 'Unknown error'}`, 'Agent Import');
        return;
      }
      window.addConsoleMessage?.(`Imported agent to ${targetPath}`, 'success', sid);
      try { await loadProjectAgents(); } catch { /* ignore */ }
      setActiveAgentForSession(sid, targetPath, { persist: true });
    });
  }

  const agentExportBtn = document.getElementById('agentExportButton');
  if (agentExportBtn) {
    agentExportBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const sid = currentSessionId;
      const agentId = getActiveAgentId(sid);
      if (!agentId || !isProjectAgentId(agentId)) return;
      if (!window.electronAPI || typeof window.electronAPI.readFile !== 'function' || typeof window.electronAPI.userClaudeWriteFile !== 'function') {
        await customAlert('Export APIs are not available.', 'Agent Export');
        return;
      }
      const rr = await window.electronAPI.readFile(agentId);
      if (!rr || rr.success !== true || typeof rr.content !== 'string') {
        await customAlert(`Failed to read project agent.\n\n${rr?.error || 'Unknown error'}`, 'Agent Export');
        return;
      }
      const fileName = agentId.split(/[/\\]/).pop() || 'agent.md';
      const outRel = `exported/${fileName}`;
      const wr = await window.electronAPI.userClaudeWriteFile({ area: 'agents', relPath: outRel, content: rr.content, isBase64: false });
      if (!wr || wr.success !== true) {
        await customAlert(`Failed to export agent.\n\n${wr?.error || 'Unknown error'}`, 'Agent Export');
        return;
      }
      window.addConsoleMessage?.(`Exported agent to ~/.claude/agents/${outRel}`, 'success', sid);
      try { await loadProjectAgents(); } catch { /* ignore */ }
      updateImportExportButtonsForSession(sid);
    });
  }

  // Skills (Claude Code semantics: auto-discovered; explicit invocation via "/<skill-name>")
  const skillSelect = document.getElementById('skillSelect');
  if (skillSelect) {
    skillSelect.addEventListener('change', async () => {
      try {
        const sid = currentSessionId;
        if (!sid) return;
        const id = String(skillSelect.value || '').trim();
        setPendingSkillForSession(sid, id);
      } catch {
        // ignore
      }
    });
  }

  // Skill import/export (full directory copy; exported/imported under dedicated folders)
  const skillImportBtn = document.getElementById('skillImportButton');
  if (skillImportBtn) {
    skillImportBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const sid = currentSessionId;
      const skillId = getPendingSkillId(sid);
      if (!skillId || !isUserSkillId(skillId)) return;
      const skillDir = skillIdToProjectSkillDir(skillId);
      if (!skillDir) return;

      if (!window.electronAPI || typeof window.electronAPI.userClaudeListSkills !== 'function' || typeof window.electronAPI.userClaudeReadFile !== 'function') {
        await customAlert('User skill APIs are not available.', 'Skill Import');
        return;
      }
      if (!window.electronAPI || typeof window.electronAPI.createDirectory !== 'function' || typeof window.electronAPI.writeFile !== 'function') {
        await customAlert('Project file APIs are not available.', 'Skill Import');
        return;
      }

      const listRes = await window.electronAPI.userClaudeListSkills();
      if (!listRes || listRes.success !== true || !Array.isArray(listRes.files)) {
        await customAlert(`Failed to list user skills.\n\n${listRes?.error || 'Unknown error'}`, 'Skill Import');
        return;
      }
      const entries = flattenFileTreeEntries(listRes.files);
      const prefix = `${skillDir.replace(/\/+$/g, '')}/`;
      const files = entries
        // Accept both Skill.md (legacy) and SKILL.md (Claude Code docs canonical).
        .filter(e => e && e.type === 'file' && typeof e.path === 'string' && (
          e.path === `${skillDir}/Skill.md` || e.path === `${skillDir}/SKILL.md` || e.path.startsWith(prefix)
        ))
        .map(e => String(e.path));

      const targetBase = `.claude/skills/imported/${skillDir}`;
      await window.electronAPI.createDirectory(targetBase);

      let copied = 0;
      for (const relPath of files.slice(0, 300)) {
        const readRes = await window.electronAPI.userClaudeReadFile({ area: 'skills', relPath });
        if (!readRes || readRes.success !== true) continue;
        // If relPath is the root skill file, standardize to SKILL.md when importing.
        const sub = relPath.startsWith(prefix) ? relPath.slice(prefix.length) : 'SKILL.md';
        const target = `${targetBase}/${sub}`;
        const parent = target.split('/').slice(0, -1).join('/');
        if (parent) await window.electronAPI.createDirectory(parent);
        const isBase64 = readRes.isBase64 === true;
        const wr = await window.electronAPI.writeFile(target, readRes.content || '', isBase64);
        if (wr && wr.success) copied++;
      }
      window.addConsoleMessage?.(`Imported skill to ${targetBase} (${copied} file(s))`, 'success', sid);
      try { await loadProjectSkills(); } catch { /* ignore */ }
      setPendingSkillForSession(sid, `.claude/skills/imported/${skillDir}`);
    });
  }

  const skillExportBtn = document.getElementById('skillExportButton');
  if (skillExportBtn) {
    skillExportBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const sid = currentSessionId;
      const skillId = getPendingSkillId(sid);
      if (!skillId || !isProjectSkillId(skillId)) return;
      const skillDir = skillIdToProjectSkillDir(skillId);
      if (!skillDir) return;

      if (!window.electronAPI || typeof window.electronAPI.listDir !== 'function' || typeof window.electronAPI.readFile !== 'function' || typeof window.electronAPI.userClaudeWriteFile !== 'function') {
        await customAlert('Export APIs are not available.', 'Skill Export');
        return;
      }

      const listRes = await window.electronAPI.listDir(`.claude/skills/${skillDir}`, { maxDepth: 8 });
      if (!listRes || listRes.success !== true || !Array.isArray(listRes.files)) {
        await customAlert(`Failed to list project skill directory.\n\n${listRes?.error || 'Unknown error'}`, 'Skill Export');
        return;
      }
      const entries = flattenFileTreeEntries(listRes.files);
      const files = entries.filter(e => e && e.type === 'file' && typeof e.path === 'string').map(e => String(e.path));

      let copied = 0;
      for (const rel of files.slice(0, 300)) {
        const readPath = `.claude/skills/${skillDir}/${rel.replace(/^\.?\//, '')}`;
        const rr = await window.electronAPI.readFile(readPath);
        if (!rr || rr.success !== true) continue;
        const outRel = `exported/${skillDir}/${rel.replace(/^\.?\//, '')}`;
        const wr = await window.electronAPI.userClaudeWriteFile({ area: 'skills', relPath: outRel, content: rr.content || '', isBase64: rr.isBase64 === true });
        if (wr && wr.success) copied++;
      }
      window.addConsoleMessage?.(`Exported skill to ~/.claude/skills/exported/${skillDir} (${copied} file(s))`, 'success', sid);
      try { await loadProjectSkills(); } catch { /* ignore */ }
      updateImportExportButtonsForSession(sid);
    });
  }

  // Skill scripts runner (executes in the real workspace)
  const runSkillBtn = document.getElementById('runSkillScriptButton');
  if (runSkillBtn) {
    runSkillBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const sid = currentSessionId;
      if (!sid) return;
      const skillId = getPendingSkillId(sid);
      if (!skillId) {
        await customAlert('Select a skill first.', 'Skill Scripts');
        return;
      }
      const skill = getPendingSkill(sid);
      if (!skill) {
        await customAlert('Selected skill could not be loaded.', 'Skill Scripts');
        return;
      }
      const scriptSelect = document.getElementById('skillScriptSelect');
      const scriptRel = scriptSelect ? String(scriptSelect.value || '').trim() : '';
      if (!scriptRel) {
        await customAlert('Select a script to run.', 'Skill Scripts');
        return;
      }

      const workingDir = String(window.currentFolder || '').trim();
      if (!workingDir) {
        await customAlert('Open a project first.', 'Skill Scripts');
        return;
      }

      // Decide runner based on extension (simple)
      const lower = scriptRel.toLowerCase();
      let cmd = '';
      if (lower.endsWith('.sh')) cmd = `bash ${shellQuote(scriptRel)}`;
      else if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) cmd = `node ${shellQuote(scriptRel)}`;
      else if (lower.endsWith('.py')) cmd = `python3 ${shellQuote(scriptRel)}`;
      else cmd = `bash ${shellQuote(scriptRel)}`;

      // Enforce network policy at UX level for scripts (scripts can run arbitrary commands).
      // If user has deny_all or allowlist, require explicit confirmation.
      const netMode = (settings && typeof settings.networkPolicyMode === 'string') ? settings.networkPolicyMode : 'allow_all';
      if (netMode !== 'allow_all') {
        const ok = await customConfirm(
          `Your network policy is "${netMode}". Skill scripts can execute arbitrary commands.\n\nRun anyway?\n\nCommand:\n${cmd}`,
          'Skill Script Permission'
        );
        if (!ok) return;
      } else {
        const ok = await customConfirm(
          `Run skill script?\n\nCommand:\n${cmd}\n\nThis will run inside your workspace folder.`,
          'Skill Script Permission'
        );
        if (!ok) return;
      }

      if (!window.electronAPI || typeof window.electronAPI.runTerminalCommandInDir !== 'function') {
        await customAlert('Script runner is not available (missing preload bridge).', 'Skill Scripts');
        return;
      }

      window.addConsoleMessage?.(`Running skill script: ${scriptRel}`, 'processing', sid);
      const startedAt = Date.now();
      const result = await window.electronAPI.runTerminalCommandInDir({
        command: cmd,
        workingDir,
        timeoutSec: 300
      });
      const elapsedMs = Date.now() - startedAt;
      if (result && result.success) {
        window.addConsoleMessage?.(`Skill script completed (${elapsedMs}ms)`, 'success', sid);
        if (result.output) window.addConsoleMessage?.(String(result.output).slice(0, 8000), 'info', sid);
      } else {
        window.addConsoleMessage?.(`Skill script failed (${elapsedMs}ms): ${result?.error || 'Unknown error'}`, 'error', sid);
        if (result && result.output) window.addConsoleMessage?.(String(result.output).slice(0, 8000), 'error', sid);
      }
    });
  }

  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!currentSessionId) return;
      
      const isRunning = isSessionProcessing(currentSessionId);
      const input = document.getElementById('chatInput');
      const text = input ? input.value.trim() : '';
      
      if (!text) return;
      
      if (isRunning) {
        // Queue the message instead of sending
        try {
          const attachments = typeof getPendingAttachments === 'function' 
            ? getPendingAttachments(currentSessionId) 
            : [];
          addToMessageQueue(currentSessionId, text, attachments);
          // Clear input and attachments
          if (input) input.value = '';
          if (typeof setPendingAttachments === 'function') {
            setPendingAttachments(currentSessionId, []);
          }
          if (typeof renderAttachmentPreview === 'function') {
            renderAttachmentPreview(currentSessionId);
          }
          window.addConsoleMessage?.('Message queued - will send after current run completes', 'info', currentSessionId);
        } catch (err) {
          console.error('[MessageQueue] Error queuing message:', err);
        }
      } else {
        sendMessage();
      }
    }
  });
  document.getElementById('chatInput').addEventListener('input', (e) => {
    try {
      const sid = currentSessionId;
      if (!sid) return;
      if (isSessionProcessing(sid)) return;
      const text = e && e.target ? String(e.target.value || '') : '';
      renderSkillSuggestionsForText(text, sid);
    } catch {
      // ignore
    }
  });

  // Paste-to-pill: when user pastes code into chat, capture it as a context pill (Cursor-like).
  // This uses exact clipboard text; if it matches the current editor selection, we also attach file + range.
  // Additionally: when copying from the editor, we stamp a custom clipboard metadata type with file+range.
  // That lets us distinguish "project code" copies from normal text copied from UI/outside.
  if (!window.__codeonClipboardCopyBound) {
    window.__codeonClipboardCopyBound = true;
    document.addEventListener('copy', (e) => {
      try {
        if (!e || !e.clipboardData) return;
        // Only intervene when Monaco is actually focused and there's a selection.
        const hasFocus = !!(editor && typeof editor.hasTextFocus === 'function' && editor.hasTextFocus());
        if (!hasFocus) return;
        const selCtx = tryGetEditorSelectionContext();
        if (!selCtx || !String(selCtx.text || '').trim()) return;

        const meta = buildCodeonClipboardSelectionMeta(selCtx);
        if (!meta) return;

        // Take over the clipboard so we can add metadata, but keep plain text identical.
        e.preventDefault();
        e.clipboardData.setData('text/plain', String(selCtx.text || ''));
        try { e.clipboardData.setData(CODEON_CLIPBOARD_SELECTION_META_TYPE, meta); } catch { /* ignore */ }
      } catch {
        // ignore
      }
    });
  }

  // Preserve selection when right-clicking (prevent browser's auto-selection behavior)
  (() => {
    const chatInput = document.getElementById('chatInput');
    let savedStart = 0;
    let savedEnd = 0;
    
    chatInput.addEventListener('mousedown', (e) => {
      if (e.button === 2) { // right-click
        savedStart = chatInput.selectionStart;
        savedEnd = chatInput.selectionEnd;
      }
    });
    
    chatInput.addEventListener('contextmenu', () => {
      // Restore selection after the browser tries to change it
      setTimeout(() => {
        try {
          chatInput.setSelectionRange(savedStart, savedEnd);
        } catch { /* ignore */ }
      }, 0);
    });
  })();

  document.getElementById('chatInput').addEventListener('paste', (e) => {
    try {
      const sid = currentSessionId;
      if (!sid) return;
      if (!e || !e.clipboardData) return;

      const raw = e.clipboardData.getData('text/plain');
      const clip = normalizeClipboardText(raw);
      if (!clip.trim()) return;

      // Preferred signal: our custom clipboard metadata type (only set when copying from Monaco).
      const metaRaw = e.clipboardData.getData(CODEON_CLIPBOARD_SELECTION_META_TYPE);
      const meta = metaRaw ? parseCodeonClipboardSelectionMeta(metaRaw) : null;
      const fromEditorSelectionMeta = !!meta;

      // Fallback: exact match with current editor selection (covers cases where custom clipboard types are stripped).
      const selCtx = tryGetEditorSelectionContext();
      const selText = selCtx ? normalizeClipboardText(selCtx.text) : '';
      const fromEditorSelectionMatch = !!(selCtx && selText && selText.trim() === clip.trim());

      const fromEditorSelection = fromEditorSelectionMeta || fromEditorSelectionMatch;

      // Safety: NEVER convert arbitrary external text into a context pill.
      // Only intercept when we have a strong project signal:
      // - our custom editor clipboard metadata, or
      // - exact match with current editor selection, or
      // - a "file + line range" header that matches a real workspace file.
      const headerCtx = fromEditorSelection ? null : parseFileRangeHeaderFromPastedText(clip);
      if (!fromEditorSelection && !headerCtx) return;

      // Prevent dumping the code into the textarea.
      e.preventDefault();

      addPastedCodeAttachment({
        absPath: fromEditorSelectionMeta
          ? meta.absPath
          : (fromEditorSelectionMatch ? selCtx.absPath : (headerCtx ? headerCtx.absPath : '')),
        relPath: fromEditorSelectionMeta
          ? meta.relPath
          : (fromEditorSelectionMatch ? selCtx.relPath : (headerCtx ? headerCtx.relPath : '')),
        startLine: fromEditorSelectionMeta
          ? meta.startLine
          : (fromEditorSelectionMatch ? selCtx.startLine : (headerCtx ? headerCtx.startLine : 0)),
        endLine: fromEditorSelectionMeta
          ? meta.endLine
          : (fromEditorSelectionMatch ? selCtx.endLine : (headerCtx ? headerCtx.endLine : 0)),
        code: headerCtx ? headerCtx.code : clip
      });

      // Put a minimal hint in the input (only if empty) to keep UX clear.
      const input = document.getElementById('chatInput');
      if (input && String(input.value || '').trim() === '') {
        input.value = '(See attached code.)';
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch { /* ignore */ }
      }
      try { input?.focus?.(); } catch { /* ignore */ }
    } catch {
      // ignore
    }
  });
  document.getElementById('newChatButton').addEventListener('click', startNewChat);
  document.getElementById('toggleChatButton').addEventListener('click', toggleChat);
  const assistantToolsBtn = document.getElementById('assistantToolsButton');
  if (assistantToolsBtn) {
    assistantToolsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAssistantToolsPopover();
    });
  }

  // Agent Execution Timeline (AET)
  const tlBtn = document.getElementById('executionTimelineButton');
  if (tlBtn) {
    tlBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Default: Graph view in the editor overlay (Cursor-like), but preserve Map if that's what the user last selected.
      try {
        const sid = currentSessionId;
        try {
          if (sid && typeof _getAetViewMode === 'function' && typeof _setAetViewMode === 'function') {
            const cur = _getAetViewMode(sid);
            const next = (cur === 'map' || cur === 'graph') ? cur : 'graph';
            _setAetViewMode(sid, next);
          }
        } catch { /* ignore */ }
        try { if (typeof _syncAetViewToggleUI === 'function') _syncAetViewToggleUI(); } catch { /* ignore */ }
        try { closeExecutionTimeline(); } catch { /* ignore */ }
        try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }
        try { if (sid) loadExecutionTimelineForSession(sid).catch(() => {}); } catch { /* ignore */ }
        try { if (sid) renderExecutionTimelineForSession(sid); } catch { /* ignore */ }
      } catch {
        // Fall back to the existing feed overlay if anything goes wrong.
        try { toggleExecutionTimeline(); } catch { /* ignore */ }
      }
    });
  }
  const tlClose = document.getElementById('executionTimelineCloseButton');
  if (tlClose) {
    tlClose.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeExecutionTimeline();
    });
  }

  // AET view toggle (Feed / Graph)
  const feedBtn = document.getElementById('executionTimelineFeedViewBtn');
  if (feedBtn) {
    feedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sid = currentSessionId;
      _setAetViewMode(sid, 'feed');
      _syncAetViewToggleUI();
      try { _closeExecutionTimelineInEditor(); } catch { /* ignore */ }
      try { openExecutionTimeline(); } catch { /* ignore */ }
      try { if (sid) renderExecutionTimelineForSession(sid); } catch { /* ignore */ }
    });
  }
  const graphBtn = document.getElementById('executionTimelineGraphViewBtn');
  if (graphBtn) {
    graphBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sid = currentSessionId;
      _setAetViewMode(sid, 'graph');
      _syncAetViewToggleUI();
      try { closeExecutionTimeline(); } catch { /* ignore */ }
      try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }
      try { if (sid) renderExecutionTimelineForSession(sid); } catch { /* ignore */ }
    });
  }
  const mapBtn = document.getElementById('executionTimelineMapViewBtn');
  if (mapBtn) {
    mapBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sid = currentSessionId;
      _setAetViewMode(sid, 'map');
      _syncAetViewToggleUI();
      try { closeExecutionTimeline(); } catch { /* ignore */ }
      try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }
      try { if (sid) renderExecutionTimelineForSession(sid); } catch { /* ignore */ }
    });
  }

  // AET editor overlay view toggle + close
  const eFeedBtn = document.getElementById('executionTimelineEditorFeedBtn');
  if (eFeedBtn) {
    eFeedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sid = currentSessionId;
      _setAetViewMode(sid, 'feed');
      _syncAetViewToggleUI();
      try { _closeExecutionTimelineInEditor(); } catch { /* ignore */ }
      try { openExecutionTimeline(); } catch { /* ignore */ }
      try { if (sid) renderExecutionTimelineForSession(sid); } catch { /* ignore */ }
    });
  }
  const eGraphBtn = document.getElementById('executionTimelineEditorGraphBtn');
  if (eGraphBtn) {
    eGraphBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sid = currentSessionId;
      _setAetViewMode(sid, 'graph');
      _syncAetViewToggleUI();
      try { closeExecutionTimeline(); } catch { /* ignore */ }
      try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }
      try { if (sid) renderExecutionTimelineForSession(sid); } catch { /* ignore */ }
    });
  }
  const eMapBtn = document.getElementById('executionTimelineEditorMapBtn');
  if (eMapBtn) {
    eMapBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sid = currentSessionId;
      _setAetViewMode(sid, 'map');
      _syncAetViewToggleUI();
      try { closeExecutionTimeline(); } catch { /* ignore */ }
      try { _openExecutionTimelineInEditor(); } catch { /* ignore */ }
      try { if (sid) renderExecutionTimelineForSession(sid); } catch { /* ignore */ }
    });
  }
  // Removed: AET overlay "back" chevron button in the header.

  // AET node drawer controls
  try {
    const { nodeDrawerBackdrop, nodeDrawerCloseBtn } = _getAetEls();
    if (nodeDrawerBackdrop) {
      nodeDrawerBackdrop.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { _closeAetNodeDrawer(); } catch { /* ignore */ }
      });
    }
    if (nodeDrawerCloseBtn) {
      nodeDrawerCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { _closeAetNodeDrawer(); } catch { /* ignore */ }
      });
    }
    document.addEventListener('keydown', (e) => {
      try {
        if (e.key === 'Escape') {
          const { nodeDrawer } = _getAetEls();
          if (nodeDrawer && nodeDrawer.style.display !== 'none') {
            _closeAetNodeDrawer();
          }
        }
      } catch { /* ignore */ }
    });
  } catch { /* ignore */ }

  // Removed: redundant AET Stop button (chat composer stop covers this).

  const tlPause = document.getElementById('executionTimelinePauseBtn');
  if (tlPause) {
    tlPause.disabled = false;
    tlPause.title = 'Pause before next tool (safe stepping)';
    const syncPauseLabel = (sid) => {
      try {
        const s = String(sid || '').trim();
        if (!s) return;
        const on = !!(window._pauseBeforeNextToolBySession && window._pauseBeforeNextToolBySession[s] === true);
        tlPause.classList.toggle('pause-on', on);
        tlPause.title = on ? 'Pause before next tool: ON' : 'Pause before next tool: OFF';
        tlPause.setAttribute('aria-label', on ? 'Pause before next tool is ON' : 'Pause before next tool is OFF');
      } catch { /* ignore */ }
    };
    try { syncPauseLabel(currentSessionId); } catch { /* ignore */ }
    tlPause.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const sid = currentSessionId;
        const st = sid ? getRunState(sid) : null;
        const requestId = st && typeof st.requestId === 'string' && st.requestId.trim() ? st.requestId.trim() : '';
        if (!sid) return;
        if (!window._pauseBeforeNextToolBySession) window._pauseBeforeNextToolBySession = {};
        const cur = window._pauseBeforeNextToolBySession[sid] === true;
        const next = !cur;
        window._pauseBeforeNextToolBySession[sid] = next;
        try { syncPauseLabel(sid); } catch { /* ignore */ }
        window.addConsoleMessage?.(next ? 'Pause-before-next-tool enabled' : 'Pause-before-next-tool disabled', 'info', sid);
        // Persist as chat audit entry + AET node (best-effort).
        try {
          addMessage('system_action', next ? '⏸ Pause-before-next-tool enabled' : '▶️ Pause-before-next-tool disabled', null, null, true);
        } catch { /* ignore */ }
        // If a run is active, apply immediately; otherwise, this will apply to the next run.
        if (!requestId) {
          showToast(next ? 'Pause will apply to the next run.' : 'Pause disabled.');
          return;
        }
        if (!window.electronAPI || typeof window.electronAPI.claudeSdkSetRunControl !== 'function') {
          showToast('Pause is not available (missing IPC bridge).');
          return;
        }
        const res = await window.electronAPI.claudeSdkSetRunControl({ requestId, uiSessionId: sid, pauseBeforeNextTool: next });
        if (!res || res.success !== true) {
          showToast(res?.error || 'Failed to toggle pause');
          return;
        }
        try {
          const runId = executionTimelineActiveRunBySession[sid];
          if (runId && window.currentFolder && typeof window.electronAPI.executionTimelineAppendNode === 'function') {
            await window.electronAPI.executionTimelineAppendNode(window.currentFolder, sid, runId, 'UserIntervention', {
              title: next ? 'Pause enabled' : 'Pause disabled',
              subtype: 'pause_toggle',
              enabled: next
            });
          }
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    });
  }

  const tlFit = document.getElementById('executionTimelineFitBtn');
  if (tlFit) {
    tlFit.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const { graph } = _getAetEls();
        const viewport = graph ? graph.querySelector('.execution-graph-viewport') : null;
        if (viewport && typeof viewport._aetFit === 'function') viewport._aetFit();
      } catch { /* ignore */ }
    });
  }
  const eFitBtn = document.getElementById('executionTimelineEditorFitBtn');
  if (eFitBtn) {
    eFitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const sid = currentSessionId;
        const mode = _getAetViewMode(sid);
        if (mode === 'map') {
          window.CodeonAetMap?.fitCurrent?.();
          return;
        }
        const host = document.getElementById('executionTimelineEditorGraphHost');
        const viewport = host ? host.querySelector('.execution-graph-viewport') : null;
        if (viewport && typeof viewport._aetFit === 'function') viewport._aetFit();
      } catch { /* ignore */ }
    });
  }
  const tlSelect = document.getElementById('executionTimelineRunSelect');
  if (tlSelect) {
    tlSelect.addEventListener('change', () => {
      try {
        const sid = currentSessionId;
        const rid = String(tlSelect.value || '').trim();
        if (sid && rid) {
          executionTimelineActiveRunBySession[sid] = rid;
          try { scheduleUIMetadataSave(500); } catch { /* ignore */ }
          renderExecutionTimelineForSession(sid);
        }
      } catch { /* ignore */ }
    });
  }
  const eRunSelect = document.getElementById('executionTimelineEditorRunSelect');
  if (eRunSelect) {
    eRunSelect.addEventListener('change', () => {
      try {
        const sid = currentSessionId;
        const rid = String(eRunSelect.value || '').trim();
        if (sid && rid) {
          executionTimelineActiveRunBySession[sid] = rid;
          try { scheduleUIMetadataSave(500); } catch { /* ignore */ }
          renderExecutionTimelineForSession(sid);
        }
      } catch { /* ignore */ }
    });
  }

  // Removed: redundant feed-header run dropdown (run selection is handled by #executionTimelineRunSelect and editor selector)

  // Open Agents & Skills Library (creation UI)
  const openLibBtn = document.getElementById('openAgentSkillLibraryButton');
  if (openLibBtn) {
    openLibBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeAssistantToolsPopover();
      try {
        // Ensure latest items are loaded
        await loadProjectAgents();
        await loadProjectSkills();
      } catch {
        // ignore
      }
      renderAgentSkillLibrary();
      showAgentSkillLibrary();
      switchAgentSkillLibraryTab(agentSkillLibraryActiveTab);
      refreshScriptsListForLibrary().catch(() => {});
    });
  }

  // Library modal close + tab switching + delegated actions
  const libModal = document.getElementById('agentSkillLibraryModal');
  const closeLibBtn = document.getElementById('closeAgentSkillLibraryButton');
  if (closeLibBtn) {
    closeLibBtn.addEventListener('click', (e) => {
      e.preventDefault();
      hideAgentSkillLibrary();
    });
  }
  if (libModal && !window._agentSkillLibraryDelegationAttached) {
    window._agentSkillLibraryDelegationAttached = true;
    libModal.addEventListener('click', async (e) => {
      // Click outside content closes
      if (e.target === libModal) {
        hideAgentSkillLibrary();
        return;
      }

      const tabBtn = e.target.closest && e.target.closest('#agentSkillLibraryTabs .library-tab');
      if (tabBtn) {
        e.preventDefault();
        const t = String(tabBtn.dataset.tab || '').trim();
        switchAgentSkillLibraryTab(t);
        if (t === 'scripts') refreshScriptsListForLibrary().catch(() => {});
        return;
      }

      const btn = e.target.closest && e.target.closest('button');
      if (!btn) return;

      // Create agent
      if (btn.id === 'libCreateAgentBtn') {
        e.preventDefault();
        try {
          const isEditMode = btn.dataset.editMode === 'true';
          const location = document.getElementById('libAgentLocation')?.value || 'project';
          const name = document.getElementById('libAgentName')?.value || '';
          const description = document.getElementById('libAgentDesc')?.value || '';
          const instructions = document.getElementById('libAgentBody')?.value || '';

          if (isEditMode) {
            // Update existing agent
            const agentId = btn.dataset.editId;
            const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}\n`;
            
            if (isUserAgentId(agentId)) {
              const rel = agentId.replace(/^user:/, '');
              const wr = await window.electronAPI.userClaudeWriteFile({ area: 'agents', relPath: rel, content, isBase64: false });
              if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to update user agent.');
            } else {
              const wr = await window.electronAPI.writeFile(agentId, content, false);
              if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to update project agent.');
            }

            // Cleanup edit mode
            if (window._agentEditCleanup) window._agentEditCleanup();
            if (window._agentEditResolve) window._agentEditResolve({ success: true });

            await loadProjectAgents();
            renderAgentSkillLibrary();
            showToast('Agent updated');
          } else {
            // Create new agent
            const res = await createAgentFromLibrary({ location, name, description, instructions });
            await loadProjectAgents();
            renderAgentSkillLibrary();
            switchAgentSkillLibraryTab('agents');
            if (res?.kind === 'project' && res.path) {
              setActiveAgentForSession(currentSessionId, res.path, { persist: true });
              await openFile(res.path);
            } else if (res?.kind === 'user' && res.id) {
              setActiveAgentForSession(currentSessionId, res.id, { persist: true });
            }
            showToast('Agent created');
          }
        } catch (err) {
          await customAlert(String(err?.message || err || 'Failed to ' + (btn.dataset.editMode === 'true' ? 'update' : 'create') + ' agent'), btn.dataset.editMode === 'true' ? 'Update Agent' : 'Create Agent');
        }
        return;
      }

      // Create skill
      if (btn.id === 'libCreateSkillBtn') {
        e.preventDefault();
        try {
          const isEditMode = btn.dataset.editMode === 'true';
          const location = document.getElementById('libSkillLocation')?.value || 'project';
          const displayName = document.getElementById('libSkillName')?.value || '';
          const dirName = document.getElementById('libSkillDir')?.value || '';
          const description = document.getElementById('libSkillDesc')?.value || '';
          const whenToUse = document.getElementById('libSkillWhenToUse')?.value || '';
          const instructions = document.getElementById('libSkillBody')?.value || '';

          if (isEditMode) {
            // Update existing skill
            const skillId = btn.dataset.editId;
            const skill = (Array.isArray(availableSkills) ? availableSkills : []).find(s => s && s.id === skillId);
            if (!skill) throw new Error('Skill not found.');

            // Build frontmatter with optional when_to_use
            const frontmatterLines = [`name: ${displayName}`, `description: ${description}`];
            if (whenToUse.trim()) frontmatterLines.push(`when_to_use: ${whenToUse}`);
            const content = `---\n${frontmatterLines.join('\n')}\n---\n\n${instructions}\n`;
            
            if (isUserSkillId(skillId)) {
              const dir = skillId.replace(/^user:/, '');
              // Preserve the originally-discovered file name (Skill.md vs SKILL.md) when editing,
              // but default to SKILL.md for new/unknown cases.
              const rel =
                (typeof skill.skillFilePath === 'string' && skill.skillFilePath.startsWith('~/.claude/skills/'))
                  ? skill.skillFilePath.replace(/^~\/\.claude\/skills\//, '')
                  : `${dir}/SKILL.md`;
              const wr = await window.electronAPI.userClaudeWriteFile({ area: 'skills', relPath: rel, content, isBase64: false });
              if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to update user skill.');
            } else if (skill.skillFilePath) {
              const wr = await window.electronAPI.writeFile(skill.skillFilePath, content, false);
              if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to update project skill.');
            } else {
              throw new Error('Skill file path not found.');
            }

            // Cleanup edit mode
            if (window._skillEditCleanup) window._skillEditCleanup();
            if (window._skillEditResolve) window._skillEditResolve({ success: true });

            await loadProjectSkills();
            renderAgentSkillLibrary();
            showToast('Skill updated');
          } else {
            // Create new skill
            const res = await createSkillFromLibrary({ location, displayName, dirName, description, whenToUse, instructions });
            await loadProjectSkills();
            renderAgentSkillLibrary();
            switchAgentSkillLibraryTab('skills');
            if (res?.kind === 'project' && res.skillFilePath) {
              setPendingSkillForSession(currentSessionId, res.id);
              await openFile(res.skillFilePath);
            } else if (res?.kind === 'user' && res.id) {
              setPendingSkillForSession(currentSessionId, res.id);
            }
            showToast('Skill created');
          }
        } catch (err) {
          await customAlert(String(err?.message || err || 'Failed to ' + (btn.dataset.editMode === 'true' ? 'update' : 'create') + ' skill'), btn.dataset.editMode === 'true' ? 'Update Skill' : 'Create Skill');
        }
        return;
      }

      // Create script
      if (btn.id === 'libCreateScriptBtn') {
        e.preventDefault();
        try {
          const sel = document.getElementById('libScriptsSkillSelect');
          const skillId = sel ? String(sel.value || '').trim() : '';
          if (!skillId) throw new Error('Select a project skill first.');
          const skillDir = skillIdToProjectSkillDir(skillId);
          if (!skillDir) throw new Error('Invalid skill selection.');
          const fileNameRaw = String(document.getElementById('libScriptName')?.value || '').trim();
          if (!fileNameRaw) throw new Error('Script file name is required.');
          const body = String(document.getElementById('libScriptBody')?.value || '');
          if (!window.electronAPI || typeof window.electronAPI.createDirectory !== 'function' || typeof window.electronAPI.writeFile !== 'function') {
            throw new Error('Project file APIs are not available.');
          }
          const scriptsDir = `.claude/skills/${skillDir}/scripts`;
          await window.electronAPI.createDirectory(scriptsDir);
          let path = `${scriptsDir}/${fileNameRaw}`;
          path = await ensureUniqueProjectPath(path);
          const wr = await window.electronAPI.writeFile(path, body, false);
          if (!wr || wr.success !== true) throw new Error(wr?.error || 'Failed to write script.');
          await loadProjectSkills();
          renderAgentSkillLibrary();
          switchAgentSkillLibraryTab('scripts');
          await refreshScriptsListForLibrary();
          await openFile(path);
          showToast('Script created');
        } catch (err) {
          await customAlert(String(err?.message || err || 'Failed to create script'), 'Create Script');
        }
        return;
      }

      if (btn.id === 'libInstallPluginBtn') {
        e.preventDefault();
        try {
          const scope = String(document.getElementById('libPluginInstallScope')?.value || 'project').trim();
          const repoUrl = String(document.getElementById('libPluginRepoUrl')?.value || '').trim();
          const dirName = String(document.getElementById('libPluginDirName')?.value || '').trim();
          if (!repoUrl) throw new Error('Git repo URL is required.');

          if (scope === 'user') {
            if (!window.electronAPI || typeof window.electronAPI.userClaudePluginInstallGit !== 'function') {
              throw new Error('User plugin install API is not available.');
            }
            const res = await window.electronAPI.userClaudePluginInstallGit({ repoUrl, dirName });
            if (!res || res.success !== true) throw new Error(res?.error || res?.output || 'Failed to install user plugin.');
            try { await enableUserPlugin(String(res.destAbs || '').trim()); } catch { /* ignore */ }
          } else {
            if (!window.electronAPI || typeof window.electronAPI.createDirectory !== 'function' || typeof window.electronAPI.runTerminalCommandInDir !== 'function') {
              throw new Error('Project file/terminal APIs are not available.');
            }
            await window.electronAPI.createDirectory('.claude/plugins');
            const repoNameGuess = repoUrl.split('/').filter(Boolean).pop() || 'plugin';
            const safeDir = (dirName || repoNameGuess).replace(/\.git$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
            if (!safeDir) throw new Error('Invalid folder name.');
            const q = window.Codeon && window.Codeon.utils && typeof window.Codeon.utils.shellQuote === 'function'
              ? window.Codeon.utils.shellQuote
              : (s) => `'${String(s || '').replace(/'/g, `'"'"'`)}'`;
            const cmd = `git clone --depth 1 ${q(repoUrl)} ${q(safeDir)}`;
            const rr = await window.electronAPI.runTerminalCommandInDir({ command: cmd, workingDir: '.claude/plugins', timeoutMs: 180000, waitForCompletion: true });
            if (!rr || rr.success !== true) throw new Error(rr?.error || rr?.output || 'git clone failed.');
            // Enable plugin via .claude/settings.json so Claude Code loads it.
            const pluginRootPath = `.claude/plugins/${safeDir}`;
            try { await enableProjectPlugin(pluginRootPath); } catch { /* ignore */ }
          }

          await loadProjectPlugins();
          renderAgentSkillLibrary();
          showToast('Plugin installed');
        } catch (err) {
          await customAlert(String(err?.message || err || 'Failed to install plugin'), 'Install Plugin');
        }
        return;
      }

      // Delegated actions from lists
      const action = btn.dataset && btn.dataset.action ? String(btn.dataset.action) : '';
      if (!action) return;
      const id = btn.dataset.id ? String(btn.dataset.id) : '';
      const p = btn.dataset.path ? String(btn.dataset.path) : '';
      const scope = btn.dataset.scope ? String(btn.dataset.scope) : '';
      const root = btn.dataset.root ? String(btn.dataset.root) : '';
      const rel = btn.dataset.rel ? String(btn.dataset.rel) : '';
      if (action === 'open-plugin-manifest') {
        e.preventDefault();
        if (!p) return;
        await openFile(p);
        return;
      }
      if (action === 'use-agent') {
        e.preventDefault();
        setActiveAgentForSession(currentSessionId, id, { persist: true });
        showToast('Agent selected');
        return;
      }
      if (action === 'open-agent') {
        e.preventDefault();
        await openFile(id);
        return;
      }
      if (action === 'import-agent') {
        e.preventDefault();
        // Reuse the existing import button logic by setting selection then triggering click.
        setActiveAgentForSession(currentSessionId, id, { persist: true });
        const b = document.getElementById('agentImportButton');
        if (b && !b.disabled) b.click();
        return;
      }
      if (action === 'use-skill') {
        e.preventDefault();
        setPendingSkillForSession(currentSessionId, id);
        showToast('Skill selected (next message)');
        return;
      }
      if (action === 'open-skill') {
        e.preventDefault();
        const s = (Array.isArray(availableSkills) ? availableSkills : []).find(x => x && x.id === id);
        if (s && s.skillFilePath) await openFile(s.skillFilePath);
        return;
      }
      if (action === 'import-skill') {
        e.preventDefault();
        setPendingSkillForSession(currentSessionId, id);
        const b = document.getElementById('skillImportButton');
        if (b && !b.disabled) b.click();
        return;
      }
      if (action === 'open-script') {
        e.preventDefault();
        if (p) await openFile(p);
        return;
      }

      // Edit agent
      if (action === 'edit-agent') {
        e.preventDefault();
        try {
          switchAgentSkillLibraryTab('agents');
          await editAgentFromLibrary(id);
        } catch (err) {
          await customAlert(String(err?.message || err || 'Failed to edit agent'), 'Edit Agent');
        }
        return;
      }

      // Delete agent
      if (action === 'delete-agent') {
        e.preventDefault();
        try {
          const result = await deleteAgentFromLibrary(id);
          if (result) {
            await loadProjectAgents();
            renderAgentSkillLibrary();
            showToast('Agent deleted');
          }
        } catch (err) {
          await customAlert(String(err?.message || err || 'Failed to delete agent'), 'Delete Agent');
        }
        return;
      }

      // Edit skill
      if (action === 'edit-skill') {
        e.preventDefault();
        try {
          switchAgentSkillLibraryTab('skills');
          await editSkillFromLibrary(id);
        } catch (err) {
          await customAlert(String(err?.message || err || 'Failed to edit skill'), 'Edit Skill');
        }
        return;
      }

      // Delete skill
      if (action === 'delete-skill') {
        e.preventDefault();
        try {
          const result = await deleteSkillFromLibrary(id);
          if (result) {
            await loadProjectSkills();
            renderAgentSkillLibrary();
            await refreshScriptsListForLibrary();
            showToast('Skill deleted');
          }
        } catch (err) {
          await customAlert(String(err?.message || err || 'Failed to delete skill'), 'Delete Skill');
        }
        return;
      }

      // Delete script
      if (action === 'delete-script') {
        e.preventDefault();
        try {
          const name = btn.dataset.name ? String(btn.dataset.name) : '';
          const result = await deleteScriptFromLibrary(p, name);
          if (result) {
            await loadProjectSkills();
            await refreshScriptsListForLibrary();
            showToast('Script deleted');
          }
        } catch (err) {
          await customAlert(String(err?.message || err || 'Failed to delete script'), 'Delete Script');
        }
        return;
      }
    });

    libModal.addEventListener('change', (e) => {
      // When changing scripts skill selection, refresh list
      const sel = e.target && e.target.id === 'libScriptsSkillSelect';
      if (sel) refreshScriptsListForLibrary().catch(() => {});
      const typ = e.target && e.target.id === 'libScriptType';
      if (typ) {
        const t = String(e.target.value || 'sh');
        const ta = document.getElementById('libScriptBody');
        const name = document.getElementById('libScriptName');
        if (name && !String(name.value || '').trim()) {
          name.value = t === 'js' ? 'script.js' : t === 'py' ? 'script.py' : 'script.sh';
        }
        if (ta && !String(ta.value || '').trim()) {
          ta.value = t === 'js'
            ? "console.log('cwd:', process.cwd());\n"
            : t === 'py'
              ? "import os\nprint('cwd:', os.getcwd())\n"
              : "#!/bin/sh\nset -eu\npwd\nls -la\n";
        }
      }
    });
  }

  // Note: marketplace select/search bindings are attached in the plugins UI module
  // because the modal content is re-rendered frequently (elements are replaced).

  // Chat Sessions Switcher (Cursor-style popover)
  const chatSessionsTrigger = document.getElementById('chatSessionsTrigger');
  if (chatSessionsTrigger) {
    chatSessionsTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleChatSessionsPopover();
    });
  }
  const chatSessionsSearchInput = document.getElementById('chatSessionsSearchInput');
  if (chatSessionsSearchInput) {
    chatSessionsSearchInput.addEventListener('input', (e) => {
      chatSessionsSearchQuery = String(e.target.value || '');
      renderChatDropdown();
    });
    chatSessionsSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeChatSessionsPopover();
      }
    });
  }

  // Quick Actions
  document.querySelectorAll('.quick-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const command = btn.dataset.command;
      const chatInput = document.getElementById('chatInput');

      let message = '';
      switch (command) {
        case '/explain': message = 'Explain this code'; break;
        case '/fix': message = 'Fix this issue'; break;
        case '/test': message = 'Generate tests for this file'; break;
        case '/commit': message = 'Generate a commit message'; break;
      }

      chatInput.value = message;

      // Auto-send for commit, otherwise just focus
      if (command === '/commit') {
        sendMessage();
      } else {
        chatInput.focus();
      }
    });
  });

  // Auto-resize chat input
  const chatInput = document.getElementById('chatInput');
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = chatInput.scrollHeight + 'px';

    // Trigger @ context picker when typing "@..."
    try {
      const info = detectAtQueryFromTextarea(chatInput.value, chatInput.selectionStart);
      if (info && info.active) {
        if (!isComposerContextPopoverOpen()) {
          openComposerContextPopover({ trigger: 'typed', atIndex: info.atIndex, query: info.query }).catch(() => {});
        } else {
          composerContextState.trigger = 'typed';
          composerContextState.atIndex = info.atIndex;
          composerContextState.query = info.query;
          renderComposerContextPopover();
          positionComposerContextPopover();
        }
      } else {
        // Only auto-close when it was opened by typing
        if (isComposerContextPopoverOpen() && composerContextState.trigger === 'typed') {
          closeComposerContextPopover();
        }
      }
    } catch { /* ignore */ }
  });

  // Keyboard controls for @ picker
  chatInput.addEventListener('keydown', (e) => {
    try {
      if (!isComposerContextPopoverOpen()) return;
      const key = e.key;
      if (key === 'Escape') {
        e.preventDefault();
        closeComposerContextPopover();
        return;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault();
        const delta = key === 'ArrowDown' ? 1 : -1;
        composerContextState.activeIndex = Math.max(0, (composerContextState.activeIndex || 0) + delta);
        renderComposerContextPopover();
        return;
      }
      if (key === 'Enter' || key === 'Tab') {
        // Select current item
        const list = typeof getComposerContextActiveItems === 'function'
          ? getComposerContextActiveItems()
          : getComposerContextFilteredEntries(composerContextState.entries, composerContextState.query).map((e) => ({
            itemType: e.kind === 'directory' ? 'folder' : 'file',
            relPath: e.relPath,
            id: '',
            name: e.name || e.relPath
          }));
        const idx = Math.max(0, Math.min(composerContextState.activeIndex || 0, Math.max(0, list.length - 1)));
        const chosen = list[idx];
        if (!chosen) return;
        if (chosen.itemType === 'agent' && chosen.id) {
          e.preventDefault();
          handleComposerContextAgentPick(chosen.id).catch(() => {});
          return;
        }
        if (chosen.itemType === 'skill' && chosen.id) {
          e.preventDefault();
          handleComposerContextSkillPick(chosen.id).catch(() => {});
          return;
        }
        if (chosen.relPath) {
          e.preventDefault();
          handleComposerContextPick(chosen.relPath, chosen.itemType === 'folder' ? 'folder' : 'file').catch(() => {});
        }
        return;
      }
    } catch { /* ignore */ }
  });

  // Sidebar resize
  setupResizing();

  // Electron IPC listeners
  if (window.electronAPI) {
    window.electronAPI.onFolderOpened(handleFolderOpened);
    window.electronAPI.onFileOpened(handleFileOpened);
    window.electronAPI.onMenuSave(saveCurrentFile);
    window.electronAPI.onSaveFileAs(handleSaveFileAs);
    if (typeof window.electronAPI.onWorkspaceFilesChanged === 'function') {
      window.electronAPI.onWorkspaceFilesChanged((data) => {
        if (workspaceFsRefreshTimer) clearTimeout(workspaceFsRefreshTimer);
        workspaceFsRefreshTimer = setTimeout(() => {
          refreshFileTree().catch(() => {});
          try {
            handleWorkspaceFilesChanged(data);
          } catch {
            // ignore
          }
        }, 250);
      });
    }
  }

  // Close modal on outside click
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') {
      closeSettings();
    }
  });

  // Context menu handlers
  document.getElementById('ctxNewFile').addEventListener('click', (e) => {
    e.stopPropagation();
    createNewFile();
  });
  document.getElementById('ctxNewFolder').addEventListener('click', (e) => {
    e.stopPropagation();
    createNewFolder();
  });
  const ctxCut = document.getElementById('ctxCut');
  if (ctxCut) {
    ctxCut.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideContextMenu();
      await explorerCopyOrCutSelection('cut');
    });
  }
  const ctxCopy = document.getElementById('ctxCopy');
  if (ctxCopy) {
    ctxCopy.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideContextMenu();
      await explorerCopyOrCutSelection('copy');
    });
  }
  const ctxPaste = document.getElementById('ctxPaste');
  if (ctxPaste) {
    ctxPaste.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetDir = contextMenuIsFolder ? contextMenuPath : currentFolder;
      hideContextMenu();
      await explorerPasteInto(targetDir);
    });
  }
  const ctxDuplicate = document.getElementById('ctxDuplicate');
  if (ctxDuplicate) {
    ctxDuplicate.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideContextMenu();
      await explorerDuplicateSelection();
    });
  }
  const ctxOpenDiffHead = document.getElementById('ctxOpenDiffHead');
  if (ctxOpenDiffHead) {
    ctxOpenDiffHead.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideContextMenu();
      try {
        if (!contextMenuPath || contextMenuIsFolder) return;
        await openGitDiffForFile(contextMenuPath, 'HEAD');
      } catch {
        showToast('Failed to open diff preview');
      }
    });
  }
  document.getElementById('ctxRename').addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = explorerSelectedAbsList();
    if (sel.length === 1) {
      hideContextMenu();
      explorerRenameSingleSelection();
    } else {
      renameItem();
    }
  });
  document.getElementById('ctxDelete').addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = explorerSelectedAbsList();
    if (sel.length > 0) {
      hideContextMenu();
      explorerDeleteSelection();
    } else {
      deleteItem();
    }
  });
  document.getElementById('ctxRevealInFinder').addEventListener('click', (e) => {
    e.stopPropagation();
    revealInFinder();
  });

  // Chat tab context menu handlers
  const chatCtxRename = document.getElementById('chatCtxRename');
  if (chatCtxRename) {
    chatCtxRename.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sid = chatTabContextSessionId;
      hideChatTabContextMenu();
      await renameChatSession(sid);
    });
  }
  const chatCtxOpenAsEditor = document.getElementById('chatCtxOpenAsEditor');
  if (chatCtxOpenAsEditor) {
    chatCtxOpenAsEditor.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sid = chatTabContextSessionId;
      hideChatTabContextMenu();
      await openChatSessionAsEditor(sid);
    });
  }
  const chatCtxClose = document.getElementById('chatCtxClose');
  if (chatCtxClose) {
    chatCtxClose.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sid = chatTabContextSessionId;
      hideChatTabContextMenu();
      if (sid) await closeChatSession(sid);
    });
  }
  const chatCtxCloseOthers = document.getElementById('chatCtxCloseOthers');
  if (chatCtxCloseOthers) {
    chatCtxCloseOthers.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sid = chatTabContextSessionId;
      hideChatTabContextMenu();
      await closeOtherChatSessions(sid);
    });
  }

  // Close context menu on outside click
  document.addEventListener('click', (e) => {
    // Don't close if clicking inside the context menu
    if (!e.target.closest('#contextMenu')) {
      hideContextMenu();
    }
    if (!e.target.closest('#chatTabContextMenu')) {
      hideChatTabContextMenu();
    }
    if (!e.target.closest('#editorTabContextMenu')) {
      hideEditorTabContextMenu();
    }
    if (!e.target.closest('#chatSessionsSwitcher') && !e.target.closest('#chatSessionsPopover')) {
      closeChatSessionsPopover();
    }
    if (!e.target.closest('#assistantToolsButton') && !e.target.closest('#assistantToolsPopover')) {
      closeAssistantToolsPopover();
    }
  });
  document.addEventListener('contextmenu', (e) => {
    // Only prevent default if not on file tree
    if (!e.target.closest('.file-tree')) {
      hideContextMenu();
    }
    if (!e.target.closest('#chatTabs')) {
      hideChatTabContextMenu();
    }
    if (!e.target.closest('#editorTabs')) {
      hideEditorTabContextMenu();
    }
  });

  // Escape closes chat tab context menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideChatTabContextMenu();
      hideEditorTabContextMenu();
      closeAssistantToolsPopover();
    }
  });

  // Track whether the explorer has focus (used for keyboard shortcuts)
  document.addEventListener('mousedown', (e) => {
    try {
      explorerHasFocus = !!(e && e.target && e.target.closest && e.target.closest('#fileTree'));
    } catch {
      explorerHasFocus = false;
    }
  }, true);

  // Explorer keyboard shortcuts (VS Code-ish)
  document.addEventListener('keydown', async (e) => {
    try {
      if (!e) return;
      if (!explorerHasFocus) return;
      if (explorerIsEditableTarget(e.target)) return;

      const key = String(e.key || '');
      const lower = key.toLowerCase();
      const mod = explorerIsMac() ? !!e.metaKey : !!e.ctrlKey;
      if (!mod && (key === 'Backspace' || key === 'Delete')) {
        e.preventDefault();
        await explorerDeleteSelection();
        return;
      }
      if (!mod && key === 'F2') {
        e.preventDefault();
        await explorerRenameSingleSelection();
        return;
      }
      if (mod && lower === 'a') {
        e.preventDefault();
        const all = explorerVisibleAbsList();
        if (all.length) explorerReplaceSelection(all, { anchorAbs: all[0], focusAbs: all[all.length - 1] });
        return;
      }
      if (mod && lower === 'c') {
        e.preventDefault();
        await explorerCopyOrCutSelection('copy');
        return;
      }
      if (mod && lower === 'x') {
        e.preventDefault();
        await explorerCopyOrCutSelection('cut');
        return;
      }
      if (mod && lower === 'v') {
        e.preventDefault();
        await explorerPasteInto(explorerPreferredPasteDestAbs());
        return;
      }
      if (mod && e.shiftKey && lower === 'd') {
        e.preventDefault();
        await explorerDuplicateSelection();
        return;
      }
    } catch {
      // ignore
    }
  }, true);

  // Initialize custom dropdowns
  if (window.initCustomDropdowns) {
    window.initCustomDropdowns();
  }

  // Console controls
  const consoleToggle = document.getElementById('consoleToggle');
  const consoleClear = document.getElementById('consoleClear');
  const consolePanel = document.getElementById('consolePanel');

  if (consoleToggle && consolePanel) {
    // Remove any existing listeners by cloning (nuclear option)
    const newToggle = consoleToggle.cloneNode(true);
    consoleToggle.parentNode.replaceChild(newToggle, consoleToggle);
    
    newToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Ensure transitions are enabled for the toggle
      consolePanel.style.transition = ''; 
      
      consolePanel.classList.toggle('collapsed');
      
      // Resize editor after transition
      setTimeout(() => {
        if (editor) editor.layout();
        if (diffEditor) diffEditor.layout();
      }, 250);
    });
  }

  if (consoleClear) {
    consoleClear.addEventListener('click', () => {
      if (!currentSessionId) return;
      setConsoleMessages(currentSessionId, []);
      setConsoleIndicatorState(currentSessionId, { type: 'idle', title: '' });
      persistConsoleState(currentSessionId);
      renderConsoleForSession(currentSessionId);
    });
  }

  // Console Copy button
  const consoleCopy = document.getElementById('consoleCopy');
  if (consoleCopy) {
    consoleCopy.addEventListener('click', async () => {
      try {
        const consoleContent = document.getElementById('consoleContent');
        if (!consoleContent) return;
        
        // Get all console items and format them as plain text
        const items = consoleContent.querySelectorAll('.console-item');
        if (!items || items.length === 0) {
          window.addConsoleMessage?.('Nothing to copy', 'info', currentSessionId);
          return;
        }
        
        const lines = [];
        for (const item of items) {
          // Each console-item contains text directly or has specific structure
          const text = item.textContent.trim();
          if (text) lines.push(text);
        }
        
        const textToCopy = lines.join('\n');
        await navigator.clipboard.writeText(textToCopy);
        
        // Visual feedback
        consoleCopy.classList.add('copied');
        setTimeout(() => consoleCopy.classList.remove('copied'), 1500);
        
        window.addConsoleMessage?.(`Copied ${items.length} message(s) to clipboard`, 'info', currentSessionId);
      } catch (err) {
        console.error('[Console] Copy failed:', err);
        window.addConsoleMessage?.('Failed to copy to clipboard', 'error', currentSessionId);
      }
    });
  }

  // Sidebar Toggle
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  if (sidebarToggle && sidebar) {
    const newSidebarToggle = sidebarToggle.cloneNode(true);
    sidebarToggle.parentNode.replaceChild(newSidebarToggle, sidebarToggle);

    newSidebarToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Ensure transitions enabled
      sidebar.style.transition = '';
      
      sidebar.classList.toggle('collapsed');

      // Resize editor after transition
      setTimeout(() => {
        if (editor) editor.layout();
        if (diffEditor) diffEditor.layout();
      }, 250);
    });
  }

  // Chat Panel Toggle
  const chatToggle = document.getElementById('toggleChatButton');
  const chatPanel = document.getElementById('chatPanel');

  if (chatToggle && chatPanel) {
    const newChatToggle = chatToggle.cloneNode(true);
    chatToggle.parentNode.replaceChild(newChatToggle, chatToggle);

    newChatToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Ensure transitions enabled
      chatPanel.style.transition = '';
      
      chatPanel.classList.toggle('collapsed');

      // Resize editor after transition
      setTimeout(() => {
        if (editor) editor.layout();
        if (diffEditor) diffEditor.layout();
      }, 250);
    });
  }
}
