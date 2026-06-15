/**
 * StreamAssembler - Mirrors Claude Code VS Code extension's streaming message assembly.
 * 
 * This module processes raw Anthropic stream_event messages and assembles them into
 * complete messages with content blocks, exactly like the official Claude Code extension.
 * 
 * Event flow:
 *   stream_event (from main) → StreamAssembler → assembled messages → UI render
 * 
 * Reference: anthropic.claude-code-2.0.75-darwin-arm64/webview/index.js lines 114105-114227
 */

// Symbol for storing partial JSON (matches Claude Code's implementation)
const PARTIAL_JSON_KEY = Symbol('partialJson');

/**
 * ContentBlock - Represents a single content block within a message.
 * Mirrors Claude Code's `sf` class.
 */
class ContentBlock {
  constructor(content, isPartial = false) {
    this.content = content;
    this.partial = isPartial;
    this.startTime = isPartial ? Date.now() : null;
    this.endTime = null;
    this.lastModifiedTime = Date.now();
    this.hash = Math.random();
    this._onUpdate = null;
  }

  get key() {
    return this.hash + this.lastModifiedTime;
  }

  get isPartial() {
    return this.partial;
  }

  get durationMillis() {
    if (!this.startTime) return null;
    return this.endTime ? this.endTime - this.startTime : Date.now() - this.startTime;
  }

  updated() {
    // Reset start time if stale (>30s without update)
    if (this.lastModifiedTime && Date.now() - this.lastModifiedTime > 30000) {
      this.startTime = null;
    }
    this.lastModifiedTime = Date.now();
    // FLICKER-FREE: Coalesce rapid updates into batches
    this._scheduleUpdate();
  }

  _scheduleUpdate() {
    // Only one pending update at a time - coalesce rapid-fire events
    if (this._pendingUpdate) return;
    this._pendingUpdate = true;
    
    // Use double-RAF to ensure we're past any layout thrashing
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._pendingUpdate = false;
        if (typeof this._onUpdate === 'function') {
          try { this._onUpdate(this); } catch { /* ignore */ }
        }
      });
    });
  }

  complete() {
    this.partial = false;
    this.lastModifiedTime = Date.now();
    this.endTime = Date.now();
    if (typeof this._onUpdate === 'function') {
      try { this._onUpdate(this); } catch { /* ignore */ }
    }
  }

  onUpdate(callback) {
    this._onUpdate = callback;
  }
}

/**
 * AssembledMessage - Represents a complete or in-progress message.
 * Mirrors Claude Code's `N_` class.
 */
class AssembledMessage {
  constructor(type, content = [], options = {}) {
    this.type = type; // 'user' | 'assistant' | 'system'
    this.content = content; // ContentBlock[]
    this.uuid = options.uuid || null;
    this.betaMessageId = options.betaMessageId || null;
    this.parentToolUseId = options.parentToolUseId || null;
    this.timestamp = options.timestamp || Date.now();
    this._onUpdate = null;
  }

  get isEmpty() {
    if (this.type === 'system') return false;
    if (this.content.length === 0) return true;
    // Check if all content is tool_result or partial tool_use
    return this.content.every(block => {
      const c = block.content;
      return c.type === 'tool_result' || (c.type === 'tool_use' && block.isPartial);
    });
  }

  /**
   * Get the assembled text content from all text blocks
   */
  getText() {
    const parts = [];
    for (const block of this.content) {
      if (block.content && block.content.type === 'text' && typeof block.content.text === 'string') {
        parts.push(block.content.text);
      }
    }
    return parts.join('');
  }

  /**
   * Get the assembled thinking content from all thinking blocks
   */
  getThinking() {
    const parts = [];
    for (const block of this.content) {
      if (block.content && block.content.type === 'thinking' && typeof block.content.thinking === 'string') {
        parts.push(block.content.thinking);
      }
    }
    return parts.join('');
  }

  onUpdate(callback) {
    this._onUpdate = callback;
  }

  _notifyUpdate() {
    // Use debounced update to prevent flickering
    if (this._pendingUpdate) return;
    this._pendingUpdate = true;
    requestAnimationFrame(() => {
      this._pendingUpdate = false;
      if (typeof this._onUpdate === 'function') {
        try { this._onUpdate(this); } catch { /* ignore */ }
      }
    });
  }
}

/**
 * MessageAssembler - Handles stream events for a single message.
 * Mirrors Claude Code's `Wee` class.
 */
class MessageAssembler {
  constructor(createMessage, parentToolUseId = null) {
    this.createMessage = createMessage;
    this.parentToolUseId = parentToolUseId;
    this.currentMessage = null;
    this.contentBlocks = null;
  }

  addContentBlock(blockContent) {
    const block = new ContentBlock(blockContent, true);
    this.contentBlocks.push(block);
    
    // Add to the assembled message
    const message = this.createMessage(this.currentMessage.id, this.parentToolUseId);
    message.content.push(block);
    
    // Wire up update notifications
    block.onUpdate(() => message._notifyUpdate());
    
    return block;
  }

  /**
   * Process a single stream event.
   * Mirrors Claude Code's processStreamEvent method exactly.
   */
  processStreamEvent(event) {
    if (!event || typeof event !== 'object') return;

    switch (event.type) {
      case 'message_start': {
        this.currentMessage = {
          ...event.message,
          content: []
        };
        this.contentBlocks = [];
        break;
      }

      case 'message_delta': {
        if (!this.currentMessage) return;
        // Update message metadata
        if (event.delta) {
          if (event.delta.stop_reason !== undefined) {
            this.currentMessage.stop_reason = event.delta.stop_reason;
          }
          if (event.delta.stop_sequence !== undefined) {
            this.currentMessage.stop_sequence = event.delta.stop_sequence;
          }
        }
        if (event.usage) {
          this.currentMessage.usage = this.currentMessage.usage || {};
          if (event.usage.output_tokens !== undefined) {
            this.currentMessage.usage.output_tokens = event.usage.output_tokens;
          }
          if (event.usage.input_tokens !== null && event.usage.input_tokens !== undefined) {
            this.currentMessage.usage.input_tokens = event.usage.input_tokens;
          }
        }
        break;
      }

      case 'content_block_start': {
        if (!this.currentMessage) return;
        this.currentMessage.content.push(event.content_block);
        this.addContentBlock(event.content_block);
        break;
      }

      case 'content_block_delta': {
        if (!this.currentMessage) {
          console.warn('[StreamAssembler] Received content_block_delta without a current message');
          return;
        }

        const block = this.contentBlocks[event.index];
        if (!block) return;

        const content = block.content;
        if (!content) return;

        // Apply the delta based on type
        this._applyDelta(content, event);
        
        // Mark block as updated
        block.updated();
        break;
      }

      case 'content_block_stop': {
        if (!this.currentMessage) return;
        
        const rawContent = this.currentMessage.content[event.index];
        if (!rawContent) return;

        const block = this.contentBlocks[event.index];
        if (block) {
          block.complete();
        }

        // Finalize tool_use blocks by parsing accumulated JSON
        if (rawContent.type === 'tool_use' || rawContent.type === 'server_tool_use') {
          this._finalizeToolUse(rawContent);
        }
        break;
      }

      case 'message_stop': {
        if (!this.currentMessage) {
          console.warn('[StreamAssembler] Received message_stop without a current message');
          return;
        }
        this.currentMessage = null;
        this.contentBlocks = null;
        break;
      }

      default:
        // Unknown event type - ignore
        break;
    }
  }

  /**
   * Apply a content_block_delta to a content block.
   * Mirrors Claude Code's tQe function.
   */
  _applyDelta(content, event) {
    const delta = event.delta;
    if (!delta) return;

    switch (delta.type) {
      case 'text_delta': {
        if (content.type !== 'text') {
          console.warn(`[StreamAssembler] Mismatched content block type: expected text, got ${content.type}`);
          return;
        }
        content.text = (content.text || '') + (delta.text || '');
        break;
      }

      case 'thinking_delta': {
        if (content.type !== 'thinking') {
          console.warn(`[StreamAssembler] Mismatched content block type: expected thinking, got ${content.type}`);
          return;
        }
        content.thinking = (content.thinking || '') + (delta.thinking || '');
        break;
      }

      case 'input_json_delta': {
        if (content.type === 'tool_use' || content.type === 'server_tool_use') {
          content[PARTIAL_JSON_KEY] = (content[PARTIAL_JSON_KEY] || '') + (delta.partial_json || '');
        } else {
          console.warn(`[StreamAssembler] Mismatched content block type for input_json_delta: ${content.type}`);
        }
        break;
      }

      case 'signature_delta': {
        if (content.type === 'thinking') {
          content.signature = delta.signature;
        }
        break;
      }

      case 'citations_delta': {
        if (content.type === 'text') {
          content.citations = content.citations || [];
          if (delta.citation) {
            content.citations.push(delta.citation);
          }
        }
        break;
      }

      default:
        // Unknown delta type - ignore
        break;
    }
  }

  /**
   * Finalize a tool_use block by parsing accumulated JSON.
   * Mirrors Claude Code's iQe function.
   */
  _finalizeToolUse(content) {
    const partialJson = content[PARTIAL_JSON_KEY];
    delete content[PARTIAL_JSON_KEY];

    if (partialJson === undefined) {
      // No JSON received - leave input empty
      return;
    }

    try {
      content.input = JSON.parse(partialJson);
    } catch (err) {
      // Failed to parse - store raw string
      content.input = partialJson;
      console.warn(`[StreamAssembler] Tool input was not valid JSON: ${err.message}`);
    }
  }
}

/**
 * StreamAssembler - Main coordinator for stream event processing.
 * Mirrors Claude Code's X5 class.
 * 
 * Manages multiple MessageAssemblers, one per parent tool use ID.
 */
class StreamAssembler {
  constructor(createMessage) {
    this.createMessage = createMessage;
    this.assemblers = new Map(); // parentToolUseId -> MessageAssembler
  }

  /**
   * Process a stream_event message.
   * @param {Object} event - The raw Anthropic stream event
   * @param {string|null} parentToolUseId - The parent tool use ID (for nested tool calls)
   */
  processStreamEvent(event, parentToolUseId = null) {
    const key = parentToolUseId || 'root';
    
    let assembler = this.assemblers.get(key);
    if (!assembler) {
      assembler = new MessageAssembler(this.createMessage, parentToolUseId);
      this.assemblers.set(key, assembler);
    }
    
    assembler.processStreamEvent(event);
  }

  /**
   * Clear all assemblers (call when starting a new conversation)
   */
  reset() {
    this.assemblers.clear();
  }
}

// Export for use in renderer
window.StreamAssembler = StreamAssembler;
window.AssembledMessage = AssembledMessage;
window.ContentBlock = ContentBlock;
window.PARTIAL_JSON_KEY = PARTIAL_JSON_KEY;

// Also export as module-style for potential future ESM migration
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StreamAssembler, AssembledMessage, ContentBlock, PARTIAL_JSON_KEY };
}
