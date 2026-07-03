const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');

let mainWindow;

async function createWindow() {
  try {
    // 启动本地 Express 服务器（不需要隧道，已有云端服务器）
    const { startServer } = require('./server');
    const { port, lanIP } = await startServer(null, { public: false });

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: 'MusicBox - 免费音乐播放器',
      backgroundColor: '#0f0f1a',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.show();
    });

    mainWindow.webContents.on('did-fail-load', (event, errCode, errDesc, url) => {
      dialog.showErrorBox('加载失败', `无法加载页面: ${errDesc}\nURL: ${url}\n错误码: ${errCode}`);
    });

    mainWindow.loadURL(`http://localhost:${port}`);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

  } catch (err) {
    dialog.showErrorBox('启动失败', `服务器启动失败:\n${err.message}\n\n${err.stack}`);
    app.quit();
  }
}

// 捕获未处理的异常
process.on('uncaughtException', (err) => {
  dialog.showErrorBox('程序错误', `发生未处理的错误:\n${err.message}\n\n${err.stack}`);
});

app.whenReady().then(createWindow).catch(err => {
  dialog.showErrorBox('启动失败', err.message);
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
