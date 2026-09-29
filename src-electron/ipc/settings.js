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

export function openPortal () {
  shell.openExternal(TOTVS_PORTAL_URL)
}
