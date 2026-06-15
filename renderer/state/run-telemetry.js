// ============================================================================
// RUN TELEMETRY (Claude Code) — lightweight, UI-focused instrumentation
// - Captures: subagent lifecycle (SubagentStart/Stop hooks), invoked skills (Skill tool)
// - Stores per (sessionId, requestId) so chat + AET can surface clean UX
// ============================================================================
(function () {
  if (window.codeonRunTelemetry) return;

  const MAX_RUNS_PER_SESSION = 12;

  /** sid -> requestId -> run */
  const runsBySession = Object.create(null);

  const _now = () => Date.now();
  const _trim = (s) => (typeof s === 'string' ? s.trim() : '');

  const _ensureSession = (sid) => {
    const key = _trim(sid);
    if (!key) return null;
    if (!runsBySession[key]) runsBySession[key] = Object.create(null);
    return runsBySession[key];
  };

  const _ensureRun = (sid, requestId) => {
    const s = _ensureSession(sid);
    const rid = _trim(requestId);
    if (!s || !rid) return null;
    if (!s[rid]) {
      s[rid] = {
        requestId: rid,
        sessionId: _trim(sid),
        startedAt: _now(),
        lastUpdatedAt: _now(),
        subagents: {
          active: null, // { agentType, agentId, startedAt }
          usedTypes: new Set(), // agentType
          events: [] // [{ kind: 'start'|'stop', agentType, agentId, at }]
        },
        skills: {
          invoked: new Map(), // skillName -> count
          events: [] // [{ name, at }]
        }
      };
      // Bound memory per session
      try {
        const ids = Object.keys(s);
        if (ids.length > MAX_RUNS_PER_SESSION) {
          ids.sort((a, b) => Number(s[a]?.startedAt || 0) - Number(s[b]?.startedAt || 0));
          const toDelete = ids.slice(0, Math.max(0, ids.length - MAX_RUNS_PER_SESSION));
          for (const k of toDelete) delete s[k];
        }
      } catch { /* ignore */ }
    }
    return s[rid];
  };

  const _parseSkillNameFromTool = (evt) => {
    // We accept best-effort signals, because SDK schema can vary.
    try {
      const toolName = _trim(evt?.toolName);
      if (!toolName || toolName !== 'Skill') return '';
      const summary = evt && typeof evt.toolInputSummary === 'object' && evt.toolInputSummary ? evt.toolInputSummary : null;
      const candidates = [];
      const push = (v) => {
        const s = _trim(v);
        if (s) candidates.push(s);
      };
      if (summary) {
        // Primary: SDK uses 'skill' parameter and we extract to 'commandName'
        push(summary.commandName);
        push(summary.skill);
        push(summary.command_name);
        push(summary.skillName);
        push(summary.skill_name);
        push(summary.name);
        // Extract from skillPath if available
        const skillPath = _trim(summary.skillPath || summary.skill_path || summary.path);
        if (skillPath) {
          const parts = skillPath.split('/').filter(Boolean);
          const skillsIdx = parts.indexOf('skills');
          if (skillsIdx >= 0 && skillsIdx < parts.length - 1) {
            push(parts[skillsIdx + 1]);
          } else if (parts.length > 0) {
            push(parts[parts.length - 1]);
          }
        }
      }
      // Fallback: parse from preview like ": /commit ..." or ": /frontend-design ..."
      const preview = _trim(evt?.preview);
      if (preview) {
        const m = preview.match(/:\s*\/?([a-z0-9][a-z0-9_:-]{0,63})\b/i);
        if (m && m[1]) push(m[1]);
      }
      return candidates.length ? candidates[0] : '';
    } catch {
      return '';
    }
  };

  const startRun = ({ sessionId, requestId } = {}) => {
    return _ensureRun(sessionId, requestId);
  };

  const recordSdkHook = ({ sessionId, requestId, evt } = {}) => {
    const run = _ensureRun(sessionId, requestId);
    if (!run) return;
    try { run.lastUpdatedAt = _now(); } catch { /* ignore */ }

    const hook = _trim(evt?.hookEventName);
    if (!hook) return;
    if (hook !== 'SubagentStart' && hook !== 'SubagentStop') return;

    const agentType = _trim(evt?.agentType);
    const agentId = _trim(evt?.agentId);
    const at = _now();

    if (hook === 'SubagentStart') {
      run.subagents.active = { agentType: agentType || null, agentId: agentId || null, startedAt: at };
      if (agentType) run.subagents.usedTypes.add(agentType);
      run.subagents.events.push({ kind: 'start', agentType: agentType || null, agentId: agentId || null, at });
    } else {
      run.subagents.events.push({ kind: 'stop', agentType: agentType || null, agentId: agentId || null, at });
      run.subagents.active = null;
    }
    if (run.subagents.events.length > 80) run.subagents.events = run.subagents.events.slice(-80);
  };

  const recordToolExecuted = ({ sessionId, requestId, evt } = {}) => {
    const run = _ensureRun(sessionId, requestId);
    if (!run) return;
    try { run.lastUpdatedAt = _now(); } catch { /* ignore */ }

    const toolName = _trim(evt?.toolName);
    if (toolName === 'Skill') {
      const name = _parseSkillNameFromTool(evt);
      if (name) {
        const prev = Number(run.skills.invoked.get(name) || 0) || 0;
        run.skills.invoked.set(name, prev + 1);
        run.skills.events.push({ name, at: _now() });
        if (run.skills.events.length > 120) run.skills.events = run.skills.events.slice(-120);
      }
    }
  };

  const getSummary = ({ sessionId, requestId } = {}) => {
    const run = _ensureRun(sessionId, requestId);
    if (!run) return null;
    try {
      const subagentTypes = Array.from(run.subagents.usedTypes.values()).filter(Boolean);
      const skills = Array.from(run.skills.invoked.entries())
        .map(([name, count]) => ({ name, count: Number(count || 0) || 0 }))
        .sort((a, b) => (b.count - a.count) || String(a.name).localeCompare(String(b.name)));
      return {
        sessionId: run.sessionId,
        requestId: run.requestId,
        subagentTypes,
        activeSubagent: run.subagents.active ? { ...run.subagents.active } : null,
        skills,
        updatedAt: run.lastUpdatedAt
      };
    } catch {
      return null;
    }
  };

  const clearRun = ({ sessionId, requestId } = {}) => {
    const sid = _trim(sessionId);
    const rid = _trim(requestId);
    if (!sid || !rid) return;
    try {
      const s = runsBySession[sid];
      if (s && s[rid]) delete s[rid];
    } catch { /* ignore */ }
  };

  window.codeonRunTelemetry = {
    startRun,
    recordSdkHook,
    recordToolExecuted,
    getSummary,
    clearRun
  };
})();

