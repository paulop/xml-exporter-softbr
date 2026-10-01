import { dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import { store } from '../lib/store.js'
import { buildLogWorkbookBuffer } from '../lib/xlsxReport.js'

// archiver é CommonJS; require() evita problemas de interop ESM/CJS
// que o bundler do processo main do Electron introduz com "import default".
// A partir da v8, o pacote expõe classes (ZipArchive) em vez da antiga
// função fábrica archiver('zip', opts).
const require = createRequire(import.meta.url)
const { ZipArchive } = require('archiver')

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

export async function downloadZip (items) {
  const validItems = (items ?? []).filter((item) => item.xmlContent)
  if (validItems.length === 0) {
    return { ok: false, message: 'Nenhuma nota selecionada possui XML disponível.' }
  }

  const dir = await resolveDestinationDir()
  if (!dir) return { ok: false, message: 'Nenhuma pasta de destino selecionada.' }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const zipPath = path.join(dir, `NFe-Export-${timestamp}.zip`)

  try {
    await new Promise((resolve, reject) => {
      const output = createWriteStream(zipPath)
      const archive = new ZipArchive({ zlib: { level: 9 } })

      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)

      for (const item of validItems) {
        archive.append(toBuffer(item.xmlContent), { name: fileNameFor(item) })
      }

      archive.finalize()
    })
  } catch (err) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
      return {
        ok: false,
        message: `Não foi possível salvar "${path.basename(zipPath)}": o destino está aberto em outro programa ` +
          'ou sem permissão de escrita. Feche-o e tente novamente.'
      }
    }
    throw err
  }

  return { ok: true, path: zipPath, fileCount: validItems.length }
}

export async function downloadLogXlsx (items) {
  const validItems = (items ?? []).filter((item) => item.xmlContent)
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
