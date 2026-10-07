import { ipcMain, app } from 'electron'
import * as connections from './connections.js'
import * as query from './query.js'
import * as exportIpc from './export.js'
import * as settings from './settings.js'
import * as updater from './updater.js'
import * as validation from './validation.js'
import { migrateLegacyConfigIfEmpty } from '../lib/store.js'
import { AUTO_RUN_ARG } from '../lib/scheduledTask.js'

// Aberto pela tarefa agendada? Lido uma vez só pela tela de notas, pra a
// execução automática não repetir ao navegar de volta pra ela.
let pendingAutoRun = process.argv.includes(AUTO_RUN_ARG)

export function registerIpcHandlers (mainWindow) {
  migrateLegacyConfigIfEmpty()

  ipcMain.handle('connections:list', () => connections.listConnections())
  ipcMain.handle('connections:save', (_e, payload) => connections.saveConnection(payload))
  ipcMain.handle('connections:delete', (_e, id) => connections.deleteConnection(id))
  ipcMain.handle('connections:test', (_e, payload) => connections.testConnectionPayload(payload))

  ipcMain.handle('query:run', (_e, payload) => query.run(payload))
  ipcMain.handle('query:getSql', () => query.getSql())
  ipcMain.handle('query:getDefaultSql', () => query.getDefaultSql())
  ipcMain.handle('query:setSql', (_e, sqlText) => query.setSql(sqlText))
  ipcMain.handle('query:resetSql', () => query.resetSql())

  ipcMain.handle('export:downloadOne', (_e, item) => exportIpc.downloadOne(item))
  ipcMain.handle('export:downloadZip', (e, items, period) =>
    exportIpc.downloadZip(items, period, (message) => e.sender.send('export:progress', message)))
  ipcMain.handle('export:sendZip', (e, items, period, emails, existingZip) =>
    exportIpc.sendZip(
      items,
      period,
      emails,
      (message) => e.sender.send('export:progress', message),
      (sent, total) => e.sender.send('export:uploadProgress', { sent, total }),
      existingZip
    ))
  ipcMain.handle('export:downloadReceiptPdf', (_e, payload) => exportIpc.downloadReceiptPdf(payload))
  ipcMain.handle('export:downloadReportCsv', (_e, payload) => exportIpc.downloadReportCsv(payload))
  ipcMain.handle('export:getLastSuccess', () => exportIpc.getLastSuccess())

  ipcMain.handle('settings:getDestinationFolder', () => settings.getDestinationFolder())
  ipcMain.handle('settings:setDestinationFolder', () => settings.setDestinationFolder())
  ipcMain.handle('settings:getCompany', () => settings.getCompany())
  ipcMain.handle('settings:setCompany', (_e, payload) => settings.setCompany(payload))
  ipcMain.handle('settings:lookupCnpj', (_e, cnpj) => settings.lookupCnpj(cnpj))
  ipcMain.handle('settings:getAccountant', () => settings.getAccountant())
  ipcMain.handle('settings:setAccountant', (_e, payload) => settings.setAccountant(payload))
  ipcMain.handle('settings:syncAutoOpenTask', () => settings.syncAutoOpenTask())
  ipcMain.handle('settings:getSearchFolders', () => settings.getSearchFolders())
  ipcMain.handle('settings:addSearchFolder', () => settings.addSearchFolder())
  ipcMain.handle('settings:removeSearchFolder', (_e, folderPath) => settings.removeSearchFolder(folderPath))
  ipcMain.handle('settings:getNfeCopyFolders', () => settings.getNfeCopyFolders())
  ipcMain.handle('settings:addNfeCopyFolder', () => settings.addNfeCopyFolder())
  ipcMain.handle('settings:removeNfeCopyFolder', (_e, folderPath) => settings.removeNfeCopyFolder(folderPath))
  ipcMain.handle('settings:openPortal', () => settings.openPortal())

  validation.init(mainWindow)
  ipcMain.handle('validation:run', (_e, rows, period) => validation.run(rows, period))
  ipcMain.handle('validation:cancel', () => validation.cancel())

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:quit', () => app.quit())
  ipcMain.handle('app:consumeAutoRun', () => {
    const auto = pendingAutoRun
    pendingAutoRun = false
    return auto
  })
  ipcMain.handle('app:checkForUpdates', () => updater.checkForUpdates())
  ipcMain.handle('app:downloadUpdate', () => updater.downloadUpdate())
  ipcMain.handle('app:installUpdate', () => updater.installUpdate())

  updater.initAutoUpdater(mainWindow)
}
