import { store } from '../lib/store.js'
import { runValidation } from '../lib/notaValidation.js'

export async function run (rows) {
  const folders = store.get('searchFolders')
  return runValidation({ rows: rows ?? [], folders })
}
