import { safeStorage } from 'electron'

export function encryptSecret (plainText) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('A criptografia de credenciais não está disponível neste sistema.')
  }
  return safeStorage.encryptString(plainText).toString('base64')
}

export function decryptSecret (encryptedBase64) {
  if (!encryptedBase64) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('A criptografia de credenciais não está disponível neste sistema.')
  }
  return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'))
}
