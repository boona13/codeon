// VERIFICATION PANEL RUNTIME
(function () {
  'use strict';

  if (window._verificationPanelRuntimeInit) return;
  window._verificationPanelRuntimeInit = true;

  let _lastSessionId = null;

  function checkSessionChange() {
    const sid = String(window.currentSessionId || '').trim();
    if (sid !== _lastSessionId) {
      _lastSessionId = sid;
      const panel = document.getElementById('verificationManagerPanel');
      if (panel && panel.style.display !== 'none') {
        try { window.renderVerificationPanel?.(); } catch { /* ignore */ }
      }
    }
  }

  setInterval(checkSessionChange, 500);

  let _updateDebounce = null;
  window._onProofedEditsStateUpdate = function () {
    if (_updateDebounce) return;
    _updateDebounce = setTimeout(() => {
      _updateDebounce = null;
      const panel = document.getElementById('verificationManagerPanel');
      if (panel && panel.style.display !== 'none') {
        try { window.renderVerificationPanel?.(); } catch { /* ignore */ }
      }
    }, 120);
  };
})();
