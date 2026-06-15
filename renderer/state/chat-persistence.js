// ============================================================================
// CODEON-STYLE CHAT PERSISTENCE (Workspace-scoped, bounded, debounced)
// ============================================================================

const CODEON_CHAT_STATE_KEY = 'codeon.chatState';
const CODEON_CHAT_STATE_VERSION = 1;
// Small, high-frequency persistence for streaming text (separate from full chat state)
const CODEON_CHAT_STREAM_KEY_PREFIX = 'codeon.chatStream.v1.';

const CHAT_PERSIST_DEBOUNCE_MS = 800;
const MAX_SESSIONS = 30;
const MAX_MESSAGES_PER_SESSION = 200;
const MAX_TOOL_RESULT_CHARS = 20_000;
const MAX_SUMMARY_CHARS = 8000;
const MIN_SUMMARY_CHARS = 500;

let chatPersistTimer = null;

