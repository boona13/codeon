// ---- GENERATED: runtime statements extracted from aet/aet-session-ui.js ----
const executionTimelineRunsBySession = {};
 // sid -> ExecutionRun[]
const executionTimelineActiveRunBySession = {};
 // sid -> runId
const executionTimelineSessionByRunId = {};
 // runId -> sid
const executionTimelineViewModeBySession = {};
 // sid -> 'feed' | 'graph'
const executionTimelineFiltersBySession = {};
 // sid -> { q, qScope, type, risk }
const executionTimelinePanelPrefsBySession = {};
 // sid -> { filtersOpen }
const executionTimelineGraphViewportByRunId = {};
 // runId -> { scale, tx, ty } (in-memory only)
const executionTimelineGraphNodeLayoutByRunId = {};
 // runId -> { [nodeId]: { x, y, w } } (in-memory only)
const executionTimelineSelectedNodeByRunId = {};
 // runId -> nodeId (in-memory only)
let executionTimelineIsOpen = false;

let executionTimelineEditorOpen = false;

let executionTimelineEditorRestore = null;


// Stream AET events (main -> renderer)
if (window.electronAPI && typeof window.electronAPI.onExecutionTimelineEvent === 'function') {
  window.electronAPI.onExecutionTimelineEvent((evt) => {
    try {
      const kind = String(evt && evt.kind || '').trim();
      if (!kind) return;

      if (kind === 'run_created') {
        const sid = String(evt.sessionId || '').trim();
        const run = evt.run && typeof evt.run === 'object' ? evt.run : null;
        if (!sid || !run || !run.id) return;
        if (!Array.isArray(executionTimelineRunsBySession[sid])) executionTimelineRunsBySession[sid] = [];
        executionTimelineRunsBySession[sid].push(run);
        executionTimelineSessionByRunId[String(run.id)] = sid;
        // Do NOT auto-switch the active run when this is a retry/resume (child) run.
        // This keeps the graph stable instead of jumping to a new run view.
        const isChild = !!(run.parentRunId || run.parentNodeId);
        // Exception: when the user is in Mindmap mode, prefer following the newest run so the map resets
        // and we don't appear "stuck" on the previous run.
        let preferLatest = false;
        try { preferLatest = (typeof _getAetViewMode === 'function') ? (_getAetViewMode(sid) === 'map') : false; } catch { preferLatest = false; }
        if (!executionTimelineActiveRunBySession[sid] || !isChild || preferLatest) {
          executionTimelineActiveRunBySession[sid] = String(run.id);
          try { scheduleUIMetadataSave(500); } catch { /* ignore */ }
        } else {
          try { showToast('New retry/resume run started. Select it in the Run dropdown to view.', 3000); } catch { /* ignore */ }
        }
        if (!executionTimelineViewModeBySession[sid]) executionTimelineViewModeBySession[sid] = 'feed';
        if ((executionTimelineIsOpen || executionTimelineEditorOpen) && sid === currentSessionId) renderExecutionTimelineForSession(sid);
        return;
      }

      if (kind === 'run_update') {
        const runId = String(evt.runId || '').trim();
        const sid = String(evt.sessionId || executionTimelineSessionByRunId[runId] || '').trim();
        if (!runId || !sid) return;
        const runs = Array.isArray(executionTimelineRunsBySession[sid]) ? executionTimelineRunsBySession[sid] : [];
        const run = runs.find(r => String(r.id || '') === runId);
        const patch = evt.patch && typeof evt.patch === 'object' ? evt.patch : null;
        if (run && patch) Object.assign(run, patch);
        if ((executionTimelineIsOpen || executionTimelineEditorOpen) && sid === currentSessionId) renderExecutionTimelineForSession(sid);
        return;
      }

      if (kind === 'node') {
        const runId = String(evt.runId || '').trim();
        const node = evt.node && typeof evt.node === 'object' ? evt.node : null;
        const sid = String(evt.sessionId || executionTimelineSessionByRunId[runId] || '').trim();
        if (!runId || !node || !sid) return;
        const runs = Array.isArray(executionTimelineRunsBySession[sid]) ? executionTimelineRunsBySession[sid] : [];
        const run = runs.find(r => String(r.id || '') === runId);
        if (run) {
          if (!Array.isArray(run.nodes)) run.nodes = [];
          run.nodes.push(node);
        }
        executionTimelineSessionByRunId[runId] = sid;
        // Do not auto-switch active run on incoming nodes (prevents jumping to child runs).
        if (!executionTimelineActiveRunBySession[sid]) {
          executionTimelineActiveRunBySession[sid] = runId;
          try { scheduleUIMetadataSave(500); } catch { /* ignore */ }
        }
        if ((executionTimelineIsOpen || executionTimelineEditorOpen) && sid === currentSessionId) renderExecutionTimelineForSession(sid);
      }
    } catch (e) {
      console.warn('[AET] Event handler error:', e);
    }
  });
}
