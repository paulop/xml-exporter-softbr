<template>
  <q-page class="q-pa-md">
    <div class="row items-end q-col-gutter-md">
      <div class="col-12 col-md-3">
        <q-select
          v-model="activeConnectionId"
          :options="connectionOptions"
          emit-value
          map-options
          label="Conexão"
          :loading="connectionsStore.loading"
          @update:model-value="onConnectionChange"
        />
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
          :disable="!activeConnectionId"
          @click="runQuery"
        />
      </div>
    </div>

    <div class="row q-col-gutter-md q-mt-sm">
      <div class="col-auto">
        <q-chip color="primary" text-color="white" icon="receipt_long">
          {{ queryStore.count }} nota(s)
        </q-chip>
      </div>
      <div class="col-auto">
        <q-chip color="secondary" text-color="white" icon="payments">
          {{ formatCurrency(queryStore.totalValor) }}
        </q-chip>
      </div>
    </div>

    <q-table
      class="q-mt-md notes-table"
      :rows="queryStore.rows"
      :columns="columns"
      row-key="chave"
      selection="multiple"
      v-model:selected="queryStore.selected"
      :loading="queryStore.querying"
      virtual-scroll
      :virtual-scroll-item-size="48"
      :rows-per-page-options="[0]"
      :pagination="{ rowsPerPage: 0 }"
      hide-bottom
      flat
      bordered
    >
      <template #body-cell-valor="props">
        <q-td :props="props">{{ formatCurrency(props.value) }}</q-td>
      </template>

      <template #body-cell-xmlStatus="props">
        <q-td :props="props">
          <q-badge :color="props.value === 'Disponível' ? 'positive' : 'grey'">
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
            icon="download"
            :disable="!props.row.xmlContent"
            @click="downloadOne(props.row)"
          />
        </q-td>
      </template>
    </q-table>

    <div class="row items-center justify-between q-mt-md">
      <div class="row q-col-gutter-sm">
        <div class="col-auto">
          <q-chip color="primary" outline icon="check_box">
            {{ selectedCount }} selecionada(s)
          </q-chip>
        </div>
        <div class="col-auto">
          <q-chip color="secondary" outline icon="payments">
            {{ formatCurrency(selectedTotal) }}
          </q-chip>
        </div>
      </div>

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
      <template v-if="downloadingZip">
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
import { ref, computed, onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { useConnectionsStore } from '@/stores/connections-store'
import { useQueryStore } from '@/stores/query-store'
import { toPlain } from '@/utils/ipc'

const $q = useQuasar()
const connectionsStore = useConnectionsStore()
const queryStore = useQueryStore()

const activeConnectionId = ref(null)
const downloadingZip = ref(false)
const exportMessage = ref('')
const exportOk = ref(true)

const connectionOptions = computed(() =>
  connectionsStore.connections.map((c) => ({ label: c.name, value: c.id }))
)

const selectedCount = computed(() => queryStore.selected.length)
const selectedTotal = computed(() =>
  queryStore.selected.reduce((sum, row) => sum + (Number(row.valor) || 0), 0)
)

const columns = [
  { name: 'numero', label: 'Número', field: 'numero', align: 'left', sortable: true },
  { name: 'serie', label: 'Série', field: 'serie', align: 'left', sortable: true },
  { name: 'chave', label: 'Chave', field: 'chave', align: 'left' },
  { name: 'dataEmissao', label: 'Data emissão', field: 'dataEmissao', align: 'left', sortable: true },
  { name: 'valor', label: 'Valor', field: 'valor', align: 'right', sortable: true },
  { name: 'tpEmissao', label: 'Tp emissão', field: 'tpEmissao', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'xmlStatus', label: 'XML status', field: 'xmlStatus', align: 'left' },
  { name: 'acoes', label: 'Ações', field: 'acoes', align: 'center' }
]

function formatCurrency (value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0)
}

async function onConnectionChange (id) {
  await connectionsStore.setActive(id)
}

async function runQuery () {
  try {
    await queryStore.run(activeConnectionId.value)
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message ?? String(err) })
  }
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

onMounted(async () => {
  await connectionsStore.load()
  activeConnectionId.value = connectionsStore.activeConnectionId
})
</script>

<style scoped>
.notes-table {
  height: 50vh;
}

.notes-table :deep(.q-table__middle) {
  height: 100%;
}

.export-status {
  min-height: 24px;
}

.export-message {
  max-width: 100%;
  overflow-x: auto;
  white-space: nowrap;
}
</style>

