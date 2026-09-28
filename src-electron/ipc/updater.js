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

  autoUpdater.autoDownload = false

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

export async function downloadUpdate () {
  await autoUpdater.downloadUpdate()
}

export function installUpdate () {
  autoUpdater.quitAndInstall()
}
