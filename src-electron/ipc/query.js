import { getConnectionWithPassword } from './connections.js'
import { store } from '../lib/store.js'
import { DEFAULT_SQL, validateSql } from '../lib/default-sql.js'
import { runQuery as runQueryDb } from '../lib/db.js'
import { sendProblemsReport } from './export.js'
import { collectNfeFromFolders } from '../lib/nfeCopyFolders.js'
import { extractFromBase64, withinCollectionPeriod } from '../lib/notaValidation.js'

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
export async function run ({ dataInicial, dataFinal, automatic }) {
  if (!dataInicial || !dataFinal) throw new Error('Informe a data inicial e final.')

  const collectionDate = store.get('accountant')?.collectionDate ?? 'emission'
  const period = { dataInicial, dataFinal, collectionDate }
  // O banco pode só armazenar a autorização dentro do XML. Inclui emissões
  // anteriores como candidatas e aplica a janela depois de ler o protocolo.
  const params = { dataInicial: collectionDate === 'authorization' ? '1753-01-01' : dataInicial, dataFinal }
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
      const selectRow = collectionDate === 'authorization'
        ? (row) => {
            const parsed = extractFromBase64(row.xmlContent)
            return withinCollectionPeriod(parsed.dataAutorizacao ?? row.dataAutorizacao ?? parsed.dataEmissao ?? row.dataEmissao, period)
          }
        : undefined
      const rows = await runQueryDb(connection, password, sqlText, params, selectRow)
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

  if (results.every((result) => result.status === 'rejected')) {
    if (!automatic) {
      const report = await sendProblemsReport({}, period, errors).catch((error) => ({ message: error.message }))
      if (report?.sent) errors.push('Relatório de problemas enviado à Software House.')
      else if (report?.message) errors.push(report.message)
    }
    throw new Error(`Não foi possível consultar nenhuma conexão:\n${errors.join('\n')}`)
  }

  // NF-e das pastas avulsas entram na tabela como mais uma "conexão", pra
  // todos os XMLs do período ficarem num lugar só (e na seleção do .zip).
  // Se a mesma chave já veio do banco, a do banco tem prioridade.
  const nfeFolders = store.get('nfeCopyFolders')
  const chavesBanco = new Set(rows.map((r) => r.chave).filter(Boolean))
  const nfeRows = await collectNfeFromFolders(nfeFolders, period, (folder) => {
    errors.push('Pasta de NF-e avulsa "' + folder + '": pasta não encontrada ou sem acesso')
  })
  rows.push(...nfeRows.filter((r) => !chavesBanco.has(r.chave)))

  const count = rows.length
  const totalValor = rows.reduce((sum, row) => sum + (Number(row.valor) || 0), 0)

  return { rows, count, totalValor, errors, collectionDate }
}
