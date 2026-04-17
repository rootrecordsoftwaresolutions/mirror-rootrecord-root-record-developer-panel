# Root Record Developer Panel - Full Technical Handoff (for Claude Code)

## 1) Project Identity

- **App name:** `root-record-developer-panel`
- **Current version:** `1.0.4`
- **Platform focus:** Windows desktop (Electron), with some cross-platform command branches
- **Purpose:** Single desktop "operations and build control plane" for the Root Record ecosystem (business, energy, homestead, weather, website, and local server operations).
- **Primary architecture style:** Electron main process + inline renderer HTML/JS (currently embedded as a `data:` URL in `src/main.js`)
- **Main risk area:** Inline renderer script complexity and fragility (event wiring + IPC bootstrap + embedded template string escaping)

## 2) Current High-Level Capabilities

The app currently combines these responsibilities:

1. **Developer orchestration**
   - Build and run multiple sibling projects.
   - Show global terminal output and run ad-hoc commands.
   - Aggregate git status across projects.

2. **MySQL local database management**
   - Connect using profile config.
   - Enumerate tables.
   - Read rows with limit.
   - Insert / update / delete rows.
   - Enforce SQL identifier safety for dynamic table/column names.

3. **Operations Hub (server-mode control plane)**
   - Store/manage server profile and credentials.
   - Dependency checks and install bootstrap (MySQL + cloudflared).
   - Cloudflare tunnel lifecycle controls.
   - Service management (install/check/start/stop).
   - Root folder and website folder preparation/deploy actions.
   - Basic health dashboard logic.
   - DB backup and restore actions via `mysqldump`/`mysql`.

4. **Release and packaging automation**
   - Build unpacked app.
   - Build installer (`electron-winstaller`).
   - One-click release pipeline script for bump/build/commit/push/release upload.

5. **App update integration**
   - Version compare.
   - GitHub release fetch and installer download/launch.
   - Supports private repo auth via token in profile.

## 3) Repository Surface (Important Files)

### Runtime / App Core

- `src/main.js`
  - **Single dominant source file.**
  - Holds:
    - Electron app bootstrapping
    - BrowserWindow creation
    - Entire inline HTML/CSS/JS UI (renderer)
    - All `ipcMain.handle(...)` logic
    - Utility functions (env parsing, profile normalize, command runners, GitHub release calls, MySQL helpers, etc.)

- `src/preload.js`
  - ContextBridge IPC bridge (`rrElectron.invoke`, `rrElectron.on`) exists.
  - Currently not the active path in the latest stability fallback setup.

### Build + Installer + Release

- `scripts/build-windows.cjs`
  - Packages Electron app via `electron-packager`.
  - Includes ignore rules to avoid recursive/temporary output packaging issues.

- `scripts/build-installer.cjs`
  - Builds installer via `electron-winstaller`.
  - Handles path-length issues using short staging path.
  - Handles output cleanup and locked-file fallback behavior.

- `scripts/release-oneclick.ps1`
  - Full automation:
    - bump patch version
    - update `package.json` and `package-lock.json`
    - build installer
    - `git add -A`, commit, push
    - `gh release create/edit/upload`
  - Prompts for release notes if not passed.

- `scripts/check-renderer-script.cjs`
  - Parse-check tool for renderer script extraction from `src/main.js`.
  - Used to catch syntax issues in large embedded `<script>`.

### Documentation / Reference

- `docs/offline-first-sync-guide.md`
  - Strategy document for client sync under intermittent server connectivity.

### Project metadata

- `package.json`
  - Start/dev/build scripts.
  - Dependencies include: `electron-store`, `mysql2`, `node-pty`, `simple-git`, `xterm`, `xterm-addon-fit`.
  - Dev dependencies include: `electron`, `electron-packager`, `electron-winstaller`.

## 4) Runtime Architecture and Data Flow

### Electron process model (current)

- **Main process** does almost everything:
  - OS/process command execution
  - file IO
  - network calls (GitHub API/download)
  - DB connection and SQL execution
  - stores state in `electron-store`
  - serves renderer as encoded inline HTML string

- **Renderer process** is inline script inside `loadURL('data:text/html...')`:
  - renders pages and tabs
  - binds click handlers
  - uses IPC to invoke backend actions
  - prints command output to terminal regions

### IPC pattern

- Renderer calls `ipcRenderer.invoke('channel', payload?)`.
- Main process handles with `ipcMain.handle('channel', async () => ...)`.
- Streaming output is emitted back using terminal chunk events.
- Terminal output is appended in renderer UI containers.

### Configuration persistence

- `electron-store` stores app preferences and build settings.
- Separate `.env` interoperability is included for server profile values.
- Important that some config exists in both UI state and `.env` representation.

## 5) UI Structure (Current)

The app has left sidebar navigation and page containers:

- Dashboard
  - Overview tab
  - Global terminal tab
  - Quick actions (build/run/git status)
  - Open-at-login toggle

- Project pages
  - Business Manager
  - Energy Manager
  - Homestead Manager
  - Weather Manager
  - Website
  - MySQL Local

- Operations hub page
  - Server Node
  - Dependencies
  - Service Terminal
  - Tunnel + DB

## 6) Current Critical Problem State

The user reports recurring UI behavior where buttons are non-functional and specifically `Operations hub` cannot be opened reliably.

### What has already been attempted

1. **Preload-secure route**
   - Added `preload.js` and bridge.
   - Used `contextIsolation` path.
   - Reliability problems remained in this inline/data URL architecture.

2. **Stability fallback route**
   - Reverted to:
     - `nodeIntegration: true`
     - `contextIsolation: false`
   - Direct `require('electron').ipcRenderer` in renderer.
   - Added runtime banner diagnostics.

3. **Additional resilience patch**
   - Added hard inline fallback `onclick` handlers on sidebar/nav buttons so page switching works even if delegated bindings fail.

### Practical interpretation

- Root cause is very likely **renderer script fragility under large inline string architecture**, not one single IPC channel bug.
- The robust fix path remains:
  - move renderer out of inline string into `file://` HTML/JS
  - move to preload bridge
  - tighten CSP and remove renderer `require` dependency
  - make event binding deterministic post-DOM load

## 7) MySQL Feature Internals

Main helper patterns:

- `normalizeMySqlConfig(...)`
  - Sanitizes and defaults host/port/user/password/db for connection.

- `ensureSafeIdentifier(name)`
  - Guards dynamic SQL identifiers.
  - Prevents injection by validating expected identifier format.

- `withMySqlConnection(...)`
  - Connection lifecycle wrapper (open/use/close).

IPC endpoints handle:

- connect
- list tables
- read table rows (`LIMIT n`)
- insert row
- update row (with where column/value mapping)
- delete row (with safe where clauses)

## 8) Operations Hub Feature Internals

### Profile and env synchronization

Helper stack includes:

- `.env` parsing/stringifying helpers
- load/save profile to env map
- profile normalization with defaults
- enforced readiness checks

### Local command execution

- Runs local shell commands through spawned processes.
- Includes command and output streaming to terminal tab.
- Platform conditionals present for Windows vs POSIX in some actions.

### Dependency + service actions

Includes checks/install flows for:

- MySQL server
- cloudflared
- folder setup for install root / db dir / website dir
- service lifecycle operations

### Tunnel + DB actions

- cloudflared token + config driven.
- constructs run commands and config fragments.
- supports public DB hostname setting for endpoint mapping.

### Reliability actions

- health snapshot checks (includes disk free logic)
- create backup SQL dump
- pick backup file
- restore from dump

## 9) Installer and Release Pipeline Details

### Build artifacts

- Unpacked app output under `dist/...`.
- Installer output under `dist-installer/...`.

### Installer tooling rationale

- `electron-builder` path was abandoned due Windows-specific issues (symlink permissions / toolchain friction).
- `electron-winstaller` chosen for practical success path.

### One-click release behavior (`release-oneclick.ps1`)

Exact order:

1. bump patch semver
2. edit package metadata files
3. build installer
4. commit + push
5. create/update release tag on GitHub
6. upload installer asset
7. print release URL

## 10) Auto-Update Logic

Main process includes logic for:

- fetching latest GitHub release metadata
- comparing current app version vs latest release
- downloading installer asset
- launching installer for update application

Private repo support depends on token usage in API/download requests.

## 11) Security and Hardening Posture (Current Reality)

Current posture is intentionally reliability-first, not max-hardened:

- `nodeIntegration` enabled
- `contextIsolation` disabled
- inline `data:` renderer with embedded script

This is acceptable for immediate local-server operations continuity but should be treated as transitional.

### Recommended hardening migration (priority sequence)

1. extract inline HTML/JS to `src/renderer/index.html` + `src/renderer/app.js`
2. use `preload.js` bridge only
3. set `contextIsolation: true`, `nodeIntegration: false`
4. keep all privileged ops in main IPC handlers
5. add strict input validation and secret handling boundaries

## 12) Operational Conventions and Deployment Assumptions

Known assumptions from user requirements:

- server device may be external-drive based (`E:\`)
- central root folder may move between devices; path should be configurable
- db data target may be `E:\database`
- website content may live under `E:\website`
- server may auto-login and run this app as the control plane
- cloudflare tunnel used to expose DB and static pages

## 13) Known Failure Modes and Mitigations Already Implemented

1. **Installer path too long**
   - Mitigated with short staging path.

2. **Installer output file lock (`EBUSY`)**
   - Mitigated with output cleanup and fallback naming behavior.

3. **Renderer parse/runtime blind spots**
   - Added syntax check script and runtime warning banner.

4. **GitHub CLI invocation edge cases**
   - Added `Invoke-Gh` wrapper with explicit exit-code handling.

5. **PowerShell command chaining differences**
   - Avoided `&&` issues in PowerShell context.

## 14) Immediate Next Steps for Claude Code (Execution Plan)

Use this exact sequence to stabilize with minimal regressions:

1. **Stop adding features until navigation is fully deterministic.**
2. **Extract renderer to files** (no inline data URL).
3. **Re-enable preload bridge path** and remove renderer direct `require`.
4. **Add a tiny IPC smoke test panel**:
   - `ping` invoke
   - result render
   - failure reason print
5. **Normalize all page navigation to one function**:
   - `showPage(pageId)`
   - centralized logging for page switches
6. **Add startup self-test log block**:
   - ipc available?
   - critical DOM nodes present?
   - event listener attach count
7. **Retest critical flows**:
   - open Operations hub
   - run dependency check
   - save profile
   - open MySQL page
8. **Only then continue feature expansion.**

## 15) Regression Test Checklist (Manual)

Run this checklist after each structural change:

- app launches without blank screen
- Dashboard opens by default
- Operations hub opens from sidebar and from button
- MySQL Local opens
- tab switches work inside dashboard and operations hub
- terminal output area receives streamed chunks
- at least one IPC action returns success payload
- runtime error banner does not appear during basic navigation
- open-at-login toggle reads and writes correctly

## 16) Commands You Can Run Quickly

- Start app in dev:
  - `npm run dev`
- Parse-check main process:
  - `node --check src/main.js`
- Parse-check renderer extraction helper:
  - `node scripts/check-renderer-script.cjs`
- Build unpacked app:
  - `npm run build`
- Build installer:
  - `npm run build:installer`

## 17) Git / Release Working Notes

- The repository has active iterative changes; verify status before automation.
- One-click release script commits and pushes automatically; use intentionally.
- If you need local-only docs/changes, commit but do not push.

## 18) What "Done" Looks Like for the Current Blocker

The current blocker is solved when:

1. `Operations hub` reliably opens every launch.
2. Navigation does not depend on brittle fallback inline snippets.
3. IPC roundtrips are observable and deterministic.
4. No runtime banner appears during standard path usage.

## 19) Handoff Summary in One Paragraph

This app is a Windows-focused Electron control panel that currently centralizes project builds, MySQL CRUD, server dependency/service orchestration, tunnel operations, backup/restore, and release/update workflows; most logic lives in one large `src/main.js` that embeds renderer HTML/JS inline, and the primary outstanding issue is renderer reliability (buttons/pages intermittently failing, especially Operations hub), with the clear next engineering move being a structural migration to file-based renderer + preload IPC bridge + deterministic event wiring before additional features are layered on.
