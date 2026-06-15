/**
 * Timeline Integration - Bridges ContentBlockTimeline with Codeon's existing systems.
 * 
 * This module replaces the flawed dual-processing path with a single, correct pipeline
 * that routes all stream events through ContentBlockTimeline.
 * 
 * Key features:
 * 1. Single event processing path (no more dual text_delta handling)
 * 2. Block-ordered timeline (not position-based)
 * 3. INCREMENTAL DOM updates (no flickering, no re-rendering per word)
 * 4. Tool blocks inserted at natural boundaries (between content blocks, not mid-text)
 */

(function() {
  'use strict';

  // Minimum interval between renders (ms) to prevent flickering
  const RENDER_THROTTLE_MS = 100;

  /**
   * Per-request timeline state
   */
  const requestTimelines = new Map(); // requestId -> { timeline, state, domState }

  /**
   * Initialize a timeline for a new request.
   * Call this when starting a new Claude SDK request.
   * 
   * @param {string} requestId - Unique request identifier
   * @param {string} sessionId - UI session ID
   * @param {Object} options - Configuration options
   */
  function initializeTimeline(requestId, sessionId, options = {}) {
    if (!requestId) return null;

    // Clean up any existing timeline for this request
    cleanupTimeline(requestId);

    const timeline = new window.ContentBlockTimeline({
      onMessageUpdate: (key, message) => {
        // Called when the message content changes - schedule throttled render
        scheduleTimelineRender(requestId, sessionId);
      },
      onToolExecuted: (key, block) => {
        // Called when a tool_use block completes
        handleToolBlockComplete(requestId, sessionId, block);
      }
    });

    const state = {
      sessionId,
      lastRenderAt: 0,
      renderPending: false,
      renderTimer: null,
      toolBlocks: [], // Track executed tools for legacy compatibility
      diffBlocks: [],  // Track file diffs for inline previews
      executedTools: [], // Track tool_executed events for timeline rendering
      thinkingStartMs: null,
      lastInjectedFinalText: '',
      isActive: true,
      finalized: false  // Guard against double finalization
    };

    // DOM state for incremental updates
    const domState = {
      renderedBlocks: new Map(), // blockIndex -> { element, contentLen, changeId }
      renderedDiffs: new Map(),  // diffKey -> element
      renderedExecutedTools: new Map(), // toolKey -> element
      lastBlockCount: 0,
      containerRef: null
    };

    requestTimelines.set(requestId, { timeline, state, domState });
    return { timeline, state };
  }

  /**
   * Process a stream_event through the timeline.
   * This is the SINGLE entry point for all Anthropic events.
   * 
   * @param {string} requestId - Request identifier
   * @param {Object} event - The Anthropic SSE event
   * @param {string|null} parentToolUseId - For nested tool calls
   */
  function processTimelineEvent(requestId, event, parentToolUseId = null) {
    const entry = requestTimelines.get(requestId);
    if (!entry || !entry.timeline || !entry.state.isActive) {
      console.warn('[TimelineEvent] Skipping - no entry or inactive:', requestId, event?.type);
      return;
    }

    const { timeline, state } = entry;

    // Process through the proper event handler
    timeline.processEvent(event, parentToolUseId);

    // Track thinking start time for duration display
    if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
      if (!state.thinkingStartMs) {
        state.thinkingStartMs = Date.now();
      }
    }

    // Schedule render (throttled)
    scheduleTimelineRender(requestId, state.sessionId);
  }

  /**
   * Inject final text into the timeline when stream events didn't include text blocks.
   * This prevents empty completions for some non-Claude models.
   */
  function injectFinalText(requestId, text, options = {}) {
    const entry = requestTimelines.get(requestId);
    if (!entry || !entry.timeline || !entry.state?.isActive) return false;

    const finalText = String(text || '');
    if (!finalText.trim()) return false;

    if (entry.state.lastInjectedFinalText === finalText) return false;

    const message = entry.timeline.getMessage(null);
    if (!message) return false;

    const existingText = (typeof message.getText === 'function') ? String(message.getText() || '') : '';
    const shouldForce = options.force === true;
    if (!shouldForce) {
      if (existingText && (existingText.includes(finalText) || finalText.includes(existingText))) {
        return false;
      }
    }

    const blocks = (typeof message.getOrderedBlocks === 'function')
      ? message.getOrderedBlocks()
      : (Array.isArray(message.blocks) ? message.blocks : []);
    let nextIndex = 0;
    if (Array.isArray(blocks) && blocks.length > 0) {
      for (const b of blocks) {
        const idx = (b && typeof b.index === 'number') ? b.index : -1;
        if (idx >= nextIndex) nextIndex = idx + 1;
      }
    }

    try {
      entry.timeline.processEvent({
        type: 'content_block_start',
        index: nextIndex,
        content_block: { type: 'text', text: '' }
      }, null);
      entry.timeline.processEvent({
        type: 'content_block_delta',
        index: nextIndex,
        delta: { type: 'text_delta', text: finalText }
      }, null);
      entry.timeline.processEvent({
        type: 'content_block_stop',
        index: nextIndex
      }, null);
      entry.state.lastInjectedFinalText = finalText;
      scheduleTimelineRender(requestId, entry.state.sessionId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Handle tool block completion - bridges to legacy system
   */
  function handleToolBlockComplete(requestId, sessionId, block) {
    const entry = requestTimelines.get(requestId);
    if (!entry) return;

    const { state } = entry;

    // Track for legacy compatibility
    state.toolBlocks.push({
      toolName: block.toolName,
      toolUseId: block.toolId,
      input: block.toolInput,
      timestamp: Date.now(),
      blockIndex: block.index
    });
  }

  /**
   * Add a diff block from file_diff event.
   * These are displayed inline in the timeline.
   */
  function addDiffBlock(requestId, diffData) {
    const entry = requestTimelines.get(requestId);
    if (!entry) return;

    const { state, timeline } = entry;
    const message = timeline.getMessage();
    
    // Calculate position based on current block count
    const blockIndex = message ? message.blocks.length : 0;

    state.diffBlocks.push({
      ...diffData,
      blockIndex,
      timestamp: Date.now(),
      diffKey: `diff_${blockIndex}_${Date.now()}`
    });

    // Schedule render to show the diff
    scheduleTimelineRender(requestId, state.sessionId);
  }

  /**
   * Add a tool_executed event to the timeline.
   * These are SDK-level tool executions (Bash, Read, Write, etc.) that run
   * inside meta-tools like Task. They need separate tracking from content blocks.
   */
  function addExecutedTool(requestId, toolData) {
    const entry = requestTimelines.get(requestId);
    if (!entry) return;

    const { state, timeline } = entry;
    const message = timeline.getMessage();
    
    // Calculate position based on current block count
    const blockIndex = message ? message.blocks.length : 0;
    
    // Create a unique key for this tool execution
    const toolKey = `tool_${toolData.toolName}_${toolData.toolUseId || Date.now()}_${state.executedTools.length}`;
    
    state.executedTools.push({
      toolName: toolData.toolName || 'Tool',
      toolUseId: toolData.toolUseId || null,
      preview: toolData.preview || '',
      receipt: toolData.receipt || null,
      input: toolData.input || null,
      blockIndex,
      timestamp: Date.now(),
      toolKey,
      isComplete: true // tool_executed means it's done
    });

    // Schedule render to show the tool
    scheduleTimelineRender(requestId, state.sessionId);
  }

  /**
   * Schedule a timeline render (throttled to prevent flickering)
   */
  function scheduleTimelineRender(requestId, sessionId) {
    const entry = requestTimelines.get(requestId);
    if (!entry) {
      console.warn('[TimelineRender] scheduleRender - no entry for:', requestId);
      return;
    }

    const { state } = entry;
    
    // Check session is current
    if (typeof window.currentSessionId !== 'undefined' && sessionId !== window.currentSessionId) {
      console.warn('[TimelineRender] scheduleRender - session mismatch:', sessionId, 'vs', window.currentSessionId);
      return; // Don't render if not the active session
    }

    // If already pending, don't schedule again
    if (state.renderPending) {
      // Don't log this - too noisy
      return;
    }

    const now = Date.now();
    const timeSinceLastRender = now - state.lastRenderAt;

    if (timeSinceLastRender >= RENDER_THROTTLE_MS) {
      // Enough time passed - render immediately on next RAF
      state.renderPending = true;
      requestAnimationFrame(() => {
        state.renderPending = false;
        state.lastRenderAt = Date.now();
        renderTimelineIncremental(requestId, sessionId, { finalize: false });
      });
    } else {
      // Too soon - schedule for later
      state.renderPending = true;
      const delay = RENDER_THROTTLE_MS - timeSinceLastRender;
      state.renderTimer = setTimeout(() => {
        state.renderTimer = null;
        requestAnimationFrame(() => {
          state.renderPending = false;
          state.lastRenderAt = Date.now();
          renderTimelineIncremental(requestId, sessionId, { finalize: false });
        });
      }, delay);
    }
  }

  /**
   * INCREMENTAL render - only updates what changed, never clears the container
   */
  function renderTimelineIncremental(requestId, sessionId, options = {}) {
    const entry = requestTimelines.get(requestId);
    if (!entry) return;

    const { timeline, state, domState } = entry;
    const message = timeline.getMessage();
    if (!message) return;

    const isFinalize = options.finalize === true;

    // Get or create the streaming bubble
    const streamingDiv = ensureStreamingBubble(sessionId);
    if (!streamingDiv) return;

    const contentEl = streamingDiv.querySelector('.message-content');
    if (!contentEl) return;

    // Store container reference
    domState.containerRef = contentEl;

    // Remove placeholder if we have content
    const blocks = message.getOrderedBlocks();
    
    if (blocks.length > 0) {
      const ph = contentEl.querySelector('[data-stream-placeholder="1"]');
      if (ph) ph.remove();
    }

    // INCREMENTAL UPDATE: Only update changed blocks, append new ones
    // KEY UX FIX: The active streaming text block is ALWAYS rendered at the BOTTOM
    // so users can always see the latest content being typed
    
    const diffBlocks = state.diffBlocks || [];
    const diffsByIndex = new Map();
    for (const diff of diffBlocks) {
      const idx = diff.blockIndex || 0;
      if (!diffsByIndex.has(idx)) diffsByIndex.set(idx, []);
      diffsByIndex.get(idx).push(diff);
    }

    // Separate blocks into:
    // 1. Completed blocks (render in order)
    // 2. Active streaming text block (render at the very end)
    const completedBlocks = [];
    let activeStreamingTextBlock = null;
    let activeStreamingTextIndex = -1;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      // The active streaming block is an incomplete text block
      if (block.type === 'text' && !block.isComplete) {
        // Keep track of the LAST incomplete text block (the active one)
        activeStreamingTextBlock = block;
        activeStreamingTextIndex = i;
      } else {
        completedBlocks.push({ block, index: i });
      }
    }

    // Process completed blocks first (in order)
    const hasNonEmptyThinking = blocks.some((b) => b && b.type === 'thinking' && String(b.thinking || '').trim());
    const hasEmptyThinkingPlaceholder = !!contentEl.querySelector('[data-empty-thinking="1"]');
    let emptyThinkingPlaceholderUsed = hasEmptyThinkingPlaceholder;
    for (const { block, index } of completedBlocks) {
      let existingEntry = domState.renderedBlocks.get(index);
      if (existingEntry && existingEntry.type && existingEntry.type !== block.type) {
        // Block type changed (e.g., thinking -> text); replace the DOM element.
        if (existingEntry.element && existingEntry.element.parentNode === contentEl) {
          existingEntry.element.remove();
        }
        domState.renderedBlocks.delete(index);
        existingEntry = null;
      }
      const isThinking = block && block.type === 'thinking';
      const isEmptyThinking = isThinking && !String(block?.thinking || '').trim();
      if (isThinking && isEmptyThinking) {
        // Never keep an empty "Thought" block after completion.
        if (block.isComplete) {
          if (existingEntry?.element && existingEntry.element.parentNode === contentEl) {
            existingEntry.element.remove();
          }
          if (existingEntry) domState.renderedBlocks.delete(index);
          continue;
        }
        // If we have any real thinking content, suppress empty placeholders.
        if (hasNonEmptyThinking) {
          if (existingEntry?.element && existingEntry.element.parentNode === contentEl) {
            existingEntry.element.remove();
          }
          if (existingEntry) domState.renderedBlocks.delete(index);
          continue;
        }
        // Allow only a single empty "Thinking…" placeholder.
        if (emptyThinkingPlaceholderUsed && !existingEntry) {
          continue;
        }
        emptyThinkingPlaceholderUsed = true;
      }
      
      // Insert any diffs that should appear before this block
      const diffsHere = diffsByIndex.get(index) || [];
      for (const diff of diffsHere) {
        if (!domState.renderedDiffs.has(diff.diffKey)) {
          const diffEl = createDiffElement(diff);
          if (diffEl) {
            // Insert before the active streaming block if it exists, otherwise append
            const activeEl = domState.renderedBlocks.get(activeStreamingTextIndex)?.element;
            if (activeEl && activeEl.parentNode === contentEl) {
              contentEl.insertBefore(diffEl, activeEl);
            } else if (existingEntry && existingEntry.element && existingEntry.element.parentNode === contentEl) {
              contentEl.insertBefore(diffEl, existingEntry.element);
            } else {
              contentEl.appendChild(diffEl);
            }
            domState.renderedDiffs.set(diff.diffKey, diffEl);
          }
        }
      }

      if (!existingEntry) {
        // New block - create and insert BEFORE the active streaming block
        const el = createBlockElement(block, !isFinalize, state.thinkingStartMs);
        if (el) {
          const activeEl = domState.renderedBlocks.get(activeStreamingTextIndex)?.element;
          if (activeEl && activeEl.parentNode === contentEl) {
            // Insert before the active streaming text block
            contentEl.insertBefore(el, activeEl);
          } else {
            contentEl.appendChild(el);
          }
          domState.renderedBlocks.set(index, {
            element: el,
            contentLen: getBlockContentLength(block),
            changeId: block.changeId,
            type: block.type
          });
        }
      } else if (existingEntry.changeId !== block.changeId) {
        // Existing block changed - UPDATE IN PLACE
        updateBlockElementInPlace(existingEntry.element, block, !isFinalize, state.thinkingStartMs);
        existingEntry.contentLen = getBlockContentLength(block);
        existingEntry.changeId = block.changeId;
      }
    }

    // NESTED TOOL BLOCKS: Render tool_use blocks from ALL message contexts (nested tool calls)
    // This is critical for showing tools like Bash, Read, Glob that run inside meta-tools like Task
    if (typeof timeline.getAllToolBlocks === 'function') {
      const allToolBlocks = timeline.getAllToolBlocks();
      const nestedToolBlocks = allToolBlocks.filter(t => t.parentToolUseId !== null);
      
      // Track nested tools separately using a composite key
      if (!domState.renderedNestedTools) {
        domState.renderedNestedTools = new Map();
      }
      
      for (const toolInfo of nestedToolBlocks) {
        const { block, contextKey, parentToolUseId } = toolInfo;
        const toolKey = `${contextKey}_${block.index}_${block.toolId || block.toolName}`;
        
        const existingEntry = domState.renderedNestedTools.get(toolKey);
        
        if (!existingEntry) {
          // New nested tool - create element
          const el = createBlockElement(block, !isFinalize && !block.isComplete, state.thinkingStartMs);
          if (el) {
            // Mark as nested tool for styling
            el.dataset.nestedTool = 'true';
            el.dataset.parentToolUseId = parentToolUseId;
            
            // Insert before the active streaming text block if it exists
            const activeEl = domState.renderedBlocks.get(activeStreamingTextIndex)?.element;
            if (activeEl && activeEl.parentNode === contentEl) {
              contentEl.insertBefore(el, activeEl);
            } else {
              contentEl.appendChild(el);
            }
            
            domState.renderedNestedTools.set(toolKey, {
              element: el,
              changeId: block.changeId,
              isComplete: block.isComplete
            });
          }
        } else if (existingEntry.changeId !== block.changeId || existingEntry.isComplete !== block.isComplete) {
          // Update existing nested tool element
          updateBlockElementInPlace(existingEntry.element, block, !isFinalize && !block.isComplete, state.thinkingStartMs);
          existingEntry.changeId = block.changeId;
          existingEntry.isComplete = block.isComplete;
        }
      }
    }

    // EXECUTED TOOLS: Render tool_executed events (SDK-level tool executions)
    // These are tools like Bash, Read, Write that run inside meta-tools like Task
    const executedTools = state.executedTools || [];
    for (const tool of executedTools) {
      const { toolKey } = tool;
      
      if (!domState.renderedExecutedTools.has(toolKey)) {
        // Create element for executed tool
        const el = createExecutedToolElement(tool);
        if (el) {
          // Insert before the active streaming text block if it exists
          const activeEl = domState.renderedBlocks.get(activeStreamingTextIndex)?.element;
          if (activeEl && activeEl.parentNode === contentEl) {
            contentEl.insertBefore(el, activeEl);
          } else {
            contentEl.appendChild(el);
          }
          
          domState.renderedExecutedTools.set(toolKey, el);
        }
      }
    }

    // Insert any trailing diffs (before the active streaming block)
    const trailingDiffs = diffsByIndex.get(blocks.length) || [];
    for (const diff of trailingDiffs) {
      if (!domState.renderedDiffs.has(diff.diffKey)) {
        const diffEl = createDiffElement(diff);
        if (diffEl) {
          const activeEl = domState.renderedBlocks.get(activeStreamingTextIndex)?.element;
          if (activeEl && activeEl.parentNode === contentEl) {
            contentEl.insertBefore(diffEl, activeEl);
          } else {
            contentEl.appendChild(diffEl);
          }
          domState.renderedDiffs.set(diff.diffKey, diffEl);
        }
      }
    }

    // Thinking blocks: move to the bottom (just before active streaming text, if any)
    const activeElForThinking = domState.renderedBlocks.get(activeStreamingTextIndex)?.element;
    const thinkingEntries = Array.from(domState.renderedBlocks.entries())
      .filter(([, entry]) => entry && entry.type === 'thinking' && entry.element && entry.element.parentNode === contentEl)
      .sort((a, b) => a[0] - b[0]);
    for (const [, entry] of thinkingEntries) {
      if (activeElForThinking && activeElForThinking.parentNode === contentEl) {
        contentEl.insertBefore(entry.element, activeElForThinking);
      } else {
        contentEl.appendChild(entry.element);
      }
    }

    // NOW render the active streaming text block at the VERY END (bottom)
    if (activeStreamingTextBlock) {
      let existingEntry = domState.renderedBlocks.get(activeStreamingTextIndex);
      if (existingEntry && existingEntry.type && existingEntry.type !== activeStreamingTextBlock.type) {
        if (existingEntry.element && existingEntry.element.parentNode === contentEl) {
          existingEntry.element.remove();
        }
        domState.renderedBlocks.delete(activeStreamingTextIndex);
        existingEntry = null;
      }
      
      if (!existingEntry) {
        // New streaming text block - create and append at the very end
        const el = createBlockElement(activeStreamingTextBlock, true, state.thinkingStartMs);
        if (el) {
          contentEl.appendChild(el);
          domState.renderedBlocks.set(activeStreamingTextIndex, {
            element: el,
            contentLen: getBlockContentLength(activeStreamingTextBlock),
            changeId: activeStreamingTextBlock.changeId,
            type: activeStreamingTextBlock.type
          });
        }
      } else {
        // Ensure the active streaming block is at the end
        if (existingEntry.element && existingEntry.element.parentNode === contentEl) {
          // Move to end if not already there
          if (existingEntry.element.nextSibling) {
            contentEl.appendChild(existingEntry.element);
          }
        }
        
        // Update content if changed
        if (existingEntry.changeId !== activeStreamingTextBlock.changeId) {
          updateBlockElementInPlace(existingEntry.element, activeStreamingTextBlock, true, state.thinkingStartMs);
          existingEntry.contentLen = getBlockContentLength(activeStreamingTextBlock);
          existingEntry.changeId = activeStreamingTextBlock.changeId;
        }
      }
    }

    domState.lastBlockCount = blocks.length;

    // Update runState for legacy compatibility
    updateLegacyRunState(sessionId, message, state);

    // Scroll to bottom (only if near bottom already to not disrupt user scrolling)
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) {
      const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 150;
      if (isNearBottom && typeof window.smartScrollToBottom === 'function') {
        window.smartScrollToBottom(messagesContainer);
      }
    }
  }

  /**
   * Get content length for a block (for change detection)
   */
  function getBlockContentLength(block) {
    switch (block.type) {
      case 'text': return (block.text || '').length;
      case 'thinking': return (block.thinking || '').length;
      case 'tool_use':
      case 'server_tool_use': return block.isComplete ? 1 : 0;
      default: return 0;
    }
  }

  /**
   * UPDATE a block element IN PLACE (no DOM replacement, just content update)
   */
  function updateBlockElementInPlace(element, block, isStreaming, thinkingStartMs) {
    if (!element) return;

    switch (block.type) {
      case 'text': {
        const textContainer = element.querySelector('.cc-text-block');
        if (textContainer) {
          const text = block.text || '';
          // Only update if content actually changed
          const newHtml = formatTextContent(text, isStreaming);
          if (textContainer.innerHTML !== newHtml) {
            textContainer.innerHTML = newHtml;
          }
        }
        break;
      }

      case 'thinking': {
        const thinkingContent = element.querySelector('.cc-thinking-content-inline');
        if (thinkingContent) {
          const thinking = block.thinking || '';
          const newHtml = formatThinkingContent(thinking, isStreaming);
          if (thinkingContent.innerHTML !== newHtml) {
            thinkingContent.innerHTML = newHtml;
          }
        }
        // Update label if completed
        const label = element.querySelector('.cc-thinking-label');
        if (label && block.isComplete) {
          const durationMs = thinkingStartMs ? (Date.now() - thinkingStartMs) : null;
          const durationText = durationMs ? `${Math.round(durationMs / 1000)}s` : '';
          const newLabel = `Thought${durationText ? ` for ${durationText}` : ''}`;
          if (label.textContent !== newLabel) {
            label.textContent = newLabel;
          }
        }
        break;
      }

      case 'tool_use':
      case 'server_tool_use': {
        // Update status if changed
        if (block.isComplete) {
          element.classList.remove('cc-pending');
          element.classList.add('cc-success');
          const status = element.querySelector('.cc-tool-status');
          if (status && status.textContent !== '✓') {
            status.textContent = '✓';
          }
          // Update detail if we now have input
          const detailEl = element.querySelector('.cc-tool-detail');
          if (detailEl && block.toolInput) {
            const { detail } = formatToolDisplay(block.toolName, block.toolInput);
            if (detail && detailEl.textContent !== detail) {
              detailEl.textContent = detail;
            }
          }
        }
        break;
      }
    }
  }

  /**
   * Create a DOM element for a content block (for new blocks only)
   */
  function createBlockElement(block, isStreaming, thinkingStartMs) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cc-content-block cc-success';
    wrapper.dataset.blockType = block.type;
    wrapper.dataset.blockIndex = String(block.index);

    switch (block.type) {
      case 'text': {
        const text = block.text || '';
        if (!text.trim() && isStreaming) {
          // Don't render empty text blocks during streaming
          return null;
        }
        wrapper.innerHTML = `<div class="cc-text-block">${formatTextContent(text, isStreaming)}</div>`;
        break;
      }

      case 'thinking': {
        const thinking = block.thinking || '';
        const isComplete = block.isComplete;
        const durationMs = thinkingStartMs ? (Date.now() - thinkingStartMs) : null;
        const durationText = durationMs && isComplete ? `${Math.round(durationMs / 1000)}s` : '';
        if (block.data && block.data.redacted === true) {
          wrapper.dataset.redactedThinking = '1';
        }
        if (!thinking.trim()) {
          wrapper.dataset.emptyThinking = '1';
        }

        wrapper.classList.remove('cc-success');
        wrapper.classList.add('cc-thinking');
        wrapper.innerHTML = `
          <div class="cc-thinking-block">
            <div class="cc-thinking-header">
              <span class="cc-thinking-label">${isComplete ? 'Thought' : 'Thinking…'}${durationText ? ` for ${durationText}` : ''}</span>
              <button class="cc-thinking-toggle" title="Toggle thinking">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            </div>
            <div class="cc-thinking-content-inline">${formatThinkingContent(thinking, isStreaming)}</div>
          </div>
        `;

        // Wire up toggle behavior
        const toggle = wrapper.querySelector('.cc-thinking-toggle');
        const content = wrapper.querySelector('.cc-thinking-content-inline');
        if (toggle && content) {
          toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            content.classList.toggle('collapsed');
            toggle.classList.toggle('collapsed');
          });
        }
        break;
      }

      case 'tool_use':
      case 'server_tool_use': {
        const toolName = block.toolName || 'Tool';
        const isComplete = block.isComplete;
        const input = block.toolInput;

        // Format tool display
        const { displayName, detail } = formatToolDisplay(toolName, input);

        wrapper.classList.toggle('cc-pending', !isComplete);
        wrapper.innerHTML = `
          <div class="cc-tool-block">
            <div class="cc-tool-header">
              <span class="cc-tool-name">${escapeHtml(displayName)}</span>
              ${detail ? `<span class="cc-tool-detail">${escapeHtml(detail)}</span>` : '<span class="cc-tool-detail"></span>'}
              <span class="cc-tool-status">${isComplete ? '✓' : '⋯'}</span>
            </div>
          </div>
        `;
        break;
      }

      default:
        return null;
    }

    return wrapper;
  }

  /**
   * Create a DOM element for an executed tool (from tool_executed events)
   */
  function createExecutedToolElement(tool) {
    const { toolName, preview, receipt, isComplete } = tool;
    
    // Format tool display name and detail
    const { displayName, detail } = formatExecutedToolDisplay(toolName, preview, receipt);
    
    const wrapper = document.createElement('div');
    wrapper.className = 'cc-content-block cc-success cc-executed-tool';
    wrapper.dataset.blockType = 'executed_tool';
    wrapper.dataset.toolKey = tool.toolKey || '';
    
    // Extract exit code if available
    const exitCode = receipt && typeof receipt.exitCode === 'number' ? receipt.exitCode : null;
    const hasError = exitCode !== null && exitCode !== 0;
    
    wrapper.innerHTML = `
      <div class="cc-tool-block${hasError ? ' cc-tool-error' : ''}">
        <div class="cc-tool-header">
          <span class="cc-tool-name">${escapeHtml(displayName)}</span>
          ${detail ? `<span class="cc-tool-detail">${escapeHtml(detail)}</span>` : '<span class="cc-tool-detail"></span>'}
          <span class="cc-tool-status">${isComplete ? (hasError ? '✗' : '✓') : '⋯'}</span>
        </div>
      </div>
    `;
    
    return wrapper;
  }

  /**
   * Format display for executed tools (from tool_executed events)
   */
  function formatExecutedToolDisplay(toolName, preview, receipt) {
    const name = toolName || 'Tool';
    const p = String(preview || '').trim();
    
    let displayName = name;
    let detail = '';
    
    // Parse preview for common tool types
    if (name === 'Bash') {
      const m = p.match(/Command:\s*([\s\S]*)/i);
      detail = m && m[1] ? clampStr(m[1].split('\n')[0].trim(), 60) : clampStr(p, 60);
    } else if (name === 'Read' || name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
      const m = p.match(/File:\s*([\s\S]*)/i);
      detail = m && m[1] ? clampStr(m[1].split('\n')[0].trim(), 60) : clampStr(p, 60);
    } else if (name === 'Glob' || name === 'Grep') {
      const m = p.match(/Pattern:\s*([\s\S]*)/i) || p.match(/:\s*["']?([^"'\n]+)/i);
      detail = m && m[1] ? clampStr(m[1].trim(), 60) : clampStr(p, 60);
    } else if (name === 'WebFetch') {
      const m = p.match(/URL(?:s)?:\s*([\s\S]*)/i) || p.match(/https?:\/\/[^\s]+/i);
      detail = m ? clampStr(Array.isArray(m) ? (m[1] || m[0]) : m[0], 60) : clampStr(p, 60);
    } else if (name === 'Task' || name === 'TaskOutput') {
      // Skip Task meta-tool in display (we show its children instead)
      detail = clampStr(p, 60);
    } else {
      detail = clampStr(p, 60);
    }
    
    return { displayName, detail };
  }

  /**
   * Clamp string to max length
   */
  function clampStr(s, maxLen = 60) {
    const str = String(s || '').replace(/\s+/g, ' ').trim();
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
  }

  /**
   * Create a DOM element for a diff preview
   */
  function createDiffElement(diff) {
    const filePath = diff.filePath || '';
    const diffContent = diff.diffContent || '';
    
    if (!filePath || !diffContent.trim()) return null;

    // Check if path should be hidden
    if (typeof window.isHiddenOrInternalPathForDiffPreview === 'function') {
      if (window.isHiddenOrInternalPathForDiffPreview(filePath)) return null;
    }

    const ext = getFileExtension(filePath);
    const badgeClass = getFileBadgeClass(ext);
    const stats = countDiffStats(diffContent);
    const diffClass = stats.isNewFile || stats.added > stats.removed ? 'stat-added' : 'stat-modified';
    
    // Use the proper diff stat HTML with colored +n -n
    const diffStatHtml = renderDiffStatHtml(stats);

    const wrapper = document.createElement('div');
    wrapper.className = 'message file-preview compact-cursor-style';
    wrapper.dataset.blockType = 'diff';
    wrapper.dataset.diffKey = diff.diffKey || '';
    
    wrapper.innerHTML = `
      <div class="file-preview-header" data-file-path="${escapeHtml(filePath)}">
        <button class="file-collapse-toggle" title="Toggle diff">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="file-badge badge-${badgeClass}">${ext.toUpperCase() || 'FILE'}</div>
        <span class="file-preview-path">${escapeHtml(filePath)}</span>
        <span class="file-diff-stat ${diffClass}" title="Open full diff">${diffStatHtml}</span>
        <div class="file-header-spacer"></div>
        <button class="file-preview-open-btn-icon" data-path="${escapeHtml(filePath)}" title="Open File">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </button>
      </div>
      <div class="file-preview-content" style="display: none"></div>
    `;

    // Wire up lazy diff rendering
    const toggle = wrapper.querySelector('.file-collapse-toggle');
    const content = wrapper.querySelector('.file-preview-content');
    let didRenderDiff = false;

    if (toggle && content) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = content.style.display === 'none';
        if (isCollapsed) {
          if (!didRenderDiff) {
            didRenderDiff = true;
            content.innerHTML = formatDiffContent(diffContent);
          }
          content.style.display = 'block';
          toggle.classList.add('expanded');
        } else {
          content.style.display = 'none';
          toggle.classList.remove('expanded');
        }
      });
    }

    // Wire up "Open File" button click - opens file and jumps to diff
    const openBtn = wrapper.querySelector('.file-preview-open-btn-icon');
    if (openBtn) {
      openBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rel = String(openBtn.dataset.path || '').trim();
        if (!rel || !window.currentFolder) return;
        const relNorm = typeof window.normalizeRelPathForDiffPreview === 'function' 
          ? window.normalizeRelPathForDiffPreview(rel) 
          : rel;
        if (typeof window.openRelPathFromChat === 'function') {
          await window.openRelPathFromChat(relNorm, { jumpToDiff: true, diffContent });
        }
      });
    }

    // Wire up diff stat click - opens full diff view
    const statEl = wrapper.querySelector('.file-diff-stat');
    if (statEl) {
      statEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (typeof window.openFullDiffForRelPath === 'function') {
          await window.openFullDiffForRelPath(filePath);
        }
      });
    }

    return wrapper;
  }
  
  /**
   * Render diff stat HTML with colored +n -n
   */
  function renderDiffStatHtml({ added = 0, removed = 0, isNewFile = false } = {}) {
    // Use global function if available
    if (typeof window.renderDiffStatHtml === 'function') {
      return window.renderDiffStatHtml({ added, removed, isNewFile });
    }
    // Fallback implementation
    const a = Number(added || 0);
    const r = Number(removed || 0);
    const aSafe = Number.isFinite(a) ? Math.max(0, Math.floor(a)) : 0;
    const rSafe = Number.isFinite(r) ? Math.max(0, Math.floor(r)) : 0;
    const plus = `<span class="diff-plus">+${aSafe}</span>`;
    if (isNewFile) return plus;
    const minus = `<span class="diff-minus">-${rSafe}</span>`;
    return `${plus} ${minus}`;
  }

  /**
   * Format text content for display
   */
  function formatTextContent(text, isStreaming) {
    if (!text) return '';
    
    // Use existing formatter if available
    if (!isStreaming && typeof window.formatMessage === 'function') {
      return window.formatMessage(text);
    }
    if (isStreaming && typeof window.formatCompletionTextStreaming === 'function') {
      return window.formatCompletionTextStreaming(text);
    }
    
    // Fallback: escape and preserve newlines
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  /**
   * Format thinking content for display
   */
  function formatThinkingContent(text, isStreaming) {
    if (!text) return '';
    
    if (typeof window.formatThinkingText === 'function') {
      return window.formatThinkingText(text, { streaming: isStreaming });
    }
    
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  /**
   * Format diff content for display
   */
  function formatDiffContent(diff) {
    if (typeof window.formatGitDiff === 'function') {
      return window.formatGitDiff(diff);
    }
    return `<pre>${escapeHtml(diff)}</pre>`;
  }

  /**
   * Format tool display info
   */
  function formatToolDisplay(toolName, input) {
    const name = String(toolName || 'Tool').trim();
    let displayName = name;
    let detail = '';

    if (input && typeof input === 'object') {
      switch (name.toLowerCase()) {
        case 'bash':
          detail = String(input.command || input.cmd || '').trim();
          if (detail.length > 100) detail = detail.slice(0, 97) + '…';
          break;
        case 'read':
        case 'write':
        case 'edit':
        case 'multiedit':
          detail = String(input.file_path || input.filePath || input.path || '').trim();
          break;
        case 'webfetch':
          detail = String(input.url || input.uri || (Array.isArray(input.urls) ? input.urls[0] : '') || '').trim();
          if (detail.length > 80) detail = detail.slice(0, 77) + '…';
          break;
        default:
          // Try to extract a meaningful detail
          if (input.file_path) detail = input.file_path;
          else if (input.path) detail = input.path;
          else if (input.command) detail = input.command.slice(0, 50);
      }
    }

    return { displayName, detail };
  }

  /**
   * Update legacy runState for backwards compatibility
   */
  function updateLegacyRunState(sessionId, message, state) {
    if (typeof window.getRunState !== 'function') return;

    const runState = window.getRunState(sessionId);
    if (!runState || !runState.stream) return;

    const stream = runState.stream;

    // Update text
    stream.text = message.getText();
    stream.thinking = message.getThinking();
    stream.lastUpdatedAt = Date.now();

    // Track thinking duration
    if (state.thinkingStartMs) {
      stream.thinkingStartMs = state.thinkingStartMs;
    }
  }

  /**
   * Ensure streaming bubble exists
   */
  function ensureStreamingBubble(sessionId) {
    if (typeof window.ensureStreamingBubbleForActiveSession === 'function') {
      return window.ensureStreamingBubbleForActiveSession(sessionId);
    }
    return null;
  }

  /**
   * Finalize the timeline for a completed request
   */
  function finalizeTimeline(requestId, sessionId) {
    const entry = requestTimelines.get(requestId);
    if (!entry) return;

    const { state } = entry;

    // Guard against double finalization - only finalize once
    if (state.finalized) {
      return;
    }
    state.finalized = true;

    // Cancel any pending render
    if (state.renderTimer) {
      clearTimeout(state.renderTimer);
      state.renderTimer = null;
    }
    state.renderPending = false;

    // Do a final render
    renderTimelineIncremental(requestId, sessionId, { finalize: true });

    // Mark as inactive but don't delete yet (for history rendering)
    state.isActive = false;
  }

  /**
   * Clean up a timeline
   */
  function cleanupTimeline(requestId) {
    const entry = requestTimelines.get(requestId);
    if (!entry) return;

    const { state } = entry;

    // Cancel any pending render
    if (state.renderTimer) {
      clearTimeout(state.renderTimer);
    }

    requestTimelines.delete(requestId);
  }

  /**
   * Get text content from a timeline
   */
  function getTimelineText(requestId) {
    const entry = requestTimelines.get(requestId);
    if (!entry) return '';

    const message = entry.timeline.getMessage();
    return message ? message.getText() : '';
  }

  /**
   * Get thinking content from a timeline
   */
  function getTimelineThinking(requestId) {
    const entry = requestTimelines.get(requestId);
    if (!entry) return '';

    const message = entry.timeline.getMessage();
    return message ? message.getThinking() : '';
  }

  // Helper functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getFileExtension(filePath) {
    const match = String(filePath || '').match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : '';
  }

  function getFileBadgeClass(ext) {
    const map = {
      js: 'js', ts: 'ts', tsx: 'ts', jsx: 'js',
      py: 'py', rb: 'rb', go: 'go', rs: 'rs',
      java: 'java', kt: 'kt', swift: 'swift',
      css: 'css', scss: 'css', html: 'html',
      json: 'json', yaml: 'yaml', yml: 'yaml',
      md: 'md', txt: 'txt', sh: 'sh'
    };
    return map[ext] || 'default';
  }

  function countDiffStats(diff) {
    let added = 0, removed = 0, isNewFile = false;
    const lines = String(diff || '').split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      if (line.startsWith('-') && !line.startsWith('---')) removed++;
      if (line.includes('new file mode')) isNewFile = true;
    }
    return { added, removed, isNewFile };
  }

  // Export to window
  window.TimelineIntegration = {
    initializeTimeline,
    processTimelineEvent,
    addDiffBlock,
    addExecutedTool,
    finalizeTimeline,
    cleanupTimeline,
    getTimelineText,
    getTimelineThinking,
    injectFinalText,
    scheduleTimelineRender,
    renderTimeline: renderTimelineIncremental
  };

})();
