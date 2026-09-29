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

// Ordem da lista `folders` define prioridade: a primeira pasta que contiver
// o arquivo vence em caso de coincidência.
export async function buildFolderIndex (folders) {
  const byChave = new Map()
  const byNumSerieCnpj = new Map()
  const byNumSerie = new Map()

  for (const folder of folders ?? []) {
    const files = await listXmlFilesRecursive(folder)
    for (const filePath of files) {
      let xmlString
      try {
        xmlString = await fs.readFile(filePath, 'utf-8')
      } catch {
        continue
      }

      const parsed = parseXml(xmlString)
      if (!parsed.wellFormed) continue

      const entry = { filePath, folder, xmlString, parsed }

      if (parsed.chave && !byChave.has(parsed.chave)) {
        byChave.set(parsed.chave, entry)
      }

      if (parsed.numero !== null && parsed.serie !== null) {
        const numSerieKey = `${parsed.serie}|${parsed.numero}`
        if (!byNumSerie.has(numSerieKey)) byNumSerie.set(numSerieKey, entry)

        const fullKey = `${parsed.cnpj ?? ''}|${numSerieKey}`
        if (!byNumSerieCnpj.has(fullKey)) byNumSerieCnpj.set(fullKey, entry)
      }
    }
  }

  return { byChave, byNumSerieCnpj, byNumSerie }
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

export async function runValidation ({ rows, folders }) {
  const steps = []

  // Passo 2 — validação estrutural e protocolo SEFAZ: apenas contagem por tipo.
  // Notas em contingência/sem protocolo NÃO são desmarcadas — só XML corrompido ou ausente é.
  const rowsAnnotated = rows.map((row) => ({
    ...row,
    origem: 'banco de dados',
    _parsed: row.xmlContent ? extractFromBase64(row.xmlContent) : emptyParsed()
  }))

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

  // Passo 3 — sequência numérica
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

  // Passo 4 — busca em cascata
  const folderIndex = await buildFolderIndex(folders)

  const workingSet = []
  let recuperadosPorChave = 0

  for (const row of rowsAnnotated) {
    const precisaRecuperar = !row.xmlContent || !row._parsed.wellFormed || !row._parsed.temProtocolo
    if (precisaRecuperar && row.chave) {
      const found = folderIndex.byChave.get(row.chave)
      if (found && found.parsed.temProtocolo) {
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
      const found = lookupByNumeroSerie(folderIndex, group.cnpj, group.serie, numero)
      if (found) {
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
    detail: `${recuperadosPorChave + recoveredGaps.length} XML(s) recuperado(s) das pastas configuradas, ` +
      `${naoRecuperados.length} não encontrado(s) — verificar manualmente no portal TOTVS.`
  })

  // Passo 5 — deduplicação e separação de inconformidades
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

  // Passo 6 — relatório de quebras
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
