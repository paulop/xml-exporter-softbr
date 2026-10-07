// Configuração inicial: enquanto Empresa ou Contador estiverem vazios, o app
// abre direto nessas telas (nessa ordem) em vez da tela de notas. Devolve a
// próxima tela pendente, ou null quando está tudo preenchido.
export async function pendingSetupRoute () {
  const company = await window.api.settings.getCompany()
  if (!company?.cnpj) return '/company'

  const accountant = await window.api.settings.getAccountant()
  // Só os campos de contato: os toggles de agendamento (booleanos) não contam.
  const hasAccountant = ['name', 'cnpj', 'whatsapp', 'email'].some((k) => String(accountant?.[k] ?? '').trim())
  if (!hasAccountant) return '/settings/accountant'

  return null
}

// Rota pra seguir depois de salvar uma tela da configuração inicial.
export async function nextSetupLocation () {
  const pending = await pendingSetupRoute()
  return pending ? { path: pending, query: { setup: '1' } } : '/'
}
