/**
 * FileSyncController - Universal File State Synchronization
 * 
 * This module provides VS Code-level synchronization between:
 * - File Explorer (DOM-based tree view)
 * - Editor Tabs (Monaco tabs with models)
 * - Diff View (Monaco diff editor)
 * - AI Streaming (file creation during generation)
 * - Checkpoint Restore (git operations)
 * 
 * Architecture:
 * - Single source of truth for file state
 * - Event-driven cross-module communication
 * - Automatic cleanup when files are deleted
 * - Proper diff view ↔ tab coordination
 */

(function() {
  'use strict';

  // ============================================================================
  // Event Bus for cross-module communication
  // ============================================================================
  const EVENT_FILE_OPENED = 'file:opened';
  const EVENT_FILE_CLOSED = 'file:closed';
  const EVENT_FILE_SAVED = 'file:saved';
  const EVENT_FILE_DELETED = 'file:deleted';
  const EVENT_FILE_RENAMED = 'file:renamed';
  const EVENT_DIFF_OPENED = 'diff:opened';
  const EVENT_DIFF_CLOSED = 'diff:closed';
  const EVENT_EXPLORER_REVEAL = 'explorer:reveal';
  const EVENT_CHECKPOINT_RESTORE = 'checkpoint:restore';
  const EVENT_WORKSPACE_REFRESH = 'workspace:refresh';

  const eventListeners = new Map(); // eventType -> Set<callback>

  function on(eventType, callback) {
    if (!eventListeners.has(eventType)) {
      eventListeners.set(eventType, new Set());
    }
    eventListeners.get(eventType).add(callback);
    return () => off(eventType, callback);
  }

  function off(eventType, callback) {
    const listeners = eventListeners.get(eventType);
    if (listeners) listeners.delete(callback);
  }

  function emit(eventType, data) {
    const listeners = eventListeners.get(eventType);
    if (listeners) {
      for (const callback of listeners) {
        try { callback(data); } catch (e) { console.warn('[FileSyncController] Event handler error:', e); }
      }
    }
  }

  // ============================================================================
  // File State Tracking
  // ============================================================================
  
  /**
   * Tracks the current state of files in the workspace
   * Maps absPath -> FileState
   */
  const fileStates = new Map();

  /**
   * @typedef {Object} FileState
   * @property {string} absPath - Absolute path to file
   * @property {string} relPath - Relative path from workspace root
   * @property {boolean} existsOnDisk - Whether the file exists on disk
   * @property {boolean} isOpenInEditor - Whether the file has an editor tab
   * @property {boolean} isOpenInDiffView - Whether the file is shown in diff view
   * @property {boolean} isDirty - Whether the file has unsaved changes
   * @property {number|null} lastModifiedMs - Last modification timestamp
   * @property {string|null} streamingSessionId - Session ID if file is being streamed
   */

  function createFileState(absPath) {
    const relPath = getRelPath(absPath);
    return {
      absPath,
      relPath,
      existsOnDisk: true,
      isOpenInEditor: false,
      isOpenInDiffView: false,
      isDirty: false,
      lastModifiedMs: null,
      streamingSessionId: null
    };
  }

  function getFileState(absPath) {
    const normalized = normalizePath(absPath);
    if (!fileStates.has(normalized)) {
      fileStates.set(normalized, createFileState(normalized));
    }
    return fileStates.get(normalized);
  }

  function updateFileState(absPath, updates) {
    const normalized = normalizePath(absPath);
    const state = getFileState(normalized);
    Object.assign(state, updates);
    return state;
  }

  function removeFileState(absPath) {
    const normalized = normalizePath(absPath);
    fileStates.delete(normalized);
  }

  // ============================================================================
  // Diff View State Tracking
  // ============================================================================
  
  /**
   * Current diff view state
   * Unlike regular tabs, diff view is a single overlay mode
   */
  let currentDiffState = null;

  /**
   * @typedef {Object} DiffState
   * @property {string} absPath - File being diffed
   * @property {string} relPath - Relative path for display
   * @property {string} originalContent - Original file content (before changes)
   * @property {string} modifiedContent - Modified file content (after changes)
   * @property {string} diffContent - Unified diff string (for reconstruction)
   * @property {string|null} baseRef - Git ref for original (e.g., 'HEAD', commit hash)
   * @property {boolean} isVirtual - True if diff is from cached content, not git
   */

  function getDiffState() {
    return currentDiffState;
  }

  function setDiffState(state) {
    const previous = currentDiffState;
    currentDiffState = state;
    
    if (state) {
      emit(EVENT_DIFF_OPENED, state);
      // Update file state
      updateFileState(state.absPath, { isOpenInDiffView: true });
    } else if (previous) {
      emit(EVENT_DIFF_CLOSED, previous);
      // Update file state
      updateFileState(previous.absPath, { isOpenInDiffView: false });
    }
    
    // Sync UI
    syncDiffTabUI();
  }

  function clearDiffState() {
    setDiffState(null);
  }

  // ============================================================================
  // Pseudo-tab for Diff View
  // ============================================================================
  
  /**
   * Creates a pseudo-tab entry for the diff view
   * This makes diff preview feel like a real editor tab
   */
  function getDiffPseudoTab() {
    if (!currentDiffState) return null;
    
    const state = currentDiffState;
    const fileName = state.relPath.split(/[/\\]/).pop();
    
    return {
      key: `diff:${state.absPath}`,
      absPath: state.absPath,
      relPath: state.relPath,
      name: fileName,
      isDiff: true,
      displayName: `${fileName} (diff)`,
      diffState: state
    };
  }

  /**
   * Syncs the diff pseudo-tab with the editor tabs UI
   */
  function syncDiffTabUI() {
    // The editor tabs module will check for the diff pseudo-tab when rendering
    // We just need to trigger a re-render
    try {
      if (typeof window.renderEditorTabs === 'function') {
        window.renderEditorTabs();
      }
    } catch { /* ignore */ }
  }

  // ============================================================================
  // File Operations - Central Entry Points
  // ============================================================================

  /**
   * Open a file in the editor with full synchronization
   * @param {string} filePath - Path to file (absolute or relative)
   * @param {Object} options - Options
   * @param {boolean} options.revealInExplorer - Whether to scroll explorer to file
   * @param {boolean} options.jumpToDiff - Whether to jump to diff decorations
   */
  async function openFile(filePath, options = {}) {
    const absPath = resolveToAbsPath(filePath);
    if (!absPath) return false;

    const { revealInExplorer = true, jumpToDiff = false, diffContent = '' } = options;

    // Exit diff view if active (user clicked on a file, they want to see the file)
    if (currentDiffState && currentDiffState.absPath !== absPath) {
      clearDiffState();
      exitDiffView();
    }

    // Delegate to existing openFile implementation
    try {
      if (typeof window.openFile === 'function') {
        await window.openFile(absPath);
      }
    } catch (e) {
      console.warn('[FileSyncController] Failed to open file:', e);
      return false;
    }

    // Update file state
    updateFileState(absPath, { 
      isOpenInEditor: true,
      existsOnDisk: true 
    });

    // Reveal in explorer if requested
    if (revealInExplorer) {
      revealFileInExplorer(absPath);
    }

    // Jump to diff if requested
    if (jumpToDiff && diffContent) {
      try {
        if (typeof syncDiffDecorationsForTab === 'function') {
          const tab = findTabByAbsPath(absPath);
          if (tab) {
            const firstLine = findFirstAddedLineFromUnifiedDiff(diffContent);
            if (firstLine > 0 && tab.model && window.editor) {
              window.editor.revealLineInCenter(firstLine);
              window.editor.setPosition({ lineNumber: firstLine, column: 1 });
            }
          }
        }
      } catch { /* ignore */ }
    }

    emit(EVENT_FILE_OPENED, { absPath, options });
    return true;
  }

  /**
   * Open a diff view for a file
   * @param {string} filePath - Path to file
   * @param {Object} options - Options
   * @param {string} options.diffContent - Unified diff content
   * @param {string} options.baseRef - Git ref for base (e.g., 'HEAD')
   */
  async function openDiffView(filePath, options = {}) {
    const absPath = resolveToAbsPath(filePath);
    if (!absPath) return false;

    const { diffContent = '', baseRef = null, revealInExplorer = true } = options;

    // Try to open diff from cached content first (works even without git history)
    if (diffContent.trim()) {
      const success = await openDiffFromCachedContentInternal(absPath, diffContent);
      if (success) {
        const relPath = getRelPath(absPath);
        setDiffState({
          absPath,
          relPath,
          diffContent,
          baseRef: null,
          isVirtual: true
        });
        
        if (revealInExplorer) {
          revealFileInExplorer(absPath);
        }
        return true;
      }
    }

    // Fall back to git-based diff
    if (baseRef || !diffContent.trim()) {
      try {
        if (typeof window.openGitDiffForFile === 'function') {
          await window.openGitDiffForFile(absPath, baseRef || 'HEAD');
        }
        
        const relPath = getRelPath(absPath);
        setDiffState({
          absPath,
          relPath,
          diffContent: '',
          baseRef: baseRef || 'HEAD',
          isVirtual: false
        });
        
        if (revealInExplorer) {
          revealFileInExplorer(absPath);
        }
        return true;
      } catch (e) {
        console.warn('[FileSyncController] Failed to open git diff:', e);
      }
    }

    return false;
  }

  /**
   * Internal: Open diff from cached content
   */
  async function openDiffFromCachedContentInternal(absPath, diffContent) {
    try {
      // Read current file content
      if (!window.electronAPI) return false;
      const readResult = await window.electronAPI.readFile(absPath);
      if (!readResult?.success) return false;
      
      const currentContent = String(readResult.content || '');
      
      // Reconstruct original by reverse-applying the diff
      const originalContent = reverseApplyUnifiedDiffInternal(currentContent, diffContent);
      if (originalContent === null) return false;
      
      // If both are identical, the diff might be stale
      if (originalContent === currentContent) return false;

      // Open the diff editor
      const editorEl = document.getElementById('editor');
      const diffEditorEl = document.getElementById('diffEditor');
      if (!editorEl || !diffEditorEl || !window.diffEditor) return false;

      // Hide regular editor, show diff editor
      editorEl.style.display = 'none';
      diffEditorEl.style.display = 'block';

      const lang = typeof detectMonacoLanguageFromPath === 'function' 
        ? detectMonacoLanguageFromPath(absPath) 
        : 'plaintext';

      // Dispose previous diff models
      try { window.diffModels?.original?.dispose?.(); } catch { /* ignore */ }
      try { window.diffModels?.modified?.dispose?.(); } catch { /* ignore */ }
      window.diffModels = null;

      const originalModel = monaco.editor.createModel(originalContent, lang);
      const modifiedModel = monaco.editor.createModel(currentContent, lang);
      window.diffModels = { original: originalModel, modified: modifiedModel };
      window.diffEditor.setModel({ original: originalModel, modified: modifiedModel });

      const relPath = getRelPath(absPath);
      if (typeof setTopFilePathLabel === 'function') {
        setTopFilePathLabel(`${relPath} (diff)`);
      }
      try { window.diffEditor.layout(); } catch { /* ignore */ }

      return true;
    } catch (e) {
      console.warn('[FileSyncController] openDiffFromCachedContentInternal error:', e);
      return false;
    }
  }

  /**
   * Internal: Reverse-apply unified diff
   */
  function reverseApplyUnifiedDiffInternal(currentContent, diffContent) {
    try {
      const currentLines = currentContent.split('\n');
      const result = [];
      let currentLineIndex = 0;
      
      const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
      const diffLines = diffContent.split('\n');
      
      let i = 0;
      while (i < diffLines.length) {
        const line = diffLines[i];
        const match = line.match(hunkRegex);
        
        if (match) {
          const newStart = parseInt(match[3], 10);
          
          while (currentLineIndex < newStart - 1 && currentLineIndex < currentLines.length) {
            result.push(currentLines[currentLineIndex]);
            currentLineIndex++;
          }
          
          i++;
          while (i < diffLines.length) {
            const hunkLine = diffLines[i];
            
            if (hunkLine.match(hunkRegex) || 
                hunkLine.startsWith('diff ') || 
                hunkLine.startsWith('---') || 
                hunkLine.startsWith('+++') ||
                hunkLine.startsWith('index ')) {
              break;
            }
            
            if (hunkLine.startsWith('+')) {
              currentLineIndex++;
            } else if (hunkLine.startsWith('-')) {
              result.push(hunkLine.substring(1));
            } else if (hunkLine.startsWith(' ')) {
              result.push(currentLines[currentLineIndex] || hunkLine.substring(1));
              currentLineIndex++;
            } else if (hunkLine.startsWith('\\')) {
              // "\ No newline at end of file"
            } else if (hunkLine.trim() === '') {
              result.push(currentLines[currentLineIndex] || '');
              currentLineIndex++;
            }
            i++;
          }
          continue;
        }
        i++;
      }
      
      while (currentLineIndex < currentLines.length) {
        result.push(currentLines[currentLineIndex]);
        currentLineIndex++;
      }
      
      return result.join('\n');
    } catch (e) {
      console.warn('[FileSyncController] reverseApplyUnifiedDiffInternal error:', e);
      return null;
    }
  }

  /**
   * Close a file in the editor with cleanup
   */
  async function closeFile(absPath) {
    const normalized = normalizePath(absPath);
    
    // Close diff view if it's showing this file
    if (currentDiffState && currentDiffState.absPath === normalized) {
      clearDiffState();
      exitDiffView();
    }
    
    // Close the editor tab
    try {
      if (typeof closeEditorTab === 'function') {
        const tab = findTabByAbsPath(normalized);
        if (tab) {
          await closeEditorTab(tab.key);
        }
      }
    } catch (e) {
      console.warn('[FileSyncController] Failed to close file:', e);
    }
    
    updateFileState(normalized, { isOpenInEditor: false });
    emit(EVENT_FILE_CLOSED, { absPath: normalized });
  }

  /**
   * Reveal a file in the file explorer (scroll + highlight)
   */
  function revealFileInExplorer(filePath) {
    const absPath = resolveToAbsPath(filePath);
    if (!absPath) return;

    try {
      if (typeof explorerRevealAbsPath === 'function') {
        explorerRevealAbsPath(absPath);
      }
    } catch (e) {
      console.warn('[FileSyncController] Failed to reveal in explorer:', e);
    }

    emit(EVENT_EXPLORER_REVEAL, { absPath });
  }

  // ============================================================================
  // Checkpoint Restore - Cleanup orphaned tabs
  // ============================================================================

  /**
   * Handle checkpoint restore - clean up tabs for files that no longer exist
   */
  async function handleCheckpointRestore() {
    emit(EVENT_CHECKPOINT_RESTORE, {});

    // Wait a moment for git checkout to complete
    await new Promise(r => setTimeout(r, 100));

    // Get the list of open tabs
    const openTabs = getOpenEditorTabs();
    
    // Check each tab's file existence
    for (const tab of openTabs) {
      const absPath = tab.absPath;
      if (!absPath) continue;
      
      const exists = await checkFileExists(absPath);
      
      if (!exists) {
        // File was deleted by checkpoint restore - close the tab
        console.log('[FileSyncController] Closing tab for deleted file:', absPath);
        await closeFile(absPath);
        removeFileState(absPath);
      } else {
        // File exists - refresh its content if the tab is not dirty
        if (!isTabDirty(tab)) {
          try {
            await refreshTabContent(tab);
          } catch { /* ignore */ }
        }
      }
    }

    // Close diff view if the diff file no longer exists
    if (currentDiffState) {
      const diffExists = await checkFileExists(currentDiffState.absPath);
      if (!diffExists) {
        clearDiffState();
        exitDiffView();
      }
    }
  }

  /**
   * Check if a file exists on disk
   */
  async function checkFileExists(absPath) {
    try {
      if (!window.electronAPI) return false;
      const result = await window.electronAPI.getFileStats(absPath);
      return result && result.success === true;
    } catch {
      return false;
    }
  }

  /**
   * Refresh tab content from disk
   */
  async function refreshTabContent(tab) {
    if (!tab || !tab.absPath || !window.electronAPI) return;
    
    try {
      const result = await window.electronAPI.readFile(tab.absPath);
      if (result && result.success && tab.model) {
        const content = String(result.content || '');
        const currentContent = tab.model.getValue();
        if (currentContent !== content) {
          // Suppress dirty tracking during refresh
          window.suppressModelDirtyTracking = true;
          try {
            tab.model.setValue(content);
            tab.savedVersionId = tab.model.getAlternativeVersionId();
            tab.conflictOnDisk = false;
          } finally {
            window.suppressModelDirtyTracking = false;
          }
        }
      }
    } catch { /* ignore */ }
  }

  /**
   * Get list of open editor tabs
   */
  function getOpenEditorTabs() {
    try {
      if (typeof window.editorTabs !== 'undefined' && Array.isArray(window.editorTabs)) {
        return window.editorTabs.filter(Boolean);
      }
    } catch { /* ignore */ }
    return [];
  }

  /**
   * Find tab by absolute path
   */
  function findTabByAbsPath(absPath) {
    try {
      if (typeof window.findTabByAbsPath === 'function') {
        return window.findTabByAbsPath(absPath);
      }
    } catch { /* ignore */ }
    return null;
  }

  /**
   * Check if tab is dirty
   */
  function isTabDirty(tab) {
    try {
      if (typeof window.isTabDirty === 'function') {
        return window.isTabDirty(tab);
      }
      if (tab && tab.model && typeof tab.savedVersionId === 'number') {
        return tab.model.getAlternativeVersionId() !== tab.savedVersionId;
      }
    } catch { /* ignore */ }
    return false;
  }

  /**
   * Exit diff view (restore normal editor)
   */
  function exitDiffView() {
    try {
      if (typeof window.exitDiffView === 'function') {
        window.exitDiffView();
      } else {
        // Manual fallback
        const editorEl = document.getElementById('editor');
        const diffEditorEl = document.getElementById('diffEditor');
        if (editorEl) editorEl.style.display = 'block';
        if (diffEditorEl) diffEditorEl.style.display = 'none';
      }
    } catch { /* ignore */ }
  }

  // ============================================================================
  // AI Streaming File Tracking
  // ============================================================================

  /**
   * Track a file being created/modified by AI streaming
   */
  function markFileAsStreaming(absPath, sessionId) {
    updateFileState(absPath, {
      streamingSessionId: sessionId,
      existsOnDisk: true
    });
  }

  /**
   * Clear streaming flag for a file
   */
  function clearFileStreamingState(absPath) {
    updateFileState(absPath, {
      streamingSessionId: null
    });
  }

  /**
   * Check if any files are being streamed for a session
   */
  function getStreamingFilesForSession(sessionId) {
    const files = [];
    for (const [absPath, state] of fileStates) {
      if (state.streamingSessionId === sessionId) {
        files.push(absPath);
      }
    }
    return files;
  }

  // ============================================================================
  // Workspace Refresh Handling
  // ============================================================================

  /**
   * Handle workspace refresh (after file tree changes)
   */
  async function handleWorkspaceRefresh() {
    emit(EVENT_WORKSPACE_REFRESH, {});

    // Validate all open tabs
    const openTabs = getOpenEditorTabs();
    
    for (const tab of openTabs) {
      if (!tab || !tab.absPath) continue;
      
      // Skip files being streamed (they might not be on disk yet)
      const state = fileStates.get(tab.absPath);
      if (state && state.streamingSessionId) continue;
      
      const exists = await checkFileExists(tab.absPath);
      
      if (!exists) {
        // File was deleted externally - close the tab
        await closeFile(tab.absPath);
      }
    }
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  function normalizePath(p) {
    if (!p) return '';
    // Use existing normalizer if available
    if (typeof window.normalizeFsPath === 'function') {
      return window.normalizeFsPath(p);
    }
    // Fallback
    return String(p).trim().replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function resolveToAbsPath(p) {
    if (!p) return '';
    if (typeof window.resolveToWorkspaceAbsPath === 'function') {
      return normalizePath(window.resolveToWorkspaceAbsPath(p));
    }
    // Check if already absolute
    if (String(p).startsWith('/')) return normalizePath(p);
    // Try to make absolute using currentFolder
    if (window.currentFolder) {
      return normalizePath(`${window.currentFolder}/${p}`);
    }
    return normalizePath(p);
  }

  function getRelPath(absPath) {
    if (typeof window.getRelPath === 'function') {
      return window.getRelPath(absPath);
    }
    if (window.currentFolder && absPath.startsWith(window.currentFolder)) {
      return absPath.slice(window.currentFolder.length).replace(/^\/+/, '');
    }
    return absPath;
  }

  // ============================================================================
  // Initialization & Exports
  // ============================================================================

  function init() {
    // Wire up to existing systems

    // Listen for checkpoint restore
    const originalRestoreToCheckpoint = window.restoreToCheckpoint;
    if (typeof originalRestoreToCheckpoint === 'function') {
      window.restoreToCheckpoint = async function(...args) {
        const result = await originalRestoreToCheckpoint.apply(this, args);
        if (result !== false) {
          // Checkpoint was restored - clean up orphaned tabs
          await handleCheckpointRestore();
        }
        return result;
      };
    }

    // Listen for file tree refresh
    const originalRefreshFileTree = window.refreshFileTree;
    if (typeof originalRefreshFileTree === 'function') {
      window.refreshFileTree = async function(...args) {
        const result = await originalRefreshFileTree.apply(this, args);
        await handleWorkspaceRefresh();
        return result;
      };
    }

    console.log('[FileSyncController] Initialized');
  }

  // Export API
  window.FileSyncController = {
    // Events
    on,
    off,
    emit,
    EVENT_FILE_OPENED,
    EVENT_FILE_CLOSED,
    EVENT_FILE_SAVED,
    EVENT_FILE_DELETED,
    EVENT_FILE_RENAMED,
    EVENT_DIFF_OPENED,
    EVENT_DIFF_CLOSED,
    EVENT_EXPLORER_REVEAL,
    EVENT_CHECKPOINT_RESTORE,
    EVENT_WORKSPACE_REFRESH,

    // File operations
    openFile,
    openDiffView,
    closeFile,
    revealFileInExplorer,

    // Diff state
    getDiffState,
    setDiffState,
    clearDiffState,
    getDiffPseudoTab,

    // File state
    getFileState,
    updateFileState,
    removeFileState,

    // Checkpoint handling
    handleCheckpointRestore,

    // Streaming tracking
    markFileAsStreaming,
    clearFileStreamingState,
    getStreamingFilesForSession,

    // Initialization
    init
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Defer to let other modules load first
    setTimeout(init, 100);
  }

})();
