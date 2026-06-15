(function () {
  // Cursor-style idea: treat error UI as a rendering of structured error metadata,
  // not a raw string. This module builds a diagnostics payload we can safely copy/share.

  function _nowIso() {
    try { return new Date().toISOString(); } catch { return String(Date.now()); }
  }

  function _safeTrunc(s, max) {
    const str = String(s ?? '');
    const m = Number.isFinite(Number(max)) && Number(max) > 0 ? Number(max) : 2000;
    if (str.length <= m) return str;
    return str.slice(0, m) + `… (+${str.length - m} chars)`;
  }

  function _safeJson(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return JSON.stringify({ error: 'Failed to serialize diagnostics payload', message: String(e?.message || e) }, null, 2);
    }
  }

  function buildClaudeDiagnosticsPayload({
    sessionId = null,
    requestId = null,
    kind = '',
    failureLabel = '',
    errorText = '',
    permissionDenials = null,
    // settings snapshot (pass from renderer; do NOT read localStorage here)
    settings = null,
    // workspace path (renderer uses currentFolder)
    workspaceRoot = null
  } = {}) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const allowlist = Array.isArray(s.networkAllowlist) ? s.networkAllowlist : [];
    const denials = Array.isArray(permissionDenials) ? permissionDenials : [];

    return {
      schema: 'codeon.claude_diagnostics.v1',
      timestamp: _nowIso(),
      sessionId: sessionId ? String(sessionId) : null,
      requestId: requestId ? String(requestId) : null,
      kind: kind ? String(kind) : '',
      failureLabel: failureLabel ? String(failureLabel) : '',
      workspaceRoot: workspaceRoot ? String(workspaceRoot) : null,
      settings: {
        authMode: typeof s.authMode === 'string' ? s.authMode : null,
        model: typeof s.claudeModel === 'string' ? s.claudeModel : null,
        permissionMode: typeof s.permissionMode === 'string' ? s.permissionMode : null,
        networkPolicyMode: typeof s.networkPolicyMode === 'string' ? s.networkPolicyMode : null,
        networkAllowlistCount: allowlist.length,
        maxBudgetUsd: (typeof s.maxBudgetUsd !== 'undefined' ? s.maxBudgetUsd : null)
      },
      permissionDenials: denials.slice(0, 50).map(d => ({
        toolName: d?.tool_name ?? null,
        toolUseId: d?.tool_use_id ?? null
      })),
      error: {
        firstLine: _safeTrunc(String(errorText || '').split('\n')[0] || '', 400),
        full: _safeTrunc(errorText, 8000)
      }
    };
  }

  window.codeonClaudeDiagnostics = {
    buildClaudeDiagnosticsPayload,
    formatForClipboard(payload) {
      return _safeJson(payload);
    }
  };
})();


