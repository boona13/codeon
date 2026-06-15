// ---- GENERATED: runtime statements extracted from git/git-operations.js ----
let gitOperationChain = Promise.resolve();


// Global mutex for permission dialogs (modal is app-wide).
// Ensures prompts never overlap even if multiple sessions request permission concurrently.
let permissionDialogChain = Promise.resolve();


// Persist partial (streaming) assistant output so it survives app restarts even if the run
// is interrupted or the app is closed mid-stream. Stored as UI-only metadata.
const STREAM_SNAPSHOT_DEBOUNCE_MS = 1200;

const MAX_STREAM_SNAPSHOT_TEXT_CHARS = 120_000;

const MAX_STREAM_SNAPSHOT_THINKING_CHARS = 60_000;

const MAX_STREAM_SNAPSHOT_DIFF_CHARS = 50_000;

const MAX_STREAM_SNAPSHOT_DIFF_BLOCKS = 40;


let streamSnapshotTimerBySession = {};
 // { [sessionId]: timeoutId }
let streamSnapshotLastSigBySession = {};
 // { [sessionId]: string }
let streamSnapshotLastForcedSaveAtBySession = {};
 // { [sessionId]: number }
// PERF: full chat persistence is expensive (large payload + disk). Stream journal already captures
// high-frequency partial text, so keep forced full-history flushes rare.
const STREAM_SNAPSHOT_FORCE_SAVE_MIN_INTERVAL_MS = 4000;


// FLICKER-FREE STREAMING RENDER SYSTEM
// Uses requestAnimationFrame exclusively to batch all DOM updates into single frames
// Prevents concurrent renders and only updates when content actually changes

const STREAM_RENDER_MIN_INTERVAL_MS = 200; // Minimum interval between renders (~5fps)
let streamRenderTimerBySession = {}; // { [sessionId]: timeoutId }
let streamRenderLastAtBySession = {}; // { [sessionId]: number }
let streamRenderPendingOptsBySession = {}; // { [sessionId]: opts }
let streamRenderInProgress = {}; // { [sessionId]: boolean } - prevents concurrent renders
let streamRenderLastContentHash = {}; // { [sessionId]: string } - skip renders if unchanged


// Claude SDK event routing (requestId -> handler)
const claudeSdkHandlers = new Map();

if (window.electronAPI && typeof window.electronAPI.onClaudeSdkEvent === 'function') {
  window.electronAPI.onClaudeSdkEvent((evt) => {
    try {
      const id = evt && evt.requestId;
      if (!id) return;
      const handler = claudeSdkHandlers.get(id);
      if (typeof handler === 'function') handler(evt);
    } catch (e) {
      console.warn('[ClaudeSDK] Event handler error:', e);
    }
  });
}
