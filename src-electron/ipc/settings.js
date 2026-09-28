import { dialog } from 'electron'
import { store } from '../lib/store.js'

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
