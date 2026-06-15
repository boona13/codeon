// Middle area top-level tabs (Code / Agents & Skills / Plugins / MCP / AET / Learning / Docs)
// Keeps `renderer/app.js` untouched: purely DOM + visibility orchestration.
// Safe approach: reuse existing editor/diff + existing Agents&Skills library modal + existing AET editor overlay.

(function () {
  'use strict';

  const STORAGE_KEY = 'codeon.middleTab';
  const TAB_CODE = 'code';
  const TAB_AGENTS = 'agents';
  const TAB_AET = 'aet';
  const TAB_MCP = 'mcp';
  const TAB_PLUGINS = 'plugins';
  const TAB_LEARNING = 'learning';
  const TAB_DOCS = 'docs';
  const TAB_VERIFICATION = 'verification';

  let activeTab = TAB_CODE;

  // Keep the current middle-tab available globally so other modules (like editor-tabs)
  // can avoid re-showing Code-only UI (e.g. #editorTabs) while a non-Code tab is active.
  function syncActiveTabToWindow() {
    try { window.__codeonMiddleActiveTab = activeTab; } catch { /* ignore */ }
  }

  // Track original modal parent so we can safely re-parent for embedded mode.
  // (Legacy: no longer used since Agents & Skills is now panel-based, kept for compat)
  let agentModalOriginalParent = null;
  let agentModalOriginalNextSibling = null;

  // Track original AET feed panel parent so we can re-parent it into the editor when needed.
  let aetPanelOriginalParent = null;
  let aetPanelOriginalNextSibling = null;

  // Track original node drawer parent so we can re-parent it between Feed panel and Editor overlay.
  let aetDrawerOriginalParent = null;
  let aetDrawerOriginalNextSibling = null;

  // Track editor tabs display so we don't override app.js' own visibility decisions.
  let editorTabsRestoreDisplay = null;

  function $(id) {
    return document.getElementById(id);
  }

  function safeCall(fn, ...args) {
    try {
      if (typeof fn === 'function') return fn(...args);
    } catch {
      // ignore
    }
    return undefined;
  }

  function safeAsync(fn, ...args) {
    try {
      if (typeof fn === 'function') return Promise.resolve(fn(...args)).catch(() => {});
    } catch {
      // ignore
    }
    return Promise.resolve();
  }

  function getEditorContainer() {
    return document.querySelector('.editor-container');
  }

  function getEditorWrapper() {
    return document.querySelector('.editor-container .editor-wrapper');
  }

  function getMiddleBar() {
    return $('codeonMiddleTabsBar');
  }

  function getMiddleOverlay() {
    return $('codeonMiddleOverlay');
  }

  function getAetFeedPanel() {
    return $('executionTimelinePanel');
  }

  function getAetEditorOverlay() {
    return $('executionTimelineEditorOverlay');
  }

  function getAetNodeDrawerEls() {
    return {
      backdrop: $('executionTimelineNodeDrawerBackdrop'),
      drawer: $('executionTimelineNodeDrawer')
    };
  }

  function moveAetNodeDrawerInto(container) {
    const { backdrop, drawer } = getAetNodeDrawerEls();
    if (!container || !backdrop || !drawer) return;
    if (!aetDrawerOriginalParent) {
      // Original location is inside the editor overlay in index.html.
      aetDrawerOriginalParent = backdrop.parentNode;
      aetDrawerOriginalNextSibling = backdrop.nextSibling;
    }

    // Keep drawer + backdrop in the same container for correct absolute positioning.
    if (backdrop.parentNode !== container) container.appendChild(backdrop);
    if (drawer.parentNode !== container) container.appendChild(drawer);
  }

  function restoreAetNodeDrawerToOriginalParent() {
    const { backdrop, drawer } = getAetNodeDrawerEls();
    if (!backdrop || !drawer) return;
    if (!aetDrawerOriginalParent) return;
    try {
      // Restore backdrop first (drawer can follow).
      if (aetDrawerOriginalNextSibling && aetDrawerOriginalNextSibling.parentNode === aetDrawerOriginalParent) {
        aetDrawerOriginalParent.insertBefore(backdrop, aetDrawerOriginalNextSibling);
      } else {
        aetDrawerOriginalParent.appendChild(backdrop);
      }
      aetDrawerOriginalParent.appendChild(drawer);
    } catch {
      // ignore
    }
  }

  function showAetNodeDrawer() {
    const { backdrop, drawer } = getAetNodeDrawerEls();
    try { if (backdrop) backdrop.style.display = 'block'; } catch { /* ignore */ }
    try { if (drawer) drawer.style.display = 'flex'; } catch { /* ignore */ }
  }

  function embedAetFeedPanelIntoEditor() {
    const panel = getAetFeedPanel();
    const wrapper = getEditorWrapper();
    if (!panel || !wrapper) return;
    if (!aetPanelOriginalParent) {
      aetPanelOriginalParent = panel.parentNode;
      aetPanelOriginalNextSibling = panel.nextSibling;
    }
    if (panel.parentNode !== wrapper) {
      wrapper.appendChild(panel);
    }
    panel.classList.add('codeon-embedded');
  }

  function restoreAetFeedPanelToOriginalParent() {
    const panel = getAetFeedPanel();
    if (!panel) return;
    panel.classList.remove('codeon-embedded');
    if (aetPanelOriginalParent) {
      try {
        if (aetPanelOriginalNextSibling && aetPanelOriginalNextSibling.parentNode === aetPanelOriginalParent) {
          aetPanelOriginalParent.insertBefore(panel, aetPanelOriginalNextSibling);
        } else {
          aetPanelOriginalParent.appendChild(panel);
        }
      } catch {
        // ignore
      }
    }
  }

  function patchAetFeedRoutingOnce() {
    if (window.__codeonAetFeedRoutingPatched) return;
    window.__codeonAetFeedRoutingPatched = true;

    const originalOpen = window.openExecutionTimeline;
    const originalClose = window.closeExecutionTimeline;

    // If these don't exist yet, we'll just noop and rely on default behavior.
    if (typeof originalOpen === 'function') {
      window.openExecutionTimeline = function patchedOpenExecutionTimeline(...args) {
        // When the middle tab is AET, "Feed" should live in the middle pane (not the right chat panel).
        if (activeTab === TAB_AET) {
          embedAetFeedPanelIntoEditor();
        }
        return originalOpen.apply(this, args);
      };
    }

    if (typeof originalClose === 'function') {
      window.closeExecutionTimeline = function patchedCloseExecutionTimeline(...args) {
        const out = originalClose.apply(this, args);
        // When leaving AET tab, restore the feed panel back into the chat panel.
        if (activeTab !== TAB_AET) {
          setTimeout(() => {
            try { restoreAetFeedPanelToOriginalParent(); } catch { /* ignore */ }
          }, 220);
        }
        return out;
      };
    }
  }

  function patchAetNodeDrawerRoutingOnce() {
    if (window.__codeonAetNodeDrawerRoutingPatched) return;
    window.__codeonAetNodeDrawerRoutingPatched = true;

    const original = window._openAetNodeDrawer;
    if (typeof original !== 'function') return;

    window._openAetNodeDrawer = function patchedOpenAetNodeDrawer(opts = {}) {
      try {
        const sid = String(opts?.sessionId || window.currentSessionId || '').trim();
        const rid = String(opts?.runId || '').trim();
        const nid = String(opts?.nodeId || '').trim();
        if (!sid || !rid || !nid) return;

        const mode = (typeof window._getAetViewMode === 'function') ? String(window._getAetViewMode(sid) || '') : '';
        const feedPanel = getAetFeedPanel();
        const feedVisible = !!(feedPanel && (feedPanel.style.display === 'flex' || feedPanel.classList.contains('open')));

        // If the user is in Feed mode (and AET middle tab), open the drawer IN PLACE over the feed panel.
        // This avoids the jarring jump to Graph/Map and keeps the UI state consistent.
        if (activeTab === TAB_AET && mode === 'feed' && feedVisible) {
          try {
            moveAetNodeDrawerInto(feedPanel);
            // Render existing drawer content (reuse app.js renderer).
            if (typeof window._renderAetNodeDrawer === 'function') {
              window._renderAetNodeDrawer({ sessionId: sid, runId: rid, nodeId: nid });
            }
            showAetNodeDrawer();
            // Keep toggles consistent with Feed.
            try { window._syncAetViewToggleUI?.(); } catch { /* ignore */ }
            return;
          } catch {
            // Fall through to original behavior if anything goes wrong.
          }
        }

        // Non-feed (Graph/Mindmap) => use original behavior, but ensure toggles + render stay in sync.
        try {
          // Ensure drawer is back in the editor overlay container before opening.
          const editorOverlay = getAetEditorOverlay();
          if (editorOverlay) moveAetNodeDrawerInto(editorOverlay);
          else restoreAetNodeDrawerToOriginalParent();
        } catch { /* ignore */ }

        const out = original.apply(this, [opts]);
        try { window._syncAetViewToggleUI?.(); } catch { /* ignore */ }
        try { if (typeof window.renderExecutionTimelineForSession === 'function') window.renderExecutionTimelineForSession(sid); } catch { /* ignore */ }
        return out;
      } catch {
        // If our wrapper fails, fall back to original.
        try { return original.apply(this, [opts]); } catch { return undefined; }
      }
    };
  }

  function setButtonActive(tab) {
    const bar = getMiddleBar();
    if (!bar) return;
    const btns = Array.from(bar.querySelectorAll('[data-codeon-middle-tab]'));
    for (const b of btns) {
      const t = String(b.getAttribute('data-codeon-middle-tab') || '');
      b.classList.toggle('active', t === tab);
      b.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      b.setAttribute('tabindex', t === tab ? '0' : '-1');
    }
  }

  function persistTab(tab) {
    try {
      localStorage.setItem(STORAGE_KEY, String(tab || ''));
    } catch {
      // ignore
    }
  }

  function readPersistedTab() {
    try {
      const t = String(localStorage.getItem(STORAGE_KEY) || '').trim();
      if ([TAB_CODE, TAB_AGENTS, TAB_AET, TAB_MCP, TAB_PLUGINS, TAB_LEARNING, TAB_DOCS, TAB_VERIFICATION].includes(t)) return t;
    } catch {
      // ignore
    }
    return TAB_CODE;
  }

  function ensureEditorTabsHidden() {
    const tabsEl = $('editorTabs');
    if (!tabsEl) return;
    if (editorTabsRestoreDisplay == null) {
      editorTabsRestoreDisplay = tabsEl.style.display;
    }
    tabsEl.style.display = 'none';
  }

  function restoreEditorTabsDisplay() {
    const tabsEl = $('editorTabs');
    if (!tabsEl) return;
    if (editorTabsRestoreDisplay != null) {
      tabsEl.style.display = editorTabsRestoreDisplay;
    }
    editorTabsRestoreDisplay = null;
  }

  function _embedAgentSkillLibraryIntoEditor() {
    const modal = $('agentSkillLibraryModal');
    const wrapper = getEditorWrapper();
    const overlay = getMiddleOverlay();
    if (!modal || !wrapper || !overlay) return;

    if (!agentModalOriginalParent) {
      agentModalOriginalParent = modal.parentNode;
      agentModalOriginalNextSibling = modal.nextSibling;
    }

    // Ensure the overlay is present and visible (agents view).
    overlay.style.display = 'block';

    // Re-parent into the editor wrapper so we can scope it to the middle area.
    if (modal.parentNode !== wrapper) {
      wrapper.appendChild(modal);
    }
    modal.classList.add('codeon-embedded');
  }

  function unembedAgentSkillLibrary() {
    const modal = $('agentSkillLibraryModal');
    if (!modal) return;
    modal.classList.remove('codeon-embedded');

    // Restore to original DOM position (important: other modals assume fixed fullscreen context).
    if (agentModalOriginalParent) {
      try {
        if (agentModalOriginalNextSibling && agentModalOriginalNextSibling.parentNode === agentModalOriginalParent) {
          agentModalOriginalParent.insertBefore(modal, agentModalOriginalNextSibling);
        } else {
          agentModalOriginalParent.appendChild(modal);
        }
      } catch {
        // ignore
      }
    }
  }

  function openAgentsAndSkills() {
    // Close other overlays first
    closePluginsManager();
    closeMcpManager();
    closeLearningManager();
    closeDocsManager();
    safeCall(window._closeExecutionTimelineInEditor);
    safeCall(window.closeExecutionTimeline);
    forceHideAetEditorOverlay();

    ensureEditorTabsHidden();

    // Use the new panel-based Agents & Skills manager (similar to Plugins tab)
    safeCall(window.showAgentsSkillsManager);
    safeCall(window.renderAgentsSkillsManager);
  }

  function closeAgentsAndSkills({ hide = true } = {}) {
    if (hide) safeCall(window.hideAgentsSkillsManager);
    // Legacy cleanup (in case old modal was open)
    safeCall(window.hideAgentSkillLibrary);
    unembedAgentSkillLibrary();
    const overlay = getMiddleOverlay();
    if (overlay) overlay.style.display = 'none';
    restoreEditorTabsDisplay();
  }

  function openAetInEditor() {
    // Close all other panels first
    closeAgentsAndSkills({ hide: true });
    closePluginsManager();
    closeMcpManager();
    closeLearningManager();
    closeDocsManager();

    // Reuse the existing AET open behavior (Cursor-like): graph in editor overlay by default.
    const sid = String(window.currentSessionId || '').trim();
    try {
      if (sid && typeof window._getAetViewMode === 'function' && typeof window._setAetViewMode === 'function') {
        const cur = window._getAetViewMode(sid);
        const next = (cur === 'map' || cur === 'graph') ? cur : 'graph';
        window._setAetViewMode(sid, next);
      }
    } catch {
      // ignore
    }
    safeCall(window._syncAetViewToggleUI);
    safeCall(window.closeExecutionTimeline);
    safeCall(window._openExecutionTimelineInEditor);
    if (sid) {
      safeAsync(window.loadExecutionTimelineForSession, sid);
      safeCall(window.renderExecutionTimelineForSession, sid);
    }
  }

  function closeAetInEditor() {
    safeCall(window._closeExecutionTimelineInEditor);
  }

  function forceHideAetEditorOverlay() {
    const overlay = getAetEditorOverlay();
    if (overlay) {
      try { overlay.style.display = 'none'; } catch { /* ignore */ }
    }
    const { backdrop, drawer } = getAetNodeDrawerEls();
    try { if (backdrop) backdrop.style.display = 'none'; } catch { /* ignore */ }
    try { if (drawer) drawer.style.display = 'none'; } catch { /* ignore */ }
  }

  function patchAetEditorOverlayOpenGuardOnce() {
    if (window.__codeonAetEditorOverlayOpenGuardPatched) return;
    window.__codeonAetEditorOverlayOpenGuardPatched = true;

    const original = window._openExecutionTimelineInEditor;
    if (typeof original !== 'function') return;

    window._openExecutionTimelineInEditor = function patchedOpenExecutionTimelineInEditor(...args) {
      // Prevent AET overlay from popping over other middle tabs (e.g. MCP).
      if (activeTab !== TAB_AET) return;
      return original.apply(this, args);
    };
  }

  function openMcpManager() {
    // Close all other panels first
    closeAgentsAndSkills({ hide: true });
    closeAetInEditor();
    closePluginsManager();
    closeLearningManager();
    closeDocsManager();
    closeVerificationManager();
    safeCall(window.closeExecutionTimeline);
    forceHideAetEditorOverlay();

    ensureEditorTabsHidden();

    // The MCP panel is now embedded in the editor-wrapper (no separate overlay needed)
    // Just load and render MCP UI
    safeAsync(window.loadMcpServers).then(() => {
      safeCall(window.renderMcpManager);
      safeCall(window.showMcpManager);
    });
  }

  function closeMcpManager() {
    safeCall(window.hideMcpManager);
    restoreEditorTabsDisplay();
  }

  function openPluginsManager() {
    // Close all other panels first
    closeAgentsAndSkills({ hide: true });
    closeAetInEditor();
    closeMcpManager();
    closeLearningManager();
    closeDocsManager();
    closeVerificationManager();
    safeCall(window.closeExecutionTimeline);
    forceHideAetEditorOverlay();

    ensureEditorTabsHidden();
    safeCall(window.showPluginsManager);
    safeCall(window.renderPluginsManager);
  }

  function closePluginsManager() {
    safeCall(window.hidePluginsManager);
    restoreEditorTabsDisplay();
  }

  function openLearningManager() {
    // Close all other panels first
    closeAgentsAndSkills({ hide: true });
    closeAetInEditor();
    closeMcpManager();
    closePluginsManager();
    closeDocsManager();
    closeVerificationManager();
    safeCall(window.closeExecutionTimeline);
    forceHideAetEditorOverlay();

    ensureEditorTabsHidden();
    safeCall(window.showLearningManager);
    safeCall(window.renderLearningPanel);
  }

  function closeLearningManager() {
    safeCall(window.hideLearningManager);
    restoreEditorTabsDisplay();
  }

  function openDocsManager() {
    // Close all other panels first
    closeAgentsAndSkills({ hide: true });
    closeAetInEditor();
    closeMcpManager();
    closePluginsManager();
    closeLearningManager();
    closeVerificationManager();
    safeCall(window.closeExecutionTimeline);
    forceHideAetEditorOverlay();

    ensureEditorTabsHidden();
    safeCall(window.showDocsManager);
    safeCall(window.renderDocsPanel);
  }

  function closeDocsManager() {
    safeCall(window.hideDocsManager);
    restoreEditorTabsDisplay();
  }

  function openVerificationManager() {
    // Close all other panels first
    closeAgentsAndSkills({ hide: true });
    closeAetInEditor();
    closeMcpManager();
    closePluginsManager();
    closeLearningManager();
    closeDocsManager();
    safeCall(window.closeExecutionTimeline);
    forceHideAetEditorOverlay();

    ensureEditorTabsHidden();
    safeCall(window.showVerificationManager);
    safeCall(window.renderVerificationPanel);
  }

  function closeVerificationManager() {
    safeCall(window.hideVerificationManager);
    restoreEditorTabsDisplay();
  }

  function showCode() {
    // Hide any middle overlays first.
    closeAgentsAndSkills({ hide: true });
    closeMcpManager();
    closePluginsManager();
    closeLearningManager();
    closeDocsManager();
    closeVerificationManager();
    // Ensure any AET feed overlay is closed before returning to editor/diff.
    safeCall(window.closeExecutionTimeline);
    closeAetInEditor();

    // Restore editor tabs visibility to whatever app.js had.
    restoreEditorTabsDisplay();

    // Ensure editor container is visible
    const editorContainer = getEditorContainer();
    if (editorContainer) {
      try {
        editorContainer.style.display = '';
        editorContainer.style.visibility = 'visible';
      } catch { /* ignore */ }
    }

    // Layout refresh: do it immediately and also after a small delay to ensure file has loaded
    const layoutEditors = () => {
      try {
        if (window.diffEditor && typeof window.diffEditor.layout === 'function') {
          window.diffEditor.layout();
        }
      } catch { /* ignore */ }
      try {
        if (window.editor && typeof window.editor.layout === 'function') {
          window.editor.layout();
        }
      } catch { /* ignore */ }
    };

    // Immediate layout
    layoutEditors();

    // Delayed layout (after file opens)
    setTimeout(layoutEditors, 50);
    setTimeout(layoutEditors, 150);
  }

  function setTab(tab, { persist = true } = {}) {
    const next = String(tab || '').trim();
    if (![TAB_CODE, TAB_AGENTS, TAB_AET, TAB_MCP, TAB_PLUGINS, TAB_LEARNING, TAB_DOCS, TAB_VERIFICATION].includes(next)) return;
    if (activeTab === next) return;

    activeTab = next;
    syncActiveTabToWindow();
    setButtonActive(next);
    if (persist) persistTab(next);

    if (next === TAB_CODE) showCode();
    if (next === TAB_AGENTS) openAgentsAndSkills();
    if (next === TAB_AET) openAetInEditor();
    if (next === TAB_MCP) openMcpManager();
    if (next === TAB_PLUGINS) openPluginsManager();
    if (next === TAB_LEARNING) openLearningManager();
    if (next === TAB_DOCS) openDocsManager();
    if (next === TAB_VERIFICATION) openVerificationManager();
  }

  function activateCodeTab({ persist = true } = {}) {
    try { setTab(TAB_CODE, { persist }); } catch { /* ignore */ }
  }

  function patchOpenFileToEnsureCodeTabOnce() {
    if (window.__codeonPatchedOpenFile) return;
    window.__codeonPatchedOpenFile = true;

    const originalOpenFile = window.openFile;
    if (typeof originalOpenFile !== 'function') return;

    window.openFile = async function patchedOpenFile(...args) {
      // Ensure we're on the Code tab before opening the file
      if (activeTab !== TAB_CODE) {
        try { setTab(TAB_CODE); } catch { /* ignore */ }
      }

      // Call the original openFile
      const result = await originalOpenFile.apply(this, args);

      // After the file opens, ensure the editor is properly laid out
      setTimeout(() => {
        try {
          if (window.editor && typeof window.editor.layout === 'function') {
            window.editor.layout();
          }
          if (window.diffEditor && typeof window.diffEditor.layout === 'function') {
            window.diffEditor.layout();
          }
        } catch { /* ignore */ }
      }, 100);

      return result;
    };
  }

  function patchRenderEditorTabsGuardOnce() {
    if (window.__codeonPatchedRenderEditorTabsGuard) return;
    window.__codeonPatchedRenderEditorTabsGuard = true;

    const original = window.renderEditorTabs;
    if (typeof original !== 'function') return;

    window.renderEditorTabs = function patchedRenderEditorTabs(...args) {
      try {
        const cur = String(window.__codeonMiddleActiveTab || activeTab || TAB_CODE);
        if (cur !== TAB_CODE) {
          const el = $('editorTabs');
          if (el) el.style.display = 'none';
          return;
        }
      } catch { /* ignore */ }
      return original.apply(this, args);
    };
  }

  function patchAutoSwitchToCodeOnFileIntentOnce() {
    if (window.__codeonAutoSwitchToCodeOnFileIntent) return;
    window.__codeonAutoSwitchToCodeOnFileIntent = true;

    // Capture phase so we run before app.js handlers (which call openFile / jumpToProblem etc).
    document.addEventListener('click', (e) => {
      try {
        if (!e) return;
        // Only left click; don't mess with context-menu or middle-click.
        if (typeof e.button === 'number' && e.button !== 0) return;

        const t = e.target && e.target.closest ? e.target : null;
        if (!t) return;

        // 1) File Explorer: click on a file item (not folder, not lock button, not range/toggle select).
        const fileEl = t.closest('#fileTree .file-item:not(.folder-item)');
        if (fileEl) {
          // Ignore lock toggle or other buttons inside the row.
          if (t.closest('button')) return;
          // Range/toggle selection doesn't open a file (keep current tab).
          const isRange = !!e.shiftKey;
          const isToggle = (() => {
            const isMac = (() => {
              try { return window.electronAPI && window.electronAPI.platform === 'darwin'; } catch { return false; }
            })();
            return isMac ? !!e.metaKey : !!e.ctrlKey;
          })();
          if (isRange || isToggle) return;
          activateCodeTab({ persist: true });
          return;
        }

        // 2) Chat: inline file link token
        if (t.closest('code.chat-file-link[data-chat-file-link="1"]')) {
          activateCodeTab({ persist: true });
          return;
        }

        // 3) Chat: file preview header (click opens file/diff)
        if (t.closest('.file-preview-header[data-file-path]')) {
          activateCodeTab({ persist: true });
          return;
        }

        // 4) Problems list item (jumpToProblem opens/activates editor tab)
        if (t.closest('#problemsContent .problem-item')) {
          activateCodeTab({ persist: true });
          return;
        }

        // 5) Editor tab clicks should imply "Code" (even if you were on AET/Agents).
        if (t.closest('#editorTabs .editor-tab')) {
          activateCodeTab({ persist: false }); // don't overwrite user's persisted middle tab preference
          return;
        }
      } catch {
        // ignore
      }
    }, true);
  }

  function initDom() {
    const editorContainer = getEditorContainer();
    if (!editorContainer) return false;

    // Bar
    if (!getMiddleBar()) {
      const bar = document.createElement('div');
      bar.id = 'codeonMiddleTabsBar';
      bar.className = 'codeon-middle-tabs';
      bar.setAttribute('role', 'tablist');
      bar.setAttribute('aria-label', 'Middle panel tabs');
      bar.innerHTML = `
        <button class="codeon-middle-tab-btn active" type="button" role="tab" aria-selected="true" tabindex="0" data-codeon-middle-tab="${TAB_CODE}">
          Code
        </button>
        <button class="codeon-middle-tab-btn" type="button" role="tab" aria-selected="false" tabindex="-1" data-codeon-middle-tab="${TAB_AGENTS}">
          Agents &amp; Skills
        </button>
        <button class="codeon-middle-tab-btn" type="button" role="tab" aria-selected="false" tabindex="-1" data-codeon-middle-tab="${TAB_PLUGINS}">
          Plugins
        </button>
        <button class="codeon-middle-tab-btn" type="button" role="tab" aria-selected="false" tabindex="-1" data-codeon-middle-tab="${TAB_MCP}">
          MCP
        </button>
        <button class="codeon-middle-tab-btn" type="button" role="tab" aria-selected="false" tabindex="-1" data-codeon-middle-tab="${TAB_AET}">
          AET
        </button>
        <button class="codeon-middle-tab-btn" type="button" role="tab" aria-selected="false" tabindex="-1" data-codeon-middle-tab="${TAB_LEARNING}">
          Learning mode
        </button>
        <button class="codeon-middle-tab-btn" type="button" role="tab" aria-selected="false" tabindex="-1" data-codeon-middle-tab="${TAB_DOCS}">
          Docs mode
        </button>
        <button class="codeon-middle-tab-btn" type="button" role="tab" aria-selected="false" tabindex="-1" data-codeon-middle-tab="${TAB_VERIFICATION}">
          Verification mode
        </button>
      `.trim();

      // Insert above the existing file tabs strip.
      const editorTabs = $('editorTabs');
      if (editorTabs && editorTabs.parentNode === editorContainer) {
        editorContainer.insertBefore(bar, editorTabs);
      } else {
        editorContainer.insertBefore(bar, editorContainer.firstChild);
      }
    }

    // Overlay (for embedding the Agents & Skills library modal)
    const wrapper = getEditorWrapper();
    if (wrapper && !getMiddleOverlay()) {
      const overlay = document.createElement('div');
      overlay.id = 'codeonMiddleOverlay';
      overlay.className = 'codeon-middle-overlay';
      overlay.style.display = 'none';
      wrapper.appendChild(overlay);
    }

    // Wire clicks
    const bar = getMiddleBar();
    if (bar && !bar.__codeonBound) {
      bar.__codeonBound = true;
      bar.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-codeon-middle-tab]') : null;
        if (!btn) return;
        e.preventDefault();
        const t = String(btn.getAttribute('data-codeon-middle-tab') || '');
        setTab(t);
      });

      // Keyboard navigation (Left/Right)
      bar.addEventListener('keydown', (e) => {
        const key = e.key;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        const btns = Array.from(bar.querySelectorAll('[data-codeon-middle-tab]'));
        if (!btns.length) return;
        const curIdx = Math.max(0, btns.findIndex(b => b.classList.contains('active')));
        let nextIdx = curIdx;
        if (key === 'ArrowLeft') nextIdx = (curIdx - 1 + btns.length) % btns.length;
        if (key === 'ArrowRight') nextIdx = (curIdx + 1) % btns.length;
        if (key === 'Home') nextIdx = 0;
        if (key === 'End') nextIdx = btns.length - 1;
        e.preventDefault();
        btns[nextIdx].focus();
        const t = String(btns[nextIdx].getAttribute('data-codeon-middle-tab') || '');
        setTab(t);
      });
    }

    // Keep the tab bar in sync with existing UI buttons:
    // - Execution Timeline button should properly switch to AET tab (both visual + content)
    const tlBtn = $('executionTimelineButton');
    if (tlBtn && !tlBtn.__codeonMiddleTabsBound) {
      tlBtn.__codeonMiddleTabsBound = true;
      tlBtn.addEventListener('click', (e) => {
        // Prevent default + stop propagation to avoid double-execution
        e.preventDefault();
        e.stopPropagation();
        // Properly switch to AET tab (this will open AET in editor overlay)
        setTab(TAB_AET);
      }, true);
    }

    // Removed: AET overlay "back" chevron button in the header.

    // - "Manage agents & skills…" button should properly switch to Agents tab (both visual + content)
    const openLibBtn = $('openAgentSkillLibraryButton');
    if (openLibBtn && !openLibBtn.__codeonMiddleTabsBound) {
      openLibBtn.__codeonMiddleTabsBound = true;
      openLibBtn.addEventListener('click', (e) => {
        // Prevent default + stop propagation to avoid double-execution
        e.preventDefault();
        e.stopPropagation();
        // Properly switch to Agents tab (this will open the library)
        setTab(TAB_AGENTS);
      }, true);
    }

    // If user closes the library modal while on Agents tab, go back to Code.
    const closeLibBtn = $('closeAgentSkillLibraryButton');
    if (closeLibBtn && !closeLibBtn.__codeonMiddleTabsBound) {
      closeLibBtn.__codeonMiddleTabsBound = true;
      closeLibBtn.addEventListener('click', (e) => {
        // Prevent default to ensure clean transition
        e.preventDefault();
        e.stopPropagation();
        // Properly switch back to Code tab
        setTab(TAB_CODE);
      }, true);
    }

    return true;
  }

  function init() {
    const ok = initDom();
    if (!ok) return;

    // Keep global in sync for other modules.
    syncActiveTabToWindow();

    // Patch AET feed routing so Feed lives in the middle pane when AET tab is active.
    patchAetFeedRoutingOnce();
    // Patch node drawer routing so clicking nodes in Feed doesn't jump to Graph/Map.
    patchAetNodeDrawerRoutingOnce();
    // Prevent AET overlay from opening unless the active middle tab is AET.
    patchAetEditorOverlayOpenGuardOnce();
    // Patch openFile to ensure Code tab is active and editor is laid out when files open.
    patchOpenFileToEnsureCodeTabOnce();
    // Prevent editor tab strip from re-appearing while non-Code middle tabs are active.
    patchRenderEditorTabsGuardOnce();
    // UX: any "open/jump to file" intent should return the middle pane to Code.
    patchAutoSwitchToCodeOnFileIntentOnce();

    // Default tab: restored from storage (but never force-open Agents/AET if app isn't ready yet).
    const restored = readPersistedTab();
    activeTab = TAB_CODE;
    syncActiveTabToWindow();
    setButtonActive(TAB_CODE);

    // Defer one tick so app.js can finish wiring before we attempt to open heavy UIs.
    setTimeout(() => {
      try {
        // Only auto-restore to Agents/AET/MCP/Learning once the editor exists.
        const editorEl = $('editor');
        if (!editorEl) return;
        if (restored === TAB_AGENTS) setTab(TAB_AGENTS, { persist: false });
        else if (restored === TAB_PLUGINS) setTab(TAB_PLUGINS, { persist: false });
        else if (restored === TAB_MCP) setTab(TAB_MCP, { persist: false });
        else if (restored === TAB_AET) setTab(TAB_AET, { persist: false });
        else if (restored === TAB_LEARNING) setTab(TAB_LEARNING, { persist: false });
        else if (restored === TAB_DOCS) setTab(TAB_DOCS, { persist: false });
        else if (restored === TAB_VERIFICATION) setTab(TAB_VERIFICATION, { persist: false });
      } catch {
        // ignore
      }
    }, 0);
  }

  // Expose a reset function for when a new folder is opened
  window._resetMiddleTabToCode = function () {
    try {
      setTab(TAB_CODE, { persist: true });
    } catch {
      // fallback: direct assignment
      activeTab = TAB_CODE;
      setButtonActive(TAB_CODE);
      persistTab(TAB_CODE);
      showCode();
    }
  };

  // Expose a function to switch to the Learning tab (used by learning link cards in chat)
  window._activateLearningTab = function () {
    try {
      setTab(TAB_LEARNING, { persist: true });
    } catch {
      // ignore - Learning tab might not be initialized yet
    }
  };

  // Expose a function to switch to the Docs tab (used by documentation link cards in chat)
  window._activateDocsTab = function () {
    try {
      setTab(TAB_DOCS, { persist: true });
    } catch {
      // ignore - Docs tab might not be initialized yet
    }
  };

  window._activateVerificationTab = function () {
    try {
      setTab(TAB_VERIFICATION, { persist: true });
    } catch {
      // ignore - Verification tab might not be initialized yet
    }
  };

  // Robust ready hook (works even when loaded after DOMContentLoaded).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


