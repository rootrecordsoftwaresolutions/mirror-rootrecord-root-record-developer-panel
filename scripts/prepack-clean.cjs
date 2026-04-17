'use strict';
/**
 * Optional manual step; `npm run build` uses `build-windows.cjs` instead.
 *
 * electron-packager --overwrite tries to rmdir the entire output tree first.
 * On Windows that fails with EBUSY if anything holds a handle (running .exe, Explorer, AV, IDE on dist\).
 * Renaming the folder aside usually succeeds when delete does not; packager then writes a fresh tree.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'dist', 'RootRecordDeveloperPanel-win32-x64');

if (!fs.existsSync(target)) {
  process.exit(0);
}

const stamp = `${Date.now().toString(36)}-${require('crypto').randomBytes(4).toString('hex')}`;
const trash = path.join(root, 'dist', `RootRecordDeveloperPanel-win32-x64.rr-old-${stamp}`);

for (let i = 0; i < 20; i++) {
  try {
    fs.renameSync(target, trash);
    console.log('[prepack-clean] Moved previous build aside:\n  ' + trash);
    console.log('[prepack-clean] Delete that folder later when no process is using it.\n');
    process.exit(0);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      process.exit(0);
    }
    if (i === 19) {
      console.error('\n[prepack-clean] Could not move aside locked folder:\n  ' + target);
      console.error('\nTry:');
      console.error('  1. Quit RootRecordDeveloperPanel.exe if it is running.');
      console.error('  2. Close File Explorer windows showing that dist\\ folder.');
      console.error('  3. Close other terminals whose cwd is inside dist\\RootRecordDeveloperPanel-win32-x64');
      console.error('  4. Retry: npm run build\n');
      console.error(String(e && e.message ? e.message : e));
      process.exit(1);
    }
    try {
      require('child_process').execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500'],
        { stdio: 'ignore', windowsHide: true }
      );
    } catch {
      const t = Date.now() + 500;
      while (Date.now() < t) {
        /* brief spin */
      }
    }
  }
}
