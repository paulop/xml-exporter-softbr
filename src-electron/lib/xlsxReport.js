import { createRequire } from 'node:module'
import { parseXmlDetalhado } from './notaValidation.js'

// exceljs é CommonJS; require() evita problemas de interop ESM/CJS que o
// bundler do processo main do Electron introduz com "import default".
// Carregado sob demanda (só dentro de buildLogWorkbookBuffer), não no topo
// do módulo: um require() no topo roda assim que este arquivo é importado —
// e este arquivo é importado em cadeia a partir de electron-main.js logo na
// inicialização do app (main.js -> ipc/index.js -> ipc/export.js -> aqui).
// Se o pacote estiver faltando no build (já aconteceu), isso travava o app
// inteiro ao abrir, não só o botão "Baixar .zip".
const require = createRequire(import.meta.url)
let ExcelJS = null
function getExcelJS () {
  if (!ExcelJS) ExcelJS = require('exceljs')
  return ExcelJS
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true }
const THIN_GRAY_BORDER = { style: 'thin', color: { argb: 'FFBFBFBF' } }
const BORDERS = { top: THIN_GRAY_BORDER, left: THIN_GRAY_BORDER, bottom: THIN_GRAY_BORDER, right: THIN_GRAY_BORDER }

const FILL_AUTORIZADO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }
const FILL_CANCELADO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }
const FILL_REJEITADO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } }

const MOEDA_FMT = '"R$" #,##0.00'

// Garante tipo numérico puro pra série/número: uma instalação pode gravar
// série com zero à esquerda ("004"), enquanto número decodificado de chave
// recuperada em pasta já vem sempre numérico — sem normalizar, "004" e 4
// formam chaves de agrupamento diferentes e a mesma série "duplica" no
// relatório (é exatamente isso que o `toNumber` em query.js também evita
// na origem; aqui é só uma segunda camada de proteção).
function toNumberOrNull (value) {
  return value !== undefined && value !== null && value !== '' ? Number(value) : null
}

// Mesmo problema da série "4" vs "004": o banco pode devolver status/tipo de
// emissão em qualquer capitalização ("Autorizada", "autorizada"...), e o
// pipeline às vezes gera o valor já em CAIXA ALTA ("AUTORIZADA") pra notas
// recuperadas de pasta. Sem normalizar aqui, viram duas chaves diferentes
// nos agrupamentos do relatório (ex.: "Total por status" listando
// "AUTORIZADA" e "Autorizada" como se fossem situações distintas).
function toUpperOrEmpty (value) {
  return value ? String(value).toUpperCase().trim() : ''
}

function colLetter (n) {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// Lê a data/hora de emissão do jeito literal gravado (string ISO do
// dhEmi/dataEmissao), sem passar por conversão de fuso horário — o que
// importa aqui é o horário local registrado pelo PDV, não o fuso da máquina
// que roda o relatório. new Date()+Intl.DateTimeFormat local deslocaria a
// data (ex.: 15/09 virando 14/09) se a máquina estiver em outro fuso.
function formatData (value) {
  if (!value) return ''
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[3]}/${m[2]}/${m[1]}`
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

function formatHora (value) {
  if (!value) return ''
  if (typeof value === 'string') {
    const m = value.match(/T(\d{2}):(\d{2}):(\d{2})/)
    if (m) return `${m[1]}:${m[2]}:${m[3]}`
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`
}

function sanitizeFileName (value) {
  return String(value ?? '').replace(/[\\/:*?"<>|]/g, '_')
}

// Tipo "de verdade" pelo modelo fiscal (55=NF-e, 65=NFC-e) — é o espaço de
// numeração real que está sendo contado. Usado pra agrupar a análise de
// quebras: um evento de inutilização ocupa o número dentro da MESMA
// sequência NF-e/NFC-e que ele baixou, não uma categoria à parte — do
// contrário o número apareceria duas vezes: "preenchido" como inutilização
// e, ao mesmo tempo, "faltando" na sequência real.
function tipoDocumentoGrupo (parsedXml) {
  const modelo = parsedXml?.modelo
  if (modelo === '55') return 'NF-e'
  if (modelo === '65') return 'NFC-e'
  return modelo ? `Modelo ${modelo}` : 'Não identificado'
}

// Rótulo exibido na coluna "Tipo Documento" da aba XMLs — aqui sim
// "INUTILIZAÇÃO" aparece como categoria própria, só pra deixar claro
// visualmente quais linhas são evento de inutilização e não venda real.
function tipoDocumentoDisplay (item, parsedXml, grupo) {
  if (String(item.tpEmissao ?? '').toUpperCase() === 'INUTILIZAÇÃO' || parsedXml?.tipo === 'inutilizacao') return 'INUTILIZAÇÃO'
  return grupo
}

function statusKind (status) {
  const s = String(status ?? '').toLowerCase()
  if (s.includes('cancelad')) return 'cancelado'
  if (s.includes('rejeitad') || s.includes('denegad')) return 'rejeitado'
  if (s.includes('autorizad')) return 'autorizado'
  return null
}

// Monta a linha "achatada" que alimenta a aba XMLs, combinando os campos já
// conhecidos do item (banco/pipeline de validação, mais confiáveis) com o
// que só existe dentro do XML (razão social, destinatário, valores
// discriminados, protocolo, ambiente).
function buildLinha (item) {
  const parsedXml = item.xmlContent
    ? parseXmlDetalhado(Buffer.from(item.xmlContent, 'base64').toString('utf-8'))
    : null

  const cnpjEmitente = parsedXml?.cnpjEmitente ?? ''
  const chave = item.chave ?? parsedXml?.chave ?? ''
  const dataEmissao = item.dataEmissao ?? parsedXml?.dataEmissao ?? null
  const grupo = tipoDocumentoGrupo(parsedXml)

  return {
    cnpjEmitente,
    razaoSocialEmitente: parsedXml?.razaoSocialEmitente ?? '',
    tipoDocumento: tipoDocumentoDisplay(item, parsedXml, grupo),
    tipoGrupo: grupo,
    modelo: parsedXml?.modelo ?? '',
    numero: toNumberOrNull(item.numero) ?? parsedXml?.numero ?? null,
    serie: toNumberOrNull(item.serie) ?? parsedXml?.serie ?? null,
    dataEmissaoRaw: dataEmissao,
    chave,
    protocolo: parsedXml?.protocolo ?? '',
    status: toUpperOrEmpty(item.status),
    cStat: parsedXml?.cStat ?? '',
    motivo: parsedXml?.xMotivo ?? '',
    cpfCnpjDestinatario: parsedXml?.cnpjDestinatario ?? '',
    nomeDestinatario: parsedXml?.nomeDestinatario ?? '',
    valorTotal: item.valor ?? null,
    valorProdutos: parsedXml?.valorProdutos ?? null,
    valorIcms: parsedXml?.valorIcms ?? null,
    baseIcms: parsedXml?.baseIcms ?? null,
    desconto: parsedXml?.desconto ?? null,
    icmsDesonerado: parsedXml?.icmsDesonerado ?? null,
    frete: parsedXml?.frete ?? null,
    tipoEmissao: toUpperOrEmpty(item.tpEmissao),
    ambiente: parsedXml?.ambiente === 2 ? 'Homologação' : (parsedXml?.ambiente === 1 ? 'Produção' : ''),
    // Conexão (caixa/computador) pra nota vinda do banco; pasta de apoio pra
    // nota de NF-e avulsa ou recuperada via busca em cascata — é o que
    // identifica, linha a linha, de onde cada XML do lote realmente veio.
    origem: item.conexao ?? item.origem ?? 'Banco de dados',
    nomeArquivo: chave ? `${sanitizeFileName(chave)}.xml` : '',
    observacoes: item.metodoRecuperacao ?? '',
    _wellFormed: !!parsedXml
  }
}

// Série e número primeiro — é o que a contabilidade confere visualmente, e
// o Excel do cliente trava ao tentar reordenar manualmente por número numa
// planilha grande, então o arquivo já sai pronto nessa ordem, sem precisar
// que ninguém reordene nada depois de abrir.
function compararOrdenacao (a, b) {
  return (
    (Number(a.serie ?? 0) - Number(b.serie ?? 0)) ||
    (Number(a.numero ?? 0) - Number(b.numero ?? 0)) ||
    String(a.cnpjEmitente).localeCompare(String(b.cnpjEmitente)) ||
    a.tipoDocumento.localeCompare(b.tipoDocumento)
  )
}

// Comprime uma lista de números em faixas legíveis, ex.: [105,107,108,109] -> "105, 107-109".
function formatarFaixas (numeros) {
  const ordenados = [...numeros].sort((a, b) => a - b)
  const faixas = []
  let inicio = ordenados[0]
  let fim = ordenados[0]

  for (let i = 1; i <= ordenados.length; i++) {
    const atual = ordenados[i]
    if (atual === fim + 1) {
      fim = atual
      continue
    }
    faixas.push(inicio === fim ? `${inicio}` : `${inicio}-${fim}`)
    inicio = atual
    fim = atual
  }

  return faixas.join(', ')
}

function buildQuebras (linhas) {
  const grupos = new Map()

  for (const linha of linhas) {
    if (linha.serie === null || linha.numero === null) continue
    // Agrupa pelo tipo "real" (modelo fiscal), não pelo rótulo de exibição:
    // um evento de inutilização precisa cair na MESMA sequência NF-e/NFC-e
    // que ele baixou, senão o número aparece preenchido (como inutilização)
    // e faltando (na sequência real) ao mesmo tempo.
    const chave = `${linha.cnpjEmitente}|${linha.tipoGrupo}|${linha.serie}`
    if (!grupos.has(chave)) {
      grupos.set(chave, { cnpjEmitente: linha.cnpjEmitente, tipoDocumento: linha.tipoGrupo, serie: linha.serie, numeros: [] })
    }
    grupos.get(chave).numeros.push(linha.numero)
  }

  const resultado = []
  for (const grupo of grupos.values()) {
    const numeroInicial = Math.min(...grupo.numeros)
    const numeroFinal = Math.max(...grupo.numeros)
    const presentes = new Set(grupo.numeros)
    const faltantes = []
    for (let n = numeroInicial; n <= numeroFinal; n++) {
      if (!presentes.has(n)) faltantes.push(n)
    }

    resultado.push({
      cnpjEmitente: grupo.cnpjEmitente,
      tipoDocumento: grupo.tipoDocumento,
      serie: grupo.serie,
      numeroInicial,
      numeroFinal,
      numeroFaltante: formatarFaixas(faltantes),
      quantidadeQuebras: faltantes.length,
      observacao: faltantes.length === 0 ? 'Sequência completa' : ''
    })
  }

  resultado.sort((a, b) =>
    String(a.cnpjEmitente).localeCompare(String(b.cnpjEmitente)) ||
    a.tipoDocumento.localeCompare(b.tipoDocumento) ||
    (a.serie - b.serie)
  )

  return resultado
}

function autoFitColumns (worksheet, minWidth = 10, maxWidth = 60) {
  worksheet.columns.forEach((column) => {
    let max = minWidth
    column.eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length
      if (len > max) max = len
    })
    column.width = Math.min(max + 2, maxWidth)
  })
}

function styleHeaderRow (worksheet, headers) {
  const headerRow = worksheet.getRow(1)
  headers.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = label
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.border = BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  headerRow.height = 22
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: 'A1', to: `${colLetter(headers.length)}1` }
}

function addSheetXmls (workbook, linhas) {
  const sheet = workbook.addWorksheet('XMLs')
  const headers = [
    'CNPJ Emitente', 'Razão Social Emitente', 'Tipo Documento', 'Modelo', 'Número', 'Série',
    'Data Emissão', 'Hora Emissão', 'Chave de Acesso', 'Protocolo', 'Status', 'Código Status',
    'Motivo', 'CPF/CNPJ Destinatário', 'Nome Destinatário', 'Valor Total', 'Valor Produtos',
    'Valor ICMS', 'Base ICMS', 'Desconto', 'ICMS Desonerado (vICMSDeson)', 'Frete', 'Tipo Emissão',
    'Ambiente', 'Origem', 'Nome do Arquivo', 'Observações'
  ]
  styleHeaderRow(sheet, headers)

  const moedaCols = new Set([16, 17, 18, 19, 20, 21, 22])
  // Número e série entram aqui também: uma coluna numérica com célula vazia
  // como texto ('') em vez de célula em branco de verdade cria uma coluna de
  // tipo misto (número + texto), que é causa clássica do Excel se comportar
  // mal — às vezes travando — ao tentar ordenar.
  const numericCols = new Set([5, 6, 16, 17, 18, 19, 20, 21, 22])

  let totalAutorizados = 0
  let totalCancelados = 0
  let somaAutorizados = 0
  let somaDesonerado = 0
  let somaGeral = 0

  linhas.forEach((linha, idx) => {
    const row = sheet.getRow(idx + 2)
    const values = [
      linha.cnpjEmitente, linha.razaoSocialEmitente, linha.tipoDocumento, linha.modelo,
      linha.numero, linha.serie, formatData(linha.dataEmissaoRaw), formatHora(linha.dataEmissaoRaw),
      linha.chave, linha.protocolo, linha.status, linha.cStat, linha.motivo,
      linha.cpfCnpjDestinatario, linha.nomeDestinatario, linha.valorTotal, linha.valorProdutos,
      linha.valorIcms, linha.baseIcms, linha.desconto, linha.icmsDesonerado, linha.frete,
      linha.tipoEmissao, linha.ambiente, linha.origem, linha.nomeArquivo, linha.observacoes
    ]
    values.forEach((value, i) => {
      const col = i + 1
      const cell = row.getCell(col)
      cell.value = numericCols.has(col) ? (typeof value === 'number' ? value : null) : (value ?? '')
      cell.border = BORDERS
      if (moedaCols.has(col) && typeof value === 'number') cell.numFmt = MOEDA_FMT
    })

    const kind = statusKind(linha.status)
    if (kind) {
      const fill = kind === 'autorizado' ? FILL_AUTORIZADO : kind === 'cancelado' ? FILL_CANCELADO : FILL_REJEITADO
      row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = fill })
    }

    const valor = Number(linha.valorTotal) || 0
    somaGeral += valor
    if (kind === 'autorizado') {
      totalAutorizados++
      somaAutorizados += valor
      somaDesonerado += Number(linha.icmsDesonerado) || 0
    }
    if (kind === 'cancelado') totalCancelados++
  })

  const footerStart = linhas.length + 3
  const footerLabels = [
    ['Quantidade total de documentos', linhas.length],
    ['Total de documentos autorizados', totalAutorizados],
    ['Total de documentos cancelados', totalCancelados],
    ['Soma total dos valores autorizados', somaAutorizados, true],
    ['Valor total desonerado', somaDesonerado, true],
    ['Valor final (autorizado − desonerado)', somaAutorizados - somaDesonerado, true],
    ['Soma total geral', somaGeral, true]
  ]
  footerLabels.forEach(([label, value, moeda], i) => {
    const row = sheet.getRow(footerStart + i)
    row.getCell(1).value = label
    row.getCell(1).font = { bold: true }
    row.getCell(2).value = value
    if (moeda) row.getCell(2).numFmt = MOEDA_FMT
  })

  autoFitColumns(sheet)
  return sheet
}

function addSheetQuebras (workbook, quebras) {
  const sheet = workbook.addWorksheet('Quebras')
  const headers = [
    'CNPJ Emitente', 'Tipo Documento', 'Série', 'Número Inicial', 'Número Final',
    'Número Faltante', 'Quantidade de Quebras', 'Observação'
  ]
  styleHeaderRow(sheet, headers)

  quebras.forEach((q, idx) => {
    const row = sheet.getRow(idx + 2)
    const values = [
      q.cnpjEmitente, q.tipoDocumento, q.serie, q.numeroInicial, q.numeroFinal,
      q.numeroFaltante, q.quantidadeQuebras, q.observacao
    ]
    values.forEach((value, i) => {
      const cell = row.getCell(i + 1)
      cell.value = value ?? ''
      cell.border = BORDERS
    })
    if (q.quantidadeQuebras > 0) {
      row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = FILL_REJEITADO })
    }
  })

  autoFitColumns(sheet)
  return sheet
}

function addSheetResumo (workbook, linhas, quebras) {
  const sheet = workbook.addWorksheet('Resumo')
  styleHeaderRow(sheet, ['Métrica', 'Valor'])

  const totalValidos = linhas.filter((l) => l._wellFormed).length
  const chaves = linhas.map((l) => l.chave).filter(Boolean)
  const chavesUnicas = new Set(chaves)
  const totalDuplicados = chaves.length - chavesUnicas.size

  const porStatus = new Map()
  const porTipo = new Map()
  const porCnpj = new Map()
  const porOrigem = new Map()
  const series = new Set()
  let valorAutorizado = 0
  let valorDesonerado = 0
  let valorCancelado = 0

  for (const linha of linhas) {
    const statusLabel = linha.status || 'Não informado'
    porStatus.set(statusLabel, (porStatus.get(statusLabel) ?? 0) + 1)
    porTipo.set(linha.tipoDocumento || 'Não identificado', (porTipo.get(linha.tipoDocumento || 'Não identificado') ?? 0) + 1)
    porCnpj.set(linha.cnpjEmitente || 'Não identificado', (porCnpj.get(linha.cnpjEmitente || 'Não identificado') ?? 0) + 1)
    porOrigem.set(linha.origem || 'Não identificado', (porOrigem.get(linha.origem || 'Não identificado') ?? 0) + 1)
    if (linha.serie !== null) series.add(`${linha.cnpjEmitente}|${linha.serie}`)

    const kind = statusKind(linha.status)
    const valor = Number(linha.valorTotal) || 0
    // Desonerado só das autorizadas: é abatido do valor autorizado logo
    // abaixo, então somar o de nota cancelada distorceria o valor final.
    if (kind === 'autorizado') {
      valorAutorizado += valor
      valorDesonerado += Number(linha.icmsDesonerado) || 0
    }
    if (kind === 'cancelado') valorCancelado += valor
  }

  const totalQuebras = quebras.reduce((sum, q) => sum + q.quantidadeQuebras, 0)

  let r = 2
  const metric = (label, value, moeda = false) => {
    const row = sheet.getRow(r++)
    row.getCell(1).value = label
    row.getCell(1).font = { bold: true }
    row.getCell(2).value = value
    if (moeda) row.getCell(2).numFmt = MOEDA_FMT
    row.getCell(1).border = BORDERS
    row.getCell(2).border = BORDERS
  }

  metric('Total de XML lidos', linhas.length)
  metric('Total válidos', totalValidos)
  metric('Total duplicados removidos', totalDuplicados)
  metric('Total de séries', series.size)
  metric('Total de quebras encontradas', totalQuebras)
  metric('Valor total autorizado', valorAutorizado, true)
  metric('Valor total desonerado', valorDesonerado, true)
  metric('Valor final (autorizado − desonerado)', valorAutorizado - valorDesonerado, true)
  metric('Valor total cancelado', valorCancelado, true)

  r++
  const subTitulo = (texto) => {
    const row = sheet.getRow(r++)
    row.getCell(1).value = texto
    row.getCell(1).font = { bold: true, italic: true }
  }

  subTitulo('Total por status')
  for (const [status, qtd] of porStatus) metric(status, qtd)

  r++
  subTitulo('Total por tipo de documento')
  for (const [tipo, qtd] of porTipo) metric(tipo, qtd)

  r++
  subTitulo('Total por CNPJ emitente')
  for (const [cnpj, qtd] of porCnpj) metric(cnpj, qtd)

  r++
  subTitulo('Total por origem')
  for (const [origem, qtd] of porOrigem) metric(origem, qtd)

  r++
  const obsRow = sheet.getRow(r++)
  obsRow.getCell(1).value = 'Observações gerais'
  obsRow.getCell(1).font = { bold: true }
  const obsTexto = totalQuebras > 0
    ? `${totalQuebras} quebra(s) de sequência numérica identificada(s) — ver aba "Quebras" para detalhes.`
    : 'Nenhuma quebra de sequência numérica identificada no lote analisado.'
  sheet.getRow(r).getCell(1).value = obsTexto

  autoFitColumns(sheet)
  return sheet
}

export async function buildLogWorkbookBuffer (items) {
  const linhas = (items ?? []).map(buildLinha).sort(compararOrdenacao)
  const quebras = buildQuebras(linhas)

  const workbook = new (getExcelJS().Workbook)()
  workbook.creator = 'XML Exporter SoftBR'
  workbook.created = new Date()

  addSheetXmls(workbook, linhas)
  addSheetQuebras(workbook, quebras)
  addSheetResumo(workbook, linhas, quebras)

  return workbook.xlsx.writeBuffer()
}
