// ---- CHUNK 7/7 from hoisted.js (AST statement boundaries; order preserved) ----



// Handle save file as
async function handleSaveFileAs(filePath) {
  if (!editor) return;

  const content = editor.getValue();
  if (window.electronAPI) {
    const result = await window.electronAPI.writeFile(filePath, content);
    if (result.success) {
      currentFile = filePath;
      document.getElementById('currentFilePath').textContent = filePath.split(/[/\\]/).pop();
    } else {
      alert('Error saving file: ' + result.error);
    }
  }
}


// Settings modal
function openSettings() {
  document.getElementById('settingsModal').style.display = 'flex';
  applyClaudeAuthSettingsUI({ refreshStatus: true });
}


function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}


function applyEditorEnhancementsSettingsUI() {
  const problemsTab = document.getElementById('problemsTab');
  const problemsContent = document.getElementById('problemsContent');
  const aiRow = document.getElementById('aiQuickFixRow');
  const aiToggle = document.getElementById('enableAiQuickFixesToggle');
  const tsRow = document.getElementById('tsJsLanguageServiceRow');
  const tsToggle = document.getElementById('enableTsJsLanguageServiceToggle');
  const webToggle = document.getElementById('enableWebLanguageServicesToggle');

  const problemsEnabled = settings?.enableProblemsPanel === true;

  // Gate AI toggle behind Problems toggle (prevents "isolated" usage)
  if (aiRow) {
    aiRow.style.opacity = problemsEnabled ? '' : '0.5';
    aiRow.style.pointerEvents = problemsEnabled ? '' : 'none';
  }
  if (aiToggle && !problemsEnabled) aiToggle.checked = false;
  if (!problemsEnabled) settings.enableAiQuickFixes = false;

  // TS/JS service is independent (but best when Problems is enabled). Keep it available.
  if (tsRow) {
    tsRow.style.opacity = '';
    tsRow.style.pointerEvents = '';
  }
  if (tsToggle) tsToggle.checked = settings?.enableTsJsLanguageService === true;
  if (webToggle) webToggle.checked = settings?.enableWebLanguageServices === true;

  // Show/hide Problems tab and content
  if (problemsTab) problemsTab.style.display = problemsEnabled ? '' : 'none';
  if (problemsContent) problemsContent.style.display = problemsEnabled ? '' : 'none';

  // If we disabled Problems while it was active, fall back to Console tab.
  if (!problemsEnabled) {
    try { problemsTab?.classList?.remove?.('active'); } catch { /* ignore */ }
    try { problemsContent?.classList?.remove?.('active'); } catch { /* ignore */ }
    try {
      const active = document.querySelector('.console-tab.active');
      const isProblems = active && active.getAttribute('data-tab') === 'problems';
      if (isProblems) {
        const logTab = document.querySelector('.console-tab[data-tab="log"]');
        logTab?.click?.();
      }
    } catch { /* ignore */ }
    return;
  }

  // When enabled, ensure rendering is wired and up-to-date.
  try { setupProblemsOnce(); } catch { /* ignore */ }
  try { scheduleRenderProblemsView(); } catch { /* ignore */ }
  try { scheduleProjectProblemsScan('settings'); } catch { /* ignore */ }

  // If HTML is open, refresh embedded <script> validation (it is gated by settings).
  try {
    for (const tab of (editorTabs || [])) {
      if (!tab || !tab.model) continue;
      const lid = String(tab.model.getLanguageId?.() || '').toLowerCase();
      if (lid === 'html') {
        try { bindHtmlEmbeddedScriptValidationForTab(tab); } catch { /* ignore */ }
        try { void validateEmbeddedScriptsInHtmlModel(tab); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function configureMonacoTsJsServiceOnce() {
  if (__tsJsServiceConfigured) return;
  __tsJsServiceConfigured = true;

  try {
    if (typeof monaco === 'undefined' || !monaco?.languages?.typescript) return;
    const ts = monaco.languages.typescript;

    // Monaco’s TS/JS language service runs in a sandbox and does not truly resolve Node/Vite deps
    // from disk like a real build. If we enable strict+checkJs semantic diagnostics for JS,
    // users see noisy false-positives (e.g. TS2307 "Cannot find module ...") even when the app runs.
    //
    // Approach:
    // - TS: keep semantic + syntax diagnostics (useful and typically accurate within the file graph).
    // - JS: keep syntax diagnostics, but disable semantic diagnostics to avoid dependency-resolution noise.
    const baseCompilerOptions = {
      allowNonTsExtensions: true,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      resolveJsonModule: true,
      noEmit: true,
      // Skip checking declaration files - reduces false positives from type dependencies
      skipLibCheck: true,
      // Don't error on implicit any - common in projects without strict types
      noImplicitAny: false,
      // Allow importing JSON modules
      allowSyntheticDefaultImports: true
    };

    const tsCompilerOptions = {
      ...baseCompilerOptions,
      strict: false // Relax strict mode to reduce false positives in Monaco
    };
    const jsCompilerOptions = {
      ...baseCompilerOptions,
      allowJs: true,
      // Do NOT type-check JS by default; it tends to create misleading module/type errors in Monaco.
      checkJs: false,
      strict: false
    };

    ts.typescriptDefaults.setCompilerOptions(tsCompilerOptions);
    ts.javascriptDefaults.setCompilerOptions(jsCompilerOptions);

    // Enable semantic + syntax validation. These feed Monaco markers → Problems panel.
    // Ignore module resolution errors since Monaco can't resolve Node modules from disk.
    // TS2307: Cannot find module 'X'
    // TS2304: Cannot find name 'X' (often related to missing types)
    // TS7016: Could not find a declaration file for module 'X'
    // TS2792: Cannot find module 'X'. Did you mean to set moduleResolution to 'node16'?
    // TS7044: Parameter 'x' implicitly has an 'any' type, but a better type may be inferred
    // TS7006: Parameter 'x' implicitly has an 'any' type.
    // TS7031: Binding element 'x' implicitly has an 'any' type.
    // TS7034: Variable 'x' implicitly has type 'any' in some locations
    const moduleResolutionErrorCodes = [2307, 2304, 7016, 2792, 2305, 2306, 2311, 2694, 2503, 7044, 7006, 7031, 7034];
    
    ts.typescriptDefaults.setDiagnosticsOptions({
      // CHANGED: Disable semantic validation to prevent crashes.
      // Monaco's TS semantic analysis is very resource-intensive and can crash
      // the renderer when many files are open or during AI runs.
      // Syntax validation catches the most important errors (actual syntax bugs).
      noSemanticValidation: true,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: moduleResolutionErrorCodes
    });
    ts.javascriptDefaults.setDiagnosticsOptions({
      // JS semantic diagnostics in Monaco frequently include false-positive missing-module errors.
      // Keep syntax-only so Problems matches what actually matters at runtime.
      noSemanticValidation: true,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: moduleResolutionErrorCodes
    });

    // CHANGED: Disabled setEagerModelSync to prevent crashes.
    // When enabled, Monaco tries to sync ALL models with the TypeScript worker
    // simultaneously, causing heavy CPU/memory load that can crash the renderer.
    // Models will sync on-demand when they become the active editor instead.
    // ts.typescriptDefaults.setEagerModelSync(true);
    // ts.javascriptDefaults.setEagerModelSync(true);
  } catch {
    // ignore
  }
}

function configureMonacoWebLanguageServicesOnce() {
  if (__webServicesConfigured) return;
  __webServicesConfigured = true;

  try {
    if (typeof monaco === 'undefined' || !monaco?.languages) return;

    // JSON
    try {
      const jd = monaco.languages?.json?.jsonDefaults;
      jd?.setDiagnosticsOptions?.({
        validate: true,
        allowComments: true,
        trailingCommas: 'ignore'
      });
    } catch { /* ignore */ }

    // CSS
    try {
      const cd = monaco.languages?.css?.cssDefaults;
      cd?.setOptions?.({ validate: true });
    } catch { /* ignore */ }

    // HTML
    try {
      const hd = monaco.languages?.html?.htmlDefaults;
      hd?.setOptions?.({ validate: true });
    } catch { /* ignore */ }
  } catch {
    // ignore
  }
}


// Track loaded type definition packages to avoid duplicates
let __loadedTypePackages = new Set();

/**
 * Find all node_modules/@types directories in the project (handles monorepos and nested packages).
 */
async function findTypesDirs() {
  const typesDirs = [];
  
  // Check root first
  typesDirs.push('node_modules/@types');
  
  // Common monorepo patterns to check
  const monorepoPatterns = [
    'packages/*/node_modules/@types',
    'apps/*/node_modules/@types', 
    'src/node_modules/@types',
    'frontend/node_modules/@types',
    'backend/node_modules/@types',
    'client/node_modules/@types',
    'server/node_modules/@types',
  ];

  // Try to find package directories in common monorepo structures
  try {
    for (const pattern of ['packages', 'apps']) {
      const listRes = await window.electronAPI.listDir(pattern, { maxDepth: 1 });
      if (listRes && listRes.success === true && Array.isArray(listRes.files)) {
        for (const f of listRes.files) {
          if (f && f.type === 'directory' && f.name && !f.name.startsWith('.')) {
            typesDirs.push(`${pattern}/${f.name}/node_modules/@types`);
          }
        }
      }
    }
  } catch {
    // Ignore - just use root
  }

  // Also check if there's a src folder with its own node_modules
  for (const subdir of ['src', 'frontend', 'backend', 'client', 'server', 'app']) {
    typesDirs.push(`${subdir}/node_modules/@types`);
  }

  return typesDirs;
}

/**
 * Load type definitions from the project's node_modules/@types into Monaco.
 * This enables proper TypeScript intellisense and removes false "Cannot find module" errors.
 * Handles monorepos and nested node_modules directories.
 */
async function _loadProjectTypeDefinitionsInternal() {
  if (!window.currentFolder) return;
  if (typeof monaco === 'undefined' || !monaco?.languages?.typescript) return;
  if (!window.electronAPI || typeof window.electronAPI.listDir !== 'function' || typeof window.electronAPI.readFile !== 'function') return;

  const ts = monaco.languages.typescript;
  const projectPath = window.currentFolder;

  // Clear previous type definitions when switching projects
  __loadedTypePackages.clear();

  console.log('[TypeDefs] Loading type definitions for project:', projectPath);

  // Common type packages to prioritize loading
  const priorityPackages = ['react', 'react-dom', 'node', 'jest', 'vite', 'webpack', 'express', 'next'];

  // Find all possible @types directories (handles monorepos)
  const typesDirs = await findTypesDirs();
  let totalLoaded = 0;

  for (const typesDir of typesDirs) {
    try {
      // List @types directory
      const listRes = await window.electronAPI.listDir(typesDir, { maxDepth: 1 });
      
      if (!listRes || listRes.success !== true || !Array.isArray(listRes.files)) {
        continue; // Try next directory
      }

      // Get all type package directories
      const typePackages = listRes.files
        .filter(f => f && f.type === 'directory' && f.name && !f.name.startsWith('.'))
        .map(f => f.name);

      if (typePackages.length === 0) continue;

      console.log(`[TypeDefs] Found ${typePackages.length} type packages in ${typesDir}`);

      // Sort to load priority packages first
      const sortedPackages = [
        ...priorityPackages.filter(p => typePackages.includes(p)),
        ...typePackages.filter(p => !priorityPackages.includes(p))
      ];

      // Load type definitions (limit per directory to avoid performance issues)
      const maxPackages = 25;
      let loaded = 0;

      for (const pkg of sortedPackages.slice(0, maxPackages)) {
        if (__loadedTypePackages.has(pkg)) continue;

        try {
          // Try to read index.d.ts first
          let content = null;
          let typesPath = `${typesDir}/${pkg}/index.d.ts`;

          const readRes = await window.electronAPI.readFile(typesPath);
          if (readRes && readRes.success === true && readRes.content) {
            content = readRes.content;
          }

          if (content) {
            // Add to Monaco's TypeScript service
            const libPath = `file:///node_modules/@types/${pkg}/index.d.ts`;
            ts.typescriptDefaults.addExtraLib(content, libPath);
            __loadedTypePackages.add(pkg);
            loaded++;
            totalLoaded++;
          }
        } catch {
          // Skip packages that fail to load
        }
      }

      if (loaded > 0) {
        console.log(`[TypeDefs] Loaded ${loaded} packages from ${typesDir}`);
      }

    } catch {
      // Skip directories that don't exist or can't be read
    }
  }

  console.log(`[TypeDefs] Total loaded: ${totalLoaded} type definition packages`);

  // Also try to load types from packages that bundle their own types
  await loadBundledTypeDefinitions();
}

/**
 * Load type definitions that are bundled with packages (not in @types).
 * Some packages like newer versions of React ship their own .d.ts files.
 * Also checks subdirectories for monorepo support.
 */
async function loadBundledTypeDefinitions() {
  if (!window.currentFolder) return;
  if (typeof monaco === 'undefined' || !monaco?.languages?.typescript) return;

  const ts = monaco.languages.typescript;

  // Packages that commonly bundle their own types
  const bundledTypesPackages = [
    { pkg: 'react', typesFile: 'react/index.d.ts' },
    { pkg: 'react-dom', typesFile: 'react-dom/index.d.ts' },
    { pkg: 'typescript', typesFile: 'typescript/lib/typescript.d.ts' },
  ];

  // Possible node_modules locations (handles monorepos)
  const nodeModulesDirs = [
    'node_modules',
    'src/node_modules',
    'packages/*/node_modules',
    'apps/*/node_modules',
    'frontend/node_modules',
    'client/node_modules',
  ];

  for (const { pkg, typesFile } of bundledTypesPackages) {
    if (__loadedTypePackages.has(pkg)) continue;

    // Try each possible node_modules location
    for (const nmDir of nodeModulesDirs) {
      // Skip glob patterns for now, just check direct paths
      if (nmDir.includes('*')) continue;
      
      try {
        const fullPath = `${nmDir}/${typesFile}`;
        const readRes = await window.electronAPI.readFile(fullPath);
        if (readRes && readRes.success === true && readRes.content) {
          const libPath = `file:///${fullPath}`;
          ts.typescriptDefaults.addExtraLib(readRes.content, libPath);
          __loadedTypePackages.add(pkg);
          console.log(`[TypeDefs] Loaded bundled types for: ${pkg} from ${nmDir}`);
          break; // Found it, don't check other directories
        }
      } catch {
        // Skip if not found, try next directory
      }
    }
  }
}

/**
 * Strip comments from JSONC (JSON with Comments) content.
 * Handles // line comments and /* block comments */
function stripJsonComments(content) {
  if (!content || typeof content !== 'string') return content;
  
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = '';
  
  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];
    
    // Handle string state (don't strip comments inside strings)
    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      result += char;
      i++;
      continue;
    }
    
    if (inString) {
      result += char;
      // Check for escape sequences
      if (char === '\\' && i + 1 < content.length) {
        result += content[i + 1];
        i += 2;
        continue;
      }
      // Check for end of string
      if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
      i++;
      continue;
    }
    
    // Handle // line comments
    if (char === '/' && next === '/') {
      // Skip until end of line
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
      continue;
    }
    
    // Handle /* block comments */
    if (char === '/' && next === '*') {
      i += 2; // Skip /*
      // Skip until */
      while (i < content.length - 1) {
        if (content[i] === '*' && content[i + 1] === '/') {
          i += 2; // Skip */
          break;
        }
        i++;
      }
      continue;
    }
    
    result += char;
    i++;
  }
  
  return result;
}

/**
 * Load and apply tsconfig.json compiler options to Monaco.
 */
async function loadProjectTsConfig() {
  if (!window.currentFolder) return;
  if (typeof monaco === 'undefined' || !monaco?.languages?.typescript) return;
  if (!window.electronAPI || typeof window.electronAPI.readFile !== 'function') return;

  try {
    const readRes = await window.electronAPI.readFile('tsconfig.json');
    if (!readRes || readRes.success !== true || !readRes.content) return;

    // Strip comments from tsconfig.json (JSONC format)
    const cleanedContent = stripJsonComments(readRes.content);
    const tsconfig = JSON.parse(cleanedContent);
    const compilerOptions = tsconfig?.compilerOptions;
    if (!compilerOptions) return;

    console.log('[TypeDefs] Found tsconfig.json, applying compiler options');

    const ts = monaco.languages.typescript;
    const currentOptions = { ...ts.typescriptDefaults.getCompilerOptions() };

    // Map tsconfig options to Monaco options
    if (compilerOptions.jsx) {
      const jsxMap = {
        'preserve': ts.JsxEmit.Preserve,
        'react': ts.JsxEmit.React,
        'react-jsx': ts.JsxEmit.ReactJSX,
        'react-jsxdev': ts.JsxEmit.ReactJSXDev,
        'react-native': ts.JsxEmit.ReactNative
      };
      if (jsxMap[compilerOptions.jsx]) {
        currentOptions.jsx = jsxMap[compilerOptions.jsx];
      }
    }

    if (compilerOptions.target) {
      const targetMap = {
        'es5': ts.ScriptTarget.ES5,
        'es6': ts.ScriptTarget.ES2015,
        'es2015': ts.ScriptTarget.ES2015,
        'es2016': ts.ScriptTarget.ES2016,
        'es2017': ts.ScriptTarget.ES2017,
        'es2018': ts.ScriptTarget.ES2018,
        'es2019': ts.ScriptTarget.ES2019,
        'es2020': ts.ScriptTarget.ES2020,
        'es2021': ts.ScriptTarget.ES2021,
        'es2022': ts.ScriptTarget.ES2022,
        'esnext': ts.ScriptTarget.ESNext
      };
      const target = String(compilerOptions.target).toLowerCase();
      if (targetMap[target]) {
        currentOptions.target = targetMap[target];
      }
    }

    if (compilerOptions.strict !== undefined) {
      currentOptions.strict = compilerOptions.strict;
    }

    if (compilerOptions.esModuleInterop !== undefined) {
      currentOptions.esModuleInterop = compilerOptions.esModuleInterop;
    }

    if (compilerOptions.skipLibCheck !== undefined) {
      currentOptions.skipLibCheck = compilerOptions.skipLibCheck;
    }

    ts.typescriptDefaults.setCompilerOptions(currentOptions);
    console.log('[TypeDefs] Applied tsconfig compiler options');

  } catch (e) {
    console.warn('[TypeDefs] Error loading tsconfig.json:', e?.message || e);
  }
}

// Expose function globally so it can be called when a project opens
window.loadProjectTypeDefinitions = async function() {
  await loadProjectTsConfig();
  await _loadProjectTypeDefinitionsInternal();
};


async function saveSettingsAndClose() {
  // LLM Provider
  try {
    const providerClaudeAi = document.getElementById('providerClaudeAiRadio');
    const providerAnthropic = document.getElementById('providerAnthropicRadio');
    const providerOpenRouter = document.getElementById('providerOpenRouterRadio');
    const providerCodex = document.getElementById('providerCodexRadio');
    
    if (providerClaudeAi && providerClaudeAi.checked) {
      settings.llmProvider = 'claude_ai';
      settings.authMode = 'claude_ai';
    } else if (providerAnthropic && providerAnthropic.checked) {
      settings.llmProvider = 'anthropic_api';
      settings.authMode = 'api_key';
    } else if (providerOpenRouter && providerOpenRouter.checked) {
      settings.llmProvider = 'openrouter';
    } else if (providerCodex && providerCodex.checked) {
      settings.llmProvider = 'codex';
    }
  } catch {
    // ignore
  }

  // Anthropic API Key
  const apiKeyEl = document.getElementById('apiKeyInput');
  if (apiKeyEl) settings.apiKey = apiKeyEl.value;

  // OpenRouter settings
  try {
    const orApiKeyEl = document.getElementById('openrouterApiKeyInput');
    const orModelEl = document.getElementById('openrouterModelInput');
    
    settings.openrouterApiKey = orApiKeyEl ? String(orApiKeyEl.value || '').trim() : '';
    settings.openrouterModel = orModelEl ? String(orModelEl.value || '').trim() : '';
  } catch {
    // ignore
  }

  // Codex settings
  try {
    const codexModelEl = document.getElementById('codexModelInput');
    if (codexModelEl && codexModelEl.value) settings.codexModel = String(codexModelEl.value || '').trim();
  } catch {
    // ignore
  }

  const permissionModeInput = document.getElementById('permissionModeInput');
  if (permissionModeInput) {
    const raw = String(permissionModeInput.value || '').trim();
    const allowed = new Set(['plan', 'default', 'acceptEdits', 'bypassPermissions']);
    settings.permissionMode = allowed.has(raw) ? raw : 'acceptEdits';
    if (settings.permissionMode !== 'plan') {
      settings.lastNonPlanPermissionMode = settings.permissionMode;
    }
  }
  try {
    const permissionModeComposerInput = document.getElementById('permissionModeComposerInput');
    if (permissionModeComposerInput) permissionModeComposerInput.value = settings.permissionMode || 'acceptEdits';
  } catch { /* ignore */ }

  // Network policy
  try {
    const modeEl = document.getElementById('networkPolicyModeInput');
    const allowlistEl = document.getElementById('networkAllowlistInput');
    const allowed = new Set(['allow_all', 'deny_all', 'allowlist']);
    const rawMode = modeEl ? String(modeEl.value || '').trim() : '';
    settings.networkPolicyMode = allowed.has(rawMode) ? rawMode : 'allow_all';

    const rawList = allowlistEl ? String(allowlistEl.value || '') : '';
    const list = rawList
      .split('\n')
      .map(s => String(s || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 200);
    settings.networkAllowlist = list;
  } catch {
    // ignore
  }

  // Max budget (Agent SDK)
  try {
    const el = document.getElementById('maxBudgetUsdInput');
    const raw = el ? String(el.value || '').trim() : '';
    const v = raw ? Number(raw) : 0;
    settings.maxBudgetUsd = (Number.isFinite(v) && v > 0) ? v : 0;
  } catch { /* ignore */ }

  // AI automations
  try {
    const fixDocsToggle = document.getElementById('enableDocsLearningOnFixToggle');
    if (fixDocsToggle) {
      settings.enableDocsLearningOnFix = fixDocsToggle.checked === true;
    } else {
      settings.enableDocsLearningOnFix = settings.enableDocsLearningOnFix === true;
    }
  } catch {
    // ignore
  }

  // Editor enhancements
  try {
    const problemsToggle = document.getElementById('enableProblemsToggle');
    const aiToggle = document.getElementById('enableAiQuickFixesToggle');
    const tsToggle = document.getElementById('enableTsJsLanguageServiceToggle');
    const webToggle = document.getElementById('enableWebLanguageServicesToggle');
    settings.enableProblemsPanel = problemsToggle ? problemsToggle.checked === true : (settings.enableProblemsPanel === true);
    settings.enableAiQuickFixes = aiToggle ? aiToggle.checked === true : (settings.enableAiQuickFixes === true);
    settings.enableTsJsLanguageService = tsToggle ? tsToggle.checked === true : (settings.enableTsJsLanguageService === true);
    settings.enableWebLanguageServices = webToggle ? webToggle.checked === true : (settings.enableWebLanguageServices === true);
  } catch {
    // ignore
  }

  await saveSettings();
  
  applyClaudeAuthSettingsUI({ refreshStatus: true });
  try { applyEditorEnhancementsSettingsUI(); } catch { /* ignore */ }
  try { if (settings.enableTsJsLanguageService === true) configureMonacoTsJsServiceOnce(); } catch { /* ignore */ }
  try { if (settings.enableWebLanguageServices === true) configureMonacoWebLanguageServicesOnce(); } catch { /* ignore */ }
  try { if (typeof window.renderLearningPanel === 'function') window.renderLearningPanel(); } catch { /* ignore */ }
  try { if (typeof window.renderDocsPanel === 'function') window.renderDocsPanel(); } catch { /* ignore */ }
  closeSettings();
}


// Chat functionality
function toggleChat() {
  const chatPanel = document.getElementById('chatPanel');
  chatPanel.classList.toggle('collapsed');
}


async function startNewChat() {
  if (!currentFolder) {
    alert('Please open a folder first');
    return;
  }
  // Flush current session first so switching doesn't lose anything.
  try {
    await saveChatHistory(true);
  } catch {
    // ignore
  }
  await createNewChatSession();
}
