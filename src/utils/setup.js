// Configuração inicial: enquanto Empresa, Software House ou Contador estiverem
// vazios, o app abre direto nessas telas (nessa ordem) em vez da tela de notas.
// Devolve a próxima tela pendente, ou null quando está tudo preenchido.
export async function pendingSetupRoute () {
  const company = await window.api.settings.getCompany()
  if (!company?.cnpj) return '/company'

  const accountant = await window.api.settings.getAccountant()
  // Só os campos de contato: os toggles de agendamento (booleanos) não contam.
  const hasAccountant = ['name', 'cnpj', 'whatsapp', 'email'].some((k) => String(accountant?.[k] ?? '').trim())
  if (hasAccountant) return null

  // A Software House só é cobrada enquanto o Contador também está vazio: em
  // instalações que já tinham o Contador antes dessa tela existir, barrar a
  // abertura nela travaria o envio mensal automático (a tela de notas nem
  // chegaria a abrir). Nesses casos ela é preenchida pelo menu.
  const softwareHouse = await window.api.settings.getSoftwareHouse()
  if (!softwareHouse?.cnpj) return '/settings/software-house'

  return '/settings/accountant'
}

// Destinatários padrão do envio: o contador (principal) e, se cadastrados,
// a empresa e a Software House, que recebem uma cópia.
export async function defaultRecipients () {
  const [accountant, company, softwareHouse] = await Promise.all([
    window.api.settings.getAccountant(),
    window.api.settings.getCompany(),
    window.api.settings.getSoftwareHouse()
  ])
  const emails = [accountant?.email, company?.email, softwareHouse?.email].map((e) => String(e ?? '').trim())
  return [...new Set(emails.filter(Boolean))]
}

// Rota pra seguir depois de salvar uma tela da configuração inicial.
export async function nextSetupLocation () {
  const pending = await pendingSetupRoute()
  return pending ? { path: pending, query: { setup: '1' } } : '/'
}
