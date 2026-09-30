import { store } from '../lib/store.js'
import { runValidation, ValidationCancelledError } from '../lib/notaValidation.js'

let mainWindowRef = null
let cancelRequested = false

export function init (mainWindow) {
  mainWindowRef = mainWindow
}

export function cancel () {
  cancelRequested = true
}

export async function run (rows) {
  cancelRequested = false
  const folders = store.get('searchFolders')

  try {
    return await runValidation({
      rows: rows ?? [],
      folders,
      onProgress: (info) => mainWindowRef?.webContents.send('validation:progress', info),
      isCancelled: () => cancelRequested
    })
  } catch (err) {
    if (err instanceof ValidationCancelledError) {
      return { cancelled: true }
    }
    throw err
  }
}
