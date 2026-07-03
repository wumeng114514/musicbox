const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');

let mainWindow;
let publicUrl = '';

async function createWindow() {
  try {
    // 启动 Express 服务器（自动开启公网隧道）
    const { startServer } = require('./server');
    const { port, tunnel } = await startServer(null, { public: true });

    if (tunnel && tunnel.url) {
      publicUrl = tunnel.url;
    }

    const titleText = publicUrl
      ? `MusicBox - 公网: ${publicUrl}`
      : 'MusicBox - 免费音乐播放器';

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: titleText,
      backgroundColor: '#0f0f1a',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // 页面加载完成后显示窗口
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.show();
      // 将公网地址注入页面
      if (publicUrl) {
        mainWindow.webContents.executeJavaScript(`window.__PUBLIC_URL__ = '${publicUrl}'`);
      }
    });

    // 加载失败时显示错误
    mainWindow.webContents.on('did-fail-load', (event, errCode, errDesc, url) => {
      dialog.showErrorBox('加载失败', `无法加载页面: ${errDesc}\nURL: ${url}\n错误码: ${errCode}`);
    });

    // 加载页面
    mainWindow.loadURL(`http://localhost:${port}`);

    // 外部链接用浏览器打开
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
