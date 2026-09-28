import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import os from 'node:os'
import {
  registerQuasarRuntime,
  resolveElectronAssetsPath
} from '#q-app/electron/main'
import { registerIpcHandlers } from './ipc/index.js'

// needed in case process is undefined under Linux
const platform = process.platform || os.platform()

// Nome técnico fixo do app, usado só para definir a pasta de userData
// (%APPDATA%/xml-exporter-softbr). Precisa ficar estável independente do
// productName/título de exibição, senão trocar o título muda a pasta onde
// as conexões salvas ficam e "perde" os dados já salvos.
app.setName('xml-exporter-softbr')

async function createWindow () {
  /**
   * Initial window options
   */
  const mainWindow = new BrowserWindow({
    title: 'Gerador de Arquivos XML - SoftBR',
    icon: resolveElectronAssetsPath('icons/icon.png'), // Windows and Linux
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    useContentSize: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      // https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/electron-preload-script
      preload: path.join(import.meta.dirname, 'electron-preload.cjs')
    }
  })

  if (import.meta.env.QUASAR_DEV) {
    await mainWindow.loadURL(import.meta.env.QUASAR_APP_URL)
  } else {
    await mainWindow.loadFile('index.html')
  }

  if (import.meta.env.QUASAR_DEBUG) {
    // if on DEV or Production with debug enabled
    mainWindow.webContents.openDevTools()
  } else {
    // we're on production; no access to devtools pls
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools()
    })
  }

  return mainWindow
}

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  registerQuasarRuntime()
  const mainWindow = await createWindow()
  registerIpcHandlers(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (platform !== 'darwin') {
    app.quit()
  }
})
