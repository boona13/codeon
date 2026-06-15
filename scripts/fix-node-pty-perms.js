// Ensure node-pty's unix spawn-helper is executable.
// Some environments/checkouts end up with mode 0644 which causes `posix_spawnp failed`.

const fs = require('fs');
const path = require('path');

function chmodIfExists(p, mode) {
  try {
    if (!fs.existsSync(p)) return false;
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    fs.chmodSync(p, mode);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const platform = process.platform;
  if (platform === 'win32') {
    process.exit(0);
  }

  const root = path.resolve(__dirname, '..');
  const base = path.join(root, 'node_modules', 'node-pty');

  const targets = [];
  // Prefer built artifacts if present
  targets.push(path.join(base, 'build', 'Release', 'spawn-helper'));
  targets.push(path.join(base, 'build', 'Debug', 'spawn-helper'));

  // Prebuilds (most common in this repo)
  const prebuilds = path.join(base, 'prebuilds');
  if (fs.existsSync(prebuilds)) {
    try {
      const entries = fs.readdirSync(prebuilds, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        targets.push(path.join(prebuilds, e.name, 'spawn-helper'));
      }
    } catch {
      // ignore
    }
  }

  const changed = [];
  for (const t of targets) {
    const ok = chmodIfExists(t, 0o755);
    if (ok) changed.push(t);
  }

  if (changed.length > 0) {
    console.log('[fix-node-pty-perms] Made spawn-helper executable:', changed);
  } else {
    console.log('[fix-node-pty-perms] No spawn-helper found to chmod (ok).');
  }
}

main();


