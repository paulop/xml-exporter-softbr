import { getConnectionWithPassword } from './connections.js'
import { store } from '../lib/store.js'
import { DEFAULT_SQL, validateSql } from '../lib/default-sql.js'
import { runQuery } from '../lib/db.js'

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

export async function run ({ connectionId, dataInicial, dataFinal }) {
  if (!connectionId) throw new Error('Selecione uma conexão antes de consultar.')
  if (!dataInicial || !dataFinal) throw new Error('Informe a data inicial e final.')

  const sqlText = getSql()
  const validation = validateSql(sqlText)
  if (!validation.valid) throw new Error(validation.message)

  const { connection, password } = getConnectionWithPassword(connectionId)
  const rows = await runQuery(connection, password, sqlText, { dataInicial, dataFinal })

  const count = rows.length
  const totalValor = rows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0)

  return { rows, count, totalValor }
}
