// ============================================================================
// DOCS GENERATOR RUNTIME
// Hooks for triggering documentation generation
// ============================================================================

(function () {
  'use strict';

  if (window._docsGeneratorRuntimeInit) return;
  window._docsGeneratorRuntimeInit = true;

  window.generateDocsForRun = async function (projectId, sessionId, runRequestId) {
    if (!window._docsGenerator) {
      console.warn('[Docs] Generator module not available');
      return;
    }
    await window._docsGenerator.generate({ projectId, sessionId, runRequestId });
  };

  window.generatePendingDocs = async function () {
    const ds = window._docsState;
    if (!ds) return;

    const pid = ds.getProjectId ? ds.getProjectId() : '';
    if (!pid) return;

    const entries = ds.getEntriesForProject(pid);
    const pending = entries.find(e => e.status === 'pending');
    if (pending) {
      await window.generateDocsForRun(pid, pending.sessionId, pending.runRequestId);
    }
  };
})();
