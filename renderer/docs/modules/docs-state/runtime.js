// ============================================================================
// DOCS STATE RUNTIME
// Event handlers and integration hooks
// ============================================================================

(function () {
  'use strict';

  if (window._docsStateRuntimeInit) return;
  window._docsStateRuntimeInit = true;

  function isDocumentationModeEnabled(sessionId) {
    try {
      const s = window.appSettings || {};
      if (s.permissionMode === 'plan') return false;
      const ds = window._docsState;
      if (ds && typeof ds.isDocsEnabled === 'function') {
        return ds.isDocsEnabled(sessionId);
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Called when an AI run completes. If documentation mode is enabled AND
   * the run warrants documentation generation (smart analysis), creates a
   * pending entry for documentation generation.
   */
  function onRunCompleted({ sessionId, runRequestId, originalPrompt, toolsUsed, filesModified, durationMs }) {
    if (!window._docsState) return;
    if (!isDocumentationModeEnabled(sessionId)) return;

    const pid = window._docsState.getProjectId ? window._docsState.getProjectId() : '';
    const sid = String(sessionId || window.currentSessionId || '').trim();
    const rid = String(runRequestId || '').trim();
    if (!pid || !rid) return;

    const files = Array.isArray(filesModified) ? filesModified : [];

    // === SMART ANALYSIS: Only generate docs for meaningful runs ===
    // Docs are primarily useful when files are actually modified
    if (window._runNeedsAnalysis && typeof window._runNeedsAnalysis.analyzeRun === 'function') {
      const analysis = window._runNeedsAnalysis.analyzeRun({
        originalPrompt,
        toolsUsed: Array.isArray(toolsUsed) ? toolsUsed : [],
        filesModified: files
      });
      
      if (!analysis.needsDocs) {
        // Log skip reason for debugging (can be removed in production)
        console.debug('[Docs] Skipped:', analysis.reason, analysis.details);
        return;
      }
      console.debug('[Docs] Triggered:', analysis.reason, analysis.confidence);
    }

    window._docsState.createEntry({
      projectId: pid,
      sessionId: sid,
      runRequestId: rid,
      originalPrompt: originalPrompt || '',
      metadata: {
        toolsUsed: Array.isArray(toolsUsed) ? toolsUsed : [],
        filesModified: files,
        durationMs: durationMs || 0
      }
    });

    // Trigger UI refresh if panel is visible
    try {
      if (typeof window.renderDocsPanel === 'function') {
        window.renderDocsPanel();
      }
    } catch { /* ignore */ }

    // Auto-generate documentation update (deferred to avoid blocking)
    setTimeout(() => {
      try {
        if (typeof window._generateDocumentationUpdate === 'function') {
          window._generateDocumentationUpdate({ projectId: pid, sessionId: sid, runRequestId: rid });
        }
      } catch { /* ignore */ }
    }, 120);
  }

  window._onDocumentationRunCompleted = onRunCompleted;
})();
