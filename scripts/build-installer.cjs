'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { createWindowsInstaller } = require('electron-winstaller');

const root = path.join(__dirname, '..');
const packedDir = path.join(root, 'dist', 'RootRecordDeveloperPanel-win32-x64');
const installerOutDir = path.join(root, 'dist-installer');
const shortWorkRoot = path.join('C:', 'rrdp-inst');
const shortAppDir = path.join(shortWorkRoot, 'app');
const shortOutDir = path.join(shortWorkRoot, 'out');

function runBuildWindows() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'build-windows.cjs')], {
      cwd: root,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build-windows failed with code ${code}`));
    });
  });
}

async function main() {
  await runBuildWindows();
  fs.rmSync(shortWorkRoot, { recursive: true, force: true });
  fs.mkdirSync(shortWorkRoot, { recursive: true });
  fs.cpSync(packedDir, shortAppDir, { recursive: true });
  await createWindowsInstaller({
    appDirectory: shortAppDir,
    outputDirectory: shortOutDir,
    exe: 'RootRecordDeveloperPanel.exe',
    setupExe: 'RootRecordDeveloperPanelSetup.exe',
    noMsi: true,
  });
  fs.mkdirSync(installerOutDir, { recursive: true });
  fs.copyFileSync(
    path.join(shortOutDir, 'RootRecordDeveloperPanelSetup.exe'),
    path.join(installerOutDir, 'RootRecordDeveloperPanelSetup.exe')
  );
  console.log('[installer] Done.');
  console.log(`[installer] Setup exe: ${path.join(installerOutDir, 'RootRecordDeveloperPanelSetup.exe')}`);
}

main().catch((err) => {
  console.error('[installer] Failed:', err);
  process.exit(1);
});
