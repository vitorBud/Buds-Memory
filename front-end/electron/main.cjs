const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const BACKEND_URL = 'http://127.0.0.1:5050'
const API_CONFIG_URL = `${BACKEND_URL}/api/config`

let mainWindow = null
let backendProcess = null
let backendStartedByElectron = false
let backendLogTail = []

app.setName('Nexus IA')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

function resolveDataDir() {
  return process.env.NEXUS_DATA_DIR || app.getPath('userData')
}

function logLine(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map(part => (
    part instanceof Error ? `${part.stack || part.message}` : String(part)
  )).join(' ')}`

  console.log(line)
  try {
    fs.mkdirSync(resolveDataDir(), { recursive: true })
    fs.appendFileSync(path.join(resolveDataDir(), 'main.log'), `${line}\n`)
  } catch {
    // Evita quebrar o app caso o macOS negue escrita de log.
  }
}

function rememberBackendLog(chunk) {
  const lines = chunk.toString().split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  backendLogTail = [...backendLogTail, ...lines].slice(-18)
  lines.forEach(line => logLine('[backend]', line))
}

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
    path.join(backendDir, 'ambiente', 'bin', 'python3'),
    path.join(backendDir, 'venv', 'bin', 'python'),
    path.join(backendDir, 'venv', 'bin', 'python3'),
    path.join(backendDir, '.venv', 'bin', 'python'),
    path.join(backendDir, '.venv', 'bin', 'python3'),
    '/Library/Developer/CommandLineTools/usr/bin/python3',
    '/usr/bin/python3',
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || 'python3'
}

function syncEnvFileToDataDir() {
  const backendEnv = path.join(resolveBackendDir(), '.env')
  const dataEnv = path.join(resolveDataDir(), '.env')

  try {
    fs.mkdirSync(resolveDataDir(), { recursive: true })
    if (fs.existsSync(backendEnv) && !fs.existsSync(dataEnv)) {
      fs.copyFileSync(backendEnv, dataEnv)
    }
  } catch (error) {
    console.warn('[Nexus Backend] não consegui preparar .env do app:', error)
  }
}

async function startBackend() {
  if (await isBackendReady()) {
    logLine('[Nexus Backend] usando backend já ativo em 127.0.0.1:5050')
    return true
  }

  const backendDir = resolveBackendDir()
  const pythonExecutable = resolvePythonExecutable(backendDir)
  const appFile = path.join(backendDir, 'app.py')
  const hasLocalEnv = fs.existsSync(path.join(backendDir, 'ambiente')) || fs.existsSync(path.join(backendDir, 'venv')) || fs.existsSync(path.join(backendDir, '.venv'))

  if (!fs.existsSync(appFile)) {
    logLine('[Nexus Backend] app.py não encontrado:', appFile)
    await dialog.showMessageBox({
      type: 'error',
      title: 'Backend não encontrado',
      message: 'Não encontrei o app.py do backend.',
      detail: appFile,
    })
    return false
  }

  syncEnvFileToDataDir()
  backendLogTail = []
  logLine('[Nexus Backend] iniciando', pythonExecutable, appFile, 'cwd=', backendDir)
  backendStartedByElectron = true
  try {
    backendProcess = spawn(pythonExecutable, ['app.py'], {
      cwd: backendDir,
      env: {
        ...process.env,
        NEXUS_DATA_DIR: resolveDataDir(),
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    logLine('[Nexus Backend] spawn falhou:', error)
    backendProcess = null
    return false
  }

  backendProcess.stdout.on('data', chunk => {
    rememberBackendLog(chunk)
    console.log(`[Nexus Backend] ${chunk.toString().trim()}`)
  })

  backendProcess.stderr.on('data', chunk => {
    rememberBackendLog(chunk)
    console.error(`[Nexus Backend] ${chunk.toString().trim()}`)
  })

  backendProcess.on('exit', code => {
    logLine(`[Nexus Backend] encerrado com código ${code}`)
    backendProcess = null
  })

  backendProcess.on('error', error => {
    logLine('[Nexus Backend] erro no processo:', error)
    backendProcess = null
  })

  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (await isBackendReady()) return true
    if (!backendProcess) break
    await sleep(1000)
  }

  await dialog.showMessageBox({
    type: hasLocalEnv ? 'warning' : 'error',
    title: 'Backend não iniciou',
    message: 'O Nexus IA não conseguiu ligar o backend automaticamente.',
    detail: [
      `Backend: ${backendDir}`,
      `Python: ${pythonExecutable}`,
      '',
      hasLocalEnv ? 'Confira se o Ollama está ativo e se a porta 5050 está livre.' : 'O ambiente Python do backend não foi encontrado dentro do app.',
      '',
      backendLogTail.join('\n'),
    ].filter(Boolean).join('\n'),
  })
  return false
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: 'Nexus IA',
    backgroundColor: '#050607',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
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

process.on('uncaughtException', error => {
  logLine('[Electron] uncaughtException:', error)
})

process.on('unhandledRejection', error => {
  logLine('[Electron] unhandledRejection:', error instanceof Error ? error : String(error))
})

app.whenReady().then(async () => {
  logLine('[Electron] app pronto. packaged=', app.isPackaged, 'resources=', process.resourcesPath)
  try {
    await startBackend()
  } catch (error) {
    logLine('[Nexus Backend] falha ao iniciar:', error)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', stopBackend)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
