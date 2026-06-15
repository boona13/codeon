// Codeon - Main Application Logic
// Version: 2.0.0 - Model Compatibility Update (Nov 26, 2025)

// Global namespace for gradually modularizing the renderer without a bundler/ESM.
// Keep this lightweight and backward-compatible with existing global-scope scripts.
try {
  window.Codeon = window.Codeon || {};
  window.Codeon.app = window.Codeon.app || {};
  window.Codeon.state = window.Codeon.state || {};
  window.Codeon.ui = window.Codeon.ui || {};
  window.Codeon.editor = window.Codeon.editor || {};
  window.Codeon.chat = window.Codeon.chat || {};
  window.Codeon.git = window.Codeon.git || {};
  window.Codeon.aet = window.Codeon.aet || {};
} catch {
  // ignore
}

// Global state
let editor = null;
let diffEditor = null;
let currentFile = null;
let currentFolder = null;
let chatHistory = []; // Canonical timeline for the active session (alias of `chatSessions[currentSessionId].messages`)
// Canonical chat timeline is stored per session in `chatSessions[sessionId].messages`.
// `uiMetadata` is legacy (used only for migration from older versions).
let uiMetadata = {}; // legacy UI-only data by session (migration only)
// Persisted UI state (not part of the chat timeline). Stored in `.ai-agent/ui-metadata.json`.
// Currently used for AET view/viewport state; keep it small and robust to corruption.
let uiMetadataState = { v: 2, updatedAt: 0, aet: {} };
let uiMetadataSaveTimer = null;
let workspaceFileTreeSnapshot = []; // latest workspace tree from `readDirectory` (used for project-wide diagnostics)
// Attachments must be isolated per chat session tab

function aetDebugEnabled() {
  try {
    return String(localStorage.getItem('codeon.aetDebug') || '') === '1';
  } catch {
    return false;
  }
}

async function syncAetDebugToMain() {
  try {
    if (!window.electronAPI || typeof window.electronAPI.aetSetDebug !== 'function') return;
    await window.electronAPI.aetSetDebug(aetDebugEnabled());
  } catch {
    // ignore
  }
}
let pendingAttachmentsBySession = {}; // { [sessionId]: attachment[] }
let settings = {
  apiKey: '',
  authMode: 'claude_ai', // 'claude_ai' | 'api_key'
  // LLM Provider: 'claude_ai' | 'anthropic_api' | 'openrouter' | 'codex'
  llmProvider: 'claude_ai',
  // Optional: explicit Claude model id (empty => CLI default)
  claudeModel: '',
  // OpenRouter settings
  openrouterApiKey: '',
  openrouterModel: '',
  // Codex (ChatGPT-subscription) settings
  codexModel: 'codex/gpt-5.5',
  // Global “done reviewing” for diff highlights (applies across all chat sessions).
  // If set, we ignore any file_preview diffs at-or-before this timestamp when computing highlights.
  diffHighlightsGlobalClearedAt: 0,
  // Global per-file “done reviewing” for diff highlights (applies across all chat sessions).
  // Map: relPath -> clearedAtMs
  diffHighlightsGlobalClearedFiles: {},
  // Permission modes (Claude Code-style)
  // - plan: read-only (no edits, no commands, no network)
  // - default: ask before edits, commands, and network
  // - acceptEdits: no prompts (still enforces sandboxing + network policy)
  // - bypassPermissions: no prompts (still enforce workspace isolation)
  permissionMode: 'acceptEdits',
  // Soft sandboxing: WebFetch network policy
  // - allow_all: allow (still prompts depending on permissionMode)
  // - deny_all: block WebFetch entirely
  // - allowlist: allow only domains in networkAllowlist
  networkPolicyMode: 'allow_all',
  networkAllowlist: [],
  // Optional: stop run when total cost exceeds this amount (Agent SDK: maxBudgetUsd)
  maxBudgetUsd: 0,
  // Codeon-style history: summary + last N messages (configurable)
  maxHistoryMessages: 40,

  // Editor enhancements (curated, low-risk: default OFF)
  enableProblemsPanel: false,
  enableAiQuickFixes: false,
  enableTsJsLanguageService: false,
  enableWebLanguageServices: false,
  // Learning Mode: generate educational explanations after each AI run
  enableLearningMode: false,
  // Fix runs: allow Docs/Learning followups after a verification fix
  enableDocsLearningOnFix: false
};

// Claude supported models cache (best-effort)
let claudeSupportedModelsCache = null; // ModelInfo[]
let claudeSupportedModelsFetchedAt = 0;

// Global Claude backoff (rate limiting). This is account-scoped, not per-chat.
let claudeGlobalBackoffUntilMs = 0;

// Context menu state
let contextMenuTarget = null;
let contextMenuPath = null;
let contextMenuIsFolder = false;
let chatTabContextSessionId = null;
let isChatEditorView = false;
let chatSessionsSearchQuery = '';

