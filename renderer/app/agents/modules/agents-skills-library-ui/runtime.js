// ---- GENERATED: runtime statements extracted from app/agents/agents-skills-library-ui.js ----
let agentSkillLibraryActiveTab = 'agents';


// Chat Sessions State
let chatSessions = {};
 // { sessionId: { name, history, timestamp } }
let currentSessionId = null;

// Tracks which session the in-memory `chatHistory` currently represents.
// Prevents startup loads from overwriting persisted session history before hydration.
let hydratedChatSessionId = null;


// Monotonic per-session sequence to guarantee stable incremental ordering across reloads
// (timestamps can collide; seq never does).
let messageSeqBySession = {};
