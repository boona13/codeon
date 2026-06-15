// Codeon - Main Process Entry
// This file is intentionally kept tiny. The full implementation lives in `main/bootstrap.js`.
//
// IMPORTANT:
// - Electron Builder includes `main.js` as the entrypoint (`package.json#main`).
// - Keeping this file small makes future refactors safer and reduces merge conflicts.

require('./main/bootstrap');
