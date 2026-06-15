// ============================================================================
// LEARNING GENERATOR RUNTIME
// Hooks for triggering learning generation
// ============================================================================

(function () {
  'use strict';

  if (window._learningGeneratorRuntimeInit) return;
  window._learningGeneratorRuntimeInit = true;

  // Alias for on-demand generation from UI
  window.generateLearningForRun = async function (sessionId, runRequestId) {
    if (!window._learningGenerator) {
      console.warn('[Learning] Generator module not available');
      return;
    }
    await window._learningGenerator.generate({ sessionId, runRequestId });
  };

  // Manual trigger: generate for the most recent pending entry
  window.generatePendingLearning = async function () {
    const ls = window._learningState;
    if (!ls) return;

    const sid = String(window.currentSessionId || '').trim();
    if (!sid) return;

    const entries = ls.getEntriesForSession(sid);
    const pending = entries.find(e => e.status === 'pending');
    
    if (pending) {
      await window.generateLearningForRun(sid, pending.runRequestId);
    }
  };
})();
