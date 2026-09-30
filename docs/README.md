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

4. **Busca em cascata nas pastas configuradas** (`buildFolderIndex`) — o app varre recursivamente as pastas de apoio cadastradas em **Configurações → Pastas**, na ordem em que foram configuradas (a primeira pasta a conter o arquivo tem prioridade). A chave de acesso de 44 dígitos (`cUF+AAMM+CNPJ+mod+série+nNF+tpEmis+cNF+cDV`) é praticamente sempre o próprio nome do arquivo (ou está embutida nele), então o índice inteiro é montado só a partir dos **nomes** — nenhum conteúdo é lido nesta fase, o custo é o mesmo pra uma pasta com 100 ou 100 mil arquivos:
   - **Nota com XML corrompido/ausente no banco (etapa 2), inclusive contingência sem protocolo** — a chave já é conhecida (veio da própria linha do banco); o app procura um arquivo cujo **nome seja exatamente** `<chave>.xml`, que é como o export sempre grava.
   - **Lacuna de numeração (etapa 3)** — como a nota nem chegou a existir na consulta, não há chave conhecida pra montar o nome esperado; em vez disso, **CNPJ, série e número são decodificados diretamente da chave embutida no nome de cada arquivo** (posições fixas: CNPJ = dígitos 7–20, série = 21–23, número = 24–32) e comparados com o que falta (fallback para série + número, caso o CNPJ não bata). Se nenhum arquivo tiver a chave no nome (ex.: nota que nem chegou a ser gravada no banco), como último recurso o app também reconhece o padrão de nome do "lote de envio" do Plugin Fiscal/DocFiscAll — `serie_<série>_..._numero_<número>_..._env-lot.xml` — e extrai série/número dali; esse arquivo carrega o `<NFe>` completo enviado à SEFAZ (ao contrário do `ret-lot`, que é só o retorno/protocolo, sem o conteúdo da nota, e por isso é ignorado). Essa via só é usada quando a chave não resolve o caso, nunca a substitui.

   Em qualquer uma das recuperações, `buildRecoveredItem` preenche `dataEmissao`, `valor`, `tpEmissao` e `status`: quando a linha já existia no banco (XML corrompido/ausente), esses campos vêm do próprio banco — mais confiáveis; quando é uma lacuna sem linha nenhuma no banco, eles são derivados do XML recuperado (`dhEmi`/`dEmi`, `vNF`, `tpEmis` → "Normal"/"Contingência"). `status` não vem do XML (não há coluna equivalente), então por padrão é tratado como "Autorizada" quando recuperado — a situação real da grande maioria dos casos em que a nota só está ausente do banco por falha de gravação local.

   Cada nota recuperada carrega um `metodoRecuperacao` (nome exato da chave / chave no nome do arquivo / lote de envio à SEFAZ) e aparece listada na interface em **"Notas recuperadas das pastas"**, já aberta por padrão — é esse resgate de notas que, de outro modo, ficariam de fora do lote por falha de gravação local, que justifica a etapa de busca em pastas existir.

   Em ambos os casos, o conteúdo do arquivo só é lido (e o XML parseado) para os poucos arquivos que efetivamente batem com alguma nota que precisa ser recuperada — nunca para descartar candidatos. XMLs recuperados entram no lote com `origem` igual ao nome da pasta onde foram achados. A interface mostra a contagem de arquivos XML encontrados nas pastas e um botão vermelho de "parar" para interromper o processamento (útil principalmente durante a listagem recursiva em pastas muito profundas).

5. **Deduplicação do lote** (`dedupeByChave`) — combina o conjunto original com os XMLs recuperados e mantém apenas uma ocorrência por chave de acesso, priorizando a origem "banco de dados" e, depois, a ordem das pastas configuradas. Duplicatas descartadas ficam registradas (de onde vieram, o que foi mantido).

6. **Separação de inconformidades** — do que sobrou após a deduplicação, são isoladas da lista final (e não entram no `.zip`) as notas cujo XML continua corrompido/ausente **e** as notas emitidas em **contingência** (`tpEmis` diferente de 1 no XML) que **ainda não têm protocolo de autorização SEFAZ** (`infProt/nProt` ausente). Contingência já autorizada (protocolo presente) é considerada válida e segue normalmente para o pacote final. Ambas as inconformidades viram parte do log exportável em CSV, para conferência manual.

7. **Relatório de quebras e pacote final** — para cada série, o relatório mostra CNPJ, número inicial/final, quantidade esperada vs. encontrada e a lista de lacunas que **não** foram recuperadas em nenhuma pasta (essas precisam ser conferidas manualmente no portal TOTVS, com atalho direto na interface). O relatório é exportável em CSV. O que passou por todas as etapas compõe o pacote final disponível para exportação em `.zip`.

## Nomeação dos arquivos exportados

Cada XML exportado (individualmente ou dentro do `.zip`) é nomeado apenas pela **chave de acesso** da nota (`<chave>.xml`), sanitizada para remover caracteres inválidos em nome de arquivo. Ver [fileNameFor em export.js](../src-electron/ipc/export.js).
