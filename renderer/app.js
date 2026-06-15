// Codeon - App bootstrap
// NOTE: The monolithic renderer/app.js was split into ordered scripts under renderer/app/sections/.
// Those scripts are loaded from renderer/index.html.
// This file is intentionally kept tiny (integration glue only).

(function () {
  'use strict';
  // Central bootstrap entrypoint (avoid top-level side effects scattered across modules).
  try {
    if (window.Codeon && window.Codeon.editor && typeof window.Codeon.editor.init === 'function') {
      window.Codeon.editor.init();
    }
  } catch (e) {
    console.error('[Codeon] bootstrap failed:', e);
  }
})();
