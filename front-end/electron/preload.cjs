const { contextBridge } = require('electron')

// Ponte segura entre o app Electron e o React. Mantém o front isolado do Node.
contextBridge.exposeInMainWorld('nexus', {
  apiBase: 'http://127.0.0.1:5050/api',
  isDesktop: true,
  platform: process.platform,
})
