/**
 * electron-builder hook: run after the app is packed, before DMG/ZIP creation.
 *
 * Why: unsigned mac builds can end up with "code has no resources but signature indicates they must be present",
 * which triggers the dreaded "App is damaged and can't be opened" Gatekeeper dialog.
 *
 * We apply an ad-hoc signature to make the bundle internally consistent.
 * This does NOT replace proper Developer ID signing + notarization for distribution.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function findAppBundle(appOutDir) {
  const entries = fs.readdirSync(appOutDir, { withFileTypes: true });
  const app = entries.find((e) => e.isDirectory() && e.name.endsWith('.app'));
  return app ? path.join(appOutDir, app.name) : null;
}

exports.default = async function afterPack(context) {
  if (!context || context.electronPlatformName !== 'darwin') return;

  // Only do this when auto-discovery is disabled (our default build flow in this repo).
  // If you later add real signing/notarization, you can omit this env var and/or delete this hook.
  if (String(process.env.CSC_IDENTITY_AUTO_DISCOVERY || '').toLowerCase() !== 'false') return;

  const appOutDir = context.appOutDir;
  if (!appOutDir) return;

  const appPath = findAppBundle(appOutDir);
  if (!appPath) return;

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
};


