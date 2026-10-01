import { app, BrowserWindow, Menu, dialog } from 'electron'
import path from 'node:path'
import os from 'node:os'
import {
  registerQuasarRuntime,
  resolveElectronAssetsPath
} from '#q-app/electron/main'
// Import dinâmico, não estático: `ipc/index.js` encadeia import de todo o
// resto do app (connections, query, export, validation...), e um import
// estático que falhar (ex.: dependência faltando no pacote, como já
// aconteceu com o exceljs) trava o processo principal ANTES de qualquer
// código nosso rodar — nem o window.whenReady chega a executar, e não dá
// pra capturar isso com try/catch. Import dinâmico dentro de whenReady()
// permite capturar a falha e tentar `attemptRecoveryViaUpdate` abaixo.

// needed in case process is undefined under Linux
const platform = process.platform || os.platform()

// Nome técnico fixo do app, usado só para definir a pasta de userData
// (%APPDATA%/xml-exporter-softbr). Precisa ficar estável independente do
// productName/título de exibição, senão trocar o título muda a pasta onde
// as conexões salvas ficam e "perde" os dados já salvos — já aconteceu de
// verdade (conexões de produção foram parar em "%APPDATA%/Gerador de
// Arquivos XML - SoftBR" numa instalação real) porque um import ESTÁTICO
// construía o electron-store (lib/store.js) antes dessa linha rodar.
// setPath() abaixo é redundante com setName() de propósito: não queremos
// depender só do efeito indireto de setName() sobre o userData padrão do
// Electron — se algum refactor futuro reintroduzir um import estático cedo
// demais, pelo menos o caminho fica explícito e óbvio aqui.
app.setName('xml-exporter-softbr')
app.setPath('userData', path.join(app.getPath('appData'), 'xml-exporter-softbr'))

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
    show: false,
    webPreferences: {
      contextIsolation: true,
      // https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/electron-preload-script
      preload: path.join(import.meta.dirname, 'electron-preload.cjs')
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
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

let recovering = false

// Se o processo principal falhar ao carregar (ex.: dependência faltando no
// pacote — já aconteceu com o exceljs), não tem como consertar essa versão
// em memória, mas uma versão mais nova já publicada pode ter a correção.
// Em vez de deixar só o diálogo nativo de crash do Electron e um app morto,
// tenta buscar e instalar uma atualização antes de desistir de verdade.
async function attemptRecoveryViaUpdate (err) {
  if (recovering) return
  recovering = true

  console.error('Falha crítica ao iniciar o app:', err)

  if (!app.isPackaged) {
    // Em dev não tem update pra buscar (electron-updater nem funciona fora
    // de app empacotado) — só mostra o erro de verdade, sem fingir que vai
    // se resolver sozinho.
    dialog.showErrorBox('Erro ao iniciar', `O aplicativo não conseguiu iniciar:\n\n${err?.stack ?? err}`)
    app.quit()
    return
  }

  dialog.showMessageBoxSync({
    type: 'info',
    title: 'Problema ao iniciar',
    message: 'O aplicativo encontrou um problema ao iniciar. Procurando uma atualização que pode corrigir isso automaticamente...'
  })

  let updateHandled = false
  try {
    // Import direto do pacote, não do nosso ipc/updater.js — esse também
    // faz parte da cadeia de import que pode ter falhado, então a
    // recuperação não pode depender dela ter funcionado.
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = true

    const updateAvailable = await new Promise((resolve) => {
      autoUpdater.once('update-available', () => resolve(true))
      autoUpdater.once('update-not-available', () => resolve(false))
      autoUpdater.once('error', () => resolve(false))
      autoUpdater.checkForUpdates().catch(() => resolve(false))
    })

    if (updateAvailable) {
      updateHandled = await new Promise((resolve) => {
        autoUpdater.once('update-downloaded', () => resolve(true))
        autoUpdater.once('error', () => resolve(false))
      })
      if (updateHandled) {
        autoUpdater.quitAndInstall()
        return
      }
    }
  } catch (updateErr) {
    console.error('Falha também ao buscar atualização automática:', updateErr)
  }

  dialog.showErrorBox(
    'Não foi possível iniciar',
    'O aplicativo não conseguiu iniciar e não encontramos uma atualização automática para corrigir isso agora. ' +
      'Tente reinstalar baixando a versão mais recente, ou entre em contato com o suporte.'
  )
  app.quit()
}

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  registerQuasarRuntime()
  const mainWindow = await createWindow()

  try {
    const { registerIpcHandlers } = await import('./ipc/index.js')
    registerIpcHandlers(mainWindow)
  } catch (err) {
    await attemptRecoveryViaUpdate(err)
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Rede de segurança pra qualquer outra falha síncrona não tratada durante a
// inicialização que escape do try/catch acima (ex.: erro dentro do próprio
// createWindow/registerQuasarRuntime). Só dispara a recuperação uma vez.
process.on('uncaughtException', (err) => {
  if (BrowserWindow.getAllWindows().length === 0) {
    attemptRecoveryViaUpdate(err)
  } else {
    console.error('Erro não tratado (app já iniciado):', err)
  }
})

app.on('window-all-closed', () => {
  if (platform !== 'darwin') {
    app.quit()
  }
})
