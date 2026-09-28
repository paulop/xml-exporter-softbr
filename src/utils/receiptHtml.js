// Monta o HTML autônomo (sem Vue, sem CSS externo) usado para gerar o PDF do
// cupom térmico via Electron `webContents.printToPDF`. Mantido separado do
// ThermalReceipt.vue porque o PDF é renderizado numa BrowserWindow isolada,
// que não tem acesso aos estilos "scoped" injetados pelo Vite na janela principal.

function escapeHtml (value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function money (value) {
  return Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function qty (value) {
  return Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

function row (left, right, cssClass = '') {
  return `<div class="row ${cssClass}"><span>${left}</span><span>${right}</span></div>`
}

export function buildReceiptHtml (nota, qrCodeSvg) {
  const itensHtml = nota.itens.map((item) => `
    <div class="bold">${String(item.numero).padStart(3, '0')} ${escapeHtml(item.codigo)} ${escapeHtml(item.descricao)}</div>
    ${row(`${qty(item.quantidade)} ${escapeHtml(item.unidade)} x R$ ${money(item.valorUnitario)}`, `R$ ${money(item.valorTotal)}`)}
  `).join('')

  const pagamentosHtml = nota.pagamentos.length
    ? `<div class="divider"></div><div class="bold">FORMA PAGAMENTO</div>${
      nota.pagamentos.map((p) => row(`${escapeHtml(p.descricao)}:`, `R$ ${money(p.valor)}`)).join('')
    }`
    : ''

  const consumidorHtml = nota.consumidor
    ? `<div class="divider"></div><div class="bold">CONSUMIDOR</div>
       <div>${escapeHtml(nota.consumidor.documento)}</div>
       ${nota.consumidor.nome ? `<div>${escapeHtml(nota.consumidor.nome)}</div>` : ''}`
    : ''

  const infoHtml = nota.informacoesComplementares
    ? `<div class="divider"></div><div class="bold">INFORMAÇÕES COMPLEMENTARES</div><div class="info">${escapeHtml(nota.informacoesComplementares)}</div>`
    : ''

  const qrHtml = qrCodeSvg
    ? `<div class="center q-my qrcode">${qrCodeSvg}</div>`
    : ''

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    width: 80mm;
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    line-height: 1.4;
    color: #000;
    margin: 0;
    padding: 4mm;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .italic { font-style: italic; }
  .caption { font-size: 10px; }
  .divider { border-top: 1px dashed #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .info { white-space: pre-wrap; word-break: break-word; }
  .q-my { margin: 6px 0; }
  .qrcode svg { width: 140px; height: 140px; }
</style>
</head>
<body>
  <div class="center bold">${escapeHtml(nota.emitente.nome)}</div>
  <div class="center">CNPJ: ${escapeHtml(nota.emitente.cnpj)}${nota.emitente.ie ? ` — IE: ${escapeHtml(nota.emitente.ie)}` : ''}</div>
  ${nota.emitente.endereco ? `<div class="center">${escapeHtml(nota.emitente.endereco)}${nota.emitente.bairro ? ` — ${escapeHtml(nota.emitente.bairro)}` : ''}</div>` : ''}
  ${nota.emitente.cidade ? `<div class="center">${escapeHtml(nota.emitente.cidade)} - ${escapeHtml(nota.emitente.uf)}</div>` : ''}

  <div class="divider"></div>
  <div class="center bold">DANFE NFC-e</div>
  <div class="center">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
  <div class="center italic">Não permite aproveitamento de crédito de ICMS</div>

  <div class="divider"></div>
  ${row('ITEM CÓD DESC QTD UN VL_UNI', 'VL_TOT', 'bold')}
  ${itensHtml}

  <div class="divider"></div>
  ${row('Qtd. Total de Itens:', nota.totais.quantidadeItens)}
  ${row('Valor Total Produtos R$:', nota.totais.valorProdutos)}
  ${row('VALOR A PAGAR R$:', nota.totais.valorTotal, 'bold')}
  ${nota.totais.tributos ? row('Trib. Totais (Lei 12.741/12):', `R$ ${nota.totais.tributos}`, 'caption') : ''}

  ${pagamentosHtml}
  ${consumidorHtml}

  <div class="divider"></div>
  <div class="center">NFC-e N° ${escapeHtml(nota.identificacao.numero)} Série ${escapeHtml(nota.identificacao.serie)}</div>
  <div class="center caption">Emissão: ${escapeHtml(nota.identificacao.emissao)}</div>
  ${nota.protocolo.numero ? `<div class="center caption">Protocolo de Autorização: ${escapeHtml(nota.protocolo.numero)}</div>` : ''}
  ${nota.protocolo.autorizacao ? `<div class="center caption">Data de Autorização: ${escapeHtml(nota.protocolo.autorizacao)}</div>` : ''}
  <div class="center caption">Ambiente: ${escapeHtml(nota.identificacao.ambiente.toUpperCase())}</div>

  <div class="divider"></div>
  <div class="center bold">CHAVE DE ACESSO</div>
  <div class="center">${escapeHtml(nota.chave)}</div>

  ${infoHtml}

  <div class="divider"></div>
  <div class="center">Consulta via leitor de QR Code / SEFAZ</div>
  ${qrHtml}
</body>
</html>`
}
