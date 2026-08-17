const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const width = Math.max(900, Math.min(3840, Number(process.env.GLEAM_QA_WIDTH) || 1280));
const height = Math.max(620, Math.min(2160, Number(process.env.GLEAM_QA_HEIGHT) || 820));
const output = path.join(root, '.qa-gleam', `dashboard-${width}x${height}.png`);

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: '#eef0df',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(path.join(root, 'gleam-ui', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, image.toPNG());
  console.log(output);
  app.quit();
});
