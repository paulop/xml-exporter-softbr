import { createRequire } from 'node:module'

// mssql é CommonJS; require() evita problemas de interop ESM/CJS
// que o bundler do processo main do Electron introduz com "import default".
// Carregado sob demanda (não no topo do módulo): um require() no topo roda
// assim que o app importa este arquivo, na inicialização — se o pacote
// faltar no build, isso trava o app inteiro ao abrir, não só a consulta.
const require = createRequire(import.meta.url)
let sql = null
function getMssql () {
  if (!sql) sql = require('mssql')
  return sql
}

function buildConfig (connection, password) {
  return {
    server: connection.host,
    port: Number(connection.port) || 1433,
    database: connection.database,
    user: connection.user,
    password,
    options: {
      encrypt: connection.options?.encrypt ?? false,
      trustServerCertificate: connection.options?.trustServerCertificate ?? true
    },
    connectionTimeout: 8000,
    requestTimeout: 60000
  }
}

export async function testConnection (connection, password) {
  const sql = getMssql()
  const pool = new sql.ConnectionPool(buildConfig(connection, password))
  try {
    await pool.connect()
    await pool.request().query('SELECT 1 AS ok')
    return { ok: true, message: 'Conexão realizada com sucesso.' }
  } catch (err) {
    return { ok: false, message: err.message }
  } finally {
    await pool.close().catch(() => {})
  }
}

export async function runQuery (connection, password, sqlText, params) {
  const sql = getMssql()
  const pool = new sql.ConnectionPool(buildConfig(connection, password))
  try {
    await pool.connect()
    const request = pool.request()
    request.input('dataInicial', sql.Date, params.dataInicial)
    request.input('dataFinal', sql.Date, params.dataFinal)
    const result = await request.query(sqlText)
    return result.recordset
  } finally {
    await pool.close().catch(() => {})
  }
}
