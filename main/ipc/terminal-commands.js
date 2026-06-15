// Codeon - IPC: Terminal command execution (non-PTY)
'use strict';

const { exec: _exec } = require('child_process');

function getLogger() {
  try {
    const l = globalThis.__codeonMainLog;
    if (l && typeof l.info === 'function') return l;
  } catch { /* ignore */ }
  return null;
}

function normalizeTimeoutMs(timeoutValue, defaultMs) {
  const t = Number(timeoutValue);
  if (!Number.isFinite(t) || t <= 0) return defaultMs;
  // Back-compat heuristic:
  // - historically callers used `timeout=30000` (ms-like) but code treated it as seconds.
  // - allow callers to pass small integers like 30/60 as seconds.
  if (t > 0 && t < 1000) return Math.floor(t * 1000);
  return Math.floor(t);
}

function registerTerminalCommandIpc({
  ipcMain,
  execAsync,
  exec = _exec,
  path,
  isPathInside,
  getCurrentProject,
  APP_ROOT,
  appDir,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain is required');
  if (typeof execAsync !== 'function') throw new Error('execAsync is required');
  if (typeof exec !== 'function') throw new Error('exec is required');
  if (!path) throw new Error('path is required');
  if (typeof isPathInside !== 'function') throw new Error('isPathInside is required');
  if (typeof getCurrentProject !== 'function') throw new Error('getCurrentProject is required');

  const log = getLogger();

  // Terminal Command Execution (project-root only)
  ipcMain.handle('run-terminal-command', async (_event, command, waitForCompletion = true, timeout = 30000) => {
    try {
      const currentProject = getCurrentProject();

      // CRITICAL SECURITY: Never allow terminal commands without an open project
      if (!currentProject) {
        return {
          success: false,
          output: 'ERROR: No project folder is currently open. Please open a project folder first.',
          error: 'No project folder open',
          exitCode: -1,
          workingDir: null,
          message: '❌ No project folder open'
        };
      }

      const workingDir = currentProject; // No fallback to process.cwd()

      // Double-check we're not in the Electron app directory
      if (
        (APP_ROOT && workingDir === APP_ROOT) ||
        (appDir && workingDir === appDir) ||
        workingDir === process.cwd()
      ) {
        log?.warn?.('[Terminal] SECURITY VIOLATION: Attempted to run command in app directory');
        return {
          success: false,
          output: 'ERROR: Cannot run commands in the Electron app directory',
          error: 'Security violation: attempted to modify app files',
          exitCode: -1,
          workingDir,
          message: '❌ Security violation prevented'
        };
      }

      const cmd = typeof command === 'string' ? command : '';
      if (!cmd.trim()) {
        return { success: false, output: '', error: 'Missing command', exitCode: -1, workingDir, message: '❌ Missing command' };
      }

      const timeoutMs = normalizeTimeoutMs(timeout, 30_000);
      const options = {
        cwd: workingDir,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 10 // 10MB
      };

      // If caller requested fire-and-forget, start the process and return immediately.
      if (waitForCompletion === false) {
        const child = exec(cmd, options, (_err, _stdout, _stderr) => {
          // Intentionally ignore output; caller opted out of waiting.
        });
        try { child.unref?.(); } catch { /* ignore */ }
        return {
          success: true,
          output: '',
          exitCode: 0,
          workingDir,
          pid: child && typeof child.pid === 'number' ? child.pid : null,
          started: true,
          message: `✅ Started in: ${path.basename(workingDir)}`
        };
      }

      const { stdout, stderr } = await execAsync(cmd, options);
      const output = String(stdout || '') + String(stderr || '');

      return {
        success: true,
        output,
        exitCode: 0,
        workingDir,
        message: `✅ Executed in: ${path.basename(workingDir)}`
      };
    } catch (error) {
      const currentProject = getCurrentProject();
      const output = (error && (error.stdout || '')) + (error && (error.stderr || '')) + (error && (error.message || ''));
      return {
        success: false,
        output,
        exitCode: (error && error.code) || 1,
        error: error && error.message ? error.message : String(error),
        workingDir: currentProject,
        message: `❌ Command failed in: ${path.basename(currentProject || 'unknown')}`
      };
    }
  });

  // Terminal Command Execution in a specific directory (restricted to project)
  ipcMain.handle('run-terminal-command-in-dir', async (_event, payload = {}) => {
    try {
      const currentProject = getCurrentProject();
      if (!currentProject) {
        return {
          success: false,
          output: 'ERROR: No project folder is currently open. Please open a project folder first.',
          error: 'No project folder open',
          exitCode: -1,
          workingDir: null,
          message: '❌ No project folder open'
        };
      }

      const command = typeof payload.command === 'string' ? payload.command : '';
      const workingDirRaw = typeof payload.workingDir === 'string' ? payload.workingDir.trim() : '';
      const timeoutSec = Number.isFinite(Number(payload.timeoutSec)) ? Number(payload.timeoutSec) : null;
      const timeoutMs = normalizeTimeoutMs(
        payload.timeoutMs != null ? payload.timeoutMs : (timeoutSec != null ? timeoutSec * 1000 : null),
        60_000
      );
      const waitForCompletion = payload.waitForCompletion !== false;
      if (!command.trim()) return { success: false, output: '', error: 'Missing command', exitCode: -1, workingDir: null };

      // Allow only: currentProject (or its subdirectories).
      const workingDirResolved = workingDirRaw
        ? (path.isAbsolute(workingDirRaw) ? path.resolve(workingDirRaw) : path.resolve(currentProject, workingDirRaw))
        : currentProject;

      if (!isPathInside(currentProject, workingDirResolved)) {
        return { success: false, output: '', error: 'Invalid workingDir (not inside project)', exitCode: -1, workingDir: workingDirResolved };
      }

      // Never allow commands to run in the Electron app directory
      if (
        (APP_ROOT && workingDirResolved === APP_ROOT) ||
        (appDir && workingDirResolved === appDir) ||
        workingDirResolved === process.cwd()
      ) {
        return { success: false, output: '', error: 'Security violation: attempted to run in app directory', exitCode: -1, workingDir: workingDirResolved };
      }

      const options = {
        cwd: workingDirResolved,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 10
      };

      // Fire-and-forget support (optional)
      if (!waitForCompletion) {
        const child = exec(command, options, (_err, _stdout, _stderr) => {});
        try { child.unref?.(); } catch { /* ignore */ }
        return {
          success: true,
          output: '',
          exitCode: 0,
          workingDir: workingDirResolved,
          pid: child && typeof child.pid === 'number' ? child.pid : null,
          started: true
        };
      }

      const startedAt = Date.now();
      const { stdout, stderr } = await execAsync(command, options);
      const output = String(stdout || '') + String(stderr || '');
      const elapsedMs = Date.now() - startedAt;

      return { success: true, output, exitCode: 0, workingDir: workingDirResolved, elapsedMs };
    } catch (error) {
      const currentProject = getCurrentProject();
      const output = (error && (error.stdout || '')) + (error && (error.stderr || '')) + (error && (error.message || ''));
      return {
        success: false,
        output,
        exitCode: (error && error.code) || 1,
        error: error && error.message ? error.message : String(error),
        workingDir: payload && typeof payload.workingDir === 'string' ? payload.workingDir : currentProject
      };
    }
  });
}

module.exports = { registerTerminalCommandIpc };



