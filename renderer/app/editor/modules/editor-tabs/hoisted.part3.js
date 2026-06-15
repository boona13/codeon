// ---- CHUNK 3/7 from hoisted.js (AST statement boundaries; order preserved) ----



function applyLlmProviderUI() {
  const provider = settings?.llmProvider || 'claude_ai';
  
  // Update radio button visual state (highlight selected)
  const labels = ['providerClaudeAiLabel', 'providerAnthropicLabel', 'providerOpenRouterLabel', 'providerCodexLabel'];
  labels.forEach(id => {
    const label = document.getElementById(id);
    if (label) {
      label.style.borderColor = 'transparent';
      label.style.background = 'rgba(100, 116, 139, 0.05)';
    }
  });
  
  const activeLabel = {
    'claude_ai': 'providerClaudeAiLabel',
    'anthropic_api': 'providerAnthropicLabel',
    'openrouter': 'providerOpenRouterLabel',
    'codex': 'providerCodexLabel'
  }[provider];
  
  if (activeLabel) {
    const label = document.getElementById(activeLabel);
    if (label) {
      label.style.borderColor = '#14b8a6';
      label.style.background = 'rgba(20, 184, 166, 0.1)';
    }
  }
  
  // Show/hide sections based on provider
  const claudeAiSection = document.getElementById('claudeAiLoginSection');
  const anthropicSection = document.getElementById('anthropicApiKeySection');
  const openrouterSection = document.getElementById('openrouterSection');
  const codexSection = document.getElementById('codexSection');
  
  if (claudeAiSection) claudeAiSection.style.display = (provider === 'claude_ai') ? '' : 'none';
  if (anthropicSection) anthropicSection.style.display = (provider === 'anthropic_api') ? '' : 'none';
  if (openrouterSection) openrouterSection.style.display = (provider === 'openrouter') ? '' : 'none';
  if (codexSection) {
    codexSection.style.display = (provider === 'codex') ? '' : 'none';
    if (provider === 'codex') { try { refreshCodexStatusUI(); } catch { /* ignore */ } }
  }
}

// ---- Codex (ChatGPT) provider UI ----
function applyCodexStatus(status) {
  const valueEl = document.getElementById('codexStatusValue');
  const loginBtn = document.getElementById('codexLoginButton');
  const logoutBtn = document.getElementById('codexLogoutButton');
  const connected = status && status.connected === true;
  if (valueEl) {
    if (connected) {
      valueEl.textContent = status.email ? `Connected (${status.email})` : 'Connected';
      valueEl.style.color = '#5eead4';
    } else if (status && status.loginPending) {
      valueEl.textContent = 'Waiting for browser sign-in…';
      valueEl.style.color = '#94a3b8';
    } else if (status && status.loginError) {
      valueEl.textContent = `Sign-in failed: ${status.loginError}`;
      valueEl.style.color = '#f87171';
    } else {
      valueEl.textContent = 'Not connected';
      valueEl.style.color = '';
    }
  }
  if (loginBtn) loginBtn.style.display = connected ? 'none' : '';
  if (logoutBtn) logoutBtn.style.display = connected ? '' : 'none';
}

async function refreshCodexStatusUI() {
  if (!window.electronAPI || !window.electronAPI.codex) return;
  try {
    const res = await window.electronAPI.codex.status();
    if (res && res.success) applyCodexStatus(res.status);
  } catch { /* ignore */ }
}

async function refreshCodexModelsUI({ openLoginIfNeeded = false } = {}) {
  const sel = document.getElementById('codexModelInput');
  if (!sel || !window.electronAPI || !window.electronAPI.codex) return;
  try {
    const res = await window.electronAPI.codex.models();
    const models = (res && res.success && Array.isArray(res.models)) ? res.models : [];
    if (models.length) {
      const current = settings.codexModel || sel.value || 'codex/gpt-5.5';
      sel.innerHTML = '';
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.vision ? `${m.name} \uD83D\uDCF7` : m.name;
        sel.appendChild(opt);
      }
      if (models.some(m => m.id === current)) sel.value = current;
      else { sel.value = models[0].id; settings.codexModel = models[0].id; }
    }
  } catch { /* keep static fallback options */ }
}


async function refreshClaudeAuthStatus() {
  const el = document.getElementById('claudeAuthStatusValue');
  if (!el) return;

  normalizeClaudeAuthMode();
  const usingClaudeAi = settings.authMode === 'claude_ai';
  const hasApiKey = typeof settings.apiKey === 'string' && settings.apiKey.trim().length > 0;

  // UI-only messaging
  if (!usingClaudeAi) {
    el.textContent = hasApiKey ? 'API key configured' : 'API key missing';
    return;
  }

  if (!window.electronAPI || typeof window.electronAPI.claudeSdkAccountInfo !== 'function') {
    el.textContent = 'Login status unavailable';
    return;
  }

  el.textContent = 'Checking…';
  try {
    const res = await window.electronAPI.claudeSdkAccountInfo({
      // Force token-based auth by passing empty apiKey; claude-sdk-service strips env ANTHROPIC_API_KEY.
      apiKey: '',
      authMode: 'claude_ai'
    });
    if (!res || res.success !== true) {
      el.textContent = `Error: ${res?.error || 'Unknown error'}`;
      return;
    }

    const account = res.account && typeof res.account === 'object' ? res.account : null;
    const email = account && typeof account.email === 'string' ? account.email : '';
    const sub = account && typeof account.subscriptionType === 'string' ? account.subscriptionType : '';
    const tokenSource = account && typeof account.tokenSource === 'string' ? account.tokenSource : '';

    if (email || sub || tokenSource) {
      const parts = [];
      parts.push(email ? `Logged in as ${email}` : 'Logged in');
      if (sub) parts.push(sub);
      if (tokenSource) parts.push(`token: ${tokenSource}`);
      el.textContent = parts.join(' · ');
      // Auth is ready; refresh models list now (best-effort).
      try { refreshClaudeModelComposerSelect({ force: true }); } catch { /* ignore */ }
    } else {
      el.textContent = 'Not logged in';
    }
  } catch (e) {
    el.textContent = `Error: ${e?.message || String(e)}`;
  }
}


function getClaudeApiKeyForSdkCalls() {
  normalizeClaudeAuthMode();
  const usingClaudeAi = settings.authMode === 'claude_ai';
  const hasApiKey = typeof settings.apiKey === 'string' && settings.apiKey.trim().length > 0;
  return usingClaudeAi ? '' : (hasApiKey ? String(settings.apiKey || '').trim() : '');
}


async function fetchClaudeSupportedModelsBestEffort({ force = false } = {}) {
  const now = Date.now();
  const ttlMs = 5 * 60_000;
  if (!force && Array.isArray(claudeSupportedModelsCache) && (now - claudeSupportedModelsFetchedAt) < ttlMs) {
    return claudeSupportedModelsCache;
  }
  if (!window.electronAPI || typeof window.electronAPI.claudeSdkSupportedModels !== 'function') {
    return null;
  }
  const apiKey = getClaudeApiKeyForSdkCalls();
  try {
    const res = await window.electronAPI.claudeSdkSupportedModels({ apiKey });
    if (res && res.success === true && Array.isArray(res.models)) {
      claudeSupportedModelsCache = res.models;
      claudeSupportedModelsFetchedAt = now;
      return claudeSupportedModelsCache;
    }
  } catch {
    // ignore
  }
  return null;
}


async function refreshClaudeModelComposerSelect({ force = false } = {}) {
  try {
    const el = document.getElementById('claudeModelComposerInput');
    if (!el) return;

    // If the user is actively interacting with the select, don't rebuild options.
    // Replacing options during the native dropdown open will cause it to immediately close.
    try {
      if (document && document.activeElement === el) return;
    } catch { /* ignore */ }

    const provider = settings?.llmProvider || 'claude_ai';

  // If OpenRouter is selected, show reasoning models from settings dropdown
  if (provider === 'openrouter') {
    try {
      // Vision-capable models (stable selection)
      const VISION_MODELS = new Set([
        'anthropic/claude-opus-4.8',
        'anthropic/claude-opus-4.8-fast',
        'anthropic/claude-opus-4.7',
        'anthropic/claude-sonnet-4.6',
        'anthropic/claude-opus-4.6',
        'anthropic/claude-opus-4.5',
        'anthropic/claude-sonnet-4.5',
        'anthropic/claude-haiku-4.5',
        'openai/gpt-5.5-pro',
        'openai/gpt-5.5',
        'openai/gpt-5.4',
        'openai/gpt-5.4-mini',
        'openai/gpt-5.3-codex',
        'openai/gpt-5.2-codex',
        'openai/gpt-5.2',
        'google/gemini-3.5-flash',
        'google/gemini-3.1-pro-preview',
        'google/gemini-3.1-flash-lite',
        'google/gemini-3-pro-preview',
        'x-ai/grok-4.3',
        'x-ai/grok-4.20'
      ]);

      const openrouterModels = [
        // Anthropic Claude (Stable)
        { value: 'anthropic/claude-opus-4.8', label: 'Opus 4.8' },
        { value: 'anthropic/claude-opus-4.8-fast', label: 'Opus 4.8 Fast' },
        { value: 'anthropic/claude-opus-4.7', label: 'Opus 4.7' },
        { value: 'anthropic/claude-sonnet-4.6', label: 'Sonnet 4.6' },
        { value: 'anthropic/claude-opus-4.6', label: 'Opus 4.6' },
        { value: 'anthropic/claude-opus-4.5', label: 'Opus 4.5' },
        { value: 'anthropic/claude-sonnet-4.5', label: 'Sonnet 4.5' },
        { value: 'anthropic/claude-haiku-4.5', label: 'Haiku 4.5' },
        // OpenAI (Stable)
        { value: 'openai/gpt-5.5-pro', label: 'GPT-5.5 Pro' },
        { value: 'openai/gpt-5.5', label: 'GPT-5.5' },
        { value: 'openai/gpt-5.4', label: 'GPT-5.4' },
        { value: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
        { value: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex' },
        { value: 'openai/gpt-5.2-codex', label: 'GPT-5.2 Codex' },
        { value: 'openai/gpt-5.2', label: 'GPT-5.2' },
        // Google Gemini (Stable)
        { value: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
        { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
        { value: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
        { value: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro' },
        // xAI (Stable)
        { value: 'x-ai/grok-4.3', label: 'Grok 4.3' },
        { value: 'x-ai/grok-4.20', label: 'Grok 4.20' },
        { value: 'x-ai/grok-code-fast-1', label: 'Grok Code Fast' }
      ];

      const currentModel = settings?.openrouterModel || '';
      el.innerHTML = '';
      
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Select reasoning model...';
      el.appendChild(defaultOpt);
      
      for (const m of openrouterModels) {
        const opt = document.createElement('option');
        opt.value = m.value;
        // Add 📷 emoji for vision-capable models
        const visionIcon = VISION_MODELS.has(m.value) ? '📷 ' : '';
        opt.textContent = visionIcon + m.label;
        el.appendChild(opt);
      }
      
      el.value = currentModel;
    } catch (err) {
      console.error('[Composer Model Select] Error populating OpenRouter models:', err);
    }
    return;
  }

  // If Codex is selected, show the ChatGPT-account models (live catalog with static fallback)
  if (provider === 'codex') {
    try {
      let models = [];
      try {
        if (window.electronAPI && window.electronAPI.codex) {
          const res = await window.electronAPI.codex.models();
          if (res && res.success && Array.isArray(res.models)) models = res.models;
        }
      } catch { /* ignore — fall back to static list */ }

      if (!models.length) {
        models = [
          { id: 'codex/gpt-5.5', name: 'GPT-5.5', vision: true },
          { id: 'codex/gpt-5.5:high', name: 'GPT-5.5 (high reasoning)', vision: true },
          { id: 'codex/gpt-5.4', name: 'GPT-5.4', vision: true },
          { id: 'codex/gpt-5.4:high', name: 'GPT-5.4 (high reasoning)', vision: true },
        ];
      }

      const currentModel = settings?.codexModel || 'codex/gpt-5.5';
      el.innerHTML = '';
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = (m.vision ? '📷 ' : '') + (m.name || m.id);
        el.appendChild(opt);
      }
      if (models.some(m => m.id === currentModel)) {
        el.value = currentModel;
      } else if (models.length) {
        el.value = models[0].id;
        settings.codexModel = models[0].id;
      }
    } catch (err) {
      console.error('[Composer Model Select] Error populating Codex models:', err);
    }
    return;
  }

  // Standard Anthropic model list
  const isDefaultModelValue = (v) => {
    const s = String(v || '').trim().toLowerCase();
    return s === '' || s === 'default';
  };

  // Ensure a default option exists immediately.
  const ensureDefault = () => {
    try {
      const hasDefault = Array.from(el.options || []).some(o => String(o.value) === '');
      if (!hasDefault) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Default model';
        el.insertBefore(opt, el.firstChild || null);
      }
    } catch { /* ignore */ }
  };
  ensureDefault();

  // Fetch list
  const models = await fetchClaudeSupportedModelsBestEffort({ force });
  if (!Array.isArray(models) || models.length === 0) return;

  // Preserve current selection
  const selectedRaw = (typeof settings.claudeModel === 'string' ? settings.claudeModel.trim() : '') || '';
  const selected = (selectedRaw.toLowerCase() === 'default') ? '' : selectedRaw;

  // Rebuild options (keep Default first)
  try {
    // Prefer SDK-provided default label if present, but map it to empty value so we never pass a "default" model id.
    const sdkDefault =
      models.find(m => m && typeof m === 'object' && isDefaultModelValue(m.value) && typeof m.displayName === 'string' && m.displayName.trim()) ||
      models.find(m => m && typeof m === 'object' && typeof m.displayName === 'string' && m.displayName.toLowerCase().includes('default'));
    const defaultLabel = (sdkDefault && typeof sdkDefault.displayName === 'string' && sdkDefault.displayName.trim())
      ? sdkDefault.displayName.trim()
      : 'Default model';

    el.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = defaultLabel;
    el.appendChild(def);
    for (const m of models) {
      if (!m || typeof m !== 'object') continue;
      const valueRaw = typeof m.value === 'string' ? m.value.trim() : '';
      // Skip SDK "default" model entry to avoid duplicates (we render our own default option above).
      if (isDefaultModelValue(valueRaw)) continue;
      const value = valueRaw;
      let label = typeof m.displayName === 'string' ? m.displayName.trim() : '';
      if (!label) label = value;
      if (!value || !label) continue;
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label || value;
      const desc = typeof m.description === 'string' ? m.description.trim() : '';
      if (desc) opt.title = desc;
      el.appendChild(opt);
    }
    el.value = selected;
  } catch (err) {
    console.error('[Composer Model Select] Error updating Anthropic models:', err);
  }
  } catch (err) {
    console.error('[Composer Model Select] Fatal error:', err);
  }
}


// Check if API key is configured
function checkApiKey() {
  const warning = document.getElementById('apiKeyWarning');
  const hasApiKey = typeof settings.apiKey === 'string' && settings.apiKey.trim().length > 0;
  normalizeClaudeAuthMode();
  const authMode = settings.authMode === 'api_key' ? 'api_key' : 'claude_ai';

  // Only warn when the user explicitly selected API key auth but didn't provide one.
  if (authMode === 'api_key' && !hasApiKey) {
    warning.style.display = 'flex';
  } else {
    warning.style.display = 'none';
  }
}
