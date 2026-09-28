import { ipcMain, app } from 'electron'
import * as connections from './connections.js'
import * as query from './query.js'
import * as exportIpc from './export.js'
import * as settings from './settings.js'
import * as updater from './updater.js'

export function registerIpcHandlers (mainWindow) {
  ipcMain.handle('connections:list', () => connections.listConnections())
  ipcMain.handle('connections:save', (_e, payload) => connections.saveConnection(payload))
  ipcMain.handle('connections:delete', (_e, id) => connections.deleteConnection(id))
  ipcMain.handle('connections:test', (_e, payload) => connections.testConnectionPayload(payload))
  ipcMain.handle('connections:setActive', (_e, id) => connections.setActiveConnection(id))
  ipcMain.handle('connections:getActive', () => connections.getActiveConnection())

  ipcMain.handle('query:run', (_e, payload) => query.run(payload))
  ipcMain.handle('query:getSql', () => query.getSql())
  ipcMain.handle('query:getDefaultSql', () => query.getDefaultSql())
  ipcMain.handle('query:setSql', (_e, sqlText) => query.setSql(sqlText))
  ipcMain.handle('query:resetSql', () => query.resetSql())

  ipcMain.handle('export:downloadOne', (_e, item) => exportIpc.downloadOne(item))
  ipcMain.handle('export:downloadZip', (_e, items) => exportIpc.downloadZip(items))
  ipcMain.handle('export:downloadReceiptPdf', (_e, payload) => exportIpc.downloadReceiptPdf(payload))

  ipcMain.handle('settings:getDestinationFolder', () => settings.getDestinationFolder())
  ipcMain.handle('settings:setDestinationFolder', () => settings.setDestinationFolder())

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:checkForUpdates', () => updater.checkForUpdates())
  ipcMain.handle('app:downloadUpdate', () => updater.downloadUpdate())
  ipcMain.handle('app:installUpdate', () => updater.installUpdate())

  updater.initAutoUpdater(mainWindow)
}
