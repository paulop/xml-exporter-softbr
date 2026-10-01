<template>
  <q-page class="q-pa-md">
    <div class="row items-end q-col-gutter-md">
      <div class="col-12 col-md-3">
        <div class="text-caption text-grey-8 row items-center q-gutter-xs">
          <q-icon name="dns" size="18px" />
          <span v-if="connectionsStore.loading">Carregando conexões...</span>
          <span v-else-if="connectionsStore.connections.length === 0">
            Nenhuma conexão configurada —
            <router-link to="/settings/connections">cadastre em Configurações</router-link>
          </span>
          <span v-else>
            Consultando {{ connectionsStore.connections.length }} conexão(ões):
            {{ connectionsStore.connections.map(c => c.name).join(', ') }}
          </span>
        </div>
      </div>

      <div class="col-6 col-md-2">
        <q-input v-model="queryStore.dataInicial" type="date" label="Data inicial" dense />
      </div>

      <div class="col-6 col-md-2">
        <q-input v-model="queryStore.dataFinal" type="date" label="Data final" dense />
      </div>

      <div class="col-12 col-md-auto">
        <q-btn flat dense label="Mês atual" @click="queryStore.setCurrentMonth" />
        <q-btn flat dense label="Mês anterior" @click="queryStore.setPreviousMonth" />
      </div>

      <div class="col-12 col-md-auto">
        <q-btn
          color="primary"
          label="Consultar"
          icon="search"
          :loading="queryStore.querying"
          :disable="connectionsStore.connections.length === 0"
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

    <ValidationChecklist />

    <div class="row items-center justify-end q-mt-md q-gutter-sm">
      <q-btn
        color="secondary"
        outline
        icon="description"
        label="Baixar Log"
        :loading="downloadingLog"
        :disable="queryStore.selected.length === 0"
        @click="downloadLog"
      />
      <q-btn
        color="primary"
        icon="folder_zip"
        label="Baixar ZIP"
        :loading="downloadingZip"
        :disable="queryStore.selected.length === 0"
        @click="downloadZip"
      />
    </div>

    <div class="row items-center justify-end q-mt-xs export-status">
      <template v-if="downloadingZip || downloadingLog">
        <q-spinner-dots color="primary" size="20px" class="q-mr-xs" />
        <span class="text-caption">Salvando arquivo...</span>
      </template>
      <template v-else-if="exportMessage">
        <div :class="exportOk ? 'text-positive' : 'text-negative'" class="text-caption export-message">
          {{ exportMessage }}
        </div>
      </template>
    </div>
  </q-page>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { useConnectionsStore } from '@/stores/connections-store'
import { useQueryStore } from '@/stores/query-store'
import { toPlain } from '@/utils/ipc'
import NotaDetailDialog from '@/components/NotaDetailDialog.vue'
import ValidationChecklist from '@/components/ValidationChecklist.vue'

const $q = useQuasar()
const connectionsStore = useConnectionsStore()
const queryStore = useQueryStore()

const downloadingZip = ref(false)
const downloadingLog = ref(false)
const exportMessage = ref('')
const exportOk = ref(true)
const detailOpen = ref(false)
const detailRow = ref(null)

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
    exportMessage.value = result.ok ? `Arquivo salvo em ${result.path}` : result.message
  } catch (err) {
    exportOk.value = false
    exportMessage.value = err.message ?? String(err)
  }
}

async function downloadZip () {
  downloadingZip.value = true
  exportMessage.value = ''
  try {
    const result = await window.api.export.downloadZip(toPlain(queryStore.selected))
    exportOk.value = result.ok
    exportMessage.value = result.ok
      ? `Arquivo salvo em ${result.path} (${result.fileCount} XML(s))`
      : result.message
  } catch (err) {
    exportOk.value = false
    exportMessage.value = err.message ?? String(err)
  } finally {
    downloadingZip.value = false
  }
}

async function downloadLog () {
  downloadingLog.value = true
  exportMessage.value = ''
  try {
    const result = await window.api.export.downloadLogXlsx(toPlain(queryStore.selected))
    exportOk.value = result.ok
    exportMessage.value = result.ok
      ? `Log salvo em ${result.path}`
      : result.message
  } catch (err) {
    exportOk.value = false
    exportMessage.value = err.message ?? String(err)
  } finally {
    downloadingLog.value = false
  }
}

onMounted(async () => {
  await connectionsStore.load()
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

.export-message {
  max-width: 100%;
  overflow-x: auto;
  white-space: nowrap;
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

