import { dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import { store } from '../lib/store.js'
import { buildLogWorkbookBuffer } from '../lib/xlsxReport.js'
import { dedupeByChave } from '../lib/notaValidation.js'
import { collectNfeFromFolders } from '../lib/nfeCopyFolders.js'
import { uploadZip, sendDownloadEmail, UploadError } from '../lib/xmlUpload.js'

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

const ZIP_LEVEL = 9

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

// Um único .zip, sem divisão em partes (o envio vai pro S3, que aceita o
// arquivo completo), com os XMLs e o relatório .xlsx em pastas separadas. `onProgress`
// recebe uma frase curta do passo atual, exibida na tela enquanto o
// arquivo é gerado.
export async function downloadZip (items, period, onProgress = () => {}) {
  const selectedItems = (items ?? []).filter((item) => item.xmlContent)
  onProgress('Buscando NF-e nas pastas avulsas...')
  const validItems = await withNfeFolderExtras(selectedItems, period)
  if (validItems.length === 0) {
    return { ok: false, message: 'Nenhuma nota selecionada possui XML disponível.' }
  }

  onProgress('Aguardando a pasta de destino...')
  const dir = await resolveDestinationDir()
  if (!dir) return { ok: false, message: 'Nenhuma pasta de destino selecionada.' }

  onProgress('Gerando relatório .xlsx...')
  const reportBuffer = await buildLogWorkbookBuffer(validItems)

  // Estrutura do .zip: log/ com o relatório e xml/ com as notas.
  const entries = [
    { name: 'log/Relatorio_XML_SoftBR.xlsx', data: reportBuffer },
    ...validItems.map((item) => ({ name: `xml/${fileNameFor(item)}`, data: toBuffer(item.xmlContent) }))
  ]

  // Nome: "<CNPJ>-<fantasia>-<AAAA.MM da data inicial>.zip".
  const company = store.get('company')
  const [year, month] = String(period?.dataInicial ?? '').split('-')
  const baseName = [
    company?.cnpj,
    sanitizeFileName(company?.name).trim(),
    year && month ? `${year}.${month}` : ''
  ].filter(Boolean).join('-')
  const zipPath = path.join(dir, `${baseName || 'NFe-Export'}.zip`)

  onProgress(`Compactando ${validItems.length} XML(s) no arquivo .zip...`)
  try {
    await writeZip(zipPath, entries)
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

function formatIsoDate (iso) {
  const [y, m, d] = String(iso ?? '').split('-')
  return d ? `${d}/${m}/${y}` : ''
}

// "Enviar": gera o .zip exatamente como "Baixar .zip" (fica salvo também na
// pasta de destino), envia pro storage da SoftBR e manda o link de download
// por email pros destinatários escolhidos no diálogo. `onUploadProgress(sent,
// total)` alimenta a barra de progresso. O `key` de cada envio é guardado
// em `uploadHistory`, já que as URLs devolvidas pelo serviço expiram,
// junto com os emails de destino escolhidos no diálogo de envio.
export async function sendZip (items, period, emails, onProgress = () => {}, onUploadProgress = () => {}, existingZip = null) {
  const cnpj = store.get('company')?.cnpj
  if (!cnpj) {
    return { ok: false, message: 'Cadastre o CNPJ da empresa (menu Empresa) antes de enviar.' }
  }

  // Reenvio: se o .zip de um envio anterior desta validação ainda existe no
  // disco, manda ele de novo em vez de gerar tudo outra vez.
  let zip = null
  if (existingZip?.path) {
    const stillThere = await fs.access(existingZip.path).then(() => true, () => false)
    if (stillThere) zip = { ok: true, path: existingZip.path, fileCount: existingZip.fileCount }
  }
  if (!zip) zip = await downloadZip(items, period, onProgress)
  if (!zip.ok) return zip

  onProgress('Enviando .zip para a contabilidade...')
  let uploaded
  try {
    uploaded = await uploadZip({
      cnpj,
      filePath: zip.path,
      filename: path.basename(zip.path),
      onProgress: onUploadProgress
    })
  } catch (err) {
    if (err instanceof UploadError) {
      return { ok: false, message: `${err.message} O .zip ficou salvo em ${zip.path}.` }
    }
    throw err
  }

  // O arquivo já está no storage a partir daqui: uma falha no email não
  // desfaz o envio, só volta como aviso (`emailError`) junto do sucesso.
  onProgress(`Enviando email com o link de download para ${emails.join(', ')}...`)
  let emailError = null
  try {
    const periodo = `${formatIsoDate(period?.dataInicial)} a ${formatIsoDate(period?.dataFinal)}`
    // Contrato com o backend: manda todos os dados e é ele quem decide
    // assunto, saudação e corpo do email.
    const company = store.get('company')
    const accountant = store.get('accountant')
    await sendDownloadEmail({
      cnpj: uploaded.cnpj ?? cnpj,
      key: uploaded.key,
      to: emails,
      empresa: { cnpj: company?.cnpj ?? '', nome: company?.name ?? '' },
      contador: {
        cnpj: accountant?.cnpj ?? '',
        nome: accountant?.name ?? '',
        whatsapp: accountant?.whatsapp ?? '',
        email: accountant?.email ?? ''
      },
      arquivo: { nome: path.basename(zip.path), quantidadeXml: zip.fileCount },
      periodo: { inicio: period?.dataInicial ?? '', fim: period?.dataFinal ?? '' },
      message: `Segue o arquivo com ${zip.fileCount} XML(s) de notas fiscais e o relatório de auditoria, ` +
        `referente ao período de ${periodo}.`
    })
  } catch (err) {
    if (!(err instanceof UploadError)) throw err
    emailError = err.message
  }

  const history = store.get('uploadHistory')
  store.set('uploadHistory', [
    {
      key: uploaded.key,
      fileName: path.basename(zip.path),
      size: uploaded.size,
      period,
      emails: emails ?? [],
      emailSent: !emailError,
      uploadedAt: new Date().toISOString()
    },
    ...history
  ].slice(0, 200))

  return { ok: true, path: zip.path, key: uploaded.key, fileCount: zip.fileCount, emailError }
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
