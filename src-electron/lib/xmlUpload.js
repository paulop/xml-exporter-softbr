import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'

// Envio do .zip pro storage S3 (RustFS) da SoftBR:
// 1) o webhook devolve uma URL de upload assinada pro CNPJ da empresa;
// 2) o arquivo vai direto (PUT, corpo bruto) pra essa URL;
// 3) outro webhook manda por email um link de download do arquivo enviado.
const UPLOAD_URL_ENDPOINT = 'https://webhook.softbr.net/webhook/xml-upload-url'
const SEND_EMAIL_ENDPOINT = 'https://webhook.softbr.net/webhook/xml-send-email'
// Limite do serviço de email por envio.
const MAX_EMAIL_RECIPIENTS = 5
const CONTENT_TYPE = 'application/zip'

export class UploadError extends Error {}

async function requestUploadUrl (cnpj, filename) {
  let res
  try {
    res = await fetch(UPLOAD_URL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cnpj, filename, contentType: CONTENT_TYPE })
    })
  } catch {
    throw new UploadError('Não foi possível conectar ao serviço de envio. Verifique a conexão com a internet.')
  }

  const body = await res.json().catch(() => ({}))
  if (res.status === 403) {
    throw new UploadError('O CNPJ da empresa não tem licença ativa para envio.')
  }
  if (!res.ok || !body.ok || !body.uploadUrl) {
    throw new UploadError(body.error ?? `Falha ao obter a URL de envio (HTTP ${res.status}).`)
  }
  return body
}

// PUT com o arquivo em stream; `onProgress(sent, total)` a cada ~1%. A URL
// vai exatamente como veio (a assinatura está nela) e os headers são os da
// resposta do passo 1 — só o Content-Length é somado, porque o S3 não aceita
// upload assinado em chunked encoding.
function putFile (uploadUrl, headers, filePath, size, onProgress) {
  return new Promise((resolve, reject) => {
    const client = uploadUrl.startsWith('http:') ? http : https
    const req = client.request(uploadUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Length': size }
    }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)

    let sent = 0
    let lastPercent = -1
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => {
      sent += chunk.length
      const percent = Math.floor((sent / size) * 100)
      if (percent !== lastPercent) {
        lastPercent = percent
        onProgress(sent, size)
      }
    })
    stream.on('error', (err) => {
      req.destroy(err)
      reject(err)
    })
    stream.pipe(req)
  })
}

// Retorna o `key` do arquivo no storage — é ele que identifica o envio de
// forma permanente (as URLs expiram). Se a URL expirar no meio (403 no PUT),
// pede outra e tenta uma vez mais.
export async function uploadZip ({ cnpj, filePath, filename, onProgress = () => {} }) {
  const { size } = await fs.promises.stat(filePath)

  for (let attempt = 1; attempt <= 2; attempt++) {
    const target = await requestUploadUrl(cnpj, filename)
    let status
    try {
      status = await putFile(target.uploadUrl, target.headers ?? { 'Content-Type': CONTENT_TYPE }, filePath, size, onProgress)
    } catch {
      throw new UploadError('A conexão caiu durante o envio do arquivo. Tente novamente.')
    }

    // `cnpj` normalizado pelo serviço: é o que o `key` usa como prefixo, e
    // o passo 3 exige os dois batendo.
    if (status === 200) return { key: target.key, cnpj: target.cnpj, size }
    if (status !== 403 || attempt === 2) {
      throw new UploadError(`O storage recusou o arquivo (HTTP ${status}).`)
    }
  }
}

// Passo 3: só depois do PUT com 200 (o serviço confere se o arquivo existe).
// O link no email expira no padrão do serviço (7 dias).
export async function sendDownloadEmail ({ cnpj, key, to, name, message }) {
  let res
  try {
    res = await fetch(SEND_EMAIL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cnpj,
        key,
        to: to.slice(0, MAX_EMAIL_RECIPIENTS),
        ...(name ? { name: name.slice(0, 100) } : {}),
        ...(message ? { message: message.slice(0, 1000) } : {})
      })
    })
  } catch {
    throw new UploadError('Não foi possível conectar ao serviço de email.')
  }

  const body = await res.json().catch(() => ({}))
  if (res.status === 403) {
    throw new UploadError('O CNPJ da empresa não tem licença ativa para envio por email.')
  }
  if (!res.ok || !body.ok) {
    throw new UploadError(body.error ?? `Falha ao enviar o email (HTTP ${res.status}).`)
  }
  return body
}
