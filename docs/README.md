# Objetivos do projeto

O XML Exporter SoftBR existe para resolver um problema recorrente da contabilidade: reunir os XMLs de NF-e/NFC-e emitidos por uma ou mais filiais, garantir que o lote está completo e íntegro, e entregar um pacote pronto para envio — sem depender de exportação manual nota a nota no ERP.

Para isso, o app:

- Conecta diretamente no SQL Server onde o ERP grava as notas (sem middleware nem exportação intermediária).
- Deixa a consulta SQL configurável, já que o nome das tabelas/colunas varia entre instalações do ERP.
- Executa um pipeline de validação e recuperação automática antes da exportação, para reduzir lotes incompletos ou com XML corrompido chegando à contabilidade.
- Exporta o resultado final em `.zip`, com cada arquivo nomeado pela chave de acesso da nota.

## Etapas de busca e validação das notas

O pipeline roda em [ValidationChecklist.vue](../src/components/ValidationChecklist.vue) (interface) e [notaValidation.js](../src-electron/lib/notaValidation.js) (lógica), disparado pelo botão "Executar validação" após a consulta ao banco.

1. **Extração do banco de dados** — já realizada pela consulta SQL configurada; é o ponto de partida do lote (linhas com `numero`, `serie`, `chave`, `status`, `tpEmissao` e o XML em base64, quando disponível).

2. **Validação estrutural e protocolo SEFAZ** — cada XML é parseado (`parseXml`) e classificado:
   - **Normal / Offline**, conforme `tpEmissao`.
   - **Autorizada / Cancelada / Inutilizada**, conforme `status`.
   - **XML corrompido/ausente**: nota sem `xmlContent` ou que falha no parse — é removida da seleção final nesta etapa (mas ainda é rastreada como inconformidade). Notas em contingência ou sem protocolo de autorização **não** são descartadas aqui, só reportadas.

3. **Verificação da sequência numérica** (`detectGroups`) — as notas são agrupadas por série; para cada série, calcula-se o intervalo `[numeroInicial, numeroFinal]` e identificam-se números que deveriam existir mas não vieram na consulta (lacunas).

4. **Busca em cascata nas pastas configuradas** (`buildFolderIndex` + `lookupByNumeroSerie`) — para cada nota que falhou na validação estrutural (etapa 2) ou para cada lacuna detectada (etapa 3), o app varre recursivamente as pastas de apoio cadastradas em **Configurações → Pastas**, na ordem em que foram configuradas (a primeira pasta a conter o arquivo tem prioridade). Antes de ler o conteúdo de qualquer arquivo, `isWithinDateRange` descarta os que estão fora do período das notas sendo validadas — essencial porque essas pastas costumam acumular XMLs de vários anos. A checagem prioriza o **cUF+AAMM embutido na chave de acesso de 44 dígitos** presente no nome do arquivo: o campo **UF** na interface (acima do botão "Executar validação", preenchido automaticamente com os 2 primeiros dígitos da primeira chave encontrada na consulta, mas editável) filtra pelo código do estado, e `computeMonthRange` (± 1 mês de folga) filtra pelo ano+mês. Só quando o nome não contém uma chave reconhecível é que cai para uma data genérica no nome ou, por fim, para a data de criação do arquivo (`computeDateRange`, ± 5 dias). A busca tenta primeiro por **chave de acesso**; lacunas de numeração são resolvidas por **CNPJ + série + número** (com fallback para série + número, caso o CNPJ não bata). XMLs recuperados entram no lote com `origem` igual ao nome da pasta onde foram achados.
   Essa é a etapa mais demorada do pipeline: a interface mostra a contagem de arquivos XML encontrados nas pastas, uma barra de progresso (listagem dos arquivos, depois quantos já foram analisados dentro do período) e um botão vermelho de "parar" para interromper o processamento em andamento.

5. **Deduplicação do lote** (`dedupeByChave`) — combina o conjunto original com os XMLs recuperados e mantém apenas uma ocorrência por chave de acesso, priorizando a origem "banco de dados" e, depois, a ordem das pastas configuradas. Duplicatas descartadas ficam registradas (de onde vieram, o que foi mantido).

6. **Separação de inconformidades** — do que sobrou após a deduplicação, são isoladas da lista final (e não entram no `.zip`) as notas cujo XML continua corrompido/ausente **e** as notas emitidas em **contingência** (`tpEmis` diferente de 1 no XML) que **ainda não têm protocolo de autorização SEFAZ** (`infProt/nProt` ausente). Contingência já autorizada (protocolo presente) é considerada válida e segue normalmente para o pacote final. Ambas as inconformidades viram parte do log exportável em CSV, para conferência manual.

7. **Relatório de quebras e pacote final** — para cada série, o relatório mostra CNPJ, número inicial/final, quantidade esperada vs. encontrada e a lista de lacunas que **não** foram recuperadas em nenhuma pasta (essas precisam ser conferidas manualmente no portal TOTVS, com atalho direto na interface). O relatório é exportável em CSV. O que passou por todas as etapas compõe o pacote final disponível para exportação em `.zip`.

## Nomeação dos arquivos exportados

Cada XML exportado (individualmente ou dentro do `.zip`) é nomeado apenas pela **chave de acesso** da nota (`<chave>.xml`), sanitizada para remover caracteres inválidos em nome de arquivo. Ver [fileNameFor em export.js](../src-electron/ipc/export.js).
