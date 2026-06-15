// MCP (Model Context Protocol) State Management
// Manages MCP server configurations and connections

(function () {
  'use strict';

  // In-memory MCP server configurations
  let mcpServers = [];
  let mcpServerStatus = new Map(); // serverId -> { status: 'connected'|'disconnected'|'error', error?: string, lastConnected?: Date }

  async function resolveProjectRootForMcp() {
    try {
      const fromWindow = String(window.currentFolder || window.currentProject || '').trim();
      if (fromWindow) return fromWindow;
    } catch { /* ignore */ }

    try {
      const res = await window.electronAPI?.getCurrentProject?.();
      const root = (res && res.success === true) ? String(res.projectPath || '').trim() : '';
      if (root) return root;
    } catch { /* ignore */ }

    return '';
  }

  // Claude Code expects server keys to be identifiers (no spaces).
  function normalizeMcpServerKey(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 48);
  }

  async function syncClaudeProjectMcpJson(projectRoot) {
    try {
      const root = String(projectRoot || '').trim();
      if (!root || !window.electronAPI) return;

      const out = {};
      for (const s of mcpServers) {
        if (!s || typeof s !== 'object') continue;
        if (s.enabled === false) continue;
        const key = normalizeMcpServerKey(s.name) || normalizeMcpServerKey(s.id);
        if (!key) continue;

        const t = String(s.type || 'stdio').trim();
        if (t === 'stdio') {
          const cmd = String(s.command || '').trim();
          if (!cmd) continue;
          out[key] = {
            type: 'stdio',
            command: cmd,
            ...(Array.isArray(s.args) && s.args.length ? { args: s.args.map(v => String(v)) } : {}),
            ...(s.env && typeof s.env === 'object' ? { env: Object.fromEntries(Object.entries(s.env).map(([k, v]) => [String(k), String(v)])) } : {})
          };
        } else {
          const url = String(s.url || '').trim();
          if (!url) continue;
          const headers = (s.headers && typeof s.headers === 'object')
            ? Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [String(k), String(v)]))
            : null;
          // Claude Code config uses "http" for remote servers (Streamable HTTP, with SSE fallback).
          out[key] = { type: 'http', url, ...(headers ? { headers } : {}) };
        }
      }

      const mcpJsonPath = await window.electronAPI.path.join(root, '.mcp.json');
      const payload = { mcpServers: out };
      const wr = await window.electronAPI.writeFile(mcpJsonPath, JSON.stringify(payload, null, 2));
      if (wr && wr.success === false) {
        console.warn('[MCP] Failed to write .mcp.json:', wr.error);
      }
    } catch (err) {
      console.warn('[MCP] Failed to sync .mcp.json:', err);
    }
  }

  // Load MCP servers from local storage or project config
  async function loadMcpServers() {
    try {
      // Try to load from project config first
      const projectRoot = await resolveProjectRootForMcp();
      if (projectRoot && window.electronAPI) {
        const configPath = await window.electronAPI.path.join(projectRoot, '.codeon', 'mcp-config.json');
        try {
          const exists = await window.electronAPI.fs.exists(configPath);
          if (exists) {
            const rr = await window.electronAPI.readFile(configPath);
            const raw = (rr && rr.success === true) ? String(rr.content || '') : '';
            const config = JSON.parse(raw || '{}');
            if (config && config.mcpServers && Array.isArray(config.mcpServers)) {
              mcpServers = config.mcpServers;
              console.log('[MCP] Loaded', mcpServers.length, 'servers from project config');
              return mcpServers;
            }
          }
        } catch (err) {
          console.warn('[MCP] Failed to load project config:', err);
        }

        // Fallback: load from Claude Code's project config file `.mcp.json`
        try {
          const mcpJsonPath = await window.electronAPI.path.join(projectRoot, '.mcp.json');
          const exists2 = await window.electronAPI.fs.exists(mcpJsonPath);
          if (exists2) {
            const rr2 = await window.electronAPI.readFile(mcpJsonPath);
            const raw2 = (rr2 && rr2.success === true) ? String(rr2.content || '') : '';
            const parsed = JSON.parse(raw2 || '{}');
            const obj = (parsed && typeof parsed === 'object' && parsed.mcpServers && typeof parsed.mcpServers === 'object') ? parsed.mcpServers : {};
            const arr = [];
            for (const [key, cfg] of Object.entries(obj)) {
              if (!cfg || typeof cfg !== 'object') continue;
              const t = String(cfg.type || 'stdio').trim();
              const id = `mcp-${normalizeMcpServerKey(key) || normalizeMcpServerKey(cfg.name) || Math.random().toString(36).slice(2)}`;
              if (t === 'stdio') {
                const cmd = String(cfg.command || '').trim();
                if (!cmd) continue;
                arr.push({
                  id,
                  name: normalizeMcpServerKey(key) || String(key),
                  type: 'stdio',
                  command: cmd,
                  args: Array.isArray(cfg.args) ? cfg.args.map(v => String(v)) : [],
                  env: (cfg.env && typeof cfg.env === 'object') ? cfg.env : {},
                  enabled: true
                });
              } else {
                const url = String(cfg.url || '').trim();
                if (!url) continue;
                arr.push({
                  id,
                  name: normalizeMcpServerKey(key) || String(key),
                  type: 'sse',
                  url,
                  headers: (cfg.headers && typeof cfg.headers === 'object') ? cfg.headers : {},
                  enabled: true
                });
              }
            }
            if (arr.length) {
              mcpServers = arr;
              console.log('[MCP] Loaded', mcpServers.length, 'servers from .mcp.json');
              return mcpServers;
            }
          }
        } catch (err) {
          console.warn('[MCP] Failed to load .mcp.json:', err);
        }
      }

      // Fallback to localStorage
      const stored = localStorage.getItem('codeon.mcpServers');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          mcpServers = parsed;
          console.log('[MCP] Loaded', mcpServers.length, 'servers from localStorage');
          // If a project is open but config is missing, persist localStorage servers to project now
          // so the main process can pass them through to the LLM providers.
          const root = await resolveProjectRootForMcp();
          if (root) {
            try {
              await saveMcpServers();
            } catch (e) {
              console.warn('[MCP] Failed to persist localStorage servers to project:', e);
            }
          } else {
            console.warn('[MCP] No project root detected; MCP servers will not be available to chat until a project is open.');
          }
        }
      }
    } catch (err) {
      console.error('[MCP] Failed to load MCP servers:', err);
    }
    return mcpServers;
  }

  // Save MCP servers to local storage and project config
  async function saveMcpServers() {
    try {
      // Save to localStorage
      localStorage.setItem('codeon.mcpServers', JSON.stringify(mcpServers));

      // Save to project config if project is open
      const projectRoot = await resolveProjectRootForMcp();
      if (projectRoot && window.electronAPI) {
        const codeonDir = await window.electronAPI.path.join(projectRoot, '.codeon');
        const configPath = await window.electronAPI.path.join(codeonDir, 'mcp-config.json');
        
        try {
          // Ensure .codeon directory exists
          if (typeof window.electronAPI.createDirectory === 'function') {
            const mk = await window.electronAPI.createDirectory(codeonDir);
            if (mk && mk.success === false) console.warn('[MCP] Failed to create .codeon directory:', mk.error);
          } else {
            const mk = await window.electronAPI.fs.mkdir(codeonDir, { recursive: true });
            if (mk && mk.success === false) console.warn('[MCP] Failed to create .codeon directory:', mk.error);
          }
          
          // Write config
          const config = { mcpServers };
          const wr = await window.electronAPI.writeFile(configPath, JSON.stringify(config, null, 2));
          if (wr && wr.success === false) {
            console.warn('[MCP] Failed to write MCP config:', wr.error);
          } else {
            console.log('[MCP] Saved config to project');
          }
        } catch (err) {
          console.warn('[MCP] Failed to save to project config:', err);
        }

        // Also write Claude Code's project-level config: `<project>/.mcp.json`
        await syncClaudeProjectMcpJson(projectRoot);
      } else {
        console.warn('[MCP] No project root detected; MCP config saved to localStorage only (chat cannot see MCP servers).');
      }
    } catch (err) {
      console.error('[MCP] Failed to save MCP servers:', err);
    }
  }

  // Get all MCP servers
  function getMcpServers() {
    return [...mcpServers];
  }

  // Get MCP server by ID
  function getMcpServer(serverId) {
    return mcpServers.find(s => s.id === serverId);
  }

  // Add or update MCP server
  async function saveMcpServer(serverConfig) {
    try {
      // Validate required fields (type-aware)
      const type = String(serverConfig.type || 'stdio').trim();
      const name = String(serverConfig.name || '').trim();
      const command = String(serverConfig.command || '').trim();
      const url = String(serverConfig.url || '').trim();

      const key = normalizeMcpServerKey(name);
      if (!key) throw new Error('Server name is required');
      if (key !== name) serverConfig.name = key;
      if (type === 'stdio' && !command) throw new Error('Command is required for stdio servers');
      if (type === 'sse' && !url) throw new Error('Server URL is required for SSE servers');

      // Normalize fields to avoid stale data when switching type
      serverConfig.type = type;
      serverConfig.name = String(serverConfig.name || '').trim();
      if (type === 'stdio') {
        serverConfig.command = command;
      } else {
        delete serverConfig.command;
        delete serverConfig.args;
        delete serverConfig.env;
      }
      if (type === 'sse') {
        serverConfig.url = url;
      } else {
        delete serverConfig.url;
      }

      // Generate ID if new
      if (!serverConfig.id) {
        serverConfig.id = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        serverConfig.createdAt = new Date().toISOString();
      }
      serverConfig.updatedAt = new Date().toISOString();

      // Find and update or add new
      const index = mcpServers.findIndex(s => s.id === serverConfig.id);
      if (index >= 0) {
        mcpServers[index] = serverConfig;
      } else {
        mcpServers.push(serverConfig);
      }

      await saveMcpServers();
      console.log('[MCP] Saved server:', serverConfig.name);
      return serverConfig;
    } catch (err) {
      console.error('[MCP] Failed to save server:', err);
      throw err;
    }
  }

  // Delete MCP server
  async function deleteMcpServer(serverId) {
    try {
      const index = mcpServers.findIndex(s => s.id === serverId);
      if (index >= 0) {
        const server = mcpServers[index];
        
        // Disconnect if connected
        if (window.electronAPI && window.electronAPI.mcp) {
          try {
            await window.electronAPI.mcp.disconnect(serverId);
          } catch (err) {
            console.warn('[MCP] Failed to disconnect during delete:', err);
          }
        }

        mcpServers.splice(index, 1);
        mcpServerStatus.delete(serverId);
        await saveMcpServers();
        console.log('[MCP] Deleted server:', server.name);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[MCP] Failed to delete server:', err);
      throw err;
    }
  }

  // Connect to MCP server
  async function connectMcpServer(serverId) {
    try {
      const server = getMcpServer(serverId);
      if (!server) {
        throw new Error('Server not found');
      }

      if (!window.electronAPI || !window.electronAPI.mcp) {
        throw new Error('MCP IPC not available');
      }

      // Update status to connecting
      mcpServerStatus.set(serverId, { status: 'connecting' });

      // Connect via main process
      const result = await window.electronAPI.mcp.connect(server);
      
      if (result.success) {
        mcpServerStatus.set(serverId, { 
          status: 'connected', 
          lastConnected: new Date(),
          capabilities: result.capabilities 
        });
        console.log('[MCP] Connected to:', server.name);
        return { success: true };
      } else {
        mcpServerStatus.set(serverId, { 
          status: 'error', 
          error: result.error || 'Connection failed' 
        });
        return { success: false, error: result.error };
      }
    } catch (err) {
      const errorMsg = err.message || 'Connection failed';
      mcpServerStatus.set(serverId, { status: 'error', error: errorMsg });
      console.error('[MCP] Failed to connect:', err);
      return { success: false, error: errorMsg };
    }
  }

  // Disconnect from MCP server
  async function disconnectMcpServer(serverId) {
    try {
      if (!window.electronAPI || !window.electronAPI.mcp) {
        throw new Error('MCP IPC not available');
      }

      await window.electronAPI.mcp.disconnect(serverId);
      mcpServerStatus.set(serverId, { status: 'disconnected' });
      console.log('[MCP] Disconnected from:', serverId);
      return { success: true };
    } catch (err) {
      console.error('[MCP] Failed to disconnect:', err);
      return { success: false, error: err.message };
    }
  }

  // Get MCP server status
  function getMcpServerStatus(serverId) {
    return mcpServerStatus.get(serverId) || { status: 'disconnected' };
  }

  // Get available MCP tools from a connected server
  async function getMcpServerTools(serverId) {
    try {
      if (!window.electronAPI || !window.electronAPI.mcp) {
        throw new Error('MCP IPC not available');
      }

      const status = getMcpServerStatus(serverId);
      if (status.status !== 'connected') {
        throw new Error('Server not connected');
      }

      const result = await window.electronAPI.mcp.listTools(serverId);
      return result.tools || [];
    } catch (err) {
      console.error('[MCP] Failed to get tools:', err);
      return [];
    }
  }

  // Get available MCP resources from a connected server
  async function getMcpServerResources(serverId) {
    try {
      if (!window.electronAPI || !window.electronAPI.mcp) {
        throw new Error('MCP IPC not available');
      }

      const status = getMcpServerStatus(serverId);
      if (status.status !== 'connected') {
        throw new Error('Server not connected');
      }

      const result = await window.electronAPI.mcp.listResources(serverId);
      return result.resources || [];
    } catch (err) {
      console.error('[MCP] Failed to get resources:', err);
      return [];
    }
  }

  // Export to window
  window.loadMcpServers = loadMcpServers;
  window.saveMcpServer = saveMcpServer;
  window.deleteMcpServer = deleteMcpServer;
  window.getMcpServers = getMcpServers;
  window.getMcpServer = getMcpServer;
  window.connectMcpServer = connectMcpServer;
  window.disconnectMcpServer = disconnectMcpServer;
  window.getMcpServerStatus = getMcpServerStatus;
  window.getMcpServerTools = getMcpServerTools;
  window.getMcpServerResources = getMcpServerResources;

  console.log('[MCP] State management initialized');
})();

