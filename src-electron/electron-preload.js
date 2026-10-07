/**
 * This file is used specifically for security reasons.
 * Here you can securely expose privileged APIs into the renderer process
 * by leveraging Electron's contextBridge functionality and communicating
 * with the main process through Electron's inter-process communication (IPC).
 *
 * WARNING!
 * The preload script sandboxing offers limited access to a full Node.js environment.
 * Do NOT attempt to import packages from node_modules or use Node.js APIs directly in this file.
 * Instead, use IPC to communicate with the main process and access packages and Node.js
 * functionality there.
 *
 * Example on injecting window.myAPI.doAThing() into renderer thread:
 *
 *   import { contextBridge } from 'electron'
 *
 *   contextBridge.exposeInMainWorld('myAPI', {
 *     doAThing: () => {}
 *   })
 *
 * Preload script documentation:
 * https://www.electronjs.org/docs/latest/tutorial/tutorial-preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import { quasarRuntime } from '#q-app/electron/preload'

/**
 * Can be used in the renderer process through `window.quasarRuntime`
 */
contextBridge.exposeInMainWorld("quasarRuntime", quasarRuntime)

// Argumentos vindos do renderer costumam ser Proxies reativos do Vue/Pinia,
// que o Structured Clone do IPC do Electron não sabe serializar ("An object
// could not be cloned"). Convertendo para dados simples aqui, num único
// lugar, evita ter que lembrar disso em cada chamada pelo app.
function toPlain (value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args.map(toPlain))

function onEvent (channel) {
  return (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

/**
 * Exposed through `window.api` — the renderer's only way to reach
 * SQL Server, the filesystem and the auto-updater, all of which live
 * in the main process.
 */
contextBridge.exposeInMainWorld('api', {
  connections: {
    list: invoke('connections:list'),
    save: invoke('connections:save'),
    delete: invoke('connections:delete'),
    test: invoke('connections:test')
  },
  query: {
    run: invoke('query:run'),
    getSql: invoke('query:getSql'),
    getDefaultSql: invoke('query:getDefaultSql'),
    setSql: invoke('query:setSql'),
    resetSql: invoke('query:resetSql')
  },
  export: {
    downloadOne: invoke('export:downloadOne'),
    downloadZip: invoke('export:downloadZip'),
    downloadReceiptPdf: invoke('export:downloadReceiptPdf'),
    downloadReportCsv: invoke('export:downloadReportCsv'),
    sendZip: invoke('export:sendZip'),
    onProgress: onEvent('export:progress'),
    onUploadProgress: onEvent('export:uploadProgress')
  },
  settings: {
    getDestinationFolder: invoke('settings:getDestinationFolder'),
    setDestinationFolder: invoke('settings:setDestinationFolder'),
    getCompany: invoke('settings:getCompany'),
    setCompany: invoke('settings:setCompany'),
    lookupCnpj: invoke('settings:lookupCnpj'),
    getAccountant: invoke('settings:getAccountant'),
    setAccountant: invoke('settings:setAccountant'),
    syncAutoOpenTask: invoke('settings:syncAutoOpenTask'),
    getSearchFolders: invoke('settings:getSearchFolders'),
    addSearchFolder: invoke('settings:addSearchFolder'),
    removeSearchFolder: invoke('settings:removeSearchFolder'),
    getNfeCopyFolders: invoke('settings:getNfeCopyFolders'),
    addNfeCopyFolder: invoke('settings:addNfeCopyFolder'),
    removeNfeCopyFolder: invoke('settings:removeNfeCopyFolder'),
    openPortal: invoke('settings:openPortal')
  },
  validation: {
    run: invoke('validation:run'),
    cancel: invoke('validation:cancel'),
    onProgress: onEvent('validation:progress')
  },
  app: {
    getVersion: invoke('app:getVersion'),
    consumeAutoRun: invoke('app:consumeAutoRun'),
    checkForUpdates: invoke('app:checkForUpdates'),
    downloadUpdate: invoke('app:downloadUpdate'),
    installUpdate: invoke('app:installUpdate'),
    onUpdateAvailable: onEvent('update:available'),
    onUpdateProgress: onEvent('update:download-progress'),
    onUpdateDownloaded: onEvent('update:downloaded'),
    onUpdateError: onEvent('update:error')
  }
})
