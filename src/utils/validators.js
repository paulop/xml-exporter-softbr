export function onlyDigits (value) {
  return String(value ?? '').replace(/\D/g, '')
}

// Valida os dois dígitos verificadores do CNPJ (só números, 14 dígitos).
export function isValidCnpj (value) {
  const cnpj = onlyDigits(value)
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false

  const digitAt = (length) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((acc, w, i) => acc + Number(cnpj[i]) * w, 0)
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }

  return digitAt(12) === Number(cnpj[12]) && digitAt(13) === Number(cnpj[13])
}

export function isValidEmail (value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())
}
