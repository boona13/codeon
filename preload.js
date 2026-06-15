const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFileLines: (filePath, options) => ipcRenderer.invoke('read-file-lines', filePath, options),
  writeFile: (filePath, content, isBase64 = false) => ipcRenderer.invoke('write-file', filePath, content, isBase64),
  editFile: (filePath, oldString, newString) => ipcRenderer.invoke('edit-file', filePath, oldString, newString),
  readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
  // Agent-safe directory listing (shallow by default to avoid huge prompts)
  listDir: (dirPath, options) => ipcRenderer.invoke('list-directory', dirPath, options),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  createDirectory: (dirPath) => ipcRenderer.invoke('create-directory', dirPath),
  copyPaths: (sourcePaths, destDir, options) => ipcRenderer.invoke('copy-paths', sourcePaths, destDir, options),
  movePaths: (sourcePaths, destDir, options) => ipcRenderer.invoke('move-paths', sourcePaths, destDir, options),
  duplicatePath: (sourcePath, options) => ipcRenderer.invoke('duplicate-path', sourcePath, options),
  revealInFinder: (filePath) => ipcRenderer.invoke('reveal-in-finder', filePath),

  // Dialog operations
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  openProjectByPath: (projectPath) => ipcRenderer.invoke('open-project-by-path', projectPath),

  // Terminal operations
  runTerminalCommand: (command, waitForCompletion, timeout) =>
    ipcRenderer.invoke('run-terminal-command', command, waitForCompletion, timeout),
  runTerminalCommandInDir: (payload) => ipcRenderer.invoke('run-terminal-command-in-dir', payload),

  // Interactive Terminal (PTY) operations — xterm.js in renderer + node-pty in main
  terminalCreate: (options) => ipcRenderer.invoke('terminal:create', options),
  terminalKill: (payload) => ipcRenderer.invoke('terminal:kill', payload),
  terminalWrite: (terminalId, data) => ipcRenderer.send('terminal:write', { terminalId, data }),
  terminalResize: (terminalId, cols, rows) => ipcRenderer.send('terminal:resize', { terminalId, cols, rows }),
  onTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.removeListener('terminal:exit', listener);
  },
  
  // Git operations (used for checkpoints/diffs)
  getGitChanges: (includeContent) => ipcRenderer.invoke('get-git-changes', includeContent),
  gitShowFile: (payload) => ipcRenderer.invoke('git-show-file', payload),
  getRelatedFiles: (filePath) => ipcRenderer.invoke('get-related-files', filePath),
  readLints: (paths) => ipcRenderer.invoke('read-lints', paths),


  // Chat History File Operations (Desktop App)
  saveChatHistory: (projectPath, chatSessions) => ipcRenderer.invoke('save-chat-history', projectPath, chatSessions),
  loadChatHistory: (projectPath) => ipcRenderer.invoke('load-chat-history', projectPath),
  saveUIMetadata: (projectPath, uiMetadata) => ipcRenderer.invoke('save-ui-metadata', projectPath, uiMetadata),
  loadUIMetadata: (projectPath) => ipcRenderer.invoke('load-ui-metadata', projectPath),

  // Workspace-scoped Storage (SQLite KV, Codeon-style)
  storageGetObject: (projectPath, key) => ipcRenderer.invoke('workspace-storage-get', projectPath, key),
  storageStoreObject: (projectPath, key, value) => ipcRenderer.invoke('workspace-storage-store', projectPath, key, value),
  storageRemoveKey: (projectPath, key) => ipcRenderer.invoke('workspace-storage-remove', projectPath, key),

  // Workspace-local read_file excerpt cache (.codeon/cache/read_file_cache)
  readReadFileCache: (projectPath, sessionId) => ipcRenderer.invoke('read-readfile-cache', projectPath, sessionId),
  writeReadFileCache: (projectPath, sessionId, cacheObj) => ipcRenderer.invoke('write-readfile-cache', projectPath, sessionId, cacheObj),

  // Global Settings (Desktop App - stored in ~/.ai-agent/)
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),

  // Recent Projects (Desktop App - stored in ~/.ai-agent/)
  saveRecentProjects: (projects) => ipcRenderer.invoke('save-recent-projects', projects),
  loadRecentProjects: () => ipcRenderer.invoke('load-recent-projects'),

  // Claude Agent SDK (Claude Code) - streaming chat
  claudeSdkStart: (payload) => ipcRenderer.invoke('claude-sdk-start', payload),
  claudeSdkCancel: (requestId) => ipcRenderer.invoke('claude-sdk-cancel', requestId),
  openrouterDescribeImage: (payload) => ipcRenderer.invoke('openrouter-describe-image', payload),
  claudeSdkSetRunControl: (payload) => ipcRenderer.invoke('claude-sdk-set-run-control', payload),
  claudeSdkResetPauseState: (payload) => ipcRenderer.invoke('claude-sdk-reset-pause-state', payload),
  claudeSdkPermissionRespond: (payload) => ipcRenderer.invoke('claude-sdk-permission-response', payload),
  onClaudeSdkEvent: (callback) => ipcRenderer.on('claude-sdk-event', (_event, data) => callback(data)),
  claudeSdkDebugLog: (payload) => ipcRenderer.invoke('claude-sdk-debug-log', payload),
  claudeSdkAccountInfo: (payload) => ipcRenderer.invoke('claude-sdk-account-info', payload),
  claudeSdkSupportedModels: (payload) => ipcRenderer.invoke('claude-sdk-supported-models', payload),

  // Codex (ChatGPT-subscription) provider
  codex: {
    login: () => ipcRenderer.invoke('codex:login'),
    status: () => ipcRenderer.invoke('codex:status'),
    logout: () => ipcRenderer.invoke('codex:logout'),
    models: () => ipcRenderer.invoke('codex:models'),
  },

  // Agent Execution Timeline (AET)
  executionTimelineLoadSession: (projectPath, sessionId) =>
    ipcRenderer.invoke('execution-timeline-load-session', projectPath, sessionId),
  executionTimelineDiscardAfter: (projectPath, sessionId, cutoffTimeMs, reason) =>
    ipcRenderer.invoke('execution-timeline-discard-after', projectPath, sessionId, cutoffTimeMs, reason),
  executionTimelineTruncateAfterNode: (projectPath, sessionId, runId, nodeId, reason) =>
    ipcRenderer.invoke('execution-timeline-truncate-after-node', projectPath, sessionId, runId, nodeId, reason),
  executionTimelineAppendNode: (projectPath, sessionId, runId, nodeType, payload) =>
    ipcRenderer.invoke('execution-timeline-append-node', projectPath, sessionId, runId, nodeType, payload),
  executionLocksGet: (projectPath) =>
    ipcRenderer.invoke('execution-locks-get', projectPath),
  executionLocksSet: (projectPath, payload) =>
    ipcRenderer.invoke('execution-locks-set', projectPath, payload),
  onExecutionTimelineEvent: (callback) =>
    ipcRenderer.on('execution-timeline-event', (_event, data) => callback(data)),

  // AET Mindmap (Run Map) Pinboard
  mindmapPinboardGet: (projectPath) =>
    ipcRenderer.invoke('mindmap-pinboard-get', projectPath),
  mindmapPinboardSet: (projectPath, pins) =>
    ipcRenderer.invoke('mindmap-pinboard-set', projectPath, pins),

  // Event listeners
  onFolderOpened: (callback) => ipcRenderer.on('folder-opened', (_event, data) => callback(data)),
  onFileOpened: (callback) => ipcRenderer.on('file-opened', (_event, data) => callback(data)),
  onWorkspaceFilesChanged: (callback) => ipcRenderer.on('workspace-files-changed', (_event, data) => callback(data)),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', callback),
  onSaveFileAs: (callback) => ipcRenderer.on('save-file-as', (_event, filePath) => callback(filePath)),

  // App lifecycle flush handshake (main -> renderer)
  onAppFlushRequest: (callback) => ipcRenderer.on('app-flush-request', (_event, data) => callback(data)),
  appFlushDone: () => ipcRenderer.send('app-flush-done'),

  // AET debug toggle (dev)
  aetSetDebug: (enabled) => ipcRenderer.invoke('aet-set-debug', enabled === true),

  // Platform info
  platform: process.platform,
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getCurrentProject: () => ipcRenderer.invoke('get-current-project'),

  // Open external URLs in the default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Open a local file/folder in the OS default handler (project-scoped)
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),

  // User home (for ~/.claude paths)
  getUserHome: () => ipcRenderer.invoke('get-user-home'),

  // User-level Claude config (read-only)
  userClaudeListAgents: () => ipcRenderer.invoke('user-claude-list-agents'),
  userClaudeReadAgent: (relPath) => ipcRenderer.invoke('user-claude-read-agent', relPath),
  userClaudeListSkills: () => ipcRenderer.invoke('user-claude-list-skills'),
  userClaudeReadSkillMd: (relSkillMdPath) => ipcRenderer.invoke('user-claude-read-skill-md', relSkillMdPath),
  // Claude Code plugins (user-level)
  userClaudeListPlugins: () => ipcRenderer.invoke('user-claude-list-plugins'),
  userClaudeReadPluginManifest: (payload) => ipcRenderer.invoke('user-claude-read-plugin-manifest', payload),
  userClaudeReadSettingsJson: () => ipcRenderer.invoke('user-claude-read-settings-json'),
  userClaudeWriteSettingsJson: (payload) => ipcRenderer.invoke('user-claude-write-settings-json', payload),
  // Claude Code marketplaces (Codeon-managed marketplace sources + cache)
  userClaudeMarketplacesGet: () => ipcRenderer.invoke('user-claude-marketplaces-get'),
  userClaudeMarketplacesSet: (payload) => ipcRenderer.invoke('user-claude-marketplaces-set', payload),
  userClaudeMarketplaceSync: (payload) => ipcRenderer.invoke('user-claude-marketplace-sync', payload),
  userClaudePluginInstallGit: (payload) => ipcRenderer.invoke('user-claude-plugin-install-git', payload),
  userClaudePluginInstallFromDir: (payload) => ipcRenderer.invoke('user-claude-plugin-install-from-dir', payload),
  userClaudePluginUninstall: (payload) => ipcRenderer.invoke('user-claude-plugin-uninstall', payload),
  userClaudeReadAbsFile: (absPath) => ipcRenderer.invoke('user-claude-read-abs-file', absPath),
  userClaudeReadFile: (payload) => ipcRenderer.invoke('user-claude-read-file', payload),
  userClaudeWriteFile: (payload) => ipcRenderer.invoke('user-claude-write-file', payload),
  userClaudeDeleteFile: (payload) => ipcRenderer.invoke('user-claude-delete-file', payload),

  // Claude.ai subscription auth helper (opens system Terminal to run setup-token)
  openClaudeSetupTokenTerminal: () => ipcRenderer.invoke('open-claude-setup-token-terminal'),
  // Save Claude OAuth token manually (when auto-extraction fails or user has existing token)
  claudeSaveOAuthToken: (payload) => ipcRenderer.invoke('claude-save-oauth-token', payload),
  // Check if Claude OAuth credentials exist
  claudeCheckCredentials: () => ipcRenderer.invoke('claude-check-credentials'),
  claudeSyncCredentials: () => ipcRenderer.invoke('claude-sync-credentials'),

  // Bring the main window to the foreground (used after auth)
  focusMainWindow: () => ipcRenderer.invoke('focus-main-window'),

  // MCP (Model Context Protocol) operations
  mcp: {
    connect: (serverConfig) => ipcRenderer.invoke('mcp-connect', serverConfig),
    disconnect: (serverId) => ipcRenderer.invoke('mcp-disconnect', serverId),
    listTools: (serverId) => ipcRenderer.invoke('mcp-list-tools', serverId),
    listResources: (serverId) => ipcRenderer.invoke('mcp-list-resources', serverId),
    callTool: (payload) => ipcRenderer.invoke('mcp-call-tool', payload),
    readResource: (payload) => ipcRenderer.invoke('mcp-read-resource', payload),
  },

  // Path utilities (for MCP config paths)
  path: {
    join: (...args) => ipcRenderer.invoke('path-join', args),
  },

  // File system utilities (for MCP config)
  fs: {
    exists: (path) => ipcRenderer.invoke('fs-exists', path),
    mkdir: (path, options) => ipcRenderer.invoke('fs-mkdir', path, options),
    readFile: (path, _encoding) => ipcRenderer.invoke('read-file', path),
    writeFile: (path, content, _encoding) => ipcRenderer.invoke('write-file', path, content),
  },

});
