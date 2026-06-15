# Codeon — AI Code Agent Editor (Electron)

Codeon is a **desktop code editor** built with **Electron** and **Monaco Editor**, paired with an **AI assistant** powered by **Claude Code’s Agent SDK**. You open a folder as a “project,” edit files in Monaco, and collaborate with the AI through a chat panel that can read/modify your project (with permission controls) and provides **auditable execution receipts**.

> Product name: **Codeon**  
> Package name: `ai-code-agent-editor`  
> Runtime entry: `main.js` (Electron main process)

---

## What the app does (user workflow)

1) **Open a project folder**  
   - From the welcome screen (“Open Project”) or **Recent Projects**.
   - The app sets this as the active workspace (`currentProject`) and starts a file watcher.

2) **Browse + edit files**  
   - VS Code–style **Explorer** (tree view) to open files.
   - Monaco editor supports regular editing and a **diff view**.

3) **Chat with the AI assistant**  
   - A dedicated **AI Assistant** panel supports multi-session chat tabs (“New Chat”).
   - The assistant can stream responses and use tools (file operations, git/diffs, limited terminal, web tools depending on policy).

4) **Restore safely using Git checkpoints**  
   - The app maintains **Git-based “Restore checkpoints”** so each user turn can be rolled back.
   - This enables “undo to a prior state + re-run your next action” behavior across the whole workspace.

5) **Audit tool usage with Receipts**  
   - Every tool execution can emit a structured **receipt** (cwd, network policy, exit code, etc.) that is persisted into the chat timeline and shown in the **Receipts** tab.

---

## Core features implemented so far

### Editor + workspace

- **Open folder / project**
  - Open from dialog or by path (used by Recent Projects).
  - Auto-starts a workspace watcher and refresh notifications.

- **File Explorer (tree)**
  - Browse folders/files.
  - VS Code-like selection state is tracked in the renderer (multi-select, focus, expand/collapse).
  - File operations are supported via IPC:
    - read, write, edit
    - create directory
    - rename
    - delete
    - copy / move
    - duplicate
    - reveal in Finder

- **Monaco editor + diff**
  - Regular editor for file editing
  - A dedicated **diff editor** view (used for comparing changes)

- **Efficient file reads**
  - `read-file-lines` supports reading line ranges with hard caps to avoid loading huge files.
  - Binary images can be read as base64 for preview.

---

### AI assistant (Claude Agent SDK integration)

- **Claude Code (Agent SDK) runtime**
  - The main process exposes `claude-sdk-start` / `claude-sdk-cancel` IPC.
  - The renderer handles **streaming events** and keeps an “assistant message placeholder” persisted so partial output survives app restarts.

- **Multi-chat sessions**
  - Chat history is stored per session/tab.
  - Sessions can hold Claude session metadata (resume/fork across turns).

- **Attachments**
  - Attachments are materialized into the project and referenced by **project-relative paths**.
  - Attachments are isolated per chat session.

---

### Agents + Skills (Claude Code–style)

Codeon supports Claude Code–style “sub-agents” and “skills” with both **project-scoped** and **user-scoped** libraries:

- **Project-scoped**
  - Agents: `.claude/agents/*.md`
  - Skills: `.claude/skills/**/Skill.md`

- **User-scoped**
  - Agents: `~/.claude/agents/**`
  - Skills: `~/.claude/skills/**`

In the UI:

- **Agent dropdown** (per chat session)
  - Lets you pick a specialized agent whose instructions are applied to that session.

- **Skill dropdown** (“next message only”)
  - Lets you attach a skill to the next request (one-shot attach model).

- **Skill scripts runner**
  - If a project skill has `.claude/skills/<skill>/scripts/*`, scripts can be selected and run (with gating/permissions).

---

### Checkpoints + restore (Git-backed)

The app relies on Git for:

- **Workspace-level restore checkpoints**
  - Before a user message is sent, the renderer can create a Git checkpoint commit with a subject like:
    - `[AI-Agent-Checkpoint] <reason>`
  - Each user message can show a **Restore** button tied to the checkpoint hash.

- **Restore behavior**
  - Restoring performs a forced checkout to the checkpoint and then normalizes branch state (avoids leaving the repo in detached HEAD).
  - If another chat is currently running, the UI warns that restoring invalidates those runs and can stop them.

- **Git recovery UI**
  - If a git operation like merge/rebase/cherry-pick needs resolution, the chat can surface a recovery card to help the user continue/abort.

Also:

- **Auto-init git** for opened folders
  - If the user opens a folder without Git, the app silently initializes it.
  - It ensures at least one commit exists using an **empty initial commit** to avoid auto-committing user files.

---

### Permissions, safety, and sandboxing (current behavior)

Codeon implements **workspace isolation** and **permission gating** designed to prevent accidental modification of the Electron app itself and to keep AI actions scoped to the opened project.

#### Permission modes (Claude Code-style)

Selectable “Agent mode” values:

- `plan` — read-only intent (no edits, no commands, no network)
- `default` — ask before edits, commands, and network
- `acceptEdits` — no prompts for edits (still enforces isolation + policy)
- `bypassPermissions` — minimal prompting (still enforces isolation + policy)

#### Network policy (WebFetch + Bash heuristics)

Selectable network policy values:

- `allow_all`
- `deny_all`
- `allowlist` + an allowlist of domains

#### Workspace isolation (enforced in main + Claude tool gate)

- File operations are resolved via “inside project only” path resolvers.
- Terminal execution is blocked if no project is open and explicitly prevents running in the Electron app directory.
- Claude tool usage is gated in `claude-sdk-service.js`:
  - Forces `Bash` tool cwd to the opened workspace root
  - Blocks access to internal `.ai-agent` state except an attachments subfolder
  - Blocks obvious references to `~/.claude` in Bash commands
  - Applies network policy to WebFetch/WebSearch (and best-effort heuristics for Bash)

#### Important: shadow worktrees are currently removed

Older plans/docs mention a “shadow worktree” execution model. The current renderer code explicitly states:

- **Claude runs directly in the real workspace** (no shadow worktrees)
- Legacy “apply review” cards are ignored because shadow worktrees were removed

This means safety relies on:

- strict path allowlists
- permission prompts (depending on mode)
- network policy gating
- tool-level restrictions inside the Claude SDK wrapper

---

### Receipts, console, and observability

- **Bottom console tabs**
  - Console
  - Tasks
  - Receipts

- **Execution receipts**
  - Tool runs can emit a structured receipt including:
    - tool name
    - timestamp
    - cwd (when applicable)
    - network policy (when applicable)
    - exit code / success markers (when available)
  - Receipts are:
    - persisted into the session timeline (`role: "tool_receipt"`)
    - searchable + filterable in the UI
    - clearable per session

---

## Data storage (where Codeon writes)

### Inside the opened project folder

- `.ai-agent/`
  - `chat-sessions.json` — persisted chat sessions
  - `ui-metadata.json` — UI metadata (diffs, tool receipts, previews, etc.)
  - `attachments/` — attachments saved into the project for AI runs

- `.codeon/cache/read_file_cache/<sessionId>.json`
  - A workspace-local cache for read-file excerpts (per session)

### User-global (outside the project)

- `~/.ai-agent/`
  - `settings.json` — global app settings
  - `recent-projects.json` — recent projects list

- `~/.claude/`
  - user-level agents + skills (read/write supported via IPC, and can be imported/exported with project equivalents)

### Electron userData

- `app.getPath('userData')/workspaces/<workspaceId>/state.vscdb`
  - workspace-scoped key/value storage implemented via `sql.js` (SQLite DB)

---

## Packaging and distribution

The project uses **electron-builder** with platform targets:

- **macOS**: DMG + ZIP (x64 + arm64), with dark mode support enabled
- **Windows**: NSIS + portable (x64)
- **Linux**: AppImage + deb + rpm

Build hooks:

- `scripts/afterPack.js`
  - Applies an ad-hoc macOS codesign in certain build flows to avoid Gatekeeper “damaged app” errors.

- `scripts/afterSignNotarize.js`
  - Optional notarization + stapling using `xcrun notarytool` when `NOTARIZE=1` is set.

---

## Notable “removed / legacy” items

These are present in the repo but not necessarily wired into the current runtime UI:

- **MCP UI**: explicitly noted as removed (migrated to the Claude SDK wrapper).
- **Local indexing / embeddings**: explicitly removed/disabled in the current renderer build (indexing overlays exist but are hidden).
- **Shadow worktrees**: explicitly removed; older UI artifacts (like apply review cards) are ignored.
- **Legacy checkpoints timeline modal**: the repo still contains `renderer/ui/checkpoint-timeline.js`, but the main UI notes the older timeline UI was removed.

---

## Repo map (high-level)

- `main.js` — Electron main process: IPC, filesystem ops, terminal exec, Git helpers, persistence, settings, recent projects, watcher
- `preload.js` — `contextBridge` API (`window.electronAPI.*`) exposing safe IPC calls to the renderer
- `renderer/`
  - `index.html` — UI layout (editor, explorer, chat, settings, console/tasks/receipts)
  - `app.js` — UI logic: Monaco, chat sessions, agents/skills, checkpoints/restore, receipts
  - `styles.css` / `custom-dropdown.css` — UI styling
- `claude-sdk-service.js` — Claude Agent SDK wrapper: tool gating, network policy, receipts, event normalization
- `scripts/` — electron-builder hooks for packaging/signing/notarization


