// ============================================================================
// RUN NEEDS ANALYSIS (Smart Detection for Learning/Docs/Verification)
// Determines if a completed run warrants learning/docs/verification generation
// ============================================================================

(function () {
  'use strict';

  if (window._runNeedsAnalysis) return;

  // ===========================================================================
  // CONSTANTS & PATTERNS
  // ===========================================================================

  // Tool names that indicate meaningful code work was done
  const CODE_TOOLS = new Set([
    // File operations
    'write', 'write_to_file', 'write_file', 'create_file',
    'str_replace', 'str_replace_editor', 'edit', 'edit_file', 'patch',
    'insert', 'insert_code_block',
    'delete_file', 'remove_file',
    'rename', 'rename_file', 'move', 'move_file',
    // Terminal/execution
    'bash', 'execute', 'run', 'run_command', 'terminal', 'shell',
    'execute_bash', 'run_bash',
    // Git operations
    'git', 'git_commit', 'git_add', 'git_checkout',
    // Package management
    'npm', 'yarn', 'pip', 'cargo',
    // Build/compile
    'build', 'compile', 'make',
    // Test execution
    'test', 'run_tests', 'execute_tests'
  ]);

  // Read-only tools that don't warrant full analysis
  const READ_ONLY_TOOLS = new Set([
    'read', 'read_file', 'cat', 'view', 'view_file',
    'list', 'list_dir', 'ls', 'dir',
    'search', 'grep', 'find', 'glob',
    'web_search', 'browser', 'navigate',
    'think', 'reasoning', 'plan'
  ]);

  // Patterns that indicate simple greetings or non-coding messages
  const SIMPLE_MESSAGE_PATTERNS = [
    /^\s*h(i|ello|ey|owdy)\s*[!.,]?\s*$/i,
    /^\s*(good\s*)?(morning|afternoon|evening|night)\s*[!.,]?\s*$/i,
    /^\s*(what'?s?\s+up|sup|yo)\s*[!.,]?\s*$/i,
    /^\s*(how\s+are\s+you|how('?re)?\s+you\s+doing)\s*[?!.,]?\s*$/i,
    /^\s*(thanks?|thank\s+you|ty|thx)\s*[!.,]?\s*$/i,
    /^\s*(yes|no|ok|okay|sure|cool|nice|great|awesome|perfect)\s*[!.,]?\s*$/i,
    /^\s*(bye|goodbye|see\s+you|later)\s*[!.,]?\s*$/i,
    /^\s*(please|pls)\s*$/i,
    /^\s*[\u{1F44B}\u{1F44D}\u{1F44E}\u{1F64F}\u{1F389}\u{2705}\u{274C}\u{1F60A}\u{1F914}]+\s*$/u,
    /^\s*\?\s*$/  // Just a question mark
  ];

  // Patterns that indicate questions (might not need docs/learning)
  const QUESTION_PATTERNS = [
    /^(what|who|where|when|why|how|which|can|could|would|should|is|are|do|does|did|have|has|will)\s/i,
    /\?\s*$/
  ];

  // Patterns that strongly indicate coding intent
  const CODING_INTENT_PATTERNS = [
    /\b(create|build|make|implement|add|write|fix|debug|refactor|update|modify|change|remove|delete|rename)\s/i,
    /\b(function|class|component|module|file|folder|directory|api|endpoint|route)\b/i,
    /\b(bug|error|issue|problem|crash|fail|broken)\b/i,
    /\b(test|spec|lint|format|compile|deploy|run)\b/i,
    /\.(js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|css|html|json|yaml|yml|md|sql)\b/i,
    /```[\s\S]*```/,  // Code blocks
    /`[^`]+`/         // Inline code
  ];

  // ===========================================================================
  // ANALYSIS FUNCTIONS
  // ===========================================================================

  /**
   * Check if a prompt is a simple greeting or trivial message
   */
  function isSimpleMessage(prompt) {
    if (!prompt || typeof prompt !== 'string') return true;
    const trimmed = prompt.trim();
    if (!trimmed) return true;
    // Very short messages are likely simple
    if (trimmed.length < 5) return true;
    // Check against simple patterns
    for (const pattern of SIMPLE_MESSAGE_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }
    return false;
  }

  /**
   * Check if prompt shows coding intent
   */
  function hasCodingIntent(prompt) {
    if (!prompt || typeof prompt !== 'string') return false;
    const trimmed = prompt.trim();
    for (const pattern of CODING_INTENT_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }
    return false;
  }

  /**
   * Check if prompt is primarily a question
   */
  function isPureQuestion(prompt) {
    if (!prompt || typeof prompt !== 'string') return false;
    const trimmed = prompt.trim();
    // If it has coding intent, it's not just a question
    if (hasCodingIntent(trimmed)) return false;
    // Check if it looks like a question
    for (const pattern of QUESTION_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }
    return false;
  }

  /**
   * Check if any tools used indicate meaningful code work
   */
  function hasCodeTools(toolsUsed) {
    if (!Array.isArray(toolsUsed) || toolsUsed.length === 0) return false;
    for (const tool of toolsUsed) {
      const name = String(tool || '').toLowerCase().trim();
      if (!name) continue;
      // Check exact match first
      if (CODE_TOOLS.has(name)) return true;
      // Check if any code tool is a substring (handles variations)
      for (const codeTool of CODE_TOOLS) {
        if (name.includes(codeTool)) return true;
      }
    }
    return false;
  }

  /**
   * Check if only read-only tools were used
   */
  function hasOnlyReadOnlyTools(toolsUsed) {
    if (!Array.isArray(toolsUsed) || toolsUsed.length === 0) return true;
    for (const tool of toolsUsed) {
      const name = String(tool || '').toLowerCase().trim();
      if (!name) continue;
      // If it's not a read-only tool and not empty, return false
      let isReadOnly = false;
      for (const roTool of READ_ONLY_TOOLS) {
        if (name.includes(roTool)) {
          isReadOnly = true;
          break;
        }
      }
      if (!isReadOnly) return false;
    }
    return true;
  }

  /**
   * Check if files were modified
   */
  function hasFileModifications(filesModified) {
    if (!Array.isArray(filesModified)) return false;
    return filesModified.filter(f => f && typeof f === 'string' && f.trim()).length > 0;
  }

  // ===========================================================================
  // MAIN ANALYSIS
  // ===========================================================================

  /**
   * Analyze a completed run and determine what features should be triggered.
   * 
   * @param {Object} runPayload - The run completion payload
   * @param {string} runPayload.originalPrompt - The user's original message
   * @param {string[]} runPayload.toolsUsed - Tools used during the run
   * @param {string[]} runPayload.filesModified - Files modified during the run
   * @returns {Object} Analysis result with needs flags
   */
  function analyzeRun(runPayload) {
    const result = {
      needsLearning: false,
      needsDocs: false,
      needsVerification: false,
      reason: '',
      confidence: 'low', // 'low' | 'medium' | 'high'
      details: {}
    };

    if (!runPayload || typeof runPayload !== 'object') {
      result.reason = 'No run payload provided';
      return result;
    }

    const {
      originalPrompt = '',
      toolsUsed = [],
      filesModified = []
    } = runPayload;

    // Store analysis details
    result.details = {
      promptLength: String(originalPrompt || '').length,
      toolCount: Array.isArray(toolsUsed) ? toolsUsed.length : 0,
      fileCount: Array.isArray(filesModified) ? filesModified.length : 0,
      isSimple: false,
      isPureQuestion: false,
      hasCodingIntent: false,
      hasCodeTools: false,
      hasFileChanges: false
    };

    // === Analysis Steps ===

    // 1. Check for simple messages (greetings, etc.)
    if (isSimpleMessage(originalPrompt)) {
      result.details.isSimple = true;
      result.reason = 'Simple greeting or trivial message';
      result.confidence = 'high';
      return result;
    }

    // 2. Check for pure questions without coding intent
    const pureQuestion = isPureQuestion(originalPrompt);
    result.details.isPureQuestion = pureQuestion;

    // 3. Check for coding intent in prompt
    const codingIntent = hasCodingIntent(originalPrompt);
    result.details.hasCodingIntent = codingIntent;

    // 4. Check tools used
    const codeToolsUsed = hasCodeTools(toolsUsed);
    result.details.hasCodeTools = codeToolsUsed;

    // 5. Check file modifications
    const fileChanges = hasFileModifications(filesModified);
    result.details.hasFileChanges = fileChanges;

    // === Decision Logic ===

    // High confidence triggers: actual code work happened
    if (fileChanges || codeToolsUsed) {
      result.needsLearning = true;
      result.needsDocs = true;
      result.needsVerification = true;
      result.confidence = 'high';
      
      if (fileChanges && codeToolsUsed) {
        result.reason = 'Files modified and code tools used';
      } else if (fileChanges) {
        result.reason = 'Files were modified';
      } else {
        result.reason = 'Code tools were used';
      }
      return result;
    }

    // Medium confidence: strong coding intent but no visible changes yet
    if (codingIntent && toolsUsed.length > 0) {
      result.needsLearning = true;
      result.needsDocs = false;  // Only trigger docs if files changed
      result.needsVerification = false;  // Only verify if files changed
      result.confidence = 'medium';
      result.reason = 'Coding intent with tool usage (no file changes detected)';
      return result;
    }

    // If it's just a question with no tools, skip everything
    if (pureQuestion && toolsUsed.length === 0) {
      result.reason = 'Pure question with no tool usage';
      result.confidence = 'high';
      return result;
    }

    // If only read-only tools were used
    if (toolsUsed.length > 0 && hasOnlyReadOnlyTools(toolsUsed)) {
      // Learning might still be useful for read operations (user is exploring)
      result.needsLearning = true;
      result.needsDocs = false;
      result.needsVerification = false;
      result.confidence = 'medium';
      result.reason = 'Read-only operations (exploration)';
      return result;
    }

    // Default: if tools were used but no clear signal, be cautious
    if (toolsUsed.length > 0) {
      result.needsLearning = true;
      result.needsDocs = false;
      result.needsVerification = false;
      result.confidence = 'low';
      result.reason = 'Tools used but unclear intent';
      return result;
    }

    // No tools, no file changes, not simple, not a pure question
    // This might be a discussion about code or planning
    if (codingIntent) {
      result.needsLearning = true;
      result.needsDocs = false;
      result.needsVerification = false;
      result.confidence = 'low';
      result.reason = 'Coding discussion (no tools or changes)';
      return result;
    }

    // Default: skip everything for general conversation
    result.reason = 'General conversation - no coding work detected';
    result.confidence = 'medium';
    return result;
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Quick check if learning should be triggered
   */
  function shouldTriggerLearning(runPayload) {
    const analysis = analyzeRun(runPayload);
    return analysis.needsLearning;
  }

  /**
   * Quick check if docs should be triggered
   */
  function shouldTriggerDocs(runPayload) {
    const analysis = analyzeRun(runPayload);
    return analysis.needsDocs;
  }

  /**
   * Quick check if verification should be triggered
   */
  function shouldTriggerVerification(runPayload) {
    const analysis = analyzeRun(runPayload);
    return analysis.needsVerification;
  }

  // ===========================================================================
  // EXPOSE API
  // ===========================================================================

  window._runNeedsAnalysis = {
    // Main analysis function
    analyzeRun,
    // Quick checks
    shouldTriggerLearning,
    shouldTriggerDocs,
    shouldTriggerVerification,
    // Utility functions (for testing/debugging)
    isSimpleMessage,
    isPureQuestion,
    hasCodingIntent,
    hasCodeTools,
    hasOnlyReadOnlyTools,
    hasFileModifications
  };

})();
