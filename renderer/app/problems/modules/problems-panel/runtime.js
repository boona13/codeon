// ---- GENERATED: runtime statements extracted from app/problems/problems-panel.js ----
let __problemsSetupDone = false;

let __problemsRenderTimer = null;


// Project-wide problems (unopened files)
const projectProblemsState = {
  token: 0,
  status: 'idle', // idle | scanning | done | error
  startedAt: 0,
  finishedAt: 0,
  scannedFiles: 0,
  totalFiles: 0,
  truncated: false,
  error: '',
  results: [] // problem objects in same shape as `getProblemsForOpenTabs()`
};


let __projectScanDebounceTimer = null;

// Scan safety controls to prevent crashes
let __projectScanLock = false; // Prevents concurrent scans
let __projectScanLastCompletedAt = 0; // Timestamp of last completed scan
const __PROJECT_SCAN_COOLDOWN_MS = 30000; // Minimum 30 seconds between scans
const __PROJECT_SCAN_MAX_DURATION_MS = 60000; // Maximum 60 seconds per scan

// Post-run protection: completely skip scanning for a while after AI runs complete
// This prevents the TypeScript worker from crashing the app when processing files
// that were just created/modified by the AI
let __lastAiRunCompletedAt = 0;
const __POST_RUN_SCAN_BLACKOUT_MS = 180000; // 3 minutes after run completes - no scanning


let composerContextState = {
  open: false,
  trigger: '', // 'button' | 'typed'
  atIndex: -1, // only for 'typed'
  query: '',
  activeIndex: 0,
  entries: [],
  category: null // null = category picker, 'files' | 'agents' | 'skills'
};


const CODEON_CLIPBOARD_SELECTION_META_TYPE = 'application/x-codeon-selection';


const CODE_CONTEXT_HEADER_ALLOWED_EXTS = new Set([
  'js','jsx','mjs','cjs','ts','tsx',
  'json','html','htm','css',
  'py','go','java','kt','kts','swift','rs','rb','php','cs','dart','lua','scala',
  'c','cc','cpp','cxx','h','hh','hpp','hxx',
  'toml','yml','yaml','xml','sql','sh','bash','zsh'
]);
