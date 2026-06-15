const js = require('@eslint/js');
const globals = require('globals');
const unusedImports = require('eslint-plugin-unused-imports');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  // Ignore large reference bundle + build artifacts + vendor libs.
  {
    ignores: [
      '**/node_modules/**',
      'Cursor Code For Reference/**',
      '**/anthropic.claude-code-*/**',  // Decompiled reference bundle (excluded from OSS repo)
      'sticky-prompts-demo/**',
      '**/dist/**',
      '**/build/**',
      '**/.cursor/**',
      '**/.ai-agent/**',
      'renderer/learning/marked.min.js'  // Vendor library
    ]
  },

  // Lint config files under Node/CommonJS so require/module are defined.
  {
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    }
  },

  // Baseline JS recommended.
  js.configs.recommended,

  // Common rules for all app JS.
  {
    files: ['**/*.js'],
    plugins: {
      'unused-imports': unusedImports
    },
    rules: {
      // Hard fail on unused code
      'no-unused-vars': ['error', {
        // You can intentionally mark unused with a leading underscore: _err, _event, _unused
        args: 'all',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: false
      }],
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', {
        args: 'all',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_'
      }],

      // Extra strictness that helps keep things clean (but not stylistic)
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unused-expressions': 'error'
    }
  },

  // Main/preload (Node/Electron, CommonJS)
  {
    files: ['main.js', 'main/**/*.js', 'preload.js', 'claude-sdk-service.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    }
  },

  // Renderer (browser-like + Monaco AMD loader globals)
  {
    files: ['renderer/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Monaco AMD loader provides these globals
        require: 'readonly',
        monaco: 'readonly'
      }
    }
  }
  ,

  // Renderer app modules are loaded as multiple <script> tags that share a single global scope.
  // ESLint analyzes files individually, so cross-file globals look like `no-undef` and
  // cross-file usages look like `no-unused-vars`. Relax these rules for the split modules
  // while keeping them strict for Node/everything else.
  {
    files: [
      'renderer/app/**/*.js',
      'renderer/state/**/*.js',
      'renderer/git/**/*.js',
      'renderer/aet/**/*.js',
      'renderer/ui/modals/**/*.js',
      'renderer/learning/**/*.js'
    ],
    languageOptions: {
      globals: {
        marked: 'readonly'  // Loaded via script tag
      }
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'unused-imports/no-unused-vars': 'off'
    }
  }
];


