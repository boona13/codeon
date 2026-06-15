// ---- CHUNK 4/6 from hoisted.js (AST statement boundaries; order preserved) ----


async function renderMessageToUI(msg) {
  const messagesContainer = document.getElementById('chatMessages');

  if (msg.role === 'system_action' || msg.role === 'system') {
    // Render system_action messages as timeline items (same style as tools/thinking/diffs)
    const content = String(msg.content || '');
    
    // Parse the action type and text from the content
    // Format examples: "⏸ Pause-before-next-tool enabled", "▶️ Pause-before-next-tool disabled"
    // "🔒 Locked file: `path`", "🔓 Unlocked file: `path`", "⏩ Resume from node: **title**"
    const isPauseEnabled = content.includes('Pause-before-next-tool enabled');
    const isPauseDisabled = content.includes('Pause-before-next-tool disabled');
    const isLock = content.includes('Locked file') || content.includes('Locked ');
    const isUnlock = content.includes('Unlocked file') || content.includes('Unlocked ');
    const isResume = content.includes('Resume from node');
    const isBlocked = content.includes('Blocked edit');
    
    // Determine action label and detail text
    let actionLabel = '';
    let actionDetail = '';
    let bulletClass = 'cc-success'; // green bullet default
    
    if (isPauseEnabled) {
      actionLabel = 'Pause';
      actionDetail = 'Pause-before-next-tool enabled';
      bulletClass = 'cc-warning'; // amber/yellow for pause
    } else if (isPauseDisabled) {
      actionLabel = 'Resume';
      actionDetail = 'Pause-before-next-tool disabled';
      bulletClass = 'cc-success'; // green for resume
    } else if (isLock) {
      actionLabel = 'Lock';
      // Extract file path from content like "🔒 Locked file: `path`"
      const match = content.match(/`([^`]+)`/);
      actionDetail = match ? match[1] : content.replace(/^[^\s]+\s*/, '').replace(/`/g, '');
      bulletClass = 'cc-warning';
    } else if (isUnlock) {
      actionLabel = 'Unlock';
      const match = content.match(/`([^`]+)`/);
      actionDetail = match ? match[1] : content.replace(/^[^\s]+\s*/, '').replace(/`/g, '');
      bulletClass = 'cc-success';
    } else if (isResume) {
      actionLabel = 'Resume';
      // Extract node title from content like "⏩ Resume from node: **title**"
      const match = content.match(/\*\*([^*]+)\*\*/);
      actionDetail = match ? match[1] : content.replace(/^[^\s]+\s*/, '');
      bulletClass = 'cc-success';
    } else if (isBlocked) {
      actionLabel = 'Blocked';
      const match = content.match(/`([^`]+)`/);
      actionDetail = match ? match[1] : 'Edit blocked due to lock';
      bulletClass = 'cc-error'; // red for blocked
    } else {
      // Generic system action - use old card style as fallback
      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${msg.role}`;
      if (msg.id) messageDiv.id = msg.id;
      const messageContentDiv = document.createElement('div');
      messageContentDiv.className = 'message-content';
      const textDiv = document.createElement('div');
      textDiv.className = 'message-text';
      textDiv.innerHTML = formatMessage(content);
      messageContentDiv.appendChild(textDiv);
      messageDiv.appendChild(messageContentDiv);
      appendChatNode(messagesContainer, messageDiv, { roleHint: 'assistant' });
      return;
    }
    
    // Create timeline-style block
    const blockDiv = document.createElement('div');
    blockDiv.className = `cc-content-block ${bulletClass}`;
    blockDiv.dataset.blockType = 'action';
    if (msg.id) blockDiv.id = msg.id;
    
    // Build inner HTML similar to tool blocks
    let innerHtml = '<div class="cc-action-block"><div class="cc-action-header">';
    innerHtml += `<span class="cc-action-name">${escapeHtml(actionLabel)}</span>`;
    if (actionDetail) {
      innerHtml += `<span class="cc-action-detail">${escapeHtml(actionDetail)}</span>`;
    }
    innerHtml += '</div></div>';
    
    blockDiv.innerHTML = innerHtml;
    appendChatNode(messagesContainer, blockDiv, { roleHint: 'assistant' });
    return;
  }

  if (msg.role === 'user' || msg.role === 'assistant') {
    // Skip empty assistant messages (tool-only responses)
    if (msg.role === 'assistant' && (!msg.content || msg.content.trim() === '')) {
      // Skipping empty assistant message
      return;
    }
    
    // Skip Learning messages - they should only appear in the Learning panel, not chat
    // Learning user messages start with the 🎓 marker
    const isLearningUserMsg = msg.role === 'user' && typeof msg.content === 'string' && 
                              msg.content.includes('🎓') && msg.content.includes('LEARNING MODE');
    if (isLearningUserMsg) {
      return;
    }
    // Skip assistant responses to learning requests
    // Check: explicit flag, or look for the preceding learning user message by seq
    if (msg.role === 'assistant' && msg.isLearning === true) {
      return;
    }
    // Also skip assistant messages that follow a learning user message
    if (msg.role === 'assistant') {
      try {
        const sid = String(currentSessionId || '').trim();
        const timeline = sid && typeof ensureSessionMessages === 'function' ? ensureSessionMessages(sid) : [];
        // Find this message's position by seq
        const msgSeq = typeof msg.seq === 'number' ? msg.seq : -1;
        if (msgSeq > 0) {
          // Look for user messages with seq < this message's seq
          for (let i = timeline.length - 1; i >= 0; i--) {
            const prev = timeline[i];
            if (!prev || typeof prev.seq !== 'number' || prev.seq >= msgSeq) continue;
            if (prev.role === 'user') {
              if (typeof prev.content === 'string' && 
                  prev.content.includes('🎓') && prev.content.includes('LEARNING MODE')) {
                return; // Skip this assistant message - it's a learning response
              }
              break; // Found a non-learning user message
            }
          }
        }
      } catch { /* ignore */ }
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${msg.role}`;
    if (msg.role === 'user') {
      messageDiv.classList.add('sticky-message');
      // Keep DOM linked to the checkpoint hash (if present) so AET restore can reuse chat restore logic.
      if (msg && typeof msg.commitHash === 'string' && msg.commitHash.trim()) {
        try { messageDiv.dataset.commitHash = msg.commitHash.trim(); } catch { /* ignore */ }
      }
    }
    if (msg.id) messageDiv.id = msg.id;

    let thoughtContent = '';
    // Check for reasoning/thought content from Gemini/DeepSeek/Claude/etc.
    const thoughtText = msg.thinking || msg.thought || msg.reasoning || msg.provider_metadata?.thought || msg.provider_metadata?.reasoning;
    if (thoughtText) {
      // Claude Code style: show "Thought for Xs" with duration if available
      const thinkingDurationMs = msg.thinkingDurationMs || msg.provider_metadata?.thinkingDurationMs || null;
      let thinkingLabel = 'Thought';
      if (thinkingDurationMs !== null && thinkingDurationMs > 0) {
        const secs = Math.round(thinkingDurationMs / 1000);
        thinkingLabel = secs > 0 ? `Thought for ${secs}s` : 'Thought';
      }
      
      // Format thinking content using formatThinkingText for proper styling
      const formattedContent = (typeof window.formatThinkingText === 'function')
        ? window.formatThinkingText(thoughtText, { streaming: false })
        : formatMessage(thoughtText);
      
      thoughtContent = `
        <details class="cc-thinking">
          <summary class="cc-thinking-summary">
            <span class="cc-thinking-label">${escapeHtml(thinkingLabel)}</span>
            <svg class="cc-thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </summary>
          <div class="cc-thinking-content">${formattedContent}</div>
        </details>
      `;
    }

    // If this assistant message persisted inline blocks (diffs, tools, or thinking), render it as a stable timeline
    // (text + diff previews + tool markers + thinking blocks) so app restarts preserve the same ordering as streaming.
    const inlineBlocks = (msg.role === 'assistant' && Array.isArray(msg.inlineDiffBlocks)) ? msg.inlineDiffBlocks : null;
    let inlineTools = (msg.role === 'assistant' && Array.isArray(msg.toolBlocks)) ? msg.toolBlocks : null;
    const inlineThinking = (msg.role === 'assistant' && Array.isArray(msg.thinkingBlocks)) ? msg.thinkingBlocks : null;
    
    // MERGE tool_receipt messages into toolBlocks.
    // Some tools (especially early ones like initial cd, reads) may not be in toolBlocks
    // because they were executed before streaming state was fully initialized.
    // tool_receipt messages capture ALL tool executions, so we merge them to ensure nothing is missing.
    if (msg.role === 'assistant' && msg.runRequestId) {
      try {
        const sid = String(currentSessionId || '').trim();
        if (sid && typeof ensureSessionMessages === 'function') {
          const allMsgs = ensureSessionMessages(sid);
          const receipts = Array.isArray(allMsgs) 
            ? allMsgs.filter(m => m && m.role === 'tool_receipt' && m.runRequestId === msg.runRequestId)
            : [];
          if (receipts.length > 0) {
            // Get toolUseIds already in toolBlocks to avoid duplicates
            const existingIds = new Set(
              (inlineTools || []).map(t => String(t?.toolUseId || '')).filter(Boolean)
            );
            // Convert receipts to toolBlock format and add missing ones
            const extraTools = receipts
              .filter(r => !existingIds.has(String(r.toolUseId || '')))
              .map(r => ({
                atTextLen: 0, // Will appear at start (before summary text)
                toolName: String(r.toolName || ''),
                toolUseId: String(r.toolUseId || ''),
                preview: String(r.preview || ''),
                timestamp: Number(r.timestamp || 0),
                _fromReceipt: true
              }));
            if (extraTools.length > 0) {
              inlineTools = [...extraTools, ...(inlineTools || [])];
            }
          }
        }
      } catch { /* ignore errors in merging */ }
    }
    
    const hasInlineContent = (inlineBlocks && inlineBlocks.length > 0) || (inlineTools && inlineTools.length > 0) || (inlineThinking && inlineThinking.length > 0);
    
    if (msg.role === 'assistant' && hasInlineContent) {
      // Don't render old-style thoughtContent if we have thinkingBlocks (they'll be interleaved)
      const useOldThoughtContent = !inlineThinking || inlineThinking.length === 0;
      messageDiv.innerHTML = `${useOldThoughtContent ? thoughtContent : ''}<div class="message-content"></div>`;
      const contentEl = messageDiv.querySelector('.message-content');
      if (contentEl) {
        const fullText = String(msg.content || '');
        
        // Claude Code style: INTERLEAVE text segments with blocks based on atTextLen position
        // This ensures text appears at the correct insertion points relative to tool executions
        // Timeline: [thinking] -> [text segment 0..pos1] -> [tool1] -> [thinking] -> [text segment pos1..pos2] -> [tool2] -> [remaining text]
        
        // Collect and tag all blocks
        const diffBlocks = inlineBlocks ? inlineBlocks.filter(b => b).map(b => ({ ...b, _blockType: 'diff' })) : [];
        const toolBlocks = inlineTools ? inlineTools.filter(b => b).map(b => ({ ...b, _blockType: 'tool' })) : [];
        const thinkingBlocks = inlineThinking ? inlineThinking.filter(b => b && b.text).map(b => ({ ...b, _blockType: 'thinking' })) : [];
        
        // Filter out Write/Edit tools if we have diffs (they're redundant)
        const filteredToolBlocks = toolBlocks.filter(b => {
          const name = String(b?.toolName || '').toLowerCase();
          if ((name === 'write' || name === 'edit') && diffBlocks.length > 0) return false;
          return true;
        });
        
        // Combine and sort ALL blocks by atTextLen position (including thinking blocks)
        const allBlocks = [...diffBlocks, ...filteredToolBlocks, ...thinkingBlocks].sort((a, b) => {
          const posA = Number(a?.atTextLen || 0);
          const posB = Number(b?.atTextLen || 0);
          if (posA !== posB) return posA - posB;
          // Thinking blocks should come before other blocks at the same position
          if (a._blockType === 'thinking' && b._blockType !== 'thinking') return -1;
          if (b._blockType === 'thinking' && a._blockType !== 'thinking') return 1;
          // Stable order for same position: timestamp, then toolUseId
          const tA = Number(a?.timestamp || 0);
          const tB = Number(b?.timestamp || 0);
          return tA - tB;
        });
        
        // CRITICAL FIX: For PERSISTED messages, DON'T interleave based on atTextLen.
        // The atTextLen values were recorded during streaming based on `stream.text` positions,
        // but the final `content` is evt.finalText (Claude's summary), which is DIFFERENT text.
        // Trying to interleave would fragment the summary incorrectly.
        // 
        // Detection: A persisted (completed) message has streaming=false.
        // During live streaming, the streaming renderer handles interleaving naturally.
        // On restore, we render: blocks first (in timestamp order), then summary text last.
        const isPersistedMessage = msg.streaming !== true;
        const shouldSkipInterleaving = isPersistedMessage;
        
        // Helper to append a text segment as a content block
        const appendTextSegment = (text) => {
          if (!text || !text.trim()) return;
          const textBlock = document.createElement('div');
          textBlock.className = 'cc-content-block cc-success';
          textBlock.dataset.blockType = 'text';
          textBlock.innerHTML = `<div class="cc-text-block">${formatMessage(text)}</div>`;
          contentEl.appendChild(textBlock);
        };
        
        // Helper to append a thinking block
        const appendThinkingBlock = (b) => {
          const thinkingText = String(b?.text || '').trim();
          if (!thinkingText) return;
          
          // Format thinking content
          const formattedContent = (typeof window.formatThinkingText === 'function')
            ? window.formatThinkingText(thinkingText, { streaming: false })
            : formatMessage(thinkingText);
          
          const thinkingBlock = document.createElement('div');
          thinkingBlock.className = 'cc-content-block cc-success';
          thinkingBlock.dataset.blockType = 'thinking';
          thinkingBlock.innerHTML = `
            <details class="cc-thinking-inline">
              <summary class="cc-thinking-summary-inline">
                <span class="cc-thinking-label">Thought</span>
                <svg class="cc-thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </summary>
              <div class="cc-thinking-content-inline">${formattedContent}</div>
            </details>
          `;
          contentEl.appendChild(thinkingBlock);
        };
        
        // Helper to append a tool marker
        const appendTool = (b) => {
          try {
            const name = String(b?.toolName || 'Tool');
            // Strip leading ": " from preview (backend adds this prefix)
            let rawPreview = typeof b?.preview === 'string' ? b.preview : '';
            if (rawPreview.startsWith(': ')) rawPreview = rawPreview.slice(2);
            const preview = rawPreview;
            const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
            const clamp = (s, n = 200) => (s.length > n ? (s.slice(0, n - 1) + '…') : s);
            
            // Format tool display based on tool type (Claude Code style)
            let displayName = name;
            let detail = '';
            let filePath = '';
            
            // Map tool names to cleaner display and extract relevant info
            if (name === 'Write' || name === 'Edit') {
              // File operations - show file path prominently
              try {
                const parsed = JSON.parse(preview);
                filePath = parsed?.file_path || parsed?.filePath || '';
              } catch {
                // Try to extract file path from preview text
                const m = preview.match(/["']?(?:file_?path|path)["']?\s*[:=]\s*["']?([^"'\s,}]+)/i);
                if (m) filePath = m[1];
              }
              displayName = name;
              detail = filePath ? '' : clamp(oneLine(preview), 200);
            } else if (name === 'Bash' || name === 'bash') {
              // Command execution - show the command
              try {
                const parsed = JSON.parse(preview);
                detail = parsed?.command || '';
              } catch {
                detail = preview;
              }
              displayName = 'Bash';
              detail = clamp(oneLine(detail), 200);
            } else if (name === 'Read' || name === 'read') {
              // File read - show file path
              try {
                const parsed = JSON.parse(preview);
                filePath = parsed?.file_path || parsed?.filePath || parsed?.path || '';
              } catch {
                filePath = preview;
              }
              displayName = 'Read';
            } else if (name === 'TodoWrite' || name === 'todo_write') {
              // Task list - show task count and first task
              displayName = 'TodoWrite';
              try {
                let todos = [];
                if (preview.includes('"todos"') || preview.includes('"content"')) {
                  const parsed = JSON.parse(preview);
                  todos = Array.isArray(parsed.todos) ? parsed.todos : [];
                }
                if (todos.length > 0) {
                  const taskTexts = todos.map(t => t?.content || '').filter(Boolean);
                  if (taskTexts.length === 1) {
                    detail = taskTexts[0];
                  } else if (taskTexts.length > 1) {
                    detail = `${taskTexts.length} tasks: ${taskTexts[0]}, …`;
                  }
                  detail = clamp(oneLine(detail), 200);
                }
              } catch {
                detail = clamp(oneLine(preview), 200);
              }
            } else if (name === 'Grep' || name === 'grep' || name === 'Search' || name === 'search') {
              // Search operations - show pattern
              displayName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
              try {
                const parsed = JSON.parse(preview);
                detail = parsed?.pattern || parsed?.query || '';
              } catch {
                detail = preview;
              }
              detail = clamp(oneLine(detail), 200);
            } else {
              // Generic tool - show preview
              detail = clamp(oneLine(preview), 200);
            }

            // Claude Code style: tool as a content block with timeline
            const toolBlock = document.createElement('div');
            toolBlock.className = 'cc-content-block cc-success';
            toolBlock.dataset.blockType = 'tool';
            
            // Build content based on what we have
            let innerHtml = '<div class="cc-tool-block"><div class="cc-tool-header">';
            innerHtml += `<span class="cc-tool-name">${escapeHtml(displayName)}</span>`;
            if (filePath) {
              innerHtml += `<span class="cc-tool-detail">${escapeHtml(filePath)}</span>`;
            } else if (detail) {
              innerHtml += `<span class="cc-tool-detail">${escapeHtml(detail)}</span>`;
            }
            innerHtml += '</div></div>';
            
            toolBlock.innerHTML = innerHtml;
            contentEl.appendChild(toolBlock);
          } catch { /* ignore */ }
        };

        const appendDiff = (b) => {
          const fp = normalizeRelPathForDiffPreview(b?.filePath || '');
          const diff = typeof b?.diffContent === 'string' ? b.diffContent : '';
          if (!fp || !diff.trim()) return;
          if (isHiddenOrInternalPathForDiffPreview(fp)) return;

          const ext = getFileExtFromPath(fp);
          const badgeClass = getFilePreviewBadgeClass(ext);
          const { added, removed, isNewFile } = countDiffStats(diff);
          const diffStat = renderDiffStatHtml({ added, removed, isNewFile });
          const diffClass = (isNewFile || added > removed) ? 'stat-added' : 'stat-modified';
          // PERF: diff rendering is expensive; only render when user expands.
          let didRenderDiff = false;

          const blockDiv = document.createElement('div');
          blockDiv.className = 'message file-preview compact-cursor-style';
          blockDiv.innerHTML = `
            <div class="file-preview-header" data-file-path="${escapeAttr(fp)}">
              <button class="file-collapse-toggle" title="Toggle diff">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="file-badge badge-${badgeClass}">${ext.toUpperCase()}</div>
              <span class="file-preview-path">${escapeHtml(fp)}</span>
              <span class="file-diff-stat ${diffClass}" title="Open full diff">${diffStat}</span>
              <div class="file-header-spacer"></div>
              <button class="file-preview-open-btn-icon" data-path="${escapeAttr(fp)}" title="Open File">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </button>
            </div>
            <div class="file-preview-content" style="display: none"></div>
          `;

          const collapseToggle = blockDiv.querySelector('.file-collapse-toggle');
          const diffEl = blockDiv.querySelector('.file-preview-content');
          if (collapseToggle && diffEl) {
            const ensureDiffRendered = () => {
              if (didRenderDiff) return;
              didRenderDiff = true;
              diffEl.innerHTML = formatGitDiff(diff);
            };
            collapseToggle.addEventListener('click', (e) => {
              e.stopPropagation();
              const isCollapsed = diffEl.style.display === 'none';
              if (isCollapsed) ensureDiffRendered();
              diffEl.style.display = isCollapsed ? 'block' : 'none';
              collapseToggle.classList.toggle('expanded', isCollapsed);
            });
          }
          const openBtn = blockDiv.querySelector('.file-preview-open-btn-icon');
          if (openBtn) {
            openBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const rel = String(openBtn.dataset.path || '').trim();
              if (!rel || !window.currentFolder) return;
              const relNorm = normalizeRelPathForDiffPreview(rel);
              await openRelPathFromChat(relNorm, { jumpToDiff: true, diffContent: diff });
            });
          }
          const statEl = blockDiv.querySelector('.file-diff-stat');
          if (statEl) {
            statEl.addEventListener('click', async (e) => {
              e.stopPropagation();
              await openFullDiffForRelPath(fp);
            });
          }

          contentEl.appendChild(blockDiv);
        };

        // 4. INTERLEAVE: Render text segments between blocks at their atTextLen positions
        // This creates the proper timeline: thinking -> text -> tool -> thinking -> text -> tool -> text
        
        if (shouldSkipInterleaving) {
          // PERSISTED MESSAGE: Don't interleave based on atTextLen.
          // The atTextLen values are from streaming text, but content is the final summary.
          // Render: blocks (tools/files in timestamp order) -> summary text LAST
          // This matches what the user saw during streaming.
          
          // Sort blocks by timestamp for chronological order
          const blocksByTime = allBlocks.slice().sort((a, b) => {
            const tA = Number(a?.timestamp || 0);
            const tB = Number(b?.timestamp || 0);
            return tA - tB;
          });
          for (const b of blocksByTime) {
            if (b._blockType === 'diff') {
              appendDiff(b);
            } else if (b._blockType === 'tool') {
              appendTool(b);
            } else if (b._blockType === 'thinking') {
              appendThinkingBlock(b);
            }
          }
          // Render the summary text LAST (this is what Claude sends at the end of the run)
          if (fullText.trim()) {
            appendTextSegment(fullText);
          }
        } else {
          // STREAMING MESSAGE: atTextLen positions are valid, interleave blocks with text
          let textCursor = 0;
          
          for (const b of allBlocks) {
            const pos = Math.max(0, Math.min(fullText.length, Number(b?.atTextLen || 0)));
            
            // Render any text BEFORE this block's insertion point
            if (pos > textCursor) {
              appendTextSegment(fullText.slice(textCursor, pos));
              textCursor = pos;
            }
            
            // Render the block (diff, tool, or thinking)
            if (b._blockType === 'diff') {
              appendDiff(b);
            } else if (b._blockType === 'tool') {
              appendTool(b);
            } else if (b._blockType === 'thinking') {
              appendThinkingBlock(b);
            }
          }
          
          // Render any remaining text after the last block
          if (textCursor < fullText.length) {
            appendTextSegment(fullText.slice(textCursor));
          }
        }
        
        // If no blocks at all, just render the full text
        if (allBlocks.length === 0 && fullText.trim()) {
          appendTextSegment(fullText);
        }
      }

      appendChatNode(messagesContainer, messageDiv, { roleHint: 'assistant' });
      addCodeBlockActions(messageDiv);
      return;
    }

    messageDiv.innerHTML = `${thoughtContent}`;

    const messageContentDiv = document.createElement('div');
    messageContentDiv.className = 'message-content';

    if (msg.role === 'user') {
      const attachmentsEl = buildMessageAttachmentsElement(msg.attachments);
      if (attachmentsEl) messageContentDiv.appendChild(attachmentsEl);
    }

    // Claude Code run metadata (skills/subagents) — persisted on assistant messages.
    if (msg.role === 'assistant' && msg.runMeta && typeof msg.runMeta === 'object') {
      try {
        const meta = msg.runMeta;
        const chips = [];
        const subTypes = Array.isArray(meta.subagentTypes) ? meta.subagentTypes.filter(Boolean) : [];
        if (subTypes.length > 0) {
          const label = subTypes.length === 1 ? 'subagent' : 'subagents';
          const value = subTypes.length === 1 ? String(subTypes[0]) : String(subTypes.length);
          chips.push(
            `<span class="run-meta-chip" title="Subagents used during this run"><span class="chip-label">${escapeHtml(label)}</span><span class="chip-value">${escapeHtml(value)}</span></span>`
          );
        }
        const skills = Array.isArray(meta.skills) ? meta.skills : [];
        for (const s of skills.slice(0, 3)) {
          const name = s && typeof s.name === 'string' ? s.name.trim() : '';
          const count = s && Number.isFinite(Number(s.count)) ? Number(s.count) : 0;
          if (!name) continue;
          const suffix = count > 1 ? ` ×${count}` : '';
          chips.push(
            `<span class="run-meta-chip" title="Skill invoked"><span class="chip-label">skill</span><span class="chip-value">/${escapeHtml(name)}${escapeHtml(suffix)}</span></span>`
          );
        }
        if (chips.length > 0) {
          const bar = document.createElement('div');
          bar.className = 'run-meta-bar';
          bar.innerHTML = chips.join('');
          messageContentDiv.appendChild(bar);
        }
      } catch { /* ignore */ }
    }

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.innerHTML = formatMessage(msg.content);
    messageContentDiv.appendChild(textDiv);

    messageDiv.appendChild(messageContentDiv);

    // Add Restore Button to User Messages
    if (msg.role === 'user' && msg.commitHash) {
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'restore-btn restore-btn--icon restore-btn--float';
      restoreBtn.title = 'Restore to this checkpoint';
      restoreBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
      `;
      restoreBtn.onclick = () => restoreToUserCheckpoint(msg.commitHash, messageDiv, msg.content, msg.attachments || []);
      messageDiv.appendChild(restoreBtn);
    }

    appendChatNode(messagesContainer, messageDiv, { roleHint: msg.role });
    if (msg.role === 'user') {
      wireUserMessageCollapse(messageDiv);
    }

    // Add action buttons to code blocks if this is an AI message
    if (msg.role === 'assistant') {
      addCodeBlockActions(messageDiv);
    }
  } else if (msg.role === 'assistant_partial') {
    // Persisted streaming snapshot (e.g. app closed mid-run). UI-only; not sent to API.
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant assistant-partial-snapshot';

    const stream = msg.stream && typeof msg.stream === 'object' ? msg.stream : {};
    const text = typeof stream.text === 'string' ? stream.text : (typeof msg.content === 'string' ? msg.content : '');
    const thinking = typeof stream.thinking === 'string' ? stream.thinking : '';
    const planned = Array.isArray(stream.plannedToolNames) ? stream.plannedToolNames : [];
    const unique = Array.from(new Set(planned)).slice(0, 12);
    const blocks = Array.isArray(stream.diffBlocks) ? stream.diffBlocks : [];

    // Thinking section (if present) - Claude Code style with "Thinking (interrupted)"
    let thoughtContent = '';
    if (thinking && thinking.trim()) {
      const formattedContent = (typeof window.formatThinkingText === 'function')
        ? window.formatThinkingText(thinking, { streaming: false })
        : formatMessage(thinking);
      
      thoughtContent = `
        <details class="cc-thinking" open>
          <summary class="cc-thinking-summary">
            <span class="cc-thinking-label">Thinking (interrupted)</span>
            <svg class="cc-thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </summary>
          <div class="cc-thinking-content">${formattedContent}</div>
        </details>
      `;
    }

    // Tools section (if present) - Claude Code style
    let toolsContent = '';
    if (unique.length > 0) {
      const list = unique.map(n => `- <code>${escapeHtml(String(n))}</code>`).join('\n');
      toolsContent = `
        <details class="cc-thinking" open>
          <summary class="cc-thinking-summary">
            <span class="cc-thinking-label">Used ${unique.length} tool${unique.length === 1 ? '' : 's'} (interrupted)</span>
            <svg class="cc-thinking-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </summary>
          <div class="cc-thinking-content">
            <div class="tool-status">
              Tools used (${unique.length}):<br/>
              <div class="tool-list">${list}</div>
            </div>
          </div>
        </details>
      `;
    }

    messageDiv.innerHTML = `
      ${thoughtContent}
      ${toolsContent}
      <div class="message-content"></div>
    `;

    const contentEl = messageDiv.querySelector('.message-content');
    if (contentEl) {
      // Claude Code style: render text first as one continuous block, then diff blocks
      const fullText = String(text || '');
      
      // 1. Render the full text content as a content block (if any)
      if (fullText.trim()) {
        const textBlock = document.createElement('div');
        textBlock.className = 'cc-content-block cc-warning'; // warning state for interrupted
        textBlock.dataset.blockType = 'text';
        textBlock.innerHTML = `<div class="cc-text-block">${formatMessage(fullText)}</div>`;
        contentEl.appendChild(textBlock);
      }

      const appendDiff = (b) => {
        const fp = normalizeRelPathForDiffPreview(b?.filePath || '');
        const diff = typeof b?.diffContent === 'string' ? b.diffContent : '';
        if (!fp || !diff.trim()) return;
        if (isHiddenOrInternalPathForDiffPreview(fp)) return;

        const ext = getFileExtFromPath(fp);
        const badgeClass = getFilePreviewBadgeClass(ext);
        const { added, removed, isNewFile } = countDiffStats(diff);
        const diffStat = renderDiffStatHtml({ added, removed, isNewFile });
        const diffClass = (isNewFile || added > removed) ? 'stat-added' : 'stat-modified';
        const formattedDiff = formatGitDiff(diff);

        const blockDiv = document.createElement('div');
        blockDiv.className = 'message file-preview compact-cursor-style';
        blockDiv.innerHTML = `
          <div class="file-preview-header" data-file-path="${escapeAttr(fp)}">
            <button class="file-collapse-toggle" title="Toggle diff">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div class="file-badge badge-${badgeClass}">${ext.toUpperCase()}</div>
            <span class="file-preview-path">${escapeHtml(fp)}</span>
            <span class="file-diff-stat ${diffClass}" title="Open full diff">${diffStat}</span>
            <div class="file-header-spacer"></div>
            <button class="file-preview-open-btn-icon" data-path="${escapeAttr(fp)}" title="Open File">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
          </div>
          <div class="file-preview-content" style="display: none">
            ${formattedDiff}
          </div>
        `;

        // Wire handlers (same behavior as other file previews)
        const collapseToggle = blockDiv.querySelector('.file-collapse-toggle');
        const diffEl = blockDiv.querySelector('.file-preview-content');
        if (collapseToggle && diffEl) {
          collapseToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = diffEl.style.display === 'none';
            diffEl.style.display = isCollapsed ? 'block' : 'none';
            collapseToggle.classList.toggle('expanded', isCollapsed);
          });
        }
        const openBtn = blockDiv.querySelector('.file-preview-open-btn-icon');
        if (openBtn) {
          openBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const rel = String(openBtn.dataset.path || '').trim();
            if (!rel || !window.currentFolder) return;
            const relNorm = normalizeRelPathForDiffPreview(rel);
            await openRelPathFromChat(relNorm, { jumpToDiff: true, diffContent: diff });
          });
        }

        const statEl = blockDiv.querySelector('.file-diff-stat');
        if (statEl) {
          statEl.addEventListener('click', async (e) => {
            e.stopPropagation();
            await openFullDiffForRelPath(fp);
          });
        }

        contentEl.appendChild(blockDiv);
      };

      // 2. Render all diff blocks (Claude Code style - after text, not interleaved)
      for (const b of blocks) {
        appendDiff(b);
      }
    }

    appendChatNode(messagesContainer, messageDiv, { roleHint: 'assistant' });
    addCodeBlockActions(messageDiv);
  } else if (msg.role === 'file_preview') {
    // Render file preview with diff from history
    const safeFp = normalizeRelPathForDiffPreview(msg.filePath || '');
    if (!safeFp || isHiddenOrInternalPathForDiffPreview(safeFp)) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message file-preview compact-cursor-style';

    // Use saved diff content - this is crucial for historical diffs
    // The diff was captured at the time of the change and saved
    let diffContent = msg.diffContent || '';
    
    const isCollapsed = true; // Start collapsed by default
    const stats = countDiffStats(diffContent);
    const diffStatHtml = renderDiffStatHtml(stats);
    let didRenderDiff = false;

    messageDiv.innerHTML = `
      <div class="file-preview-header" data-file-path="${escapeAttr(safeFp)}">
        <button class="file-collapse-toggle" title="Toggle diff">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="file-badge badge-${msg.badgeClass}">${msg.fileExt.toUpperCase()}</div>
        <span class="file-preview-path">${escapeHtml(msg.fileName)}</span>
        <span class="file-diff-stat ${msg.diffClass}" title="Open full diff">${diffStatHtml}</span>
        <div class="file-header-spacer"></div>
        <button class="file-preview-open-btn-icon" data-path="${escapeAttr(safeFp)}" title="Open File">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </button>
      </div>
      <div class="file-preview-content" style="display: ${isCollapsed ? 'none' : 'block'}"></div>
    `;

    // Add collapse toggle handler
    const collapseToggle = messageDiv.querySelector('.file-collapse-toggle');
    const contentDiv = messageDiv.querySelector('.file-preview-content');
    
    if (collapseToggle && contentDiv) {
      const ensureDiffRendered = () => {
        if (didRenderDiff) return;
        didRenderDiff = true;
        contentDiv.innerHTML = formatGitDiff(diffContent);
      };
      collapseToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCurrentlyCollapsed = contentDiv.style.display === 'none';
        
        if (isCurrentlyCollapsed) {
          ensureDiffRendered();
          contentDiv.style.display = 'block';
          collapseToggle.classList.add('expanded');
        } else {
          contentDiv.style.display = 'none';
          collapseToggle.classList.remove('expanded');
        }
      });
    }

    // Add click handler for open button
    const openBtn = messageDiv.querySelector('.file-preview-open-btn-icon');
    if (openBtn) {
      openBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await openRelPathFromChat(safeFp, { jumpToDiff: true, diffContent });
      });
    }

    const statEl = messageDiv.querySelector('.file-diff-stat');
    if (statEl) {
      statEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        await openFullDiffForRelPath(safeFp);
      });
    }

    appendChatNode(messagesContainer, messageDiv, { roleHint: 'assistant' });
  } else if (msg.role === 'file_operation') {
    // Render file operation message
    const icons = {
      'create': '📄',
      'create_folder': '📁',
      'rename': '✏️',
      'rename_folder': '📁✏️',
      'delete': '🗑️',
      'delete_folder': '📁🗑️'
    };

    const descriptions = {
      'create': `Created file: ${msg.itemName}`,
      'create_folder': `Created folder: ${msg.itemName}`,
      'rename': `Renamed file: ${msg.itemName}`,
      'rename_folder': `Renamed folder: ${msg.itemName}`,
      'delete': `Deleted file: ${msg.itemName}`,
      'delete_folder': `Deleted folder: ${msg.itemName}`
    };

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system file-operation';

    messageDiv.innerHTML = `
      <div class="message-header" style="display: flex; justify-content: space-between; align-items: center;">
        <span>${icons[msg.operation] || '📝'} ${descriptions[msg.operation]}</span>
        <button class="restore-btn" data-before-commit="${msg.beforeCommit}" data-operation="${msg.operation}" data-path="${msg.newPath}" data-old-path="${msg.oldPath || ''}">
          ⏮️ Undo
        </button>
      </div>
    `;

    // Add restore functionality
    const restoreBtn = messageDiv.querySelector('.restore-btn');
    restoreBtn.addEventListener('click', async () => {
      if (await customConfirm(`Undo this operation: ${descriptions[msg.operation]}?`)) {
        await restoreFileOperation(msg.beforeCommit, msg.operation, msg.newPath, msg.oldPath);
        restoreBtn.disabled = true;
        restoreBtn.textContent = '✓ Undone';
        restoreBtn.style.opacity = '0.5';
      }
    });

    appendChatNode(messagesContainer, messageDiv, { roleHint: 'assistant' });
  } else if (msg.role === 'apply_review') {
    // Legacy: older versions stored a Keep/Discard apply review card. Shadow worktrees were removed,
    // so we simply ignore these messages going forward.
    return;
  } else if (msg.role === 'git_op_recovery') {
    if (msg.dismissed === true) return;
    const op = String(msg.op || 'git').trim();
    const conflicts = Array.isArray(msg.conflictFiles) ? msg.conflictFiles.filter(Boolean).slice(0, 30) : [];
    const before = String(msg.beforeCommit || '').trim();
    const noteText = String(msg.note || '').trim();

    const title =
      op === 'cherry-pick' ? '⚠️ Git cherry-pick needs resolution' :
      op === 'merge' ? '⚠️ Git merge needs resolution' :
      op === 'rebase' ? '⚠️ Git rebase needs resolution' :
      '⚠️ Git operation needs resolution';

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system git-op-recovery';
    const conflictList = conflicts.length
      ? `<div style="margin-top:8px; opacity:0.9;">
           <div style="font-weight:600; margin-bottom:4px;">Conflicts (${conflicts.length})</div>
           <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; white-space: pre-wrap;">${escapeHtml(conflicts.join('\n'))}</div>
         </div>`
      : `<div style="margin-top:8px; opacity:0.85;">Resolve conflicts in your working tree, then Continue.</div>`;

    messageDiv.innerHTML = `
      <div class="message-content system-message">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div>
            <div style="font-weight:600; margin-bottom:4px;">${title}</div>
            ${noteText ? `<div style="opacity:0.85;">${escapeHtml(noteText)}</div>` : `<div style="opacity:0.85;">Resolve conflicts, then Continue. Or Abort to rollback.</div>`}
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="restore-btn" data-action="open">Open conflicts</button>
            <button class="restore-btn" data-action="continue">Continue</button>
            <button class="restore-btn" data-action="abort" style="background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.35); color: #fecaca;">Abort</button>
          </div>
        </div>
        ${conflictList}
      </div>
    `;

    const openBtn = messageDiv.querySelector('button[data-action="open"]');
    const contBtn = messageDiv.querySelector('button[data-action="continue"]');
    const abortBtn = messageDiv.querySelector('button[data-action="abort"]');

    const dismiss = async () => {
      msg.dismissed = true;
      try { await saveChatHistory(true); } catch { /* ignore */ }
      try { messageDiv.remove(); } catch { /* ignore */ }
    };

    if (openBtn) {
      openBtn.addEventListener('click', async () => {
        openBtn.disabled = true;
        try {
          const first = conflicts[0];
          if (first) await openFile(first);
        } finally {
          try { openBtn.disabled = false; } catch { /* ignore */ }
        }
      });
    }

    if (contBtn) {
      contBtn.addEventListener('click', async () => {
        if (!window.electronAPI) return;
        contBtn.disabled = true;
        try {
          await withGitOperationLock(async () => {
            if (op === 'cherry-pick') {
              const r = await window.electronAPI.runTerminalCommand('git cherry-pick --continue', true);
              if (!r || r.success !== true) throw new Error(r?.error || r?.output || 'Continue failed');
            } else if (op === 'merge') {
              // Merge continue is just commit if needed; attempt a normal commit of current index.
              const r = await window.electronAPI.runTerminalCommand('git commit --no-edit', true);
              if (!r || r.success !== true) throw new Error(r?.error || r?.output || 'Continue failed');
            } else if (op === 'rebase') {
              const r = await window.electronAPI.runTerminalCommand('git rebase --continue', true);
              if (!r || r.success !== true) throw new Error(r?.error || r?.output || 'Continue failed');
            }
          });

          await dismiss();
        } catch (e) {
          await customAlert(`Continue failed: ${e?.message || String(e)}`, 'Git Continue Failed');
        } finally {
          try { contBtn.disabled = false; } catch { /* ignore */ }
        }
      });
    }

    if (abortBtn) {
      abortBtn.addEventListener('click', async () => {
        if (!await customConfirm('Abort this git operation and rollback?', 'Abort Git Operation')) return;
        abortBtn.disabled = true;
        try {
          await abortGitOpIfAny();
          if (before) {
            await restoreToCheckpoint(before);
          }
          await dismiss();
        } catch (e) {
          await customAlert(`Abort failed: ${e?.message || String(e)}`, 'Abort Failed');
        } finally {
          try { abortBtn.disabled = false; } catch { /* ignore */ }
        }
      });
    }

    appendChatNode(messagesContainer, messageDiv, { roleHint: 'assistant' });
  } else if (msg.role === 'tool_execution') {
    // IMPORTANT: When loading from history, don't re-create file previews!
    // File previews are saved as separate 'file_preview' messages with the diff content
    // Re-creating them would:
    // 1. Create duplicates
    // 2. Try to get diffs that no longer exist (already committed)
    // 3. Result in empty "No changes" previews
    
    // Only render non-file-modification tool executions
    if (msg.result && msg.result.success) {
      // Show generated image preview (images are special, not file modifications)
      if (msg.toolName === 'generate_image') {
        await showGeneratedImagePreview(msg.result, msg.args);
      }
      // Don't render file modification previews here - they're already in history as file_preview messages
    } else {
      console.warn('[UI] Skipping failed or invalid tool execution message:', msg);
    }
  } else if (msg.role === 'tool_receipt') {
    // tool_receipt messages are intentionally NOT rendered here.
    // They have seq numbers AFTER the assistant message, which would make them
    // appear after the completion text. But during streaming, tools appear BEFORE
    // the completion text.
    //
    // Instead, tool_receipt messages are MERGED into the assistant message's
    // toolBlocks when rendering the assistant message (see below).
    // This keeps the visual order consistent with what the user saw during streaming.
    return;
  }
  // Tool messages (role='tool') are not rendered in UI (they're in history for API context only)
}
