/**
 * thinking-formatter.js - Human-readable formatting for thinking/reasoning blocks
 * 
 * This module provides formatting functions that convert thinking text into
 * properly styled HTML without full markdown interpretation.
 * 
 * Key differences from formatMessage:
 * - Converts **bold** and *italic* to styled HTML
 * - Preserves paragraph structure with proper spacing
 * - Handles line breaks naturally
 * - Does NOT interpret code blocks, headers, or other complex markdown
 * - Optimized for real-time streaming updates
 */

/**
 * Format thinking text into human-readable styled HTML.
 * Handles basic inline formatting (bold, italic) and paragraph structure.
 * 
 * @param {string} text - Raw thinking text
 * @param {Object} options - Formatting options
 * @param {boolean} options.streaming - If true, optimized for streaming (simpler output)
 * @returns {string} HTML-formatted text
 */
function formatThinkingText(text, options = {}) {
  if (!text || typeof text !== 'string') return '';
  
  const { streaming = false } = options;
  
  // Escape HTML first to prevent XSS
  let html = escapeHtmlForThinking(text);
  
  // Convert inline formatting (bold and italic)
  // Bold: **text** or __text__
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="thinking-bold">$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong class="thinking-bold">$1</strong>');
  
  // Italic: *text* or _text_ (but not inside words)
  // Be careful not to match asterisks that are part of bullet points
  html = html.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<em class="thinking-italic">$1</em>');
  html = html.replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '<em class="thinking-italic">$1</em>');
  
  if (streaming) {
    // During streaming: simple line breaks, no complex structure
    html = html.replace(/\n/g, '<br>');
  } else {
    // Finalized: create proper paragraph structure
    // Split into paragraphs (double newlines)
    const paragraphs = html.split(/\n{2,}/);
    html = paragraphs
      .map(p => {
        // Within each paragraph, convert single newlines to <br>
        const content = p.trim().replace(/\n/g, '<br>');
        if (!content) return '';
        return `<p class="thinking-paragraph">${content}</p>`;
      })
      .filter(p => p)
      .join('');
    
    // If no paragraphs were created (single block of text), wrap it
    if (!html.includes('<p')) {
      html = `<p class="thinking-paragraph">${html}</p>`;
    }
  }
  
  return html;
}

/**
 * Format completion/assistant message text into styled HTML.
 * This is similar to formatMessage but ensures proper rendering.
 * 
 * @param {string} text - Raw assistant message text
 * @param {Object} options - Formatting options
 * @param {boolean} options.streaming - If true, optimized for streaming
 * @returns {string} HTML-formatted text
 */
function formatCompletionText(text, options = {}) {
  if (!text || typeof text !== 'string') return '';
  
  const { streaming = false } = options;
  
  // For streaming, use a simpler formatter to avoid flicker
  if (streaming) {
    return formatCompletionTextStreaming(text);
  }
  
  // For finalized content, do full markdown conversion
  return formatCompletionTextFinal(text);
}

/**
 * Streaming-safe completion text formatter.
 * Avoids complex parsing that causes visual flicker during streaming.
 */
function formatCompletionTextStreaming(text) {
  if (!text || typeof text !== 'string') return '';
  
  // 1. First extract and protect code blocks
  const codeBlocks = [];
  let codeBlockId = 0;
  let processed = text.replace(/```(\w+)?[\n\r]?([\s\S]*?)```/g, (_match, lang, code) => {
    const trimmedCode = code.replace(/^[\n\r]/, '');
    const placeholder = `__STREAM_CODE_BLOCK_${codeBlockId++}__`;
    const encodedCode = encodeURIComponent(trimmedCode);
    codeBlocks.push({
      placeholder,
      html: `<div class="code-block-container" data-language="${lang || 'text'}"><pre><code class="language-${lang || 'text'}" data-code="${encodedCode}">${escapeHtmlForThinking(trimmedCode)}</code></pre></div>`
    });
    return placeholder;
  });
  
  // 2. Escape HTML in remaining content
  let html = escapeHtmlForThinking(processed);
  
  // 3. Basic inline formatting for streaming (keeps it readable)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<em>$1</em>');
  
  // Inline code (but not code blocks)
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  
  // 4. Restore code blocks
  codeBlocks.forEach(block => {
    html = html.replace(block.placeholder, block.html);
  });
  
  return html;
}

/**
 * Final completion text formatter with full markdown support.
 */
function formatCompletionTextFinal(text) {
  if (!text || typeof text !== 'string') return '';
  
  // This delegates to formatMessage if available, or provides fallback
  if (typeof formatMessage === 'function') {
    return formatMessage(text);
  }
  
  // Fallback: similar to streaming but with paragraph structure
  let html = escapeHtmlForThinking(text);
  
  // Bold and italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<em>$1</em>');
  
  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  
  // Headers
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

/**
 * Escape HTML characters for safe insertion.
 */
function escapeHtmlForThinking(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Detect if a thinking text represents a new "segment" that should be
 * displayed as a separate timeline item.
 * 
 * This analyzes the thinking text for structural markers like:
 * - Section headers (e.g., **Section Name**)
 * - Significant topic changes
 * - Explicit breaks
 * 
 * @param {string} currentText - Current accumulated thinking text
 * @param {string} newDelta - New delta being added
 * @param {Object} state - State tracking object
 * @returns {Object} { isNewSegment: boolean, segmentStart: number }
 */
function detectThinkingSegment(currentText, newDelta, state = {}) {
  if (!currentText || !newDelta) {
    return { isNewSegment: false, segmentStart: 0 };
  }
  
  // Track state for segment detection
  const lastSegmentEnd = state.lastSegmentEnd || 0;
  const currentLen = currentText.length;
  
  // Look for segment markers in the new content:
  // 1. Double-asterisk headers at line start: **Header**
  // 2. Significant gaps (handled by timing in caller)
  
  // Check if new delta starts with a potential header pattern
  const trimmedDelta = newDelta.trimStart();
  const headerMatch = trimmedDelta.match(/^\*\*[^*]+\*\*/);
  
  if (headerMatch) {
    // Check if this header appears after meaningful content
    const textBeforeHeader = currentText.slice(lastSegmentEnd).trim();
    if (textBeforeHeader.length > 100) {
      // Significant content before this header - it's a new segment
      return {
        isNewSegment: true,
        segmentStart: currentLen - newDelta.length,
        segmentTitle: headerMatch[0].replace(/\*\*/g, '')
      };
    }
  }
  
  return { isNewSegment: false, segmentStart: lastSegmentEnd };
}

/**
 * Create thinking segment metadata for timeline rendering.
 * 
 * SIMPLIFIED: Returns the entire thinking text as a single segment.
 * The original multi-segment approach caused duplicates.
 * Individual **Header** sections are styled within a single block.
 * 
 * @param {string} thinkingText - Full thinking text
 * @returns {Array<Object>} Array of segment objects with start, end, title
 */
function parseThinkingSegments(thinkingText) {
  if (!thinkingText || typeof thinkingText !== 'string') {
    return [{ start: 0, end: 0, title: null, text: '' }];
  }
  
  // Return the whole text as a single segment
  // This prevents duplicate thinking blocks
  // The formatThinkingText function handles internal structure (headers, bold, etc.)
  return [{
    start: 0,
    end: thinkingText.length,
    title: null,
    text: thinkingText
  }];
}

// Export to window for use in other modules
window.formatThinkingText = formatThinkingText;
window.formatCompletionText = formatCompletionText;
window.formatCompletionTextStreaming = formatCompletionTextStreaming;
window.detectThinkingSegment = detectThinkingSegment;
window.parseThinkingSegments = parseThinkingSegments;
window.escapeHtmlForThinking = escapeHtmlForThinking;

// Console log for debugging
console.log('[thinking-formatter] Module loaded');
