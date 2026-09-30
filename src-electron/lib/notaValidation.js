import fs from 'node:fs/promises'
import path from 'node:path'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

// Aceita tanto o fragmento "nfeProc" completo (NFe + protNFe) quanto um <NFe>
// isolado (nota em contingência, ainda sem protocolo de autorização).
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true
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
    numero: null,
    serie: null,
    cnpj: null,
    chave: null,
    temProtocolo: false,
    contingencia: false,
    wellFormed: false
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

  const infNFe = deepFind(parsed, 'infNFe')
  if (!infNFe) return emptyParsed()

  const ide = infNFe.ide
  const emit = infNFe.emit
  const infProt = deepFind(parsed, 'infProt')

  const idAttr = String(infNFe['@_Id'] || '').replace(/^NFe/i, '')
  const chave = String(infProt?.chNFe || idAttr || '').trim() || null
  const tpEmis = ide?.tpEmis

  return {
    numero: ide?.nNF !== undefined && ide?.nNF !== null ? Number(ide.nNF) : null,
    serie: ide?.serie !== undefined && ide?.serie !== null ? Number(ide.serie) : null,
    cnpj: emit?.CNPJ ? String(emit.CNPJ) : (emit?.CPF ? String(emit.CPF) : null),
    chave,
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

// A chave de acesso da NF-e/NFC-e (44 dígitos) embute cUF(2) + AAMM(4) +
// CNPJ(14) + mod(2) + série(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1). Como
// o nome do arquivo normalmente contém a própria chave, dá pra decodificar
// tudo isso (inclusive número/série, usados na busca de lacunas) direto do
// nome — sem abrir nem parsear o conteúdo do arquivo.
function extractChaveFromFileName (fileName) {
  const match = fileName.match(/\d{44}/)
  return match ? match[0] : null
}

function decodeChave (chave) {
  return {
    cnpj: chave.slice(6, 20),
    // posições 21-22 são o "mod" (modelo do documento fiscal) — vêm antes da série.
    serie: Number(chave.slice(22, 25)),
    numero: Number(chave.slice(25, 34))
  }
}

async function listXmlFilesRecursive (dir) {
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

async function loadFolderEntry (filePath, folder) {
  let xmlString
  try {
    xmlString = await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
  return { filePath, folder, xmlString, parsed: parseXml(xmlString) }
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
      byChave.set(stem, { filePath, folder })
    }

    // Lacuna de numeração: a chave pode estar em qualquer posição do nome
    // (ex. "..._chave_<chave>-nfe.xml"); número/série/CNPJ saem direto dela.
    const chave = extractChaveFromFileName(name)
    if (chave) {
      const { cnpj, serie, numero } = decodeChave(chave)
      const numSerieKey = `${serie}|${numero}`
      if (!byNumSerie.has(numSerieKey)) byNumSerie.set(numSerieKey, { filePath, folder })

      const fullKey = `${cnpj}|${numSerieKey}`
      if (!byNumSerieCnpj.has(fullKey)) byNumSerieCnpj.set(fullKey, { filePath, folder })
    }
  }

  return { byChave, byNumSerieCnpj, byNumSerie, totalFound: allFiles.length }
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

    let cnpj = null
    for (const row of groupRows) {
      if (!row.xmlContent) continue
      const parsed = extractFromBase64(row.xmlContent)
      if (parsed.cnpj) { cnpj = parsed.cnpj; break }
    }

    groups.push({
      serie,
      cnpj,
      numeroInicial,
      numeroFinal,
      quantidadeEsperada: numeroFinal - numeroInicial + 1,
      lacunas
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

function buildRecoveredItem (base, found) {
  return {
    numero: found.parsed.numero ?? base.numero ?? null,
    serie: found.parsed.serie ?? base.serie ?? null,
    chave: found.parsed.chave ?? base.chave ?? null,
    dataEmissao: base.dataEmissao ?? null,
    valor: base.valor ?? null,
    tpEmissao: base.tpEmissao ?? null,
    status: base.status ?? null,
    xmlStatus: 'Disponível',
    xmlContent: Buffer.from(found.xmlString, 'utf-8').toString('base64'),
    origem: path.basename(found.folder),
    _parsed: found.parsed
  }
}

const TOTAL_STEPS = 7

export async function runValidation ({ rows, folders, onProgress, isCancelled }) {
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
    origem: 'banco de dados',
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
  const groups = detectGroups(rows)
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
      const found = match ? await loadFolderEntry(match.filePath, match.folder) : null
      if (found?.parsed.wellFormed) {
        workingSet.push(buildRecoveredItem(row, found))
        recuperadosPorChave++
        continue
      }
    }
    workingSet.push(row)
  }

  const recoveredGaps = []
  const naoRecuperados = []

  for (const group of groups) {
    for (const numero of group.lacunas) {
      if (isCancelled?.()) throw new ValidationCancelledError()

      const match = lookupByNumeroSerie(folderIndex, group.cnpj, group.serie, numero)
      const found = match ? await loadFolderEntry(match.filePath, match.folder) : null
      if (found?.parsed.wellFormed) {
        recoveredGaps.push(buildRecoveredItem({ numero, serie: group.serie, cnpj: group.cnpj }, found))
      } else {
        naoRecuperados.push({ serie: group.serie, numero, cnpj: group.cnpj })
      }
    }
  }

  steps.push({
    id: 'busca-cascata',
    label: 'Busca em cascata de XMLs faltantes',
    status: naoRecuperados.length > 0 ? 'warn' : 'ok',
    detail: `${folderIndex.totalFound} arquivo(s) XML encontrado(s) nas pastas configuradas · ` +
      `${recuperadosPorChave} recuperado(s) por nome exato da chave, ${recoveredGaps.length} por número/série · ` +
      `${naoRecuperados.length} lacuna(s) não encontrada(s) — verificar manualmente no portal TOTVS.`
  })

  checkCancelled()

  // Passo 5 — deduplicação e separação de inconformidades
  reportStep(5, 'Deduplicação do lote')
  const combined = [...workingSet, ...recoveredGaps]
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

  const invalid = []
  const finalItems = []
  for (const item of kept) {
    const parsed = item._parsed ?? extractFromBase64(item.xmlContent)
    if (!parsed?.wellFormed) {
      invalid.push({ ...item, motivo: 'XML corrompido ou ausente' })
    } else if (parsed.contingencia && !parsed.temProtocolo) {
      // Contingência já autorizada (com protocolo SEFAZ) pode ser enviada normalmente;
      // só isola a que ainda não recebeu o protocolo de autorização.
      invalid.push({ ...item, motivo: 'Emissão em contingência sem protocolo de autorização' })
    } else {
      finalItems.push(item)
    }
  }

  steps.push({
    id: 'inconformidades',
    label: 'Separação de inconformidades',
    status: invalid.length > 0 ? 'warn' : 'ok',
    detail: invalid.length > 0
      ? `${invalid.length} nota(s) isolada(s) por XML corrompido/ausente ou contingência sem protocolo de autorização.`
      : 'Nenhuma inconformidade encontrada.'
  })

  // Passo 7 — relatório de quebras
  reportStep(7, 'Relatório de quebras e pacote final')
  const reportRows = groups.map((g) => {
    const lacunasNaoRecuperadas = naoRecuperados
      .filter((x) => x.serie === g.serie)
      .map((x) => x.numero)
    return {
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
    recovered: [...recoveredGaps, ...workingSet.filter((i) => i.origem !== 'banco de dados')].map(stripInternal),
    duplicates,
    invalid: invalid.map(stripInternal),
    finalItems: finalItems.map(stripInternal),
    reportRows,
    naoRecuperados
  }
}
