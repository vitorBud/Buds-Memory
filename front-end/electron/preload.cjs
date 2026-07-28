const { contextBridge, ipcRenderer } = require('electron')
function resolveAssetBase() {
  return 'nexus-asset://local/'
}

// Ponte segura entre o app Electron e o React. Mantém o front isolado do Node.
contextBridge.exposeInMainWorld('nexus', {
  apiBase: 'http://127.0.0.1:5050/api',
  assetBase: resolveAssetBase(),
  isDesktop: true,
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke('nexus:pick-folder'),
  getRemoteToken: () => ipcRenderer.invoke('nexus:get-remote-token'),
})
