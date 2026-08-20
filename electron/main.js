const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const os = require('os')

const isDev = process.env.NODE_ENV === 'development'

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    // Opaque (not transparent) so Windows Aero Snap / drag-to-edge tiling and
    // normal resizing work like a standard window. backgroundColor matches the
    // app's surface to avoid a white flash on load.
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // The title bar is ours, so the app has to be told when the window changes
  // state — otherwise the maximize button can never become a restore button.
  const sendState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('window:state', {
      maximized: mainWindow.isMaximized(),
      fullScreen: mainWindow.isFullScreen(),
    })
  }
  mainWindow.on('maximize',   sendState)
  mainWindow.on('unmaximize', sendState)
  mainWindow.on('enter-full-screen', sendState)
  mainWindow.on('leave-full-screen', sendState)
  // …and once at startup, so the first paint already has the right icon.
  mainWindow.webContents.on('did-finish-load', sendState)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* Machine identity for the super admin's device column.

   This lives in the main process on purpose: preload scripts are SANDBOXED by
   default from Electron 20 onwards, and a sandboxed preload cannot require
   'os'. Doing so throws, which aborts the whole preload — taking
   contextBridge.exposeInMainWorld with it, so `window.electron` never appears
   and the window buttons vanish. Ask the main process instead. */
ipcMain.on('device:info', (event) => {
  let name = ''
  let osUser = ''
  try { name   = os.hostname() } catch { /* ignore */ }
  try { osUser = os.userInfo().username } catch { /* ignore */ }
  event.returnValue = { name, osUser, platform: process.platform }
})

// Custom window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:unmaximize', () => mainWindow?.unmaximize())
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())

// Open external links in browser
ipcMain.on('open:external', (_, url) => shell.openExternal(url))
