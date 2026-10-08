import fs from 'node:fs/promises'
import path from 'node:path'
import {
  parseXml,
  listXmlFilesRecursive,
  extractChaveFromFileName,
  decodeAnoMesFromChave,
  decodeChave,
  monthsInRange,
  periodBounds,
  withinPeriod
} from './notaValidation.js'

// Pastas de NF-e avulsas (ex.: notas de outro sistema/filial que nunca
// passam pelo banco de dados consultado pelo app): aqui não tem lacuna pra
// recuperar nem nota pra casar com linha nenhuma — é só achar, dentro do
// período escolhido, os XMLs que já existem na pasta e empacotar junto.

// Nome mostrado na coluna "Conexão" da tabela principal e do relatório de
// sequência para as notas que vêm dessas pastas.
export const NFE_AVULSA_CONEXAO = 'Pasta de NF-e avulsa'

// Varre as pastas configuradas e devolve, já no formato usado pelo ZIP/log,
// só os XMLs cuja emissão cai dentro do período — sem passar pela busca em
// cascata nem tentar casar com nenhuma linha do banco.
export async function collectNfeFromFolders (folders, { dataInicial, dataFinal } = {}) {
  if (!folders || folders.length === 0) return []

  const months = monthsInRange(dataInicial, dataFinal)
  const { startDate, endDate } = periodBounds(dataInicial, dataFinal)

  const results = []

  for (const folder of folders) {
    const files = await listXmlFilesRecursive(folder)

    for (const filePath of files) {
      const chave = extractChaveFromFileName(path.basename(filePath))
      // Pré-filtro por mês direto do nome (sem abrir o arquivo): só pula
      // quando dá pra confirmar que o mês está fora do período — chave
      // ausente do nome não permite descartar, então nesse caso abre mesmo.
      if (chave && months.size > 0) {
        const { ano, mes } = decodeAnoMesFromChave(chave)
        if (!months.has(`${ano}|${mes}`)) continue
      }

      let xmlString
      try {
        xmlString = await fs.readFile(filePath, 'utf-8')
      } catch {
        continue
      }

      const parsed = parseXml(xmlString)
      if (!parsed.wellFormed || parsed.tipo !== 'nfe') continue
      if (!withinPeriod(parsed.dataEmissao, startDate, endDate)) continue

      results.push({
        numero: parsed.numero,
        serie: parsed.serie,
        chave: parsed.chave,
        dataEmissao: parsed.dataEmissao,
        valor: parsed.valor,
        tpEmissao: parsed.contingencia ? 'CONTINGÊNCIA' : 'NORMAL',
        status: 'AUTORIZADA',
        xmlStatus: 'DISPONÍVEL',
        xmlContent: Buffer.from(xmlString, 'utf-8').toString('base64'),
        origem: path.basename(folder),
        conexao: NFE_AVULSA_CONEXAO,
        nfeAvulsa: true,
        // Aparece na coluna "Observações" do log — é o que deixa claro, linha
        // a linha, que essa nota não veio do banco de dados, veio de arquivo
        // já pronto numa pasta de apoio.
        metodoRecuperacao: `NF-e avulsa (pasta: ${path.basename(folder)})`
      })
    }
  }

  return results
}

// Tabela de validação de início/fim de numeração por série, só a partir do
// NOME dos arquivos (nenhum conteúdo é lido) — mesmo princípio do índice de
// pastas do pipeline de recuperação, mas aqui o objetivo é outro: não é
// achar lacuna pra recuperar, é mostrar pro usuário se a pasta de NF-e
// avulsas está com a sequência completa (ou com buraco) no período
// consultado. Roda junto com "Validar / Auditar" (mesmo período da
// consulta principal), não é mais uma ação separada. A chave só guarda
// ano/mês (AAMM), não o dia — por isso o filtro aqui é por mês (todo mês
// que o período tocar), não por intervalo exato de datas.
export async function validateNfeFolderSequence (folders, { dataInicial, dataFinal } = {}) {
  if (!folders || folders.length === 0) return []

  const months = monthsInRange(dataInicial, dataFinal)
  const groups = new Map()

  for (const folder of folders) {
    const files = await listXmlFilesRecursive(folder)

    for (const filePath of files) {
      const chave = extractChaveFromFileName(path.basename(filePath))
      if (!chave) continue

      if (months.size > 0) {
        const { ano, mes } = decodeAnoMesFromChave(chave)
        if (!months.has(`${ano}|${mes}`)) continue
      }

      const { cnpj, serie, numero } = decodeChave(chave)
      const key = `${cnpj}|${serie}`
      if (!groups.has(key)) groups.set(key, { cnpj, serie, numeros: new Set() })
      groups.get(key).numeros.add(numero)
    }
  }

  const rows = []
  for (const { cnpj, serie, numeros } of groups.values()) {
    const lista = [...numeros].sort((a, b) => a - b)
    const numeroInicial = lista[0]
    const numeroFinal = lista[lista.length - 1]

    const lacunas = []
    for (let n = numeroInicial; n <= numeroFinal; n++) {
      if (!numeros.has(n)) lacunas.push(n)
    }

    rows.push({
      cnpj,
      serie,
      numeroInicial,
      numeroFinal,
      quantidadeEsperada: numeroFinal - numeroInicial + 1,
      quantidadeEncontrada: lista.length,
      lacunas
    })
  }

  return rows.sort((a, b) => a.serie - b.serie)
}
