// ---- GENERATED: runtime statements extracted from app/console/console-state.js ----
let currentTodoList = [];


// Console messages must be isolated per chat session (tab).
// We persist a bounded snapshot into the session's canonical timeline as role: 'console_state'.
const MAX_CONSOLE_MESSAGES_PER_SESSION = 400;

let consoleMessagesBySession = {};
 // { [sessionId]: [{ ts, type, message }] }
let consoleIndicatorBySession = {};

// PERF: Coalesce console DOM updates and persistence during tool-heavy runs.
let consoleRenderRafBySession = {}; // { [sid]: rafId }
let consolePendingDomBySession = {}; // { [sid]: [{ ts, type, message }] }
let consolePersistTimerBySession = {}; // { [sid]: timeoutId }
const CONSOLE_PERSIST_DEBOUNCE_MS = 900;

// Message Queue - allows users to queue follow-up messages while AI is running
// { [sessionId]: [{ id, text, attachments?, createdAt }] }
let messageQueueBySession = {};
let messageQueueIdCounter = 0;


// Override console-utils.js global helpers with session-scoped versions (keeps backward compatibility)
window.addConsoleMessage = function addConsoleMessage(message, type = 'info', sessionId = currentSessionId) {
  addConsoleMessageForSession(message, type, sessionId, { persist: true });
};

window.updateConsoleStatus = function updateConsoleStatus(status, type = 'idle', sessionId = currentSessionId) {
  const sid = String(sessionId || currentSessionId || '').trim();
  if (!sid) return;
  setConsoleIndicatorState(sid, { type: String(type || 'idle'), title: String(status || '') });
  if (sid === currentSessionId) applyConsoleIndicatorForSession(sid);
  // Debounce persistence (expensive: rewrites session timeline snapshot).
  try { schedulePersistConsoleState(sid); } catch { /* ignore */ }
};
