'use strict';
/**
 * Windows-friendly pack: move old dist aside (same idea as prepack-clean), then run electron-packager.
 * If the default output folder is locked (exe running, Explorer, or shell cwd inside it), pack to
 * dist/.rr-staging-<id>/ instead so the build always completes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const bundleName = 'RootRecordDeveloperPanel-win32-x64';
const lockedTarget = path.join(distDir, bundleName);

function norm(p) {
  return path.normalize(path.resolve(p));
}

function tryMoveAside() {
  if (!fs.existsSync(lockedTarget)) return true;
  const stamp = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const trash = path.join(distDir, `${bundleName}.rr-old-${stamp}`);
  for (let i = 0; i < 20; i++) {
    try {
      fs.renameSync(lockedTarget, trash);
      console.log('[build] Moved previous build aside:\n  ' + trash);
      console.log('[build] Delete that folder later when no process is using it.\n');
      return true;
    } catch (e) {
      if (e && e.code === 'ENOENT') return true;
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
  return false;
}

async function main() {
  const cwdNorm = norm(process.cwd());
  const lockedNorm = norm(lockedTarget);
  if (cwdNorm === lockedNorm || cwdNorm.startsWith(lockedNorm + path.sep)) {
    console.error('[build] Your shell is inside the packaged app folder, which keeps Windows from renaming it.\n');
    console.error('  cd "' + root + '"');
    console.error('  npm run build\n');
    process.exit(1);
  }

  let outDir = distDir;
  if (!tryMoveAside()) {
    if (fs.existsSync(lockedTarget)) {
      const stamp = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
      outDir = path.join(distDir, `.rr-staging-${stamp}`);
      console.warn('[build] Default output is locked. Packaging to a staging folder:\n  ' + outDir);
      console.warn('[build] Run the .exe from there. When nothing uses dist\\' + bundleName + ', run build again from the project root to repack into the usual path.\n');
    }
  }

  const packager = require('electron-packager');
  const iconPath = path.join(root, 'assets', 'icon.ico');
  const paths = await packager({
    dir: root,
    name: 'RootRecordDeveloperPanel',
    platform: 'win32',
    arch: 'x64',
    out: outDir,
    overwrite: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
  });
  const built = paths && paths[0];
  console.log('[build] Done.');
  if (built) console.log('  ' + built);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
