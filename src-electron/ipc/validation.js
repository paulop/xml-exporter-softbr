import { store } from '../lib/store.js'
import { runValidation, findInaccessibleFolders, ValidationCancelledError } from '../lib/notaValidation.js'
import { validateNfeFolderSequence } from '../lib/nfeCopyFolders.js'
import { sendProblemsReport } from './export.js'

let mainWindowRef = null
let cancelRequested = false

export function init (mainWindow) {
  mainWindowRef = mainWindow
}

export function cancel () {
  cancelRequested = true
}

// `sourceErrors`: conexões que falharam na consulta (vêm do renderer), só
// pra entrar no email de problemas.
export async function run (rows, period, sourceErrors = []) {
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

    // Com lacunas não recuperadas ou outros problemas, o relatório vai por
    // email na hora. Uma falha aqui não pode derrubar a validação: volta só
    // como aviso.
    try {
      result.problemsEmail = await sendProblemsReport(result, period ?? {}, sourceErrors ?? [], () => {
        mainWindowRef?.webContents.send('validation:progress', {
          step: 7, totalSteps: 7, label: 'Enviando o relatório de problemas por email'
        })
      })
    } catch (err) {
      result.problemsEmail = { sent: false, message: `Relatório de problemas não enviado por email: ${err.message}` }
    }
    return result
  } catch (err) {
    if (err instanceof ValidationCancelledError) {
      return { cancelled: true }
    }
    throw err
  }
}
