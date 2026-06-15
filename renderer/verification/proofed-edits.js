(function () {
  'use strict';

  if (window._proofedEdits) return;

  const MAX_LOG_CHARS = 6000;
  const DEFAULT_TIMEOUT_MS = 60000;
  const COMMAND_TIMEOUTS_MS = {
    lint: 60000,
    typecheck: 90000,
    tests: 120000
  };
  const AI_PLAN_TIMEOUT_MS = 45000;
  const MAX_AI_COMMANDS = 4;
  const MAX_AI_COMMAND_CHARS = 220;
  const MAX_CONTEXT_ITEMS = 30;

  let verificationChain = Promise.resolve();

  const _trim = (s) => (typeof s === 'string' ? s.trim() : '');

  function _escapeHtml(text) {
    try { return window.escapeHtml(String(text || '')); } catch { /* ignore */ }
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _escapeAttr(text) {
    try { return window.escapeAttr(String(text || '')); } catch { /* ignore */ }
    return String(text || '').replace(/"/g, '&quot;');
  }

  function _getSettings() {
    try {
      if (window.appSettings && typeof window.appSettings === 'object') return window.appSettings;
      if (window.settings && typeof window.settings === 'object') return window.settings;
    } catch { /* ignore */ }
    return null;
  }

  function _isPlanMode() {
    try {
      const st = _getSettings();
      return st && st.permissionMode === 'plan';
    } catch {
      return false;
    }
  }

  function _truncateOutput(text) {
    const s = String(text || '');
    if (s.length <= MAX_LOG_CHARS) return s;
    const over = s.length - MAX_LOG_CHARS;
    return `...(truncated ${over} chars)\n` + s.slice(-MAX_LOG_CHARS);
  }

  function _parseGitStatus(output) {
    const out = [];
    const lines = String(output || '').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const raw = line.slice(3).trim();
      if (!raw) continue;
      const path = raw.includes('->') ? raw.split('->').pop().trim() : raw;
      if (path) out.push(path);
    }
    return Array.from(new Set(out));
  }

  function _normalizePath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  }

  function _joinPath(root, rel) {
    const base = _normalizePath(root);
    const next = _normalizePath(rel);
    return base ? `${base}/${next}` : next;
  }

  const _existsCache = new Map();
  async function _fileExists(relPath, { expectDir = false, root = '' } = {}) {
    const joined = _joinPath(root, relPath);
    const key = `${expectDir ? 'd' : 'f'}:${String(joined || '').toLowerCase()}`;
    if (_existsCache.has(key)) return _existsCache.get(key);
    try {
      if (!window.electronAPI || typeof window.electronAPI.getFileStats !== 'function') {
        _existsCache.set(key, false);
        return false;
      }
      const res = await window.electronAPI.getFileStats(joined);
      const ok = !!(res && res.success === true && res.stats && (expectDir ? res.stats.isDirectory : res.stats.isFile));
      _existsCache.set(key, ok);
      return ok;
    } catch {
      _existsCache.set(key, false);
      return false;
    }
  }

  async function _readTextIfExists(relPath, { root = '', maxBytes = 200000 } = {}) {
    try {
      if (!window.electronAPI || typeof window.electronAPI.readFile !== 'function') return '';
      const joined = _joinPath(root, relPath);
      const stats = await window.electronAPI.getFileStats(joined);
      if (!stats || stats.success !== true || !stats.stats || stats.stats.isFile !== true) return '';
      if (Number(stats.stats.size || 0) > maxBytes) return '';
      const res = await window.electronAPI.readFile(joined);
      if (!res || res.success !== true) return '';
      return String(res.content || '');
    } catch {
      return '';
    }
  }

  async function _readPackageJson(root = '') {
    try {
      if (!window.electronAPI || typeof window.electronAPI.readFile !== 'function') return null;
      const res = await window.electronAPI.readFile(_joinPath(root, 'package.json'));
      if (!res || res.success !== true) return null;
      return JSON.parse(String(res.content || ''));
    } catch {
      return null;
    }
  }

  async function _listProjectEntries(maxDepth = 4) {
    try {
      if (!window.electronAPI || typeof window.electronAPI.listDir !== 'function') return [];
      const res = await window.electronAPI.listDir('.', { maxDepth });
      if (!res || res.success !== true || !Array.isArray(res.files)) return [];
      const out = [];
      const walk = (items) => {
        for (const item of items) {
          if (!item) continue;
          const rel = _normalizePath(item.path || item.name || '');
          const name = String(item.name || rel.split('/').pop() || rel);
          if (!rel) continue;
          const pathLower = rel.toLowerCase();
          const nameLower = name.toLowerCase();
          out.push({ path: rel, name, type: item.type || 'file', pathLower, nameLower });
          if (Array.isArray(item.children) && item.children.length > 0) walk(item.children);
        }
      };
      walk(res.files);
      return out;
    } catch {
      return [];
    }
  }

  const PROJECT_ROOT_MARKERS = new Set([
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'setup.py',
    'pipfile',
    'pipfile.lock',
    'uv.lock',
    'pdm.lock',
    'go.mod',
    'cargo.toml',
    'gemfile',
    'composer.json',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'package.swift',
    'mix.exs',
    'build.sbt',
    'project.clj',
    'deps.edn',
    'stack.yaml',
    'cabal.project',
    'cmakelists.txt',
    'meson.build',
    'makefile'
  ]);

  const PROJECT_ROOT_EXTS = new Set(['.sln', '.csproj', '.fsproj', '.vbproj', '.cabal']);
  const PROJECT_ROOT_DIR_MARKERS = new Set(['.xcodeproj', '.xcworkspace']);

  function _detectProjectRoots(entries) {
    const roots = new Set(['']);
    for (const entry of entries || []) {
      if (!entry) continue;
      if (entry.type === 'directory') {
        const nameLowerDir = entry.nameLower || String(entry.name || '').toLowerCase();
        if (nameLowerDir && PROJECT_ROOT_DIR_MARKERS.has(nameLowerDir.slice(nameLowerDir.lastIndexOf('.')))) {
          const relDir = _normalizePath(entry.path);
          const dirBase = relDir.includes('/') ? relDir.split('/').slice(0, -1).join('/') : '';
          roots.add(dirBase);
        }
        continue;
      }
      const nameLower = entry.nameLower || String(entry.name || '').toLowerCase();
      const pathLower = entry.pathLower || String(entry.path || '').toLowerCase();
      if (!pathLower) continue;
      const dotIdx = nameLower.lastIndexOf('.');
      const ext = dotIdx > 0 ? nameLower.slice(dotIdx) : '';
      if (PROJECT_ROOT_MARKERS.has(nameLower) || (ext && PROJECT_ROOT_EXTS.has(ext))) {
        const rel = _normalizePath(entry.path);
        const dir = rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '';
        roots.add(dir);
      }
    }
    return Array.from(roots);
  }

  function _rankRoots(roots, changedFiles) {
    const files = Array.isArray(changedFiles) ? changedFiles.map(_normalizePath).filter(Boolean) : [];
    const scored = roots.map((root) => {
      const r = _normalizePath(root);
      const prefix = r ? `${r}/` : '';
      const count = files.reduce((acc, f) => {
        if (!f) return acc;
        if (!r) return acc + 1;
        return (f === r || f.startsWith(prefix)) ? acc + 1 : acc;
      }, 0);
      const depth = r ? r.split('/').length : 0;
      return { root: r, count, depth };
    });
    const hasNonRootHits = scored.some(s => s.root && s.count > 0);
    const adjusted = scored.map((s) => {
      if (!s.root && hasNonRootHits) return { ...s, count: 0 };
      return s;
    });
    adjusted.sort((a, b) => (b.count - a.count) || (b.depth - a.depth) || (a.root.length - b.root.length));
    return adjusted.map(s => s.root);
  }

  function _pathInRoot(pathLower, rootLower) {
    if (!rootLower) return true;
    return pathLower === rootLower || pathLower.startsWith(`${rootLower}/`);
  }

  function _findXcodeEntries(entries, root) {
    const rootLower = _normalizePath(root).toLowerCase();
    const projects = [];
    const workspaces = [];
    for (const entry of entries || []) {
      if (!entry || entry.type !== 'directory') continue;
      const nameLower = entry.nameLower || '';
      if (!nameLower.endsWith('.xcodeproj') && !nameLower.endsWith('.xcworkspace')) continue;
      if (!_pathInRoot(entry.pathLower || '', rootLower)) continue;
      const rel = _normalizePath(entry.path);
      if (nameLower.endsWith('.xcworkspace')) workspaces.push(rel);
      else projects.push(rel);
    }
    return { projects, workspaces };
  }

  function _hasFileInRoot(entries, root, filename) {
    const rootLower = _normalizePath(root).toLowerCase();
    const nameLower = String(filename || '').toLowerCase();
    return (entries || []).some(e => e && e.type !== 'directory' && e.nameLower === nameLower && _pathInRoot(e.pathLower || '', rootLower));
  }

  function _hasDirInRoot(entries, root, dirname) {
    const rootLower = _normalizePath(root).toLowerCase();
    const nameLower = String(dirname || '').toLowerCase();
    return (entries || []).some(e => e && e.type === 'directory' && e.nameLower === nameLower && _pathInRoot(e.pathLower || '', rootLower));
  }

  function _hasExtInRoot(entries, root, ext) {
    const rootLower = _normalizePath(root).toLowerCase();
    const extLower = String(ext || '').toLowerCase();
    return (entries || []).some(e => e && e.type !== 'directory' && e.pathLower && e.pathLower.endsWith(extLower) && _pathInRoot(e.pathLower, rootLower));
  }

  async function _inspectProjectRoot(root, entries) {
    const base = _normalizePath(root);

    const pkg = await _readPackageJson(base);
    const pyprojectText = await _readTextIfExists('pyproject.toml', { root: base });
    const setupCfgText = await _readTextIfExists('setup.cfg', { root: base });
    const toxText = await _readTextIfExists('tox.ini', { root: base });
    const xcodeEntries = _findXcodeEntries(entries, base);

    const hasPackageJson = !!pkg || await _fileExists('package.json', { root: base });
    const hasPnpmLock = await _fileExists('pnpm-lock.yaml', { root: base }) || _hasFileInRoot(entries, base, 'pnpm-lock.yaml');
    const hasYarnLock = await _fileExists('yarn.lock', { root: base }) || _hasFileInRoot(entries, base, 'yarn.lock');
    const hasBunLock = await _fileExists('bun.lockb', { root: base }) || await _fileExists('bun.lock', { root: base }) ||
      _hasFileInRoot(entries, base, 'bun.lockb') || _hasFileInRoot(entries, base, 'bun.lock');
    const hasPackageLock = await _fileExists('package-lock.json', { root: base }) || _hasFileInRoot(entries, base, 'package-lock.json');

    const hasTsconfig = await _fileExists('tsconfig.json', { root: base }) || await _fileExists('tsconfig.base.json', { root: base });
    const hasEslintConfig = !!(pkg && pkg.eslintConfig) ||
      await _fileExists('eslint.config.js', { root: base }) || await _fileExists('eslint.config.mjs', { root: base }) || await _fileExists('eslint.config.cjs', { root: base }) ||
      await _fileExists('.eslintrc', { root: base }) || await _fileExists('.eslintrc.js', { root: base }) || await _fileExists('.eslintrc.cjs', { root: base }) ||
      await _fileExists('.eslintrc.json', { root: base }) || await _fileExists('.eslintrc.yaml', { root: base }) || await _fileExists('.eslintrc.yml', { root: base });

    const hasVitestConfig =
      await _fileExists('vitest.config.ts', { root: base }) || await _fileExists('vitest.config.js', { root: base }) ||
      await _fileExists('vitest.config.mjs', { root: base }) || await _fileExists('vitest.config.cjs', { root: base });
    const hasJestConfig =
      await _fileExists('jest.config.ts', { root: base }) || await _fileExists('jest.config.js', { root: base }) ||
      await _fileExists('jest.config.mjs', { root: base }) || await _fileExists('jest.config.cjs', { root: base }) || await _fileExists('jest.config.json', { root: base });
    const hasPlaywrightConfig =
      await _fileExists('playwright.config.ts', { root: base }) || await _fileExists('playwright.config.js', { root: base }) || await _fileExists('playwright.config.mjs', { root: base });

    const hasPyproject = !!pyprojectText || await _fileExists('pyproject.toml', { root: base });
    const hasPoetryLock = await _fileExists('poetry.lock', { root: base });
    const hasPipfile = await _fileExists('Pipfile', { root: base }) || await _fileExists('Pipfile.lock', { root: base });
    const hasUvLock = await _fileExists('uv.lock', { root: base });
    const hasPdmLock = await _fileExists('pdm.lock', { root: base });
    const hasRequirements = await _fileExists('requirements.txt', { root: base });
    const hasSetupPy = await _fileExists('setup.py', { root: base });

    const hasRuffConfig = /tool\.ruff/i.test(pyprojectText) ||
      await _fileExists('ruff.toml', { root: base }) || await _fileExists('.ruff.toml', { root: base });
    const hasFlake8Config = /flake8/i.test(setupCfgText) || /flake8/i.test(toxText) ||
      await _fileExists('.flake8', { root: base });
    const hasMypyConfig = /tool\.mypy/i.test(pyprojectText) ||
      await _fileExists('mypy.ini', { root: base }) || await _fileExists('.mypy.ini', { root: base });
    const hasPytestConfig = /pytest/i.test(pyprojectText) || /pytest/i.test(toxText) ||
      await _fileExists('pytest.ini', { root: base }) || await _fileExists('tox.ini', { root: base });
    const hasTestsDir = _hasDirInRoot(entries, base, 'tests') || _hasDirInRoot(entries, base, 'test') || _hasDirInRoot(entries, base, 'spec') ||
      await _fileExists('tests', { root: base, expectDir: true }) || await _fileExists('test', { root: base, expectDir: true }) || await _fileExists('spec', { root: base, expectDir: true });

    const hasGoMod = await _fileExists('go.mod', { root: base });
    const hasGolangciConfig =
      await _fileExists('.golangci.yml', { root: base }) || await _fileExists('.golangci.yaml', { root: base }) || await _fileExists('.golangci.toml', { root: base }) || await _fileExists('.golangci.json', { root: base });

    const hasCargoToml = await _fileExists('Cargo.toml', { root: base });
    const hasClippyConfig = await _fileExists('clippy.toml', { root: base }) || await _fileExists('.clippy.toml', { root: base });

    const hasGemfile = await _fileExists('Gemfile', { root: base });
    const hasRubocopConfig = await _fileExists('.rubocop.yml', { root: base }) || await _fileExists('.rubocop.yaml', { root: base });
    const hasRspecConfig = await _fileExists('.rspec', { root: base }) || _hasDirInRoot(entries, base, 'spec') || await _fileExists('spec', { root: base, expectDir: true });

    const hasComposerJson = await _fileExists('composer.json', { root: base });
    const hasPhpunitConfig = await _fileExists('phpunit.xml', { root: base }) || await _fileExists('phpunit.xml.dist', { root: base });
    const hasPhpcsConfig = await _fileExists('phpcs.xml', { root: base }) || await _fileExists('phpcs.xml.dist', { root: base });

    const hasPomXml = await _fileExists('pom.xml', { root: base });
    const hasGradle = await _fileExists('build.gradle', { root: base }) || await _fileExists('build.gradle.kts', { root: base });
    const hasGradleWrapper = await _fileExists('gradlew', { root: base }) || await _fileExists('gradlew.bat', { root: base });

    const hasDotnet = _hasExtInRoot(entries, base, '.sln') || _hasExtInRoot(entries, base, '.csproj') || _hasExtInRoot(entries, base, '.fsproj') || _hasExtInRoot(entries, base, '.vbproj');

    const hasSwiftPackage = await _fileExists('Package.swift', { root: base });
    const hasXcodeProject = xcodeEntries.projects.length > 0;
    const hasXcodeWorkspace = xcodeEntries.workspaces.length > 0;
    const hasSwiftLintConfig = await _fileExists('.swiftlint.yml', { root: base }) ||
      await _fileExists('.swiftlint.yaml', { root: base }) || await _fileExists('.swiftlint.json', { root: base });
    const hasMixExs = await _fileExists('mix.exs', { root: base });
    const hasMixFormatter = await _fileExists('.formatter.exs', { root: base });
    const hasSbt = await _fileExists('build.sbt', { root: base }) || await _fileExists('project/build.properties', { root: base });
    const hasLein = await _fileExists('project.clj', { root: base });
    const hasDepsEdn = await _fileExists('deps.edn', { root: base });
    const hasStackYaml = await _fileExists('stack.yaml', { root: base });
    const hasCabalProject = await _fileExists('cabal.project', { root: base });
    const hasCabalFile = _hasExtInRoot(entries, base, '.cabal');
    const hasCmakeLists = await _fileExists('CMakeLists.txt', { root: base });
    const hasMakefile = await _fileExists('Makefile', { root: base });
    const hasMesonBuild = await _fileExists('meson.build', { root: base });
    const hasCmakeBuild = await _fileExists('build/CMakeCache.txt', { root: base });
    const hasMesonBuildDir = await _fileExists('build/build.ninja', { root: base });

    return {
      root: base,
      packageJson: pkg,
      pyprojectText,
      hasPackageJson,
      hasPnpmLock,
      hasYarnLock,
      hasBunLock,
      hasPackageLock,
      hasTsconfig,
      hasEslintConfig,
      hasVitestConfig,
      hasJestConfig,
      hasPlaywrightConfig,
      hasPyproject,
      hasPoetryLock,
      hasPipfile,
      hasUvLock,
      hasPdmLock,
      hasRequirements,
      hasSetupPy,
      hasRuffConfig,
      hasFlake8Config,
      hasMypyConfig,
      hasPytestConfig,
      hasTestsDir,
      hasGoMod,
      hasGolangciConfig,
      hasCargoToml,
      hasClippyConfig,
      hasGemfile,
      hasRubocopConfig,
      hasRspecConfig,
      hasComposerJson,
      hasPhpunitConfig,
      hasPhpcsConfig,
      hasPomXml,
      hasGradle,
      hasGradleWrapper,
      hasDotnet,
      hasSwiftPackage,
      hasXcodeProject,
      hasXcodeWorkspace,
      hasSwiftLintConfig,
      xcodeProjects: xcodeEntries.projects,
      xcodeWorkspaces: xcodeEntries.workspaces,
      hasMixExs,
      hasMixFormatter,
      hasSbt,
      hasLein,
      hasDepsEdn,
      hasStackYaml,
      hasCabalProject,
      hasCabalFile,
      hasCmakeLists,
      hasMakefile,
      hasMesonBuild,
      hasCmakeBuild,
      hasMesonBuildDir
    };
  }

  function _jsRunner(sig) {
    const pkgManager = String(sig?.packageJson?.packageManager || '').toLowerCase();
    if (pkgManager.includes('pnpm')) {
      return {
        name: 'pnpm',
        script: (s) => `pnpm run ${s}`,
        exec: (cmd) => `pnpm exec ${cmd}`
      };
    }
    if (pkgManager.includes('yarn')) {
      return {
        name: 'yarn',
        script: (s) => `yarn ${s}`,
        exec: (cmd) => `yarn ${cmd}`
      };
    }
    if (pkgManager.includes('bun')) {
      return {
        name: 'bun',
        script: (s) => `bun run ${s}`,
        exec: (cmd) => `bun x ${cmd}`
      };
    }
    if (sig.hasPnpmLock) {
      return {
        name: 'pnpm',
        script: (s) => `pnpm run ${s}`,
        exec: (cmd) => `pnpm exec ${cmd}`
      };
    }
    if (sig.hasYarnLock) {
      return {
        name: 'yarn',
        script: (s) => `yarn ${s}`,
        exec: (cmd) => `yarn ${cmd}`
      };
    }
    if (sig.hasBunLock) {
      return {
        name: 'bun',
        script: (s) => `bun run ${s}`,
        exec: (cmd) => `bun x ${cmd}`
      };
    }
    return {
      name: 'npm',
      script: (s) => `npm run ${s}`,
      exec: (cmd) => `npx ${cmd}`
    };
  }

  function _pythonRunner(sig) {
    if (sig.hasPoetryLock || /tool\.poetry/i.test('' + (sig.pyprojectText || ''))) {
      return { name: 'poetry', module: (m, args) => `poetry run python -m ${m}${args ? ` ${args}` : ''}` };
    }
    if (sig.hasPipfile) {
      return { name: 'pipenv', module: (m, args) => `pipenv run python -m ${m}${args ? ` ${args}` : ''}` };
    }
    if (sig.hasUvLock) {
      return { name: 'uv', module: (m, args) => `uv run python -m ${m}${args ? ` ${args}` : ''}` };
    }
    if (sig.hasPdmLock || /tool\.pdm/i.test('' + (sig.pyprojectText || ''))) {
      return { name: 'pdm', module: (m, args) => `pdm run python -m ${m}${args ? ` ${args}` : ''}` };
    }
    return { name: 'python', module: (m, args) => `python -m ${m}${args ? ` ${args}` : ''}` };
  }

  function _buildJsCommands(sig) {
    if (!sig.hasPackageJson && !sig.packageJson) return [];
    const commands = [];
    const scripts = sig.packageJson && typeof sig.packageJson === 'object' ? sig.packageJson.scripts || {} : {};
    const hasScript = (name) => typeof scripts[name] === 'string' && scripts[name].trim();
    const pickScript = (names) => names.find(hasScript);
    const runner = _jsRunner(sig);

    const lintScript = pickScript(['lint:ci', 'lint:check', 'lint']);
    if (lintScript) {
      commands.push({ id: 'lint', label: 'Lint', command: runner.script(lintScript), timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    } else if (sig.hasEslintConfig) {
      commands.push({ id: 'lint', label: 'Lint (ESLint)', command: runner.exec('eslint .'), timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    }

    const typeScript = pickScript(['typecheck', 'type-check', 'check:types', 'types:check', 'tsc']);
    if (typeScript) {
      commands.push({ id: 'typecheck', label: 'Typecheck', command: runner.script(typeScript), timeoutMs: COMMAND_TIMEOUTS_MS.typecheck });
    } else if (sig.hasTsconfig) {
      commands.push({ id: 'typecheck', label: 'Typecheck (tsc)', command: runner.exec('tsc -p tsconfig.json --noEmit'), timeoutMs: COMMAND_TIMEOUTS_MS.typecheck });
    }

    const testScript = pickScript(['test:ci', 'test-ci', 'test']);
    if (testScript) {
      commands.push({
        id: 'tests',
        label: testScript.includes('ci') ? 'Tests (CI)' : 'Tests',
        command: runner.script(testScript),
        timeoutMs: COMMAND_TIMEOUTS_MS.tests
      });
    } else if (sig.hasVitestConfig) {
      commands.push({ id: 'tests', label: 'Tests (Vitest)', command: runner.exec('vitest run --passWithNoTests'), timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    } else if (sig.hasJestConfig) {
      commands.push({ id: 'tests', label: 'Tests (Jest)', command: runner.exec('jest --ci'), timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    } else if (sig.hasPlaywrightConfig) {
      commands.push({ id: 'tests', label: 'Tests (Playwright)', command: runner.exec('playwright test'), timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    }

    return commands;
  }

  function _buildPythonCommands(sig) {
    const pythonDetected = sig.hasPyproject || sig.hasRequirements || sig.hasSetupPy || sig.hasPipfile || sig.hasUvLock;
    if (!pythonDetected) return [];
    const commands = [];
    const runner = _pythonRunner(sig);

    if (sig.hasRuffConfig) {
      commands.push({ id: 'lint', label: 'Lint (Ruff)', command: runner.module('ruff', 'check .'), timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    } else if (sig.hasFlake8Config) {
      commands.push({ id: 'lint', label: 'Lint (Flake8)', command: runner.module('flake8', '.'), timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    }

    if (sig.hasMypyConfig) {
      commands.push({ id: 'typecheck', label: 'Typecheck (Mypy)', command: runner.module('mypy', '.'), timeoutMs: COMMAND_TIMEOUTS_MS.typecheck });
    }

    if (sig.hasPytestConfig || sig.hasTestsDir) {
      commands.push({ id: 'tests', label: 'Tests (Pytest)', command: runner.module('pytest', ''), timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    }

    return commands;
  }

  function _buildGoCommands(sig) {
    if (!sig.hasGoMod) return [];
    const commands = [];
    if (sig.hasGolangciConfig) {
      commands.push({ id: 'lint', label: 'Lint (golangci-lint)', command: 'golangci-lint run ./...', timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    }
    commands.push({ id: 'tests', label: 'Tests (Go)', command: 'go test ./...', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    return commands;
  }

  function _buildRustCommands(sig) {
    if (!sig.hasCargoToml) return [];
    const commands = [];
    if (sig.hasClippyConfig) {
      commands.push({ id: 'lint', label: 'Lint (Clippy)', command: 'cargo clippy --all-targets', timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    }
    commands.push({ id: 'tests', label: 'Tests (Cargo)', command: 'cargo test --all', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    return commands;
  }

  function _buildDotnetCommands(sig) {
    if (!sig.hasDotnet) return [];
    return [{ id: 'tests', label: 'Tests (.NET)', command: 'dotnet test', timeoutMs: COMMAND_TIMEOUTS_MS.tests }];
  }

  function _buildJavaCommands(sig) {
    if (!sig.hasPomXml && !sig.hasGradle) return [];
    if (sig.hasPomXml) {
      return [{ id: 'tests', label: 'Tests (Maven)', command: 'mvn test', timeoutMs: COMMAND_TIMEOUTS_MS.tests }];
    }
    const cmd = sig.hasGradleWrapper ? './gradlew test' : 'gradle test';
    return [{ id: 'tests', label: 'Tests (Gradle)', command: cmd, timeoutMs: COMMAND_TIMEOUTS_MS.tests }];
  }

  function _buildRubyCommands(sig) {
    if (!sig.hasGemfile) return [];
    const commands = [];
    if (sig.hasRubocopConfig) {
      commands.push({ id: 'lint', label: 'Lint (RuboCop)', command: 'bundle exec rubocop', timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    }
    if (sig.hasRspecConfig || sig.hasTestsDir) {
      commands.push({ id: 'tests', label: 'Tests (RSpec)', command: 'bundle exec rspec', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    }
    return commands;
  }

  function _buildPhpCommands(sig) {
    if (!sig.hasComposerJson) return [];
    const commands = [];
    if (sig.hasPhpcsConfig) {
      commands.push({ id: 'lint', label: 'Lint (PHPCS)', command: 'vendor/bin/phpcs', timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    }
    if (sig.hasPhpunitConfig) {
      commands.push({ id: 'tests', label: 'Tests (PHPUnit)', command: 'vendor/bin/phpunit', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    }
    return commands;
  }

  function _extractJsonFromOutput(output) {
    try {
      const text = String(output || '');
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  function _basenameNoExt(p) {
    const rel = _normalizePath(p);
    const name = rel.split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }

  async function _resolveXcodeScheme(sig) {
    const workspace = Array.isArray(sig.xcodeWorkspaces) && sig.xcodeWorkspaces.length ? sig.xcodeWorkspaces[0] : '';
    const project = Array.isArray(sig.xcodeProjects) && sig.xcodeProjects.length ? sig.xcodeProjects[0] : '';
    const baseArgs = workspace ? `-workspace "${workspace}"` : (project ? `-project "${project}"` : '');
    if (!baseArgs) return { baseArgs: '', scheme: '' };

    const listRes = await _runCommand(`xcodebuild -list -json ${baseArgs}`, 20000, sig.root || '');
    const json = listRes && listRes.success === true ? _extractJsonFromOutput(listRes.output || '') : null;
    const schemes = json?.workspace?.schemes || json?.project?.schemes || [];
    let scheme = '';
    if (Array.isArray(schemes) && schemes.length) {
      scheme = schemes.find(s => /tests?/i.test(String(s || ''))) || schemes[0] || '';
    }
    if (!scheme) {
      scheme = _basenameNoExt(workspace || project);
    }
    return { baseArgs, scheme: String(scheme || '') };
  }

  async function _buildXcodeCommands(sig) {
    if (!sig.hasXcodeProject && !sig.hasXcodeWorkspace) return [];
    const { baseArgs, scheme } = await _resolveXcodeScheme(sig);
    if (!baseArgs || !scheme) return [];
    const commands = [];
    if (sig.hasSwiftLintConfig) {
      commands.push({ id: 'lint', label: 'Lint (SwiftLint)', command: 'swiftlint lint', timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    }
    commands.push({ id: 'build', label: 'Build (Xcode)', command: `xcodebuild ${baseArgs} -scheme "${scheme}" build`, timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    return commands;
  }

  function _buildSwiftCommands(sig) {
    if (!sig.hasSwiftPackage) return [];
    const commands = [];
    if (sig.hasSwiftLintConfig) {
      commands.push({ id: 'lint', label: 'Lint (SwiftLint)', command: 'swiftlint lint', timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    }
    commands.push({ id: 'tests', label: 'Tests (Swift)', command: 'swift test', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    return commands;
  }

  function _buildElixirCommands(sig) {
    if (!sig.hasMixExs) return [];
    const commands = [];
    if (sig.hasMixFormatter) {
      commands.push({ id: 'lint', label: 'Format (Mix)', command: 'mix format --check-formatted', timeoutMs: COMMAND_TIMEOUTS_MS.lint });
    }
    commands.push({ id: 'tests', label: 'Tests (Mix)', command: 'mix test', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    return commands;
  }

  function _buildScalaCommands(sig) {
    if (!sig.hasSbt) return [];
    return [{ id: 'tests', label: 'Tests (sbt)', command: 'sbt test', timeoutMs: COMMAND_TIMEOUTS_MS.tests }];
  }

  function _buildClojureCommands(sig) {
    if (!sig.hasLein && !sig.hasDepsEdn) return [];
    if (sig.hasLein) {
      return [{ id: 'tests', label: 'Tests (Leiningen)', command: 'lein test', timeoutMs: COMMAND_TIMEOUTS_MS.tests }];
    }
    return [{ id: 'tests', label: 'Tests (Clojure CLI)', command: 'clojure -M:test', timeoutMs: COMMAND_TIMEOUTS_MS.tests }];
  }

  function _buildHaskellCommands(sig) {
    if (!sig.hasStackYaml && !sig.hasCabalProject && !sig.hasCabalFile) return [];
    if (sig.hasStackYaml) {
      return [{ id: 'tests', label: 'Tests (Stack)', command: 'stack test', timeoutMs: COMMAND_TIMEOUTS_MS.tests }];
    }
    return [{ id: 'tests', label: 'Tests (Cabal)', command: 'cabal test', timeoutMs: COMMAND_TIMEOUTS_MS.tests }];
  }

  function _buildCppCommands(sig) {
    const commands = [];
    if (sig.hasCmakeLists && sig.hasCmakeBuild) {
      commands.push({ id: 'build', label: 'Build (CMake)', command: 'cmake --build build', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
      commands.push({ id: 'tests', label: 'Tests (CTest)', command: 'ctest --test-dir build', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    } else if (sig.hasMesonBuild && sig.hasMesonBuildDir) {
      commands.push({ id: 'tests', label: 'Tests (Meson)', command: 'meson test -C build', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    } else if (sig.hasMakefile && sig.hasTestsDir) {
      commands.push({ id: 'tests', label: 'Tests (Make)', command: 'make test', timeoutMs: COMMAND_TIMEOUTS_MS.tests });
    }
    return commands;
  }

  function _dedupeCommands(list) {
    const seen = new Set();
    const out = [];
    for (const cmd of list || []) {
      const key = `${cmd.id}:${cmd.command}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cmd);
    }
    return out;
  }

  function _limitList(list, limit = MAX_CONTEXT_ITEMS) {
    if (!Array.isArray(list)) return [];
    return list.filter(Boolean).slice(0, limit);
  }

  function _stripRootPrefix(relPath, root) {
    const rel = _normalizePath(relPath);
    const base = _normalizePath(root);
    if (!base) return rel;
    if (rel === base) return '';
    if (rel.startsWith(`${base}/`)) return rel.slice(base.length + 1);
    return rel;
  }

  function _summarizeEntries(entries, root = '') {
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
    const testHints = ['test', 'tests', 'spec', '__tests__'];
    const topLevelDirs = [];
    const topLevelFiles = [];
    const imageFiles = [];
    const testFiles = [];
    const rootLower = _normalizePath(root).toLowerCase();

    for (const entry of entries || []) {
      if (!entry) continue;
      if (!_pathInRoot(entry.pathLower || '', rootLower)) continue;
      const rel = _stripRootPrefix(entry.path || entry.name || '', root);
      if (!rel) continue;
      const name = String(entry.name || rel.split('/').pop() || '');
      const relLower = rel.toLowerCase();

      if (!rel.includes('/')) {
        if (entry.type === 'directory') {
          if (topLevelDirs.length < MAX_CONTEXT_ITEMS) topLevelDirs.push(rel);
        } else if (topLevelFiles.length < MAX_CONTEXT_ITEMS) {
          topLevelFiles.push(rel);
        }
      }

      if (entry.type !== 'directory') {
        const dotIdx = name.lastIndexOf('.');
        const ext = dotIdx > 0 ? name.slice(dotIdx).toLowerCase() : '';
        if (ext && imageExts.has(ext) && imageFiles.length < MAX_CONTEXT_ITEMS) {
          imageFiles.push(rel);
        }
        const isTest = testHints.some(h => relLower.includes(`/${h}/`) || relLower.endsWith(`.${h}.js`) || relLower.endsWith(`.${h}.ts`) || relLower.endsWith(`.${h}.jsx`) || relLower.endsWith(`.${h}.tsx`));
        if (isTest && testFiles.length < MAX_CONTEXT_ITEMS) {
          testFiles.push(rel);
        }
      }
    }

    return { topLevelDirs, topLevelFiles, imageFiles, testFiles };
  }

  function _summarizePackageJson(pkg) {
    if (!pkg || typeof pkg !== 'object') return null;
    const scripts = pkg.scripts && typeof pkg.scripts === 'object'
      ? Object.entries(pkg.scripts).slice(0, MAX_CONTEXT_ITEMS).map(([name, command]) => ({ name, command }))
      : [];
    const bin = pkg.bin
      ? (typeof pkg.bin === 'string' ? [pkg.bin] : Object.keys(pkg.bin))
      : [];
    return {
      name: _trim(pkg.name || ''),
      type: _trim(pkg.type || ''),
      scripts,
      bin
    };
  }

  function _toolingSignals(sig) {
    if (!sig) return {};
    return {
      js: !!sig.hasPackageJson,
      tsconfig: !!sig.hasTsconfig,
      eslint: !!sig.hasEslintConfig,
      vitest: !!sig.hasVitestConfig,
      jest: !!sig.hasJestConfig,
      playwright: !!sig.hasPlaywrightConfig,
      python: !!(sig.hasPyproject || sig.hasRequirements || sig.hasSetupPy || sig.hasPipfile || sig.hasUvLock || sig.hasPdmLock),
      pytest: !!sig.hasPytestConfig,
      go: !!sig.hasGoMod,
      rust: !!sig.hasCargoToml,
      dotnet: !!sig.hasDotnet,
      java: !!(sig.hasPomXml || sig.hasGradle),
      ruby: !!sig.hasGemfile,
      php: !!sig.hasComposerJson,
      swift: !!(sig.hasSwiftPackage || sig.hasXcodeProject || sig.hasXcodeWorkspace),
      elixir: !!sig.hasMixExs,
      scala: !!sig.hasSbt,
      clojure: !!(sig.hasLein || sig.hasDepsEdn),
      haskell: !!(sig.hasStackYaml || sig.hasCabalProject || sig.hasCabalFile),
      cpp: !!(sig.hasCmakeLists || sig.hasMesonBuild || sig.hasMakefile)
    };
  }

  function _buildVerificationPrompt(context) {
    const payload = {
      originalPrompt: context.originalPrompt || '',
      changedFiles: context.changedFiles || [],
      rootCandidates: context.rootCandidates || [],
      primaryRoot: context.primaryRoot || '',
      tooling: context.tooling || {},
      runners: context.runners || {},
      packageJson: context.packageJson || null,
      topLevelDirs: context.topLevelDirs || [],
      topLevelFiles: context.topLevelFiles || [],
      imageFiles: context.imageFiles || [],
      testFiles: context.testFiles || []
    };

    return [
      'You are the Verification Planner for local code changes.',
      'Decide which terminal commands to run to verify the recent AI change.',
      'Return ONLY JSON with this schema:',
      '{"root":"","commands":[{"id":"","label":"","command":"","timeoutMs":60000}],"notes":""}',
      'Rules:',
      '- Commands must be safe and read-only. No installs, no file writes inside the repo, no git, no network.',
      '- If an output file is required, write it to /tmp (do not clean up).',
      '- Prefer commands that directly validate the original request.',
      '- Use at most 3 commands. If no safe verification is possible, return empty commands.',
      '- root must be one of rootCandidates (or empty).',
      'Context:',
      JSON.stringify(payload, null, 2)
    ].join('\n\n');
  }

  function _withTimeout(promise, timeoutMs, message = 'Timed out', onTimeout = null) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { if (typeof onTimeout === 'function') onTimeout(); } catch { /* ignore */ }
        reject(new Error(message));
      }, timeoutMs);
      Promise.resolve(promise)
        .then((value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function _isSafeVerificationCommand(command) {
    const cmd = _trim(command);
    if (!cmd) return false;
    if (cmd.length > MAX_AI_COMMAND_CHARS) return false;
    if (/[;&|]/.test(cmd)) return false;
    if (/[<>]/.test(cmd)) return false;
    if (/`|\$\(/.test(cmd)) return false;
    const lower = cmd.toLowerCase();
    const forbidden = [
      ' rm ',
      ' rm-',
      ' mv ',
      ' cp ',
      ' chmod ',
      ' chown ',
      ' sudo ',
      ' shutdown',
      ' reboot',
      ' kill ',
      ' killall',
      ' pkill',
      ' git ',
      ' hg ',
      ' svn ',
      ' curl ',
      ' wget ',
      ' scp ',
      ' ssh '
    ];
    return !forbidden.some(token => lower.includes(token));
  }

  function _sanitizeVerificationPlan(plan, context) {
    const warnings = [];
    const roots = Array.isArray(context.rootCandidates) && context.rootCandidates.length
      ? context.rootCandidates
      : [''];
    let root = _normalizePath(plan?.root || '');
    if (root && !roots.includes(root)) {
      warnings.push(`AI suggested unknown root "${root}". Using "${context.primaryRoot || ''}".`);
      root = context.primaryRoot || '';
    }
    if (!root && context.primaryRoot) root = context.primaryRoot;

    const rawCommands = Array.isArray(plan?.commands) ? plan.commands : [];
    const commands = [];
    for (const item of rawCommands) {
      const cmd = _trim(typeof item === 'string' ? item : item?.command);
      if (!cmd) continue;
      if (!_isSafeVerificationCommand(cmd)) {
        warnings.push(`Skipped unsafe command: ${cmd.slice(0, 80)}`);
        continue;
      }
      const label = _trim(item?.label) || 'Verification';
      const id = _trim(item?.id) || `check-${commands.length + 1}`;
      let timeoutMs = Number(item?.timeoutMs);
      if (!Number.isFinite(timeoutMs)) timeoutMs = COMMAND_TIMEOUTS_MS.tests;
      timeoutMs = Math.max(5000, Math.min(timeoutMs, COMMAND_TIMEOUTS_MS.tests * 2));
      commands.push({ id, label, command: cmd, timeoutMs });
      if (commands.length >= MAX_AI_COMMANDS) break;
    }

    const notes = _trim(plan?.notes || plan?.note || '');
    if (notes) warnings.push(notes);
    if (!commands.length && rawCommands.length) warnings.push('AI plan did not contain usable commands.');

    return { root, commands: _dedupeCommands(commands), warnings };
  }

  async function _requestAiVerificationPlan(context, sessionId) {
    if (typeof window.getAIResponse !== 'function') {
      return { root: context.primaryRoot || '', commands: [], warnings: ['AI planner not available.'] };
    }
    const sid = _trim(sessionId || window.currentSessionId || '');
    if (!sid) {
      return { root: context.primaryRoot || '', commands: [], warnings: ['Missing session for AI planner.'] };
    }
    const prompt = _buildVerificationPrompt(context);
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    try {
      const response = await _withTimeout(
        window.getAIResponse(prompt, [], controller ? controller.signal : null, sid, {
          isVerificationRequest: true,
          skipCheckpoint: true,
          forceNewClaudeSession: true
        }),
        AI_PLAN_TIMEOUT_MS,
        'AI verification plan timed out',
        () => {
          try { controller?.abort?.(); } catch { /* ignore */ }
        }
      );
      const parsed = _extractJsonFromOutput(response || '');
      if (!parsed) {
        return { root: context.primaryRoot || '', commands: [], warnings: ['AI response was not valid JSON.'] };
      }
      return _sanitizeVerificationPlan(parsed, context);
    } catch (err) {
      return { root: context.primaryRoot || '', commands: [], warnings: [String(err?.message || err || 'AI planning failed')] };
    }
  }

  async function _buildVerificationContext(changedFiles = [], entry = null) {
    _existsCache.clear();
    const entries = await _listProjectEntries(4);
    const roots = _rankRoots(_detectProjectRoots(entries), changedFiles);
    const primaryRoot = roots[0] || '';
    const sig = await _inspectProjectRoot(primaryRoot, entries);
    const summary = _summarizeEntries(entries, primaryRoot);
    const jsRunner = sig ? _jsRunner(sig) : null;
    const pyRunner = sig ? _pythonRunner(sig) : null;
    return {
      context: {
        originalPrompt: _trim(entry?.originalPrompt || ''),
        changedFiles: _limitList(changedFiles, MAX_CONTEXT_ITEMS * 2),
        rootCandidates: roots,
        primaryRoot,
        tooling: _toolingSignals(sig),
        runners: {
          js: jsRunner ? jsRunner.name : '',
          python: pyRunner ? pyRunner.name : ''
        },
        packageJson: _summarizePackageJson(sig?.packageJson),
        topLevelDirs: summary.topLevelDirs,
        topLevelFiles: summary.topLevelFiles,
        imageFiles: summary.imageFiles,
        testFiles: summary.testFiles
      },
      roots,
      primaryRoot
    };
  }

  async function _getVerificationCommands(changedFiles = [], entry = null, sessionId = '') {
    const projectPath = _trim(window.currentFolder || '');
    if (!projectPath) {
      return { root: '', commands: [], warnings: ['No project folder open.'] };
        }
    const { context, primaryRoot } = await _buildVerificationContext(changedFiles, entry);
    const plan = await _requestAiVerificationPlan(context, sessionId);
    return {
      root: plan.root || primaryRoot || '',
      commands: plan.commands || [],
      warnings: plan.warnings || []
    };
  }

  async function _getGitChanges() {
    try {
      if (!window.electronAPI || typeof window.electronAPI.runTerminalCommand !== 'function') {
        return { hasChanges: false, files: [], error: 'Terminal IPC not available' };
      }
      const res = await window.electronAPI.runTerminalCommand('git status --porcelain', true, 30000);
      const output = res && typeof res.output === 'string' ? res.output : '';
      const files = _parseGitStatus(output)
        .filter(p => p && !p.startsWith('.ai-agent/') && p !== '.ai-agent');
      return { hasChanges: files.length > 0, files, error: res && res.success !== true ? (res.error || 'git status failed') : '' };
    } catch (e) {
      return { hasChanges: false, files: [], error: e?.message || String(e) };
    }
  }

  async function _runCommand(command, timeoutMs, workingDir = '') {
    try {
      if (!window.electronAPI) return { success: false, output: 'Terminal IPC not available', exitCode: 1 };
      const dir = _trim(workingDir);
      if (dir && typeof window.electronAPI.runTerminalCommandInDir === 'function') {
        return await window.electronAPI.runTerminalCommandInDir({
          command,
          workingDir: dir,
          waitForCompletion: true,
          timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS
        });
      }
      return await window.electronAPI.runTerminalCommand(command, true, timeoutMs || DEFAULT_TIMEOUT_MS);
    } catch (e) {
      return { success: false, output: String(e?.message || e), exitCode: 1 };
    }
  }

  function _formatConfidence(entry) {
    const pct = Number(entry?.confidencePct);
    if (!Number.isFinite(pct)) return 'Confidence: —';
    return `Confidence: ${pct}%`;
  }

  function _statusLabel(status) {
    const s = String(status || '').trim();
    if (s === 'passed') return 'Verified';
    if (s === 'failed') return 'Verification Failed';
    if (s === 'skipped') return 'Verification Skipped';
    if (s === 'running') return 'Verifying';
    return 'Verification Pending';
  }

  function _statusBadgeClass(status) {
    const s = String(status || '').trim();
    if (s === 'passed') return 'proofed-cert-badge--passed';
    if (s === 'failed') return 'proofed-cert-badge--failed';
    return 'proofed-cert-badge--skipped';
  }

  function _extractRerunWorkDir(entry) {
    try {
      const checks = Array.isArray(entry?.checks) ? entry.checks : [];
      for (const c of checks) {
        const dir = _trim(c?.workDir || '');
        if (dir) return dir;
      }
      return '';
    } catch {
      return '';
    }
  }

  function _extractRerunCommands(entry) {
    const checks = Array.isArray(entry?.checks) ? entry.checks : [];
    const cmds = [];
    for (const c of checks) {
      const command = _trim(c?.command || '');
      if (!command) continue;
      const id = _trim(c?.id) || `check-${cmds.length + 1}`;
      const label = _trim(c?.label) || 'Verification';
      const idLower = id.toLowerCase();
      let timeoutMs = DEFAULT_TIMEOUT_MS;
      if (idLower.includes('lint')) timeoutMs = COMMAND_TIMEOUTS_MS.lint;
      else if (idLower.includes('type')) timeoutMs = COMMAND_TIMEOUTS_MS.typecheck;
      else if (idLower.includes('build')) timeoutMs = COMMAND_TIMEOUTS_MS.tests;
      else if (idLower.includes('test')) timeoutMs = COMMAND_TIMEOUTS_MS.tests;
      cmds.push({ id, label, command, timeoutMs });
    }
    return cmds;
  }

  function _truncateForFixMessage(text, maxChars = 1800) {
    const s = String(text || '');
    if (s.length <= maxChars) return s;
    const over = s.length - maxChars;
    return `${s.slice(0, maxChars)}\n\n...(truncated ${over} chars)`;
  }

  function _buildFixMessage(entry) {
    const summary = _trim(entry?.summary || 'Verification failed.');
    const files = Array.isArray(entry?.filesModified) ? entry.filesModified : [];
    const checks = Array.isArray(entry?.checks) ? entry.checks : [];
    const failedChecks = checks.filter(c => c && c.status === 'failed');
    const relevantChecks = failedChecks.length ? failedChecks : checks;
    const lines = [];
    lines.push('Please fix the verification failure.');
    lines.push('');
    lines.push(`Summary: ${summary}`);
    if (files.length) {
      lines.push('');
      lines.push('Files touched:');
      for (const f of files.slice(0, 20)) {
        lines.push(`- ${f}`);
      }
    }
    if (relevantChecks.length) {
      lines.push('');
      lines.push('Verification checks:');
      for (const c of relevantChecks.slice(0, 3)) {
        const label = _trim(c?.label || 'Check');
        const cmd = _trim(c?.command || '');
        const output = _truncateForFixMessage(c?.output || '');
        lines.push(`- ${label}`);
        if (cmd) lines.push(`  Command: ${cmd}`);
        if (output) {
          lines.push('  Output:');
          lines.push('  ---');
          lines.push(output.split('\n').map(l => `  ${l}`).join('\n'));
          lines.push('  ---');
        }
      }
    }
    lines.push('');
    lines.push('Only change what is needed to make the checks pass.');
    return lines.join('\n');
  }

  function _sendFixRequest(entry) {
    try {
      const input = document.getElementById('chatInput');
      const msg = _buildFixMessage(entry);
      const sid = _trim(entry?.sessionId || '');
      if (sid) {
        const st = _getSettings();
        const allowDocsLearning = !!(st && st.enableDocsLearningOnFix === true);
        if (!window._nextRunOptionsBySession || typeof window._nextRunOptionsBySession !== 'object') {
          window._nextRunOptionsBySession = Object.create(null);
        }
        window._nextRunOptionsBySession[sid] = {
          skipLearning: !allowDocsLearning,
          skipDocs: !allowDocsLearning,
          fixRun: true
        };
      }
      if (input) {
        input.value = msg;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof window.triggerSendMessage === 'function') {
        window.triggerSendMessage();
      } else if (typeof window.sendMessage === 'function') {
        window.sendMessage();
      } else {
        window.addConsoleMessage?.('Unable to trigger send (missing send handler).', 'error', entry?.sessionId || '');
      }
    } catch (err) {
      window.addConsoleMessage?.(`Fix request failed: ${err?.message || String(err)}`, 'error', entry?.sessionId || '');
    }
  }

  function _cleanupVerificationUi(sessionId) {
    const sid = _trim(sessionId || window.currentSessionId || '');
    if (!sid) return;
    try {
      const st = (typeof window.getRunState === 'function') ? window.getRunState(sid) : null;
      const isVerificationRun = !!(st && st.isVerificationRun === true);
      const hasRequestId = !!(st && st.requestId);
      const isProcessing = (typeof window.isSessionProcessing === 'function')
        ? window.isSessionProcessing(sid)
        : !!(st && st.isProcessing === true);
      if (typeof window.setProcessingState === 'function') {
        if (isVerificationRun || (isProcessing && !hasRequestId)) {
          window.setProcessingState(false, sid);
        }
      } else if (!isProcessing) {
        const banner = document.getElementById('chatStatusBanner');
        if (banner) banner.style.display = 'none';
      }
    } catch { /* ignore */ }

    try {
      if (typeof window.updateSendButtonForCurrentSession === 'function') {
        window.updateSendButtonForCurrentSession();
      }
    } catch { /* ignore */ }

    try {
      if (typeof window.renderChatTabs === 'function') {
        window.renderChatTabs();
      }
    } catch { /* ignore */ }
  }

  function _renderProofedEditsCard(entry, { force = false } = {}) {
    if (!entry || !entry.sessionId || !entry.runRequestId) return;
    if (!force && String(entry.sessionId) !== String(window.currentSessionId || '')) return;

    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;

    const cardId = `proofed-edits-card-${entry.sessionId}-${entry.runRequestId}`;
    let card = messagesContainer.querySelector(`#${CSS.escape(cardId)}`);
    const isNew = !card;
    if (!card) {
      card = document.createElement('div');
      card.id = cardId;
      card.className = 'message assistant proofed-edits-card';
    }

    const status = String(entry.status || 'pending').trim();
    const checks = Array.isArray(entry.checks) ? entry.checks : [];
    const executed = checks.filter(c => c && c.status && c.status !== 'skipped');
    const passedCount = executed.filter(c => c.status === 'passed').length;
    const summaryBase = entry.summary || (executed.length ? `Passed ${passedCount}/${executed.length} checks` : 'Awaiting verification');

    const title = `Proofed Edits: ${_statusLabel(status)}`;
    const summary = `${summaryBase} • ${_formatConfidence(entry)}`;

    const icon = status === 'passed'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6 9 17l-5-5"/></svg>`
      : status === 'failed'
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/></svg>`;

    const iconClass = status === 'passed'
      ? 'proofed-edits-card-icon--success'
      : (status === 'failed' ? 'proofed-edits-card-icon--error' : 'proofed-edits-card-icon--neutral');

    const showFix = status === 'failed';
    const showRerun = status === 'failed' || status === 'skipped' || status === 'passed';

    card.className = `message assistant proofed-edits-card proofed-edits-card--${status}`;
    const viewDisabled = status === 'running';
    card.innerHTML = `
      <div class="proofed-edits-card-content">
        <div class="proofed-edits-card-icon ${iconClass}">${icon}</div>
        <div class="proofed-edits-card-body">
          <div class="proofed-edits-card-title">${_escapeHtml(title)}</div>
          <div class="proofed-edits-card-summary">${_escapeHtml(summary)}</div>
        </div>
        <div class="proofed-edits-card-actions">
          <button class="btn-secondary proofed-edits-view-btn" type="button" ${viewDisabled ? 'disabled' : ''}>View</button>
          ${showRerun ? '<button class="btn-secondary proofed-edits-rerun-btn" type="button">Rerun</button>' : ''}
          ${showFix ? '<button class="btn-primary proofed-edits-fix-btn" type="button">Fix</button>' : ''}
        </div>
      </div>
    `;

    const viewBtn = card.querySelector('.proofed-edits-view-btn');
    if (viewBtn) {
      viewBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        _openCertificateModal(entry);
      };
    }
    const rerunBtn = card.querySelector('.proofed-edits-rerun-btn');
    if (rerunBtn) {
      rerunBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        _queueVerification(entry, { rerun: true });
      };
    }
    const fixBtn = card.querySelector('.proofed-edits-fix-btn');
    if (fixBtn) {
      fixBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        _sendFixRequest(entry);
      };
    }

    if (isNew) {
      if (typeof window.appendChatNode === 'function') {
        window.appendChatNode(messagesContainer, card, { roleHint: 'assistant' });
      } else {
        messagesContainer.appendChild(card);
      }
      try { card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* ignore */ }
    }
  }

  function _openCertificateModal(entry) {
    const modal = document.getElementById('proofedEditsModal');
    const body = document.getElementById('proofedEditsModalBody');
    if (!modal || !body || !entry) return;

    const status = String(entry.status || 'pending').trim();
    const badgeClass = _statusBadgeClass(status);
    const checks = Array.isArray(entry.checks) ? entry.checks : [];
    const files = Array.isArray(entry.filesModified) ? entry.filesModified : [];
    const updatedAt = entry.updatedAt || entry.timestamp || Date.now();
    const timestamp = new Date(updatedAt).toLocaleString();

    const checkRows = checks.map((c) => {
      const st = String(c?.status || 'skipped');
      const rowClass = st === 'passed' ? 'proofed-cert-check--passed' : (st === 'failed' ? 'proofed-cert-check--failed' : '');
      const duration = Number.isFinite(Number(c?.durationMs)) ? `${Math.round(Number(c.durationMs) / 1000)}s` : '—';
      const workDir = _trim(c?.workDir || '');
      const metaParts = [st, duration];
      if (workDir) metaParts.push(`dir: ${workDir}`);
      const metaText = metaParts.join(' • ');
      const command = _trim(c?.command || '');
      const commandBlock = command
        ? `<div class="proofed-cert-check-command"><span>Command:</span> <code>${_escapeHtml(command)}</code></div>`
        : '';
      const output = _trim(c?.output || '');
      const logBlock = output
        ? `<details class="proofed-cert-log"><summary>${_escapeHtml(c.label || 'Output')}</summary><pre>${_escapeHtml(output)}</pre></details>`
        : '';
      return `
        <div class="proofed-cert-check ${rowClass}">
          <div>${_escapeHtml(c?.label || 'Check')}</div>
          <div class="proofed-cert-check-meta">${_escapeHtml(metaText)}</div>
        </div>
        ${commandBlock}
        ${logBlock}
      `;
    }).join('');

    body.innerHTML = `
      <div class="proofed-cert">
        <div class="proofed-cert-hero">
          <span class="proofed-cert-badge ${badgeClass}">${_escapeHtml(_statusLabel(status))}</span>
          <div>
            <div class="proofed-cert-status">${_escapeHtml(_formatConfidence(entry))}</div>
            <div class="proofed-cert-meta">Verified at ${_escapeHtml(timestamp)}</div>
          </div>
        </div>
        <div>
          <div class="proofed-cert-section-title">Checks</div>
          ${checkRows || '<div class="proofed-cert-files">No checks were executed for this run.</div>'}
        </div>
        <div>
          <div class="proofed-cert-section-title">Files touched</div>
          <div class="proofed-cert-files">${_escapeHtml(files.length ? files.join('\n') : 'No files recorded.')}</div>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
  }

  function _closeCertificateModal() {
    const modal = document.getElementById('proofedEditsModal');
    const body = document.getElementById('proofedEditsModalBody');
    if (!modal || !body) return;
    modal.style.display = 'none';
    body.innerHTML = '';
  }

  function _wireModal() {
    const closeBtn = document.getElementById('closeProofedEditsModal');
    const footerClose = document.getElementById('proofedEditsModalCloseBtn');
    if (closeBtn) closeBtn.onclick = _closeCertificateModal;
    if (footerClose) footerClose.onclick = _closeCertificateModal;
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') _closeCertificateModal();
    });
  }

  async function _runVerification(entry, { rerun = false } = {}) {
    if (!entry || !entry.sessionId || !entry.runRequestId) return;
    const sid = entry.sessionId;
    const rid = entry.runRequestId;

    const state = window._proofedEditsState;
    if (!state) return;

    const rerunCommands = rerun ? _extractRerunCommands(entry) : [];
    const rerunWorkDir = rerun ? _extractRerunWorkDir(entry) : '';

    const updated = state.updateEntry(sid, rid, {
      status: 'running',
      summary: rerun ? 'Re-running verification checks' : 'Running verification checks',
      checks: [],
      warnings: []
    });
    if (updated) _renderProofedEditsCard(updated, { force: true });

    const projectPath = _trim(window.currentFolder || '');
    if (!projectPath) {
      const fail = state.updateEntry(sid, rid, { status: 'failed', summary: 'No project folder open.' });
      if (fail) _renderProofedEditsCard(fail, { force: true });
      _cleanupVerificationUi(sid);
      return;
    }

    const changes = await _getGitChanges();
    if (changes.error) {
      state.updateEntry(sid, rid, { warnings: [`git status: ${changes.error}`] });
    }
    if (changes.files && changes.files.length > 0) {
      state.updateEntry(sid, rid, { filesModified: changes.files });
    }
    if (!changes.hasChanges) {
      const skipped = state.updateEntry(sid, rid, {
        status: 'skipped',
        summary: 'No file changes detected. Verification skipped.',
        checks: []
      });
      if (skipped) _renderProofedEditsCard(skipped, { force: true });
      _cleanupVerificationUi(sid);
      return;
    }

    let commands = [];
    let workingDir = '';
    if (rerun && rerunCommands.length > 0) {
      commands = rerunCommands;
      workingDir = rerunWorkDir;
    } else if (rerun && rerunCommands.length === 0) {
      const skipped = state.updateEntry(sid, rid, {
        status: 'skipped',
        summary: 'No previous verification commands to rerun.',
        checks: []
      });
      if (skipped) _renderProofedEditsCard(skipped, { force: true });
      _cleanupVerificationUi(sid);
      return;
    } else {
      const commandResult = await _getVerificationCommands(changes.files || [], entry, sid);
      commands = commandResult && Array.isArray(commandResult.commands) ? commandResult.commands : [];
      workingDir = commandResult && typeof commandResult.root === 'string' ? commandResult.root : '';
      if (commandResult && Array.isArray(commandResult.warnings) && commandResult.warnings.length) {
        state.updateEntry(sid, rid, { warnings: commandResult.warnings });
      }
    }
    if (!commands.length) {
      const skipped = state.updateEntry(sid, rid, {
        status: 'skipped',
        summary: 'No AI verification commands proposed for this change.',
        checks: []
      });
      if (skipped) _renderProofedEditsCard(skipped, { force: true });
      _cleanupVerificationUi(sid);
      return;
    }

    const checks = [];
    let failed = false;

    for (const cmd of commands) {
      if (failed) {
        checks.push({
          id: cmd.id,
          label: cmd.label,
          command: cmd.command,
          workDir: workingDir,
          status: 'skipped',
          output: '',
          durationMs: 0
        });
        continue;
      }
      const start = Date.now();
      const dirSuffix = workingDir ? ` (${workingDir})` : '';
      window.addConsoleMessage?.(`Proofed Edits: ${cmd.label}${dirSuffix}`, 'processing', sid);
      const res = await _runCommand(cmd.command, cmd.timeoutMs || DEFAULT_TIMEOUT_MS, workingDir);
      const durationMs = Date.now() - start;
      const output = _truncateOutput((res?.output || '') + (res?.error || ''));
      const status = res && res.success === true && Number(res.exitCode || 0) === 0 ? 'passed' : 'failed';
      checks.push({
        id: cmd.id,
        label: cmd.label,
        command: cmd.command,
        workDir: workingDir,
        status,
        output,
        durationMs
      });
      if (status === 'failed') {
        failed = true;
      }
    }

    const executed = checks.filter(c => c && c.status !== 'skipped');
    const passedCount = executed.filter(c => c.status === 'passed').length;
    const confidencePct = executed.length ? Math.round((passedCount / executed.length) * 100) : null;
    const status = failed ? 'failed' : 'passed';
    const summary = failed
      ? `Failed: ${checks.find(c => c.status === 'failed')?.label || 'Check failed'}`
      : `Passed ${passedCount}/${executed.length} checks`;

    const finalEntry = state.updateEntry(sid, rid, {
      status,
      summary,
      confidencePct,
      checks
    });
    if (finalEntry) _renderProofedEditsCard(finalEntry, { force: true });

    const logMessage = status === 'passed'
      ? `Proofed Edits verified (${passedCount}/${executed.length} checks passed)`
      : `Proofed Edits failed (${checks.find(c => c.status === 'failed')?.label || 'check'})`;
    window.addConsoleMessage?.(logMessage, status === 'passed' ? 'success' : 'error', sid);

    // If docs were pending and waiting on verification, trigger a retry.
    try { window.generatePendingDocs?.(); } catch { /* ignore */ }

    _cleanupVerificationUi(sid);
  }

  function _queueVerification(entry, { rerun = false } = {}) {
    verificationChain = verificationChain
      .then(() => _runVerification(entry, { rerun }))
      .catch((err) => {
        const sid = entry?.sessionId || '';
        window.addConsoleMessage?.(`Proofed Edits error: ${err?.message || String(err)}`, 'error', sid);
      });
    return verificationChain;
  }

  function _onRunCompleted(payload = {}) {
    if (_isPlanMode()) return;
    if (!payload || payload.isInternalFollowup === true) return;
    const sid = _trim(payload.sessionId);
    const rid = _trim(payload.runRequestId);
    if (!sid || !rid) return;

    const state = window._proofedEditsState;
    if (!state) return;
    try {
      if (typeof state.isVerificationEnabled === 'function' && state.isVerificationEnabled(sid) !== true) return;
    } catch { /* ignore */ }

    // === SMART ANALYSIS: Only verify runs that actually modified code ===
    // Verification is only meaningful when files were changed or code tools were used
    if (window._runNeedsAnalysis && typeof window._runNeedsAnalysis.analyzeRun === 'function') {
      const analysis = window._runNeedsAnalysis.analyzeRun({
        originalPrompt: payload.originalPrompt || '',
        toolsUsed: Array.isArray(payload.toolsUsed) ? payload.toolsUsed : [],
        filesModified: Array.isArray(payload.filesModified) ? payload.filesModified : []
      });
      
      if (!analysis.needsVerification) {
        // Log skip reason for debugging (can be removed in production)
        console.debug('[Verification] Skipped:', analysis.reason, analysis.details);
        return;
      }
      console.debug('[Verification] Triggered:', analysis.reason, analysis.confidence);
    }

    const restoreCheckpointHash = _trim(payload.restoreCheckpointHash);
    const entry = state.createEntry({
      sessionId: sid,
      runRequestId: rid,
      status: 'running',
      summary: 'Running verification checks',
      originalPrompt: payload.originalPrompt || '',
      metadata: {
        filesModified: Array.isArray(payload.filesModified) ? payload.filesModified : [],
        toolsUsed: Array.isArray(payload.toolsUsed) ? payload.toolsUsed : []
      },
      restoreCheckpointHash
    });

    if (entry) {
      _renderProofedEditsCard(entry, { force: true });
      _queueVerification(entry);
    }
  }

  window._proofedEdits = {
    runVerification: _queueVerification,
    openCertificate: _openCertificateModal
  };

  window._onProofedEditsRunCompleted = _onRunCompleted;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wireModal);
  } else {
    _wireModal();
  }
})();
