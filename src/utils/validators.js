import { CNPJ } from '@/utils/cnpj'

export function onlyDigits (value) {
  return String(value ?? '').replace(/\D/g, '')
}

// CNPJ sem máscara: letras e números (CNPJ alfanumérico), em maiúsculas, até 14 caracteres.
export function normalizeCnpj (value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z\d]/g, '').slice(0, 14)
}

// Aplica a máscara XX.XXX.XXX/XXXX-XX conforme vai sendo digitado.
export function formatCnpj (value) {
  const v = normalizeCnpj(value)
  return [
    v.slice(0, 2),
    v.length > 2 ? '.' + v.slice(2, 5) : '',
    v.length > 5 ? '.' + v.slice(5, 8) : '',
    v.length > 8 ? '/' + v.slice(8, 12) : '',
    v.length > 12 ? '-' + v.slice(12, 14) : ''
  ].join('')
}

// Valida os dígitos verificadores do CNPJ (numérico ou alfanumérico, ver utils/cnpj.js).
export function isValidCnpj (value) {
  return CNPJ.isValid(normalizeCnpj(value))
}

export function isValidEmail (value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())
}
