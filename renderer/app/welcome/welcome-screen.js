// ===========================
// WELCOME SCREEN & RECENT PROJECTS
// ===========================

/**
 * Check if LLM provider is properly configured and show modal if not.
 * This ensures users complete the provider setup even if they closed the app
 * before selecting a provider after signing in.
 */
async function checkAndShowLlmProviderModalIfNeeded() {
  try {
    // Wait for settings to be loaded
    if (typeof settings === 'undefined') {
      console.log('[Welcome] Settings not loaded yet, skipping LLM provider check');
      return;
    }
    
    // Check llmProvider (new field) or authMode (legacy field) for backward compatibility
    const provider = settings.llmProvider || settings.authMode;
    console.log('[Welcome] Checking LLM provider configuration:', provider);
    
    // Check if provider is set
    if (!provider) {
      console.log('[Welcome] No LLM provider set, showing modal');
      showLlmProviderModal();
      return;
    }
    
    // Check if the selected provider has valid credentials
    let needsSetup = false;
    
    if (provider === 'claude_ai') {
      // Check if Claude.ai credentials exist
      if (window.electronAPI && typeof window.electronAPI.claudeCheckCredentials === 'function') {
        const res = await window.electronAPI.claudeCheckCredentials();
        if (!res || res.success !== true || res.hasCredentials !== true) {
          console.log('[Welcome] Claude.ai selected but no credentials found');
          needsSetup = true;
        }
      }
    } else if (provider === 'anthropic_api' || provider === 'api_key') {
      // Check if API key is set (api_key is legacy authMode value)
      if (!settings.apiKey || settings.apiKey.trim() === '') {
        console.log('[Welcome] Anthropic API selected but no API key set');
        needsSetup = true;
      }
    } else if (provider === 'openrouter') {
      // Check if OpenRouter API key is set
      if (!settings.openrouterApiKey || settings.openrouterApiKey.trim() === '') {
        console.log('[Welcome] OpenRouter selected but no API key set');
        needsSetup = true;
      }
    }
    
    if (needsSetup) {
      console.log('[Welcome] LLM provider needs setup, showing modal');
      showLlmProviderModal();
    } else {
      console.log('[Welcome] LLM provider is properly configured');
    }
  } catch (err) {
    console.error('[Welcome] Error checking LLM provider:', err);
  }
}

/**
 * Show the LLM provider selection modal
 */
function showLlmProviderModal() {
  if (typeof LlmProviderSelectModal !== 'undefined' && typeof LlmProviderSelectModal.show === 'function') {
    LlmProviderSelectModal.show(() => {
      console.log('[Welcome] LLM provider selection completed');
    });
  } else {
    console.warn('[Welcome] LlmProviderSelectModal not available');
  }
}

// Load recent projects from file system (Desktop App)
async function loadRecentProjects() {
  try {
    if (window.electronAPI) {
      const result = await window.electronAPI.loadRecentProjects();
      if (result.success) {
        // Filter out any invalid entries
        return result.projects.filter(p => p && p.name && p.path && p.name !== 'undefined');
      }
    }
    return [];
  } catch (e) {
    console.error('[Recent Projects] Failed to load:', e);
    return [];
  }
}

// Save recent projects to file system (Desktop App)
async function saveRecentProjects(projects) {
  try {
    if (window.electronAPI) {
      const result = await window.electronAPI.saveRecentProjects(projects);
      if (result.success) {
        console.log('[Recent Projects] Saved to disk:', result.path);
      } else {
        console.error('[Recent Projects] Failed to save:', result.error);
      }
    }
  } catch (e) {
    console.error('[Recent Projects] Save error:', e);
  }
}

// Add a project to recent projects
async function addToRecentProjects(projectPath) {
  if (!projectPath) return;

  let projects = await loadRecentProjects();

  // Remove if already exists
  projects = projects.filter(p => p.path !== projectPath);

  // Add to beginning
  // Remove trailing slashes and extract folder name
  const cleanPath = projectPath.replace(/[\\/]+$/, '');
  const pathParts = cleanPath.split(/[\\/]/);
  const projectName = pathParts[pathParts.length - 1] || 'Unknown Project';

  projects.unshift({
    name: projectName,
    path: projectPath,
    lastOpened: new Date().toISOString()
  });

  // Keep only last 5 projects
  projects = projects.slice(0, 5);

  await saveRecentProjects(projects);
  await renderRecentProjects();
}

// Remove a project from recent projects
async function removeFromRecentProjects(projectPath) {
  let projects = await loadRecentProjects();
  projects = projects.filter(p => p.path !== projectPath);
  await saveRecentProjects(projects);
  await renderRecentProjects();
}

// Render recent projects list
async function renderRecentProjects() {
  const projects = await loadRecentProjects();
  const recentProjectsList = document.getElementById('recentProjectsList');
  const recentProjectsSection = document.getElementById('recentProjectsSection');

  if (!recentProjectsList || !recentProjectsSection) return;

  if (projects.length === 0) {
    recentProjectsSection.style.display = 'none';
    return;
  }

  recentProjectsSection.style.display = 'flex';
  recentProjectsList.innerHTML = '';

  projects.forEach(project => {
    const item = document.createElement('div');
    item.className = 'recent-project-item';

    item.innerHTML = `
      <div class="recent-project-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div class="recent-project-info">
        <div class="recent-project-name">${project.name}</div>
        <div class="recent-project-path">${project.path}</div>
      </div>
      <button class="recent-project-remove" data-path="${project.path}" title="Remove from recent">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    // Click to open project
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.recent-project-remove')) return; // Don't open if clicking remove

      if (window.electronAPI) {
        // CRITICAL: Use openProjectByPath to ensure currentProject is set in main process
        const result = await window.electronAPI.openProjectByPath(project.path);
        if (result.success) {
          await handleFolderOpened({ path: result.path, files: result.files });
        } else {
          await customAlert('Failed to open project. The path may no longer exist.');
          await removeFromRecentProjects(project.path);
        }
      }
    });

    // Remove button
    const removeBtn = item.querySelector('.recent-project-remove');
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeFromRecentProjects(project.path);
    });

    recentProjectsList.appendChild(item);
  });
}

// Show welcome screen
async function showWelcomeScreen() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  const app = document.getElementById('app');

  if (welcomeScreen && app) {
    welcomeScreen.style.display = 'flex';
    app.style.display = 'none';
  }

  await renderRecentProjects();
}

function initStickyPromptsScrollState() {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const update = () => {
    try {
      container.classList.toggle('scrolled', container.scrollTop > 0);
    } catch { /* ignore */ }
  };

  // Avoid double-binding if something re-calls init (defensive).
  if (!container.dataset.stickyPromptsScrollBound) {
    container.addEventListener('scroll', update, { passive: true });
    container.dataset.stickyPromptsScrollBound = '1';
  }

  update();
}

function initChatFileLinkNavigation() {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  if (container.dataset.chatFileLinkNavBound === '1') return;
  container.dataset.chatFileLinkNavBound = '1';

  container.addEventListener('click', async (e) => {
    try {
      const urlTarget = e && e.target && e.target.closest
        ? e.target.closest('a.chat-url-link[data-chat-url-link="1"]')
        : null;
      if (urlTarget) {
        e.preventDefault();
        e.stopPropagation();
        const href = String(urlTarget.getAttribute('href') || urlTarget.textContent || '').trim();
        if (!href) return;
        try {
          if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
            await window.electronAPI.openExternal(href);
          } else {
            window.open(href, '_blank');
          }
        } catch { /* ignore */ }
        return;
      }

      const target = e && e.target && e.target.closest ? e.target.closest('code.chat-file-link[data-chat-file-link="1"]') : null;
      if (!target) return;
      // Ignore code blocks; this is for inline-highlighted tokens.
      if (target.closest && target.closest('pre')) return;
      e.preventDefault();
      e.stopPropagation();

      const token = cleanFileToken(target.textContent || '');
      const rel = resolveFileTokenToRelPath(token);
      if (!rel) {
        showToast('File not found in this project');
        return;
      }
      await openRelPathFromChat(rel, { jumpToDiff: false });
    } catch {
      // ignore
    }
  });
}

// Hide welcome screen and show main app
function hideWelcomeScreen() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  const app = document.getElementById('app');

  if (welcomeScreen && app) {
    welcomeScreen.style.display = 'none';
    app.style.display = 'flex';
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
  // Dev-only AET debug: enable in DevTools console:
  //   localStorage.setItem('codeon.aetDebug', '1'); location.reload()
  // Disable:
  //   localStorage.removeItem('codeon.aetDebug'); location.reload()
  try { await syncAetDebugToMain(); } catch { /* ignore */ }

  // Claude SDK wrapper build: no local embeddings / agent runtime.
  // Hide the old loading screen immediately (it was for embeddings/indexing).
  const modelLoadingScreen = document.getElementById('modelLoadingScreen');
  if (modelLoadingScreen) modelLoadingScreen.style.display = 'none';

  // Check if an LLM provider is configured - show the provider modal if not.
  try {
    await checkAndShowLlmProviderModalIfNeeded();
  } catch (providerErr) {
    console.error('[Welcome] LLM provider modal error:', providerErr);
  }

  initStickyPromptsScrollState();
  initChatFileLinkNavigation();
  await showWelcomeScreen();

  // Welcome screen open folder button
  const welcomeOpenFolder = document.getElementById('welcomeOpenFolder');
  if (welcomeOpenFolder) {
    welcomeOpenFolder.addEventListener('click', openFolder);
  }
});


