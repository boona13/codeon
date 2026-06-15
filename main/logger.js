// Codeon - Structured Logger (Main Process)
// Lightweight, dependency-free, and safe by default (best-effort redaction).

'use strict';

const LEVEL_TO_NUM = { debug: 10, info: 20, warn: 30, error: 40 };

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

function redactDeep(value, depth = 0, seen = null) {
  if (depth > 5) return '[Truncated]';
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return '[Function]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length && i < 50; i++) out.push(redactDeep(value[i], depth + 1, seen));
    if (value.length > 50) out.push(`[+${value.length - 50} more]`);
    return out;
  }
  if (typeof value === 'object') {
    if (!seen) seen = new Set();
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = shouldRedactKey(k) ? '[REDACTED]' : redactDeep(v, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

function safeFormatArgs(args) {
  try {
    return args.map((a) => {
      if (typeof a === 'string') return a;
      return redactDeep(a);
    });
  } catch {
    return args;
  }
}

function createLogger({ name = 'app', level = 'info' } = {}) {
  const lvl = normalizeLevel(level);
  const min = LEVEL_TO_NUM[lvl];

  const emit = (method, msgLevel, args) => {
    const n = LEVEL_TO_NUM[msgLevel];
    if (n < min) return;
    try {
      const prefix = `[${name}]`;
      const formatted = safeFormatArgs(args);
      console[method](prefix, ...formatted);
    } catch {
      // ignore
    }
  };

  return {
    level: lvl,
    debug: (...args) => emit('log', 'debug', args),
    info: (...args) => emit('log', 'info', args),
    warn: (...args) => emit('warn', 'warn', args),
    error: (...args) => emit('error', 'error', args),
    redact: (v) => redactDeep(v),
  };
}

module.exports = {
  createLogger,
  redactDeep,
};


