export const DEFAULT_SQL = `-- @dataFinal é tratado como limite exclusivo do dia seguinte,
-- para incluir a data final inteira independente do horário em dataemissao.
SELECT
    n.numeronota                 AS numero,
    n.serie                      AS serie,
    n.ChaveEletronica             AS chave,
    n.dataemissao                 AS dataEmissao,
    n.valortotal                  AS valor,
    n.FormaEmissao                AS tpEmissao,
    n.Situacao                    AS status,
    CASE WHEN c.XmlContent64 IS NULL THEN 'Ausente' ELSE 'Disponível' END AS xmlStatus,
    c.XmlContent64                AS xmlContent
FROM nfce_notaeletronica n
INNER JOIN nfce_notaeletronica_content c
    ON n.numeronota = c.numeronota AND n.serie = c.serie
WHERE n.dataemissao >= @dataInicial
  AND n.dataemissao <  DATEADD(day, 1, @dataFinal)
ORDER BY n.dataemissao DESC, n.serie ASC, n.numeronota DESC;`

const REQUIRED_PLACEHOLDERS = ['@dataInicial', '@dataFinal']

export function validateSql (sqlText) {
  if (!sqlText || !sqlText.trim()) {
    return { valid: false, message: 'A consulta SQL não pode ficar vazia.' }
  }

  const missing = REQUIRED_PLACEHOLDERS.filter(
    (token) => !new RegExp(`${token}\\b`, 'i').test(sqlText)
  )

  if (missing.length > 0) {
    return {
      valid: false,
      message: `A consulta precisa conter os parâmetros ${missing.join(' e ')}.`
    }
  }

  return { valid: true }
}
