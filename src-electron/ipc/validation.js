import { store } from '../lib/store.js'
import { runValidation, findInaccessibleFolders, ValidationCancelledError } from '../lib/notaValidation.js'
import { validateNfeFolderSequence } from '../lib/nfeCopyFolders.js'

let mainWindowRef = null
let cancelRequested = false

export function init (mainWindow) {
  mainWindowRef = mainWindow
}

export function cancel () {
  cancelRequested = true
}

export async function run (rows, period) {
  cancelRequested = false
  const folders = store.get('searchFolders')

  try {
    const result = await runValidation({
      rows: rows ?? [],
      folders,
      period: period ?? {},
      companyCnpj: String(store.get('company')?.cnpj ?? '').replace(/\D/g, '') || null,
      onProgress: (info) => mainWindowRef?.webContents.send('validation:progress', info),
      isCancelled: () => cancelRequested
    })

    // Validação das pastas de NF-e avulsas (ver nfeCopyFolders.js) entra no
    // mesmo botão "Validar / Auditar" — não é mais uma ação separada na
    // tela de Configurações, usa o mesmo período já consultado.
    result.nfeFolderValidation = await validateNfeFolderSequence(store.get('nfeCopyFolders'), period ?? {})
    result.inaccessibleFolders = await findInaccessibleFolders(folders)
    return result
  } catch (err) {
    if (err instanceof ValidationCancelledError) {
      return { cancelled: true }
    }
    throw err
  }
}
