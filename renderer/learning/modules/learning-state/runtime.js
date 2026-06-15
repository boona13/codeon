// ============================================================================
// LEARNING STATE RUNTIME
// Event handlers and integration hooks
// ============================================================================

(function () {
  'use strict';

  if (window._learningStateRuntimeInit) return;
  window._learningStateRuntimeInit = true;

  // Hook: When a run completes, check if learning is enabled and queue generation
  // This will be called from chat-status-banner or stream completion handlers

  /**
   * Called when an AI run completes. If learning mode is enabled AND
   * the run warrants learning generation (smart analysis), creates a
   * pending entry for explanation generation.
   */
  function onRunCompleted({ sessionId, runRequestId, originalPrompt, toolsUsed, filesModified, durationMs }) {
    if (!window._learningState) return;
    
    const sid = String(sessionId || window.currentSessionId || '').trim();
    if (window.appSettings && window.appSettings.permissionMode === 'plan') return;
    // Check if learning is enabled for this specific session
    if (!window._learningState.isLearningEnabled(sid)) return;
    const rid = String(runRequestId || '').trim();
    if (!sid || !rid) return;

    // === SMART ANALYSIS: Only generate learning for meaningful runs ===
    // Skip simple greetings, pure questions, and non-coding conversations
    if (window._runNeedsAnalysis && typeof window._runNeedsAnalysis.analyzeRun === 'function') {
      const analysis = window._runNeedsAnalysis.analyzeRun({
        originalPrompt,
        toolsUsed: toolsUsed || [],
        filesModified: filesModified || []
      });
      
      if (!analysis.needsLearning) {
        // Log skip reason for debugging (can be removed in production)
        console.debug('[Learning] Skipped:', analysis.reason, analysis.details);
        return;
      }
      console.debug('[Learning] Triggered:', analysis.reason, analysis.confidence);
    }

    // Create the entry
    window._learningState.createEntry({
      sessionId: sid,
      runRequestId: rid,
      originalPrompt: originalPrompt || '',
      metadata: {
        toolsUsed: toolsUsed || [],
        filesModified: filesModified || [],
        durationMs: durationMs || 0
      }
    });

    // Trigger UI refresh if panel is visible
    try {
      if (typeof window.renderLearningPanel === 'function') {
        window.renderLearningPanel();
      }
    } catch { /* ignore */ }

    // Auto-generate explanation (deferred to avoid blocking)
    setTimeout(() => {
      try {
        if (typeof window._generateLearningExplanation === 'function') {
          window._generateLearningExplanation({ sessionId: sid, runRequestId: rid });
        }
      } catch { /* ignore */ }
    }, 100);
  }

  // Expose the hook
  window._onLearningRunCompleted = onRunCompleted;
})();
