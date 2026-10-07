# XML Exporter SoftBR

Exportador de XML de notas fiscais (NF-e/NFC-e) para a contabilidade. App desktop em Electron + Quasar/Vue que conecta em bancos SQL Server na rede local, roda uma consulta configurável e exporta os XMLs selecionados em .zip.

## Instalar dependências

```bash
npm install
```

## Rodar em modo desenvolvimento (janela Electron real)

```bash
npm run dev
```

Isso abre a janela do app com hot-reload. **Precisa ser rodado num terminal normal (fora de sandboxes de agente/CI)**, já que abre uma janela gráfica de verdade.

## Build de produção (empacotado, sem publicar)

```bash
npx quasar build -m electron
```

## Publicar uma nova versão (auto-update)

1. Suba a `version` em `package.json` (ex: `0.1.2`).
2. `git tag vX.Y.Z && git push origin main --tags` (ou só a tag nova).
3. O workflow em `.github/workflows/release.yml` builda no Windows e publica a release automaticamente.

Para publicar manualmente (sem CI), rode `GH_TOKEN=xxxx npx quasar build -m electron` numa branch/commit com a tag correspondente já criada — **não passe `--publish=always` na linha de comando**: isso faz o Quasar sobrescrever a config de publish do `quasar.config.js` (que define `releaseType: 'release'`) e colide com a publicação implícita que o próprio `electron-builder` já dispara ao detectar uma tag com `GH_TOKEN` presente, causando erro 422 de release duplicada.

## Configuração inicial

1. Na primeira abertura (ou enquanto estiverem vazias), o app começa pelas telas **Empresa** (CNPJ da empresa licenciada) e **Contador** (nome e email de quem recebe os XMLs), nessa ordem. Depois de salvar as duas, segue para a tela principal.
2. Vá em **Configurações → Conexões** e cadastre a conexão com o SQL Server da(s) filial(is).
3. Em **Configurações → Conexões**, abaixo da lista de conexões, ajuste o SQL padrão caso os nomes de tabela/coluna do seu banco sejam diferentes (precisa manter os parâmetros `@dataInicial` e `@dataFinal`).
4. Em **Configurações → Pastas**, escolha a pasta onde os .zip/XML serão salvos.
5. Na tela principal, escolha o período (ou use "Mês atual"/"Mês anterior"), clique em **Consultar**, depois em **Validar / Auditar** e por fim em **Baixar .zip** ou **Enviar**.

## Pendências conhecidas

- Validar o SQL padrão contra uma conexão real (nomes de tabela/coluna já foram confirmados para o schema `nfce_notaeletronica` / `nfce_notaeletronica_content`, mas vale testar contra o banco de produção).
- Decidir sobre certificado de assinatura de código (Authenticode) para evitar avisos do SmartScreen nas atualizações automáticas.
