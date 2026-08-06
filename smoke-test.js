const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const electron = path.join(__dirname, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const userData = path.join(__dirname, `.qa-electron-${process.pid}`);
const child = spawn(electron, [`--user-data-dir=${userData}`, '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-features=SpellingService', '.'], { cwd: __dirname, env: { ...process.env, SWIRL_SMOKE_TEST: '1', SWIRL_SMOKE_USER_DATA: userData }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '';
child.stdout.on('data', chunk => { output += String(chunk); });
child.stderr.on('data', chunk => { output += String(chunk); });
const timeout = setTimeout(() => { child.kill(); console.error('Swirl smoke test timed out.'); process.exitCode = 1; }, 20_000);
child.on('error', error => { clearTimeout(timeout); console.error(`Could not start Electron: ${error.message}`); process.exitCode = 1; });
child.on('exit', async code => {
  clearTimeout(timeout);
  const passed = output.includes('SWIRL_SMOKE_OK') && !output.includes('SWIRL_SMOKE_FAILED');
  if (!passed) { console.error(output.trim() || `Electron exited with code ${code}.`); process.exitCode = 1; }
  else console.log('Swirl Electron smoke test passed.');
  if (userData.startsWith(`${__dirname}${path.sep}.qa-electron-`)) {
    try { await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
    catch (error) { console.warn(`Smoke-test cleanup will be retried next run: ${error.message}`); }
  }
});
