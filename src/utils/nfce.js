// Leitura e formatação do XML da NFC-e (nfeProc) armazenado em base64 no banco,
// usadas pela pré-visualização do cupom térmico e pela aba de XML do modal de detalhes.

const PAYMENT_LABELS = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de Crédito',
  '04': 'Cartão de Débito',
  '05': 'Crédito Loja',
  '10': 'Vale Alimentação',
  '11': 'Vale Refeição',
  '12': 'Vale Presente',
  '13': 'Vale Combustível',
  '15': 'Boleto Bancário',
  '16': 'Depósito Bancário',
  '17': 'PIX',
  '18': 'Transferência Bancária',
  '19': 'Programa de Fidelidade',
  '90': 'Sem Pagamento',
  '99': 'Outros'
}

export function decodeBase64Xml (base64Content) {
  if (!base64Content) return ''
  try {
    const binary = atob(base64Content)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

function text (root, tag) {
  if (!root) return ''
  const el = root.getElementsByTagName(tag)[0]
  return el?.textContent?.trim() ?? ''
}

function money (value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '0,00'
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateTime (isoValue) {
  if (!isoValue) return ''
  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) return isoValue
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(date)
}

function formatDoc (doc) {
  if (!doc) return ''
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc
}

export function parseNFCe (xmlText) {
  if (!xmlText) return null

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null

  const infNFe = doc.getElementsByTagName('infNFe')[0]
  if (!infNFe) return null

  const ide = infNFe.getElementsByTagName('ide')[0]
  const emit = infNFe.getElementsByTagName('emit')[0]
  const enderEmit = emit?.getElementsByTagName('enderEmit')[0]
  const dest = infNFe.getElementsByTagName('dest')[0]
  const total = infNFe.getElementsByTagName('ICMSTot')[0]
  const infProt = doc.getElementsByTagName('infProt')[0]
  const infAdic = infNFe.getElementsByTagName('infAdic')[0]
  const qrCodeEl = doc.getElementsByTagName('qrCode')[0]

  const chaveId = infNFe.getAttribute('Id') || ''
  const chave = text(infProt, 'chNFe') || chaveId.replace(/^NFe/, '')

  const itens = Array.from(infNFe.getElementsByTagName('det')).map((det) => {
    const prod = det.getElementsByTagName('prod')[0]
    return {
      numero: det.getAttribute('nItem'),
      codigo: text(prod, 'cProd'),
      descricao: text(prod, 'xProd'),
      unidade: text(prod, 'uCom'),
      quantidade: Number(text(prod, 'qCom')) || 0,
      valorUnitario: Number(text(prod, 'vUnCom')) || 0,
      valorTotal: Number(text(prod, 'vProd')) || 0
    }
  })

  const pagamentos = Array.from(infNFe.getElementsByTagName('detPag')).map((detPag) => {
    const codigo = text(detPag, 'tPag')
    return {
      codigo,
      descricao: PAYMENT_LABELS[codigo] || 'Outros',
      valor: Number(text(detPag, 'vPag')) || 0
    }
  })

  const destDoc = text(dest, 'CNPJ') || text(dest, 'CPF')

  return {
    emitente: {
      nome: text(emit, 'xNome'),
      cnpj: text(emit, 'CNPJ'),
      ie: text(emit, 'IE'),
      endereco: [enderEmit ? text(enderEmit, 'xLgr') : '', enderEmit ? text(enderEmit, 'nro') : '']
        .filter(Boolean).join(', '),
      bairro: text(enderEmit, 'xBairro'),
      cidade: text(enderEmit, 'xMun'),
      uf: text(enderEmit, 'UF')
    },
    identificacao: {
      numero: text(ide, 'nNF'),
      serie: text(ide, 'serie'),
      emissao: formatDateTime(text(ide, 'dhEmi')),
      ambiente: text(ide, 'tpAmb') === '1' ? 'Produção' : 'Homologação'
    },
    itens,
    totais: {
      quantidadeItens: itens.length,
      valorProdutos: money(text(total, 'vProd')),
      valorTotal: money(text(total, 'vNF')),
      tributos: total?.getElementsByTagName('vTotTrib')[0] ? money(text(total, 'vTotTrib')) : null
    },
    pagamentos,
    consumidor: destDoc
      ? { documento: formatDoc(destDoc), nome: text(dest, 'xNome') }
      : null,
    protocolo: {
      numero: text(infProt, 'nProt'),
      autorizacao: formatDateTime(text(infProt, 'dhRecbto'))
    },
    chave,
    informacoesComplementares: text(infAdic, 'infCpl'),
    // Alguns emissores gravam a URL do QR Code em http:// e com "|" (pipe)
    // literal separando os campos do parâmetro "p". Os portais de consulta
    // das SEFAZ hoje em dia exigem https:// e rejeitam o "|" não codificado
    // (400 Bad Request), embora leitores de QR no celular normalmente
    // corrijam isso sozinhos ao abrir o link.
    // TODO: isso foi validado só com a SEFAZ-MT; se algum estado precisar
    // de outro tratamento (ou nenhum), transformar num parâmetro
    // configurável em vez de aplicar sempre.
    qrCode: (qrCodeEl?.textContent?.trim() || '')
      .replace(/^http:\/\//i, 'https://')
      .replace(/\|/g, '%7C')
  }
}

export function formatXml (xmlText) {
  if (!xmlText) return ''
  const collapsed = xmlText.replace(/>\s*</g, '><').trim()
  const withBreaks = collapsed.replace(/(>)(<)(\/*)/g, '$1\n$2$3')

  let pad = 0
  return withBreaks.split('\n').map((line) => {
    const isClosingTag = /^<\/\w/.test(line)
    const isSelfClosing = /\/>$/.test(line)
    const isOpeningTag = /^<\w[^>]*[^/]>$/.test(line) || /^<\w[^>]*>$/.test(line) && !isSelfClosing

    if (isClosingTag) pad = Math.max(pad - 1, 0)

    const indented = '  '.repeat(pad) + line

    if (isOpeningTag && !isClosingTag) pad += 1

    return indented
  }).join('\n')
}

export function highlightXml (formattedXml) {
  if (!formattedXml) return ''
  const escaped = formattedXml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped
    .replace(/([\w:.-]+)=("[^"]*")/g, '<span class="xml-attr">$1</span>=<span class="xml-value">$2</span>')
    .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="xml-tag">$2</span>')
}
