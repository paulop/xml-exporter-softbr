import Store from 'electron-store'

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
