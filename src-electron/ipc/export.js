import { dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { store } from '../lib/store.js'
import { buildLogWorkbookBuffer } from '../lib/xlsxReport.js'
import { dedupeByChave } from '../lib/notaValidation.js'
import { collectNfeFromFolders } from '../lib/nfeCopyFolders.js'

// archiver é CommonJS; require() evita problemas de interop ESM/CJS
// que o bundler do processo main do Electron introduz com "import default".
// A partir da v8, o pacote expõe classes (ZipArchive) em vez da antiga
// função fábrica archiver('zip', opts). Carregado sob demanda, não no topo
// do módulo: um require() no topo roda na inicialização do app — se o
// pacote faltar no build, travava o app inteiro ao abrir, não só o .zip.
const require = createRequire(import.meta.url)
let ZipArchive = null
function getZipArchive () {
  if (!ZipArchive) ({ ZipArchive } = require('archiver'))
  return ZipArchive
}

const deflateRaw = promisify(zlib.deflateRaw)
const ZIP_LEVEL = 9
// Bytes que o formato zip gasta por arquivo além dos dados comprimidos:
// cabeçalho local (30) + descritor de dados (16, ou 24 em zip64) + entrada
// no diretório central (46), mais o nome do arquivo duas vezes (somado à
// parte). Arredondado pra cima como folga.
const ZIP_ENTRY_OVERHEAD = 128
// Registro de fim do diretório central (22), mais os de zip64 se aparecerem.
const ZIP_END_OVERHEAD = 128

function sanitizeFileName (value) {
  return String(value ?? '').replace(/[\\/:*?"<>|]/g, '_')
}

function fileNameFor (item) {
  return `${sanitizeFileName(item.chave)}.xml`
}

function toBuffer (xmlContent) {
  if (Buffer.isBuffer(xmlContent)) return xmlContent
  // A coluna de origem (XmlContent64) guarda o XML codificado em base64.
  return Buffer.from(xmlContent ?? '', 'base64')
}

async function resolveDestinationDir () {
  const configured = store.get('destinationFolder')
  if (configured) return configured

  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

// EBUSY/EPERM/EACCES ao salvar quase sempre é o arquivo de destino aberto em
// outro programa (Excel, leitor de PDF, etc.) ou sem permissão de escrita no
// local escolhido — não um bug. Em vez de deixar o erro cru do Node subir
// pelo IPC ("Error invoking remote method..."), traduz pra uma mensagem que
// a pessoa consegue agir (fechar o arquivo e tentar de novo).
async function writeFileSafe (filePath, data, options) {
  try {
    await fs.writeFile(filePath, data, options)
    return { ok: true, path: filePath }
  } catch (err) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
      return {
        ok: false,
        message: `Não foi possível salvar "${path.basename(filePath)}": o arquivo está aberto em outro programa ` +
          '(ex.: Excel) ou sem permissão de escrita nesse local. Feche-o e tente novamente.'
      }
    }
    throw err
  }
}

export async function downloadOne (item) {
  if (!item?.xmlContent) {
    return { ok: false, message: 'Esta nota não possui XML disponível.' }
  }

  const dir = await resolveDestinationDir()
  if (!dir) return { ok: false, message: 'Nenhuma pasta de destino selecionada.' }

  return writeFileSafe(path.join(dir, fileNameFor(item)), toBuffer(item.xmlContent))
}

// Pastas de NF-e avulsas (configuradas à parte de `searchFolders`): não
// passam pela busca em cascata nem precisam casar com nenhuma linha do
// banco — é só achar, dentro do período escolhido, os XMLs que já existem e
// somar ao lote selecionado. Em caso de chave repetida, a nota já
// selecionada no banco (primeira na lista) tem prioridade no dedupe.
async function withNfeFolderExtras (validItems, period) {
  const folders = store.get('nfeCopyFolders')
  if (!folders || folders.length === 0) return validItems

  const extras = await collectNfeFromFolders(folders, period ?? {})
  if (extras.length === 0) return validItems

  const { kept } = dedupeByChave([...validItems, ...extras])
  return kept
}

function writeZip (zipPath, entries) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = new (getZipArchive())({ zlib: { level: ZIP_LEVEL } })

    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)

    for (const entry of entries) {
      archive.append(entry.data, { name: entry.name })
    }

    archive.finalize()
  })
}

// Divide os arquivos em grupos cujo .zip resultante fique dentro de
// `maxBytes`. Cada parte é um .zip completo e independente (abre sozinho,
// sem precisar das outras), não um zip multi-volume (.z01, .z02...). O
// tamanho de cada XML no zip é estimado comprimindo-o antes com o mesmo
// nível do archiver; um XML que sozinho passe do limite vai numa parte só
// dele, já que não dá pra quebrar um arquivo no meio.
async function splitIntoParts (entries, maxBytes) {
  const sizes = await Promise.all(entries.map(async (entry) => {
    const compressed = await deflateRaw(entry.data, { level: ZIP_LEVEL })
    return compressed.length + ZIP_ENTRY_OVERHEAD + 2 * Buffer.byteLength(entry.name)
  }))

  const parts = []
  let current = []
  let currentSize = ZIP_END_OVERHEAD
  entries.forEach((entry, i) => {
    if (current.length > 0 && currentSize + sizes[i] > maxBytes) {
      parts.push(current)
      current = []
      currentSize = ZIP_END_OVERHEAD
    }
    current.push(entry)
    currentSize += sizes[i]
  })
  if (current.length > 0) parts.push(current)
  return parts
}

export async function downloadZip (items, period) {
  const selectedItems = (items ?? []).filter((item) => item.xmlContent)
  const validItems = await withNfeFolderExtras(selectedItems, period)
  if (validItems.length === 0) {
    return { ok: false, message: 'Nenhuma nota selecionada possui XML disponível.' }
  }

  const dir = await resolveDestinationDir()
  if (!dir) return { ok: false, message: 'Nenhuma pasta de destino selecionada.' }

  const entries = validItems.map((item) => ({ name: fileNameFor(item), data: toBuffer(item.xmlContent) }))
  const maxBytes = store.get('zipPartSizeMb') * 1024 * 1024
  const parts = await splitIntoParts(entries, maxBytes)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const digits = String(parts.length).length
  const zipPaths = parts.map((_part, i) => parts.length === 1
    ? path.join(dir, `NFe-Export-${timestamp}.zip`)
    : path.join(dir, `NFe-Export-${timestamp}-parte${String(i + 1).padStart(digits, '0')}.zip`))

  for (let i = 0; i < parts.length; i++) {
    try {
      await writeZip(zipPaths[i], parts[i])
    } catch (err) {
      if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
        return {
          ok: false,
          message: `Não foi possível salvar "${path.basename(zipPaths[i])}": o destino está aberto em outro programa ` +
            'ou sem permissão de escrita. Feche-o e tente novamente.'
        }
      }
      throw err
    }
  }

  return { ok: true, path: zipPaths[0], paths: zipPaths, dir, fileCount: validItems.length }
}

export async function downloadLogXlsx (items, period) {
  const selectedItems = (items ?? []).filter((item) => item.xmlContent)
  const validItems = await withNfeFolderExtras(selectedItems, period)
  if (validItems.length === 0) {
    return { ok: false, message: 'Nenhuma nota selecionada possui XML disponível.' }
  }

  // Mesma pasta de destino do .zip, sem perguntar — e com timestamp no nome
  // pra nunca colidir com um relatório anterior que ainda esteja aberto.
  const dir = await resolveDestinationDir()
  if (!dir) return { ok: false, message: 'Nenhuma pasta de destino selecionada.' }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(dir, `Relatorio_XML_SoftBR-${timestamp}.xlsx`)

  const buffer = await buildLogWorkbookBuffer(validItems)
  return writeFileSafe(filePath, buffer)
}

export async function downloadReportCsv ({ csv, fileName }) {
  const result = await dialog.showSaveDialog({
    defaultPath: sanitizeFileName(fileName) || 'relatorio-quebras.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (result.canceled || !result.filePath) {
    return { ok: false, message: 'Operação cancelada.' }
  }

  // BOM UTF-8 para o Excel reconhecer acentuação sem precisar configurar a importação.
  return writeFileSafe(result.filePath, '﻿' + (csv ?? ''), 'utf-8')
}

export async function downloadReceiptPdf ({ html, fileName }) {
  const result = await dialog.showSaveDialog({
    defaultPath: sanitizeFileName(fileName) || 'cupom.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) {
    return { ok: false, message: 'Operação cancelada.' }
  }

  // O backend de impressão do Electron/Chromium ignora "@page { size: 80mm auto }"
  // (altura automática) e cai para o tamanho Letter padrão, mesmo com
  // preferCSSPageSize. Por isso medimos a altura real do conteúdo (já
  // renderizado com 80mm de largura fixa via CSS) e informamos um pageSize
  // explícito, replicando o comportamento de uma impressora térmica.
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
    const heightPx = await win.webContents.executeJavaScript('document.documentElement.scrollHeight')
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: { width: 80 / 25.4, height: Math.max(heightPx + 4, 40) / 96 }
    })
    return await writeFileSafe(result.filePath, pdfBuffer)
  } finally {
    win.destroy()
  }
}
