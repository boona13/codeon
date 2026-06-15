// ============================================================================
// LEARNING PANEL RUNTIME
// Real-time updates and session change handling
// ============================================================================

(function () {
  'use strict';

  if (window._learningPanelRuntimeInit) return;
  window._learningPanelRuntimeInit = true;

  // Re-render when session changes
  let _lastSessionId = null;

  function checkSessionChange() {
    const sid = String(window.currentSessionId || '').trim();
    if (sid !== _lastSessionId) {
      _lastSessionId = sid;
      // Reset view to list when switching sessions
      if (window._learningState) {
        window._learningState.setView('list');
      }
      // Re-render if panel is visible
      const panel = document.getElementById('learningManagerPanel');
      if (panel && panel.style.display !== 'none') {
        try { window.renderLearningPanel?.(); } catch { /* ignore */ }
      }
    }
  }

  // Poll for session changes (lightweight)
  setInterval(checkSessionChange, 500);

  // Hook into learning state changes for live updates during generation
  let _updateDebounce = null;
  window._onLearningStateUpdate = function () {
    if (_updateDebounce) return;
    _updateDebounce = setTimeout(() => {
      _updateDebounce = null;
      const panel = document.getElementById('learningManagerPanel');
      if (panel && panel.style.display !== 'none') {
        try { window.renderLearningPanel?.(); } catch { /* ignore */ }
      }
    }, 100);
  };
})();
