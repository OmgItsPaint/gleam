const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'assets', 'swirl-logo.svg'), 'utf8');
  const page = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{width:512px;height:512px;margin:0;overflow:hidden;background:#050506}body{display:grid;place-items:center}.mark{width:416px;height:416px;display:grid;place-items:center;border:16px solid #7b3f72;background:#fff;box-shadow:24px 24px 0 #241020}.mark svg{width:330px;height:330px}</style><div class="mark">${svg}</div>`;
  const window = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, webPreferences: { offscreen: true } });
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'assets', 'swirl-logo.png'), image.toPNG());
  window.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
