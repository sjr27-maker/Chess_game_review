const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Allow loading Stockfish WASM
      webSecurity: false
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  win.loadFile('index.html');

  // Build a minimal menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Open PGN...', accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.executeJavaScript('window.triggerFileOpen && window.triggerFileOpen()') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] }
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });