// ============================================================================
// LEARNING GENERATOR (Codeon Learning Feature)
// Generates AI explanations for what the AI did in a run
// Uses the existing chat system as a follow-up message
// ============================================================================

(function () {
  'use strict';

  if (window._learningGenerator) return;

  // === Helpers ===
  const _trim = (s) => (typeof s === 'string' ? s.trim() : '');
  const _sid = () => _trim(window.currentSessionId || '');

  // === Add Learning Link Card to Chat ===
  // Creates a compact card in the chat that links to the Learning tab
  // Supports loading state (isLoading=true) and completed state (isLoading=false)
  function _addLearningLinkCardToChat(sessionId, runRequestId, content, { isLoading = false } = {}) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid) return;
    
    // Only add to current session's chat to avoid cross-session pollution
    if (sid !== window.currentSessionId) return;
    
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    // Check if card already exists for this run
    const cardId = `learning-link-card-${sid}-${rid}`;
    let linkCard = messagesContainer.querySelector(`#${CSS.escape(cardId)}`);
    const isNewCard = !linkCard;
    
    if (isNewCard) {
      linkCard = document.createElement('div');
      linkCard.id = cardId;
      linkCard.className = 'message assistant learning-link-card';
    }
    
    // Build card content based on loading state
    if (isLoading) {
      linkCard.classList.add('learning-link-card--loading');
      linkCard.innerHTML = `
        <div class="learning-link-card-content">
          <div class="learning-link-card-icon learning-link-card-icon--loading">
            <svg class="learning-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
              <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
            </svg>
          </div>
          <div class="learning-link-card-body">
            <div class="learning-link-card-title">Generating Learning Content...</div>
            <div class="learning-link-card-summary learning-link-card-summary--loading">Analyzing what was done and preparing educational explanation</div>
          </div>
        </div>
      `;
      linkCard.style.cursor = 'default';
    } else {
      // Completed state
      linkCard.classList.remove('learning-link-card--loading');
      
      // Get a summary snippet from the content
      let summarySnippet = 'New learning content is available.';
      try {
        if (content && content.summary) {
          const raw = String(content.summary || '').replace(/[*#_`]/g, '').trim();
          summarySnippet = raw.length > 120 ? raw.slice(0, 117) + '...' : raw;
        }
      } catch { /* ignore */ }
      
      linkCard.innerHTML = `
        <div class="learning-link-card-content">
          <div class="learning-link-card-icon learning-link-card-icon--success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/>
            </svg>
          </div>
          <div class="learning-link-card-body">
            <div class="learning-link-card-title">Learning Content Generated</div>
            <div class="learning-link-card-summary">${_escapeHtml(summarySnippet)}</div>
          </div>
          <button class="learning-link-card-btn" type="button" title="View in Learning tab">
            View
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      `;
      
      // Add click handler to open Learning tab
      const btn = linkCard.querySelector('.learning-link-card-btn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Switch to Learning tab and set the active entry
          try {
            if (typeof window._activateLearningTab === 'function') {
              window._activateLearningTab();
            }
            // Set this entry as active so it's displayed
            const ls = window._learningState;
            if (ls && typeof ls.setActiveEntry === 'function') {
              ls.setActiveEntry(sid, rid);
            }
            // Trigger UI update
            try { window._onLearningStateUpdate?.(); } catch { /* ignore */ }
          } catch { /* ignore */ }
        });
      }
      
      // Make the whole card clickable
      linkCard.style.cursor = 'pointer';
      linkCard.addEventListener('click', (e) => {
        if (e.target === btn || btn?.contains(e.target)) return;
        btn?.click();
      });
    }
    
    // Only add to DOM if it's a new card
    if (isNewCard) {
      try {
        if (typeof window.appendChatNode === 'function') {
          window.appendChatNode(messagesContainer, linkCard, { roleHint: 'assistant' });
        } else {
          messagesContainer.appendChild(linkCard);
        }
      } catch { /* ignore */ }
    }
    
    // Scroll to show the card
    try {
      if (typeof window.smartScrollToBottom === 'function') {
        window.smartScrollToBottom(messagesContainer, { force: false });
      } else {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    } catch { /* ignore */ }
  }
  
  // Update existing card to show error state
  function _updateLearningLinkCardError(sessionId, runRequestId, errorMessage) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return;
    
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    
    const cardId = `learning-link-card-${sid}-${rid}`;
    const linkCard = messagesContainer.querySelector(`#${CSS.escape(cardId)}`);
    if (!linkCard) return;
    
    linkCard.classList.remove('learning-link-card--loading');
    linkCard.classList.add('learning-link-card--error');
    linkCard.innerHTML = `
      <div class="learning-link-card-content">
        <div class="learning-link-card-icon learning-link-card-icon--error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
          </svg>
        </div>
        <div class="learning-link-card-body">
          <div class="learning-link-card-title">Learning Generation Failed</div>
          <div class="learning-link-card-summary learning-link-card-summary--error">${_escapeHtml(errorMessage || 'Unable to generate learning content')}</div>
        </div>
      </div>
    `;
    linkCard.style.cursor = 'default';
  }

  function _removeLearningLinkCard(sessionId, runRequestId) {
    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid || !rid) return;
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;
    const cardId = `learning-link-card-${sid}-${rid}`;
    const linkCard = messagesContainer.querySelector(`#${CSS.escape(cardId)}`);
    if (linkCard && linkCard.parentNode) {
      linkCard.parentNode.removeChild(linkCard);
    }
  }
  
  // Simple HTML escape helper
  function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // === Collect Run Context ===
  function _collectRunContext(sessionId, runRequestId) {
    const context = {
      prompt: '',
      toolsUsed: [],
      filesModified: [],
      toolDetails: []
    };

    const sid = _trim(sessionId);
    const rid = _trim(runRequestId);
    if (!sid) return context;

    try {
      // Get chat messages for this session
      const msgs = typeof window.ensureSessionMessages === 'function' 
        ? window.ensureSessionMessages(sid) 
        : (window.chatSessions?.[sid]?.messages || []);

      // Find the user message that started this run
      const userMsgs = msgs.filter(m => m && m.role === 'user');
      if (userMsgs.length > 0) {
        const lastUser = userMsgs[userMsgs.length - 1];
        context.prompt = _trim(lastUser.content || '');
      }

      // Get tool receipts for this session
      const receipts = typeof window.getToolReceiptsForSession === 'function'
        ? window.getToolReceiptsForSession(sid)
        : [];

      // Filter receipts for this run
      const relevantReceipts = rid 
        ? receipts.filter(r => r && (r.runRequestId === rid || !r.runRequestId))
        : receipts.slice(-20);

      const toolSet = new Set();
      const fileSet = new Set();

      for (const r of relevantReceipts) {
        if (!r) continue;
        const toolName = _trim(r.toolName);
        if (toolName) toolSet.add(toolName);

        if (r.receipt && typeof r.receipt === 'object') {
          const filePath = _trim(r.receipt.file_path || r.receipt.filePath || r.receipt.path || '');
          if (filePath && !filePath.startsWith('.ai-agent')) {
            fileSet.add(filePath);
          }
        }

        if (toolName && r.preview) {
          context.toolDetails.push({
            tool: toolName,
            preview: _trim(r.preview).slice(0, 300)
          });
        }
      }

      context.toolsUsed = Array.from(toolSet);
      context.filesModified = Array.from(fileSet).slice(0, 10);

      // Also check file_preview messages
      const filePreviews = msgs.filter(m => m && m.role === 'file_preview');
      for (const fp of filePreviews.slice(-10)) {
        if (fp.path && !fp.path.startsWith('.ai-agent')) {
          if (!fileSet.has(fp.path)) {
            context.filesModified.push(fp.path);
          }
        }
      }

    } catch (e) {
      console.warn('[Learning] Error collecting run context:', e);
    }

    return context;
  }

  // === Build Learning Prompt ===
  function _buildLearningPrompt(context) {
    let prompt = `🎓 **LEARNING MODE** - Teach me what you just did!\n\n`;
    
    prompt += `I'm learning to code. You just completed this task for me:\n`;
    prompt += `"${context.prompt || 'The previous coding task'}"\n\n`;
    
    if (context.toolsUsed.length > 0) {
      prompt += `You used these tools: ${context.toolsUsed.join(', ')}\n`;
    }
    
    if (context.filesModified.length > 0) {
      prompt += `You modified these files: ${context.filesModified.join(', ')}\n`;
    }
    
    if (context.toolDetails.length > 0) {
      prompt += `\nHere's what you did:\n`;
      for (const td of context.toolDetails.slice(0, 6)) {
        prompt += `• ${td.tool}: ${td.preview}\n`;
      }
    }

    prompt += `\n---\n\n`;
    prompt += `Now teach me like I'm a student. I want to LEARN from what you did. Be specific and educational:\n\n`;
    
    prompt += `**1. WHAT HAPPENED** (2-3 sentences)\n`;
    prompt += `Summarize what you built/changed and why it matters.\n\n`;
    
    prompt += `**2. THE APPROACH** (Be specific!)\n`;
    prompt += `- What problem-solving strategy did you use?\n`;
    prompt += `- Why did you choose this approach over alternatives?\n`;
    prompt += `- What trade-offs did you consider?\n\n`;
    
    prompt += `**3. TECHNICAL CONCEPTS** (This is the most important part!)\n`;
    prompt += `Explain the actual technical concepts used. Be SPECIFIC:\n`;
    prompt += `- **Algorithms**: Did you use recursion, iteration, sorting, searching, traversal, etc.?\n`;
    prompt += `- **Data Structures**: Arrays, objects/maps, sets, trees, graphs, stacks, queues?\n`;
    prompt += `- **Design Patterns**: Factory, Observer, Singleton, Module, MVC, Component pattern?\n`;
    prompt += `- **Architecture**: Separation of concerns, modularity, dependency injection?\n`;
    prompt += `- **Best Practices**: DRY, SOLID, error handling, validation, type safety?\n\n`;
    
    prompt += `**4. KEY CONCEPTS TO REMEMBER** (List 3-4 concepts)\n`;
    prompt += `For each concept, give:\n`;
    prompt += `- Name of the concept\n`;
    prompt += `- What it is (1-2 sentences)\n`;
    prompt += `- How it was used here\n\n`;
    
    prompt += `**5. CODE WORTH STUDYING**\n`;
    prompt += `Show 1-2 important code snippets and explain:\n`;
    prompt += `- What the code does\n`;
    prompt += `- Why it's written this way\n`;
    prompt += `- What pattern or technique it demonstrates\n\n`;
    
    prompt += `Remember: I want to LEARN, not just see a summary. Teach me something I can apply to my own coding!`;
    
    return prompt;
  }

  // === Parse Learning Response ===
  function _parseLearningResponse(text) {
    const defaultContent = {
      rawText: '',      // Full article content for unified rendering
      title: '',
      summary: '',
      reasoning: '',
      technical: '',
      concepts: [],
      codeHighlights: []
    };

    if (!text) return defaultContent;

    const content = { ...defaultContent };
    
    // Store the raw text for article view rendering
    content.rawText = text.trim();
    try {
      const lines = content.rawText.split(/\r?\n/).map(l => String(l || '').trim()).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/learning session\s*[:-]\s*(.+)/i);
        if (m && m[1]) {
          content.title = String(m[1] || '').trim();
          break;
        }
      }
      if (!content.title) {
        const heading = lines.find(l => /^#{1,6}\s+/.test(l));
        if (heading) content.title = heading.replace(/^#{1,6}\s+/, '').trim();
      }
      if (!content.title && lines.length) content.title = lines[0];
      if (content.title) {
        content.title = content.title.replace(/^[-*]\s+/, '').replace(/^[^A-Za-z0-9]+/, '').trim();
      }
    } catch { /* ignore */ }
    
    try {
      // Split text into sections by looking for numbered headers or bold headers
      // Common patterns: **1. WHAT HAPPENED**, ## 1. What Happened, **WHAT HAPPENED**
      const sectionRegex = /(?:^|\n)(?:\*\*)?(?:#+\s*)?(\d+\.?\s*)?(?:WHAT HAPPENED|THE APPROACH|WHY THIS APPROACH|TECHNICAL CONCEPTS|HOW IT WORKS|KEY CONCEPTS|CONCEPTS TO (?:LEARN|REMEMBER)|CODE (?:WORTH STUDYING|HIGHLIGHTS))(?:\*\*)?[:\s]*/gi;
      
      // Find all section positions
      const sectionPositions = [];
      let match;
      while ((match = sectionRegex.exec(text)) !== null) {
        sectionPositions.push({
          name: match[0].replace(/[*#\d.\s:]/g, '').trim().toUpperCase(),
          start: match.index + match[0].length
        });
      }
      
      // Add end position
      sectionPositions.push({ name: 'END', start: text.length });
      
      // Extract content between sections
      const getSectionContent = (keywords) => {
        for (let i = 0; i < sectionPositions.length - 1; i++) {
          const section = sectionPositions[i];
          const sectionName = section.name;
          for (const kw of keywords) {
            if (sectionName.includes(kw.toUpperCase())) {
              const start = section.start;
              const end = sectionPositions[i + 1].start;
              return text.slice(start, end).trim();
            }
          }
        }
        return '';
      };
      
      // Extract each section - NO TRUNCATION
      content.summary = getSectionContent(['WHAT HAPPENED', 'WHATHAPPENED']);
      content.reasoning = getSectionContent(['APPROACH', 'THISAPPROACH']);
      content.technical = getSectionContent(['TECHNICAL', 'HOW IT WORKS', 'HOWITWORKS']);
      
      const conceptsText = getSectionContent(['KEY CONCEPTS', 'CONCEPTS', 'KEYCONCEPTS']);
      if (conceptsText) {
        // Parse concepts - look for ### headers or bold items
        const conceptBlocks = conceptsText.split(/(?=###\s|\n-\s\*\*|\n\d+\.\s*\*\*)/);
        
        for (const block of conceptBlocks) {
          if (!block.trim()) continue;
          
          // Try ### header format
          let nameMatch = block.match(/###\s*(.+?)(?:\n|$)/);
          let explanation = '';
          
          if (nameMatch) {
            explanation = block.slice(nameMatch[0].length).trim();
          } else {
            // Try **Name**: explanation format or **Name** - explanation
            nameMatch = block.match(/\*\*([^*]+)\*\*[\s:-]*([\s\S]*)/);
            if (nameMatch) {
              explanation = nameMatch[2].trim();
            }
          }
          
          if (nameMatch && nameMatch[1]) {
            const name = nameMatch[1].replace(/[-*•\d.]/g, '').trim();
            if (name.length > 2 && name.length < 100) {
              content.concepts.push({
                name: name,
                category: 'Programming Concept',
                explanation: explanation || 'See above for details.'
              });
            }
          }
        }
        
        // Fallback: try bullet points
        if (content.concepts.length === 0) {
          const bulletLines = conceptsText.split(/\n/).filter(l => /^[-*•\d]/.test(l.trim()));
          for (const line of bulletLines.slice(0, 6)) {
            const cleaned = line.replace(/^[-*•\d.\s]+/, '').trim();
            const boldMatch = cleaned.match(/\*\*([^*]+)\*\*/);
            const colonIdx = cleaned.indexOf(':');
            
            let name = '';
            let explanation = cleaned;
            
            if (boldMatch) {
              name = boldMatch[1].trim();
              explanation = cleaned.replace(/\*\*[^*]+\*\*[:\s-]*/, '').trim();
            } else if (colonIdx > 0 && colonIdx < 50) {
              name = cleaned.slice(0, colonIdx).trim();
              explanation = cleaned.slice(colonIdx + 1).trim();
            } else {
              name = cleaned.slice(0, 50);
            }
            
            if (name) {
              content.concepts.push({
                name: name.replace(/\*\*/g, ''),
                category: 'Programming Concept',
                explanation: explanation
              });
            }
          }
        }
      }
      
      // Extract code blocks - NO TRUNCATION on snippets
      const allCodeBlocks = text.match(/```[\w]*\n[\s\S]*?```/g) || [];
      
      for (const block of allCodeBlocks.slice(0, 5)) {
        const lines = block.split('\n');
        const lang = lines[0].replace('```', '').trim() || 'code';
        const code = lines.slice(1, -1).join('\n').trim();
        if (code.length > 10) {
          // Try to find explanation near this code block
          const blockIdx = text.indexOf(block);
          const afterBlock = text.slice(blockIdx + block.length, blockIdx + block.length + 500);
          const beforeBlock = text.slice(Math.max(0, blockIdx - 200), blockIdx);
          
          // Look for explanation after or before the code block
          let explanation = afterBlock.split('\n').find(l => l.trim().length > 20 && !l.trim().startsWith('```'));
          if (!explanation) {
            const beforeLines = beforeBlock.split('\n').filter(l => l.trim());
            explanation = beforeLines[beforeLines.length - 1] || '';
          }
          
          content.codeHighlights.push({
            file: lang,
            snippet: code, // Full code, no truncation
            explanation: (explanation || 'Key implementation code').replace(/^[-*•#]\s*/, '').trim()
          });
        }
      }

      // Fallbacks if regex didn't find sections - use simpler approach
      if (!content.summary && !content.reasoning && !content.technical) {
        // Just use the whole text as summary
        content.summary = text;
      } else if (!content.summary) {
        // Find first substantial paragraph
        const paragraphs = text.split(/\n\n/).filter(p => p.trim().length > 50);
        content.summary = paragraphs[0] || text.slice(0, 1000);
      }
      
    } catch (e) {
      console.warn('[Learning] Failed to parse response:', e);
      content.summary = text; // Use full text on error
    }

    return content;
  }

  // === Generate Learning Explanation ===
  async function generateLearningExplanation({ sessionId, runRequestId }) {
    const ls = window._learningState;
    if (!ls) {
      console.warn('[Learning] State module not available');
      return;
    }

    const sid = _trim(sessionId || _sid());
    const rid = _trim(runRequestId);
    if (!sid || !rid) {
      console.warn('[Learning] Missing sessionId or runRequestId');
      return;
    }

    let entry = ls.getEntry(sid, rid);
    if (!entry) {
      entry = ls.createEntry({ sessionId: sid, runRequestId: rid, originalPrompt: '' });
    }

    if (entry.status === 'completed') {
      console.log('[Learning] Entry already completed, skipping generation');
      return;
    }

    if (entry.status === 'generating') {
      console.log('[Learning] Already generating for this run');
      return;
    }

    if (typeof window.getAIResponse !== 'function') {
      console.warn('[Learning] getAIResponse not available');
      ls.setEntryError(sid, rid, 'Chat system not available');
      return;
    }

    ls.setEntryGenerating(sid, rid);
    try { window._onLearningStateUpdate?.(); } catch { /* ignore */ }

    // Show Stop button while learning is running.
    try {
      if (typeof window.setProcessingState === 'function') {
        window.setProcessingState(true, sid);
      } else if (typeof window.getRunState === 'function') {
        const st = window.getRunState(sid);
        if (st) st.isProcessing = true;
      }
    } catch { /* ignore */ }
    
    // Show loading card immediately
    try {
      _addLearningLinkCardToChat(sid, rid, null, { isLoading: true });
    } catch { /* ignore */ }

    try {
      const context = _collectRunContext(sid, rid);
      
      ls.updateEntry(sid, rid, {
        originalPrompt: context.prompt,
        metadata: {
          toolsUsed: context.toolsUsed,
          filesModified: context.filesModified,
          durationMs: entry.metadata?.durationMs || 0
        }
      });

      const learningPrompt = _buildLearningPrompt(context);

      console.log('[Learning] Sending learning request to chat...');

      const response = await window.getAIResponse(
        learningPrompt,
        [],
        null,
        sid,
        { 
          isLearningRequest: true,
          skipCheckpoint: true
        }
      );

      console.log('[Learning] Got response, parsing...');

      const content = _parseLearningResponse(response || '');

      ls.setEntryCompleted(sid, rid, content);
      console.log('[Learning] Generation completed for run:', rid);

      // Add a compact link card to the chat pointing to the Learning tab
      try {
        _addLearningLinkCardToChat(sid, rid, content);
      } catch { /* ignore */ }

    } catch (e) {
      console.error('[Learning] Generation failed:', e);
      const errMsg = String(e?.message || 'Generation failed');
      
      // Check if this is a provider/network error (404, timeout, etc.) - don't spam user with cards
      const isProviderError = /404|not found|timeout|network|ECONNREFUSED|rate.?limit/i.test(errMsg);
      
      if (isProviderError) {
        // Silently clean up - don't show error card for provider issues
        console.warn('[Learning] Provider error, cleaning up silently:', errMsg.slice(0, 100));
        try { ls.deleteEntry(sid, rid); } catch { /* ignore */ }
        try { _removeLearningLinkCard(sid, rid); } catch { /* ignore */ }
      } else {
        // Show error for other failures (parsing, state issues, etc.)
        ls.setEntryError(sid, rid, errMsg);
        try {
          _updateLearningLinkCardError(sid, rid, errMsg);
      } catch { /* ignore */ }
      }
    }

    // CRITICAL: Ensure UI is cleaned up after learning completes
    // The SDK event handler should do this, but belt-and-suspenders
    try {
      // Clear the status banner
      const banner = document.getElementById('chatStatusBanner');
      if (banner) banner.style.display = 'none';
    } catch { /* ignore */ }
    
    try {
      // Reset processing state for this session
      if (typeof window.setProcessingState === 'function') {
        window.setProcessingState(false, sid);
      }
    } catch { /* ignore */ }
    
    try {
      // Update send button state
      if (typeof window.updateSendButtonForCurrentSession === 'function') {
        window.updateSendButtonForCurrentSession();
      }
    } catch { /* ignore */ }
    
    try {
      // Re-render chat tabs to update status
      if (typeof window.renderChatTabs === 'function') {
        window.renderChatTabs();
      }
    } catch { /* ignore */ }

    // If docs are pending, trigger them after learning completes.
    try { window.generatePendingDocs?.(); } catch { /* ignore */ }

    try { window._onLearningStateUpdate?.(); } catch { /* ignore */ }
  }

  // === Expose API ===
  window._learningGenerator = {
    generate: generateLearningExplanation,
    collectContext: _collectRunContext,
    buildPrompt: _buildLearningPrompt,
    parseResponse: _parseLearningResponse
  };

  window._generateLearningExplanation = generateLearningExplanation;

  // Cancel any in-flight learning generation for a session (cleans UI/state)
  window._cancelLearningGeneration = function ({ sessionId = null, runRequestId = null, reason = 'Cancelled' } = {}) {
    try {
      const ls = window._learningState;
      if (!ls) return;
      const sid = _trim(sessionId || _sid());
      if (!sid) return;
      let rid = _trim(runRequestId);
      if (!rid && typeof ls.getEntriesForSession === 'function') {
        const entries = ls.getEntriesForSession(sid) || [];
        const target = entries.find(e => e && (e.status === 'generating' || e.status === 'pending'));
        if (target && target.runRequestId) rid = target.runRequestId;
      }
      if (!rid) return;
      try { ls.deleteEntry(sid, rid); } catch { /* ignore */ }
      try { if (ls.getView && ls.getView() === 'detail') ls.setView('list'); } catch { /* ignore */ }
      try { _removeLearningLinkCard(sid, rid); } catch { /* ignore */ }
      try { window._onLearningStateUpdate?.(); } catch { /* ignore */ }
    } catch { /* ignore */ }
  };
})();
