/**
 * electron-builder hook: run after macOS signing.
 *
 * This script notarizes and staples the .app using Apple's notarytool.
 *
 * Usage (recommended):
 * 1) Create and install a "Developer ID Application" certificate in your Keychain.
 * 2) Store notarytool credentials once:
 *    xcrun notarytool store-credentials "codeon-notary" \
 *      --apple-id "YOUR_APPLE_ID_EMAIL" \
 *      --team-id "YOUR_TEAM_ID" \
 *      --password "APP_SPECIFIC_PASSWORD"
 * 3) Build with:
 *    NOTARIZE=1 NOTARYTOOL_PROFILE=codeon-notary npm run build
 *
 * Notes:
 * - Notarization is required to avoid scary Gatekeeper dialogs on other machines.
 * - This does not run unless NOTARIZE=1 is set.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findAppBundle(appOutDir) {
  const entries = fs.readdirSync(appOutDir, { withFileTypes: true });
  const app = entries.find((e) => e.isDirectory() && e.name.endsWith('.app'));
  return app ? path.join(appOutDir, app.name) : null;
}

function sh(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

exports.default = async function afterSign(context) {
  if (!context || context.electronPlatformName !== 'darwin') return;

  const shouldNotarize = String(process.env.NOTARIZE || '').trim() === '1';
  if (!shouldNotarize) return;

  const profile =
    process.env.NOTARYTOOL_PROFILE ||
    process.env.APPLE_NOTARYTOOL_PROFILE ||
    process.env.APPLE_NOTARIZE_PROFILE;

  if (!profile) {
    throw new Error(
      'NOTARIZE=1 is set but no notarytool profile was provided. Set NOTARYTOOL_PROFILE=codeon-notary (or APPLE_NOTARYTOOL_PROFILE).'
    );
  }

  const appPath = findAppBundle(context.appOutDir);
  if (!appPath) throw new Error(`Could not find .app bundle in ${context.appOutDir}`);

  const tmpZip = path.join(os.tmpdir(), `codeon-notarize-${Date.now()}.zip`);

  // Create a zip suitable for notarization submission.
  // ditto is Apple's recommended tool for zipping .app bundles for notarization.
  sh('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, tmpZip]);

  // Submit and wait for result.
  sh('xcrun', ['notarytool', 'submit', tmpZip, '--keychain-profile', profile, '--wait']);

  // Staple notarization ticket to the app bundle.
  sh('xcrun', ['stapler', 'staple', '-v', appPath]);
};


