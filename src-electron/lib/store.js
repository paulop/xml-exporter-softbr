import Store from 'electron-store'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const schema = {
  connections: {
    type: 'array',
    default: []
  },
  activeConnectionId: {
    type: ['string', 'null'],
    default: null
  },
  customSql: {
    type: ['string', 'null'],
    default: null
  },
  destinationFolder: {
    type: ['string', 'null'],
    default: null
  },
  searchFolders: {
    type: 'array',
    default: ['C:\\Custodia', 'Plugin Fiscal\\kcf\\XML']
  },
  appSettings: {
    type: 'object',
    default: { checkUpdatesOnStartup: true }
  },
  schemaVersion: {
    type: 'number',
    default: 1
  }
}

export const store = new Store({ name: 'config', schema })

// Nomes que o app já teve como productName ao longo do histórico. Até essa
// correção, electron-main.js importava o módulo que constrói esse Store de
// forma ESTÁTICA, e um import estático roda o código de todo o módulo
// importado (em cadeia, inclusive este arquivo) ANTES de qualquer código
// do próprio electron-main.js — inclusive antes de `app.setName(...)`, que
// é quem deveria fixar o nome usado aqui. Resultado: a cada vez que o
// productName mudava, o electron-store resolvia um userData diferente
// (baseado no nome padrão do Electron, não no fixo) e as conexões salvas
// "sumiam" — estavam só numa pasta antiga, nunca foram apagadas de verdade.
// Isso já causou perda de configuração (conexões DOCCX01/DOCCX02 e pastas
// de busca) numa instalação real. Se a store atual estiver vazia logo na
// inicialização, tenta recuperar automaticamente de uma pasta antiga antes
// de aceitar que é mesmo uma instalação nova.
const LEGACY_APP_NAMES = ['Gerador de Arquivos XML - SoftBR', 'XML Exporter SoftBR']

export function migrateLegacyConfigIfEmpty () {
  if (store.get('connections').length > 0) return

  const appDataDir = path.dirname(app.getPath('userData'))

  for (const legacyName of LEGACY_APP_NAMES) {
    const legacyConfigPath = path.join(appDataDir, legacyName, 'config.json')
    let legacy
    try {
      legacy = JSON.parse(fs.readFileSync(legacyConfigPath, 'utf-8'))
    } catch {
      continue // pasta não existe nessa máquina, ou config.json ilegível — tenta a próxima
    }

    if (!Array.isArray(legacy.connections) || legacy.connections.length === 0) continue

    store.set('connections', legacy.connections)
    if (legacy.activeConnectionId) store.set('activeConnectionId', legacy.activeConnectionId)
    if (legacy.customSql) store.set('customSql', legacy.customSql)
    if (legacy.destinationFolder) store.set('destinationFolder', legacy.destinationFolder)
    if (Array.isArray(legacy.searchFolders) && legacy.searchFolders.length > 0) {
      store.set('searchFolders', legacy.searchFolders)
    }

    console.log(`Configuração recuperada automaticamente de uma instalação antiga ("${legacyName}").`)
    return
  }
}
