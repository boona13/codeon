/**
 * Codex provider — ChatGPT-subscription auth (CommonJS port for CODEON).
 *
 * PKCE OAuth login against auth.openai.com using the Codex CLI's sanctioned
 * client id, tokens stored in the app data dir, plus a live model catalog from
 * the ChatGPT Codex backend. Inference itself is handled by the local
 * translation proxy (see codex-proxy.js), which reads the token store written
 * here. Model slugs are namespaced "codex/<model>[:effort]".
 *
 * Mirrors the integration shape proven in the boonaLoop harness.
 */

'use strict';

const { createHash, randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Constants (the OAuth shape is the Codex CLI's; redirect/port must match the
// values registered for this client id or the callback is rejected).
// ---------------------------------------------------------------------------

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_BASE = 'https://auth.openai.com';
const AUTHORIZE_URL = `${AUTH_BASE}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
const SCOPE = 'openid profile email offline_access';
const JWT_CLAIM = 'https://api.openai.com/auth';
const ORIGINATOR = 'codeon';

const CODEX_BASE = 'https://chatgpt.com/backend-api/codex';
const CLIENT_VERSION = '99.0.0';
const REFRESH_MARGIN_MS = 5 * 60_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

const CODEX_PREFIX = 'codex/';
const DEFAULT_CODEX_MODEL = 'codex/gpt-5.5';

function isCodexModel(model) {
  return typeof model === 'string' && model.startsWith(CODEX_PREFIX);
}

/**
 * Shown only when the live catalog can't be fetched (offline). The backend's
 * model set changes over time — the source of truth is fetchCodexModels().
 */
const FALLBACK_CODEX_MODELS = [
  { id: 'codex/gpt-5.5', name: 'GPT-5.5', vision: true },
  { id: 'codex/gpt-5.5:high', name: 'GPT-5.5 (high reasoning)', vision: true },
  { id: 'codex/gpt-5.4', name: 'GPT-5.4', vision: true },
  { id: 'codex/gpt-5.4:high', name: 'GPT-5.4 (high reasoning)', vision: true },
  { id: 'codex/gpt-5.4-mini', name: 'GPT-5.4 Mini', vision: true },
];

// ---------------------------------------------------------------------------
// Token store: ~/.ai-agent/codex-auth.json (CODEON app data dir).
// ---------------------------------------------------------------------------

const STORE_DIR = path.resolve(os.homedir(), '.ai-agent');
const STORE_PATH = path.resolve(STORE_DIR, 'codex-auth.json');
const LOCK_PATH = path.resolve(STORE_DIR, 'codex-auth.lock');

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch { /* ignore */ }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readStore() {
  const raw = readJsonSafe(STORE_PATH);
  if (!raw || typeof raw.access !== 'string' || typeof raw.refresh !== 'string') return null;
  if (typeof raw.expires !== 'number' || typeof raw.accountId !== 'string') return null;
  return raw;
}

function hasCodexAuth() {
  return readStore() !== null;
}

function codexLogout() {
  try {
    fs.rmSync(STORE_PATH, { force: true });
  } catch { /* best effort */ }
}

/**
 * Cross-process refresh lock. Codex refresh tokens are single-use; concurrent
 * refreshes would invalidate each other. mkdir is atomic, so the directory
 * doubles as the lock; a stale lock (crashed holder) is stolen after 60s.
 */
async function withRefreshLock(fn) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_PATH, { recursive: false });
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(LOCK_PATH).mtimeMs > 60_000) {
          fs.rmdirSync(LOCK_PATH);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) throw new Error('Timed out waiting for the Codex token refresh lock.');
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      fs.rmdirSync(LOCK_PATH);
    } catch { /* already released */ }
  }
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function accountIdFromAccessToken(access) {
  const payload = decodeJwtPayload(access);
  const auth = payload?.[JWT_CLAIM];
  const id = auth?.chatgpt_account_id;
  if (typeof id !== 'string' || !id) {
    throw new Error('Codex login failed: no ChatGPT account id in the access token.');
  }
  return id;
}

function emailFromIdToken(idToken) {
  if (!idToken) return undefined;
  const email = decodeJwtPayload(idToken)?.email;
  return typeof email === 'string' ? email : undefined;
}

// ---------------------------------------------------------------------------
// Token exchange / refresh
// ---------------------------------------------------------------------------

async function postTokenForm(body, operation) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Codex token ${operation} failed (${res.status}): ${text || res.statusText}`);
  }
  const json = await res.json();
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error(`Codex token ${operation} response was missing fields.`);
  }
  return json;
}

function authFromTokenResponse(json, previousEmail) {
  const access = json.access_token;
  return {
    access,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId: accountIdFromAccessToken(access),
    email: emailFromIdToken(json.id_token) ?? previousEmail,
  };
}

async function refreshStoredAuth(auth) {
  let json;
  try {
    json = await postTokenForm(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh,
        client_id: CLIENT_ID,
      }),
      'refresh',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid_grant|400|401/.test(msg)) {
      throw new Error(`Codex session expired — sign in with ChatGPT again in Settings. (${msg})`);
    }
    throw err;
  }
  const next = authFromTokenResponse(json, auth.email);
  writeJsonAtomic(STORE_PATH, next);
  return next;
}

/**
 * The current usable access token, refreshing (under the cross-process lock)
 * when expired or about to expire. `force` refreshes regardless — used once
 * after a 401 in case the token was revoked server-side early.
 */
async function getCodexAccessToken(force = false) {
  let auth = readStore();
  if (!auth) throw new Error('Codex is not connected — sign in with ChatGPT in Settings.');
  if (!force && auth.expires - Date.now() > REFRESH_MARGIN_MS) {
    return { access: auth.access, accountId: auth.accountId };
  }
  return withRefreshLock(async () => {
    auth = readStore();
    if (!auth) throw new Error('Codex is not connected — sign in with ChatGPT in Settings.');
    if (!force && auth.expires - Date.now() > REFRESH_MARGIN_MS) {
      return { access: auth.access, accountId: auth.accountId };
    }
    const next = await refreshStoredAuth(auth);
    return { access: next.access, accountId: next.accountId };
  });
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

let codexModelCache = { at: 0, list: [] };

/**
 * The selectable catalog, fetched live from the ChatGPT backend so the dropdown
 * only offers models this account can run. Cached 10 min; falls back to a
 * static list when offline. Each reasoning model also gets a ":high" variant.
 */
async function fetchCodexModels() {
  if (!hasCodexAuth()) return [];
  if (codexModelCache.list.length && Date.now() - codexModelCache.at < 600_000) {
    return codexModelCache.list;
  }
  try {
    const { access, accountId } = await getCodexAccessToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${CODEX_BASE}/models?client_version=${CLIENT_VERSION}`, {
        headers: {
          Authorization: `Bearer ${access}`,
          'chatgpt-account-id': accountId,
          originator: ORIGINATOR,
        },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`models ${res.status}`);
      const data = await res.json();
      const list = [];
      for (const m of data.models ?? []) {
        if (!m.slug || m.visibility === 'hide') continue;
        const name = m.display_name ?? m.slug;
        const vision = (m.input_modalities ?? []).includes('image');
        list.push({ id: CODEX_PREFIX + m.slug, name, vision });
        if ((m.supported_reasoning_levels ?? []).some((l) => l.effort === 'high')) {
          list.push({ id: `${CODEX_PREFIX}${m.slug}:high`, name: `${name} (high reasoning)`, vision });
        }
      }
      if (list.length) codexModelCache = { at: Date.now(), list };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* offline / endpoint moved — fall through to cache or fallback */
  }
  return codexModelCache.list.length ? codexModelCache.list : FALLBACK_CODEX_MODELS;
}

/** "codex/gpt-5.4-codex:high" -> { model: "gpt-5.4-codex", effort: "high" } */
function parseCodexSlug(slug) {
  const bare = String(slug || '').startsWith(CODEX_PREFIX) ? String(slug).slice(CODEX_PREFIX.length) : String(slug || '');
  const m = /^(.*?)(?::(minimal|low|medium|high|xhigh))?$/.exec(bare);
  const model = m?.[1] || bare;
  let effort = m?.[2] || 'medium';
  // gpt-5.2+ dropped "minimal" — clamp to the nearest supported level.
  if (/^gpt-5\.[2-9]/.test(model) && effort === 'minimal') effort = 'low';
  return { model, effort };
}

/**
 * Launch-time check that a codex/* slug names a model this account can serve.
 * Returns an error message, or null when valid (or unverifiable offline).
 */
async function validateCodexModel(slug) {
  const models = await fetchCodexModels();
  if (!models.length) return null; // not connected / offline — provider gate handles it
  const base = CODEX_PREFIX + parseCodexSlug(slug).model;
  if (models.some((m) => m.id === base)) return null;
  const available = [...new Set(models.map((m) => m.id.split(':')[0]))].join(', ');
  return `"${slug}" isn't available on your ChatGPT account. Available Codex models: ${available}.`;
}

// ---------------------------------------------------------------------------
// OAuth login (PKCE + localhost callback)
// ---------------------------------------------------------------------------

let pendingLogin = null;

function b64url(buf) {
  return buf.toString('base64url');
}

function closePendingLogin() {
  if (!pendingLogin) return;
  clearTimeout(pendingLogin.timer);
  try {
    pendingLogin.server.close();
  } catch { /* already closed */ }
  pendingLogin = null;
}

function loginPage(title, body) {
  return `<!DOCTYPE html><html><body style="background:#0a0d13;color:#c8d0e0;font-family:monospace;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:480px"><div style="font-size:22px;margin-bottom:10px">${title}</div><div style="color:#7a849c">${body}</div></div></body></html>`;
}

/**
 * Start (or restart) a browser login. Returns the authorize URL for the UI to
 * open; the local callback server completes the exchange and writes the store.
 */
async function startCodexLogin() {
  closePendingLogin();

  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = randomBytes(16).toString('hex');

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const u = new URL(req.url ?? '/', 'http://localhost');
        if (u.pathname !== '/auth/callback') {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(loginPage('Not found', 'Unexpected callback path.'));
          return;
        }
        if (u.searchParams.get('state') !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(loginPage('Login failed', 'State mismatch — start the sign-in again from Settings.'));
          if (pendingLogin) pendingLogin.error = 'State mismatch during login.';
          return;
        }
        const code = u.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(loginPage('Login failed', 'Missing authorization code.'));
          if (pendingLogin) pendingLogin.error = 'Missing authorization code.';
          return;
        }
        const json = await postTokenForm(
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code,
            code_verifier: verifier,
            redirect_uri: REDIRECT_URI,
          }),
          'exchange',
        );
        writeJsonAtomic(STORE_PATH, authFromTokenResponse(json));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginPage('\u2713 Connected', 'ChatGPT Codex is connected. You can close this window and return to CODEON.'));
        closePendingLogin();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginPage('Login failed', err.message));
        if (pendingLogin) pendingLogin.error = err.message;
      }
    })();
  });

  await new Promise((resolvePromise, reject) => {
    server.on('error', (err) =>
      reject(new Error(`Could not open the login callback on port ${CALLBACK_PORT}: ${err.message}`)),
    );
    server.listen(CALLBACK_PORT, () => resolvePromise());
  });

  const timer = setTimeout(closePendingLogin, LOGIN_TIMEOUT_MS);
  timer.unref?.();
  pendingLogin = { state, verifier, server, timer };

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', ORIGINATOR);
  return { url: url.toString() };
}

function getCodexStatus() {
  const auth = readStore();
  return {
    connected: !!auth,
    email: auth?.email,
    expires: auth?.expires,
    loginPending: !!pendingLogin && !pendingLogin.error,
    loginError: pendingLogin?.error,
  };
}

// Ensure the store directory exists for first writes.
try {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
} catch { /* surfaced later on first real write */ }

module.exports = {
  CODEX_PREFIX,
  DEFAULT_CODEX_MODEL,
  ORIGINATOR,
  CODEX_BASE,
  CLIENT_VERSION,
  isCodexModel,
  parseCodexSlug,
  hasCodexAuth,
  codexLogout,
  getCodexAccessToken,
  fetchCodexModels,
  validateCodexModel,
  startCodexLogin,
  getCodexStatus,
};
