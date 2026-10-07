<template>
  <q-page class="q-pa-md">
    <div class="row items-end q-col-gutter-md">
      <div class="col-12 col-md-3">
        <div class="text-caption text-grey-8 row items-center q-gutter-xs">
          <q-icon name="dns" size="18px" />
          <span v-if="connectionsStore.loading">Carregando conexões...</span>
          <span v-else-if="connectionsStore.connections.length === 0">
            Nenhuma conexão configurada - Cadastre em
            <router-link to="/settings/connections">conexões</router-link>
          </span>
          <span v-else>
            Consultando {{ connectionsStore.connections.length }} conexão(ões):
            {{ connectionsStore.connections.map(c => c.name).join(', ') }}
          </span>
        </div>
      </div>

      <div class="col-12 col-md-auto">
        <div class="row items-center no-wrap date-range-picker">
          <q-btn flat dense round icon="chevron_left" @click="queryStore.shiftMonth(-1)">
            <q-tooltip>Mês anterior</q-tooltip>
          </q-btn>
          <q-btn flat dense no-caps :label="rangeLabel" class="date-range-label">
            <q-popup-proxy anchor="bottom left" self="top left" transition-show="scale" transition-hide="scale">
              <q-date v-model="dateRange" range mask="YYYY-MM-DD" today-btn minimal />
            </q-popup-proxy>
          </q-btn>
          <q-btn flat dense round icon="chevron_right" @click="queryStore.shiftMonth(1)">
            <q-tooltip>Próximo mês</q-tooltip>
          </q-btn>
        </div>
      </div>

      <div class="col-12 col-md-auto">
        <q-btn
          color="primary"
          label="Consultar"
          icon="search"
          :loading="queryStore.querying"
          :disable="connectionsStore.connections.length === 0 || queryStore.querying"
          @click="runQuery"
        />
      </div>
    </div>

    <div class="row items-center no-wrap filter-bar q-mt-md">
      <q-chip
        v-if="queryStore.groupFilter"
        removable
        dense
        color="primary"
        text-color="white"
        class="q-ml-sm"
        @remove="queryStore.clearGroupFilter"
      >
        Filtro: {{ queryStore.groupFilter.label }}
      </q-chip>

      <span class="text-caption text-grey-8 q-ml-sm text-no-wrap">
        {{ queryStore.count }} nota(s) encontrada(s)
      </span>

      <q-separator vertical inset class="q-mx-sm" />

      <span class="text-caption text-grey-8 text-no-wrap">
        {{ formatCurrency(queryStore.totalValor) }}
      </span>

      <q-separator vertical inset class="q-mx-sm" />

      <q-icon name="search" size="20px" class="text-grey-7" />
      <q-input
        v-model="searchText"
        dense
        borderless
        clearable
        class="col filter-search"
        placeholder="Pesquisar por número, série, chave ou valor total (R$)..."
      />

      <q-separator vertical inset class="q-mx-sm" />

      <span class="text-caption text-grey-8 q-mr-xs">Série:</span>
      <q-select
        v-model="filters.serie"
        :options="serieOptions"
        dense
        borderless
        emit-value
        map-options
        options-dense
        class="filter-select"
      />

      <q-separator vertical inset class="q-mx-sm" />

      <q-icon name="filter_list" size="18px" class="text-grey-7" />
      <span class="text-caption text-grey-8 q-mx-xs">Status:</span>
      <q-select
        v-model="filters.status"
        :options="statusOptions"
        dense
        borderless
        emit-value
        map-options
        options-dense
        class="filter-select"
      />

      <q-separator vertical inset class="q-mx-sm" />

      <span class="text-caption text-grey-8 q-mr-xs">Emissão:</span>
      <q-select
        v-model="filters.tpEmissao"
        :options="tpEmissaoOptions"
        dense
        borderless
        emit-value
        map-options
        options-dense
        class="filter-select q-mr-sm"
      />
    </div>

    <q-table
      class="q-mt-sm notes-table"
      :rows="filteredRows"
      :columns="columns"
      row-key="chave"
      selection="multiple"
      v-model:selected="queryStore.selected"
      :loading="queryStore.querying"
      virtual-scroll
      :virtual-scroll-item-size="48"
      :rows-per-page-options="[0]"
      :pagination="{ rowsPerPage: 0 }"
      flat
      bordered
      dense
      sticky-header
    >
      <template #body-cell-dataEmissao="props">
        <q-td :props="props">{{ formatDate(props.value) }}</q-td>
      </template>

      <template #body-cell-valor="props">
        <q-td :props="props">{{ formatCurrency(props.value) }}</q-td>
      </template>

      <template #body-cell-xmlStatus="props">
        <q-td :props="props">
          <q-badge :color="String(props.value ?? '').toUpperCase() === 'DISPONÍVEL' ? 'positive' : 'grey'">
            {{ props.value }}
          </q-badge>
        </q-td>
      </template>

      <template #body-cell-acoes="props">
        <q-td :props="props">
          <q-btn
            flat
            dense
            round
            icon="visibility"
            :disable="!props.row.xmlContent"
            @click="openDetail(props.row)"
          />
          <q-btn
            flat
            dense
            round
            icon="download"
            :disable="!props.row.xmlContent"
            @click="downloadOne(props.row)"
          />
        </q-td>
      </template>

      <template #bottom>
        <div class="row items-center full-width text-caption text-grey-8">
          <span class="text-no-wrap">{{ selectedCount }} selecionada(s)</span>
          <q-separator vertical inset class="q-mx-sm" />
          <span class="text-no-wrap">{{ formatCurrency(selectedTotal) }}</span>
        </div>
      </template>
    </q-table>

    <NotaDetailDialog v-model="detailOpen" :row="detailRow" />

    <ValidationChecklist ref="validationRef" />

    <SendDialog
      v-model="sendDialogOpen"
      :note-count="selectedCount"
      :period-label="rangeLabel"
      @confirm="send"
    />

    <div class="row items-center justify-end q-mt-md q-gutter-sm">
      <div v-if="lastSuccess" class="text-caption text-grey-8 row items-center no-wrap">
        <q-icon name="history" size="18px" class="q-mr-xs" />
        Último envio: {{ lastSuccessLabel }}
      </div>
      <div v-if="!queryStore.validated" class="text-caption text-grey-8 row items-center no-wrap">
        <q-icon name="info" size="18px" color="primary" class="q-mr-xs" />
        Clique em "Validar / Auditar" antes de enviar ou baixar o .zip.
      </div>
      <!-- Botão desabilitado não dispara tooltip; o wrapper é quem recebe o hover. -->
      <div>
        <q-btn
          color="secondary"
          outline
          :icon="queryStore.uploaded ? 'check' : 'send'"
          :label="queryStore.uploaded ? 'Reenviar' : 'Enviar'"
          :loading="sending"
          :disable="busy || !queryStore.validated"
          @click="sendDialogOpen = true"
        />
        <q-tooltip v-if="!queryStore.validated">
          Clique em "Validar / Auditar" primeiro: a validação recupera notas faltantes,
          remove duplicadas e define quais notas entram no .zip.
        </q-tooltip>
        <q-tooltip v-else-if="queryStore.uploaded">
          Já enviado nesta validação. Reenviar usa o mesmo .zip, sem gerar os arquivos de novo.
        </q-tooltip>
      </div>
      <div>
        <q-btn
          color="primary"
          icon="folder_zip"
          label="Baixar .zip"
          :loading="downloadingZip"
          :disable="busy || !queryStore.validated"
          @click="downloadZip"
        />
        <q-tooltip v-if="!queryStore.validated">
          Clique em "Validar / Auditar" primeiro: a validação recupera notas faltantes,
          remove duplicadas e define quais notas entram no .zip.
        </q-tooltip>
      </div>
    </div>

    <div class="row items-center justify-end q-mt-xs export-status">
      <template v-if="uploadProgress">
        <span class="text-caption q-mr-sm">{{ statusMessage }}</span>
        <q-linear-progress
          :value="uploadProgress.sent / uploadProgress.total"
          color="primary"
          rounded
          size="10px"
          class="upload-progress"
        />
      </template>
      <template v-else-if="statusMessage">
        <q-spinner-dots color="primary" size="20px" class="q-mr-xs" />
        <span class="text-caption">{{ statusMessage }}</span>
      </template>
      <template v-else-if="exportMessage">
        <div
          :class="!exportOk ? 'text-negative' : exportWarning ? 'text-warning' : 'text-positive'"
          class="text-caption export-message"
        >
          {{ exportMessage }}
        </div>
      </template>
    </div>
  </q-page>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useQuasar, date } from 'quasar'
import { useConnectionsStore } from '@/stores/connections-store'
import { useQueryStore } from '@/stores/query-store'
import { toPlain } from '@/utils/ipc'
import NotaDetailDialog from '@/components/NotaDetailDialog.vue'
import ValidationChecklist from '@/components/ValidationChecklist.vue'
import SendDialog from '@/components/SendDialog.vue'

const $q = useQuasar()
const connectionsStore = useConnectionsStore()
const queryStore = useQueryStore()

const downloadingZip = ref(false)
const sending = ref(false)
const sendDialogOpen = ref(false)
const exportProgress = ref('')
const uploadProgress = ref(null)
const exportMessage = ref('')
const exportOk = ref(true)
const exportWarning = ref(false)
const detailOpen = ref(false)
const detailRow = ref(null)
const validationRef = ref(null)
const lastSuccess = ref(null)

// O que o sistema está fazendo agora, exibido ao lado do loader embaixo
// dos botões. Vazio = ocioso (aí aparece o resultado da última exportação).
const statusMessage = computed(() => {
  if (uploadProgress.value) {
    const { sent, total } = uploadProgress.value
    return `Enviando .zip para a contabilidade... ${Math.floor((sent / total) * 100)}% ` +
      `(${formatMb(sent)} de ${formatMb(total)})`
  }
  if (downloadingZip.value || sending.value) return exportProgress.value || 'Preparando exportação...'
  if (queryStore.querying) return `Consultando ${connectionsStore.connections.length} conexão(ões)...`
  if (queryStore.validating) return 'Executando validação...'
  if (connectionsStore.loading) return 'Carregando conexões...'
  return ''
})
const busy = computed(() => statusMessage.value !== '')

// "07/10/2026 14:32 (09/2026)": quando foi enviado e de qual período.
const lastSuccessLabel = computed(() => {
  const last = lastSuccess.value
  if (!last) return ''
  const when = date.formatDate(new Date(last.uploadedAt), 'DD/MM/YYYY HH:mm')
  const start = last.period?.dataInicial
  const end = last.period?.dataFinal
  if (!start) return when
  const sameMonth = start.slice(0, 7) === String(end ?? '').slice(0, 7)
  return sameMonth
    ? `${when} (${start.slice(5, 7)}/${start.slice(0, 4)})`
    : `${when} (${formatRangeDate(start)} a ${formatRangeDate(end)})`
})

const selectedCount = computed(() => queryStore.selected.length)
const selectedTotal = computed(() =>
  queryStore.selected.reduce((sum, row) => sum + (Number(row.valor) || 0), 0)
)

const columns = [
  { name: 'conexao', label: 'Conexão', field: 'conexao', align: 'left', sortable: true },
  { name: 'numero', label: 'Número', field: 'numero', align: 'left', sortable: true },
  { name: 'serie', label: 'Série', field: 'serie', align: 'left', sortable: true },
  { name: 'chave', label: 'Chave', field: 'chave', align: 'left' },
  { name: 'dataEmissao', label: 'Data emissão', field: 'dataEmissao', align: 'left', sortable: true },
  { name: 'valor', label: 'Valor', field: 'valor', align: 'right', sortable: true },
  { name: 'tpEmissao', label: 'Tp emissão', field: 'tpEmissao', align: 'left', sortable: true },
  { name: 'status', label: 'Status', field: 'status', align: 'left', sortable: true },
  { name: 'xmlStatus', label: 'XML status', field: 'xmlStatus', align: 'left' },
  { name: 'acoes', label: 'Ações', field: 'acoes', align: 'center' }
]

function formatRangeDate (iso) {
  if (!iso) return ''
  return date.formatDate(date.extractDate(iso, 'YYYY-MM-DD'), 'DD/MM/YYYY')
}

const rangeLabel = computed(() => `${formatRangeDate(queryStore.dataInicial)} - ${formatRangeDate(queryStore.dataFinal)}`)

const dateRange = computed({
  get: () => ({ from: queryStore.dataInicial, to: queryStore.dataFinal }),
  set: (val) => {
    if (!val) return
    // seleção de um único dia: QDate manda a data em vez de {from, to}
    if (typeof val === 'string') {
      queryStore.dataInicial = val
      queryStore.dataFinal = val
    } else {
      queryStore.dataInicial = val.from
      queryStore.dataFinal = val.to
    }
  }
})

const searchText = ref('')
const filters = reactive({
  serie: null,
  status: null,
  tpEmissao: null
})

function uniqueValues (field) {
  const values = new Set()
  for (const row of queryStore.rows) {
    if (row[field] !== null && row[field] !== undefined && row[field] !== '') {
      values.add(row[field])
    }
  }
  return [...values].sort()
}

const serieOptions = computed(() => {
  const distinct = uniqueValues('serie')
  return [
    { label: `Todas as Séries (${distinct.length})`, value: null },
    ...distinct.map((v) => ({ label: `Série ${v}`, value: v }))
  ]
})

const statusOptions = computed(() => {
  const distinct = uniqueValues('status')
  return [
    { label: 'Todas as Situações', value: null },
    ...distinct.map((v) => ({ label: v, value: v }))
  ]
})

const tpEmissaoOptions = computed(() => {
  const distinct = uniqueValues('tpEmissao')
  return [
    { label: 'Todas as Emissões', value: null },
    ...distinct.map((v) => ({ label: v, value: v }))
  ]
})

const filteredRows = computed(() => {
  const search = String(searchText.value ?? '').trim().toLowerCase()
  const groupChaves = queryStore.groupFilter?.chaves

  return queryStore.rows.filter((row) => {
    if (groupChaves && !groupChaves.includes(row.chave)) return false
    if (filters.serie !== null && row.serie !== filters.serie) return false
    if (filters.status !== null && row.status !== filters.status) return false
    if (filters.tpEmissao !== null && row.tpEmissao !== filters.tpEmissao) return false

    if (!search) return true
    return (
      String(row.numero ?? '').toLowerCase().includes(search) ||
      String(row.serie ?? '').toLowerCase().includes(search) ||
      String(row.chave ?? '').toLowerCase().includes(search) ||
      formatCurrency(row.valor).toLowerCase().includes(search)
    )
  })
})

function formatCurrency (value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0)
}

function formatDate (value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

async function runQuery () {
  try {
    const errors = await queryStore.run()
    if (errors?.length) {
      $q.notify({
        type: 'warning',
        multiLine: true,
        message: `${errors.length} conexão(ões) falharam e ficaram de fora da consulta:\n${errors.join('\n')}`
      })
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message ?? String(err) })
  }
}

function openDetail (row) {
  detailRow.value = row
  detailOpen.value = true
}

async function downloadOne (row) {
  try {
    const result = await window.api.export.downloadOne(toPlain(row))
    exportOk.value = result.ok
    exportWarning.value = false
    exportMessage.value = result.ok ? `Arquivo salvo em ${result.path}` : result.message
  } catch (err) {
    exportOk.value = false
    exportMessage.value = err.message ?? String(err)
  }
}

async function downloadZip () {
  downloadingZip.value = true
  exportProgress.value = ''
  exportMessage.value = ''
  exportWarning.value = false
  const unsubscribe = window.api.export.onProgress((message) => { exportProgress.value = message })
  try {
    const period = { dataInicial: queryStore.dataInicial, dataFinal: queryStore.dataFinal }
    const result = await window.api.export.downloadZip(toPlain(queryStore.selected), period)
    exportOk.value = result.ok
    if (!result.ok) {
      exportMessage.value = result.message
    } else {
      exportMessage.value = `Arquivo salvo em ${result.path} (${result.fileCount} XML(s) + relatório)`
    }
  } catch (err) {
    exportOk.value = false
    exportMessage.value = err.message ?? String(err)
  } finally {
    unsubscribe()
    downloadingZip.value = false
  }
}

function formatMb (bytes) {
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

// Gera o .zip (mesmo fluxo do "Baixar .zip") e envia pro storage da SoftBR.
// Depois de enviado, o botão vira "Reenviar" e manda o mesmo .zip já gerado
// (até validar ou consultar de novo). `emails` vem do diálogo de envio (email do contador, editável por envio).
async function send (emails) {
  sending.value = true
  exportProgress.value = ''
  uploadProgress.value = null
  exportMessage.value = ''
  exportWarning.value = false
  const unsubscribeProgress = window.api.export.onProgress((message) => { exportProgress.value = message })
  const unsubscribeUpload = window.api.export.onUploadProgress((progress) => { uploadProgress.value = progress })
  try {
    const period = { dataInicial: queryStore.dataInicial, dataFinal: queryStore.dataFinal }
    const result = await window.api.export.sendZip(
      toPlain(queryStore.selected),
      period,
      emails,
      toPlain(queryStore.uploaded)
    )
    exportOk.value = result.ok
    if (!result.ok) {
      exportMessage.value = result.message
    } else {
      queryStore.uploaded = { path: result.path, fileCount: result.fileCount }
      lastSuccess.value = result.lastSuccess ?? lastSuccess.value
      exportMessage.value = result.emailError
        ? `Arquivo enviado (${result.fileCount} XML(s) + relatório), mas o email não foi enviado: ` +
          `${result.emailError} Cópia salva em ${result.path}`
        : `Enviado: link de download mandado para ${emails.join(', ')} ` +
          `(${result.fileCount} XML(s) + relatório). Cópia salva em ${result.path}`
      exportWarning.value = !!result.emailError
    }
  } catch (err) {
    exportOk.value = false
    exportMessage.value = err.message ?? String(err)
  } finally {
    unsubscribeProgress()
    unsubscribeUpload()
    uploadProgress.value = null
    sending.value = false
  }
}

// Abertura pela tarefa agendada (1ª segunda-feira do mês, ver menu Contador):
// consulta e valida o mês anterior inteiro. Com "Enviar sem revisar" ligado,
// já envia pro email do contador; senão para e espera o usuário clicar em "Enviar".
async function runMonthlyAuto () {
  if (connectionsStore.connections.length === 0) {
    $q.notify({ type: 'warning', message: 'Envio mensal automático: nenhuma conexão configurada.' })
    return
  }

  queryStore.dataInicial = date.formatDate(date.startOfDate(new Date(), 'month'), 'YYYY-MM-DD')
  queryStore.shiftMonth(-1)
  await runQuery()
  if (queryStore.lastError) return

  await validationRef.value.run()
  if (!queryStore.validated) {
    $q.notify({ type: 'warning', message: 'Envio mensal automático: a validação não foi concluída.' })
    return
  }

  const accountant = await window.api.settings.getAccountant()
  const email = String(accountant?.email ?? '').trim()
  if (accountant?.sendWithoutReview && email) {
    await send([email])
    return
  }

  $q.notify({
    type: 'info',
    timeout: 0,
    closeBtn: 'OK',
    message: accountant?.sendWithoutReview
      ? `Envio mensal: ${rangeLabel.value} consultado e validado, mas o contador não tem email. ` +
        'Revise e clique em "Enviar".'
      : `Envio mensal: ${rangeLabel.value} consultado e validado. Revise e clique em "Enviar".`
  })
}

onMounted(async () => {
  lastSuccess.value = await window.api.export.getLastSuccess()
  await connectionsStore.load()
  if (await window.api.app.consumeAutoRun()) await runMonthlyAuto()
})
</script>

<style scoped>
.notes-table {
  height: 50vh;
}

.notes-table :deep(.q-table__middle) {
  height: 100%;
}

.notes-table :deep(thead tr th) {
  position: sticky;
  top: 0;
  z-index: 1;
  background-color: #fff;
}

.export-status {
  min-height: 24px;
}

.upload-progress {
  width: 240px;
}

.export-message {
  max-width: 100%;
  overflow-x: auto;
  white-space: nowrap;
}

.date-range-picker {
  background: #f0f0f0;
  border-radius: 8px;
  padding: 0 2px;
}

.date-range-label {
  min-width: 170px;
}

.filter-bar {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: #fafafa;
  padding: 4px 0;
}

.filter-search :deep(input) {
  font-size: 0.9rem;
}

.filter-select {
  min-width: 160px;
}

.filter-select :deep(.q-field__control) {
  min-height: 32px;
}
</style>

