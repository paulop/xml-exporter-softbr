import Store from 'electron-store'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { resolveElectronAssetsPath } from '#q-app/electron/main'

const LEGACY_APP_NAMES = ['Gerador de Arquivos XML - SoftBR', 'XML Exporter SoftBR']
const userDataDir = app.getPath('userData')
const legacyConfigPaths = LEGACY_APP_NAMES.map((name) => path.join(path.dirname(userDataDir), name, 'config.json'))
// Verifica antes de instanciar as stores, pois elas criam os JSONs.
const temConfigAtual = fs.existsSync(path.join(userDataDir, 'config.json'))
const instalacaoNova = app.isPackaged && !temConfigAtual &&
  ![path.join(userDataDir, 'last-export.json'), ...legacyConfigPaths].some((file) => fs.existsSync(file))

const schema = {
  connections: {
    type: 'array',
    default: []
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
    default: ['C:\\Custodia']
  },
  nfeCopyFolders: {
    type: 'array',
    default: []
  },
  company: {
    type: 'object',
    default: { cnpj: '', name: '', email: '' }
  },
  softwareHouse: {
    type: 'object',
    default: { cnpj: '', name: '', whatsapp: '', email: '', logo: '' }
  },
  accountant: {
    type: 'object',
    default: { name: '', cnpj: '', whatsapp: '', email: '', autoOpen: false, sendWithoutReview: false }
  },
  uploadHistory: {
    type: 'array',
    default: []
  },
  appSettings: {
    type: 'object',
    default: { checkUpdatesOnStartup: true }
  },
  monthlyScheduleVersion: { type: 'number', default: 0 },
  monthlyScheduleSince: { type: ['string', 'null'], default: null },
  schemaVersion: {
    type: 'number',
    default: 1
  }
}

export const store = new Store({ name: 'config', schema })

if (instalacaoNova) {
  let logo = ''
  try {
    const png = fs.readFileSync(resolveElectronAssetsPath('logo-softbr.png'))
    logo = `data:image/png;base64,${png.toString('base64')}`
  } catch (err) {
    console.warn('Não foi possível carregar a logo padrão da Software House:', err.message)
  }
  store.set('softwareHouse', {
    cnpj: '06278621000118',
    name: 'SOFTBR INFORMATICA',
    whatsapp: '67996035700',
    email: 'softbr@softbr.net',
    logo
  })
} else if (!temConfigAtual) {
  for (const file of legacyConfigPaths) {
    let cadastro
    try {
      cadastro = JSON.parse(fs.readFileSync(file, 'utf-8')).softwareHouse
    } catch {
      continue
    }
    if (!cadastro || typeof cadastro !== 'object' || Array.isArray(cadastro)) continue
    store.set('softwareHouse', { ...schema.softwareHouse.default, ...cadastro })
    break
  }
}

// Último envio bem-sucedido pra contabilidade, num arquivo à parte
// (last-export.json, ao lado do config.json): sobrevive a limpar/resetar as
// configurações e é fácil de ler de fora (suporte, script de verificação).
export const lastExportStore = new Store({
  name: 'last-export',
  schema: {
    monthlyClosings: { type: 'object', default: {} },
    lastSuccess: { type: ['object', 'null'], default: null },
    // Último relatório de problemas mandado por email (ver sendProblemsReport
    // em ipc/export.js), pra não repetir o mesmo email a cada validação.
    lastProblemsReport: { type: ['object', 'null'], default: null }
  }
})

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
    if (legacy.customSql) store.set('customSql', legacy.customSql)
    if (legacy.destinationFolder) store.set('destinationFolder', legacy.destinationFolder)
    if (Array.isArray(legacy.searchFolders) && legacy.searchFolders.length > 0) {
      store.set('searchFolders', legacy.searchFolders)
    }

    console.log(`Configuração recuperada automaticamente de uma instalação antiga ("${legacyName}").`)
    return
  }
}
