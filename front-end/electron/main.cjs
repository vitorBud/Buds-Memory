const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const BACKEND_URL = 'http://127.0.0.1:5050'
const API_CONFIG_URL = `${BACKEND_URL}/api/config`

let mainWindow = null
let backendProcess = null
let backendStartedByElectron = false

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function isBackendReady() {
  try {
    const response = await fetch(API_CONFIG_URL)
    return response.ok
  } catch {
    return false
  }
}

function resolveBackendDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'Back-end')
  }
  return path.resolve(__dirname, '..', '..', 'Back-end')
}

function resolvePythonExecutable(backendDir) {
  const candidates = [
    path.join(backendDir, 'ambiente', 'bin', 'python'),
    path.join(backendDir, 'venv', 'bin', 'python'),
    path.join(backendDir, '.venv', 'bin', 'python'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || 'python3'
}

async function startBackend() {
  if (await isBackendReady()) return true

  const backendDir = resolveBackendDir()
  const pythonExecutable = resolvePythonExecutable(backendDir)
  const appFile = path.join(backendDir, 'app.py')

  if (!fs.existsSync(appFile)) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Backend não encontrado',
      message: 'Não encontrei o app.py do backend.',
      detail: appFile,
    })
    return false
  }

  backendStartedByElectron = true
  backendProcess = spawn(pythonExecutable, ['app.py'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  backendProcess.stdout.on('data', chunk => {
    console.log(`[Nexus Backend] ${chunk.toString().trim()}`)
  })

  backendProcess.stderr.on('data', chunk => {
    console.error(`[Nexus Backend] ${chunk.toString().trim()}`)
  })

  backendProcess.on('exit', code => {
    console.log(`[Nexus Backend] encerrado com código ${code}`)
    backendProcess = null
  })

  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (await isBackendReady()) return true
    await sleep(1000)
  }

  await dialog.showMessageBox({
    type: 'warning',
    title: 'Backend demorou para iniciar',
    message: 'O Nexus IA abriu, mas o backend ainda não respondeu.',
    detail: 'Confira se o Ollama está ativo e se a porta 5050 está livre.',
  })
  return false
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: 'Nexus IA',
    backgroundColor: '#f5f5f2',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

function stopBackend() {
  if (backendStartedByElectron && backendProcess) {
    backendProcess.kill('SIGTERM')
    backendProcess = null
  }
}

app.whenReady().then(async () => {
  await startBackend()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', stopBackend)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
