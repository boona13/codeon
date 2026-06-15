// ============================================================================
// DOCS PANEL RUNTIME
// Real-time updates and project change handling
// ============================================================================

(function () {
  'use strict';

  if (window._docsPanelRuntimeInit) return;
  window._docsPanelRuntimeInit = true;

  let _lastProjectId = null;

  function checkProjectChange() {
    const pid = String(window.currentFolder || '').trim();
    if (pid !== _lastProjectId) {
      _lastProjectId = pid;
      if (window._docsState) {
        window._docsState.setView('list');
        try { window._docsState.resetDocsEnabled?.(); } catch { /* ignore */ }
        try { window._docsState.reloadFromWorkspace?.({ clearIfMissing: true }); } catch { /* ignore */ }
      }
      const panel = document.getElementById('docsManagerPanel');
      if (panel && panel.style.display !== 'none') {
        try { window.renderDocsPanel?.(); } catch { /* ignore */ }
      }
    }
  }

  setInterval(checkProjectChange, 700);

  let _updateDebounce = null;
  window._onDocsStateUpdate = function () {
    if (_updateDebounce) return;
    _updateDebounce = setTimeout(() => {
      _updateDebounce = null;
      const panel = document.getElementById('docsManagerPanel');
      if (panel && panel.style.display !== 'none') {
        try { window.renderDocsPanel?.(); } catch { /* ignore */ }
      }
    }, 120);
  };
})();
