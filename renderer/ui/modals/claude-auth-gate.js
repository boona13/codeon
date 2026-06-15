// ============================================================================
// CLAUDE AUTH GATE (Project open / first-run UX)
// ============================================================================
const claudeAuthGateState = {
  inFlight: false,
  lastCheckAt: 0,
  lastResult: null,
  shownForProject: ''
};

function isClaudeAiAuthMode() {
  try {
    normalizeClaudeAuthMode();
    return settings && settings.authMode === 'claude_ai';
  } catch {
    return true;
  }
}

function accountLooksLoggedIn(account) {
  if (!account || typeof account !== 'object') return false;
  const email = typeof account.email === 'string' ? account.email.trim() : '';
  const sub = typeof account.subscriptionType === 'string' ? account.subscriptionType.trim() : '';
  const tokenSource = typeof account.tokenSource === 'string' ? account.tokenSource.trim() : '';
  return Boolean(email || sub || tokenSource);
}

function setAuthGateUi({ statusText = '', subtitleText = '' } = {}) {
  try {
    const statusEl = document.getElementById('authGateStatus');
    if (statusEl) statusEl.textContent = statusText || '';
  } catch { /* ignore */ }
  try {
    const subtitleEl = document.getElementById('authGateSubtitle');
    if (subtitleEl) subtitleEl.textContent = subtitleText || '';
  } catch { /* ignore */ }
}

function openAuthGateModal({ statusText = 'Not signed in', subtitleText = '' } = {}) {
  const modal = document.getElementById('authGateModal');
  if (!modal) return;
  setAuthGateUi({ statusText, subtitleText });
  modal.style.display = 'flex';
  try { startAuthGateLoginWatch(); } catch { /* ignore */ }
}

function closeAuthGateModal() {
  const modal = document.getElementById('authGateModal');
  if (!modal) return;
  modal.style.display = 'none';
  try { stopAuthGateLoginWatch(); } catch { /* ignore */ }
}

let authGatePollTimer = null;
let authGatePollLastShownAt = 0;

function isAuthGateModalOpen() {
  const modal = document.getElementById('authGateModal');
  return !!(modal && modal.style && modal.style.display === 'flex');
}

function stopAuthGateLoginWatch() {
  try { if (authGatePollTimer) clearInterval(authGatePollTimer); } catch { /* ignore */ }
  authGatePollTimer = null;
}

function startAuthGateLoginWatch() {
  // Poll login status while the modal is open and auto-dismiss once signed in.
  if (authGatePollTimer) return;
  authGatePollLastShownAt = Date.now();

  const tick = async () => {
    try {
      if (!isAuthGateModalOpen()) {
        stopAuthGateLoginWatch();
        return;
      }

      // Safety: don't poll forever (avoid background churn if something gets stuck).
      if (Date.now() - authGatePollLastShownAt > 5 * 60 * 1000) {
        stopAuthGateLoginWatch();
        return;
      }

      // First check if credentials exist (Keychain on macOS, file on Linux/Windows)
      // The check also syncs Keychain credentials to file for SDK compatibility
      if (window.electronAPI && typeof window.electronAPI.claudeCheckCredentials === 'function') {
        const credRes = await window.electronAPI.claudeCheckCredentials();
        // Log credential source for debugging
        if (credRes?.source) {
          console.log(`[Auth Gate] Credentials found in: ${credRes.source}`);
        }
        if (credRes && credRes.success === true && credRes.hasCredentials === true) {
          // Credentials file has a token - verify it's actually valid by checking account info
          const res = await checkClaudeLoginStatusBestEffort({ projectOpen: false });
          if (res && res.status === 'logged_in') {
            try { applyClaudeAuthSettingsUI({ refreshStatus: true }); } catch { /* ignore */ }
            setAuthGateUi({ statusText: 'Signed in ✓' });
            try {
              if (window.electronAPI && typeof window.electronAPI.focusMainWindow === 'function') {
                window.electronAPI.focusMainWindow().catch(() => {});
              }
            } catch { /* ignore */ }
            setTimeout(() => {
              try { closeAuthGateModal(); } catch { /* ignore */ }
            }, 350);
            return;
          }
        }
      }

      // Don't update UI status during polling - keep showing "Waiting for sign-in..."
      // Only update when we detect success or a definite error
    } catch {
      // ignore
    }
  };

  // Start polling after a short delay to let the Terminal open first
  setTimeout(() => {
    tick().catch(() => {});
    authGatePollTimer = setInterval(() => {
      tick().catch(() => {});
    }, 2000);
  }, 3000);
}

function shouldSuppressClaudeTechnicalErrors() {
  // If the user is using Claude.ai auth but is not logged in yet, don't spam console with low-level errors.
  // We'll show the auth gate instead.
  if (!isClaudeAiAuthMode()) return false;
  if (claudeAuthGateState.lastResult && claudeAuthGateState.lastResult.status === 'logged_in') return false;
  return true;
}

function isAuthOrRuntimeSetupError(errText) {
  const t = String(errText || '').toLowerCase();
  return (
    t.includes('spawn node enoent') ||
    t.includes('failed to spawn') ||
    t.includes('reply was never sent') ||
    t.includes('claude code cli') ||
    t.includes('not found') && t.includes('claude') ||
    t.includes('install it from code.claude.com')
  );
}

async function checkClaudeLoginStatusBestEffort({ projectOpen = false } = {}) {
  // Best-effort: checks Claude.ai login state. Returns quickly and never throws.
  normalizeClaudeAuthMode();
  if (!isClaudeAiAuthMode()) {
    return { status: 'api_key_mode' };
  }
  if (!window.electronAPI || typeof window.electronAPI.claudeSdkAccountInfo !== 'function') {
    return { status: 'unavailable', message: 'Login status unavailable' };
  }

  // Light debounce: avoid running this repeatedly during folder open animations.
  const now = Date.now();
  if (!projectOpen && (now - claudeAuthGateState.lastCheckAt) < 4000 && claudeAuthGateState.lastResult) {
    return claudeAuthGateState.lastResult;
  }
  if (claudeAuthGateState.inFlight) {
    return claudeAuthGateState.lastResult || { status: 'checking' };
  }

  claudeAuthGateState.inFlight = true;
  claudeAuthGateState.lastCheckAt = now;
  try {
    const res = await window.electronAPI.claudeSdkAccountInfo({ apiKey: '', authMode: 'claude_ai' });
    if (res && res.success === true) {
      if (accountLooksLoggedIn(res.account)) {
        const out = { status: 'logged_in', account: res.account || null };
        claudeAuthGateState.lastResult = out;
        return out;
      }
      const out = { status: 'not_logged_in' };
      claudeAuthGateState.lastResult = out;
      return out;
    }
    const msg = String(res?.error || 'Login check failed');
    const out = { status: 'error', message: msg };
    claudeAuthGateState.lastResult = out;
    return out;
  } catch (e) {
    const out = { status: 'error', message: e?.message || String(e) };
    claudeAuthGateState.lastResult = out;
    return out;
  } finally {
    claudeAuthGateState.inFlight = false;
  }
}

async function maybePromptClaudeLoginOnProjectOpen() {
  try {
    if (!currentFolder) return;
    if (!isClaudeAiAuthMode()) return;

    const proj = String(currentFolder || '').trim();
    if (proj && claudeAuthGateState.shownForProject === proj) return;

    // Check in the background; only show a modal if we need user action.
    const res = await checkClaudeLoginStatusBestEffort({ projectOpen: true });
    if (res.status === 'logged_in') return;

    claudeAuthGateState.shownForProject = proj;

    // Friendly UX copy
    if (res.status === 'not_logged_in') {
      openAuthGateModal({
        statusText: 'Not signed in',
        subtitleText: 'To use Codeon’s AI assistant, sign in once with your Claude.ai subscription.'
      });
      return;
    }
    if (res.status === 'error') {
      openAuthGateModal({
        statusText: `Login check failed: ${res.message || 'Unknown error'}`,
        subtitleText: 'Click “Sign in with Claude.ai” to set up login, then come back and try again.'
      });
      return;
    }
    openAuthGateModal({
      statusText: 'Login required',
      subtitleText: 'Click “Sign in with Claude.ai” to set up login, then come back and try again.'
    });
  } catch {
    // ignore
  }
}

