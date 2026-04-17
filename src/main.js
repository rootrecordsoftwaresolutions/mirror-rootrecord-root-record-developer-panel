const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const Store = require('electron-store');
const { spawn } = require('child_process');
const simpleGit = require('simple-git');
const mysql = require('mysql2/promise');

const store = new Store();
let mainWindow;

/** Workspace root that contains sibling apps (e.g. `Development`, not inside `dist`). */
function getDevelopmentFolder() {
  const fromEnv = process.env.ROOTRECORD_DEVELOPMENT_ROOT;
  if (fromEnv && typeof fromEnv === 'string' && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }
  if (app.isPackaged) {
    // Packaged: .../Development/Root Record Developer Panel/dist/RootRecordDeveloperPanel-win32-x64/*.exe
    const exeDir = path.dirname(process.execPath);
    return path.resolve(exeDir, '..', '..', '..');
  }
  // Dev: .../Development/Root Record Developer Panel/src → parent of panel folder
  return path.resolve(path.dirname(__dirname), '..');
}

const developmentFolder = getDevelopmentFolder();

/** Windows: optional “start when you log in” (packaged .exe uses execPath; dev uses Electron + app path). */
function applyOpenAtLoginSetting() {
  if (process.platform !== 'win32') return;
  const enabled = Boolean(store.get('openAtLogin', false));
  const opts = { openAtLogin: enabled };
  if (process.defaultApp) {
    opts.path = process.execPath;
    opts.args = [path.resolve(path.join(__dirname, '..'))];
  } else {
    opts.path = process.execPath;
  }
  try {
    app.setLoginItemSettings(opts);
  } catch (err) {
    console.error('setLoginItemSettings failed', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    title: 'Root Record Developer Panel'
  });

  // Create a simple HTML interface inline with dedicated project pages
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Root Record Developer Panel</title>
      <style>
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
          margin: 0; 
          padding: 20px; 
          background: #1e1e1e; 
          color: #d4d4d4; 
        }
        .container { display: flex; height: calc(100vh - 40px); }
        .sidebar { width: 300px; background: #252526; padding: 15px; overflow-y: auto; }
        .main { flex: 1; padding: 15px; overflow-y: auto; }
        .terminal { background: #0c0c0c; color: #00ff00; font-family: 'Consolas', monospace; padding: 10px; height: 200px; overflow-y: auto; border: 1px solid #333; }
        .project { 
          background: #2d2d30; 
          padding: 10px; 
          margin: 5px 0; 
          border-radius: 4px; 
          cursor: pointer; 
          border-left: 3px solid #007acc;
        }
        .project:hover { background: #3e3e42; }
        .project.selected { background: #094771; border-left-color: #00ff00; }
        .btn { 
          background: #007acc; 
          color: white; 
          border: none; 
          padding: 8px 16px; 
          margin: 5px; 
          border-radius: 4px; 
          cursor: pointer; 
        }
        .btn:hover { background: #005a9e; }
        .btn.danger { background: #d32f2f; }
        .btn.danger:hover { background: #b71c1c; }
        .btn.success { background: #388e3c; }
        .btn.success:hover { background: #2e7d32; }
        .btn.warning { background: #f57c00; }
        .btn.warning:hover { background: #ef6c00; }
        h1 { color: #007acc; }
        h2 { color: #4ec9b0; }
        h3 { color: #81c784; }
        .status { padding: 5px; margin: 5px 0; border-radius: 3px; }
        .status.clean { background: #1b5e20; }
        .status.dirty { background: #b71c1c; }
        .page { display: none; }
        .page.active { display: block; }
        .build-info { background: #2d2d30; padding: 10px; margin: 10px 0; border-radius: 4px; border-left: 3px solid #4caf50; }
        .file-list { background: #1e1e1e; padding: 10px; margin: 10px 0; border-radius: 4px; font-family: monospace; font-size: 12px; }
        .tab-nav { display: flex; margin-bottom: 20px; border-bottom: 1px solid #333; }
        .tab { padding: 10px 20px; cursor: pointer; background: #2d2d30; border: 1px solid #333; border-bottom: none; margin-right: 5px; border-radius: 4px 4px 0 0; }
        .tab.active { background: #007acc; color: white; }
        .tab:hover { background: #3e3e42; }
        .build-settings-field { margin: 14px 0; }
        .build-settings-field label { display: block; margin-bottom: 4px; color: #c5c9ce; font-size: 13px; }
        .build-settings-path { width: 58%; min-width: 220px; background: #2d2d30; color: #d4d4d4; border: 1px solid #555; padding: 6px; font-size: 12px; }
        .build-settings-status { margin-top: 12px; font-size: 13px; color: #9cdcfe; white-space: pre-wrap; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="sidebar">
          <h2>Projects</h2>
          <div id="projectList">
            <div class="project" data-page-target="business-manager"><strong>📊 Business Manager</strong><br><small>Business management app</small></div>
            <div class="project" data-page-target="energy-manager"><strong>⚡ Energy Manager</strong><br><small>Energy monitoring app</small></div>
            <div class="project" data-page-target="homestead-manager"><strong>🏡 Homestead Manager</strong><br><small>Homestead management app</small></div>
            <div class="project" data-page-target="weather-manager"><strong>🌦️ Weather Manager</strong><br><small>Weather and alert intelligence app</small></div>
            <div class="project" data-page-target="website"><strong>🌐 Website</strong><br><small>Public website</small></div>
            <div class="project" data-page-target="mysql-local"><strong>🗄️ MySQL Local</strong><br><small>Database editing tools</small></div>
          </div>
          <hr style="margin: 20px 0; border-color: #333;">
          <button class="btn" data-page-target="dashboard" style="width: 100%;">🏠 Dashboard</button>
          <button class="btn" data-page-target="operations-hub" style="width: 100%; margin-top: 8px;">🔧 Operations hub</button>
        </div>
        <div class="main">
          <!-- Dashboard Page -->
          <div id="dashboard-page" class="page active">
            <h1>Root Record Developer Panel</h1>
            <div class="tab-nav">
              <div class="tab active" onclick="showTab(event, 'overview')">Overview</div>
              <div class="tab" onclick="showTab(event, 'terminal')">Terminal</div>
            </div>
            <div id="overview-tab">
              <div id="projectSummary">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px;">
                  <div class="build-info">
                    <h3>📊 Business Manager</h3>
                    <p>Python desktop app with business management features</p>
                    <button class="btn" data-page-target="business-manager">Open →</button>
                  </div>
                  <div class="build-info">
                    <h3>⚡ Energy Manager</h3>
                    <p>Energy monitoring with EcoFlow and weather integration</p>
                    <button class="btn" data-page-target="energy-manager">Open →</button>
                  </div>
                  <div class="build-info">
                    <h3>🏡 Homestead Manager</h3>
                    <p>Homestead management with public data integration</p>
                    <button class="btn" data-page-target="homestead-manager">Open →</button>
                  </div>
                  <div class="build-info">
                    <h3>🌦️ Weather Manager</h3>
                    <p>NOAA, USGS, and alert-focused weather intelligence app</p>
                    <button class="btn" data-page-target="weather-manager">Open →</button>
                  </div>
                  <div class="build-info">
                    <h3>🌐 Website</h3>
                    <p>Public website hosted on Cloudflare Pages</p>
                    <button class="btn" data-page-target="website">Open →</button>
                  </div>
                  <div class="build-info">
                    <h3>🗄️ MySQL Local</h3>
                    <p>Browse and edit local MySQL tables</p>
                    <button class="btn" data-page-target="mysql-local">Open →</button>
                  </div>
                </div>
              </div>
              <p style="color:#888;font-size:12px;">Batch builds and git summaries print to <strong>Terminal</strong> (global).</p>
              <h2>Quick Actions</h2>
              <button class="btn" onclick="buildAllProjects()">🔨 Build All</button>
              <button class="btn success" onclick="runAllProjects()">▶️ Run All</button>
              <button class="btn" onclick="gitStatusAll()">📊 Git Status All</button>
              <h2 style="margin-top:22px;">This machine</h2>
              <p style="color:#888;font-size:12px;margin:0 0 8px 0;">One install, same behavior on every PC — settings live in Electron userData (not your git tree).</p>
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="openAtLoginCb" onchange="toggleOpenAtLogin()" style="width:18px;height:18px;">
                <span>Start Developer Panel when Windows signs in</span>
              </label>
              <p style="color:#666;font-size:11px;margin:6px 0 0 28px;">Use a packaged build for the cleanest startup path; dev mode registers Electron with this app folder.</p>
            </div>
            <div id="terminal-tab" style="display: none;">
              <h2>Global Terminal</h2>
              <div id="globalTerminal" class="terminal"></div>
              <div>
                <input type="text" id="globalCommandInput" style="width: 70%; background: #2d2d30; color: #d4d4d4; border: 1px solid #555; padding: 5px;" placeholder="Enter command...">
                <button class="btn" onclick="executeGlobalCommand()">Execute</button>
                <button class="btn" onclick="clearGlobalTerminal()">Clear</button>
              </div>
            </div>
          </div>

          <div id="operations-hub-page" class="page">
            <h1>🔧 Root Record Operations hub</h1>
            <p style="color:#aaa;max-width:900px;line-height:1.5;">
              This app runs on your dedicated server machine and keeps core connectivity services online for all Root Record apps.
            </p>
            <div class="tab-nav">
              <div class="tab active" onclick="showProjectTab(event, 'operations-hub', 'actions')">Server Node</div>
              <div class="tab" onclick="showProjectTab(event, 'operations-hub', 'files')">Dependencies</div>
              <div class="tab" onclick="showProjectTab(event, 'operations-hub', 'terminal')">Service Terminal</div>
              <div class="tab" onclick="showProjectTab(event, 'operations-hub', 'build-settings')">Tunnel + DB</div>
            </div>
            <div id="operations-hub-actions-tab">
              <h3>Server Identity & Health</h3>
              <div class="build-settings-field">
                <label for="ops-node-name">Node Name</label>
                <input id="ops-node-name" class="build-settings-path" placeholder="RootRecord Data Node">
              </div>
              <div class="build-settings-field">
                <label for="ops-db-local-port">MySQL Port</label>
                <input id="ops-db-local-port" class="build-settings-path" placeholder="3306">
              </div>
              <div class="build-settings-field">
                <label for="ops-cf-token">Cloudflare Tunnel Token</label>
                <input id="ops-cf-token" class="build-settings-path" placeholder="cloudflared token">
              </div>
              <h3 style="margin-top:18px;">Database Login Profile</h3>
              <div class="build-settings-field">
                <label for="ops-db-host">DB Host</label>
                <input id="ops-db-host" class="build-settings-path" placeholder="127.0.0.1">
              </div>
              <div class="build-settings-field">
                <label for="ops-db-user">DB User</label>
                <input id="ops-db-user" class="build-settings-path" placeholder="rootrecord_app">
              </div>
              <div class="build-settings-field">
                <label for="ops-db-password">DB Password</label>
                <input id="ops-db-password" type="password" class="build-settings-path" placeholder="password">
              </div>
              <div class="build-settings-field">
                <label for="ops-db-name">DB Name</label>
                <input id="ops-db-name" class="build-settings-path" placeholder="rootrecord">
              </div>
              <div class="build-settings-field">
                <label for="ops-db-public-host">Public DB Hostname (tunnel endpoint)</label>
                <input id="ops-db-public-host" class="build-settings-path" placeholder="db.example.rootrecord.com">
              </div>
              <div class="build-settings-field">
                <label for="ops-install-root">Server App Root</label>
                <input id="ops-install-root" class="build-settings-path" placeholder="E:\\">
              </div>
              <div class="build-settings-field">
                <label for="ops-root-folder">Central Root Folder</label>
                <input id="ops-root-folder" class="build-settings-path" placeholder="E:\\rootrecord">
              </div>
              <div class="build-settings-field">
                <label for="ops-db-data-dir">MySQL Data Directory</label>
                <input id="ops-db-data-dir" class="build-settings-path" placeholder="E:\\database">
              </div>
              <div class="build-settings-field">
                <label for="ops-website-dir">Website Folder</label>
                <input id="ops-website-dir" class="build-settings-path" placeholder="E:\\website">
              </div>
              <h3 style="margin-top:18px;">App Update Source</h3>
              <div class="build-settings-field">
                <label for="ops-update-repo">GitHub Repo (owner/name)</label>
                <input id="ops-update-repo" class="build-settings-path" placeholder="RootRecord/root-record-developer-panel">
              </div>
              <div class="build-settings-field">
                <label for="ops-update-token">GitHub Token (private releases)</label>
                <input id="ops-update-token" type="password" class="build-settings-path" placeholder="ghp_...">
              </div>
              <button class="btn" onclick="loadOpsRemoteProfile()">Reload Saved</button>
              <button class="btn success" onclick="saveOpsRemoteProfile()">Save Profile</button>
              <button class="btn warning" onclick="testOpsRemoteConnection()">Check Server Health</button>
              <button class="btn" onclick="checkDeveloperPanelUpdate()">Check App Update</button>
              <button class="btn success" onclick="applyDeveloperPanelUpdate()">Install Latest App Release</button>
              <div id="ops-status" class="build-settings-status"></div>
            </div>
            <div id="operations-hub-files-tab" style="display:none;">
              <h3>Dependency Bootstrap (Local Server)</h3>
              <p style="color:#888;font-size:12px;max-width:900px;">Ensures this server has MySQL + cloudflared available so your other apps can connect to one stable data node.</p>
              <button class="btn success" onclick="installOpsRemoteDependencies()">Install/Upgrade Dependencies</button>
              <button class="btn" onclick="checkOpsRemoteDependencies()">Check Dependency Status</button>
              <h3 style="margin-top:16px;">Website Hosting</h3>
              <p style="color:#888;font-size:12px;max-width:900px;">Host login/static pages from the configured website folder and deploy updates from there.</p>
              <button class="btn" onclick="ensureOpsFolders()">Create/Verify Root + Website Folders</button>
              <button class="btn" onclick="openOpsWebsiteFolder()">Open Website Folder</button>
              <button class="btn success" onclick="deployOpsWebsite()">Deploy Website Folder</button>
            </div>
            <div id="operations-hub-terminal-tab" style="display:none;">
              <h3>Server Service Terminal</h3>
              <div id="operations-hub-terminal" class="terminal"></div>
              <div>
                <input type="text" id="operations-hub-command" style="width: 70%; background: #2d2d30; color: #d4d4d4; border: 1px solid #555; padding: 5px;" placeholder="Local server shell command...">
                <button class="btn" onclick="executeOpsRemoteCommand()">Execute</button>
                <button class="btn" onclick="clearProjectTerminal('operations-hub')">Clear</button>
              </div>
            </div>
            <div id="operations-hub-build-settings-tab" style="display:none;">
              <h3>Cloudflare Tunnel for MySQL</h3>
              <p style="color:#888;font-size:12px;max-width:900px;">Starts/stops local tunnel and database services on this server node.</p>
              <button class="btn" onclick="installOpsServices()">Install/Repair Services</button>
              <button class="btn" onclick="checkOpsServices()">Check Service Status</button>
              <button class="btn success" onclick="startOpsServices()">Start Services</button>
              <button class="btn warning" onclick="stopOpsServices()">Stop Services</button>
              <hr style="border-color:#333;margin:14px 0;">
              <button class="btn success" onclick="startOpsTunnel()">Start/Restart Tunnel</button>
              <button class="btn warning" onclick="stopOpsTunnel()">Stop Tunnel</button>
            </div>
          </div>

          <!-- Project Pages -->
          <div id="business-manager-page" class="page">
            <h1>📊 Root Record Business Manager</h1>
            <div class="build-info">
              <h3>Project Type: Python Desktop Application</h3>
              <p><strong>Main File:</strong> ui_main.py (448KB)</p>
              <p><strong>Build Scripts:</strong> Build RootRecord.bat, Build RootRecord MSIX.bat</p>
              <p><strong>Dependencies:</strong> requirements.txt (Python packages)</p>
            </div>
            <div class="tab-nav">
              <div class="tab active" onclick="showProjectTab(event, 'business-manager', 'actions')">Actions</div>
              <div class="tab" onclick="showProjectTab(event, 'business-manager', 'files')">Files</div>
              <div class="tab" onclick="showProjectTab(event, 'business-manager', 'terminal')">Terminal</div>
              <div class="tab" onclick="showProjectTab(event, 'business-manager', 'build-settings')">Build Settings</div>
            </div>
            <div id="business-manager-actions-tab">
              <h3>Build & Deploy</h3>
              <p style="color:#888;font-size:12px;margin:0 0 8px 0;">Output streams to the <strong>Terminal</strong> tab for this app (no extra console windows).</p>
              <button class="btn success" onclick="runPythonApp('Root Record Business Manager')">▶️ Run Business Manager</button>
              <button class="btn warning" onclick="buildMSIX('Root Record Business Manager')">📦 Build MSIX</button>
              <h3>Installer (Inno + PyInstaller)</h3>
              <div style="margin-bottom: 10px;">
                <button class="btn" onclick="signedFullBuild('Root Record Business Manager')" style="margin-right: 10px;">🔏 Sign &amp; full build</button>
                <button class="btn" onclick="unsignedFullBuild('Root Record Business Manager')">🛠️ Build without signing</button>
              </div>
              <h3>Git Operations</h3>
              <button class="btn" onclick="gitStatus('Root Record Business Manager')">📊 Git Status</button>
              <button class="btn" onclick="gitPush('Root Record Business Manager')">⬆️ Git Push</button>
              <button class="btn" onclick="gitPull('Root Record Business Manager')">⬇️ Git Pull</button>
              <div id="business-manager-git-status"></div>
            </div>
            <div id="business-manager-files-tab" style="display: none;">
              <h3>Key Files</h3>
              <div class="file-list">
                📄 ui_main.py - Main UI (448KB)<br>
                📄 data_api.py - Data API (71KB)<br>
                📄 migrations.py - Database migrations (41KB)<br>
                📄 license_client.py - License system (15KB)<br>
                📄 power_monitoring_plugin.py - Power monitoring plugin (10KB)<br>
                📄 usgs_earthquake_plugin.py - USGS earthquake plugin (9KB)<br>
                📄 Build RootRecord.bat - Build script<br>
                📄 Build RootRecord MSIX.bat - MSIX build script
              </div>
            </div>
            <div id="business-manager-terminal-tab" style="display: none;">
              <h3>Project Terminal</h3>
              <div id="business-manager-terminal" class="terminal"></div>
              <div>
                <input type="text" id="business-manager-command" style="width: 70%; background: #2d2d30; color: #d4d4d4; border: 1px solid #555; padding: 5px;" placeholder="Enter command...">
                <button class="btn" onclick="executeProjectCommand('Root Record Business Manager')">Execute</button>
                <button class="btn" onclick="clearProjectTerminal('business-manager')">Clear</button>
              </div>
            </div>
            <div id="business-manager-build-settings-tab" style="display: none;">
              <h3>Build Settings</h3>
              <p style="color:#888;font-size:13px;max-width:780px;">Saved in this panel and written to the project on <strong>Save</strong>. The same saved values are re-applied before <strong>Git Push</strong> and full/MSIX builds so the repo matches your configuration.</p>
              <div class="build-settings-field">
                <label for="business-manager-build-version">Version (<code>app_version.py</code> + <code>build/rootrecord.iss</code>)</label>
                <input type="text" id="business-manager-build-version" class="build-settings-path" placeholder="e.g. 1.3.50" style="width:220px">
                <button type="button" class="btn" onclick="bumpVersionForSlug('business-manager')" title="Patch +1; at .99 rolls to next minor .00">Bump Version</button>
              </div>
              <div class="build-settings-field">
                <label>Application icon (<code>.ico</code> &rarr; <code>favicon.ico</code>)</label><br>
                <input type="text" id="business-manager-path-icon" class="build-settings-path" readonly placeholder="Browse&hellip;">
                <button type="button" class="btn" onclick="pickBuildAssetField('business-manager','icon')">Browse&hellip;</button>
              </div>
              <div class="build-settings-field">
                <label>About page image (<code>.png</code> or <code>.jpg</code>)</label><br>
                <input type="text" id="business-manager-path-about" class="build-settings-path" readonly placeholder="Optional">
                <button type="button" class="btn" onclick="pickBuildAssetField('business-manager','about')">Browse&hellip;</button>
              </div>
              <div class="build-settings-field">
                <label>Installer wizard sidebar (<code>.bmp</code> &rarr; <code>build/branding/wizard-large.bmp</code>)</label><br>
                <input type="text" id="business-manager-path-wizardLarge" class="build-settings-path" readonly placeholder="Optional">
                <button type="button" class="btn" onclick="pickBuildAssetField('business-manager','wizardLarge')">Browse&hellip;</button>
              </div>
              <div class="build-settings-field">
                <label>Installer wizard header (<code>.bmp</code> &rarr; <code>build/branding/wizard-small.bmp</code>)</label><br>
                <input type="text" id="business-manager-path-wizardSmall" class="build-settings-path" readonly placeholder="Optional">
                <button type="button" class="btn" onclick="pickBuildAssetField('business-manager','wizardSmall')">Browse&hellip;</button>
              </div>
              <button type="button" class="btn success" onclick="saveRootRecordBuildSettings('business-manager')">Save Settings</button>
              <div id="business-manager-build-settings-status" class="build-settings-status"></div>
            </div>
          </div>

          <div id="energy-manager-page" class="page">
            <h1>⚡ Root Record Energy Manager</h1>
            <div class="build-info">
              <h3>Project Type: Python Desktop Application</h3>
              <p><strong>Main File:</strong> desktop_app.py (30KB)</p>
              <p><strong>Build Scripts:</strong> build_installer.bat, installer.iss</p>
              <p><strong>Special Features:</strong> EcoFlow integration, Weather monitoring</p>
            </div>
            <div class="tab-nav">
              <div class="tab active" onclick="showProjectTab(event, 'energy-manager', 'actions')">Actions</div>
              <div class="tab" onclick="showProjectTab(event, 'energy-manager', 'files')">Files</div>
              <div class="tab" onclick="showProjectTab(event, 'energy-manager', 'terminal')">Terminal</div>
              <div class="tab" onclick="showProjectTab(event, 'energy-manager', 'build-settings')">Build Settings</div>
            </div>
            <div id="energy-manager-actions-tab">
              <h3>Build & Deploy</h3>
              <p style="color:#888;font-size:12px;margin:0 0 8px 0;">This app uses <code>build_installer.bat</code> only (no separate RootRecord signed pipeline here). Logs go to the <strong>Terminal</strong> tab.</p>
              <button class="btn success" onclick="runPythonApp('Root Record Energy Manager')">▶️ Run Energy Manager</button>
              <button class="btn warning" onclick="buildInstaller('Root Record Energy Manager')">📦 Build installer</button>
              <h3>Git Operations</h3>
              <button class="btn" onclick="gitStatus('Root Record Energy Manager')">📊 Git Status</button>
              <button class="btn" onclick="gitPush('Root Record Energy Manager')">⬆️ Git Push</button>
              <button class="btn" onclick="gitPull('Root Record Energy Manager')">⬇️ Git Pull</button>
              <div id="energy-manager-git-status"></div>
            </div>
            <div id="energy-manager-files-tab" style="display: none;">
              <h3>Key Files</h3>
              <div class="file-list">
                📄 desktop_app.py - Main desktop app (30KB)<br>
                📄 chart_panel.py - Chart panel (21KB)<br>
                📄 ecoflow_settings_panel.py - EcoFlow settings (17KB)<br>
                📄 weather_tab.py - Weather tab (11KB)<br>
                📄 metrics_extract.py - Metrics extraction (13KB)<br>
                📄 build_installer.bat - Build script<br>
                📄 installer.iss - Inno Setup script
              </div>
            </div>
            <div id="energy-manager-terminal-tab" style="display: none;">
              <h3>Project Terminal</h3>
              <div id="energy-manager-terminal" class="terminal"></div>
              <div>
                <input type="text" id="energy-manager-command" style="width: 70%; background: #2d2d30; color: #d4d4d4; border: 1px solid #555; padding: 5px;" placeholder="Enter command...">
                <button class="btn" onclick="executeProjectCommand('Root Record Energy Manager')">Execute</button>
                <button class="btn" onclick="clearProjectTerminal('energy-manager')">Clear</button>
              </div>
            </div>
            <div id="energy-manager-build-settings-tab" style="display: none;">
              <h3>Build Settings</h3>
              <p style="color:#888;font-size:13px;max-width:780px;">Energy Manager uses <code>build_installer.bat</code> + root <code>installer.iss</code> (env-based version, <code>RootRecordPowerManager.ico</code>, <code>installer-assets/wizard-finish.bmp</code>) &mdash; not the RootRecord inner-package flow. Configure those files in the repo; this panel&apos;s saved RootRecord bundle settings apply only to <strong>Business Manager</strong> and <strong>Homestead Manager</strong>.</p>
            </div>
          </div>

          <div id="homestead-manager-page" class="page">
            <h1>🏡 Root Record Homestead Manager</h1>
            <div class="build-info">
              <h3>Project Type: Python Desktop Application</h3>
              <p><strong>Main File:</strong> ui_main.py (513KB)</p>
              <p><strong>Build Scripts:</strong> Build RootRecord.bat, Build RootRecord MSIX.bat</p>
              <p><strong>Special Features:</strong> Homestead management, Public data integration</p>
            </div>
            <div class="tab-nav">
              <div class="tab active" onclick="showProjectTab(event, 'homestead-manager', 'actions')">Actions</div>
              <div class="tab" onclick="showProjectTab(event, 'homestead-manager', 'files')">Files</div>
              <div class="tab" onclick="showProjectTab(event, 'homestead-manager', 'terminal')">Terminal</div>
              <div class="tab" onclick="showProjectTab(event, 'homestead-manager', 'build-settings')">Build Settings</div>
            </div>
            <div id="homestead-manager-actions-tab">
              <h3>Build & Deploy</h3>
              <p style="color:#888;font-size:12px;margin:0 0 8px 0;">Same pattern as Business Manager — stream output in this app&apos;s <strong>Terminal</strong> tab.</p>
              <button class="btn success" onclick="runPythonApp('Root Record Homestead Manager')">▶️ Run Homestead Manager</button>
              <button class="btn warning" onclick="buildMSIX('Root Record Homestead Manager')">📦 Build MSIX</button>
              <h3>Installer (Inno + PyInstaller)</h3>
              <div style="margin-bottom: 10px;">
                <button class="btn" onclick="signedFullBuild('Root Record Homestead Manager')" style="margin-right: 10px;">🔏 Sign &amp; full build</button>
                <button class="btn" onclick="unsignedFullBuild('Root Record Homestead Manager')">🛠️ Build without signing</button>
              </div>
              <h3>Git Operations</h3>
              <button class="btn" onclick="gitStatus('Root Record Homestead Manager')">📊 Git Status</button>
              <button class="btn" onclick="gitPush('Root Record Homestead Manager')">⬆️ Git Push</button>
              <button class="btn" onclick="gitPull('Root Record Homestead Manager')">⬇️ Git Pull</button>
              <div id="homestead-manager-git-status"></div>
            </div>
            <div id="homestead-manager-files-tab" style="display: none;">
              <h3>Key Files</h3>
              <div class="file-list">
                📄 ui_main.py - Main UI (513KB)<br>
                📄 data_api.py - Data API (107KB)<br>
                📄 migrations.py - Database migrations (57KB)<br>
                📄 branding_theme.py - Branding theme (9KB)<br>
                📄 homestead_public_data.py - Public data (9KB)<br>
                📄 Build RootRecord.bat - Build script<br>
                📄 Build RootRecord MSIX.bat - MSIX build script
              </div>
            </div>
            <div id="homestead-manager-terminal-tab" style="display: none;">
              <h3>Project Terminal</h3>
              <div id="homestead-manager-terminal" class="terminal"></div>
              <div>
                <input type="text" id="homestead-manager-command" style="width: 70%; background: #2d2d30; color: #d4d4d4; border: 1px solid #555; padding: 5px;" placeholder="Enter command...">
                <button class="btn" onclick="executeProjectCommand('Root Record Homestead Manager')">Execute</button>
                <button class="btn" onclick="clearProjectTerminal('homestead-manager')">Clear</button>
              </div>
            </div>
            <div id="homestead-manager-build-settings-tab" style="display: none;">
              <h3>Build Settings</h3>
              <p style="color:#888;font-size:13px;max-width:780px;">Same as Business Manager: save here, written on Save, re-applied before Git Push and full/MSIX builds.</p>
              <div class="build-settings-field">
                <label for="homestead-manager-build-version">Version</label>
                <input type="text" id="homestead-manager-build-version" class="build-settings-path" placeholder="e.g. 1.3.50" style="width:220px">
                <button type="button" class="btn" onclick="bumpVersionForSlug('homestead-manager')" title="Patch +1; at .99 rolls to next minor .00">Bump Version</button>
              </div>
              <div class="build-settings-field">
                <label>Application icon (<code>.ico</code>)</label><br>
                <input type="text" id="homestead-manager-path-icon" class="build-settings-path" readonly placeholder="Browse&hellip;">
                <button type="button" class="btn" onclick="pickBuildAssetField('homestead-manager','icon')">Browse&hellip;</button>
              </div>
              <div class="build-settings-field">
                <label>About page image</label><br>
                <input type="text" id="homestead-manager-path-about" class="build-settings-path" readonly placeholder="Optional">
                <button type="button" class="btn" onclick="pickBuildAssetField('homestead-manager','about')">Browse&hellip;</button>
              </div>
              <div class="build-settings-field">
                <label>Wizard sidebar (<code>.bmp</code>)</label><br>
                <input type="text" id="homestead-manager-path-wizardLarge" class="build-settings-path" readonly placeholder="Optional">
                <button type="button" class="btn" onclick="pickBuildAssetField('homestead-manager','wizardLarge')">Browse&hellip;</button>
              </div>
              <div class="build-settings-field">
                <label>Wizard header (<code>.bmp</code>)</label><br>
                <input type="text" id="homestead-manager-path-wizardSmall" class="build-settings-path" readonly placeholder="Optional">
                <button type="button" class="btn" onclick="pickBuildAssetField('homestead-manager','wizardSmall')">Browse&hellip;</button>
              </div>
              <button type="button" class="btn success" onclick="saveRootRecordBuildSettings('homestead-manager')">Save Settings</button>
              <div id="homestead-manager-build-settings-status" class="build-settings-status"></div>
            </div>
          </div>

          <div id="weather-manager-page" class="page">
            <h1>🌦️ Root Record Weather Manager</h1>
            <div class="build-info">
              <h3>Project Type: Electron Desktop Application</h3>
              <p><strong>Main File:</strong> src/main.js</p>
              <p><strong>Build Scripts:</strong> signed/unsigned installer wizard pipelines</p>
              <p><strong>Special Features:</strong> NOAA/USGS feeds, forecast dashboard, auth gate, local SQLite</p>
            </div>
            <div class="tab-nav">
              <div class="tab active" onclick="showProjectTab(event, 'weather-manager', 'actions')">Actions</div>
              <div class="tab" onclick="showProjectTab(event, 'weather-manager', 'files')">Files</div>
              <div class="tab" onclick="showProjectTab(event, 'weather-manager', 'terminal')">Terminal</div>
              <div class="tab" onclick="showProjectTab(event, 'weather-manager', 'build-settings')">Build Settings</div>
            </div>
            <div id="weather-manager-actions-tab">
              <h3>Run & Build</h3>
              <p style="color:#888;font-size:12px;margin:0 0 8px 0;">Output streams to this app's <strong>Terminal</strong> tab.</p>
              <button class="btn success" onclick="executeProjectCommand('Root Record Weather Manager', 'npm start')">▶️ Run Weather Manager</button>
              <div style="margin-top:8px;">
                <button class="btn" onclick="signedFullBuild('Root Record Weather Manager')" style="margin-right: 10px;">🔏 Sign &amp; full build</button>
                <button class="btn warning" onclick="unsignedFullBuild('Root Record Weather Manager')">📦 Unsigned full build</button>
              </div>
              <h3>Git Operations</h3>
              <button class="btn" onclick="gitStatus('Root Record Weather Manager')">📊 Git Status</button>
              <button class="btn" onclick="gitPush('Root Record Weather Manager')">⬆️ Git Push</button>
              <button class="btn" onclick="gitPull('Root Record Weather Manager')">⬇️ Git Pull</button>
              <div id="weather-manager-git-status"></div>
            </div>
            <div id="weather-manager-files-tab" style="display: none;">
              <h3>Key Files</h3>
              <div class="file-list">
                📄 src/main.js - Main Electron app and UI<br>
                📄 package.json - Scripts and dependencies<br>
                📄 build/installer.iss - Inno Setup installer wizard script<br>
                📄 scripts/build-installer.cjs - Installer pipeline (optional signing)<br>
                📄 Build RootRecord Weather Installer Signed.bat - Double-click signed build<br>
                📄 Build RootRecord Weather Installer.bat - Double-click unsigned build<br>
                📄 COMMERCIAL_API_PRICE_CHART.txt - API cost research notes<br>
                📄 README.md - Project notes
              </div>
            </div>
            <div id="weather-manager-terminal-tab" style="display: none;">
              <h3>Project Terminal</h3>
              <div id="weather-manager-terminal" class="terminal"></div>
              <div>
                <input type="text" id="weather-manager-command" style="width: 70%; background: #2d2d30; color: #d4d4d4; border: 1px solid #555; padding: 5px;" placeholder="Enter command...">
                <button class="btn" onclick="executeProjectCommand('Root Record Weather Manager')">Execute</button>
                <button class="btn" onclick="clearProjectTerminal('weather-manager')">Clear</button>
              </div>
            </div>
            <div id="weather-manager-build-settings-tab" style="display: none;">
              <h3>Build Settings</h3>
              <p style="color:#888;font-size:13px;max-width:780px;">Weather Manager now supports installer wizard builds with both unsigned and Azure-signed variants. Use the Actions tab buttons, or run <code>Build RootRecord Weather Installer.bat</code> / <code>Build RootRecord Weather Installer Signed.bat</code> directly.</p>
            </div>
          </div>

          <div id="website-page" class="page">
            <h1>🌐 Public Cloudflare Website</h1>
            <div class="build-info">
              <h3>Project Type: Static HTML Website</h3>
              <p><strong>Platform:</strong> Cloudflare Pages</p>
              <p><strong>Files:</strong> HTML, CSS, static assets</p>
            </div>
            <div class="tab-nav">
              <div class="tab active" onclick="showProjectTab(event, 'website', 'actions')">Actions</div>
              <div class="tab" onclick="showProjectTab(event, 'website', 'files')">Files</div>
              <div class="tab" onclick="showProjectTab(event, 'website', 'terminal')">Terminal</div>
              <div class="tab" onclick="showProjectTab(event, 'website', 'build-settings')">Build Settings</div>
            </div>
            <div id="website-actions-tab">
              <h3>Website Management</h3>
              <p style="color:#888;font-size:12px;margin:0 0 8px 0;">Deploy logs stream to the <strong>Terminal</strong> tab.</p>
              <button class="btn" onclick="openWebsite()">🌍 Open Website</button>
              <button class="btn" onclick="deployWebsite()">🚀 Deploy to Cloudflare</button>
              <button class="btn success" onclick="serveWebsite()">🔧 Serve Locally</button>
              <h3>File Operations</h3>
              <button class="btn" onclick="editIndex()">✏️ Edit Index</button>
              <button class="btn" onclick="editStyles()">🎨 Edit Styles</button>
            </div>
            <div id="website-files-tab" style="display: none;">
              <h3>Website Files</h3>
              <div class="file-list">
                📄 index.html - Main page (3KB)<br>
                📄 about.html - About page (2KB)<br>
                📄 contact.html - Contact page (2KB)<br>
                📄 faq.html - FAQ page (4KB)<br>
                📄 privacy.html - Privacy policy (8KB)<br>
                📄 terms.html - Terms of service (8KB)<br>
                📄 styles.css - Stylesheet (4KB)
              </div>
            </div>
            <div id="website-terminal-tab" style="display: none;">
              <h3>Website Terminal</h3>
              <div id="website-terminal" class="terminal"></div>
              <div>
                <input type="text" id="website-command" style="width: 70%; background: #2d2d30; color: #d4d4d4; border: 1px solid #555; padding: 5px;" placeholder="Enter command...">
                <button class="btn" onclick="executeProjectCommand('public cloudflare website pages')">Execute</button>
                <button class="btn" onclick="clearProjectTerminal('website')">Clear</button>
              </div>
            </div>
            <div id="website-build-settings-tab" style="display: none;">
              <h3>Build Settings</h3>
              <p style="color:#888;font-size:13px;max-width:780px;">Not applicable: this site deploys via Cloudflare Pages (<code>npx wrangler pages deploy</code>). Use <strong>Actions</strong> / <strong>Terminal</strong> and repo files such as <code>wrangler.toml</code> or <code>package.json</code> for deploy configuration.</p>
            </div>
          </div>

          <div id="mysql-local-page" class="page">
            <h1>🗄️ Local MySQL Editor</h1>
            <div class="build-info">
              <h3>Project Type: Device-local MySQL Management</h3>
              <p><strong>Use case:</strong> inspect, edit, insert, and delete rows from tables on this machine.</p>
              <p><strong>Scope:</strong> local MySQL server reachable from this device.</p>
            </div>
            <div class="tab-nav">
              <div class="tab active" onclick="showProjectTab(event, 'mysql-local', 'actions')">Connection</div>
              <div class="tab" onclick="showProjectTab(event, 'mysql-local', 'files')">Data</div>
              <div class="tab" onclick="showProjectTab(event, 'mysql-local', 'terminal')">Editor</div>
              <div class="tab" onclick="showProjectTab(event, 'mysql-local', 'build-settings')">Help</div>
            </div>
            <div id="mysql-local-actions-tab">
              <h3>Connection</h3>
              <div class="build-settings-field">
                <label for="mysql-host">Host</label>
                <input id="mysql-host" class="build-settings-path" placeholder="127.0.0.1">
              </div>
              <div class="build-settings-field">
                <label for="mysql-port">Port</label>
                <input id="mysql-port" class="build-settings-path" placeholder="3306">
              </div>
              <div class="build-settings-field">
                <label for="mysql-user">User</label>
                <input id="mysql-user" class="build-settings-path" placeholder="root">
              </div>
              <div class="build-settings-field">
                <label for="mysql-password">Password</label>
                <input id="mysql-password" class="build-settings-path" type="password" placeholder="password">
              </div>
              <div class="build-settings-field">
                <label for="mysql-database">Database</label>
                <input id="mysql-database" class="build-settings-path" placeholder="rootrecord">
              </div>
              <button class="btn success" onclick="connectMySqlLocal()">Connect</button>
              <button class="btn" onclick="applyServerDbSettingsToMySqlPage()">Use Server DB Settings</button>
              <button class="btn" onclick="loadMySqlLocalConfig()">Reload Saved Config</button>
              <div id="mysql-status" class="build-settings-status"></div>
            </div>
            <div id="mysql-local-files-tab" style="display: none;">
              <h3>Data Browser</h3>
              <div style="margin: 10px 0;">
                <select id="mysql-table-select" class="build-settings-path" onchange="loadMySqlTableData()">
                  <option value="">Select table...</option>
                </select>
                <button class="btn" onclick="loadMySqlTables()">Refresh Tables</button>
                <button class="btn success" onclick="addMySqlRow()">Add Row</button>
                <button class="btn warning" onclick="saveAllMySqlRows()">Save All Changes</button>
              </div>
              <div id="mysql-table-info" style="color:#9cdcfe;font-size:12px;margin:6px 0;"></div>
              <div id="mysql-editor-table" style="overflow:auto;max-height:60vh;border:1px solid #333;border-radius:4px;padding:8px;background:#1a1a1a;"></div>
            </div>
            <div id="mysql-local-terminal-tab" style="display: none;">
              <h3>Row Editor</h3>
              <p style="color:#888;font-size:12px;">Edit values directly in the grid, then use <strong>Save</strong> or <strong>Delete</strong> on each row.</p>
              <div id="mysql-edit-tips" class="file-list">
                - Empty value saves as NULL only if you type <code>NULL</code>.<br>
                - Primary key columns are used for updates/deletes when available.<br>
                - If no primary key exists, all columns are used to match updates/deletes.
              </div>
            </div>
            <div id="mysql-local-build-settings-tab" style="display: none;">
              <h3>Help</h3>
              <p style="color:#888;font-size:13px;max-width:900px;">This tool is intended for trusted local development use. It can modify live data. Use a MySQL account with only the permissions you need.</p>
            </div>
          </div>
        </div>
      </div>
      <script>
        const ipcRenderer = (() => {
          try {
            if (typeof require !== 'function') return null;
            const electron = require('electron');
            return electron && electron.ipcRenderer ? electron.ipcRenderer : null;
          } catch {
            return null;
          }
        })();
        let projects = [];
        const developmentFolder = ${JSON.stringify(developmentFolder)};
        let mySqlEditorState = {
          tables: [],
          columns: [],
          primaryKeys: [],
          selectedTable: '',
          rows: [],
        };

        async function loadProjects() {
          // Always paint the static sidebar + overview first; list-projects must never block this
          // (slow disk, bad path, or IPC quirks otherwise leave an empty Projects list).
          renderProjects();
          renderProjectSummary();
          if (!ipcRenderer) return;
          try {
            projects = await ipcRenderer.invoke('list-projects', developmentFolder);
          } catch (e) {
            console.error('list-projects failed', e);
            projects = [];
          }
        }

        function renderProjects() {
          const projectList = document.getElementById('projectList');
          if (!projectList) return;
          // Static rows are embedded in HTML so the sidebar stays populated even if this script stops early.
          if (projectList.querySelector('.project')) return;
          projectList.innerHTML = '';
          
          // Add dedicated project buttons
          const projectButtons = [
            { id: 'business-manager', name: '📊 Business Manager', desc: 'Business management app' },
            { id: 'energy-manager', name: '⚡ Energy Manager', desc: 'Energy monitoring app' },
            { id: 'homestead-manager', name: '🏡 Homestead Manager', desc: 'Homestead management app' },
            { id: 'weather-manager', name: '🌦️ Weather Manager', desc: 'Weather and alert intelligence app' },
            { id: 'website', name: '🌐 Website', desc: 'Public website' },
            { id: 'mysql-local', name: '🗄️ MySQL Local', desc: 'Database editing tools' }
          ];

          projectButtons.forEach(project => {
            const div = document.createElement('div');
            div.className = 'project';
            div.innerHTML = \`
              <strong>\${project.name}</strong><br>
              <small>\${project.desc}</small>
            \`;
            div.onclick = () => showPage(project.id);
            projectList.appendChild(div);
          });
        }

        function renderProjectSummary() {
          const summary = document.getElementById('projectSummary');
          if (!summary) return;
          if (summary.querySelector('.build-info')) return;
          summary.innerHTML = \`
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px;">
              <div class="build-info">
                <h3>📊 Business Manager</h3>
                <p>Python desktop app with business management features</p>
                <button class="btn" data-page-target="business-manager">Open →</button>
              </div>
              <div class="build-info">
                <h3>⚡ Energy Manager</h3>
                <p>Energy monitoring with EcoFlow and weather integration</p>
                <button class="btn" data-page-target="energy-manager">Open →</button>
              </div>
              <div class="build-info">
                <h3>🏡 Homestead Manager</h3>
                <p>Homestead management with public data integration</p>
                <button class="btn" data-page-target="homestead-manager">Open →</button>
              </div>
              <div class="build-info">
                <h3>🌦️ Weather Manager</h3>
                <p>NOAA, USGS, and alert-focused weather intelligence app</p>
                <button class="btn" data-page-target="weather-manager">Open →</button>
              </div>
              <div class="build-info">
                <h3>🌐 Website</h3>
                <p>Public website hosted on Cloudflare Pages</p>
                <button class="btn" data-page-target="website">Open →</button>
              </div>
              <div class="build-info">
                <h3>🗄️ MySQL Local</h3>
                <p>Browse and edit local MySQL tables</p>
                <button class="btn" data-page-target="mysql-local">Open →</button>
              </div>
            </div>
          \`;
        }

        function showPage(pageId) {
          // Hide all pages
          document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
          // Show selected page
          const targetPage = document.getElementById(pageId + '-page');
          if (targetPage) {
            targetPage.classList.add('active');
          }
        }

        function showTab(ev, tabId) {
          const overview = document.getElementById('overview-tab');
          const terminal = document.getElementById('terminal-tab');
          const dash = document.getElementById('dashboard-page');
          if (!overview || !terminal || !dash) return;
          overview.style.display = tabId === 'overview' ? 'block' : 'none';
          terminal.style.display = tabId === 'terminal' ? 'block' : 'none';
          const tabNav = dash.querySelector('.tab-nav');
          if (tabNav) {
            tabNav.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          }
          const el = ev && ev.target;
          if (el && el.classList) el.classList.add('active');
        }

        const PROJECT_INNER_TAB_ORDER = ['actions', 'files', 'terminal', 'build-settings'];

        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function readMySqlForm() {
          return {
            host: (document.getElementById('mysql-host') || {}).value || '',
            port: Number((document.getElementById('mysql-port') || {}).value || 3306),
            user: (document.getElementById('mysql-user') || {}).value || '',
            password: (document.getElementById('mysql-password') || {}).value || '',
            database: (document.getElementById('mysql-database') || {}).value || '',
          };
        }

        function setMySqlStatus(text, isError) {
          const status = document.getElementById('mysql-status');
          if (!status) return;
          status.textContent = text;
          status.style.color = isError ? '#f28b82' : '#9cdcfe';
        }

        async function loadMySqlLocalConfig() {
          if (!ipcRenderer) return;
          const cfg = await ipcRenderer.invoke('mysql-get-config');
          if (!cfg) return;
          const hostEl = document.getElementById('mysql-host');
          const portEl = document.getElementById('mysql-port');
          const userEl = document.getElementById('mysql-user');
          const passwordEl = document.getElementById('mysql-password');
          const databaseEl = document.getElementById('mysql-database');
          if (hostEl) hostEl.value = cfg.host || '127.0.0.1';
          if (portEl) portEl.value = String(cfg.port || 3306);
          if (userEl) userEl.value = cfg.user || '';
          if (passwordEl) passwordEl.value = cfg.password || '';
          if (databaseEl) databaseEl.value = cfg.database || '';
        }

        async function connectMySqlLocal() {
          if (!ipcRenderer) return;
          const cfg = readMySqlForm();
          setMySqlStatus('Connecting...', false);
          const result = await ipcRenderer.invoke('mysql-connect', cfg);
          if (!result || !result.ok) {
            setMySqlStatus(result && result.error ? result.error : 'Connection failed.', true);
            return;
          }
          setMySqlStatus('Connected. Loading tables...', false);
          await loadMySqlTables();
        }

        async function loadMySqlTables() {
          if (!ipcRenderer) return;
          const result = await ipcRenderer.invoke('mysql-list-tables');
          if (!result || !result.ok) {
            setMySqlStatus(result && result.error ? result.error : 'Failed to load tables.', true);
            return;
          }
          mySqlEditorState.tables = result.tables || [];
          const select = document.getElementById('mysql-table-select');
          if (!select) return;
          select.innerHTML = '<option value="">Select table...</option>' +
            mySqlEditorState.tables.map((t) => '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>').join('');
          setMySqlStatus('Connected. ' + mySqlEditorState.tables.length + ' tables found.', false);
        }

        async function loadMySqlTableData() {
          if (!ipcRenderer) return;
          const select = document.getElementById('mysql-table-select');
          const table = select ? select.value : '';
          if (!table) return;
          const result = await ipcRenderer.invoke('mysql-read-table', { table, limit: 200 });
          if (!result || !result.ok) {
            setMySqlStatus(result && result.error ? result.error : 'Failed to read table.', true);
            return;
          }
          mySqlEditorState.selectedTable = table;
          mySqlEditorState.columns = result.columns || [];
          mySqlEditorState.primaryKeys = result.primaryKeys || [];
          mySqlEditorState.rows = (result.rows || []).map((row) => ({ ...row, __isNew: false }));
          renderMySqlTable();
          const info = document.getElementById('mysql-table-info');
          if (info) {
            info.textContent = 'Loaded ' + mySqlEditorState.rows.length + ' row(s). Primary keys: ' +
              (mySqlEditorState.primaryKeys.length ? mySqlEditorState.primaryKeys.join(', ') : 'none');
          }
          setMySqlStatus('Table loaded: ' + table, false);
        }

        function addMySqlRow() {
          if (!mySqlEditorState.columns.length) return;
          const row = { __isNew: true };
          mySqlEditorState.columns.forEach((c) => {
            row[c.name] = '';
          });
          mySqlEditorState.rows.unshift(row);
          renderMySqlTable();
        }

        function onMySqlCellInput(rowIndex, columnName, value) {
          const row = mySqlEditorState.rows[rowIndex];
          if (!row) return;
          row[columnName] = value;
        }

        async function saveMySqlRow(rowIndex) {
          if (!ipcRenderer) return;
          const row = mySqlEditorState.rows[rowIndex];
          if (!row) return;
          const payload = {
            table: mySqlEditorState.selectedTable,
            row,
            columns: mySqlEditorState.columns,
            primaryKeys: mySqlEditorState.primaryKeys,
          };
          const result = row.__isNew
            ? await ipcRenderer.invoke('mysql-insert-row', payload)
            : await ipcRenderer.invoke('mysql-update-row', payload);
          if (!result || !result.ok) {
            setMySqlStatus(result && result.error ? result.error : 'Save failed.', true);
            return;
          }
          setMySqlStatus('Row saved.', false);
          await loadMySqlTableData();
        }

        async function deleteMySqlRow(rowIndex) {
          if (!ipcRenderer) return;
          const row = mySqlEditorState.rows[rowIndex];
          if (!row) return;
          if (row.__isNew) {
            mySqlEditorState.rows.splice(rowIndex, 1);
            renderMySqlTable();
            return;
          }
          const result = await ipcRenderer.invoke('mysql-delete-row', {
            table: mySqlEditorState.selectedTable,
            row,
            columns: mySqlEditorState.columns,
            primaryKeys: mySqlEditorState.primaryKeys,
          });
          if (!result || !result.ok) {
            setMySqlStatus(result && result.error ? result.error : 'Delete failed.', true);
            return;
          }
          setMySqlStatus('Row deleted.', false);
          await loadMySqlTableData();
        }

        async function saveAllMySqlRows() {
          for (let i = 0; i < mySqlEditorState.rows.length; i++) {
            const row = mySqlEditorState.rows[i];
            if (row.__isNew) {
              await saveMySqlRow(i);
            }
          }
        }

        function renderMySqlTable() {
          const host = document.getElementById('mysql-editor-table');
          if (!host) return;
          if (!mySqlEditorState.columns.length) {
            host.innerHTML = '<p style="color:#888;">Select a table to start editing.</p>';
            return;
          }
          const columns = mySqlEditorState.columns.map((c) => c.name);
          const header = columns.map((name) => '<th style="border:1px solid #333;padding:6px;background:#2d2d30;">' + escapeHtml(name) + '</th>').join('');
          const rows = mySqlEditorState.rows.map((row, rowIndex) => {
            const cells = columns.map((name) => {
              const value = row[name] == null ? '' : String(row[name]);
              return '<td style="border:1px solid #333;padding:4px;"><input style="width:100%;background:#111;color:#d4d4d4;border:1px solid #444;padding:4px;" value="' + escapeHtml(value) + '" oninput="onMySqlCellInput(' + rowIndex + ', ' + JSON.stringify(name) + ', this.value)"></td>';
            }).join('');
            return '<tr>' + cells + '<td style="border:1px solid #333;padding:4px;white-space:nowrap;">' +
              '<button class="btn success" style="margin:2px;" onclick="saveMySqlRow(' + rowIndex + ')">Save</button>' +
              '<button class="btn danger" style="margin:2px;" onclick="deleteMySqlRow(' + rowIndex + ')">Delete</button>' +
              '</td></tr>';
          }).join('');
          host.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>' + header + '<th style="border:1px solid #333;padding:6px;background:#2d2d30;">Actions</th></tr></thead><tbody>' + rows + '</tbody></table>';
        }

        function showProjectTab(ev, projectId, tabId) {
          const page = document.getElementById(projectId + '-page');
          if (!page) return;
          PROJECT_INNER_TAB_ORDER.forEach((t) => {
            const panel = document.getElementById(projectId + '-' + t + '-tab');
            if (panel) panel.style.display = t === tabId ? 'block' : 'none';
          });
          const tabNav = page.querySelector('.tab-nav');
          if (tabNav) {
            tabNav.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          }
          const el = ev && ev.target;
          if (el && el.classList) el.classList.add('active');
          if (tabId === 'build-settings' && (projectId === 'business-manager' || projectId === 'homestead-manager')) {
            void loadRootRecordBuildSettingsPanel(projectId);
          }
        }

        const RR_SLUG_TO_PROJECT_DIR = {
          'business-manager': 'Root Record Business Manager',
          'homestead-manager': 'Root Record Homestead Manager',
        };

        function bumpVersionString(raw) {
          const s = String(raw || '').trim();
          const parts = s.split('.').map((x) => parseInt(x, 10));
          if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n) || n < 0)) return null;
          let major = parts[0];
          let minor = parts[1];
          let patch = parts[2];
          let patchWasCarry = false;
          if (minor === 99 && patch === 99) {
            major += 1;
            minor = 0;
            patch = 0;
            patchWasCarry = true;
          } else if (patch === 99) {
            minor += 1;
            patch = 0;
            patchWasCarry = true;
          } else {
            patch += 1;
          }
          const patchStr = patchWasCarry ? String(patch).padStart(2, '0') : String(patch);
          return major + '.' + minor + '.' + patchStr;
        }

        function bumpVersionForSlug(slug) {
          const inp = document.getElementById(slug + '-build-version');
          if (!inp) return;
          const next = bumpVersionString(inp.value);
          if (!next) {
            alert('Enter a valid version first (e.g. 1.3.49).');
            return;
          }
          inp.value = next;
        }

        async function loadRootRecordBuildSettingsPanel(slug) {
          if (!ipcRenderer) return;
          const dirName = RR_SLUG_TO_PROJECT_DIR[slug];
          if (!dirName) return;
          try {
            const data = await ipcRenderer.invoke('get-build-settings', dirName);
            const ver = document.getElementById(slug + '-build-version');
            if (ver) ver.value = (data.saved && data.saved.version) || data.diskVersion || '';
            const fields = ['icon', 'about', 'wizardLarge', 'wizardSmall'];
            for (const f of fields) {
              const el = document.getElementById(slug + '-path-' + f);
              if (el) el.value = (data.saved && data.saved[f + 'Src']) || '';
            }
            const st = document.getElementById(slug + '-build-settings-status');
            if (st && data.innerRoot) st.textContent = 'Package root: ' + data.innerRoot;
            if (st && !data.innerRoot) st.textContent = 'Could not find build_rootrecord.spec for this project.';
          } catch (e) {
            const st = document.getElementById(slug + '-build-settings-status');
            if (st) st.textContent = 'Load failed: ' + (e && e.message ? e.message : String(e));
          }
        }

        async function pickBuildAssetField(slug, field) {
          if (!ipcRenderer) {
            alert('Electron IPC unavailable in this window.');
            return;
          }
          let filters = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'ico'] }];
          if (field === 'icon') filters = [{ name: 'Icon', extensions: ['ico'] }];
          if (field === 'wizardLarge' || field === 'wizardSmall') filters = [{ name: 'Bitmap', extensions: ['bmp'] }];
          const p = await ipcRenderer.invoke('pick-build-asset', { filters });
          if (!p) return;
          const el = document.getElementById(slug + '-path-' + field);
          if (el) el.value = p;
        }

        async function saveRootRecordBuildSettings(slug) {
          if (!ipcRenderer) {
            alert('Electron IPC unavailable in this window.');
            return;
          }
          const dirName = RR_SLUG_TO_PROJECT_DIR[slug];
          if (!dirName) return;
          const st = document.getElementById(slug + '-build-settings-status');
          const version = (document.getElementById(slug + '-build-version') || {}).value || '';
          const payload = {
            projectDirName: dirName,
            version: version.trim(),
            iconSrc: (document.getElementById(slug + '-path-icon') || {}).value || '',
            aboutSrc: (document.getElementById(slug + '-path-about') || {}).value || '',
            wizardLargeSrc: (document.getElementById(slug + '-path-wizardLarge') || {}).value || '',
            wizardSmallSrc: (document.getElementById(slug + '-path-wizardSmall') || {}).value || '',
          };
          try {
            const r = await ipcRenderer.invoke('save-build-settings', payload);
            if (st) st.textContent = r.ok ? (r.message || 'Saved.') : (r.errors || ['Save failed']).join('\n');
            if (!r.ok) alert((r.errors || ['Save failed']).join('\n'));
          } catch (e) {
            if (st) st.textContent = 'Save failed: ' + (e && e.message ? e.message : String(e));
            alert(st.textContent);
          }
        }

        function appendTerminalStream(projectId, text) {
          const el = projectId === 'dashboard'
            ? document.getElementById('globalTerminal')
            : document.getElementById(projectId + '-terminal');
          if (!el) return;
          el.textContent += text;
          el.scrollTop = el.scrollHeight;
        }

        function switchDashboardToTerminal() {
          const second = document.querySelector('#dashboard-page .tab-nav .tab:nth-child(2)');
          if (second) showTab({ target: second }, 'terminal');
        }

        function switchProjectToTerminal(projectId) {
          const page = document.getElementById(projectId + '-page');
          if (!page) return;
          PROJECT_INNER_TAB_ORDER.forEach((t) => {
            const panel = document.getElementById(projectId + '-' + t + '-tab');
            if (panel) panel.style.display = t === 'terminal' ? 'block' : 'none';
          });
          const tabNav = page.querySelector('.tab-nav');
          if (tabNav) {
            tabNav.querySelectorAll('.tab').forEach((tab, i) => {
              const t = PROJECT_INNER_TAB_ORDER[i];
              if (t) tab.classList.toggle('active', t === 'terminal');
            });
          }
        }

        if (ipcRenderer) {
          ipcRenderer.on('terminal-stream', (_evt, payload) => {
            if (!payload || typeof payload.text !== 'string') return;
            appendTerminalStream(payload.projectId, payload.text);
          });
        }

        async function executeGlobalCommand() {
          if (!ipcRenderer) return;
          const input = document.getElementById('globalCommandInput');
          const command = input.value.trim();
          if (!command) return;
          switchDashboardToTerminal();
          await ipcRenderer.invoke('execute-command', command, developmentFolder, 'dashboard');
          input.value = '';
        }

        function clearGlobalTerminal() {
          const el = document.getElementById('globalTerminal');
          if (el) el.textContent = '';
        }

        function projectDomId(projectName) {
          const map = {
            'Root Record Business Manager': 'business-manager',
            'Root Record Energy Manager': 'energy-manager',
            'Root Record Homestead Manager': 'homestead-manager',
            'Root Record Weather Manager': 'weather-manager',
            'public cloudflare website pages': 'website'
          };
          return map[projectName] || projectName.replace(/\\s+/g, '-').toLowerCase();
        }

        async function executeProjectCommand(projectName, commandOverride) {
          if (!ipcRenderer) return;
          const prefix = projectDomId(projectName);
          const inputId = prefix + '-command';
          const input = document.getElementById(inputId);
          const command = commandOverride ? String(commandOverride).trim() : input.value.trim();
          if (!command) return;
          switchProjectToTerminal(prefix);
          const projectPath = developmentFolder + '/' + projectName;
          await ipcRenderer.invoke('execute-command', command, projectPath, prefix);
          if (input && !commandOverride) input.value = '';
        }

        function clearProjectTerminal(projectId) {
          const el = document.getElementById(projectId + '-terminal');
          if (el) el.textContent = '';
        }

        async function runPythonApp(projectName) {
          if (!ipcRenderer) return;
          const projectPath = developmentFolder + '/' + projectName;
          const result = await ipcRenderer.invoke('run-python-app', projectPath);
          alert(result);
        }

        async function buildMSIX(projectName) {
          if (!ipcRenderer) return;
          const slug = projectDomId(projectName);
          switchProjectToTerminal(slug);
          const projectPath = developmentFolder + '/' + projectName;
          const result = await ipcRenderer.invoke('build-msix', projectPath, slug);
          alert(result);
        }

        async function buildInstaller(projectName) {
          if (!ipcRenderer) return;
          const slug = projectDomId(projectName);
          switchProjectToTerminal(slug);
          const projectPath = developmentFolder + '/' + projectName;
          const result = await ipcRenderer.invoke('build-installer', projectPath, slug);
          alert(result);
        }

        async function signedFullBuild(projectDirName) {
          if (!ipcRenderer) return;
          const slug = projectDomId(projectDirName);
          switchProjectToTerminal(slug);
          await ipcRenderer.invoke('signed-full-build', projectDirName);
        }

        async function unsignedFullBuild(projectDirName) {
          if (!ipcRenderer) return;
          const slug = projectDomId(projectDirName);
          switchProjectToTerminal(slug);
          await ipcRenderer.invoke('unsigned-full-build', projectDirName);
        }

        async function gitStatus(projectName) {
          if (!ipcRenderer) return;
          const projectPath = developmentFolder + '/' + projectName;
          const status = await ipcRenderer.invoke('git-status', projectPath);
          const statusId = projectDomId(projectName) + '-git-status';
          const statusDiv = document.getElementById(statusId);
          if (!statusDiv) return;

          if (status.clean) {
            statusDiv.innerHTML = '<div class="status clean">✓ Git status: Clean</div>';
          } else {
            statusDiv.innerHTML = '<div class="status dirty">⚠ Git status: Dirty - ' + status.files.length + ' files changed</div>';
          }
        }

        async function gitPush(projectName) {
          if (!ipcRenderer) return;
          const slug = projectDomId(projectName);
          switchProjectToTerminal(slug);
          const projectPath = developmentFolder + '/' + projectName;
          const result = await ipcRenderer.invoke('git-push', projectPath, slug);
          alert(result);
        }

        async function gitPull(projectName) {
          if (!ipcRenderer) return;
          const slug = projectDomId(projectName);
          switchProjectToTerminal(slug);
          const projectPath = developmentFolder + '/' + projectName;
          const result = await ipcRenderer.invoke('git-pull', projectPath, slug);
          alert(result);
        }

        async function openWebsite() {
          if (!ipcRenderer) return;
          const result = await ipcRenderer.invoke('open-website');
          alert(result);
        }

        async function deployWebsite() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('website');
          const result = await ipcRenderer.invoke('deploy-website');
          alert(result);
        }

        async function serveWebsite() {
          if (!ipcRenderer) return;
          const result = await ipcRenderer.invoke('serve-website');
          alert(result);
        }

        async function editIndex() {
          if (!ipcRenderer) return;
          const result = await ipcRenderer.invoke('edit-index');
          alert(result);
        }

        async function editStyles() {
          if (!ipcRenderer) return;
          const result = await ipcRenderer.invoke('edit-styles');
          alert(result);
        }

        async function buildAllProjects() {
          if (!ipcRenderer) return;
          switchDashboardToTerminal();
          const result = await ipcRenderer.invoke('build-all-projects');
          alert(result);
        }

        async function runAllProjects() {
          if (!ipcRenderer) return;
          const result = await ipcRenderer.invoke('run-all-projects');
          alert(result);
        }

        async function gitStatusAll() {
          if (!ipcRenderer) return;
          switchDashboardToTerminal();
          const result = await ipcRenderer.invoke('git-status-all');
          alert(result);
        }

        async function loadMachineSettings() {
          if (!ipcRenderer) return;
          try {
            const on = await ipcRenderer.invoke('get-open-at-login');
            const cb = document.getElementById('openAtLoginCb');
            if (cb) cb.checked = Boolean(on);
          } catch (e) {
            /* ignore */
          }
        }

        async function toggleOpenAtLogin() {
          if (!ipcRenderer) return;
          const cb = document.getElementById('openAtLoginCb');
          if (!cb) return;
          await ipcRenderer.invoke('set-open-at-login', cb.checked);
        }

        function opsProfileFromForm() {
          return {
            nodeName: (document.getElementById('ops-node-name') || {}).value || '',
            dbPort: Number((document.getElementById('ops-db-local-port') || {}).value || 3306),
            tunnelToken: (document.getElementById('ops-cf-token') || {}).value || '',
            dbHost: (document.getElementById('ops-db-host') || {}).value || '',
            dbUser: (document.getElementById('ops-db-user') || {}).value || '',
            dbPassword: (document.getElementById('ops-db-password') || {}).value || '',
            dbName: (document.getElementById('ops-db-name') || {}).value || '',
            publicDbHost: (document.getElementById('ops-db-public-host') || {}).value || '',
            installRoot: (document.getElementById('ops-install-root') || {}).value || '',
            rootFolder: (document.getElementById('ops-root-folder') || {}).value || '',
            dbDataDir: (document.getElementById('ops-db-data-dir') || {}).value || '',
            websiteDir: (document.getElementById('ops-website-dir') || {}).value || '',
            updateRepo: (document.getElementById('ops-update-repo') || {}).value || '',
            updateToken: (document.getElementById('ops-update-token') || {}).value || '',
          };
        }

        function setOpsStatus(text, isError) {
          const status = document.getElementById('ops-status');
          if (!status) return;
          status.textContent = text;
          status.style.color = isError ? '#f28b82' : '#9cdcfe';
        }

        async function loadOpsRemoteProfile() {
          if (!ipcRenderer) return;
          const cfg = await ipcRenderer.invoke('ops-get-remote-profile');
          if (!cfg) return;
          const nodeEl = document.getElementById('ops-node-name');
          const dbPortEl = document.getElementById('ops-db-local-port');
          const tokenEl = document.getElementById('ops-cf-token');
          const dbHostEl = document.getElementById('ops-db-host');
          const dbUserEl = document.getElementById('ops-db-user');
          const dbPassEl = document.getElementById('ops-db-password');
          const dbNameEl = document.getElementById('ops-db-name');
          const publicHostEl = document.getElementById('ops-db-public-host');
          const installRootEl = document.getElementById('ops-install-root');
          const rootFolderEl = document.getElementById('ops-root-folder');
          const dbDataDirEl = document.getElementById('ops-db-data-dir');
          const websiteDirEl = document.getElementById('ops-website-dir');
          const updateRepoEl = document.getElementById('ops-update-repo');
          const updateTokenEl = document.getElementById('ops-update-token');
          if (nodeEl) nodeEl.value = cfg.nodeName || '';
          if (dbPortEl) dbPortEl.value = String(cfg.dbPort || 3306);
          if (tokenEl) tokenEl.value = cfg.tunnelToken || '';
          if (dbHostEl) dbHostEl.value = cfg.dbHost || '127.0.0.1';
          if (dbUserEl) dbUserEl.value = cfg.dbUser || '';
          if (dbPassEl) dbPassEl.value = cfg.dbPassword || '';
          if (dbNameEl) dbNameEl.value = cfg.dbName || '';
          if (publicHostEl) publicHostEl.value = cfg.publicDbHost || '';
          if (installRootEl) installRootEl.value = cfg.installRoot || 'E:\\';
          if (rootFolderEl) rootFolderEl.value = cfg.rootFolder || 'E:\\rootrecord';
          if (dbDataDirEl) dbDataDirEl.value = cfg.dbDataDir || 'E:\\database';
          if (websiteDirEl) websiteDirEl.value = cfg.websiteDir || 'E:\\website';
          if (updateRepoEl) updateRepoEl.value = cfg.updateRepo || '';
          if (updateTokenEl) updateTokenEl.value = cfg.updateToken || '';
        }

        async function saveOpsRemoteProfile() {
          if (!ipcRenderer) return;
          const result = await ipcRenderer.invoke('ops-save-remote-profile', opsProfileFromForm());
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Save failed.', true);
            return;
          }
          setOpsStatus('Saved remote profile.', false);
        }

        async function applyServerDbSettingsToMySqlPage() {
          if (!ipcRenderer) return;
          const cfg = await ipcRenderer.invoke('ops-get-remote-profile');
          if (!cfg) return;
          const hostEl = document.getElementById('mysql-host');
          const portEl = document.getElementById('mysql-port');
          const userEl = document.getElementById('mysql-user');
          const passwordEl = document.getElementById('mysql-password');
          const databaseEl = document.getElementById('mysql-database');
          if (hostEl) hostEl.value = cfg.dbHost || '127.0.0.1';
          if (portEl) portEl.value = String(cfg.dbPort || 3306);
          if (userEl) userEl.value = cfg.dbUser || '';
          if (passwordEl) passwordEl.value = cfg.dbPassword || '';
          if (databaseEl) databaseEl.value = cfg.dbName || '';
          setMySqlStatus('Applied DB login from server profile.', false);
        }

        async function testOpsRemoteConnection() {
          if (!ipcRenderer) return;
          setOpsStatus('Checking local server health...', false);
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-test-remote-connection');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Health check failed.', true);
            return;
          }
          setOpsStatus('Server health check completed.', false);
        }

        async function installOpsRemoteDependencies() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          setOpsStatus('Installing dependencies on this server...', false);
          const result = await ipcRenderer.invoke('ops-install-remote-dependencies');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Dependency install failed.', true);
            return;
          }
          setOpsStatus('Dependency install completed.', false);
        }

        async function checkOpsRemoteDependencies() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-check-remote-dependencies');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Dependency check failed.', true);
            return;
          }
          setOpsStatus('Dependency check completed.', false);
        }

        async function executeOpsRemoteCommand() {
          if (!ipcRenderer) return;
          const input = document.getElementById('operations-hub-command');
          const command = input && input.value ? input.value.trim() : '';
          if (!command) return;
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-execute-remote-command', command);
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Remote command failed.', true);
            return;
          }
          if (input) input.value = '';
        }

        async function startOpsTunnel() {
          if (!ipcRenderer) return;
          const tokenEl = document.getElementById('ops-cf-token');
          const portEl = document.getElementById('ops-db-local-port');
          const token = tokenEl && tokenEl.value ? tokenEl.value.trim() : '';
          const dbPort = Number(portEl && portEl.value ? portEl.value : 3306);
          if (!token) {
            setOpsStatus('Tunnel token is required.', true);
            return;
          }
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-start-tunnel', { token, dbPort });
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Tunnel start failed.', true);
            return;
          }
          setOpsStatus('Tunnel start command sent to local server.', false);
        }

        async function stopOpsTunnel() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-stop-tunnel');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Tunnel stop failed.', true);
            return;
          }
          setOpsStatus('Tunnel stop command sent.', false);
        }

        async function installOpsServices() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          setOpsStatus('Installing/repairing service registrations...', false);
          const result = await ipcRenderer.invoke('ops-install-services');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Service install failed.', true);
            return;
          }
          setOpsStatus('Service registration completed.', false);
        }

        async function checkOpsServices() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-check-services');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Service check failed.', true);
            return;
          }
          setOpsStatus('Service status check completed.', false);
        }

        async function startOpsServices() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-start-services');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Start services failed.', true);
            return;
          }
          setOpsStatus('Start services command sent.', false);
        }

        async function stopOpsServices() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-stop-services');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Stop services failed.', true);
            return;
          }
          setOpsStatus('Stop services command sent.', false);
        }

        async function ensureOpsFolders() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-ensure-folders');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Folder setup failed.', true);
            return;
          }
          setOpsStatus('Root/website folders verified.', false);
        }

        async function openOpsWebsiteFolder() {
          if (!ipcRenderer) return;
          const result = await ipcRenderer.invoke('ops-open-website-folder');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Open website folder failed.', true);
            return;
          }
          setOpsStatus('Website folder opened.', false);
        }

        async function deployOpsWebsite() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          const result = await ipcRenderer.invoke('ops-deploy-website-folder');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Website deploy failed.', true);
            return;
          }
          setOpsStatus('Website deploy completed.', false);
        }

        async function checkDeveloperPanelUpdate() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          setOpsStatus('Checking latest GitHub release...', false);
          const result = await ipcRenderer.invoke('ops-check-app-update');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Update check failed.', true);
            return;
          }
          if (result.updateAvailable) {
            setOpsStatus('Update available: ' + result.currentVersion + ' -> ' + result.latestVersion, false);
          } else {
            setOpsStatus('Already up to date (' + result.currentVersion + ').', false);
          }
        }

        async function applyDeveloperPanelUpdate() {
          if (!ipcRenderer) return;
          switchProjectToTerminal('operations-hub');
          setOpsStatus('Downloading and applying latest release installer...', false);
          const result = await ipcRenderer.invoke('ops-apply-app-update');
          if (!result || !result.ok) {
            setOpsStatus(result && result.error ? result.error : 'Install failed.', true);
            return;
          }
          setOpsStatus('Installer launched. Follow installer prompts, then restart app.', false);
        }

        // Inline onclick/onchange handlers resolve on the window object; with nodeIntegration + data: URL they
        // often do not see top-level function bindings unless we attach explicitly.
        if (typeof window !== 'undefined') {
          Object.assign(window, {
            showPage,
            showTab,
            showProjectTab,
            toggleOpenAtLogin,
            buildAllProjects,
            runAllProjects,
            gitStatusAll,
            executeGlobalCommand,
            clearGlobalTerminal,
            runPythonApp,
            buildMSIX,
            buildInstaller,
            signedFullBuild,
            unsignedFullBuild,
            gitStatus,
            gitPush,
            gitPull,
            executeProjectCommand,
            clearProjectTerminal,
            bumpVersionForSlug,
            pickBuildAssetField,
            saveRootRecordBuildSettings,
            openWebsite,
            deployWebsite,
            serveWebsite,
            editIndex,
            editStyles,
            loadOpsRemoteProfile,
            saveOpsRemoteProfile,
            testOpsRemoteConnection,
            installOpsRemoteDependencies,
            checkOpsRemoteDependencies,
            executeOpsRemoteCommand,
            startOpsTunnel,
            stopOpsTunnel,
            installOpsServices,
            checkOpsServices,
            startOpsServices,
            stopOpsServices,
            ensureOpsFolders,
            openOpsWebsiteFolder,
            deployOpsWebsite,
            checkDeveloperPanelUpdate,
            applyDeveloperPanelUpdate,
            applyServerDbSettingsToMySqlPage,
            loadMySqlLocalConfig,
            connectMySqlLocal,
            loadMySqlTables,
            loadMySqlTableData,
            addMySqlRow,
            onMySqlCellInput,
            saveMySqlRow,
            deleteMySqlRow,
            saveAllMySqlRows,
          });
        }

        // Use delegated listeners for navigation so we do not depend on inline onclick
        // in the data: URL document.
        document.addEventListener('click', (e) => {
          const target = e.target && e.target.closest ? e.target.closest('[data-page-target]') : null;
          if (!target) return;
          const pageId = target.getAttribute('data-page-target');
          if (!pageId) return;
          showPage(pageId);
        });

        // Global terminal input handler
        const globalCommandInput = document.getElementById('globalCommandInput');
        if (globalCommandInput) {
          globalCommandInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
              executeGlobalCommand();
            }
          });
        }

        // Project terminal input handlers
        ['business-manager', 'energy-manager', 'homestead-manager', 'weather-manager', 'website', 'mysql-local'].forEach(projectId => {
          const inputId = projectId + '-command';
          const input = document.getElementById(inputId);
          if (input) {
            input.addEventListener('keypress', function(e) {
              if (e.key === 'Enter') {
                const projectName = projectId === 'business-manager' ? 'Root Record Business Manager' :
                                  projectId === 'energy-manager' ? 'Root Record Energy Manager' :
                                  projectId === 'homestead-manager' ? 'Root Record Homestead Manager' :
                                  projectId === 'weather-manager' ? 'Root Record Weather Manager' :
                                  'public cloudflare website pages';
                executeProjectCommand(projectName);
              }
            });
          }
        });

        const opsCommandInput = document.getElementById('operations-hub-command');
        if (opsCommandInput) {
          opsCommandInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
              executeOpsRemoteCommand();
            }
          });
        }

        loadProjects();
        loadMachineSettings();
        loadOpsRemoteProfile();
        loadMySqlLocalConfig();
      </script>
    </body>
    </html>
  `));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  applyOpenAtLoginSetting();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

const TERMINAL_STREAM = 'terminal-stream';

/** True if `dir` looks like a Root Record Python app repo root (handles duplicate nested folder). */
function isPythonAppRoot(dir) {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
    const markers = [
      'desktop_app.py',
      'ui_main.py',
      'build_rootrecord.spec',
      path.join('build', 'build_rootrecord.bat'),
      path.join('build', 'build_windows.ps1'),
    ];
    return markers.some((rel) => fs.existsSync(path.join(dir, rel)));
  } catch {
    return false;
  }
}

/** Prefer this over loose markers: wrappers may contain only `build/` debris, not the real app. */
function hasPythonEntry(dir) {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
    return (
      fs.existsSync(path.join(dir, 'desktop_app.py')) ||
      fs.existsSync(path.join(dir, 'ui_main.py'))
    );
  } catch {
    return false;
  }
}

/**
 * `join(developmentRoot, dirName)` may be a wrapper; real tree can be
 * `.../Root Record Business Manager/Root Record Business Manager/`.
 */
function resolvePythonProjectRoot(developmentRoot, dirName) {
  const direct = path.join(developmentRoot, dirName);
  const nested = path.join(direct, dirName);
  const directEntry = hasPythonEntry(direct);
  const nestedEntry = hasPythonEntry(nested);
  if (directEntry && !nestedEntry) return direct;
  if (nestedEntry && !directEntry) return nested;
  if (directEntry && nestedEntry) return direct;
  if (isPythonAppRoot(direct)) return direct;
  if (isPythonAppRoot(nested)) return nested;
  return direct;
}

/** Renderer passes `join(developmentRoot, name)`; normalize when backup uses nested duplicate. */
function normalizePythonProjectPath(projectPath) {
  const resolved = path.resolve(projectPath);
  const base = path.basename(resolved);
  const nested = path.join(resolved, base);
  const directEntry = hasPythonEntry(resolved);
  const nestedEntry = hasPythonEntry(nested);
  if (directEntry && !nestedEntry) return resolved;
  if (nestedEntry && !directEntry) return nested;
  if (directEntry && nestedEntry) return resolved;
  if (isPythonAppRoot(resolved)) return resolved;
  if (isPythonAppRoot(nested)) return nested;
  return resolved;
}

const PROJECT_SLUGS = {
  'Root Record Business Manager': 'business-manager',
  'Root Record Energy Manager': 'energy-manager',
  'Root Record Homestead Manager': 'homestead-manager',
  'Root Record Weather Manager': 'weather-manager',
  'public cloudflare website pages': 'website',
};

function projectSlugFromDirName(dirName) {
  return PROJECT_SLUGS[dirName] || String(dirName).replace(/\s+/g, '-').toLowerCase();
}

function projectSlugFromPath(projectPath) {
  return projectSlugFromDirName(path.basename(projectPath));
}

function sendTerminalChunk(sender, projectId, text) {
  try {
    if (sender.isDestroyed()) return;
    sender.send(TERMINAL_STREAM, { projectId, text });
  } catch {
    /* ignore */
  }
}

/** electron-store key; per-slug object: version, iconSrc, aboutSrc, wizardLargeSrc, wizardSmallSrc */
const RR_BUILD_SETTINGS_KEY = 'buildSettingsRootRecord';
const MYSQL_SETTINGS_KEY = 'mysqlLocalSettings';
const OPS_REMOTE_PROFILE_KEY = 'operationsHub.serverProfile';
const SERVER_ENV_PATH = 'C:\\Users\\rrdeveloper\\.cursor\\.env';

function isRootRecordSavedSettingsSlug(slug) {
  return slug === 'business-manager' || slug === 'homestead-manager';
}

/** Directory containing build_rootrecord.spec (inner Python package). */
function getRootRecordInnerRoot(projectPath) {
  const p = path.resolve(projectPath);
  if (fs.existsSync(path.join(p, 'build_rootrecord.spec'))) return p;
  const base = path.basename(p);
  const nested = path.join(p, base);
  if (fs.existsSync(path.join(nested, 'build_rootrecord.spec'))) return nested;
  return null;
}

function readAppVersionFromDisk(innerRoot) {
  const fp = path.join(innerRoot, 'app_version.py');
  if (!fs.existsSync(fp)) return '';
  const text = fs.readFileSync(fp, 'utf8');
  const m = text.match(/^\s*APP_VERSION\s*=\s*"([^"]*)"/m);
  return m ? m[1] : '';
}

function patchAppVersionFile(innerRoot, version) {
  const fp = path.join(innerRoot, 'app_version.py');
  if (!fs.existsSync(fp)) throw new Error('Missing app_version.py');
  const text = fs.readFileSync(fp, 'utf8');
  const next = text.replace(/^(\s*APP_VERSION\s*=\s*)"[^"]*"/m, `$1"${version}"`);
  if (next === text) throw new Error('Could not patch APP_VERSION in app_version.py');
  fs.writeFileSync(fp, next, 'utf8');
}

function patchInnoMyAppVersion(innerRoot, version) {
  const fp = path.join(innerRoot, 'build', 'rootrecord.iss');
  if (!fs.existsSync(fp)) throw new Error('Missing build/rootrecord.iss');
  const text = fs.readFileSync(fp, 'utf8');
  const next = text.replace(/^(#define\s+MyAppVersion\s+)"[^"]*"/m, `$1"${version}"`);
  if (next === text) throw new Error('Could not patch #define MyAppVersion in rootrecord.iss');
  fs.writeFileSync(fp, next, 'utf8');
}

function safeCopyFile(src, dest) {
  if (!src || !fs.existsSync(src)) throw new Error(`Source file missing: ${src}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * Copy assets and patch version from saved panel settings into the repo tree.
 * @returns {{ ok: boolean, skipped?: boolean, errors?: string[], message?: string }}
 */
function applyRootRecordSavedSettingsToDisk(sender, projectPath, slug, saved) {
  if (!isRootRecordSavedSettingsSlug(slug)) {
    return { ok: true, skipped: true, message: '' };
  }
  const proj = normalizePythonProjectPath(projectPath);
  const inner = getRootRecordInnerRoot(proj);
  if (!inner) {
    const msg = '[Build Settings] No inner package (build_rootrecord.spec) found; skip apply.\n';
    if (sender) sendTerminalChunk(sender, slug, msg);
    return { ok: false, errors: ['No inner package root'], message: msg };
  }
  if (!saved || typeof saved !== 'object') {
    const msg = '[Build Settings] Nothing saved for this project in Developer Panel; skip apply.\n';
    if (sender) sendTerminalChunk(sender, slug, msg);
    return { ok: true, skipped: true, message: msg };
  }
  const lines = [];
  try {
    if (saved.iconSrc && String(saved.iconSrc).trim()) {
      safeCopyFile(String(saved.iconSrc).trim(), path.join(inner, 'favicon.ico'));
      lines.push('favicon.ico');
    }
    if (saved.aboutSrc && String(saved.aboutSrc).trim()) {
      const ap = String(saved.aboutSrc).trim();
      const ext = path.extname(ap).toLowerCase();
      if (ext === '.png') {
        safeCopyFile(ap, path.join(inner, 'assets', 'about_panel_default.png'));
        lines.push('assets/about_panel_default.png');
      } else if (ext === '.jpg' || ext === '.jpeg') {
        safeCopyFile(ap, path.join(inner, 'about_page_graphic.jpg'));
        lines.push('about_page_graphic.jpg');
      } else {
        throw new Error('About image must be .png, .jpg, or .jpeg');
      }
    }
    if (saved.wizardLargeSrc && String(saved.wizardLargeSrc).trim()) {
      const w = String(saved.wizardLargeSrc).trim();
      if (path.extname(w).toLowerCase() !== '.bmp') throw new Error('Wizard sidebar must be .bmp');
      safeCopyFile(w, path.join(inner, 'build', 'branding', 'wizard-large.bmp'));
      lines.push('build/branding/wizard-large.bmp');
    }
    if (saved.wizardSmallSrc && String(saved.wizardSmallSrc).trim()) {
      const w = String(saved.wizardSmallSrc).trim();
      if (path.extname(w).toLowerCase() !== '.bmp') throw new Error('Wizard header must be .bmp');
      safeCopyFile(w, path.join(inner, 'build', 'branding', 'wizard-small.bmp'));
      lines.push('build/branding/wizard-small.bmp');
    }
    if (saved.version && String(saved.version).trim()) {
      const v = String(saved.version).trim();
      if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(v)) throw new Error('Invalid version format in saved settings');
      patchAppVersionFile(inner, v);
      patchInnoMyAppVersion(inner, v);
      lines.push('app_version.py', 'build/rootrecord.iss');
    }
    const msg =
      lines.length > 0
        ? `[Build Settings] Applied to disk (${inner}): ${lines.join(', ')}\n`
        : `[Build Settings] Nothing to apply (no paths/version in saved settings).\n`;
    if (sender) sendTerminalChunk(sender, slug, msg);
    return { ok: true, skipped: false, message: msg };
  } catch (e) {
    const msg = `[Build Settings] Apply failed: ${e.message}\n`;
    if (sender) sendTerminalChunk(sender, slug, msg);
    return { ok: false, errors: [e.message], message: msg };
  }
}

function maybeApplyRootRecordBuildSettings(sender, projectPath, slug) {
  const saved = store.get(`${RR_BUILD_SETTINGS_KEY}.${slug}`, {});
  return applyRootRecordSavedSettingsToDisk(sender, projectPath, slug, saved);
}

function normalizeMySqlConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  return {
    host: String(cfg.host || '127.0.0.1').trim() || '127.0.0.1',
    port: Number.isFinite(Number(cfg.port)) ? Number(cfg.port) : 3306,
    user: String(cfg.user || '').trim(),
    password: String(cfg.password || ''),
    database: String(cfg.database || '').trim(),
  };
}

function ensureSafeIdentifier(name) {
  const id = String(name || '').trim();
  if (!/^[A-Za-z0-9_]+$/.test(id)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return '`' + id + '`';
}

async function withMySqlConnection(handler) {
  const cfg = normalizeMySqlConfig(store.get(MYSQL_SETTINGS_KEY, {}));
  if (!cfg.user || !cfg.database) {
    throw new Error('MySQL config is incomplete. Set user and database first.');
  }
  const connection = await mysql.createConnection(cfg);
  try {
    return await handler(connection, cfg);
  } finally {
    await connection.end();
  }
}

function normalizeOpsRemoteProfile(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    nodeName: String(p.nodeName || '').trim(),
    dbPort: Number.isFinite(Number(p.dbPort)) ? Number(p.dbPort) : 3306,
    tunnelToken: String(p.tunnelToken || '').trim(),
    dbHost: String(p.dbHost || '127.0.0.1').trim() || '127.0.0.1',
    dbUser: String(p.dbUser || '').trim(),
    dbPassword: String(p.dbPassword || ''),
    dbName: String(p.dbName || '').trim(),
    publicDbHost: String(p.publicDbHost || '').trim(),
    installRoot: String(p.installRoot || 'E:\\').trim() || 'E:\\',
    rootFolder: String(p.rootFolder || 'E:\\rootrecord').trim() || 'E:\\rootrecord',
    dbDataDir: String(p.dbDataDir || 'E:\\database').trim() || 'E:\\database',
    websiteDir: String(p.websiteDir || 'E:\\website').trim() || 'E:\\website',
    updateRepo: String(p.updateRepo || '').trim(),
    updateToken: String(p.updateToken || ''),
  };
}

function ensureOpsProfileReady(profile) {
  if (!profile.nodeName) {
    throw new Error('Operations Hub profile needs a node name.');
  }
}

function parseEnvText(text) {
  const out = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const rawVal = line.slice(idx + 1);
    let val = rawVal.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function stringifyEnvValue(value) {
  const v = String(value == null ? '' : value);
  if (v === '') return '';
  if (/\s|#|=|"/.test(v)) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return v;
}

function loadServerEnvMap() {
  try {
    if (!fs.existsSync(SERVER_ENV_PATH)) return {};
    const text = fs.readFileSync(SERVER_ENV_PATH, 'utf8');
    return parseEnvText(text);
  } catch {
    return {};
  }
}

function readOpsProfileFromEnv() {
  const env = loadServerEnvMap();
  return normalizeOpsRemoteProfile({
    nodeName: env.ROOTRECORD_NODE_NAME || '',
    dbHost: env.ROOTRECORD_DB_HOST || '127.0.0.1',
    dbPort: env.ROOTRECORD_DB_PORT || 3306,
    dbUser: env.ROOTRECORD_DB_USER || '',
    dbPassword: env.ROOTRECORD_DB_PASSWORD || '',
    dbName: env.ROOTRECORD_DB_NAME || '',
    publicDbHost: env.ROOTRECORD_DB_PUBLIC_HOST || '',
    tunnelToken: env.ROOTRECORD_CLOUDFLARED_TOKEN || '',
    installRoot: env.ROOTRECORD_INSTALL_ROOT || 'E:\\',
    rootFolder: env.ROOTRECORD_ROOT_FOLDER || 'E:\\rootrecord',
    dbDataDir: env.ROOTRECORD_DB_DATA_DIR || env.MYSQL_DATADIR || 'E:\\database',
    websiteDir: env.ROOTRECORD_WEBSITE_DIR || 'E:\\website',
    updateRepo: env.ROOTRECORD_UPDATE_REPO || '',
    updateToken: env.ROOTRECORD_GITHUB_TOKEN || '',
  });
}

function writeOpsProfileToEnv(profile) {
  const existing = loadServerEnvMap();
  const next = {
    ...existing,
    ROOTRECORD_NODE_NAME: String(profile.nodeName || ''),
    ROOTRECORD_DB_HOST: String(profile.dbHost || '127.0.0.1'),
    ROOTRECORD_DB_PORT: String(profile.dbPort || 3306),
    ROOTRECORD_DB_USER: String(profile.dbUser || ''),
    ROOTRECORD_DB_PASSWORD: String(profile.dbPassword || ''),
    ROOTRECORD_DB_NAME: String(profile.dbName || ''),
    ROOTRECORD_DB_PUBLIC_HOST: String(profile.publicDbHost || ''),
    ROOTRECORD_CLOUDFLARED_TOKEN: String(profile.tunnelToken || ''),
    ROOTRECORD_INSTALL_ROOT: String(profile.installRoot || 'E:\\'),
    ROOTRECORD_ROOT_FOLDER: String(profile.rootFolder || 'E:\\rootrecord'),
    ROOTRECORD_DB_DATA_DIR: String(profile.dbDataDir || 'E:\\database'),
    ROOTRECORD_WEBSITE_DIR: String(profile.websiteDir || 'E:\\website'),
    ROOTRECORD_UPDATE_REPO: String(profile.updateRepo || ''),
    ROOTRECORD_GITHUB_TOKEN: String(profile.updateToken || ''),
  };

  const lines = [];
  lines.push('# Root Record server connectivity settings');
  lines.push(`ROOTRECORD_NODE_NAME=${stringifyEnvValue(next.ROOTRECORD_NODE_NAME)}`);
  lines.push(`ROOTRECORD_DB_HOST=${stringifyEnvValue(next.ROOTRECORD_DB_HOST)}`);
  lines.push(`ROOTRECORD_DB_PORT=${stringifyEnvValue(next.ROOTRECORD_DB_PORT)}`);
  lines.push(`ROOTRECORD_DB_USER=${stringifyEnvValue(next.ROOTRECORD_DB_USER)}`);
  lines.push(`ROOTRECORD_DB_PASSWORD=${stringifyEnvValue(next.ROOTRECORD_DB_PASSWORD)}`);
  lines.push(`ROOTRECORD_DB_NAME=${stringifyEnvValue(next.ROOTRECORD_DB_NAME)}`);
  lines.push(`ROOTRECORD_DB_PUBLIC_HOST=${stringifyEnvValue(next.ROOTRECORD_DB_PUBLIC_HOST)}`);
  lines.push(`ROOTRECORD_CLOUDFLARED_TOKEN=${stringifyEnvValue(next.ROOTRECORD_CLOUDFLARED_TOKEN)}`);
  lines.push(`ROOTRECORD_INSTALL_ROOT=${stringifyEnvValue(next.ROOTRECORD_INSTALL_ROOT)}`);
  lines.push(`ROOTRECORD_ROOT_FOLDER=${stringifyEnvValue(next.ROOTRECORD_ROOT_FOLDER)}`);
  lines.push(`ROOTRECORD_DB_DATA_DIR=${stringifyEnvValue(next.ROOTRECORD_DB_DATA_DIR)}`);
  lines.push(`ROOTRECORD_WEBSITE_DIR=${stringifyEnvValue(next.ROOTRECORD_WEBSITE_DIR)}`);
  lines.push(`ROOTRECORD_UPDATE_REPO=${stringifyEnvValue(next.ROOTRECORD_UPDATE_REPO)}`);
  lines.push(`ROOTRECORD_GITHUB_TOKEN=${stringifyEnvValue(next.ROOTRECORD_GITHUB_TOKEN)}`);
    if (next.MYSQL_DATADIR == null || String(next.MYSQL_DATADIR).trim() === '') {
      next.MYSQL_DATADIR = String(profile.dbDataDir || 'E:\\database');
      lines.push(`MYSQL_DATADIR=${stringifyEnvValue(next.MYSQL_DATADIR)}`);
    }
  lines.push('');

  const temp = `${SERVER_ENV_PATH}.tmp`;
  fs.mkdirSync(path.dirname(SERVER_ENV_PATH), { recursive: true });
  fs.writeFileSync(temp, `${lines.join('\n')}`, 'utf8');
  fs.renameSync(temp, SERVER_ENV_PATH);
}

function runLocalOpsCommand(sender, command, banner) {
  const child = spawn(command, [], { stdio: 'pipe', shell: true });
  return streamChildToTerminal(sender, 'operations-hub', child, banner || null);
}

function parseVersionParts(v) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n));
}

function isVersionGreater(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const n = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < n; i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

function githubApiRequest(pathname, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'RootRecordDeveloperPanel-Updater',
        Accept: 'application/vnd.github+json',
      },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid GitHub response: ${e.message}`));
          }
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url, token, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    const options = {
      headers: {
        'User-Agent': 'RootRecordDeveloperPanel-Updater',
        Accept: 'application/octet-stream',
      },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;
    https
      .get(url, options, (res) => {
        if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          file.close();
          return downloadFile(res.headers.location, token, outputPath).then(resolve).catch(reject);
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          file.close();
          return reject(new Error(`Download failed: ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve(outputPath));
        });
      })
      .on('error', (err) => {
        file.close();
        reject(err);
      });
  });
}

async function getLatestGithubRelease(profile) {
  if (!profile.updateRepo || !profile.updateRepo.includes('/')) {
    throw new Error('Update repo missing. Set GitHub Repo as owner/name.');
  }
  if (!profile.updateToken) {
    throw new Error('GitHub token missing for private release access.');
  }
  const [owner, repo] = profile.updateRepo.split('/');
  const release = await githubApiRequest(`/repos/${owner}/${repo}/releases/latest`, profile.updateToken);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const installer = assets.find((a) => /setup\.exe$/i.test(String(a.name || '')));
  if (!installer || !installer.browser_download_url) {
    throw new Error('No Setup.exe asset found in latest release.');
  }
  return {
    tag: String(release.tag_name || ''),
    name: String(release.name || ''),
    installerUrl: installer.browser_download_url,
    installerName: String(installer.name || 'RootRecordDeveloperPanelSetup.exe'),
  };
}

/** Pipe stdout/stderr to renderer; optional banner first (child already spawned). */
function streamChildToTerminal(sender, projectId, child, banner) {
  if (banner) sendTerminalChunk(sender, projectId, banner);
  child.stdout.on('data', (d) => sendTerminalChunk(sender, projectId, d.toString()));
  child.stderr.on('data', (d) => sendTerminalChunk(sender, projectId, d.toString()));
  return new Promise((resolve) => {
    child.on('error', (err) => {
      sendTerminalChunk(sender, projectId, `\n[spawn error] ${err.message}\n`);
      resolve({ code: -1, error: err.message });
    });
    child.on('close', (code) => {
      sendTerminalChunk(sender, projectId, `\n--- process exited with code ${code} ---\n`);
      resolve({ code: code ?? 0 });
    });
  });
}

// IPC handlers
ipcMain.handle('get-open-at-login', () => Boolean(store.get('openAtLogin', false)));

ipcMain.handle('set-open-at-login', (event, enabled) => {
  store.set('openAtLogin', Boolean(enabled));
  applyOpenAtLoginSetting();
  return { ok: true, openAtLogin: Boolean(store.get('openAtLogin')) };
});

ipcMain.handle('get-build-settings', async (event, projectDirName) => {
  const slug = projectSlugFromDirName(projectDirName);
  const projectPath = resolvePythonProjectRoot(developmentFolder, projectDirName);
  const inner = getRootRecordInnerRoot(normalizePythonProjectPath(projectPath));
  const saved = store.get(`${RR_BUILD_SETTINGS_KEY}.${slug}`, {});
  const diskVersion = inner ? readAppVersionFromDisk(inner) : '';
  return { innerRoot: inner, saved, diskVersion };
});

ipcMain.handle('save-build-settings', async (event, payload) => {
  const p = payload || {};
  const { projectDirName, version, iconSrc, aboutSrc, wizardLargeSrc, wizardSmallSrc } = p;
  const slug = projectSlugFromDirName(projectDirName || '');
  if (!isRootRecordSavedSettingsSlug(slug)) {
    return { ok: false, errors: ['Save only supports Root Record Business Manager and Homestead Manager.'] };
  }
  const ver = String(version || '').trim();
  if (!ver || !/^\d+\.\d+\.\d+(\.\d+)?$/.test(ver)) {
    return { ok: false, errors: ['Version is required (e.g. 1.3.50).'] };
  }
  const trimmed = {
    version: ver,
    iconSrc: String(iconSrc || '').trim(),
    aboutSrc: String(aboutSrc || '').trim(),
    wizardLargeSrc: String(wizardLargeSrc || '').trim(),
    wizardSmallSrc: String(wizardSmallSrc || '').trim(),
  };
  store.set(`${RR_BUILD_SETTINGS_KEY}.${slug}`, trimmed);
  const projectPath = resolvePythonProjectRoot(developmentFolder, projectDirName);
  const r = applyRootRecordSavedSettingsToDisk(event.sender, projectPath, slug, trimmed);
  return { ok: r.ok, errors: r.errors, message: r.ok ? 'Saved and applied to project files.' : undefined };
});

ipcMain.handle('pick-build-asset', async (event, opts) => {
  if (!mainWindow) return null;
  const filters = (opts && opts.filters) || [{ name: 'All Files', extensions: ['*'] }];
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Select file',
    properties: ['openFile'],
    filters,
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('mysql-get-config', async () => {
  const base = normalizeMySqlConfig(store.get(MYSQL_SETTINGS_KEY, {}));
  const ops = normalizeOpsRemoteProfile({
    ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
    ...readOpsProfileFromEnv(),
  });
  return {
    host: base.host || ops.dbHost || '127.0.0.1',
    port: base.port || ops.dbPort || 3306,
    user: base.user || ops.dbUser || '',
    password: base.password || ops.dbPassword || '',
    database: base.database || ops.dbName || '',
  };
});

ipcMain.handle('mysql-connect', async (event, config) => {
  try {
    const fallback = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    const raw = config || {};
    const cfg = normalizeMySqlConfig({
      host: raw.host || fallback.dbHost || '127.0.0.1',
      port: raw.port || fallback.dbPort || 3306,
      user: raw.user || fallback.dbUser || '',
      password: typeof raw.password === 'string' && raw.password.length > 0 ? raw.password : fallback.dbPassword || '',
      database: raw.database || fallback.dbName || '',
    });
    if (!cfg.user || !cfg.database) {
      return { ok: false, error: 'User and database are required.' };
    }
    const connection = await mysql.createConnection(cfg);
    await connection.query('SELECT 1');
    await connection.end();
    store.set(MYSQL_SETTINGS_KEY, cfg);
    const ops = normalizeOpsRemoteProfile(store.get(OPS_REMOTE_PROFILE_KEY, {}));
    const nextOps = {
      ...ops,
      dbHost: cfg.host,
      dbPort: cfg.port,
      dbUser: cfg.user,
      dbPassword: cfg.password,
      dbName: cfg.database,
    };
    store.set(OPS_REMOTE_PROFILE_KEY, nextOps);
    writeOpsProfileToEnv(nextOps);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('mysql-list-tables', async () => {
  try {
    return await withMySqlConnection(async (connection, cfg) => {
      const [rows] = await connection.query(
        `SELECT TABLE_NAME AS tableName
         FROM information_schema.tables
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [cfg.database]
      );
      return { ok: true, tables: rows.map((r) => r.tableName) };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('mysql-read-table', async (event, payload) => {
  try {
    const tableName = ensureSafeIdentifier(payload && payload.table);
    const limit = Math.max(1, Math.min(Number(payload && payload.limit) || 200, 1000));
    return await withMySqlConnection(async (connection, cfg) => {
      const rawTable = String(payload.table);
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, COLUMN_KEY AS columnKey, IS_NULLABLE AS isNullable
         FROM information_schema.columns
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [cfg.database, rawTable]
      );
      const primaryKeys = columns.filter((c) => c.columnKey === 'PRI').map((c) => c.name);
      const [rows] = await connection.query(`SELECT * FROM ${tableName} LIMIT ${limit}`);
      return { ok: true, columns, primaryKeys, rows };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('mysql-insert-row', async (event, payload) => {
  try {
    const tableName = ensureSafeIdentifier(payload && payload.table);
    const row = (payload && payload.row) || {};
    const columns = ((payload && payload.columns) || [])
      .map((c) => String(c.name))
      .filter((name) => Object.prototype.hasOwnProperty.call(row, name));
    if (!columns.length) return { ok: false, error: 'No values to insert.' };
    return await withMySqlConnection(async (connection) => {
      const quotedColumns = columns.map((name) => ensureSafeIdentifier(name));
      const values = columns.map((name) => {
        const v = row[name];
        return String(v).toUpperCase() === 'NULL' ? null : v;
      });
      const placeholders = columns.map(() => '?').join(', ');
      await connection.query(
        `INSERT INTO ${tableName} (${quotedColumns.join(', ')}) VALUES (${placeholders})`,
        values
      );
      return { ok: true };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('mysql-update-row', async (event, payload) => {
  try {
    const tableName = ensureSafeIdentifier(payload && payload.table);
    const row = (payload && payload.row) || {};
    const columns = ((payload && payload.columns) || []).map((c) => String(c.name));
    const primaryKeys = ((payload && payload.primaryKeys) || []).map((k) => String(k));
    const mutableColumns = columns.filter((name) => !primaryKeys.includes(name));
    if (!mutableColumns.length) return { ok: false, error: 'No mutable columns available for update.' };
    return await withMySqlConnection(async (connection) => {
      const setSql = mutableColumns.map((name) => `${ensureSafeIdentifier(name)} = ?`).join(', ');
      const setValues = mutableColumns.map((name) => (String(row[name]).toUpperCase() === 'NULL' ? null : row[name]));
      const whereColumns = primaryKeys.length ? primaryKeys : columns;
      const whereSql = whereColumns.map((name) => `${ensureSafeIdentifier(name)} <=> ?`).join(' AND ');
      const whereValues = whereColumns.map((name) => (String(row[name]).toUpperCase() === 'NULL' ? null : row[name]));
      const [result] = await connection.query(
        `UPDATE ${tableName} SET ${setSql} WHERE ${whereSql} LIMIT 1`,
        [...setValues, ...whereValues]
      );
      if (!result.affectedRows) return { ok: false, error: 'No matching row found to update.' };
      return { ok: true };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('mysql-delete-row', async (event, payload) => {
  try {
    const tableName = ensureSafeIdentifier(payload && payload.table);
    const row = (payload && payload.row) || {};
    const columns = ((payload && payload.columns) || []).map((c) => String(c.name));
    const primaryKeys = ((payload && payload.primaryKeys) || []).map((k) => String(k));
    return await withMySqlConnection(async (connection) => {
      const whereColumns = primaryKeys.length ? primaryKeys : columns;
      if (!whereColumns.length) return { ok: false, error: 'Cannot delete: table has no columns.' };
      const whereSql = whereColumns.map((name) => `${ensureSafeIdentifier(name)} <=> ?`).join(' AND ');
      const whereValues = whereColumns.map((name) => (String(row[name]).toUpperCase() === 'NULL' ? null : row[name]));
      const [result] = await connection.query(
        `DELETE FROM ${tableName} WHERE ${whereSql} LIMIT 1`,
        whereValues
      );
      if (!result.affectedRows) return { ok: false, error: 'No matching row found to delete.' };
      return { ok: true };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-get-remote-profile', async () => {
  const fromStore = normalizeOpsRemoteProfile(store.get(OPS_REMOTE_PROFILE_KEY, {}));
  const fromEnv = readOpsProfileFromEnv();
  return normalizeOpsRemoteProfile({
    ...fromStore,
    ...fromEnv,
  });
});

ipcMain.handle('ops-save-remote-profile', async (event, payload) => {
  try {
    const profile = normalizeOpsRemoteProfile(payload || {});
    ensureOpsProfileReady(profile);
    store.set(OPS_REMOTE_PROFILE_KEY, profile);
    writeOpsProfileToEnv(profile);
    store.set(
      MYSQL_SETTINGS_KEY,
      normalizeMySqlConfig({
        host: profile.dbHost,
        port: profile.dbPort,
        user: profile.dbUser,
        password: profile.dbPassword,
        database: profile.dbName,
      })
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-test-remote-connection', async (event) => {
  try {
    const cmd = process.platform === 'win32'
      ? 'echo [ok] connected: %COMPUTERNAME% && ver'
      : 'echo "[ok] connected: $(hostname)" && uname -a';
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ server health\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Health check exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-execute-remote-command', async (event, command) => {
  try {
    if (!String(command || '').trim()) return { ok: false, error: 'Command is required.' };
    const { code } = await runLocalOpsCommand(event.sender, String(command), `$ local$ ${command}\n`);
    return code === 0 ? { ok: true } : { ok: false, error: `Command exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-check-remote-dependencies', async (event) => {
  try {
    const profile = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    const cmd = process.platform === 'win32'
      ? [
          `echo Install root: ${profile.installRoot}`,
          `echo MySQL data dir: ${profile.dbDataDir}`,
          'echo Checking dependencies...',
          'where mysql && echo [ok] mysql client || echo [missing] mysql client',
          'where mysqld && echo [ok] mysqld server || echo [missing] mysqld server',
          'where cloudflared && echo [ok] cloudflared || echo [missing] cloudflared',
          `if exist "${profile.dbDataDir}" (echo [ok] db data dir exists) else (echo [missing] db data dir)`,
          'sc query MySQL80',
          'sc query cloudflared',
        ].join(' & ')
      : [
          'set -e',
          'echo "Checking dependencies..."',
          'command -v mysql >/dev/null 2>&1 && echo "[ok] mysql client" || echo "[missing] mysql client"',
          'command -v mysqld >/dev/null 2>&1 && echo "[ok] mysqld server" || echo "[missing] mysqld server"',
          'command -v cloudflared >/dev/null 2>&1 && echo "[ok] cloudflared" || echo "[missing] cloudflared"',
          'command -v systemctl >/dev/null 2>&1 && systemctl is-active mysql >/dev/null 2>&1 && echo "[ok] mysql service active" || true',
          'command -v systemctl >/dev/null 2>&1 && systemctl is-active mariadb >/dev/null 2>&1 && echo "[ok] mariadb service active" || true',
        ].join('; ');
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ dependency check\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Dependency check exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-install-remote-dependencies', async (event) => {
  try {
    const profile = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    const cmd = process.platform === 'win32'
      ? [
          'echo Installing dependencies on Windows server...',
          `if not exist "${profile.installRoot}" mkdir "${profile.installRoot}"`,
          `if not exist "${profile.dbDataDir}" mkdir "${profile.dbDataDir}"`,
          'where winget || (echo winget is required & exit /b 1)',
          'winget install -e --id Oracle.MySQL --accept-source-agreements --accept-package-agreements || echo MySQL install may already exist',
          'winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements || echo cloudflared install may already exist',
          `echo Data directory target: ${profile.dbDataDir}`,
          'sc start MySQL80',
          'sc start cloudflared',
        ].join(' & ')
      : [
          'set -e',
          'if command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y mysql-server mysql-client curl gnupg lsb-release ca-certificates;',
          'elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y mysql-server mysql curl;',
          'elif command -v yum >/dev/null 2>&1; then sudo yum install -y mysql-server mysql curl;',
          'else echo "Unsupported package manager"; exit 1; fi',
          'if command -v cloudflared >/dev/null 2>&1; then echo "cloudflared already installed";',
          'elif command -v apt-get >/dev/null 2>&1; then curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg && echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null && sudo apt-get update && sudo apt-get install -y cloudflared;',
          'elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then sudo rpm -ivh --replacepkgs https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm || true; fi',
          'sudo systemctl enable mysql >/dev/null 2>&1 || true',
          'sudo systemctl enable mariadb >/dev/null 2>&1 || true',
          'sudo systemctl start mysql >/dev/null 2>&1 || true',
          'sudo systemctl start mariadb >/dev/null 2>&1 || true',
          'echo "Dependency install complete."',
        ].join(' ');
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ install dependencies\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Dependency install exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-ensure-folders', async (event) => {
  try {
    const profile = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    const cmd = process.platform === 'win32'
      ? [
          `if not exist "${profile.rootFolder}" mkdir "${profile.rootFolder}"`,
          `if not exist "${profile.websiteDir}" mkdir "${profile.websiteDir}"`,
          `if not exist "${profile.dbDataDir}" mkdir "${profile.dbDataDir}"`,
          `echo root folder: ${profile.rootFolder}`,
          `echo website folder: ${profile.websiteDir}`,
          `echo db data dir: ${profile.dbDataDir}`,
        ].join(' & ')
      : [
          `mkdir -p "${profile.rootFolder}"`,
          `mkdir -p "${profile.websiteDir}"`,
          `mkdir -p "${profile.dbDataDir}"`,
          `echo "root folder: ${profile.rootFolder}"`,
          `echo "website folder: ${profile.websiteDir}"`,
          `echo "db data dir: ${profile.dbDataDir}"`,
        ].join('; ');
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ ensure folders\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Ensure folders exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-open-website-folder', async (event) => {
  try {
    const profile = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    fs.mkdirSync(profile.websiteDir, { recursive: true });
    const { shell } = require('electron');
    await shell.openPath(profile.websiteDir);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-deploy-website-folder', async (event) => {
  try {
    const profile = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    if (!fs.existsSync(profile.websiteDir)) {
      return { ok: false, error: `Website folder does not exist: ${profile.websiteDir}` };
    }
    const child = spawn('npx', ['wrangler', 'pages', 'deploy', profile.websiteDir], {
      cwd: profile.websiteDir,
      stdio: 'pipe',
      shell: true,
    });
    await streamChildToTerminal(event.sender, 'operations-hub', child, '$ npx wrangler pages deploy\n');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-start-tunnel', async (event, payload) => {
  try {
    const base = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    const token = String((payload && payload.token) || base.tunnelToken || '').trim();
    const dbPort = Number((payload && payload.dbPort) || base.dbPort || 3306);
    if (!token) return { ok: false, error: 'Tunnel token is required.' };
    const next = { ...base, tunnelToken: token, dbPort };
    store.set(OPS_REMOTE_PROFILE_KEY, next);
    writeOpsProfileToEnv(next);
    const cmd = process.platform === 'win32'
      ? [
          `set RR_CF_TOKEN=${token}`,
          `set RR_DB_PORT=${Number.isFinite(dbPort) ? dbPort : 3306}`,
          'taskkill /IM cloudflared.exe /F',
          'start "" /MIN cmd /c "cloudflared tunnel --token %RR_CF_TOKEN% > %USERPROFILE%\\rootrecord-cloudflared.log 2>&1"',
          base.publicDbHost ? `echo Public DB hostname profile: ${base.publicDbHost}` : 'echo No public DB hostname set in profile',
          'echo Tunnel started',
        ].join(' & ')
      : [
          'set -e',
          'mkdir -p ~/.cloudflared',
          `cat > ~/.cloudflared/rootrecord-db.yml <<'EOF'\ntunnel: rootrecord-db\ningress:\n${base.publicDbHost ? `  - hostname: ${base.publicDbHost}\n` : ''}  - service: tcp://localhost:${Number.isFinite(dbPort) ? dbPort : 3306}\n  - service: http_status:404\nEOF`,
          `pkill -f "cloudflared tunnel .*rootrecord-db" >/dev/null 2>&1 || true`,
          `cloudflared tunnel --token ${JSON.stringify(token)} --config ~/.cloudflared/rootrecord-db.yml run rootrecord-db > ~/rootrecord-cloudflared.log 2>&1 &`,
          'echo $! > ~/.cloudflared/rootrecord-db.pid',
          'echo "Tunnel started."',
        ].join('; ');
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ start tunnel\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Tunnel start exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-stop-tunnel', async (event) => {
  try {
    const cmd = process.platform === 'win32'
      ? 'taskkill /IM cloudflared.exe /F & echo Tunnel stopped'
      : [
          'set -e',
          'if [ -f ~/.cloudflared/rootrecord-db.pid ]; then kill $(cat ~/.cloudflared/rootrecord-db.pid) >/dev/null 2>&1 || true; rm -f ~/.cloudflared/rootrecord-db.pid; fi',
          'pkill -f "cloudflared tunnel .*rootrecord-db" >/dev/null 2>&1 || true',
          'echo "Tunnel stopped."',
        ].join('; ');
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ stop tunnel\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Tunnel stop exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-install-services', async (event) => {
  try {
    const profile = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    const cmd = process.platform === 'win32'
      ? [
          `set RR_CF_TOKEN=${profile.tunnelToken || ''}`,
          `set RR_DB_PORT=${profile.dbPort || 3306}`,
          `set RR_PUBLIC_DB_HOST=${profile.publicDbHost || ''}`,
          'where sc || (echo sc.exe missing & exit /b 1)',
          'where cloudflared || (echo cloudflared missing; install dependencies first & exit /b 1)',
          `if not exist "${profile.dbDataDir}" mkdir "${profile.dbDataDir}"`,
          'sc stop RootRecordCloudflared',
          'sc delete RootRecordCloudflared',
          'sc create RootRecordCloudflared binPath= "cmd /c cloudflared tunnel --token %RR_CF_TOKEN%" start= auto DisplayName= "RootRecord Cloudflared Tunnel"',
          'sc description RootRecordCloudflared "Root Record managed tunnel service for database connectivity"',
          'sc config MySQL80 start= auto',
          'echo Services installed/updated.',
        ].join(' & ')
      : 'echo Service install automation currently focused on Windows & exit 1';
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ install services\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Install services exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-check-services', async (event) => {
  try {
    const cmd = process.platform === 'win32'
      ? [
          'echo Service status:',
          'sc query MySQL80',
          'sc query RootRecordCloudflared',
        ].join(' & ')
      : 'echo Service status checks currently focused on Windows & exit 1';
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ check services\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Check services exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-start-services', async (event) => {
  try {
    const cmd = process.platform === 'win32'
      ? [
          'sc start MySQL80',
          'sc start RootRecordCloudflared',
        ].join(' & ')
      : 'echo Service start currently focused on Windows & exit 1';
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ start services\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Start services exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-stop-services', async (event) => {
  try {
    const cmd = process.platform === 'win32'
      ? [
          'sc stop RootRecordCloudflared',
          'sc stop MySQL80',
        ].join(' & ')
      : 'echo Service stop currently focused on Windows & exit 1';
    const { code } = await runLocalOpsCommand(event.sender, cmd, '$ stop services\n');
    return code === 0 ? { ok: true } : { ok: false, error: `Stop services exited ${code}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-check-app-update', async (event) => {
  try {
    const profile = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    const latest = await getLatestGithubRelease(profile);
    const currentVersion = app.getVersion();
    const latestVersion = String(latest.tag || '').replace(/^v/i, '');
    const updateAvailable = isVersionGreater(latestVersion, currentVersion);
    sendTerminalChunk(
      event.sender,
      'operations-hub',
      `[update] current=${currentVersion} latest=${latestVersion || latest.tag}\n`
    );
    return { ok: true, currentVersion, latestVersion, updateAvailable, releaseName: latest.name };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('ops-apply-app-update', async (event) => {
  try {
    const profile = normalizeOpsRemoteProfile({
      ...store.get(OPS_REMOTE_PROFILE_KEY, {}),
      ...readOpsProfileFromEnv(),
    });
    const latest = await getLatestGithubRelease(profile);
    const currentVersion = app.getVersion();
    const latestVersion = String(latest.tag || '').replace(/^v/i, '');
    if (!isVersionGreater(latestVersion, currentVersion)) {
      return { ok: false, error: `Already up to date (${currentVersion}).` };
    }
    const tempDir = path.join(os.tmpdir(), 'rootrecord-devpanel-updates');
    fs.mkdirSync(tempDir, { recursive: true });
    const setupPath = path.join(tempDir, latest.installerName || 'RootRecordDeveloperPanelSetup.exe');
    sendTerminalChunk(event.sender, 'operations-hub', `[update] downloading ${latest.installerName}\n`);
    await downloadFile(latest.installerUrl, profile.updateToken, setupPath);
    sendTerminalChunk(event.sender, 'operations-hub', `[update] launching installer: ${setupPath}\n`);
    if (process.platform === 'win32') {
      spawn(setupPath, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn(setupPath, [], { detached: true, stdio: 'ignore', shell: true }).unref();
    }
    return { ok: true, latestVersion };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('execute-command', async (event, command, cwd, projectId) => {
  const slug = projectId || 'dashboard';
  const sender = event.sender;
  const cwdResolved = cwd ? normalizePythonProjectPath(cwd) : developmentFolder;
  const child = spawn(command, [], {
    shell: true,
    cwd: cwdResolved,
    stdio: 'pipe',
  });
  sendTerminalChunk(sender, slug, `$ ${command}\n`);
  await streamChildToTerminal(sender, slug, child, null);
  return 'Finished (see in-app terminal).';
});

ipcMain.handle('list-projects', async (event, folderPath) => {
  try {
    const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const projects = [];
    
    for (const item of items) {
      if (item.isDirectory() && item.name !== 'Root Record Developer Panel') {
        const resolvedPath = resolvePythonProjectRoot(folderPath, item.name);
        const packageJsonPath = path.join(resolvedPath, 'package.json');
        
        try {
          const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
          projects.push({
            name: item.name,
            path: resolvedPath,
            version: packageJson.version || 'unknown',
            description: packageJson.description || '',
            scripts: packageJson.scripts || {}
          });
        } catch (e) {
          // Not a Node.js project, still include as basic project
          projects.push({
            name: item.name,
            path: resolvedPath,
            version: 'unknown',
            description: 'Folder',
            scripts: {}
          });
        }
      }
    }
    
    return projects;
  } catch (error) {
    console.error('Error listing projects:', error);
    return [];
  }
});

ipcMain.handle('build-project', async (event, projectPath) => {
  projectPath = normalizePythonProjectPath(projectPath);
  return new Promise((resolve) => {
    const cmd = spawn('npm', ['run', 'build'], { 
      cwd: projectPath,
      stdio: 'pipe'
    });
    
    let output = '';
    cmd.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    cmd.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    cmd.on('close', (code) => {
      resolve(`Build completed with code ${code}\\n${output}`);
    });
  });
});

ipcMain.handle('install-project', async (event, projectPath) => {
  projectPath = normalizePythonProjectPath(projectPath);
  return new Promise((resolve) => {
    const cmd = spawn('npm', ['install'], { 
      cwd: projectPath,
      stdio: 'pipe'
    });
    
    let output = '';
    cmd.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    cmd.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    cmd.on('close', (code) => {
      resolve(`Install completed with code ${code}\\n${output}`);
    });
  });
});

ipcMain.handle('run-project', async (event, projectPath) => {
  projectPath = normalizePythonProjectPath(projectPath);
  return new Promise((resolve) => {
    const cmd = spawn('npm', ['start'], { 
      cwd: projectPath,
      stdio: 'pipe',
      detached: true
    });
    
    cmd.unref();
    resolve('Project started in background');
  });
});

ipcMain.handle('sign-project', async (event, projectPath) => {
  // Placeholder for signing functionality
  return 'Code signing not implemented yet';
});

ipcMain.handle('git-status', async (event, projectPath) => {
  projectPath = normalizePythonProjectPath(projectPath);
  try {
    const git = simpleGit(projectPath);
    const status = await git.status();
    return {
      clean: status.isClean(),
      files: status.files
    };
  } catch (error) {
    return { clean: false, files: [], error: error.message };
  }
});

ipcMain.handle('git-push', async (event, projectPath, projectId) => {
  projectPath = normalizePythonProjectPath(projectPath);
  const slug = projectId || projectSlugFromPath(projectPath);
  const sender = event.sender;
  maybeApplyRootRecordBuildSettings(sender, projectPath, slug);
  const child = spawn('git', ['push'], { cwd: projectPath, stdio: 'pipe', shell: false });
  sendTerminalChunk(sender, slug, '$ git push\n');
  const { code } = await streamChildToTerminal(sender, slug, child, null);
  return code === 0 ? 'git push finished (see terminal).' : `git push exited ${code} (see terminal).`;
});

ipcMain.handle('git-pull', async (event, projectPath, projectId) => {
  projectPath = normalizePythonProjectPath(projectPath);
  const slug = projectId || projectSlugFromPath(projectPath);
  const sender = event.sender;
  const child = spawn('git', ['pull'], { cwd: projectPath, stdio: 'pipe', shell: false });
  sendTerminalChunk(sender, slug, '$ git pull\n');
  const { code } = await streamChildToTerminal(sender, slug, child, null);
  return code === 0 ? 'git pull finished (see terminal).' : `git pull exited ${code} (see terminal).`;
});

// New IPC handlers for Python projects
ipcMain.handle('build-python-app', async (event, projectPath, projectId) => {
  projectPath = normalizePythonProjectPath(projectPath);
  const slug = projectId || projectSlugFromPath(projectPath);
  const sender = event.sender;
  maybeApplyRootRecordBuildSettings(sender, projectPath, slug);
  const buildScript = path.join(projectPath, 'Build RootRecord.bat');
  if (!fs.existsSync(buildScript)) {
    sendTerminalChunk(sender, slug, `Build script not found: ${buildScript}\n`);
    return 'Build script missing.';
  }
  const child = spawn('cmd', ['/c', buildScript], { cwd: projectPath, stdio: 'pipe' });
  sendTerminalChunk(sender, slug, `--- Build RootRecord.bat (default; may sign) ---\n`);
  await streamChildToTerminal(sender, slug, child, null);
  return 'Build finished (see terminal).';
});

ipcMain.handle('run-python-app', async (event, projectPath) => {
  projectPath = normalizePythonProjectPath(projectPath);
  return new Promise((resolve) => {
    const mainPy = path.join(projectPath, 'desktop_app.py');
    if (!fs.existsSync(mainPy)) {
      // Try ui_main.py if desktop_app.py doesn't exist
      const uiMainPy = path.join(projectPath, 'ui_main.py');
      if (fs.existsSync(uiMainPy)) {
        const cmd = spawn('python', [uiMainPy], { 
          cwd: projectPath,
          stdio: 'pipe',
          detached: true
        });
        cmd.unref();
        resolve('Python app started in background');
      } else {
        resolve('No main Python file found');
      }
    } else {
      const cmd = spawn('python', [mainPy], { 
        cwd: projectPath,
        stdio: 'pipe',
        detached: true
      });
      cmd.unref();
      resolve('Python app started in background');
    }
  });
});

ipcMain.handle('build-msix', async (event, projectPath, projectId) => {
  projectPath = normalizePythonProjectPath(projectPath);
  const slug = projectId || projectSlugFromPath(projectPath);
  const sender = event.sender;
  maybeApplyRootRecordBuildSettings(sender, projectPath, slug);
  const msixScript = path.join(projectPath, 'Build RootRecord MSIX.bat');
  if (!fs.existsSync(msixScript)) {
    sendTerminalChunk(sender, slug, 'MSIX build script not found.\n');
    return 'MSIX build script not found.';
  }
  const child = spawn('cmd', ['/c', msixScript], { cwd: projectPath, stdio: 'pipe' });
  sendTerminalChunk(sender, slug, '--- Build RootRecord MSIX.bat ---\n');
  await streamChildToTerminal(sender, slug, child, null);
  return 'MSIX build finished (see terminal).';
});

ipcMain.handle('build-installer', async (event, projectPath, projectId) => {
  projectPath = normalizePythonProjectPath(projectPath);
  const slug = projectId || projectSlugFromPath(projectPath);
  const sender = event.sender;
  const installerScript = path.join(projectPath, 'build_installer.bat');
  if (!fs.existsSync(installerScript)) {
    sendTerminalChunk(sender, slug, 'Installer build script not found.\n');
    return 'Installer build script not found.';
  }
  const child = spawn('cmd', ['/c', installerScript], { cwd: projectPath, stdio: 'pipe' });
  sendTerminalChunk(sender, slug, '--- build_installer.bat ---\n');
  await streamChildToTerminal(sender, slug, child, null);
  return 'Installer build finished (see terminal).';
});

// Website handlers
ipcMain.handle('open-website', async () => {
  const { shell } = require('electron');
  await shell.openExternal('https://rootrecord.com');
  return 'Website opened in browser';
});

ipcMain.handle('deploy-website', async (event) => {
  const websitePath = path.join(developmentFolder, 'public cloudflare website pages');
  const sender = event.sender;
  const child = spawn('npx', ['wrangler', 'pages', 'deploy'], { cwd: websitePath, stdio: 'pipe', shell: true });
  sendTerminalChunk(sender, 'website', '$ npx wrangler pages deploy\n');
  await streamChildToTerminal(sender, 'website', child, null);
  return 'Deploy finished (see Website terminal tab).';
});

ipcMain.handle('serve-website', async (event) => {
  const websitePath = path.join(developmentFolder, 'public cloudflare website pages');
  return new Promise((resolve) => {
    const cmd = spawn('python', ['-m', 'http.server', '8080'], { 
      cwd: websitePath,
      stdio: 'pipe',
      detached: true
    });
    
    cmd.unref();
    resolve('Website serving locally at http://localhost:8080');
  });
});

ipcMain.handle('edit-index', async (event) => {
  const { shell } = require('electron');
  const indexPath = path.join(developmentFolder, 'public cloudflare website pages', 'index.html');
  await shell.openPath(indexPath);
  return 'Index.html opened in default editor';
});

ipcMain.handle('edit-styles', async (event) => {
  const { shell } = require('electron');
  const stylesPath = path.join(developmentFolder, 'public cloudflare website pages', 'styles.css');
  await shell.openPath(stylesPath);
  return 'Styles.css opened in default editor';
});

// Batch operations
ipcMain.handle('build-all-projects', async (event) => {
  const sender = event.sender;
  const projects = ['Root Record Business Manager', 'Root Record Energy Manager', 'Root Record Homestead Manager'];
  for (const projectName of projects) {
    const projectPath = resolvePythonProjectRoot(developmentFolder, projectName);
    const slug = projectSlugFromDirName(projectName);
    maybeApplyRootRecordBuildSettings(sender, projectPath, slug);
    const bat = path.join(projectPath, 'build', 'build_rootrecord.bat');
    sendTerminalChunk(sender, 'dashboard', `\n\n======== ${projectName} (nosign) ========\n`);
    if (!fs.existsSync(bat)) {
      sendTerminalChunk(sender, 'dashboard', `Skipped (no build/build_rootrecord.bat): ${projectName}\n`);
      continue;
    }
    const child = spawn('cmd', ['/c', bat, 'nosign'], { cwd: projectPath, stdio: 'pipe' });
    await streamChildToTerminal(sender, 'dashboard', child, null);
  }
  sendTerminalChunk(sender, 'dashboard', '\n=== All scheduled builds finished ===\n');
  return 'Done (see Overview → Global Terminal).';
});

ipcMain.handle('run-all-projects', async (event) => {
  const projects = ['Root Record Business Manager', 'Root Record Energy Manager', 'Root Record Homestead Manager'];
  let results = [];
  
  for (const projectName of projects) {
    const projectPath = resolvePythonProjectRoot(developmentFolder, projectName);
    results.push(`\n=== Starting ${projectName} ===`);
    
    try {
      const mainPy = path.join(projectPath, 'desktop_app.py');
      const uiMainPy = path.join(projectPath, 'ui_main.py');
      
      if (fs.existsSync(mainPy)) {
        const cmd = spawn('python', [mainPy], { 
          cwd: projectPath,
          stdio: 'pipe',
          detached: true
        });
        cmd.unref();
        results.push('Started desktop_app.py');
      } else if (fs.existsSync(uiMainPy)) {
        const cmd = spawn('python', [uiMainPy], { 
          cwd: projectPath,
          stdio: 'pipe',
          detached: true
        });
        cmd.unref();
        results.push('Started ui_main.py');
      } else {
        results.push('No main Python file found');
      }
    } catch (error) {
      results.push(`Error: ${error.message}`);
    }
  }
  
  return results.join('\n');
});

ipcMain.handle('git-status-all', async (event) => {
  const sender = event.sender;
  const projects = ['Root Record Business Manager', 'Root Record Energy Manager', 'Root Record Homestead Manager'];
  sendTerminalChunk(sender, 'dashboard', '\n=== Git status (all) ===\n');
  for (const projectName of projects) {
    const projectPath = resolvePythonProjectRoot(developmentFolder, projectName);
    sendTerminalChunk(sender, 'dashboard', `\n--- ${projectName} ---\n`);
    try {
      const git = simpleGit(projectPath);
      const status = await git.status();
      sendTerminalChunk(
        sender,
        'dashboard',
        status.isClean() ? 'Clean\n' : `Dirty — ${status.files.length} file(s)\n`
      );
    } catch (error) {
      sendTerminalChunk(sender, 'dashboard', `Error: ${error.message}\n`);
    }
  }
  return 'Done (see Global Terminal).';
});

/** Full signed pipeline: build/build_windows.ps1 -Sign (Business Manager, Homestead Manager, etc.) */
ipcMain.handle('signed-full-build', async (event, projectDirName) => {
  const projectPath = resolvePythonProjectRoot(developmentFolder, projectDirName);
  const slug = projectSlugFromDirName(projectDirName);
  const sender = event.sender;
  maybeApplyRootRecordBuildSettings(sender, projectPath, slug);
  const buildScript = path.join(projectPath, 'build', 'build_windows.ps1');
  if (fs.existsSync(buildScript)) {
    const child = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', buildScript, '-Sign', '-StopRunningApp'],
      { cwd: projectPath, stdio: 'pipe' }
    );
    sendTerminalChunk(sender, slug, '--- Full signed build (build_windows.ps1 -Sign) ---\n');
    await streamChildToTerminal(sender, slug, child, null);
    return { ok: true };
  }
  const weatherScript = path.join(projectPath, 'scripts', 'build-installer-signed.bat');
  if (fs.existsSync(weatherScript)) {
    const child = spawn('cmd', ['/c', weatherScript], { cwd: projectPath, stdio: 'pipe' });
    sendTerminalChunk(sender, slug, '--- Full signed build (scripts/build-installer-signed.bat) ---\n');
    await streamChildToTerminal(sender, slug, child, null);
    return { ok: true };
  }
  sendTerminalChunk(sender, slug, `No signed build script found for ${projectDirName}.\n`);
  return { ok: false };
});

/** Unsigned: build/build_rootrecord.bat nosign */
ipcMain.handle('unsigned-full-build', async (event, projectDirName) => {
  const projectPath = resolvePythonProjectRoot(developmentFolder, projectDirName);
  const slug = projectSlugFromDirName(projectDirName);
  const sender = event.sender;
  maybeApplyRootRecordBuildSettings(sender, projectPath, slug);
  const buildScript = path.join(projectPath, 'build', 'build_rootrecord.bat');
  if (fs.existsSync(buildScript)) {
    const child = spawn('cmd', ['/c', buildScript, 'nosign'], { cwd: projectPath, stdio: 'pipe' });
    sendTerminalChunk(sender, slug, '--- Build without signing (build_rootrecord.bat nosign) ---\n');
    await streamChildToTerminal(sender, slug, child, null);
    return { ok: true };
  }
  const weatherScript = path.join(projectPath, 'scripts', 'build-installer-unsigned.bat');
  if (fs.existsSync(weatherScript)) {
    const child = spawn('cmd', ['/c', weatherScript], { cwd: projectPath, stdio: 'pipe' });
    sendTerminalChunk(sender, slug, '--- Build without signing (scripts/build-installer-unsigned.bat) ---\n');
    await streamChildToTerminal(sender, slug, child, null);
    return { ok: true };
  }
  sendTerminalChunk(sender, slug, `No unsigned build script found for ${projectDirName}.\n`);
  return { ok: false };
});
