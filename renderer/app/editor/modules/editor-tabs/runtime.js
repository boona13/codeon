// ---- GENERATED: runtime statements extracted from app/editor/editor-tabs.js ----
let editorTabs = [];
 // [{ key, absPath, relPath, name, model, savedVersionId, viewState, lastDiskMtimeMs, conflictOnDisk }]
let activeEditorTabKey = null;

let suppressModelDirtyTracking = false;

let diffModels = null;
 // { original, modified }
let lastDiffByRelPath = {};


// ============================================================================
// Embedded <script> diagnostics for HTML files (no LSP; low-risk fallback)
// - Monaco's HTML service doesn't validate embedded JS, so obvious syntax errors can be missed.
// - We do a lightweight syntax check on classic <script> blocks and surface errors via markers.
// ============================================================================

const HTML_SCRIPT_MARKER_OWNER = 'codeon-html-embedded-js';


// (Removed) local indexing / embeddings / cursor-search runtime (Claude SDK wrapper)
window.indexingService = null;

window.sparseChunkBuilder = null;

window.architectureAnalyzer = null;

window.cursorSearchService = null;


// Initialize Monaco Editor (explicit entrypoint).
// Best practice in a plain-<script> app: avoid top-level side effects in shared runtime files.
let __codeonEditorTabsInitStarted = false;
function __codeonInitEditorTabs() {
  if (__codeonEditorTabsInitStarted) return;
  __codeonEditorTabsInitStarted = true;

  try {
    if (typeof require === 'undefined' || !require || typeof require.config !== 'function') {
      console.error('[Codeon] Monaco AMD loader (require) not available');
      return;
    }

    require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });

    require(['vs/editor/editor.main'], function () {
      try {
        // Define custom minimal dark theme matching our app's clean design
        monaco.editor.defineTheme('claude-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: '', foreground: 'E5E5E5' },
            { token: 'comment', foreground: '6B6B6B', fontStyle: 'italic' },
            { token: 'keyword', foreground: 'D97757' },
            { token: 'string', foreground: '10B981' },
            { token: 'number', foreground: 'E6A08A' },
            { token: 'regexp', foreground: 'A78BFA' },
            { token: 'type', foreground: 'D97757' },
            { token: 'class', foreground: 'E6A08A' },
            { token: 'function', foreground: 'A0A0A0' },
            { token: 'variable', foreground: 'E5E5E5' },
            { token: 'constant', foreground: 'E6A08A' },
            { token: 'operator', foreground: 'A0A0A0' },
            { token: 'delimiter', foreground: 'A0A0A0' },
          ],
          colors: {
            'editor.background': '#18181C',
            'editor.foreground': '#E5E5E5',
            'editor.lineHighlightBackground': '#1E1E22',
            'editor.selectionBackground': '#D9775733',
            'editor.inactiveSelectionBackground': '#D9775722',
            'editorCursor.foreground': '#D97757',
            'editorLineNumber.foreground': '#6B6B6B',
            'editorLineNumber.activeForeground': '#A0A0A0',
            'editorWhitespace.foreground': '#2A2A2E',
            'editorIndentGuide.background': '#2A2A2E',
            'editorIndentGuide.activeBackground': '#D97757',
            'editor.selectionHighlightBackground': '#D9775722',
            'editor.wordHighlightBackground': '#D9775722',
            'editorBracketMatch.background': '#D9775733',
            'editorBracketMatch.border': '#D97757',
            'scrollbarSlider.background': '#2A2A2E',
            'scrollbarSlider.hoverBackground': '#333337',
            'scrollbarSlider.activeBackground': '#D97757',
          }
        });

        // Create Monaco Editor instance
        editor = monaco.editor.create(document.getElementById('editor'), {
          value: '',
          language: 'javascript',
          theme: 'claude-dark',
          automaticLayout: true,
          fontSize: 14,
          lineNumbers: 'on',
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          formatOnPaste: true,
          formatOnType: true,
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          tabSize: 2
        });

        // Create Diff Editor instance
        diffEditor = monaco.editor.createDiffEditor(document.getElementById('diffEditor'), {
          enableSplitViewResizing: true,
          renderSideBySide: true, // Show side-by-side diff (original on left, modified on right)
          readOnly: true, // Preview is read-only
          automaticLayout: true,
          theme: 'claude-dark',
          fontSize: 14
        });
        window.diffEditor = diffEditor;

        // Hide empty state when editor is created
        document.getElementById('editorEmptyState').style.display = 'none';

        // ...
        editor.onDidChangeModelContent(() => {
          if (!currentFile) return;
          if (suppressModelDirtyTracking) return;
          // Update tab dirty indicator
          renderEditorTabs();
        });

        bindEditorTabHotkeysOnce();
        initializeApp();
      } catch (e) {
        console.error('[Codeon] Monaco init failed:', e);
      }
    });
  } catch (e) {
    console.error('[Codeon] Failed to start editor init:', e);
  }
}

// Expose a stable init entrypoint.
try {
  window.Codeon = window.Codeon || {};
  window.Codeon.editor = window.Codeon.editor || {};
  window.Codeon.editor.init = __codeonInitEditorTabs;
} catch { /* ignore */ }
try { window.__codeonInitEditorTabs = __codeonInitEditorTabs; } catch { /* ignore */ }


let __monacoLayoutRaf = 0;


// Expose functions for tools to use.
// NOTE: In the pre-split monolith, function declarations were hoisted within a single script.
// After splitting into multiple scripts, the function may not exist yet at this point.
try { if (typeof openFile === 'function') window.openFile = openFile; } catch { /* ignore */ }

try { if (typeof renderFileTree === 'function') window.renderFileTree = renderFileTree; } catch { /* ignore */ }


// Ensure global tool entrypoint is available after the declaration is loaded.
try { window.openFile = openFile; } catch { /* ignore */ }


let __tsJsServiceConfigured = false;


let __webServicesConfigured = false;
