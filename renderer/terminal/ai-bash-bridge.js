// AI Bash → Terminal bridge
// Mirrors Claude SDK Bash tool executions into a per-chat "AI Bash" terminal tab (log-only).
// Does NOT execute commands (avoids breaking the Claude Code loop / double execution).

(function () {
  'use strict';

  function safeText(s) {
    return String(s == null ? '' : s);
  }

  function oneLine(s) {
    return safeText(s).replace(/\s+/g, ' ').trim();
  }

  function extractCommand(evt) {
    try {
      const sum = evt && evt.toolInputSummary && typeof evt.toolInputSummary === 'object' ? evt.toolInputSummary : null;
      const cmd = sum && typeof sum.command === 'string' ? sum.command : '';
      if (cmd && cmd.trim()) return cmd.trim();
    } catch { /* ignore */ }

    // Fallback: preview is often `: <command>`
    const p = safeText(evt && evt.preview);
    const trimmed = p.replace(/^\s*:\s*/, '').trim();
    return trimmed;
  }

  function formatBlock({ cmd, cwd, exitCode, output, toolUseId }) {
    const lines = [];
    lines.push('');
    lines.push(`\x1b[1m$ ${cmd}\x1b[0m`);
    if (cwd) lines.push(`\x1b[2m(cwd: ${cwd})\x1b[0m`);
    if (toolUseId) lines.push(`\x1b[2m(tool: ${toolUseId})\x1b[0m`);
    if (output) lines.push(output);
    if (typeof exitCode === 'number') {
      const ok = exitCode === 0;
      lines.push(ok ? `\x1b[32m(exit ${exitCode})\x1b[0m` : `\x1b[31m(exit ${exitCode})\x1b[0m`);
    }
    lines.push('');
    return lines.join('\n');
  }

  function handleToolExecuted(evt, chatSessionId) {
    try {
      if (!evt) return;
      const panel = window.codeonTerminalPanel;
      if (!panel || typeof panel.ensureAiBashSession !== 'function' || typeof panel.appendToSession !== 'function') return;

      const sid = safeText(chatSessionId).trim();
      if (!sid) return;

      const receipt = evt && typeof evt.receipt === 'object' ? evt.receipt : null;
      const cwd = receipt && typeof receipt.cwd === 'string' ? receipt.cwd : '';
      const exitCode = receipt && typeof receipt.exitCode === 'number' ? receipt.exitCode : null;
      const toolUseId = typeof evt.toolUseId === 'string' ? evt.toolUseId : '';

      const output = safeText(evt.toolOutput || '').trim();
      const key = panel.ensureAiBashSession(sid, { reveal: true });
      if (!key) return;

      if (evt.toolName === 'Bash') {
        const cmd = extractCommand(evt);
        if (!cmd) return;
        const taskId = safeText(evt.taskId || '').trim();
        const sum = evt.toolInputSummary && typeof evt.toolInputSummary === 'object' ? evt.toolInputSummary : null;
        const runInBg = !!(sum && sum.runInBackground === true);
        const bgNote = (!output && (runInBg || taskId))
          ? `\n\x1b[2m(background task${taskId ? `: ${taskId}` : ''} — output will appear when TaskOutput runs)\x1b[0m`
          : '';

        const block = formatBlock({
          cmd,
          cwd: cwd ? oneLine(cwd) : '',
          exitCode: typeof exitCode === 'number' ? exitCode : null,
          output: output ? output + bgNote : (bgNote ? bgNote.trimStart() : ''),
          toolUseId: toolUseId ? oneLine(toolUseId) : ''
        });
        panel.appendToSession(key, block);
        return;
      }

      // If the model ran `TaskOutput` (often to fetch background Bash output), mirror it here too.
      if (evt.toolName === 'TaskOutput') {
        const sum = evt.toolInputSummary && typeof evt.toolInputSummary === 'object' ? evt.toolInputSummary : null;
        const taskId = sum && typeof sum.taskId === 'string' ? sum.taskId : safeText(evt.preview || '').replace(/^\s*:\s*/, '').trim();
        const header = `\n\x1b[1m[TaskOutput]\x1b[0m ${taskId ? oneLine(taskId) : ''}\n`;
        const body = output ? output : '\x1b[2m(no output)\x1b[0m';
        panel.appendToSession(key, header + body + '\n');
      }
    } catch {
      // ignore
    }
  }

  window.codeonAiBashBridge = { handleToolExecuted };
})();


