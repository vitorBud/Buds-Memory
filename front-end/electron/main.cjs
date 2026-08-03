const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const BACKEND_URL = 'http://127.0.0.1:5050'
const API_HEALTH_URL = `${BACKEND_URL}/api/health`

let mainWindow = null
let splashWindow = null
let backendProcess = null
let backendStartedByElectron = false
let backendLogTail = []

app.setName('Aether Memory')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nexus-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

// ── Logging ──────────────────────────────────────────────────────────────────

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
  // Apenas registra no log de arquivo — sem duplicar no console.
  lines.forEach(line => {
    const formatted = `[${new Date().toISOString()}] [backend] ${line}`
    try {
      fs.mkdirSync(resolveDataDir(), { recursive: true })
      fs.appendFileSync(path.join(resolveDataDir(), 'main.log'), `${formatted}\n`)
    } catch { /* silencia */ }
  })
}

// ── Splash window ─────────────────────────────────────────────────────────────

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 380,
    height: 260,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: rgba(5,6,7,0.97);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
    color: #e2e8f0;
    gap: 20px;
    -webkit-app-region: drag;
    overflow: hidden;
  }
  .logo {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    box-shadow: 0 0 32px rgba(99,102,241,0.45);
    animation: pulse 2s ease-in-out infinite;
  }
  h1 { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; }
  p { font-size: 12px; color: rgba(255,255,255,0.42); }
  .bar-wrap {
    width: 180px;
    height: 3px;
    background: rgba(255,255,255,0.08);
    border-radius: 99px;
    overflow: hidden;
  }
  .bar {
    height: 100%;
    border-radius: 99px;
    background: linear-gradient(90deg, #6366f1, #06b6d4);
    animation: slide 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,100% { box-shadow: 0 0 32px rgba(99,102,241,0.45); }
    50%      { box-shadow: 0 0 52px rgba(99,102,241,0.75); }
  }
  @keyframes slide {
    0%   { width: 0%;   margin-left: 0%; }
    50%  { width: 60%;  margin-left: 20%; }
    100% { width: 0%;   margin-left: 100%; }
  }
</style>
</head>
<body>
  <div class="logo">⚡</div>
  <div style="text-align:center;gap:6px;display:flex;flex-direction:column;align-items:center">
    <h1>Aether Memory</h1>
    <p>Iniciando o servidor…</p>
  </div>
  <div class="bar-wrap"><div class="bar"></div></div>
</body>
</html>`

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  splashWindow.once('ready-to-show', () => splashWindow.show())
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
    splashWindow = null
  }
}

// ── Backend ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function isBackendReady() {
  try {
    // /health permanece público também no modo remoto; /config exige token.
    const response = await fetch(API_HEALTH_URL)
    return response.ok
  } catch {
    return false
  }
}

function resolveBackendDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'AetherBackend')
  }
  return path.resolve(__dirname, '..', '..', 'Back-end')
}

function registerAssetProtocol() {
  protocol.handle('nexus-asset', (request) => {
    const assetRoot = path.join(process.resourcesPath, 'NexusAssets')
    const requestedPath = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
    const filePath = path.normalize(path.join(assetRoot, requestedPath))
    const relativePath = path.relative(assetRoot, filePath)

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return new Response('Asset path inválido', { status: 403 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
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

function resolveBackendRuntime() {
  const backendDir = resolveBackendDir()
  if (app.isPackaged) {
    const executable = path.join(backendDir, 'aether-backend')
    return {
      command: executable,
      args: [],
      cwd: backendDir,
      description: executable,
      exists: fs.existsSync(executable),
      selfContained: true,
    }
  }

  const appFile = path.join(backendDir, 'app.py')
  const pythonExecutable = resolvePythonExecutable(backendDir)
  return {
    command: pythonExecutable,
    args: ['app.py'],
    cwd: backendDir,
    description: `${pythonExecutable} ${appFile}`,
    exists: fs.existsSync(appFile),
    selfContained: false,
  }
}

function syncEnvFileToDataDir() {
  const backendEnv = path.join(resolveBackendDir(), '.env')
  const dataEnv = path.join(resolveDataDir(), '.env')

  try {
    fs.mkdirSync(resolveDataDir(), { recursive: true })
    if (fs.existsSync(backendEnv) && !fs.existsSync(dataEnv)) {
      fs.copyFileSync(backendEnv, dataEnv)
    }
    if (fs.existsSync(dataEnv)) {
      fs.chmodSync(dataEnv, 0o600)
    }
  } catch (error) {
    console.warn('[Aether Backend] não consegui preparar .env do app:', error)
  }
}

async function startBackend() {
  // Backend já está rodando (iniciado manualmente ou por outra instância)
  if (await isBackendReady()) {
    logLine('[Aether Backend] usando backend já ativo em 127.0.0.1:5050')
    return true
  }

  const runtime = resolveBackendRuntime()
  const hasLocalEnv = runtime.selfContained || (
    fs.existsSync(path.join(runtime.cwd, 'ambiente')) ||
    fs.existsSync(path.join(runtime.cwd, 'venv')) ||
    fs.existsSync(path.join(runtime.cwd, '.venv'))
  )

  if (!runtime.exists) {
    logLine('[Aether Backend] runtime não encontrado:', runtime.description)
    await dialog.showMessageBox({
      type: 'error',
      title: 'Backend não encontrado',
      message: app.isPackaged
        ? 'O app foi empacotado sem o backend Python autocontido.'
        : 'Não encontrei o app.py do backend.',
      detail: runtime.description,
    })
    return false
  }

  syncEnvFileToDataDir()
  backendLogTail = []
  logLine('[Aether Backend] iniciando', runtime.description, 'cwd=', runtime.cwd)
  backendStartedByElectron = true
  const mobileAccessEnabled = (
    process.platform === 'darwin'
    && String(process.env.NEXUS_DESKTOP_MOBILE_ACCESS || 'true').toLowerCase() !== 'false'
  )

  try {
    backendProcess = spawn(runtime.command, runtime.args, {
      cwd: runtime.cwd,
      env: {
        ...process.env,
        NEXUS_DATA_DIR: resolveDataDir(),
        // No macOS, o desktop também hospeda a API para o app iOS. O modo LAN
        // sempre exige o token gerado dentro do diretório de dados do Aether.
        // Windows preserva o caminho loopback atual e pode optar pelo fluxo
        // mobile executando app.py diretamente.
        NEXUS_HOST: mobileAccessEnabled ? '0.0.0.0' : '127.0.0.1',
        NEXUS_REMOTE_MODE: mobileAccessEnabled ? 'true' : 'false',
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    logLine('[Aether Backend] spawn falhou:', error)
    backendProcess = null
    return false
  }

  // Captura stdout/stderr apenas para o log de arquivo (sem poluir o console)
  backendProcess.stdout.on('data', chunk => rememberBackendLog(chunk))
  backendProcess.stderr.on('data', chunk => rememberBackendLog(chunk))

  backendProcess.on('exit', code => {
    logLine(`[Aether Backend] encerrado com código ${code}`)
    backendProcess = null
  })

  backendProcess.on('error', error => {
    logLine('[Aether Backend] erro no processo:', error)
    backendProcess = null
  })

  // Aguarda o backend responder (até 45 s)
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (await isBackendReady()) return true
    if (!backendProcess) break
    await sleep(1000)
  }

  // Backend não respondeu — mostra erro descritivo
  await dialog.showMessageBox({
    type: hasLocalEnv ? 'warning' : 'error',
    title: 'Backend não iniciou',
    message: 'O Aether Memory não conseguiu ligar o backend automaticamente.',
    detail: [
      `Backend: ${runtime.cwd}`,
      `Runtime: ${runtime.description}`,
      '',
      hasLocalEnv
        ? 'Confira se o Ollama está ativo e se a porta 5050 está livre.'
        : 'O ambiente Python de desenvolvimento não foi encontrado.',
      '',
      backendLogTail.join('\n'),
    ].filter(Boolean).join('\n'),
  })
  return false
}

// ── Main window ───────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: 'Aether Memory',
    backgroundColor: '#050607',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    closeSplash()
    mainWindow.show()
    // Pequena animação de fade-in via opacidade
    mainWindow.setOpacity(0)
    let opacity = 0
    const fadeIn = setInterval(() => {
      opacity = Math.min(1, opacity + 0.08)
      mainWindow.setOpacity(opacity)
      if (opacity >= 1) clearInterval(fadeIn)
    }, 16)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        void shell.openExternal(url)
      }
    } catch {
      logLine('[Electron] URL externa inválida bloqueada:', url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (url !== currentUrl) {
      event.preventDefault()
      logLine('[Electron] navegação do renderer bloqueada:', url)
    }
  })
}

ipcMain.handle('nexus:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar codebase',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('nexus:get-remote-token', () => {
  // O segredo nunca trafega por /api/config: só o renderer local e isolado
  // pode pedi-lo ao processo principal do Electron.
  const tokenFile = path.join(resolveDataDir(), '.nexus_remote_token')
  try {
    if (fs.existsSync(tokenFile)) {
      return fs.readFileSync(tokenFile, 'utf8').trim()
    }

    const envFile = path.join(resolveDataDir(), '.env')
    if (fs.existsSync(envFile)) {
      const line = fs.readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .find(value => value.trim().startsWith('NEXUS_AUTH_TOKEN='))
      if (line) {
        return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
      }
    }
  } catch (error) {
    logLine('[Electron] não foi possível ler o token remoto local:', error)
  }
  return ''
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function stopBackend() {
  if (backendStartedByElectron && backendProcess) {
    logLine('[Aether Backend] encerrando processo filho…')
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
  registerAssetProtocol()

  // Mostra tela de loading enquanto o backend sobe
  createSplash()

  try {
    await startBackend()
  } catch (error) {
    logLine('[Aether Backend] falha ao iniciar:', error)
  }

  // Abre janela principal (a splash fecha automaticamente via ready-to-show)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', stopBackend)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
