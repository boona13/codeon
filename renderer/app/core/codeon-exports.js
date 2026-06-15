// Codeon - Exports bridge
// Purpose: provide a stable API surface (`window.Codeon.*`) while we migrate away from
// global lexical variables/functions spread across many <script> files.
//
// This file should be loaded AFTER the main app scripts so it can “see” globals.

try {
  window.Codeon = window.Codeon || {};
  window.Codeon.app = window.Codeon.app || {};
  window.Codeon.state = window.Codeon.state || {};
  window.Codeon.ui = window.Codeon.ui || {};
  window.Codeon.editor = window.Codeon.editor || {};
  window.Codeon.chat = window.Codeon.chat || {};
  window.Codeon.git = window.Codeon.git || {};
  window.Codeon.aet = window.Codeon.aet || {};
} catch {
  // ignore
}

// ---- State getters (avoid exporting stale snapshots) ----
try { window.Codeon.state.getCurrentFolder = () => currentFolder; } catch { /* ignore */ }
try { window.Codeon.state.getCurrentFile = () => currentFile; } catch { /* ignore */ }
try { window.Codeon.state.getEditor = () => editor; } catch { /* ignore */ }
try { window.Codeon.state.getDiffEditor = () => diffEditor; } catch { /* ignore */ }
try { window.Codeon.state.getSettings = () => settings; } catch { /* ignore */ }

// ---- Common actions (prefer window.* fallbacks where present) ----
try { window.Codeon.editor.openFile = window.openFile || (typeof openFile === 'function' ? openFile : null); } catch { /* ignore */ }
try { window.Codeon.editor.renderFileTree = window.renderFileTree || (typeof renderFileTree === 'function' ? renderFileTree : null); } catch { /* ignore */ }

// ---- AET Map (Mindmap) public API (keep legacy globals too) ----
try { if (window.CodeonAetMap) window.Codeon.aet.map = window.CodeonAetMap; } catch { /* ignore */ }
try { if (window.CodeonAetMapEvents) window.Codeon.aet.mapEvents = window.CodeonAetMapEvents; } catch { /* ignore */ }
try { if (window.CodeonAetMapGraph) window.Codeon.aet.mapGraph = window.CodeonAetMapGraph; } catch { /* ignore */ }
try { if (window.CodeonAetMapLayout) window.Codeon.aet.mapLayout = window.CodeonAetMapLayout; } catch { /* ignore */ }

// ---- Git (lightweight bridge) ----
try { if (typeof withGitOperationLock === 'function') window.Codeon.git.withLock = withGitOperationLock; } catch { /* ignore */ }

// ---- Chat status banner helpers (optional, for future modular calls) ----
try {
  window.Codeon.chat.status = window.Codeon.chat.status || {};
  if (typeof _setChatStatusBannerText === 'function') window.Codeon.chat.status.setText = _setChatStatusBannerText;
  if (typeof _refreshChatStatusBannerForCurrentSession === 'function') window.Codeon.chat.status.refresh = _refreshChatStatusBannerForCurrentSession;
} catch { /* ignore */ }

// Optional: expose a “health” flag so future code can assert exports are ready.
try { window.Codeon.app.exportsReady = true; } catch { /* ignore */ }


