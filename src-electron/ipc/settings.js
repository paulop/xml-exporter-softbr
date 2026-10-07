import { dialog, shell } from 'electron'
import { store } from '../lib/store.js'

const TOTVS_PORTAL_URL = 'https://tec.totvshospitalidade.com/auth/login'

export function getDestinationFolder () {
  return store.get('destinationFolder')
}

export async function setDestinationFolder () {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) {
    return store.get('destinationFolder')
  }
  store.set('destinationFolder', result.filePaths[0])
  return result.filePaths[0]
}

// Dados da empresa (a licença ainda não tem origem — por ora CNPJ e nome fantasia).
export function getCompany () {
  return store.get('company')
}

export function setCompany (payload) {
  store.set('company', {
    cnpj: String(payload?.cnpj ?? ''),
    name: String(payload?.name ?? '')
  })
  return store.get('company')
}

// Consulta o nome fantasia (ou a razão social, se não houver) pelo CNPJ na ReceitaWS.
// Feito no main process pra não esbarrar em CORS. Retorna '' se não achar.
export async function lookupCnpj (cnpj) {
  const digits = String(cnpj ?? '').replace(/\D/g, '')
  if (digits.length !== 14) return ''
  try {
    const res = await fetch(`https://receitaws.com.br/v1/cnpj/${digits}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) return ''
    const data = await res.json()
    if (data?.status === 'ERROR') return ''
    return String(data?.fantasia || data?.nome || '').trim()
  } catch {
    return ''
  }
}

// Contato do contador, destino do envio do .zip de XML.
export function getAccountant () {
  return store.get('accountant')
}

export function setAccountant (payload) {
  store.set('accountant', {
    name: String(payload?.name ?? ''),
    cnpj: String(payload?.cnpj ?? ''),
    whatsapp: String(payload?.whatsapp ?? ''),
    email: String(payload?.email ?? '')
  })
  return store.get('accountant')
}

export function getSearchFolders () {
  return store.get('searchFolders')
}

export async function addSearchFolder () {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) {
    return store.get('searchFolders')
  }
  const folders = store.get('searchFolders')
  const chosen = result.filePaths[0]
  if (!folders.includes(chosen)) {
    store.set('searchFolders', [...folders, chosen])
  }
  return store.get('searchFolders')
}

export function removeSearchFolder (folderPath) {
  const folders = store.get('searchFolders').filter((f) => f !== folderPath)
  store.set('searchFolders', folders)
  return folders
}

// Pastas de NF-e avulsas: separado de `searchFolders` de propósito — essas
// não entram na busca em cascata de lacunas, só são varridas na hora do
// ZIP/log pra copiar direto o que tiver dentro do período escolhido.
export function getNfeCopyFolders () {
  return store.get('nfeCopyFolders')
}

export async function addNfeCopyFolder () {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) {
    return store.get('nfeCopyFolders')
  }
  const folders = store.get('nfeCopyFolders')
  const chosen = result.filePaths[0]
  if (!folders.includes(chosen)) {
    store.set('nfeCopyFolders', [...folders, chosen])
  }
  return store.get('nfeCopyFolders')
}

export function removeNfeCopyFolder (folderPath) {
  const folders = store.get('nfeCopyFolders').filter((f) => f !== folderPath)
  store.set('nfeCopyFolders', folders)
  return folders
}

export function openPortal () {
  shell.openExternal(TOTVS_PORTAL_URL)
}
