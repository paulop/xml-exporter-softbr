import fs from 'node:fs/promises'
import path from 'node:path'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

// Aceita tanto o fragmento "nfeProc" completo (NFe + protNFe) quanto um <NFe>
// isolado (nota em contingência, ainda sem protocolo de autorização).
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  // Sem isso, o fast-xml-parser converte texto puramente numérico (chave de
  // acesso com 44 dígitos, CNPJ) em Number automaticamente — e tanto chave
  // quanto CNPJ estouram a precisão seguro de um double (~15-17 dígitos),
  // virando notação científica ("5.02609123345e+43") ou perdendo zero à
  // esquerda do CNPJ. O código já chama Number(...) explicitamente em todo
  // campo que precisa ser numérico (nNF, serie, vNF, tpEmis...), então manter
  // tudo como string aqui não quebra nada — só evita essa conversão silenciosa
  // nos campos que precisam ficar texto.
  parseTagValue: false
})

function deepFind (node, tagName) {
  if (node == null || typeof node !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(node, tagName)) return node[tagName]
  for (const key of Object.keys(node)) {
    const value = node[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = deepFind(item, tagName)
        if (found !== undefined) return found
      }
    } else if (typeof value === 'object') {
      const found = deepFind(value, tagName)
      if (found !== undefined) return found
    }
  }
  return undefined
}

export class ValidationCancelledError extends Error {
  constructor () {
    super('Validação cancelada pelo usuário.')
    this.name = 'ValidationCancelledError'
  }
}

function emptyParsed () {
  return {
    tipo: null,
    numero: null,
    serie: null,
    cnpj: null,
    chave: null,
    valor: null,
    dataEmissao: null,
    temProtocolo: false,
    contingencia: false,
    wellFormed: false
  }
}

// Evento de inutilização: a SEFAZ confirma que uma faixa de numeração foi
// formalmente baixada (sem venda nenhuma por trás) — não é uma nota, mas
// precisa entrar na exportação do mesmo jeito, senão a sequência numérica
// fica "furada" sem explicação pra contabilidade.
function parseInutilizacao (infInut) {
  const nNFIni = infInut.nNFIni !== undefined ? Number(infInut.nNFIni) : null
  const nNFFin = infInut.nNFFin !== undefined ? Number(infInut.nNFFin) : null
  const idAttr = String(infInut['@_Id'] || '').replace(/^ID/i, '')

  return {
    tipo: 'inutilizacao',
    numero: nNFIni,
    serie: infInut.serie !== undefined && infInut.serie !== null ? Number(infInut.serie) : null,
    cnpj: infInut.CNPJ ? String(infInut.CNPJ) : null,
    chave: idAttr ? `INUT${idAttr}` : null,
    valor: null,
    dataEmissao: infInut.dhRecbto ? String(infInut.dhRecbto) : null,
    temProtocolo: !!infInut.nProt,
    contingencia: false,
    wellFormed: true,
    inutilizacao: { nNFIni, nNFFin, nProt: infInut.nProt ?? null, xMotivo: infInut.xMotivo ?? null }
  }
}

export function parseXml (xmlString) {
  if (!xmlString || !xmlString.trim()) return emptyParsed()
  if (XMLValidator.validate(xmlString) !== true) return emptyParsed()

  let parsed
  try {
    parsed = parser.parse(xmlString)
  } catch {
    return emptyParsed()
  }

  const infInut = deepFind(parsed, 'infInut')
  if (infInut) return parseInutilizacao(infInut)

  const infNFe = deepFind(parsed, 'infNFe')
  if (!infNFe) return emptyParsed()

  const ide = infNFe.ide
  const emit = infNFe.emit
  const infProt = deepFind(parsed, 'infProt')

  const idAttr = String(infNFe['@_Id'] || '').replace(/^NFe/i, '')
  const chave = String(infProt?.chNFe || idAttr || '').trim() || null
  const tpEmis = ide?.tpEmis
  const vNF = deepFind(infNFe, 'vNF')

  return {
    tipo: 'nfe',
    numero: ide?.nNF !== undefined && ide?.nNF !== null ? Number(ide.nNF) : null,
    serie: ide?.serie !== undefined && ide?.serie !== null ? Number(ide.serie) : null,
    cnpj: emit?.CNPJ ? String(emit.CNPJ) : (emit?.CPF ? String(emit.CPF) : null),
    chave,
    valor: vNF !== undefined && vNF !== null ? Number(vNF) : null,
    dataEmissao: ide?.dhEmi ? String(ide.dhEmi) : (ide?.dEmi ? String(ide.dEmi) : null),
    temProtocolo: !!infProt?.nProt,
    contingencia: tpEmis !== undefined && tpEmis !== null && Number(tpEmis) !== 1,
    wellFormed: true
  }
}

export function extractFromBase64 (base64Content) {
  if (!base64Content) return emptyParsed()
  try {
    return parseXml(Buffer.from(base64Content, 'base64').toString('utf-8'))
  } catch {
    return emptyParsed()
  }
}

// Parse "rico" usado só pelo relatório de log (XLSX): além do que parseXml já
// extrai, traz razão social, destinatário, valores discriminados, protocolo/
// motivo e ambiente — campos que não interessam ao pipeline de validação,
// mas são exigidos coluna a coluna no relatório padrão SoftBR.
export function parseXmlDetalhado (xmlString) {
  if (!xmlString || !xmlString.trim()) return null
  if (XMLValidator.validate(xmlString) !== true) return null

  let parsed
  try {
    parsed = parser.parse(xmlString)
  } catch {
    return null
  }

  const infInut = deepFind(parsed, 'infInut')
  if (infInut) {
    return {
      tipo: 'inutilizacao',
      cnpjEmitente: infInut.CNPJ ? String(infInut.CNPJ) : null,
      razaoSocialEmitente: null,
      modelo: infInut.mod !== undefined ? String(infInut.mod) : null,
      numero: infInut.nNFIni !== undefined ? Number(infInut.nNFIni) : null,
      serie: infInut.serie !== undefined ? Number(infInut.serie) : null,
      dataEmissao: infInut.dhRecbto ? String(infInut.dhRecbto) : null,
      chave: null,
      protocolo: infInut.nProt ? String(infInut.nProt) : null,
      cStat: infInut.cStat !== undefined ? String(infInut.cStat) : null,
      xMotivo: infInut.xMotivo ? String(infInut.xMotivo) : null,
      cnpjDestinatario: null,
      nomeDestinatario: null,
      valorProdutos: null,
      valorIcms: null,
      baseIcms: null,
      desconto: null,
      icmsDesonerado: null,
      frete: null,
      ambiente: infInut.tpAmb !== undefined ? Number(infInut.tpAmb) : null
    }
  }

  const infNFe = deepFind(parsed, 'infNFe')
  if (!infNFe) return null

  const ide = infNFe.ide
  const emit = infNFe.emit
  const dest = infNFe.dest
  const icmsTot = deepFind(infNFe, 'ICMSTot')
  const infProt = deepFind(parsed, 'infProt')

  const idAttr = String(infNFe['@_Id'] || '').replace(/^NFe/i, '')
  const chave = String(infProt?.chNFe || idAttr || '').trim() || null

  const toNumber = (v) => (v !== undefined && v !== null ? Number(v) : null)

  return {
    tipo: 'nfe',
    cnpjEmitente: emit?.CNPJ ? String(emit.CNPJ) : (emit?.CPF ? String(emit.CPF) : null),
    razaoSocialEmitente: emit?.xNome ? String(emit.xNome) : null,
    modelo: ide?.mod !== undefined ? String(ide.mod) : null,
    numero: toNumber(ide?.nNF),
    serie: toNumber(ide?.serie),
    dataEmissao: ide?.dhEmi ? String(ide.dhEmi) : (ide?.dEmi ? String(ide.dEmi) : null),
    chave,
    protocolo: infProt?.nProt ? String(infProt.nProt) : null,
    cStat: infProt?.cStat !== undefined ? String(infProt.cStat) : null,
    xMotivo: infProt?.xMotivo ? String(infProt.xMotivo) : null,
    cnpjDestinatario: dest?.CNPJ ? String(dest.CNPJ) : (dest?.CPF ? String(dest.CPF) : null),
    nomeDestinatario: dest?.xNome ? String(dest.xNome) : null,
    valorProdutos: toNumber(icmsTot?.vProd),
    valorIcms: toNumber(icmsTot?.vICMS),
    baseIcms: toNumber(icmsTot?.vBC),
    desconto: toNumber(icmsTot?.vDesc),
    icmsDesonerado: toNumber(icmsTot?.vICMSDeson),
    frete: toNumber(icmsTot?.vFrete),
    ambiente: toNumber(ide?.tpAmb)
  }
}

// A chave de acesso da NF-e/NFC-e (44 dígitos) embute cUF(2) + AAMM(4) +
// CNPJ(14) + mod(2) + série(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1). Como
// o nome do arquivo normalmente contém a própria chave, dá pra decodificar
// tudo isso (inclusive número/série, usados na busca de lacunas) direto do
// nome — sem abrir nem parsear o conteúdo do arquivo.
export function extractChaveFromFileName (fileName) {
  const match = fileName.match(/\d{44}/)
  return match ? match[0] : null
}

export function decodeChave (chave) {
  return {
    cnpj: chave.slice(6, 20),
    // posições 21-22 são o "mod" (modelo do documento fiscal: 65 = NFC-e,
    // 55 = NF-e) — vêm antes da série.
    modelo: chave.slice(20, 22),
    serie: Number(chave.slice(22, 25)),
    numero: Number(chave.slice(25, 34))
  }
}

// AAMM (ano/mês de emissão, 2 dígitos cada) vem logo após o cUF — dá pra
// filtrar candidatos por mês sem abrir o arquivo, igual ao resto do nome.
export function decodeAnoMesFromChave (chave) {
  return { ano: Number(chave.slice(2, 4)), mes: Number(chave.slice(4, 6)) }
}

// Meses (no formato AA|M da chave) que o período toca — a chave só guarda
// ano/mês, então é o máximo que dá pra filtrar só pelo nome do arquivo.
export function monthsInRange (dataInicial, dataFinal) {
  const months = new Set()
  if (!dataInicial || !dataFinal) return months

  const [anoIni, mesIni] = dataInicial.split('-').map(Number)
  const [anoFin, mesFin] = dataFinal.split('-').map(Number)

  let ano = anoIni
  let mes = mesIni
  while (ano < anoFin || (ano === anoFin && mes <= mesFin)) {
    months.add(`${ano % 100}|${mes}`)
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  return months
}

export function periodBounds (dataInicial, dataFinal) {
  return {
    startDate: dataInicial ? new Date(`${dataInicial}T00:00:00`) : null,
    endDate: dataFinal ? new Date(`${dataFinal}T23:59:59.999`) : null
  }
}

export function withinPeriod (dataEmissao, startDate, endDate) {
  if (!dataEmissao) return false
  const emitida = new Date(dataEmissao)
  if (Number.isNaN(emitida.getTime())) return false
  if (startDate && emitida < startDate) return false
  if (endDate && emitida > endDate) return false
  return true
}

// Nota que nunca chegou a existir no banco (nem a chave é conhecida), mas o
// Plugin Fiscal/DocFiscAll grava um "lote de envio" com série/número no
// próprio nome (ex. "serie_004_rp_72747293_numero_29337_..._env-lot.xml").
// Confirmado manualmente: esse arquivo contém o <NFe> completo (não é só um
// envelope SOAP de protocolo — isso é o "ret-lot", que não serve pra isso).
const LOTE_ENVIO_RE = /serie[_-](\d+)[_-].*numero[_-](\d+).*env-?lot/i

function extractSerieNumeroFromLoteEnvio (fileName) {
  const match = fileName.match(LOTE_ENVIO_RE)
  if (!match) return null
  return { serie: Number(match[1]), numero: Number(match[2]) }
}

// Faixa de numeração inutilizada: número que nunca existiu porque foi
// formalmente baixado junto à SEFAZ, não porque a venda se perdeu. O
// "retorno" tem o protocolo (nProt) que comprova a baixa; o "envio" é só o
// pedido, sem protocolo — por isso só o retorno é reconhecido aqui.
const INUTILIZACAO_RE = /inutilizacao_serie[_-](\d+)_faixa[_-](\d+)[_-](\d+).*retorno/i

function extractInutilizacaoFromFileName (fileName) {
  const match = fileName.match(INUTILIZACAO_RE)
  if (!match) return null
  return { serie: Number(match[1]), nNFIni: Number(match[2]), nNFFin: Number(match[3]) }
}

export async function listXmlFilesRecursive (dir) {
  const found = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await listXmlFilesRecursive(fullPath)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
      found.push(fullPath)
    }
  }
  return found
}

// `listXmlFilesRecursive` ignora pasta que não abre (devolve lista vazia),
// então quem precisa avisar o usuário pergunta aqui quais das pastas
// configuradas estão inacessíveis (não existe, rede fora, sem permissão).
export async function findInaccessibleFolders (folders) {
  const inaccessible = []
  for (const folder of folders ?? []) {
    try {
      const stat = await fs.stat(folder)
      if (!stat.isDirectory()) inaccessible.push(folder)
    } catch {
      inaccessible.push(folder)
    }
  }
  return inaccessible
}

async function loadFolderEntry (match) {
  if (!match) return null
  let xmlString
  try {
    xmlString = await fs.readFile(match.filePath, 'utf-8')
  } catch {
    return null
  }
  return { filePath: match.filePath, folder: match.folder, via: match.via, xmlString, parsed: parseXml(xmlString) }
}

// Ordem da lista `folders` define prioridade: a primeira pasta que contiver
// o arquivo vence em caso de coincidência. Tudo aqui é decodificado do NOME
// do arquivo (a própria chave já carrega chave/CNPJ/série/número) — nenhum
// conteúdo é lido nesta fase, então o custo é o mesmo listar 100 ou 100 mil
// arquivos. O conteúdo só é lido, sob demanda, para os poucos arquivos que
// realmente batem com alguma nota que precisa ser recuperada.
export async function buildFolderIndex (folders, { onProgress, isCancelled } = {}) {
  const byChave = new Map()
  const byNumSerieCnpj = new Map()
  const byNumSerie = new Map()
  // Todos os números de cada série (CNPJ+modelo+série) que existem na pasta,
  // com o mês de emissão da chave — é o que permite achar notas ANTES do
  // primeiro ou DEPOIS do último número que o banco devolveu (ver
  // extendGroupsFromFolders), coisa que byNumSerie sozinho não responde.
  const bySerie = new Map()

  onProgress?.({ phase: 'listing', message: 'Listando arquivos nas pastas configuradas...' })

  const allFiles = []
  for (const folder of folders ?? []) {
    if (isCancelled?.()) throw new ValidationCancelledError()
    const files = await listXmlFilesRecursive(folder)
    for (const filePath of files) allFiles.push({ filePath, folder })
  }

  onProgress?.({ phase: 'listed', totalFound: allFiles.length })

  for (const { filePath, folder } of allFiles) {
    if (isCancelled?.()) throw new ValidationCancelledError()

    const name = path.basename(filePath)

    // XML corrompido/ausente no banco: o export sempre grava "<chave>.xml",
    // então um nome de arquivo EXATAMENTE igual a isso é garantidamente a
    // nota certa.
    const stem = name.slice(0, name.length - 4) // remove ".xml"/".XML" (já garantido pela listagem)
    if (/^\d{44}$/.test(stem) && !byChave.has(stem)) {
      byChave.set(stem, { filePath, folder, via: 'chave-exata' })
    }

    // Lacuna de numeração: a chave pode estar em qualquer posição do nome
    // (ex. "..._chave_<chave>-nfe.xml"); número/série/CNPJ saem direto dela.
    const chave = extractChaveFromFileName(name)
    if (chave) {
      const { cnpj, modelo, serie, numero } = decodeChave(chave)
      const numSerieKey = `${serie}|${numero}`
      if (!byNumSerie.has(numSerieKey)) byNumSerie.set(numSerieKey, { filePath, folder, via: 'chave-no-nome' })

      const fullKey = `${cnpj}|${numSerieKey}`
      if (!byNumSerieCnpj.has(fullKey)) byNumSerieCnpj.set(fullKey, { filePath, folder, via: 'chave-no-nome' })

      const serieKey = `${cnpj}|${modelo}|${serie}`
      if (!bySerie.has(serieKey)) bySerie.set(serieKey, { cnpj, modelo, serie, numeros: new Map() })
      const numeros = bySerie.get(serieKey).numeros
      if (!numeros.has(numero)) {
        const { ano, mes } = decodeAnoMesFromChave(chave)
        numeros.set(numero, { filePath, folder, ano, mes })
      }
    }
  }

  // Segunda passada, só pra preencher lacunas que a chave (passada acima)
  // não resolveu: nota que nem chegou a existir no banco e cujo arquivo não
  // tem a chave em lugar nenhum do nome, só o lote de envio ao SEFAZ. Roda
  // depois, e só complementa (nunca sobrescreve) pra chave continuar tendo
  // prioridade sobre o lote quando as duas existirem.
  for (const { filePath, folder } of allFiles) {
    if (isCancelled?.()) throw new ValidationCancelledError()

    const found = extractSerieNumeroFromLoteEnvio(path.basename(filePath))
    if (!found) continue

    const numSerieKey = `${found.serie}|${found.numero}`
    if (!byNumSerie.has(numSerieKey)) byNumSerie.set(numSerieKey, { filePath, folder, via: 'lote-envio' })
  }

  // Terceira passada, última prioridade: número sem nota nenhuma (nem real,
  // nem lote de envio) porque a faixa foi inutilizada junto à SEFAZ. Uma
  // faixa cobre vários números (nNFIni..nNFFin), então expande cada um.
  for (const { filePath, folder } of allFiles) {
    if (isCancelled?.()) throw new ValidationCancelledError()

    const faixa = extractInutilizacaoFromFileName(path.basename(filePath))
    if (!faixa) continue

    for (let numero = faixa.nNFIni; numero <= faixa.nNFFin; numero++) {
      const numSerieKey = `${faixa.serie}|${numero}`
      if (!byNumSerie.has(numSerieKey)) byNumSerie.set(numSerieKey, { filePath, folder, via: 'inutilizacao' })
    }
  }

  return { byChave, byNumSerieCnpj, byNumSerie, bySerie, totalFound: allFiles.length }
}

function lookupByNumeroSerie (folderIndex, cnpj, serie, numero) {
  const exact = folderIndex.byNumSerieCnpj.get(`${cnpj ?? ''}|${serie}|${numero}`)
  if (exact) return exact
  return folderIndex.byNumSerie.get(`${serie}|${numero}`) ?? null
}

// Agrupa as linhas da consulta por série e detecta lacunas na numeração
// (números que nunca apareceram no resultado da query — a linha não existe).
export function detectGroups (rows) {
  const bySerie = new Map()

  for (const row of rows) {
    const serie = row.serie !== undefined && row.serie !== null ? Number(row.serie) : null
    const numero = row.numero !== undefined && row.numero !== null ? Number(row.numero) : null
    if (serie === null || !Number.isFinite(numero)) continue
    if (!bySerie.has(serie)) bySerie.set(serie, [])
    bySerie.get(serie).push(row)
  }

  const groups = []

  for (const [serie, groupRows] of bySerie.entries()) {
    const numeros = groupRows.map((r) => Number(r.numero))
    const numeroInicial = Math.min(...numeros)
    const numeroFinal = Math.max(...numeros)
    const presentes = new Set(numeros)

    const lacunas = []
    for (let n = numeroInicial; n <= numeroFinal; n++) {
      if (!presentes.has(n)) lacunas.push(n)
    }

    // Conexão(ões) de onde vieram as notas da série — normalmente uma só (cada
    // caixa com a sua série), mas a série pode aparecer em mais de uma.
    const conexoes = [...new Set(groupRows.map((r) => r.conexao).filter(Boolean))]

    let cnpj = null
    for (const row of groupRows) {
      if (!row.xmlContent) continue
      const parsed = extractFromBase64(row.xmlContent)
      if (parsed.cnpj) { cnpj = parsed.cnpj; break }
    }

    // Modelo (65/55) só existe na chave; o CNPJ também sai dela quando
    // nenhuma linha da série tem XML legível no banco.
    let modelo = null
    for (const row of groupRows) {
      const chave = String(row.chave ?? '')
      if (!/^\d{44}$/.test(chave)) continue
      const decoded = decodeChave(chave)
      modelo = decoded.modelo
      cnpj = cnpj ?? decoded.cnpj
      break
    }

    groups.push({
      serie,
      cnpj,
      modelo,
      conexoes,
      numeroInicial,
      numeroFinal,
      quantidadeEsperada: numeroFinal - numeroInicial + 1,
      lacunas,
      numerosBanco: presentes
    })
  }

  return groups
}

// Mantém a primeira ocorrência de cada chave; a ordem de `items` já reflete
// a prioridade (banco de dados primeiro, depois pastas na ordem configurada).
export function dedupeByChave (items) {
  const comChave = items.filter((i) => i.chave)
  const semChave = items.filter((i) => !i.chave)
  const seen = new Map()
  const duplicates = []

  for (const item of comChave) {
    const existing = seen.get(item.chave)
    if (existing) {
      duplicates.push({ chave: item.chave, mantidoDe: existing.origem, descartadoDe: item.origem })
    } else {
      seen.set(item.chave, item)
    }
  }

  return { kept: [...seen.values(), ...semChave], duplicates }
}

function stripInternal (item) {
  const { _parsed, ...rest } = item
  return rest
}

// Descrição amigável de como a nota foi encontrada, pra aparecer no log —
// é esse trabalho de recuperação que justifica a ferramenta existir.
const METODO_RECUPERACAO = {
  'chave-exata': 'Nome exato da chave',
  'chave-no-nome': 'Chave de acesso no nome do arquivo',
  'lote-envio': 'Lote de envio à SEFAZ (nota nunca chegou a ser gravada no banco)',
  'fora-do-intervalo': 'Fora do intervalo do banco (emissão no período, banco sem registro)',
  inutilizacao: 'Faixa inutilizada junto à SEFAZ (sem nota correspondente)'
}

function buildRecoveredItem (base, found) {
  const { parsed } = found
  const isInutilizacao = parsed.tipo === 'inutilizacao'
  return {
    numero: parsed.numero ?? base.numero ?? null,
    serie: parsed.serie ?? base.serie ?? null,
    chave: parsed.chave ?? base.chave ?? null,
    // Lacuna de numeração não tem linha de banco (base é só {numero,serie,cnpj}),
    // então esses campos vêm do próprio XML recuperado; nota com XML
    // corrompido/ausente já tinha essas colunas no banco — nesse caso elas
    // têm prioridade por serem mais confiáveis que o que dá pra inferir do XML.
    dataEmissao: base.dataEmissao ?? parsed.dataEmissao ?? null,
    valor: base.valor ?? parsed.valor ?? null,
    tpEmissao: base.tpEmissao ?? (isInutilizacao ? 'INUTILIZAÇÃO' : (parsed.contingencia ? 'CONTINGÊNCIA' : 'NORMAL')),
    // O "lote de envio" recuperado é o próprio pedido mandado à SEFAZ — não
    // carrega protocolo (isso fica só no "ret-lot", que não tem a nota em
    // si). Sem informação de cancelamento no XML, a venda é tratada como
    // válida/autorizada, que é a situação real da imensa maioria dos casos
    // em que a nota só está ausente do banco por falha de gravação local.
    // Faixa inutilizada é um caso à parte: não é venda nenhuma, é a própria
    // baixa formal do número junto à SEFAZ.
    status: base.status ?? (isInutilizacao ? 'INUTILIZADA' : 'AUTORIZADA'),
    xmlStatus: 'DISPONÍVEL',
    xmlContent: Buffer.from(found.xmlString, 'utf-8').toString('base64'),
    origem: path.basename(found.folder),
    metodoRecuperacao: METODO_RECUPERACAO[found.via] ?? 'Pasta de apoio',
    _parsed: parsed
  }
}

function applyFaixa (group, numerosExtras) {
  const todos = [...group.numerosBanco, ...numerosExtras]
  const presentes = new Set(todos)
  group.numeroInicial = Math.min(...todos)
  group.numeroFinal = Math.max(...todos)
  group.quantidadeEsperada = group.numeroFinal - group.numeroInicial + 1
  group.lacunas = []
  for (let n = group.numeroInicial; n <= group.numeroFinal; n++) {
    if (!presentes.has(n)) group.lacunas.push(n)
  }
}

// A lacuna de numeração (detectGroups) só enxerga o que fica ENTRE o
// primeiro e o último número que o banco devolveu. Quando o banco para no
// meio do período (ex.: consulta de 01 a 30, mas o banco só tem até o dia
// 14) ou começa depois do início, as notas das pontas nem viram lacuna — e
// o relatório ainda mostra a série como completa. Aqui a pasta de apoio
// estende cada série pras pontas: entra todo número fora da faixa do banco
// cuja emissão (confirmada no XML, não só pelo mês da chave) cai dentro do
// período. Série que só existe na pasta (caixa sem nada no banco no
// período) entra também, desde que seja do mesmo CNPJ/modelo das notas do
// banco ou da empresa configurada — a pasta pode ter documento de outra
// empresa ou NF-e misturada. A faixa da série é recalculada, então o que
// faltar no meio do trecho estendido vira lacuna normal e passa pela busca
// em cascata logo depois.
async function extendGroupsFromFolders (groups, folderIndex, { period, companyCnpj, isCancelled }) {
  const months = monthsInRange(period?.dataInicial, period?.dataFinal)
  if (months.size === 0 || folderIndex.bySerie.size === 0) return []
  const { startDate, endDate } = periodBounds(period.dataInicial, period.dataFinal)

  const knownCnpjs = new Set(groups.map((g) => g.cnpj).filter(Boolean))
  if (companyCnpj) knownCnpjs.add(companyCnpj)
  const knownModelos = new Set(groups.map((g) => g.modelo).filter(Boolean))
  if (knownModelos.size === 0) knownModelos.add('65')

  // Junta os números da série (pode haver mais de um CNPJ aceito quando o
  // do grupo não é conhecido) que estão em mês do período e passam no filtro.
  const collectCandidatos = (serie, aceitaCnpj, aceitaModelo, aceitaNumero) => {
    const candidatos = new Map()
    for (const entry of folderIndex.bySerie.values()) {
      if (entry.serie !== serie || !aceitaCnpj(entry.cnpj) || !aceitaModelo(entry.modelo)) continue
      for (const [numero, info] of entry.numeros) {
        if (candidatos.has(numero) || !aceitaNumero(numero)) continue
        if (!months.has(`${info.ano}|${info.mes}`)) continue
        candidatos.set(numero, info)
      }
    }
    return [...candidatos].sort((a, b) => a[0] - b[0])
  }

  const confirmar = async (serie, candidatos) => {
    const confirmados = []
    for (const [numero, info] of candidatos) {
      if (isCancelled?.()) throw new ValidationCancelledError()
      const found = await loadFolderEntry({ ...info, via: 'fora-do-intervalo' })
      const parsed = found?.parsed
      if (!parsed?.wellFormed || parsed.tipo !== 'nfe') continue
      if (parsed.serie !== serie || parsed.numero !== numero) continue
      if (!withinPeriod(parsed.dataEmissao, startDate, endDate)) continue
      confirmados.push(buildRecoveredItem({ numero, serie, cnpj: parsed.cnpj }, found))
    }
    return confirmados
  }

  const extended = []

  for (const group of groups) {
    const candidatos = collectCandidatos(
      group.serie,
      (cnpj) => (group.cnpj ? cnpj === group.cnpj : (knownCnpjs.size === 0 || knownCnpjs.has(cnpj))),
      (modelo) => (group.modelo ? modelo === group.modelo : knownModelos.has(modelo)),
      (numero) => numero < group.numeroInicial || numero > group.numeroFinal
    )
    if (candidatos.length === 0) continue

    const confirmados = await confirmar(group.serie, candidatos)
    if (confirmados.length === 0) continue

    applyFaixa(group, confirmados.map((i) => i.numero))
    group.foraDoIntervalo = confirmados.length
    extended.push(...confirmados)
  }

  // Séries só da pasta: sem CNPJ conhecido não dá pra separar o que é da
  // empresa do que é de outra, então nesse caso não arrisca.
  if (knownCnpjs.size > 0) {
    const seriesConhecidas = new Set(groups.map((g) => g.serie))
    const seriesSoNaPasta = new Set()
    for (const entry of folderIndex.bySerie.values()) {
      if (seriesConhecidas.has(entry.serie)) continue
      if (!knownCnpjs.has(entry.cnpj) || !knownModelos.has(entry.modelo)) continue
      seriesSoNaPasta.add(entry.serie)
    }

    for (const serie of [...seriesSoNaPasta].sort((a, b) => a - b)) {
      const candidatos = collectCandidatos(serie, (c) => knownCnpjs.has(c), (m) => knownModelos.has(m), () => true)
      const confirmados = await confirmar(serie, candidatos)
      if (confirmados.length === 0) continue

      const chave = String(confirmados[0].chave ?? '')
      const decoded = /^\d{44}$/.test(chave) ? decodeChave(chave) : null
      const group = {
        serie,
        cnpj: confirmados[0]._parsed.cnpj ?? decoded?.cnpj ?? null,
        modelo: decoded?.modelo ?? null,
        conexoes: [],
        numerosBanco: new Set(),
        foraDoIntervalo: confirmados.length
      }
      applyFaixa(group, confirmados.map((i) => i.numero))
      groups.push(group)
      extended.push(...confirmados)
    }
  }

  return extended
}

const TOTAL_STEPS = 7

export async function runValidation ({ rows, folders, period, companyCnpj, onProgress, isCancelled }) {
  const steps = []

  const reportStep = (step, label) => onProgress?.({ step, totalSteps: TOTAL_STEPS, label })
  const checkCancelled = () => { if (isCancelled?.()) throw new ValidationCancelledError() }

  reportStep(1, 'Extração do banco de dados')
  checkCancelled()

  // Passo 2 — validação estrutural e protocolo SEFAZ: apenas contagem por tipo.
  // A desmarcação em si (exclusão do pacote final) acontece no passo 6: XML
  // corrompido/ausente ou emissão em contingência. Notas sem protocolo
  // (mas emitidas normalmente) não são desmarcadas aqui.
  const rowsAnnotated = rows.map((row) => ({
    ...row,
    origem: row.nfeAvulsa ? row.origem : 'banco de dados',
    _parsed: row.xmlContent ? extractFromBase64(row.xmlContent) : emptyParsed()
  }))

  reportStep(2, 'Validação estrutural e protocolo SEFAZ')

  const grupos = { normal: [], offline: [], autorizada: [], cancelada: [], inutilizada: [], xmlInvalido: [] }

  for (const row of rowsAnnotated) {
    if (!row.xmlContent || !row._parsed.wellFormed) {
      if (row.chave) grupos.xmlInvalido.push(row.chave)
      continue
    }

    const tpEmissao = String(row.tpEmissao ?? '').trim().toLowerCase()
    if (tpEmissao.includes('normal')) grupos.normal.push(row.chave)
    else grupos.offline.push(row.chave)

    const status = String(row.status ?? '').trim().toLowerCase()
    if (status.includes('cancelad')) grupos.cancelada.push(row.chave)
    else if (status.includes('inutilizad')) grupos.inutilizada.push(row.chave)
    else if (status.includes('autorizad')) grupos.autorizada.push(row.chave)
  }

  steps.push({
    id: 'estrutura-protocolo',
    label: 'Validação estrutural e protocolo SEFAZ',
    status: grupos.xmlInvalido.length > 0 ? 'warn' : 'ok',
    detail: `Normal: ${grupos.normal.length} · Offline: ${grupos.offline.length} · ` +
      `Autorizada: ${grupos.autorizada.length} · Cancelada: ${grupos.cancelada.length} · ` +
      `Inutilizada: ${grupos.inutilizada.length} · XML corrompido/ausente: ${grupos.xmlInvalido.length} ` +
      '(removida da seleção).'
  })

  checkCancelled()

  // Passo 3 — sequência numérica
  reportStep(3, 'Verificação da sequência numérica')
  // NF-e das pastas avulsas têm numeração própria (validada à parte em
  // validateNfeFolderSequence) — misturar com as séries de NFC-e do banco
  // criaria lacunas falsas.
  const groups = detectGroups(rows.filter((r) => !r.nfeAvulsa))
  const totalLacunas = groups.reduce((sum, g) => sum + g.lacunas.length, 0)
  steps.push({
    id: 'sequencia',
    label: 'Verificação da sequência numérica',
    status: totalLacunas > 0 ? 'warn' : 'ok',
    detail: groups.length === 0
      ? 'Nenhuma série identificada para verificar.'
      : `${groups.length} série(s) analisada(s), ${totalLacunas} lacuna(s) de numeração encontrada(s).`
  })

  checkCancelled()

  // Passo 4 — busca em cascata
  reportStep(4, 'Busca em cascata de XMLs faltantes')
  const folderIndex = await buildFolderIndex(folders, {
    isCancelled,
    onProgress: (info) => onProgress?.({ step: 4, totalSteps: TOTAL_STEPS, label: 'Busca em cascata de XMLs faltantes', ...info })
  })

  const workingSet = []
  let recuperadosPorChave = 0

  for (const row of rowsAnnotated) {
    if (isCancelled?.()) throw new ValidationCancelledError()

    const precisaRecuperar = !row.xmlContent || !row._parsed.wellFormed || !row._parsed.temProtocolo
    if (precisaRecuperar && row.chave) {
      const match = folderIndex.byChave.get(row.chave)
      const found = await loadFolderEntry(match)
      if (found?.parsed.wellFormed) {
        workingSet.push(buildRecoveredItem(row, found))
        recuperadosPorChave++
        continue
      }
    }
    workingSet.push(row)
  }

  onProgress?.({ step: 4, totalSteps: TOTAL_STEPS, label: 'Busca em cascata de XMLs faltantes', phase: 'extending' })
  const foraDoIntervalo = await extendGroupsFromFolders(groups, folderIndex, { period, companyCnpj, isCancelled })
  const seriesSoNaPasta = groups.filter((g) => g.numerosBanco.size === 0).length

  const recoveredGaps = []
  const naoRecuperados = []

  for (const group of groups) {
    for (const numero of group.lacunas) {
      if (isCancelled?.()) throw new ValidationCancelledError()

      const match = lookupByNumeroSerie(folderIndex, group.cnpj, group.serie, numero)
      const found = await loadFolderEntry(match)
      if (found?.parsed.wellFormed) {
        recoveredGaps.push(buildRecoveredItem({ numero, serie: group.serie, cnpj: group.cnpj }, found))
      } else {
        naoRecuperados.push({ serie: group.serie, numero, cnpj: group.cnpj })
      }
    }
  }

  const recuperadosPorLote = recoveredGaps.filter((i) => i.metodoRecuperacao === METODO_RECUPERACAO['lote-envio']).length
  const recuperadosPorInutilizacao = recoveredGaps.filter((i) => i.metodoRecuperacao === METODO_RECUPERACAO.inutilizacao).length

  const detalhesExtra = [
    foraDoIntervalo.length > 0
      ? `${foraDoIntervalo.length} fora do intervalo do banco, pela data de emissão` +
        (seriesSoNaPasta > 0 ? ` (inclui ${seriesSoNaPasta} série(s) sem nenhuma nota no banco)` : '')
      : null,
    recuperadosPorLote > 0 ? `${recuperadosPorLote} via lote de envio à SEFAZ (nem chegaram a ser gravadas no banco)` : null,
    recuperadosPorInutilizacao > 0 ? `${recuperadosPorInutilizacao} eram faixa inutilizada (sem nota — número baixado junto à SEFAZ)` : null
  ].filter(Boolean).join('; ')

  steps.push({
    id: 'busca-cascata',
    label: 'Busca em cascata de XMLs faltantes',
    status: naoRecuperados.length > 0 ? 'warn' : 'ok',
    detail: `${folderIndex.totalFound} arquivo(s) XML encontrado(s) nas pastas configuradas · ` +
      `${recuperadosPorChave} recuperado(s) por nome exato da chave, ${recoveredGaps.length + foraDoIntervalo.length} por número/série` +
      (detalhesExtra ? ` (${detalhesExtra})` : '') +
      ` · ${naoRecuperados.length} lacuna(s) não encontrada(s) — verificar manualmente no portal TOTVS.`
  })

  checkCancelled()

  // Passo 5 — deduplicação e separação de inconformidades
  reportStep(5, 'Deduplicação do lote')
  const combined = [...workingSet, ...foraDoIntervalo, ...recoveredGaps]
  const { kept, duplicates } = dedupeByChave(combined)

  steps.push({
    id: 'deduplicacao',
    label: 'Deduplicação do lote',
    status: duplicates.length > 0 ? 'warn' : 'ok',
    detail: duplicates.length > 0
      ? `${duplicates.length} XML(s) duplicado(s) removido(s).`
      : 'Nenhuma duplicata encontrada.'
  })

  reportStep(6, 'Separação de inconformidades')

  // Contingência/offline entra no pacote final mesmo sem protocolo de
  // autorização: pra contabilidade, o que importa é a sequência numérica
  // completa — segurar a nota esperando o protocolo cria um buraco pior do
  // que mandar ela sem protocolo. Só XML corrompido/ausente (sem dado
  // nenhum pra exportar) é isolado como inconformidade de verdade.
  const invalid = []
  const finalItems = []
  for (const item of kept) {
    const parsed = item._parsed ?? extractFromBase64(item.xmlContent)
    if (!parsed?.wellFormed) {
      invalid.push({ ...item, motivo: 'XML corrompido ou ausente' })
    } else {
      finalItems.push(item)
    }
  }

  steps.push({
    id: 'inconformidades',
    label: 'Separação de inconformidades',
    status: invalid.length > 0 ? 'warn' : 'ok',
    detail: invalid.length > 0
      ? `${invalid.length} nota(s) isolada(s) por XML corrompido ou ausente.`
      : 'Nenhuma inconformidade encontrada.'
  })

  // Passo 7 — relatório de quebras
  reportStep(7, 'Relatório de quebras e pacote final')
  const reportRows = groups.map((g) => {
    const lacunasNaoRecuperadas = naoRecuperados
      .filter((x) => x.serie === g.serie)
      .map((x) => x.numero)
    return {
      conexao: g.conexoes?.join(', ') ?? '',
      cnpj: g.cnpj ?? 'Não identificado',
      serie: g.serie,
      numeroInicial: g.numeroInicial,
      numeroFinal: g.numeroFinal,
      quantidadeEsperada: g.quantidadeEsperada,
      quantidadeEncontrada: g.quantidadeEsperada - lacunasNaoRecuperadas.length,
      lacunasNaoRecuperadas
    }
  })

  steps.push({
    id: 'relatorio',
    label: 'Relatório de quebras e pacote final',
    status: 'ok',
    detail: `${finalItems.length} XML(s) prontos para exportação em lote.`
  })

  return {
    steps,
    grupos,
    recovered: [
      ...foraDoIntervalo,
      ...recoveredGaps,
      ...workingSet.filter((i) => i.origem !== 'banco de dados' && !i.nfeAvulsa)
    ].map(stripInternal),
    duplicates,
    invalid: invalid.map(stripInternal),
    finalItems: finalItems.map(stripInternal),
    reportRows,
    naoRecuperados
  }
}
