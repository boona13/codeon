// ============================================================================
// FILE EXPLORER STATE (VS Code-like interactions)
// ============================================================================
let explorerSelectedAbsPaths = new Set(); // Set<string>
let explorerAnchorAbsPath = null; // string | null (range selection anchor)
let explorerFocusedAbsPath = null; // string | null (last focused item)
let explorerClipboard = null; // { op: 'copy'|'cut', absPaths: string[], createdAt: number } | null
let explorerHasFocus = false;
let explorerExpandedAbsDirs = new Set(); // Set<string> (expanded folders)

