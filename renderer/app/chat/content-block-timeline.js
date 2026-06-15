/**
 * ContentBlockTimeline - Proper Anthropic streaming event handling.
 * 
 * This module implements the correct architecture for handling Anthropic's streaming
 * message API. The key insight is that content blocks appear in ORDER and should be
 * rendered in that order - NOT based on text positions.
 * 
 * Anthropic Event Model:
 *   message_start          → Initialize message
 *   content_block_start    → Start new content block (text, tool_use, thinking)
 *   content_block_delta    → Delta for the block at given index
 *   content_block_stop     → Complete the block at given index
 *   message_delta          → Message-level updates (stop_reason, usage)
 *   message_stop           → End of message
 * 
 * The timeline is built from the sequence of content blocks, NOT from text positions.
 * This eliminates race conditions and text fragmentation issues.
 */

// Private symbol for partial JSON accumulation
const PARTIAL_JSON_SYMBOL = Symbol('partialJson');

/**
 * TimelineContentBlock - Represents a single content block in the timeline.
 * Each block is either: text, thinking, tool_use, or server_tool_use.
 */
class TimelineContentBlock {
  constructor(index, type, initialData = {}) {
    this.index = index;
    this.type = type; // 'text' | 'thinking' | 'tool_use' | 'server_tool_use'
    this.data = { ...initialData };
    this.isComplete = false;
    this.startTime = Date.now();
    this.endTime = null;
    this._changeId = 0;
    this._onUpdate = null;
  }

  /**
   * Get unique change identifier for detecting updates
   */
  get changeId() {
    return `${this.index}_${this._changeId}`;
  }

  /**
   * Get text content (for text blocks)
   */
  get text() {
    return this.type === 'text' ? (this.data.text || '') : '';
  }

  /**
   * Get thinking content (for thinking blocks)
   */
  get thinking() {
    return this.type === 'thinking' ? (this.data.thinking || '') : '';
  }

  /**
   * Get tool name (for tool_use blocks)
   */
  get toolName() {
    if (this.type !== 'tool_use' && this.type !== 'server_tool_use') return '';
    return this.data.name || '';
  }

  /**
   * Get tool ID (for tool_use blocks)
   */
  get toolId() {
    if (this.type !== 'tool_use' && this.type !== 'server_tool_use') return '';
    return this.data.id || '';
  }

  /**
   * Get tool input (for tool_use blocks, after completion)
   */
  get toolInput() {
    if (this.type !== 'tool_use' && this.type !== 'server_tool_use') return null;
    return this.data.input || null;
  }

  /**
   * Apply a delta to this block
   */
  applyDelta(delta) {
    if (!delta) return;

    switch (delta.type) {
      case 'text_delta':
        if (this.type === 'text') {
          this.data.text = (this.data.text || '') + (delta.text || '');
          this._changeId++;
          this._notifyUpdate();
        }
        break;

      case 'thinking_delta':
        if (this.type === 'thinking') {
          this.data.thinking = (this.data.thinking || '') + (delta.thinking || '');
          this._changeId++;
          this._notifyUpdate();
        }
        break;

      case 'input_json_delta':
        if (this.type === 'tool_use' || this.type === 'server_tool_use') {
          this.data[PARTIAL_JSON_SYMBOL] = (this.data[PARTIAL_JSON_SYMBOL] || '') + (delta.partial_json || '');
          this._changeId++;
          // Don't notify on every JSON delta - too noisy
        }
        break;

      case 'signature_delta':
        if (this.type === 'thinking') {
          this.data.signature = delta.signature;
          this._changeId++;
        }
        break;

      case 'citations_delta':
        if (this.type === 'text') {
          this.data.citations = this.data.citations || [];
          if (delta.citation) {
            this.data.citations.push(delta.citation);
          }
          this._changeId++;
        }
        break;
    }
  }

  /**
   * Mark this block as complete
   */
  complete() {
    this.isComplete = true;
    this.endTime = Date.now();

    // Finalize tool_use blocks by parsing accumulated JSON
    if (this.type === 'tool_use' || this.type === 'server_tool_use') {
      const partialJson = this.data[PARTIAL_JSON_SYMBOL];
      delete this.data[PARTIAL_JSON_SYMBOL];

      if (partialJson !== undefined) {
        try {
          this.data.input = JSON.parse(partialJson);
        } catch (err) {
          // Failed to parse - store raw string
          this.data.input = partialJson;
          console.warn(`[ContentBlockTimeline] Tool input was not valid JSON: ${err.message}`);
        }
      }
    }

    this._changeId++;
    this._notifyUpdate();
  }

  /**
   * Get duration in milliseconds
   */
  get durationMs() {
    if (!this.startTime) return null;
    return (this.endTime || Date.now()) - this.startTime;
  }

  /**
   * Set update callback
   */
  onUpdate(callback) {
    this._onUpdate = callback;
  }

  _notifyUpdate() {
    if (typeof this._onUpdate === 'function') {
      try {
        this._onUpdate(this);
      } catch { /* ignore */ }
    }
  }
}

/**
 * TimelineMessage - Represents a complete message with ordered content blocks.
 */
class TimelineMessage {
  constructor(messageId, options = {}) {
    this.messageId = messageId;
    this.role = options.role || 'assistant';
    this.model = options.model || '';
    this.blocks = []; // TimelineContentBlock[] - in order
    this.stopReason = null;
    this.usage = null;
    this.isComplete = false;
    this.startTime = Date.now();
    this.endTime = null;
    this._changeId = 0;
    this._onUpdate = null;
  }

  /**
   * Get unique change identifier
   */
  get changeId() {
    return `msg_${this._changeId}_${this.blocks.map(b => b.changeId).join(',')}`;
  }

  /**
   * Get all text content concatenated
   */
  getText() {
    return this.blocks
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }

  /**
   * Get all thinking content concatenated
   */
  getThinking() {
    return this.blocks
      .filter(b => b.type === 'thinking')
      .map(b => b.thinking)
      .join('');
  }

  /**
   * Get the block at a given index (create if needed for proper ordering)
   */
  getOrCreateBlock(index, type, initialData = {}) {
    // Ensure blocks array is long enough
    while (this.blocks.length <= index) {
      this.blocks.push(null);
    }

    const existing = this.blocks[index];
    if (!existing || existing.type !== type) {
      const block = new TimelineContentBlock(index, type, initialData);
      block.onUpdate(() => {
        this._changeId++;
        this._notifyUpdate();
      });
      this.blocks[index] = block;
      return block;
    }

    return existing;
  }

  /**
   * Complete the message
   */
  complete(stopReason = null, usage = null) {
    this.stopReason = stopReason;
    this.usage = usage;
    this.isComplete = true;
    this.endTime = Date.now();
    this._changeId++;
    this._notifyUpdate();
  }

  /**
   * Set update callback
   */
  onUpdate(callback) {
    this._onUpdate = callback;
  }

  _notifyUpdate() {
    if (typeof this._onUpdate === 'function') {
      try {
        this._onUpdate(this);
      } catch { /* ignore */ }
    }
  }

  /**
   * Get ordered non-null blocks
   */
  getOrderedBlocks() {
    return this.blocks.filter(b => b !== null);
  }
}

/**
 * ContentBlockTimeline - Main coordinator for event processing.
 * 
 * This replaces the flawed StreamAssembler with a correct implementation
 * that maintains proper content block ordering.
 */
class ContentBlockTimeline {
  constructor(options = {}) {
    this.onMessageUpdate = options.onMessageUpdate || null;
    this.onToolExecuted = options.onToolExecuted || null;
    
    // Map of parent_tool_use_id -> TimelineMessage
    this.messages = new Map();
    
    // Current message being assembled (keyed by parent tool use ID or 'root')
    this.currentMessages = new Map();
    
    // Event sequence number for debugging
    this._eventSeq = 0;
  }

  /**
   * Process a raw Anthropic stream event.
   * 
   * @param {Object} event - The Anthropic SSE event
   * @param {string|null} parentToolUseId - For nested tool calls
   */
  processEvent(event, parentToolUseId = null) {
    if (!event || typeof event !== 'object') return;

    const key = parentToolUseId || 'root';
    this._eventSeq++;

    switch (event.type) {
      case 'message_start': {
        const msg = event.message || {};
        const message = new TimelineMessage(msg.id, {
          role: msg.role || 'assistant',
          model: msg.model || ''
        });
        
        message.onUpdate(() => {
          if (typeof this.onMessageUpdate === 'function') {
            this.onMessageUpdate(key, message);
          }
        });
        
        this.currentMessages.set(key, message);
        this.messages.set(key, message);
        break;
      }

      case 'content_block_start': {
        const message = this.currentMessages.get(key);
        if (!message) {
          console.warn('[ContentBlockTimeline] content_block_start without active message');
          return;
        }

        const blockData = event.content_block || {};
        const index = typeof event.index === 'number' ? event.index : message.blocks.length;
        const rawType = typeof blockData.type === 'string' ? blockData.type : '';
        const isRedactedThinking = rawType === 'redacted_thinking';
        const normalizedType = isRedactedThinking ? 'thinking' : rawType;
        const sanitizedBlockData = isRedactedThinking
          ? { ...blockData, data: undefined }
          : blockData;
        
        message.getOrCreateBlock(index, normalizedType, {
          ...sanitizedBlockData,
          redacted: isRedactedThinking,
          rawType: rawType || null,
          // For tool_use, capture initial data
          id: blockData.id,
          name: blockData.name
        });
        break;
      }

      case 'content_block_delta': {
        const message = this.currentMessages.get(key);
        if (!message) {
          console.warn('[ContentBlockTimeline] content_block_delta without active message');
          return;
        }

        const index = event.index;
        if (typeof index !== 'number') {
          console.warn('[ContentBlockTimeline] content_block_delta missing index');
          return;
        }

        let block = message.blocks[index];
        if (!block) {
          console.warn(`[ContentBlockTimeline] content_block_delta for non-existent block ${index}`);
          return;
        }

        // Type check - the delta type should match the block type
        const delta = event.delta || {};
        const expectedType = this._getDeltaExpectedBlockType(delta.type);
        if (expectedType && block.type !== expectedType) {
          // Some providers (OpenRouter/OpenAI) can reuse a block index for thinking then text
          // without emitting a new content_block_start. In that case, switch the block type
          // to preserve visible output.
          if (expectedType === 'text' && block.type === 'thinking') {
            const replacement = message.getOrCreateBlock(index, expectedType, { text: '' });
            if (replacement && replacement.type === expectedType) {
              block = replacement;
            }
          } else if (expectedType === 'thinking' && block.type === 'text' && !String(block.text || '').trim()) {
            const replacement = message.getOrCreateBlock(index, expectedType, { thinking: '' });
            if (replacement && replacement.type === expectedType) {
              block = replacement;
            }
          } else if (!block.data?.redacted) {
            console.warn(`[ContentBlockTimeline] Delta type mismatch: expected ${expectedType}, got ${block.type}`);
          }
          // Don't fail - apply anyway if possible
        }

        block.applyDelta(delta);
        break;
      }

      case 'content_block_stop': {
        const message = this.currentMessages.get(key);
        if (!message) return;

        const index = event.index;
        if (typeof index !== 'number') return;

        const block = message.blocks[index];
        if (block) {
          block.complete();
          
          // If this is a tool_use block, notify
          if ((block.type === 'tool_use' || block.type === 'server_tool_use') && typeof this.onToolExecuted === 'function') {
            this.onToolExecuted(key, block);
          }
        }
        break;
      }

      case 'message_delta': {
        const message = this.currentMessages.get(key);
        if (!message) return;

        const delta = event.delta || {};
        if (delta.stop_reason !== undefined) {
          message.stopReason = delta.stop_reason;
        }
        if (event.usage) {
          message.usage = event.usage;
        }
        break;
      }

      case 'message_stop': {
        const message = this.currentMessages.get(key);
        if (!message) return;

        message.complete(message.stopReason, message.usage);
        this.currentMessages.delete(key);
        break;
      }
    }
  }

  /**
   * Get the expected block type for a delta type
   */
  _getDeltaExpectedBlockType(deltaType) {
    switch (deltaType) {
      case 'text_delta':
        return 'text';
      case 'thinking_delta':
      case 'signature_delta':
        return 'thinking';
      case 'input_json_delta':
        return null; // Can be tool_use or server_tool_use
      case 'citations_delta':
        return 'text';
      default:
        return null;
    }
  }

  /**
   * Get the current message for a given context
   */
  getMessage(parentToolUseId = null) {
    const key = parentToolUseId || 'root';
    return this.messages.get(key);
  }

  /**
   * Get all messages (root + nested tool contexts)
   */
  getAllMessages() {
    return Array.from(this.messages.entries());
  }

  /**
   * Get all tool_use blocks from ALL message contexts (including nested).
   * This flattens the tool hierarchy for timeline display.
   * Returns array of { block, parentToolUseId, contextKey }
   */
  getAllToolBlocks() {
    const allTools = [];
    
    for (const [contextKey, message] of this.messages.entries()) {
      if (!message) continue;
      const blocks = message.getOrderedBlocks();
      for (const block of blocks) {
        if (block.type === 'tool_use' || block.type === 'server_tool_use') {
          allTools.push({
            block,
            contextKey,
            parentToolUseId: contextKey === 'root' ? null : contextKey,
            timestamp: block.startTime || Date.now()
          });
        }
      }
    }
    
    // Sort by timestamp to show tools in execution order
    allTools.sort((a, b) => a.timestamp - b.timestamp);
    return allTools;
  }

  /**
   * Reset all state
   */
  reset() {
    this.messages.clear();
    this.currentMessages.clear();
    this._eventSeq = 0;
  }
}

/**
 * TimelineRenderer - Renders a TimelineMessage to DOM.
 * 
 * This replaces the position-based rendering with proper ordered block rendering.
 */
class TimelineRenderer {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = {
      formatText: options.formatText || ((text) => this._escapeHtml(text).replace(/\n/g, '<br>')),
      formatThinking: options.formatThinking || ((text) => this._escapeHtml(text).replace(/\n/g, '<br>')),
      onToolClick: options.onToolClick || null,
      ...options
    };
    
    // Track rendered blocks for incremental updates
    this._renderedBlocks = new Map(); // blockIndex -> DOM element
    this._lastChangeId = null;
  }

  /**
   * Render/update the timeline from a message
   */
  render(message, options = {}) {
    if (!message || !this.container) return;

    const isStreaming = !message.isComplete && !options.finalize;
    const blocks = message.getOrderedBlocks();

    // Check if we need a full re-render or incremental update
    const needsFullRender = options.force || !this._lastChangeId;

    if (needsFullRender) {
      this._renderFull(message, blocks, isStreaming);
    } else {
      this._renderIncremental(message, blocks, isStreaming);
    }

    this._lastChangeId = message.changeId;
  }

  /**
   * Full render - rebuilds entire DOM
   */
  _renderFull(message, blocks, isStreaming) {
    this.container.innerHTML = '';
    this._renderedBlocks.clear();

    for (const block of blocks) {
      const el = this._createBlockElement(block, isStreaming);
      if (el) {
        this.container.appendChild(el);
        this._renderedBlocks.set(block.index, el);
      }
    }
  }

  /**
   * Incremental render - updates existing DOM
   */
  _renderIncremental(message, blocks, isStreaming) {
    for (const block of blocks) {
      let el = this._renderedBlocks.get(block.index);

      if (!el) {
        // New block - create and append
        el = this._createBlockElement(block, isStreaming);
        if (el) {
          this.container.appendChild(el);
          this._renderedBlocks.set(block.index, el);
        }
      } else {
        // Update existing block
        this._updateBlockElement(el, block, isStreaming);
      }
    }
  }

  /**
   * Create DOM element for a content block
   */
  _createBlockElement(block, isStreaming) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cc-content-block';
    wrapper.dataset.blockType = block.type;
    wrapper.dataset.blockIndex = String(block.index);

    switch (block.type) {
      case 'text':
        wrapper.classList.add('cc-success');
        wrapper.innerHTML = `<div class="cc-text-block">${this.options.formatText(block.text)}</div>`;
        break;

      case 'thinking':
        wrapper.classList.add('cc-thinking');
        wrapper.innerHTML = `
          <div class="cc-thinking-header">
            <span class="cc-thinking-label">${block.isComplete ? 'Thought' : 'Thinking…'}</span>
            ${block.durationMs && block.isComplete ? `<span class="cc-thinking-duration">${Math.round(block.durationMs / 1000)}s</span>` : ''}
          </div>
          <div class="cc-thinking-content-inline">${this.options.formatThinking(block.thinking)}</div>
        `;
        break;

      case 'tool_use':
      case 'server_tool_use': {
        const name = block.toolName || 'Tool';
        const isComplete = block.isComplete;
        wrapper.classList.add(isComplete ? 'cc-success' : 'cc-pending');
        wrapper.innerHTML = `
          <div class="cc-tool-block">
            <div class="cc-tool-header">
              <span class="cc-tool-name">${this._escapeHtml(name)}</span>
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
   * Update existing DOM element for a block
   */
  _updateBlockElement(el, block, isStreaming) {
    switch (block.type) {
      case 'text': {
        const textEl = el.querySelector('.cc-text-block');
        if (textEl) {
          textEl.innerHTML = this.options.formatText(block.text);
        }
        break;
      }

      case 'thinking': {
        const contentEl = el.querySelector('.cc-thinking-content-inline');
        if (contentEl) {
          contentEl.innerHTML = this.options.formatThinking(block.thinking);
        }
        const labelEl = el.querySelector('.cc-thinking-label');
        if (labelEl && block.isComplete) {
          labelEl.textContent = 'Thought';
        }
        break;
      }

      case 'tool_use':
      case 'server_tool_use': {
        if (block.isComplete) {
          el.classList.remove('cc-pending');
          el.classList.add('cc-success');
          const statusEl = el.querySelector('.cc-tool-status');
          if (statusEl) statusEl.textContent = '✓';
        }
        break;
      }
    }
  }

  /**
   * Clear the renderer state
   */
  clear() {
    this.container.innerHTML = '';
    this._renderedBlocks.clear();
    this._lastChangeId = null;
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Export to window for non-ESM environment
window.ContentBlockTimeline = ContentBlockTimeline;
window.TimelineMessage = TimelineMessage;
window.TimelineContentBlock = TimelineContentBlock;
window.TimelineRenderer = TimelineRenderer;
window.PARTIAL_JSON_SYMBOL = PARTIAL_JSON_SYMBOL;

// Also export as module for potential future ESM migration
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ContentBlockTimeline,
    TimelineMessage,
    TimelineContentBlock,
    TimelineRenderer,
    PARTIAL_JSON_SYMBOL
  };
}
