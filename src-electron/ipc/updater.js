import { app } from 'electron'
import { createRequire } from 'node:module'
import { store } from '../lib/store.js'

// electron-updater é CommonJS; require() evita problemas de interop ESM/CJS
// que o bundler do processo main do Electron introduz com imports.
const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater')

let wired = false

export function initAutoUpdater (mainWindow) {
  if (wired) return
  wired = true

  // Atualização silenciosa: baixa sozinho em segundo plano e, quando o app
  // fecha (pelo usuário ou pelo fechamento automático da execução mensal),
  // o instalador NSIS roda sem janela (/S). Na próxima abertura já é a
  // versão nova. Instalação "para todos os usuários" ainda pede o UAC.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update:available', info)
  })
  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:download-progress', progress)
  })
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update:downloaded', info)
  })
  autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('update:error', err?.message ?? String(err))
  })

  if (app.isPackaged && store.get('appSettings')?.checkUpdatesOnStartup) {
    autoUpdater.checkForUpdates().catch(() => {})
  }
}

export async function checkForUpdates () {
  if (!app.isPackaged) {
    return { ok: false, message: 'Verificação de atualização só está disponível em builds empacotados.' }
  }
  await autoUpdater.checkForUpdates()
  return { ok: true }
}

// "Instalar agora": fecha, instala sem janela e reabre o app já atualizado.
export function installUpdate () {
  autoUpdater.quitAndInstall(true, true)
}
