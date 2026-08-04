const { contextBridge, ipcRenderer } = require('electron')
const os = require('os')

// Machine identity, resolved once at preload time. Used to show the super admin
// which device each user is signed in from (User Accounts page).
function deviceInfo() {
  let name = ''
  let osUser = ''
  try { name   = os.hostname() } catch { /* ignore */ }
  try { osUser = os.userInfo().username } catch { /* ignore */ }
  return { name, osUser, platform: process.platform }
}

contextBridge.exposeInMainWorld('electron', {
  window: {
    minimize:    () => ipcRenderer.send('window:minimize'),
    maximize:    () => ipcRenderer.send('window:maximize'),
    close:       () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  openExternal: (url) => ipcRenderer.send('open:external', url),
  device: deviceInfo(),
})
