// ============================================================================
// PER-SESSION RUN STATE (Tab Isolation)
// ============================================================================
// Each chat tab can run independently. We keep runtime state keyed by sessionId.
let runStateBySession = {}; // { [sessionId]: { isProcessing, abortController, requestId, processCommitHash } }
// Note: permission prompts use a global modal; we still keep per-session ordering via this field.
let workspaceFsRefreshTimer = null;

