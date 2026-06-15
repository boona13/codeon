# Codeon Build Commands

This document contains all build commands for macOS, Windows, and Linux platforms.

## Developer info

Signing/notarization is optional and only needed if you distribute installers.
Provide your own Apple Developer credentials via environment variables — never
commit them:

- `APPLE_ID` – your Apple ID email
- `APPLE_TEAM_ID` – your Apple Developer Team ID
- `APPLE_APP_SPECIFIC_PASSWORD` – an app-specific password (create one at appleid.apple.com)

## Prerequisites

```bash
# Install dependencies first
npm install
```

---

## macOS Build (Signed & Notarized)

### Full Build with Code Signing and Notarization

```bash
cd /path/to/codeon && \
CSC_NAME="Your Developer ID Application: Name (TEAMID)" \
NOTARIZE=1 \
NOTARYTOOL_PROFILE=your-notary-profile \
npm run build:mac
```

### Environment Variables Explained
- `CSC_NAME` - Your Apple Developer ID certificate name
- `NOTARIZE=1` - Enable Apple notarization
- `NOTARYTOOL_PROFILE` - Your notarytool credentials profile name

### Output Files
| File | Architecture | Type |
|------|-------------|------|
| `dist/Codeon-1.0.0.dmg` | x64 (Intel) | DMG Installer |
| `dist/Codeon-1.0.0-mac.zip` | x64 (Intel) | ZIP Archive |
| `dist/Codeon-1.0.0-arm64.dmg` | arm64 (Apple Silicon) | DMG Installer |
| `dist/Codeon-1.0.0-arm64-mac.zip` | arm64 (Apple Silicon) | ZIP Archive |

---

## Windows Build

### Build Command

```bash
cd /path/to/codeon && \
npm run build:win -- --x64 --config.npmRebuild=false
```

### Notes
- `--config.npmRebuild=false` - Required when cross-compiling from macOS (uses prebuilt native binaries)
- Windows builds are **not code signed** (requires a Windows Code Signing Certificate)

### Output Files
| File | Type |
|------|------|
| `dist/Codeon Setup 1.0.0.exe` | NSIS Installer |
| `dist/Codeon 1.0.0.exe` | Portable Executable |

### Optional: With Code Signing (requires certificate)

```bash
WIN_CSC_LINK=path/to/certificate.pfx \
WIN_CSC_KEY_PASSWORD=your_password \
npm run build:win -- --x64 --config.npmRebuild=false
```

---

## Linux Build

### Build Command (AppImage + .deb)

```bash
cd /path/to/codeon && \
npx electron-builder --config electron-builder.json --linux AppImage deb --x64 --config.npmRebuild=false
```

### Alternative: Using npm script

```bash
cd /path/to/codeon && \
npm run build:linux -- --x64 --config.npmRebuild=false
```

> **Note:** The npm script includes RPM target which requires `rpmbuild` to be installed (`brew install rpm` on macOS). Use the `npx` command above to build only AppImage and .deb.

### Notes
- `--config.npmRebuild=false` - Required when cross-compiling from macOS
- RPM builds require `rpmbuild` tool (optional)

### Output Files
| File | Type |
|------|------|
| `dist/Codeon-1.0.0.AppImage` | AppImage (universal) |
| `dist/codeon_1.0.0_amd64.deb` | Debian/Ubuntu package |

---

## Build All Platforms

### Quick Reference

```bash
# Navigate to project
cd /path/to/codeon

# 1. macOS (with signing & notarization)
CSC_NAME="Your Developer ID Application: Name (TEAMID)" NOTARIZE=1 NOTARYTOOL_PROFILE=your-notary-profile npm run build:mac

# 2. Windows
npm run build:win -- --x64 --config.npmRebuild=false

# 3. Linux (AppImage + deb only)
npx electron-builder --config electron-builder.json --linux AppImage deb --x64 --config.npmRebuild=false
```

---

## Available npm Scripts

```bash
npm run build          # Build for current platform
npm run build:mac      # Build for macOS
npm run build:win      # Build for Windows
npm run build:linux    # Build for Linux (all targets)
npm run dev            # Run in development mode
npm run start          # Run the app
```

---

## Troubleshooting

### Cross-compilation fails with native modules
Use `--config.npmRebuild=false` to skip rebuilding native modules and use prebuilt binaries.

### macOS notarization fails
1. Ensure your Apple Developer credentials are stored:
   ```bash
   xcrun notarytool store-credentials "your-notary-profile" \
     --apple-id "your@email.com" \
     --team-id "TEAM_ID" \
     --password "app-specific-password"
   ```

### Windows SmartScreen warning
Without a code signing certificate, Windows will show "Windows protected your PC" warning. Users can click "More info" → "Run anyway".

### Linux RPM build fails
Install rpmbuild: `brew install rpm` (macOS) or skip RPM by specifying targets explicitly.

---

## Output Directory Structure

```
dist/
├── mac/                          # macOS x64 app bundle
├── mac-arm64/                    # macOS arm64 app bundle
├── win-unpacked/                 # Windows unpacked app
├── linux-unpacked/               # Linux unpacked app
├── Codeon-1.0.0.dmg             # macOS x64 installer
├── Codeon-1.0.0-arm64.dmg       # macOS arm64 installer
├── Codeon-1.0.0-mac.zip         # macOS x64 archive
├── Codeon-1.0.0-arm64-mac.zip   # macOS arm64 archive
├── Codeon Setup 1.0.0.exe       # Windows NSIS installer
├── Codeon 1.0.0.exe             # Windows portable
├── Codeon-1.0.0.AppImage        # Linux AppImage
└── codeon_1.0.0_amd64.deb       # Linux Debian package
```
