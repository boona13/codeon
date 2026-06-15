// Codeon - Structured Logger (Renderer)
// Plain <script> compatible (no bundler/ESM).
(function () {
  'use strict';

  const LEVEL_TO_NUM = { debug: 10, info: 20, warn: 30, error: 40 };

  // Save raw console methods BEFORE any patching to avoid infinite loops
  const _rawLog = console.log ? console.log.bind(console) : () => {};
  const _rawInfo = console.info ? console.info.bind(console) : () => {};
  const _rawWarn = console.warn ? console.warn.bind(console) : () => {};
  const _rawError = console.error ? console.error.bind(console) : () => {};

  function normalizeLevel(level) {
    const l = String(level || '').trim().toLowerCase();
    return LEVEL_TO_NUM[l] ? l : 'info';
  }

  function shouldRedactKey(key) {
    const k = String(key || '').toLowerCase();
    return (
      k.includes('apikey') ||
      k.includes('api_key') ||
      k.includes('token') ||
      k.includes('secret') ||
      k.includes('authorization') ||
      k.includes('password')
    );
  }

  function redactDeep(value, depth, seen) {
    const d = Number.isFinite(depth) ? depth : 0;
    if (d > 5) return '[Truncated]';
    if (value == null) return value;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return value;
    if (t === 'bigint') return String(value);
    if (t === 'function') return '[Function]';
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      const out = [];
      for (let i = 0; i < value.length && i < 50; i++) out.push(redactDeep(value[i], d + 1, seen));
      if (value.length > 50) out.push(`[+${value.length - 50} more]`);
      return out;
    }
    if (t === 'object') {
      const s = seen || new Set();
      if (s.has(value)) return '[Circular]';
      s.add(value);
      const out = {};
      for (const k of Object.keys(value)) {
        try {
          out[k] = shouldRedactKey(k) ? '[REDACTED]' : redactDeep(value[k], d + 1, s);
        } catch {
          out[k] = '[Unserializable]';
        }
      }
      return out;
    }
    return String(value);
  }

  function formatArgs(args) {
    const out = [];
    for (const a of args) {
      if (typeof a === 'string') out.push(a);
      else {
        try {
          out.push(JSON.stringify(redactDeep(a, 0, null)));
        } catch {
          out.push(String(a));
        }
      }
    }
    return out;
  }

  function createLogger(opts) {
    const name = (opts && opts.name) ? String(opts.name) : 'Renderer';
    const level = normalizeLevel(opts && opts.level);
    const min = LEVEL_TO_NUM[level];

    const emit = (msgLevel, args) => {
      const n = LEVEL_TO_NUM[msgLevel];
      if (n < min) return;

      const prefix = `[${name}]`;
      const parts = formatArgs(args);

      // IMPORTANT: Use raw (unpatched) console methods to avoid infinite loops
      try {
        if (msgLevel === 'error') _rawError(prefix, ...parts);
        else if (msgLevel === 'warn') _rawWarn(prefix, ...parts);
        else _rawLog(prefix, ...parts);
      } catch { /* ignore */ }

      // Mirror warnings/errors into Codeon's bottom console panel when available.
      try {
        if (typeof window.addConsoleMessage === 'function' && (msgLevel === 'warn' || msgLevel === 'error')) {
          const joined = [prefix].concat(parts).join(' ');
          window.addConsoleMessage(joined, msgLevel === 'error' ? 'error' : 'info');
        }
      } catch { /* ignore */ }
    };

    return {
      level,
      debug: (...args) => emit('debug', args),
      info: (...args) => emit('info', args),
      warn: (...args) => emit('warn', args),
      error: (...args) => emit('error', args),
      redact: (v) => redactDeep(v, 0, null),
    };
  }

  // Global singleton
  // Default to info so console.log messages are visible; can be overridden via localStorage.
  let configuredLevel = 'info';
  try {
    const raw = localStorage.getItem('codeon.logLevel');
    if (raw) configuredLevel = normalizeLevel(raw);
  } catch { /* ignore */ }

  const log = createLogger({ name: 'Codeon', level: configuredLevel });
  try { window.CodeonLog = log; } catch { /* ignore */ }

  // Patch console by default:
  // - routes console.log/info through the logger (and therefore respects log level + redaction)
  // - keeps warn/error visible
  try {
    const patchMode = localStorage.getItem('codeon.patchConsole');
    const shouldPatch = patchMode !== '0';
    if (shouldPatch) {
      console.log = (...args) => {
        try { log.info(...args); }
        catch {
          try { _rawLog(...args); } catch { /* ignore */ }
        }
      };
      console.info = (...args) => {
        try { log.info(...args); }
        catch {
          try { _rawInfo(...args); } catch { /* ignore */ }
        }
      };
      console.warn = (...args) => {
        try { log.warn(...args); }
        catch {
          try { _rawWarn(...args); } catch { /* ignore */ }
        }
      };
      console.error = (...args) => {
        try { log.error(...args); }
        catch {
          try { _rawError(...args); } catch { /* ignore */ }
        }
      };
    }
  } catch { /* ignore */ }
})();


