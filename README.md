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

## Build + publicar release no GitHub (auto-update)

Exige a variável de ambiente `GH_TOKEN` (um Personal Access Token do GitHub com escopo `repo`) e que `owner`/`repo` estejam corretos em `quasar.config.js` (`electron.builder.publish`):

```bash
GH_TOKEN=xxxx npx quasar build -m electron -- --publish=always
```

Também há um workflow em `.github/workflows/release.yml` que faz isso automaticamente ao dar push numa tag `v*`.

## Configuração inicial

1. Vá em **Configurações → Conexões** e cadastre a conexão com o SQL Server da(s) filial(is).
2. Em **Configurações → Consulta SQL**, ajuste o SQL padrão caso os nomes de tabela/coluna do seu banco sejam diferentes (precisa manter os parâmetros `@dataInicial` e `@dataFinal`).
3. Em **Configurações → Exportação**, escolha a pasta onde os .zip/XML serão salvos.
4. Na tela principal, escolha o período (ou use "Mês atual"/"Mês anterior"), clique em **Consultar** e depois em **Baixar ZIP**.

## Pendências antes do primeiro release público

- Substituir `REPLACE_WITH_GITHUB_OWNER` em `quasar.config.js` pelo owner/organização real do repositório no GitHub.
- Validar o SQL padrão contra uma conexão real (nomes de tabela/coluna já foram confirmados para o schema `nfce_notaeletronica` / `nfce_notaeletronica_content`, mas vale testar contra o banco de produção).
- Decidir sobre certificado de assinatura de código (Authenticode) para evitar avisos do SmartScreen nas atualizações automáticas.
