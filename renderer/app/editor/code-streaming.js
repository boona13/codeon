/**
 * Code Streaming Module
 * Handles real-time streaming of AI-generated code into the Monaco editor.
 * 
 * Uses immediate rendering with requestAnimationFrame batching for smooth updates
 * without the flicker of slow typing animation.
 */

(() => {
  'use strict';

  // Streaming state for each active file
  const streamingFiles = new Map(); // absPath -> { content, isStreaming, rafId, lastContent, tabReady }

  // Content cache for files that failed tab creation (persists across retries)
  const contentCache = new Map(); // absPath -> { content, fullContent, timestamp }

  // Track files that have been successfully auto-saved to prevent duplicate save attempts
  const recentlySavedFiles = new Map(); // absPath -> timestamp (ms)
  const RECENTLY_SAVED_EXPIRY_MS = 5000; // Consider a file "recently saved" for 5 seconds

  // Configuration
  const BATCH_UPDATE_THROTTLE_MS = 16; // ~60fps
  const TAB_READY_TIMEOUT_MS = 3000; // Max wait for tab creation
  const TAB_RETRY_INTERVAL_MS = 100; // How often to retry tab creation
  
  // Global scroll interval for continuous scrolling during streaming
  let scrollIntervalId = null;
  let lastScrolledPath = null;
  
  // Flag to suppress viewState restoration during streaming (exposed globally)
  window.__codeonStreamingScrollSuppressViewState = null;
  
  function startScrollInterval(absPath) {
    lastScrolledPath = absPath;
    window.__codeonStreamingScrollSuppressViewState = absPath;
    
    if (scrollIntervalId) {
      // Update target path if interval already running
      return;
    }
    
    scrollIntervalId = setInterval(() => {
      if (!lastScrolledPath) {
        stopScrollInterval();
        return;
      }
      
      const streamState = streamingFiles.get(lastScrolledPath);
      const isActive = streamState && (streamState.isStreaming || streamState.content);
      
      if (!isActive) {
        // Streaming finished - do one final scroll and stop
        forceScrollToBottom(lastScrolledPath);
        stopScrollInterval();
        return;
      }
      
      // Scroll to bottom - force it every interval
      forceScrollToBottom(lastScrolledPath);
    }, 50); // Scroll every 50ms during streaming for responsive follow-along
  }
  
  function stopScrollInterval() {
    if (scrollIntervalId) {
      clearInterval(scrollIntervalId);
      scrollIntervalId = null;
    }
    lastScrolledPath = null;
    window.__codeonStreamingScrollSuppressViewState = null;
  }
  
  /**
   * Force scroll to bottom - more aggressive approach
   */
  function forceScrollToBottom(absPath) {
    try {
      const tab = findEditorTabByPath(absPath);
      if (!tab || !tab.model) return;
      
      // Make sure this tab is active and the model is set
      const currentModel = window.editor?.getModel?.();
      if (currentModel !== tab.model) {
        // Need to activate this tab first (without restoring viewState)
        if (tab.key && typeof window.activateEditorTab === 'function') {
          window.activateEditorTab(tab.key).then(() => {
            requestAnimationFrame(() => doScroll(tab));
          }).catch(() => {});
        }
        return;
      }
      
      doScroll(tab);
    } catch (e) {
      console.warn('[CodeStreaming] forceScrollToBottom error:', e);
    }
  }
  
  function doScroll(tab) {
    if (!tab || !tab.model || !window.editor) return;
    
    try {
      const model = tab.model;
      const lc = model.getLineCount();
      const ll = Math.max(1, lc);
      const col = model.getLineMaxColumn(ll);
      
      // IMMEDIATE scroll during streaming - don't use smooth scrolling
      // Use scrollType 1 (immediate) for responsive feel during code generation
      
      // Method 1: Direct scroll to line (most reliable)
      try {
        window.editor.revealLine(ll, 1); // 1 = immediate scroll
      } catch { /* ignore */ }
      
      // Method 2: Set scroll position directly for maximum reliability
      try {
        const lineHeight = window.editor.getOption?.(window.monaco?.editor?.EditorOption?.lineHeight) || 19;
        const layoutInfo = window.editor.getLayoutInfo?.();
        const viewportHeight = layoutInfo?.height || 400;
        const contentHeight = lc * lineHeight;
        // Add extra buffer to ensure we're at the very bottom
        const scrollTop = Math.max(0, contentHeight - viewportHeight + lineHeight * 4);
        window.editor.setScrollTop(scrollTop, 1); // 1 = immediate
      } catch { /* ignore */ }
      
      // Method 3: Reveal the last line in center (backup)
      try {
        window.editor.revealLineInCenterIfOutsideViewport(ll, 1);
      } catch { /* ignore */ }
      
      // Set cursor at the end (optional - gives visual feedback of where AI is writing)
      try {
        window.editor.setPosition({ lineNumber: ll, column: col });
      } catch { /* ignore */ }
    } catch (e) {
      console.warn('[CodeStreaming] doScroll error:', e);
    }
  }

  function normalizeAbsPath(p) {
    try {
      if (!p) return '';
      const raw = String(p || '');
      const abs = (typeof window.resolveToWorkspaceAbsPath === 'function') ? window.resolveToWorkspaceAbsPath(raw) : raw;
      const norm = (typeof window.normalizeFsPath === 'function') ? window.normalizeFsPath(abs) : abs;
      return String(norm || '').trim();
    } catch {
      return String(p || '').trim();
    }
  }

  /**
   * Check if a file path is within the current workspace
   * Returns true if the path is in workspace or if we can't determine workspace
   */
  function isPathInWorkspace(absPath) {
    try {
      if (!absPath) return false;
      
      // Get workspace root - window.currentFolder is the primary source
      const workspaceRoot = window.currentFolder || 
                           window.__codeonWorkspacePath || 
                           window.workspacePath || 
                           (typeof window.getWorkspacePath === 'function' ? window.getWorkspacePath() : null);
      
      if (!workspaceRoot) {
        // Can't determine workspace, assume it's okay
        return true;
      }
      
      const normalizedPath = normalizeAbsPath(absPath);
      const normalizedRoot = normalizeAbsPath(workspaceRoot);
      
      return normalizedPath.startsWith(normalizedRoot);
    } catch {
      return true; // Assume okay on error
    }
  }

  /**
   * Cache content for a file (used when tab creation fails)
   */
  function cacheContent(absPath, content, fullContent = null) {
    if (!absPath || (!content && !fullContent)) return;
    
    const existing = contentCache.get(absPath) || {};
    contentCache.set(absPath, {
      content: content || existing.content || '',
      fullContent: fullContent || existing.fullContent || null,
      timestamp: Date.now()
    });
  }

  /**
   * Get cached content for a file
   */
  function getCachedContent(absPath) {
    if (!absPath) return null;
    const cached = contentCache.get(absPath);
    if (!cached) return null;
    
    // Return fullContent if available, otherwise content
    return cached.fullContent || cached.content || null;
  }

  /**
   * Clear cached content for a file
   */
  function clearCachedContent(absPath) {
    if (absPath) {
      contentCache.delete(absPath);
    }
  }

  /**
   * Mark a file as recently saved (to prevent duplicate save warnings)
   */
  function markFileAsSaved(absPath) {
    if (absPath) {
      recentlySavedFiles.set(absPath, Date.now());
    }
  }

  /**
   * Check if a file was recently saved (within RECENTLY_SAVED_EXPIRY_MS)
   */
  function wasFileRecentlySaved(absPath) {
    if (!absPath) return false;
    const savedAt = recentlySavedFiles.get(absPath);
    if (!savedAt) return false;
    const elapsed = Date.now() - savedAt;
    if (elapsed > RECENTLY_SAVED_EXPIRY_MS) {
      recentlySavedFiles.delete(absPath);
      return false;
    }
    return true;
  }

  /**
   * Clean up expired entries from recentlySavedFiles
   */
  function cleanupRecentlySavedFiles() {
    const now = Date.now();
    for (const [path, savedAt] of recentlySavedFiles.entries()) {
      if (now - savedAt > RECENTLY_SAVED_EXPIRY_MS) {
        recentlySavedFiles.delete(path);
      }
    }
  }

  function markStreamingPathActive(filePath) {
    try {
      if (!window.__codeonActiveCodeStreamingPaths || !(window.__codeonActiveCodeStreamingPaths instanceof Set)) {
        window.__codeonActiveCodeStreamingPaths = new Set();
      }
      const set = window.__codeonActiveCodeStreamingPaths;
      const abs = normalizeAbsPath(filePath);
      if (abs) set.add(abs);
      try {
        if (typeof window.getRelPath === 'function' && abs) {
          const rel = String(window.getRelPath(abs) || '').trim();
          if (rel) set.add(rel);
        }
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  function unmarkStreamingPathActive(filePath) {
    try {
      const set = window.__codeonActiveCodeStreamingPaths;
      if (!(set instanceof Set)) return;
      const abs = normalizeAbsPath(filePath);
      if (abs) set.delete(abs);
      try {
        if (typeof window.getRelPath === 'function' && abs) {
          const rel = String(window.getRelPath(abs) || '').trim();
          if (rel) set.delete(rel);
        }
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  // Rate limiting for file opening to prevent overwhelming the system
  const MAX_FILES_TO_OPEN_PER_RUN = 8; // Don't open more than this many files per run
  const FILE_OPEN_COOLDOWN_MS = 300; // Minimum time between opening files
  let filesOpenedThisRun = 0;
  let lastFileOpenedAt = 0;
  let currentRunId = null;
  const pendingFileOpens = []; // Queue of files waiting to be opened
  let fileOpenProcessorRunning = false;

  /**
   * Initialize code streaming handlers
   * 
   * NOTE: Live code streaming (typewriter effect) is DISABLED due to complexity.
   * However, we listen for file completion events to open files in the editor
   * after the SDK saves them - providing good UX without the streaming complexity.
   */
  function initCodeStreaming() {
    if (!window.electronAPI || !window.electronAPI.onClaudeSdkEvent) {
      console.warn('[CodeStreaming] window.electronAPI.onClaudeSdkEvent not available');
      return;
    }

    // Listen only for completion events to open files after they're saved
    window.electronAPI.onClaudeSdkEvent((event) => {
      // Track run ID to reset counter between runs
      if (event.type === 'tool_use_start' || event.type === 'session_start') {
        const newRunId = event.requestId || event.sessionId || null;
        if (newRunId && newRunId !== currentRunId) {
          currentRunId = newRunId;
          filesOpenedThisRun = 0;
          pendingFileOpens.length = 0; // Clear queue for new run
        }
      }
      
      if (event.type === 'code_stream_complete') {
        queueFileOpen(event);
      }
    });

    console.log('[CodeStreaming] Initialized (auto-open files on completion)');
  }

  /**
   * Queue a file open request (rate-limited)
   */
  function queueFileOpen(event) {
    const { filePath } = event;
    if (!filePath) return;
    
    // Check if we've already opened too many files this run
    if (filesOpenedThisRun >= MAX_FILES_TO_OPEN_PER_RUN) {
      console.log(`[CodeStreaming] Skipping file open (limit reached ${MAX_FILES_TO_OPEN_PER_RUN}): ${filePath}`);
      return;
    }
    
    // Add to queue
    pendingFileOpens.push(event);
    
    // Start processor if not running
    if (!fileOpenProcessorRunning) {
      processFileOpenQueue();
    }
  }

  /**
   * Process the file open queue with rate limiting
   */
  async function processFileOpenQueue() {
    if (fileOpenProcessorRunning) return;
    fileOpenProcessorRunning = true;
    
    try {
      while (pendingFileOpens.length > 0 && filesOpenedThisRun < MAX_FILES_TO_OPEN_PER_RUN) {
        const event = pendingFileOpens.shift();
        if (!event) continue;
        
        // Enforce cooldown between file opens
        const now = Date.now();
        const timeSinceLastOpen = now - lastFileOpenedAt;
        if (timeSinceLastOpen < FILE_OPEN_COOLDOWN_MS) {
          await new Promise(resolve => setTimeout(resolve, FILE_OPEN_COOLDOWN_MS - timeSinceLastOpen));
        }
        
        // Open the file
        await handleCodeStreamCompleteOpenFile(event);
        filesOpenedThisRun++;
        lastFileOpenedAt = Date.now();
      }
    } catch (e) {
      console.warn('[CodeStreaming] Error processing file open queue:', e);
    } finally {
      fileOpenProcessorRunning = false;
    }
  }

  /**
   * Handle code_stream_complete - open the file in the editor after SDK saves it
   * This provides good UX without the complexity of live streaming
   */
  async function handleCodeStreamCompleteOpenFile(event) {
    const { filePath } = event;
    if (!filePath) return;

    const absPath = normalizeAbsPath(filePath);
    if (!absPath) return;

    // Check if path is in workspace
    if (!isPathInWorkspace(absPath)) {
      console.log(`[CodeStreaming] File outside workspace, not opening: ${absPath}`);
      return;
    }

    console.log(`[CodeStreaming] Waiting for file to be saved: ${absPath}`);

    // Wait until the file is actually readable from disk (no arbitrary delays)
    const fileContent = await waitForFileOnDisk(absPath);
    if (fileContent === null) {
      console.warn(`[CodeStreaming] File not available on disk after retries: ${absPath}`);
      return;
    }

    console.log(`[CodeStreaming] File ready, opening: ${absPath} (${fileContent.length} chars)`);

    try {
      // Activate the Code tab first
      activateCodeTab();

      // Check if tab already exists
      let tab = findEditorTabByPath(absPath);
      
      if (tab && tab.model) {
        // Tab exists - update content from what we read from disk
        tab.model.setValue(fileContent);
        // Mark as saved (content matches disk)
        tab.savedVersionId = tab.model.getAlternativeVersionId();
        tab.conflictOnDisk = false;
        tab.lastDiskMtimeMs = Date.now();
        
        // Activate the tab
        if (typeof window.activateEditorTab === 'function') {
          await window.activateEditorTab(tab.key || absPath);
        }
      } else {
        // Open the file with the content we already read (no extra disk read needed)
        if (typeof window.openEditorTabFromFilePayload === 'function') {
          const language = detectLanguageFromPath(absPath);
          await window.openEditorTabFromFilePayload({
            absPath: absPath,
            content: fileContent,
            language
          });
        } else if (typeof window.openFile === 'function') {
          await window.openFile(absPath);
        }
        
        // Wait for tab to be created
        tab = await waitForTabCreation(absPath);
      }

      // Mark the tab as saved to prevent "unsaved" warnings
      if (tab && tab.model) {
        tab.savedVersionId = tab.model.getAlternativeVersionId();
        tab.conflictOnDisk = false;
        
        // Re-render tabs to update UI
        if (typeof window.renderEditorTabs === 'function') {
          window.renderEditorTabs();
        }
      }

      // Scroll to the end of the file to show recent changes
      if (tab && tab.model && window.editor) {
        const lineCount = tab.model.getLineCount();
        window.editor.revealLine(lineCount);
      }

    } catch (e) {
      console.warn('[CodeStreaming] Failed to open completed file:', e);
    }
  }

  /**
   * Wait until a file is readable from disk
   * Returns the file content, or null if not available after max retries
   */
  async function waitForFileOnDisk(absPath, maxRetries = 20, retryIntervalMs = 50) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (!window.electronAPI || typeof window.electronAPI.readFile !== 'function') {
          return null;
        }
        
        const result = await window.electronAPI.readFile(absPath);
        if (result && result.success && typeof result.content === 'string') {
          return result.content;
        }
      } catch { /* ignore and retry */ }
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }
    
    return null;
  }

  /**
   * Wait until a tab is created for a file
   * Returns the tab, or null if not created after max retries
   */
  async function waitForTabCreation(absPath, maxRetries = 10, retryIntervalMs = 50) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const tab = findEditorTabByPath(absPath);
      if (tab && tab.model) {
        return tab;
      }
      
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }
    
    return null;
  }

  /**
   * Handle tool_use_start event - prepare for streaming
   */
  function handleToolUseStart(event) {
    const { toolName, toolUseId } = event;
    
    // Only handle Write/Edit tools
    if (toolName !== 'Write' && toolName !== 'Edit') return;

    console.log(`[CodeStreaming] Tool use started: ${toolName} (${toolUseId})`);
  }

  /**
   * Handle code_stream_snapshot (provider-agnostic): we received the full content to be written
   * BEFORE the tool runs, so we can stream it even if no raw tool-input deltas exist.
   */
  async function handleCodeStreamSnapshot(event) {
    const { toolName, filePath, content } = event;
    if (!filePath || typeof content !== 'string') return;

    const absPath = normalizeAbsPath(filePath);
    if (!absPath) return;

    console.log(`[CodeStreaming] Snapshot for ${absPath}: ${content.length} chars`);
    
    // Cache content immediately (before any async operations)
    cacheContent(absPath, content, content);
    
    // Check if path is in workspace
    if (!isPathInWorkspace(absPath)) {
      console.warn(`[CodeStreaming] Snapshot file outside workspace: ${absPath}, will save directly`);
      // For files outside workspace, skip streaming UI and just save directly
      markStreamingPathActive(absPath);
      setTimeout(() => {
        autoSaveStreamedFile(absPath, content);
        unmarkStreamingPathActive(absPath);
      }, 100);
      return;
    }
    
    activateCodeTab();
    markStreamingPathActive(absPath);

    // CRITICAL: Wait for the file tab to actually be created before streaming
    const tabReady = await openFileForStreaming(absPath, toolName || 'Write', { forceEmpty: true });
    
    // Create streaming state with tabReady flag
    const streamState = {
      content: '',
      fullContent: content,
      lastRenderedContent: '',
      isStreaming: true, // Keep as streaming while progressive rendering
      rafId: null,
      filePath: absPath,
      toolName: toolName || 'Write',
      openedTab: tabReady,
      tabReady: tabReady
    };
    streamingFiles.set(absPath, streamState);
    
    if (!tabReady) {
      console.warn(`[CodeStreaming] Tab not ready for snapshot ${absPath}, content cached for auto-save`);
      // Still mark as streaming complete and trigger auto-save
      streamState.isStreaming = false;
      setTimeout(() => {
        streamingFiles.delete(absPath);
        unmarkStreamingPathActive(absPath);
        autoSaveStreamedFile(absPath, content);
      }, 100);
      return;
    }
    
    // Activate the tab after it's created
    const tab = findEditorTabByPath(absPath);
    if (tab && tab.key && typeof window.activateEditorTab === 'function') {
      await window.activateEditorTab(tab.key).catch(() => { /* ignore */ });
    }
    
    // Start continuous scroll interval for this file
    startScrollInterval(absPath);

    // Progressive streaming for snapshot: split into chunks and render progressively
    // This gives the appearance of streaming even though we have all content
    progressivelyRenderSnapshot(absPath, content);
  }

  /**
   * Progressively render a snapshot to give typewriter streaming appearance
   * Like a human typing - not too fast, not too slow
   */
  function progressivelyRenderSnapshot(absPath, fullContent) {
    // Typewriter-style configuration
    // Target: ~3000-5000 chars/second (feels like fast human typing)
    const CHARS_PER_SECOND = 4000;
    const BASE_CHUNK_SIZE = 20; // Base characters per tick
    const MIN_DELAY_MS = 8; // Minimum delay between chunks (~120 chunks/sec max)
    const MAX_DELAY_MS = 50; // Maximum delay between chunks
    
    // Calculate actual delay based on content length
    // Longer files = slightly faster to avoid painful waits
    const totalDuration = (fullContent.length / CHARS_PER_SECOND) * 1000;
    const tickCount = Math.ceil(fullContent.length / BASE_CHUNK_SIZE);
    const tickDelay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, totalDuration / tickCount));
    
    const streamState = streamingFiles.get(absPath);
    if (!streamState) return;
    
    // Check if tab is ready - if not, skip progressive rendering and just save
    if (!streamState.tabReady) {
      console.warn(`[CodeStreaming] Tab not ready for progressive render, saving directly: ${absPath}`);
      streamState.isStreaming = false;
      setTimeout(() => {
        streamingFiles.delete(absPath);
        unmarkStreamingPathActive(absPath);
        autoSaveStreamedFile(absPath, fullContent);
      }, 100);
      return;
    }

    let offset = 0;
    
    console.log(`[CodeStreaming] Starting typewriter for ${absPath}: ${fullContent.length} chars, ~${Math.round(tickDelay)}ms/chunk`);
    
    const renderNextChunk = () => {
      const currentState = streamingFiles.get(absPath);
      if (!currentState || !currentState.isStreaming) {
        // Streaming was stopped
        return;
      }
      
      // Check if tab is still ready
      if (!currentState.tabReady) {
        // Tab became unavailable, finish up
        currentState.isStreaming = false;
        streamingFiles.delete(absPath);
        unmarkStreamingPathActive(absPath);
        stopScrollInterval();
        autoSaveStreamedFile(absPath, fullContent);
        return;
      }
      
      if (offset >= fullContent.length) {
        // Done rendering - clean up and auto-save
        currentState.isStreaming = false;
        
        // Do one final scroll
        forceScrollToBottom(absPath);
        
        // Small delay before cleanup to allow final scroll
        setTimeout(() => {
          streamingFiles.delete(absPath);
          unmarkStreamingPathActive(absPath);
          stopScrollInterval();
          
          // Auto-save the completed file
          autoSaveStreamedFile(absPath, fullContent);
        }, 200);
        return;
      }

      // Adaptive chunk size based on content type
      // Newlines = smaller chunks (pause at line breaks for visual effect)
      let chunkSize = BASE_CHUNK_SIZE;
      const nextNewline = fullContent.indexOf('\n', offset);
      if (nextNewline !== -1 && nextNewline < offset + chunkSize) {
        // Stop at newline for visual line-by-line effect
        chunkSize = nextNewline - offset + 1;
      }
      
      const nextOffset = Math.min(offset + chunkSize, fullContent.length);
      currentState.content = fullContent.slice(0, nextOffset);
      flushEditorUpdate(absPath);
      offset = nextOffset;

      // Schedule next chunk with delay for typewriter effect
      setTimeout(renderNextChunk, tickDelay);
    };

    // Start the typewriter effect
    renderNextChunk();
  }

  /**
   * Handle code_stream_delta event - stream code incrementally
   */
  async function handleCodeStreamDelta(event) {
    const { toolName, filePath, contentDelta, fullContent } = event;

    if (!filePath) return;
    // Allow empty delta if we have fullContent
    if (!contentDelta && !fullContent) return;

    const absPath = normalizeAbsPath(filePath);
    if (!absPath) return;

    // Check if path is in workspace - warn but still try to cache
    if (!isPathInWorkspace(absPath)) {
      console.warn(`[CodeStreaming] File outside workspace: ${absPath}`);
      // Still cache content for potential auto-save via main process
      const newContent = fullContent || ((contentCache.get(absPath)?.content || '') + (contentDelta || ''));
      cacheContent(absPath, newContent, fullContent);
    }

    // Get or create streaming state for this file
    let streamState = streamingFiles.get(absPath);
    if (!streamState) {
      
      // Activate Code tab
      activateCodeTab();
      
      streamState = {
        content: '',
        lastRenderedContent: '',
        isStreaming: true,
        rafId: null,
        filePath: absPath,
        toolName,
        openedTab: false,
        tabReady: false, // Track if tab is actually ready
        tabCreationAttempted: false
      };
      streamingFiles.set(absPath, streamState);
      markStreamingPathActive(absPath);
      
      // CRITICAL: Wait for the file tab to actually be created before streaming
      streamState.tabCreationAttempted = true;
      const tabReady = await openFileForStreaming(absPath, toolName, { forceEmpty: toolName === 'Write' });
      streamState.tabReady = tabReady;
      
      if (!tabReady) {
        console.warn(`[CodeStreaming] Tab not ready for ${absPath}, will cache content for auto-save`);
        // Don't return - continue to cache content
      } else {
        streamState.openedTab = true;
        
        // Activate the tab
        const tab = findEditorTabByPath(absPath);
        if (tab && tab.key && typeof window.activateEditorTab === 'function') {
          await window.activateEditorTab(tab.key).catch(() => { /* ignore */ });
        }
        
        // Start continuous scroll interval for this file
        startScrollInterval(absPath);
      }
    }

    // Update the target content - ALWAYS update even if tab isn't ready
    if (fullContent) {
      streamState.content = fullContent;
      cacheContent(absPath, fullContent, fullContent);
    } else if (contentDelta) {
      streamState.content = (streamState.content || '') + contentDelta;
      cacheContent(absPath, streamState.content);
    }

    // Only schedule editor update if tab is ready
    if (streamState.tabReady) {
      scheduleEditorUpdate(absPath);
    } else {
      // Try to create tab again if enough content has accumulated
      if (!streamState.tabRetryScheduled && streamState.content.length > 100) {
        streamState.tabRetryScheduled = true;
        retryTabCreation(absPath, toolName);
      }
    }
  }

  /**
   * Retry tab creation in the background
   */
  async function retryTabCreation(absPath, toolName) {
    const streamState = streamingFiles.get(absPath);
    if (!streamState || streamState.tabReady) return;

    console.log(`[CodeStreaming] Retrying tab creation for ${absPath}`);
    
    const tabReady = await openFileForStreaming(absPath, toolName, { forceEmpty: toolName === 'Write' });
    
    if (tabReady && streamState) {
      streamState.tabReady = true;
      streamState.openedTab = true;
      
      // Now flush all cached content to the editor
      const tab = findEditorTabByPath(absPath);
      if (tab && tab.model && streamState.content) {
        try {
          tab.model.setValue(streamState.content);
          streamState.lastRenderedContent = streamState.content;
          console.log(`[CodeStreaming] Flushed cached content to tab: ${absPath}`);
        } catch (e) {
          console.warn(`[CodeStreaming] Failed to flush cached content:`, e);
        }
      }
      
      // Start scroll interval
      startScrollInterval(absPath);
      
      // Activate the tab
      if (tab && tab.key && typeof window.activateEditorTab === 'function') {
        await window.activateEditorTab(tab.key).catch(() => { /* ignore */ });
      }
    }
  }

  /**
   * Schedule a batched editor update using requestAnimationFrame
   */
  function scheduleEditorUpdate(absPath) {
    const streamState = streamingFiles.get(absPath);
    if (!streamState) return;

    // Already scheduled
    if (streamState.rafId) return;

    streamState.rafId = requestAnimationFrame(() => {
      streamState.rafId = null;
      flushEditorUpdate(absPath);
    });
  }

  /**
   * Flush pending content to the editor
   */
  function flushEditorUpdate(absPath) {
    const streamState = streamingFiles.get(absPath);
    if (!streamState) return;

    const targetContent = streamState.content || '';
    const lastContent = streamState.lastRenderedContent || '';

    // Only update if there's new content
    if (targetContent.length <= lastContent.length) return;

    // Get the new delta to append
    const delta = targetContent.slice(lastContent.length);
    if (!delta) return;

    // Check if tab is ready - if not, just cache and return silently
    if (!streamState.tabReady) {
      // Content is already cached, just update lastRenderedContent to track what we've "processed"
      // This prevents log spam while still tracking progress
      cacheContent(absPath, targetContent);
      return;
    }

    // Append to editor
    const tab = findEditorTabByPath(absPath);
    if (tab && tab.model) {
      try {
        const lineCount = tab.model.getLineCount();
        const lastLine = Math.max(1, lineCount);
        const lastColumn = tab.model.getLineMaxColumn(lastLine);
        
        if (window.monaco && window.monaco.Range && typeof tab.model.applyEdits === 'function') {
          tab.model.applyEdits([{
            range: new window.monaco.Range(lastLine, lastColumn, lastLine, lastColumn),
            text: delta,
            forceMoveMarkers: true
          }]);
        } else {
          // Fallback
          tab.model.setValue(targetContent);
        }

        // IMMEDIATE scroll after content update - don't wait for RAF
        // This ensures we follow the code as it's being written
        doScroll(tab);
        
        // Also schedule a follow-up scroll for any layout shifts
        requestAnimationFrame(() => {
          doScroll(tab);
        });
        
        streamState.lastRenderedContent = targetContent;
      } catch (e) {
        console.error('[CodeStreaming] Failed to update editor:', e);
      }
    } else {
      // Tab disappeared - mark as not ready and cache content
      streamState.tabReady = false;
      cacheContent(absPath, targetContent);
      
      // Only warn once per streaming session
      if (!streamState.tabMissingWarned) {
        streamState.tabMissingWarned = true;
        console.warn(`[CodeStreaming] Tab not available for ${absPath}, content cached for auto-save`);
      }
    }
  }

  /**
   * Handle code_stream_complete event - finalize the file
   */
  function handleCodeStreamComplete(event) {
    const { filePath, content } = event;

    if (!filePath) return;
    const absPath = normalizeAbsPath(filePath);
    if (!absPath) return;

    console.log(`[CodeStreaming] Stream complete for ${absPath}`);

    // Stop the scroll interval
    stopScrollInterval();
    
    // Check if this file was already saved recently (e.g., by handleCodeStreamSnapshot for cross-workspace files)
    // If so, skip redundant save to prevent "no content" warnings
    if (wasFileRecentlySaved(absPath)) {
      console.log(`[CodeStreaming] File was recently saved, skipping redundant save: ${absPath}`);
      // Still clean up streaming state if it exists
      const streamState = streamingFiles.get(absPath);
      if (streamState) {
        streamState.isStreaming = false;
        if (streamState.rafId) {
          cancelAnimationFrame(streamState.rafId);
          streamState.rafId = null;
        }
        streamingFiles.delete(absPath);
      }
      unmarkStreamingPathActive(absPath);
      clearCachedContent(absPath);
      return;
    }
    
    let finalContent = content;
    const streamState = streamingFiles.get(absPath);
    
    // Build final content from all available sources (in priority order)
    if (!finalContent) {
      // 1. Try stream state fullContent
      if (streamState && streamState.fullContent) {
        finalContent = streamState.fullContent;
      }
      // 2. Try stream state content
      else if (streamState && streamState.content) {
        finalContent = streamState.content;
      }
      // 3. Try content cache (critical for when tab creation failed)
      else {
        finalContent = getCachedContent(absPath);
      }
    }
    
    // Also update content cache with final content
    if (finalContent) {
      cacheContent(absPath, finalContent, finalContent);
    }
    
    if (streamState) {
      streamState.isStreaming = false;
      
      // Ensure final content is set
      if (finalContent) {
        streamState.content = finalContent;
      }
      
      // Cancel any pending RAF
      if (streamState.rafId) {
        cancelAnimationFrame(streamState.rafId);
        streamState.rafId = null;
      }
      
      // Only do final flush if tab was ready
      if (streamState.tabReady) {
        // Do a final flush to ensure all content is rendered
        flushEditorUpdate(absPath);
        
        // One final scroll to make sure we're at the bottom
        forceScrollToBottom(absPath);
      }
      
      // Clean up streaming state (but NOT content cache yet)
      streamingFiles.delete(absPath);
    }
    
    // Streaming finished: release hot-reload lock.
    unmarkStreamingPathActive(absPath);
    
    // Auto-save the file after streaming completes
    // Use a small delay to ensure Monaco model is fully synced
    setTimeout(() => {
      autoSaveStreamedFile(absPath, finalContent);
    }, 100);
  }

  /**
   * Auto-save a file after streaming completes
   * Includes retry logic and multiple fallback strategies
   */
  async function autoSaveStreamedFile(absPath, content, retryCount = 0) {
    const MAX_RETRIES = 5; // Increased retries
    const RETRY_DELAY_MS = 200; // Slightly longer delay
    
    try {
      // Only log on first attempt to reduce noise
      if (retryCount === 0) {
        console.log(`[CodeStreaming] Auto-save starting for ${absPath}`);
      }
      
      // Strategy 1: Get content from editor tab model
      const tab = findEditorTabByPath(absPath);
      let finalContent = null;
      let contentSource = null;
      
      if (tab && tab.model) {
        try {
          finalContent = tab.model.getValue();
          if (finalContent) {
            contentSource = 'tab model';
          }
        } catch (e) {
          // Silently continue to next strategy
        }
      }
      
      // Strategy 2: Use provided content if model content is empty/unavailable
      if (!finalContent && content) {
        finalContent = content;
        contentSource = 'provided content';
      }
      
      // Strategy 3: Check content cache (CRITICAL for when tab creation failed)
      if (!finalContent) {
        finalContent = getCachedContent(absPath);
        if (finalContent) {
          contentSource = 'content cache';
        }
      }
      
      // Strategy 4: Check streaming state for cached content (fallback)
      if (!finalContent) {
        const streamState = streamingFiles.get(absPath);
        if (streamState && (streamState.fullContent || streamState.content)) {
          finalContent = streamState.fullContent || streamState.content;
          contentSource = 'streaming state';
        }
      }
      
      // If still no content, handle retries or give up
      if (!finalContent) {
        // Check if file was recently saved - if so, this is not an error
        if (wasFileRecentlySaved(absPath)) {
          // File was already saved, this is just a delayed/duplicate completion event
          console.log(`[CodeStreaming] Auto-save not needed - file was recently saved: ${absPath}`);
          clearCachedContent(absPath);
          return;
        }
        
        // If we have retries left, wait and try again
        if (retryCount < MAX_RETRIES) {
          setTimeout(() => {
            autoSaveStreamedFile(absPath, content, retryCount + 1);
          }, RETRY_DELAY_MS);
          return;
        }
        
        // Final retry exhausted - log detailed debug info and give up
        console.warn(`[CodeStreaming] Auto-save skipped - no content available for ${absPath} after ${MAX_RETRIES + 1} attempts`);
        console.warn(`[CodeStreaming] Debug info: tab=${!!tab}, model=${!!(tab && tab.model)}, providedContent=${!!content}, inWorkspace=${isPathInWorkspace(absPath)}`);
        // Clean up content cache since we're giving up
        clearCachedContent(absPath);
        return;
      }
      
      console.log(`[CodeStreaming] Auto-saving from ${contentSource}: ${finalContent.length} chars`);
      
      // Save to disk via electronAPI
      if (window.electronAPI && typeof window.electronAPI.writeFile === 'function') {
        const result = await window.electronAPI.writeFile(absPath, finalContent, false);
        
        if (result && result.success) {
          // Mark the tab as saved (update savedVersionId) if tab exists
          if (tab && tab.model) {
            try {
              tab.savedVersionId = tab.model.getAlternativeVersionId();
              tab.conflictOnDisk = false;
              
              // Update last disk mtime if available
              if (result.stats && result.stats.modified) {
                tab.lastDiskMtimeMs = new Date(result.stats.modified).getTime();
              }
            } catch { /* ignore */ }
          }
          
          // Trigger UI update to remove dirty indicator
          if (typeof window.renderEditorTabs === 'function') {
            window.renderEditorTabs();
          }
          
          console.log(`[CodeStreaming] ✓ Auto-saved: ${absPath} (${finalContent.length} chars)`);
          
          // Mark file as recently saved to prevent duplicate save warnings
          markFileAsSaved(absPath);
          
          // Clean up content cache after successful save
          clearCachedContent(absPath);
          
          // Periodically clean up expired entries
          cleanupRecentlySavedFiles();
          
          // Emit event for FileSyncController
          if (window.FileSyncController && typeof window.FileSyncController.emit === 'function') {
            window.FileSyncController.emit('file_saved', { absPath, content: finalContent });
          }
        } else {
          console.error(`[CodeStreaming] ✗ Auto-save failed for ${absPath}:`, result?.error);
          
          // Retry on failure
          if (retryCount < MAX_RETRIES) {
            setTimeout(() => {
              autoSaveStreamedFile(absPath, finalContent, retryCount + 1);
            }, RETRY_DELAY_MS);
          } else {
            // Clean up on final failure
            clearCachedContent(absPath);
          }
        }
      } else {
        console.warn('[CodeStreaming] electronAPI.writeFile not available');
        clearCachedContent(absPath);
      }
    } catch (e) {
      console.error('[CodeStreaming] Auto-save error:', e);
      
      // Retry on exception
      if (retryCount < MAX_RETRIES) {
        setTimeout(() => {
          autoSaveStreamedFile(absPath, content, retryCount + 1);
        }, RETRY_DELAY_MS);
      } else {
        clearCachedContent(absPath);
      }
    }
  }

  /**
   * Activate the Code tab to show the editor
   */
  function activateCodeTab() {
    try {
      if (typeof window.activateCodeTab === 'function') {
        window.activateCodeTab({ persist: false });
      } else if (window.__codeonMiddleTabs && typeof window.__codeonMiddleTabs.activateCodeTab === 'function') {
        window.__codeonMiddleTabs.activateCodeTab({ persist: false });
      }
    } catch (e) {
      console.error('[CodeStreaming] Failed to activate Code tab:', e);
    }
  }

  /**
   * Open or create a file in the editor for streaming
   * CRITICAL: Returns a Promise that resolves when the tab is actually ready
   */
  async function openFileForStreaming(filePath, toolName, { forceEmpty = false } = {}) {
    try {
      // For Write tool, start with empty content
      // For Edit tool, load existing content
      const initialContent = (forceEmpty === true) ? '' : (toolName === 'Edit' ? null : '');
      
      if (typeof window.openEditorTabFromFilePayload === 'function') {
        const language = detectLanguageFromPath(filePath);
        await window.openEditorTabFromFilePayload({
          absPath: filePath,
          content: initialContent !== null ? initialContent : undefined,
          language
        });
      } else if (typeof window.openFile === 'function') {
        await window.openFile(filePath);
      }
      
      // CRITICAL: Wait for the tab to actually exist in the DOM
      const maxWait = 2000; // Max 2 seconds
      const checkInterval = 50;
      let waited = 0;
      
      while (waited < maxWait) {
        const tab = findEditorTabByPath(filePath);
        if (tab && tab.model) {
          console.log(`[CodeStreaming] Tab ready for ${filePath} after ${waited}ms`);
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;
      }
      
      console.warn(`[CodeStreaming] Tab not ready after ${maxWait}ms for ${filePath}`);
      return false;
    } catch (e) {
      console.error('[CodeStreaming] Failed to open file:', e);
      return false;
    }
  }


  /**
   * Get current editor content for a file
   */
  function getCurrentEditorContent(filePath) {
    try {
      const absPath = normalizeAbsPath(filePath);
      const tab = findEditorTabByPath(absPath);
      if (tab && tab.model) {
        return tab.model.getValue();
      }
    } catch (e) {
      // Ignore
    }
    return '';
  }

  /**
   * Find editor tab by file path
   */
  function findEditorTabByPath(filePath) {
    try {
      const absPath = normalizeAbsPath(filePath);
      if (typeof window.findTabByAbsPath === 'function') {
        return window.findTabByAbsPath(absPath);
      }
      // Fallback: check global tabs array
      if (Array.isArray(window.editorTabs)) {
        return window.editorTabs.find(t => t.absPath === absPath);
      }
    } catch (e) {
      // Ignore
    }
    return null;
  }

  /**
   * Detect Monaco language from file path
   */
  function detectLanguageFromPath(filePath) {
    if (!filePath || typeof filePath !== 'string') return 'plaintext';
    
    const ext = filePath.split('.').pop().toLowerCase();
    const langMap = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      sh: 'shell',
      bash: 'shell',
      sql: 'sql',
      txt: 'plaintext'
    };
    
    return langMap[ext] || 'plaintext';
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCodeStreaming);
  } else {
    initCodeStreaming();
  }

  // Expose for debugging
  window.__codeonCodeStreaming = {
    streamingFiles,
    contentCache,
    recentlySavedFiles,
    initCodeStreaming,
    isPathInWorkspace,
    getCachedContent,
    clearCachedContent,
    wasFileRecentlySaved,
    markFileAsSaved
  };
})();
