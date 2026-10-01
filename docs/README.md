# Objetivos do projeto

O XML Exporter SoftBR existe para resolver um problema recorrente da contabilidade: reunir os XMLs de NF-e/NFC-e emitidos por uma ou mais filiais, garantir que o lote está completo e íntegro, e entregar um pacote pronto para envio — sem depender de exportação manual nota a nota no ERP.

Para isso, o app:

- Conecta diretamente no(s) SQL Server(s) onde o ERP grava as notas (sem middleware nem exportação intermediária) — **cada conexão cadastrada representa um computador/caixa diferente**, normalmente com séries próprias, e clicar em "Consultar" sempre percorre **todas** as conexões configuradas e concatena o resultado num lugar só. É esse "unir as fontes" que é o objetivo central do app — sem ele, cada caixa ficaria com seu próprio lote separado e a contabilidade teria que juntar manualmente.
- Deixa a consulta SQL configurável, já que o nome das tabelas/colunas varia entre instalações do ERP (a mesma consulta roda em todas as conexões).
- Executa um pipeline de validação e recuperação automática antes da exportação, para reduzir lotes incompletos ou com XML corrompido chegando à contabilidade.
- Exporta o resultado final em `.zip`, com cada arquivo nomeado pela chave de acesso da nota.

## Consulta unificada de múltiplas conexões

`query.run` (em [ipc/query.js](../src-electron/ipc/query.js)) roda a consulta SQL configurada em paralelo contra **todas** as conexões cadastradas (`Promise.allSettled`), não só a conexão "ativa". Cada linha retornada ganha um campo `conexao` com o nome da conexão de origem (mostrado como coluna na tabela principal), o que ajuda a rastrear de qual caixa veio cada nota quando a numeração ficar misturada entre fontes. Se uma conexão específica falhar (rede fora do ar, credencial errada), as outras continuam normalmente — o erro daquela conexão só vira um aviso, sem travar a consulta das demais; só dá erro de verdade se **todas** falharem ou se nenhuma conexão estiver cadastrada.

Como a detecção de lacunas (etapa 3 abaixo) agrupa por série, esse modelo assume que cada computador/caixa usa séries que não se repetem entre si — é assim que as instalações reais são configuradas, então a consolidação não mistura sequências de fontes diferentes dentro do mesmo grupo.

## Etapas de busca e validação das notas

O pipeline roda em [ValidationChecklist.vue](../src/components/ValidationChecklist.vue) (interface) e [notaValidation.js](../src-electron/lib/notaValidation.js) (lógica), disparado pelo botão "Executar validação" após a consulta ao banco.

1. **Extração do banco de dados** — já realizada pela consulta SQL configurada, rodada contra todas as conexões cadastradas e concatenada; é o ponto de partida do lote (linhas com `numero`, `serie`, `chave`, `status`, `tpEmissao`, `conexao` e o XML em base64, quando disponível).

2. **Validação estrutural e protocolo SEFAZ** — cada XML é parseado (`parseXml`) e classificado:
   - **Normal / Offline**, conforme `tpEmissao`.
   - **Autorizada / Cancelada / Inutilizada**, conforme `status`.
   - **XML corrompido/ausente**: nota sem `xmlContent` ou que falha no parse — é removida da seleção final nesta etapa (mas ainda é rastreada como inconformidade). Notas em contingência ou sem protocolo de autorização **não** são descartadas aqui, só reportadas.

3. **Verificação da sequência numérica** (`detectGroups`) — as notas são agrupadas por série; para cada série, calcula-se o intervalo `[numeroInicial, numeroFinal]` e identificam-se números que deveriam existir mas não vieram na consulta (lacunas).

4. **Busca em cascata nas pastas configuradas** (`buildFolderIndex`) — o app varre recursivamente as pastas de apoio cadastradas em **Configurações → Pastas**, na ordem em que foram configuradas (a primeira pasta a conter o arquivo tem prioridade). A chave de acesso de 44 dígitos (`cUF+AAMM+CNPJ+mod+série+nNF+tpEmis+cNF+cDV`) é praticamente sempre o próprio nome do arquivo (ou está embutida nele), então o índice inteiro é montado só a partir dos **nomes** — nenhum conteúdo é lido nesta fase, o custo é o mesmo pra uma pasta com 100 ou 100 mil arquivos:
   - **Nota com XML corrompido/ausente no banco (etapa 2), inclusive contingência sem protocolo** — a chave já é conhecida (veio da própria linha do banco); o app procura um arquivo cujo **nome seja exatamente** `<chave>.xml`, que é como o export sempre grava.
   - **Lacuna de numeração (etapa 3)** — como a nota nem chegou a existir na consulta, não há chave conhecida pra montar o nome esperado; em vez disso, **CNPJ, série e número são decodificados diretamente da chave embutida no nome de cada arquivo** (posições fixas: CNPJ = dígitos 7–20, série = 21–23, número = 24–32) e comparados com o que falta (fallback para série + número, caso o CNPJ não bata). Se nenhum arquivo tiver a chave no nome (ex.: nota que nem chegou a ser gravada no banco), o app tenta, nessa ordem, mais duas fontes pelo nome do arquivo:
     1. **Lote de envio à SEFAZ** do Plugin Fiscal/DocFiscAll — `serie_<série>_..._numero_<número>_..._env-lot.xml` — carrega o `<NFe>` completo enviado (ao contrário do `ret-lot`, que é só o retorno/protocolo, sem o conteúdo da nota, e por isso é ignorado).
     2. **Faixa inutilizada junto à SEFAZ** — `inutilizacao_serie_<série>_faixa_<nNFIni>_<nNFFin>_..._retorno.xml` (só o `_retorno`, que tem o protocolo `nProt`; o `_envio` é ignorado pelo mesmo motivo do `ret-lot`). Esse é o caso em que o número **nunca existiu como nota** — foi formalmente baixado junto à SEFAZ (ex.: timeout no envio, nota substituída por outra). Sem isso, a lacuna ficaria eternamente como "não recuperado" mesmo estando corretamente documentada; com isso, o número entra na exportação como prova da baixa, e a sequência numérica que a contabilidade cobra fica completa. `parseXml` reconhece o nó `infInut` (em vez de `infNFe`) e monta um item com `tipo: 'inutilizacao'`, `status: 'Inutilizada'`, `tpEmissao: 'Inutilização'`, sem `valor`, e uma `chave` sintética `INUT<Id do protocolo>` (não existe chave de acesso pra evento de inutilização — o `Id` do protocolo SEFAZ garante unicidade do nome do arquivo exportado).

     Essas vias (lote de envio e faixa inutilizada) só são usadas quando a chave não resolve o caso, nunca a substituem.

   Em qualquer uma das recuperações, `buildRecoveredItem` preenche `dataEmissao`, `valor`, `tpEmissao` e `status`: quando a linha já existia no banco (XML corrompido/ausente), esses campos vêm do próprio banco — mais confiáveis; quando é uma lacuna sem linha nenhuma no banco, eles são derivados do XML recuperado (`dhEmi`/`dEmi`, `vNF`, `tpEmis` → "Normal"/"Contingência"). `status` não vem do XML (não há coluna equivalente), então por padrão é tratado como "Autorizada" quando recuperado — a situação real da grande maioria dos casos em que a nota só está ausente do banco por falha de gravação local.

   Cada nota recuperada carrega um `metodoRecuperacao` (nome exato da chave / chave no nome do arquivo / lote de envio à SEFAZ) e aparece listada na interface em **"Notas recuperadas das pastas"**, já aberta por padrão — é esse resgate de notas que, de outro modo, ficariam de fora do lote por falha de gravação local, que justifica a etapa de busca em pastas existir.

   Em ambos os casos, o conteúdo do arquivo só é lido (e o XML parseado) para os poucos arquivos que efetivamente batem com alguma nota que precisa ser recuperada — nunca para descartar candidatos. XMLs recuperados entram no lote com `origem` igual ao nome da pasta onde foram achados. A interface mostra a contagem de arquivos XML encontrados nas pastas e um botão vermelho de "parar" para interromper o processamento (útil principalmente durante a listagem recursiva em pastas muito profundas).

5. **Deduplicação do lote** (`dedupeByChave`) — combina o conjunto original com os XMLs recuperados e mantém apenas uma ocorrência por chave de acesso, priorizando a origem "banco de dados" e, depois, a ordem das pastas configuradas. Duplicatas descartadas ficam registradas (de onde vieram, o que foi mantido).

6. **Separação de inconformidades** — do que sobrou após a deduplicação, só é isolada da lista final (e não entra no `.zip`) a nota cujo XML continua corrompido/ausente, já que não há dado nenhum pra exportar. Notas em **contingência/offline** (`tpEmis` diferente de 1 no XML) seguem normalmente para o pacote final **mesmo sem protocolo de autorização SEFAZ** — para a contabilidade, o que importa é a sequência numérica completa; segurar a nota esperando o protocolo cria um buraco pior do que mandar ela sem protocolo. A inconformidade (quando existe) vira parte do log exportável em CSV, para conferência manual.

7. **Relatório de quebras e pacote final** — para cada série, o relatório mostra CNPJ, número inicial/final, quantidade esperada vs. encontrada e a lista de lacunas que **não** foram recuperadas em nenhuma pasta (essas precisam ser conferidas manualmente no portal TOTVS, com atalho direto na interface). O relatório é exportável em CSV. O que passou por todas as etapas compõe o pacote final disponível para exportação em `.zip`.

## Nomeação dos arquivos exportados

Cada XML exportado (individualmente ou dentro do `.zip`) é nomeado apenas pela **chave de acesso** da nota (`<chave>.xml`), sanitizada para remover caracteres inválidos em nome de arquivo. Ver [fileNameFor em export.js](../src-electron/ipc/export.js).

## Relatório de log em XLSX (padrão SoftBR)

O botão **"Baixar Log"**, ao lado de "Baixar ZIP" na tela principal, gera um `.xlsx` de auditoria (`buildLogWorkbookBuffer` em [xlsxReport.js](../src-electron/lib/xlsxReport.js)) a partir do mesmo conjunto de notas selecionado para o `.zip` — é um relatório independente, não depende de ter rodado "Executar validação" antes. Assim como o `.zip`, salva direto na pasta de destino configurada (**Configurações → Pastas**), sem perguntar onde salvar; o nome do arquivo leva um timestamp (`Relatorio_XML_SoftBR-<timestamp>.xlsx`) pra nunca colidir com um relatório anterior que ainda esteja aberto em outro programa. Como os itens não carregam CNPJ, razão social, destinatário ou valores discriminados por padrão, essa etapa reparseia o XML de cada nota (`parseXmlDetalhado`, em [notaValidation.js](../src-electron/lib/notaValidation.js)) para extrair esses campos; o restante (status, tipo de emissão, valor total) vem do item já processado pelo pipeline, por ser mais confiável.

Qualquer escrita de arquivo nesse módulo (`.zip`, `.xlsx`, `.csv`, `.pdf`) passa por `writeFileSafe`, que traduz erros de arquivo travado/sem permissão (`EBUSY`/`EPERM`/`EACCES` — tipicamente o destino aberto no Excel) numa mensagem acionável, em vez de deixar o erro cru do Node subir pelo IPC.

`status` e `tipoEmissao` são normalizados para **CAIXA ALTA** (`toUpperOrEmpty`) antes de qualquer exibição ou agrupamento — o banco pode devolver "Autorizada" com capitalização variável conforme o ERP, enquanto o pipeline gera "AUTORIZADA" pra notas recuperadas de pasta; sem normalizar, viravam grupos diferentes em "Total por status" (mesmo problema de fundo da série "4" vs "004", só que em texto).

Três abas fixas:

- **XMLs** — uma linha por nota, ordenada por Série → Número → CNPJ → Tipo (nessa prioridade — a contabilidade confere visualmente por série/número, e reordenar manualmente por número numa planilha grande trava o Excel de alguns clientes, então o arquivo já sai pronto nessa ordem), com fundo colorido por status (autorizado/cancelado/rejeitado) e rodapé com os totais (quantidade, autorizados, cancelados, soma autorizada, soma geral). Número/série/valores são escritos como célula numérica de verdade (ou em branco de verdade quando ausentes) — nunca texto vazio `''` — porque colunas com tipo misto (número + texto) são causa clássica do Excel travar ou se comportar mal ao ordenar.
- **Quebras** — agrupa por CNPJ + **tipo real do documento** (modelo fiscal: NF-e/NFC-e) + série, não pelo rótulo de exibição. Isso importa porque um evento de **inutilização** aparece na aba XMLs com "Tipo Documento = Inutilização" (pra ficar visualmente claro que não é uma venda), mas pro cálculo de quebras ele precisa ser contado dentro da mesma sequência NF-e/NFC-e que baixou — senão o número apareceria simultaneamente "preenchido" (como inutilização) e "faltando" (quebra fantasma). Lista toda faixa CNPJ+tipo+série encontrada, inclusive as sem quebra nenhuma ("Sequência completa"), para auditoria completa.
- **Resumo** — totais lidos/válidos/duplicados, quebras, valores por status, e detalhamento por status/tipo/CNPJ.

Datas são formatadas lendo a string ISO (`dhEmi`) literalmente, sem conversão de fuso horário — importa o horário local gravado pelo PDV, não o fuso da máquina que roda o relatório.
