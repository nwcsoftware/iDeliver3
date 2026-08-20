const { contextBridge, ipcRenderer } = require('electron')

/* NOTHING but 'electron' may be required here.

   Preloads are sandboxed by default (Electron 20+), where require() reaches
   only a short list of modules — 'os' is not among them. Requiring it throws,
   the preload dies before exposeInMainWorld runs, and the app then looks like
   an ordinary web page: no window buttons, no device info, no error anywhere
   obvious. The main process answers 'device:info' instead. */
function deviceInfo() {
  try {
    return ipcRenderer.sendSync('device:info') || { name: '', osUser: '', platform: '' }
  } catch {
    return { name: '', osUser: '', platform: '' }
  }
}

contextBridge.exposeInMainWorld('electron', {
  window: {
    minimize:    () => ipcRenderer.send('window:minimize'),
    maximize:    () => ipcRenderer.send('window:maximize'),      // toggles
    unmaximize:  () => ipcRenderer.send('window:unmaximize'),
    close:       () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    /* Subscribe to maximize/restore. Returns an unsubscribe function, so a
       React effect can clean up after itself. */
    onStateChange: (cb) => {
      const handler = (_e, state) => cb(state)
      ipcRenderer.on('window:state', handler)
      return () => ipcRenderer.removeListener('window:state', handler)
    },
  },
  openExternal: (url) => ipcRenderer.send('open:external', url),
  device: deviceInfo(),
})
