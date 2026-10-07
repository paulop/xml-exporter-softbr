import { getConnectionWithPassword } from './connections.js'
import { store } from '../lib/store.js'
import { DEFAULT_SQL, validateSql } from '../lib/default-sql.js'
import { runQuery as runQueryDb } from '../lib/db.js'
import { collectNfeFromFolders } from '../lib/nfeCopyFolders.js'
import { findInaccessibleFolders } from '../lib/notaValidation.js'

// Em algumas instalações a coluna de série (e às vezes número) vem como
// texto com zero à esquerda (ex.: "004"). Sem normalizar aqui, a mesma
// série acaba tratada como duas diferentes mais adiante — a validação e o
// log sempre trabalham com número puro (ex.: ao decodificar a chave de um
// arquivo recuperado de pasta), então "004" (string) e 4 (number) não
// batem como a mesma chave de agrupamento.
function toNumber (value) {
  return value !== undefined && value !== null && value !== '' ? Number(value) : value
}

export function getSql () {
  return store.get('customSql') || DEFAULT_SQL
}

export function getDefaultSql () {
  return DEFAULT_SQL
}

export function setSql (sqlText) {
  const result = validateSql(sqlText)
  if (!result.valid) throw new Error(result.message)
  store.set('customSql', sqlText)
  return getSql()
}

export function resetSql () {
  store.set('customSql', null)
  return DEFAULT_SQL
}

// Cada conexão representa um computador/caixa diferente, normalmente com
// séries próprias. O objetivo do app é unir essas fontes num lugar só —
// então consultar não escolhe UMA conexão, percorre TODAS e concatena o
// resultado. Uma conexão fora do ar não derruba as outras: o erro dela
// é reportado, mas o restante segue consolidado normalmente.
export async function run ({ dataInicial, dataFinal }) {
  if (!dataInicial || !dataFinal) throw new Error('Informe a data inicial e final.')

  const sqlText = getSql()
  const validation = validateSql(sqlText)
  if (!validation.valid) throw new Error(validation.message)

  const connections = store.get('connections')
  if (connections.length === 0) {
    throw new Error('Nenhuma conexão configurada. Cadastre em Configurações → Conexões.')
  }

  const results = await Promise.allSettled(
    connections.map(async (conn) => {
      const { connection, password } = getConnectionWithPassword(conn.id)
      const rows = await runQueryDb(connection, password, sqlText, { dataInicial, dataFinal })
      return rows.map((row) => ({ ...row, numero: toNumber(row.numero), serie: toNumber(row.serie), conexao: connection.name }))
    })
  )

  const rows = []
  const errors = []
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      rows.push(...result.value)
    } else {
      errors.push(`${connections[i].name}: ${result.reason?.message ?? String(result.reason)}`)
    }
  })

  if (rows.length === 0 && errors.length > 0) {
    throw new Error(`Não foi possível consultar nenhuma conexão:\n${errors.join('\n')}`)
  }

  // NF-e das pastas avulsas entram na tabela como mais uma "conexão", pra
  // todos os XMLs do período ficarem num lugar só (e na seleção do .zip).
  // Se a mesma chave já veio do banco, a do banco tem prioridade.
  const nfeFolders = store.get('nfeCopyFolders')
  for (const folder of await findInaccessibleFolders(nfeFolders)) {
    errors.push(`Pasta de NF-e avulsa "${folder}": pasta não encontrada ou sem acesso`)
  }
  const chavesBanco = new Set(rows.map((r) => r.chave).filter(Boolean))
  const nfeRows = await collectNfeFromFolders(nfeFolders, { dataInicial, dataFinal })
  rows.push(...nfeRows.filter((r) => !chavesBanco.has(r.chave)))

  const count = rows.length
  const totalValor = rows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0)

  return { rows, count, totalValor, errors }
}
