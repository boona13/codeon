/**
 * LLM Provider Selection Modal
 * Shows after sign-in to let user select their preferred LLM provider.
 */

const LlmProviderSelectModal = (function() {
  'use strict';

  let _modal = null;
  let _isInitialized = false;
  let _onComplete = null;
  let _claudeSignInPending = false;
  let _credentialsPollInterval = null;
  let _claudeSignedIn = false;

  /**
   * Create the modal HTML
   */
  function createModal() {
    const modal = document.createElement('div');
    modal.id = 'llmProviderSelectModal';
    modal.className = 'modal llm-provider-select-modal';
    modal.style.display = 'none';
    
    modal.innerHTML = `
      <div class="modal-content llm-provider-select-content">
        <div class="modal-header">
          <h2>Select Your AI Provider</h2>
        </div>
        <div class="modal-body">
          <div class="llm-provider-hero">
            <svg class="llm-provider-hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
              <circle cx="9" cy="13" r="1.25" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="13" r="1.25" fill="currentColor" stroke="none"/>
              <path d="M9 17h6" stroke-linecap="round"/>
            </svg>
            <p class="llm-provider-subtitle">Choose how you'd like to connect to Claude AI</p>
          </div>

          <div class="llm-provider-options">
            <!-- Option 1: Claude.ai Login -->
            <div class="llm-provider-option" data-provider="claude_ai">
              <div class="llm-provider-option-header">
                <input type="radio" name="llmProviderSelect" value="claude_ai" id="llmProviderClaudeAi" checked>
                <label for="llmProviderClaudeAi" class="llm-provider-option-label">
                  <svg class="llm-provider-option-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  <span class="llm-provider-option-title">Claude.ai Login</span>
                  <span class="llm-provider-option-badge recommended">Recommended</span>
                </label>
              </div>
              <p class="llm-provider-option-desc">Use your Claude.ai subscription — no API billing required</p>
              <div class="llm-provider-action" id="llmProviderClaudeAiAction">
                <button type="button" class="btn-primary llm-provider-signin-btn" id="llmProviderClaudeSignInBtn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                    <polyline points="10 17 15 12 10 7"/>
                    <line x1="15" y1="12" x2="3" y2="12"/>
                  </svg>
                  Sign in with Claude.ai
                </button>
                <div class="llm-provider-signin-status" id="llmProviderClaudeStatus" style="display: none;">
                  <svg class="spinner" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="60 30"></circle>
                  </svg>
                  <span>Waiting for sign-in...</span>
                </div>
              </div>
            </div>

            <!-- Option 2: Anthropic API Key -->
            <div class="llm-provider-option" data-provider="anthropic_api">
              <div class="llm-provider-option-header">
                <input type="radio" name="llmProviderSelect" value="anthropic_api" id="llmProviderAnthropic">
                <label for="llmProviderAnthropic" class="llm-provider-option-label">
                  <svg class="llm-provider-option-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                  </svg>
                  <span class="llm-provider-option-title">Anthropic API Key</span>
                </label>
              </div>
              <p class="llm-provider-option-desc">Direct API access — pay per token used</p>
              <div class="llm-provider-action" id="llmProviderAnthropicAction" style="display: none;">
                <div class="llm-provider-input-group">
                  <input type="password" 
                         class="form-input llm-provider-api-input" 
                         id="llmProviderAnthropicKey" 
                         placeholder="sk-ant-api03-..."
                         autocomplete="off">
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" class="llm-provider-api-link">
                    Get API key
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </a>
                </div>
              </div>
            </div>

            <!-- Option 3: OpenRouter -->
            <div class="llm-provider-option" data-provider="openrouter">
              <div class="llm-provider-option-header">
                <input type="radio" name="llmProviderSelect" value="openrouter" id="llmProviderOpenRouter">
                <label for="llmProviderOpenRouter" class="llm-provider-option-label">
                  <svg class="llm-provider-option-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                  <span class="llm-provider-option-title">OpenRouter</span>
                </label>
              </div>
              <p class="llm-provider-option-desc">Access multiple LLM providers with reasoning models</p>
              <div class="llm-provider-action" id="llmProviderOpenRouterAction" style="display: none;">
                <div class="llm-provider-input-group">
                  <input type="password" 
                         class="form-input llm-provider-api-input" 
                         id="llmProviderOpenRouterKey" 
                         placeholder="sk-or-v1-..."
                         autocomplete="off">
                  <a href="https://openrouter.ai/keys" target="_blank" class="llm-provider-api-link">
                    Get API key
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div class="llm-provider-actions">
            <button type="button" class="btn-primary llm-provider-continue" id="llmProviderContinueBtn">
              Continue
            </button>
          </div>

          <p class="llm-provider-note">You can change this anytime in Settings</p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    return modal;
  }

  /**
   * Get selected provider value
   */
  function getSelectedProvider() {
    const selected = _modal.querySelector('input[name="llmProviderSelect"]:checked');
    return selected ? selected.value : 'claude_ai';
  }

  /**
   * Show/hide action panels based on selected provider
   */
  function updateActionVisibility() {
    const provider = getSelectedProvider();
    
    // Hide all action panels first
    document.getElementById('llmProviderClaudeAiAction').style.display = 'none';
    document.getElementById('llmProviderAnthropicAction').style.display = 'none';
    document.getElementById('llmProviderOpenRouterAction').style.display = 'none';
    
    // Show the selected one
    if (provider === 'claude_ai') {
      document.getElementById('llmProviderClaudeAiAction').style.display = 'block';
    } else if (provider === 'anthropic_api') {
      document.getElementById('llmProviderAnthropicAction').style.display = 'block';
    } else if (provider === 'openrouter') {
      document.getElementById('llmProviderOpenRouterAction').style.display = 'block';
    }
    
    // Update visual selection state
    _modal.querySelectorAll('.llm-provider-option').forEach(opt => {
      opt.classList.remove('selected');
    });
    const selectedOption = _modal.querySelector(`.llm-provider-option[data-provider="${provider}"]`);
    if (selectedOption) {
      selectedOption.classList.add('selected');
    }
  }

  /**
   * Validate the current selection
   */
  function validateSelection() {
    const provider = getSelectedProvider();
    
    if (provider === 'anthropic_api') {
      const key = document.getElementById('llmProviderAnthropicKey').value.trim();
      if (!key) {
        return { valid: false, message: 'Please enter your Anthropic API key' };
      }
    } else if (provider === 'openrouter') {
      const key = document.getElementById('llmProviderOpenRouterKey').value.trim();
      if (!key) {
        return { valid: false, message: 'Please enter your OpenRouter API key' };
      }
    } else if (provider === 'claude_ai') {
      // For Claude.ai, we allow continuing without sign-in (they can do it later)
      // But if they haven't signed in yet, we should warn
    }
    
    return { valid: true };
  }

  /**
   * Apply the selected provider to settings
   */
  async function applySelectedProvider() {
    const provider = getSelectedProvider();
    
    // Update settings
    if (typeof settings !== 'undefined') {
      settings.llmProvider = provider;
      
      // Set auth mode based on provider
      if (provider === 'claude_ai') {
        settings.authMode = 'claude_ai';
      } else if (provider === 'anthropic_api') {
        settings.authMode = 'api_key';
        // Save API key
        const apiKey = document.getElementById('llmProviderAnthropicKey').value.trim();
        if (apiKey) {
          settings.apiKey = apiKey;
        }
      } else if (provider === 'openrouter') {
        // Save OpenRouter API key
        const apiKey = document.getElementById('llmProviderOpenRouterKey').value.trim();
        if (apiKey) {
          settings.openrouterApiKey = apiKey;
        }
      }
      
      // Save settings
      if (typeof saveSettings === 'function') {
        await saveSettings();
      }
      
      // Update UI if function exists
      if (typeof applyLlmProviderUI === 'function') {
        applyLlmProviderUI();
      }
    }
    
    return provider;
  }

  /**
   * Start polling for Claude credentials
   */
  function startCredentialsPolling() {
    stopCredentialsPolling();
    
    _credentialsPollInterval = setInterval(async () => {
      try {
        if (window.electronAPI && typeof window.electronAPI.claudeCheckCredentials === 'function') {
          // This check also syncs Keychain credentials to file for SDK compatibility
          const res = await window.electronAPI.claudeCheckCredentials();
          if (res?.source) {
            console.log(`[LlmProviderSelectModal] Credentials found in: ${res.source}`);
          }
          if (res && res.success === true && res.hasCredentials === true) {
            // Credentials found - show success state
            showClaudeSignInSuccess();
            stopCredentialsPolling();
          }
        }
      } catch (err) {
        console.error('[LlmProviderSelectModal] Credentials poll error:', err);
      }
    }, 2000); // Poll every 2 seconds
  }

  /**
   * Stop polling for credentials
   */
  function stopCredentialsPolling() {
    if (_credentialsPollInterval) {
      clearInterval(_credentialsPollInterval);
      _credentialsPollInterval = null;
    }
  }

  /**
   * Show success state for Claude sign-in
   */
  function showClaudeSignInSuccess() {
    _claudeSignedIn = true;
    
    const btn = document.getElementById('llmProviderClaudeSignInBtn');
    const status = document.getElementById('llmProviderClaudeStatus');
    
    if (btn) btn.style.display = 'none';
    if (status) {
      status.style.display = 'flex';
      status.classList.add('success');
      status.innerHTML = `
        <svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span>Signed in successfully</span>
      `;
    }
  }

  /**
   * Handle Claude.ai sign-in button click
   */
  async function handleClaudeSignIn() {
    if (_claudeSignInPending) return;
    
    const btn = document.getElementById('llmProviderClaudeSignInBtn');
    const status = document.getElementById('llmProviderClaudeStatus');
    
    _claudeSignInPending = true;
    btn.style.display = 'none';
    status.style.display = 'flex';
    
    try {
      if (window.electronAPI && typeof window.electronAPI.openClaudeSetupTokenTerminal === 'function') {
        const res = await window.electronAPI.openClaudeSetupTokenTerminal();
        if (!res || res.success !== true) {
          if (typeof customAlert === 'function') {
            await customAlert(`Failed to open Terminal for login.\n\n${res?.error || 'Unknown error'}`, 'Claude Authentication');
          }
          btn.style.display = 'flex';
          status.style.display = 'none';
        } else {
          // Update status text and start polling for credentials
          status.querySelector('span').textContent = 'Complete sign-in in Terminal...';
          startCredentialsPolling();
        }
      }
    } catch (err) {
      console.error('[LlmProviderSelectModal] Claude sign-in error:', err);
      btn.style.display = 'flex';
      status.style.display = 'none';
    } finally {
      _claudeSignInPending = false;
    }
  }

  /**
   * Handle continue button click
   */
  async function handleContinue() {
    const validation = validateSelection();
    if (!validation.valid) {
      if (typeof customAlert === 'function') {
        await customAlert(validation.message, 'Missing Information');
      } else {
        alert(validation.message);
      }
      return;
    }
    
    await applySelectedProvider();
    hide();
    
    if (_onComplete) {
      _onComplete(getSelectedProvider());
    }
  }

  /**
   * Setup event listeners
   */
  function setupEventListeners() {
    // Continue button
    document.getElementById('llmProviderContinueBtn').addEventListener('click', handleContinue);
    
    // Claude.ai sign-in button
    document.getElementById('llmProviderClaudeSignInBtn').addEventListener('click', handleClaudeSignIn);

    // Radio button changes - show/hide action panels
    const radios = _modal.querySelectorAll('input[name="llmProviderSelect"]');
    radios.forEach(radio => {
      radio.addEventListener('change', updateActionVisibility);
    });

    // Also handle clicks on option containers (better UX)
    _modal.querySelectorAll('.llm-provider-option').forEach(option => {
      option.addEventListener('click', (e) => {
        // Don't trigger if clicking on input, button, or link
        if (e.target.closest('input') || e.target.closest('button') || e.target.closest('a')) {
          return;
        }
        const radio = option.querySelector('input[type="radio"]');
        if (radio && !radio.checked) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change'));
        }
      });
    });

    // Note: No escape key or click-outside-to-close — user must make a selection
  }

  /**
   * Check if Claude credentials already exist
   */
  async function checkExistingClaudeCredentials() {
    try {
      if (window.electronAPI && typeof window.electronAPI.claudeCheckCredentials === 'function') {
        const res = await window.electronAPI.claudeCheckCredentials();
        if (res && res.success === true && res.hasCredentials === true) {
          showClaudeSignInSuccess();
          return true;
        }
      }
    } catch (err) {
      console.error('[LlmProviderSelectModal] Error checking credentials:', err);
    }
    return false;
  }

  /**
   * Pre-fill current settings if available
   */
  async function prefillCurrentSettings() {
    if (typeof settings !== 'undefined') {
      // Set provider radio
      if (settings.llmProvider) {
        const radio = _modal.querySelector(`input[value="${settings.llmProvider}"]`);
        if (radio) {
          radio.checked = true;
        }
      }
      
      // Pre-fill API keys if available
      if (settings.apiKey) {
        document.getElementById('llmProviderAnthropicKey').value = settings.apiKey;
      }
      if (settings.openrouterApiKey) {
        document.getElementById('llmProviderOpenRouterKey').value = settings.openrouterApiKey;
      }
    }
    
    updateActionVisibility();
    
    // Check if already signed in with Claude
    await checkExistingClaudeCredentials();
  }

  /**
   * Reset modal state
   */
  function resetState() {
    _claudeSignInPending = false;
    _claudeSignedIn = false;
    stopCredentialsPolling();
    
    const btn = document.getElementById('llmProviderClaudeSignInBtn');
    const status = document.getElementById('llmProviderClaudeStatus');
    
    if (btn) btn.style.display = 'flex';
    if (status) {
      status.style.display = 'none';
      status.classList.remove('success');
      status.innerHTML = `
        <svg class="spinner" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="60 30"></circle>
        </svg>
        <span>Waiting for sign-in...</span>
      `;
    }
  }

  /**
   * Show the modal
   */
  function show(onComplete) {
    if (!_isInitialized) {
      init();
    }

    _onComplete = onComplete || null;
    resetState();
    prefillCurrentSettings();
    _modal.style.display = 'flex';
  }

  /**
   * Hide the modal
   */
  function hide() {
    stopCredentialsPolling();
    if (_modal) {
      _modal.style.display = 'none';
    }
  }

  /**
   * Initialize the UI
   */
  function init() {
    if (_isInitialized) return;

    _modal = createModal();
    setupEventListeners();
    _isInitialized = true;

    console.log('[LlmProviderSelectModal] Initialized');
  }

  return {
    init,
    show,
    hide
  };
})();
