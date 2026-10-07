import { randomUUID } from 'node:crypto'
import { store } from '../lib/store.js'
import { encryptSecret, decryptSecret } from '../lib/crypto.js'
import { testConnection as testConnectionDb } from '../lib/db.js'

function toPublic (connection) {
  // eslint-disable-next-line no-unused-vars
  const { encryptedPassword, ...rest } = connection
  return rest
}

export function listConnections () {
  return store.get('connections').map(toPublic)
}

export function saveConnection (payload) {
  if (!payload?.name || !payload?.host || !payload?.database || !payload?.user) {
    throw new Error('Preencha nome, host, banco de dados e usuário.')
  }

  const connections = store.get('connections')
  const isNew = !payload.id
  const id = payload.id || randomUUID()
  const existing = connections.find((c) => c.id === id)

  const record = {
    id,
    name: payload.name,
    host: payload.host,
    port: payload.port ? Number(payload.port) : 1433,
    database: payload.database,
    user: payload.user,
    options: {
      encrypt: !!payload.options?.encrypt,
      trustServerCertificate: payload.options?.trustServerCertificate ?? true
    }
  }

  if (payload.password) {
    record.encryptedPassword = encryptSecret(payload.password)
  } else if (existing) {
    record.encryptedPassword = existing.encryptedPassword
  } else {
    throw new Error('A senha é obrigatória para uma nova conexão.')
  }

  const next = isNew
    ? [...connections, record]
    : connections.map((c) => (c.id === id ? record : c))

  store.set('connections', next)

  return toPublic(record)
}

export function deleteConnection (id) {
  const connections = store.get('connections').filter((c) => c.id !== id)
  store.set('connections', connections)
}

export function getConnectionWithPassword (id) {
  const connection = store.get('connections').find((c) => c.id === id)
  if (!connection) throw new Error('Conexão não encontrada.')
  return { connection, password: decryptSecret(connection.encryptedPassword) }
}

export async function testConnectionPayload (payload) {
  // payload pode ser um formulário novo (com senha) ou referenciar uma conexão já salva (por id)
  if (payload.id && !payload.password) {
    const { connection, password } = getConnectionWithPassword(payload.id)
    return testConnectionDb(connection, password)
  }
  return testConnectionDb(payload, payload.password)
}
