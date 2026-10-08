<template>
  <q-card flat bordered class="q-mt-md validation-card">
    <q-card-section class="row items-center justify-between">
      <div class="text-subtitle1">Validação e recuperação automática</div>
      <div class="row items-center q-gutter-sm">
        <q-btn
          v-if="running"
          color="negative"
          round
          dense
          icon="stop"
          :loading="cancelling"
          aria-label="Parar processamento"
          @click="stop"
        >
          <q-tooltip>Parar processamento</q-tooltip>
        </q-btn>
        <q-btn
          color="primary"
          outline
          icon="fact_check"
          label="Validar / Auditar"
          :loading="running"
          :disable="running"
          @click="run"
        />
      </div>
    </q-card-section>

    <q-card-section v-if="running" class="q-pt-none">
      <q-linear-progress
        :indeterminate="progressIndeterminate"
        :value="progressValue"
        color="primary"
        stripe
        size="10px"
        class="rounded-borders"
      />
      <div class="text-caption text-grey q-mt-xs">{{ progressLabel }}</div>
    </q-card-section>

    <template v-if="steps.length">
      <q-separator />

      <q-card-section class="log-area">
        <div class="log-line">
          <q-icon name="check_circle" color="positive" size="18px" />
          <span>
            Passo 1 — Extração do banco de dados: já realizada pela consulta acima
            ({{ queryStore.count }} nota(s)).
          </span>
        </div>

        <template v-for="step in steps" :key="step.id">
          <div v-if="step.id === 'estrutura-protocolo'" class="log-line">
            <q-icon :name="statusIcon(step.status)" :color="statusColor(step.status)" size="18px" />
            <div class="col">
              <div><strong>{{ step.label }}</strong></div>
              <div class="row q-gutter-xs q-mt-xs">
                <q-chip
                  v-for="g in grupoChips"
                  :key="g.key"
                  clickable
                  dense
                  :color="queryStore.groupFilter?.label === g.label ? 'primary' : 'grey-3'"
                  :text-color="queryStore.groupFilter?.label === g.label ? 'white' : 'black'"
                  @click="toggleGrupo(g)"
                >
                  {{ g.label }}: {{ g.count }}
                </q-chip>
              </div>
            </div>
          </div>

          <div v-else class="log-line">
            <q-icon :name="statusIcon(step.status)" :color="statusColor(step.status)" size="18px" />
            <span><strong>{{ step.label }}:</strong> {{ step.detail }}</span>
          </div>
        </template>

        <q-expansion-item
          v-if="recovered.length"
          dense
          icon="task_alt"
          default-opened
          :label="`Notas recuperadas das pastas (${recovered.length})`"
          class="q-mt-sm"
        >
          <q-list dense bordered separator>
            <q-item v-for="(item, i) in recovered" :key="i">
              <q-item-section avatar>
                <q-icon name="check_circle" color="positive" size="18px" />
              </q-item-section>
              <q-item-section>
                <div>Nº {{ item.numero }} / Série {{ item.serie }} — {{ item.metodoRecuperacao }}</div>
                <div class="text-caption text-grey">Chave {{ item.chave }} · Pasta "{{ item.origem }}"</div>
              </q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>

        <q-expansion-item
          v-if="duplicates.length"
          dense
          icon="content_copy"
          :label="`Duplicatas removidas (${duplicates.length})`"
          class="q-mt-sm"
        >
          <q-list dense bordered separator>
            <q-item v-for="(d, i) in duplicates" :key="i">
              <q-item-section>
                Chave {{ d.chave }} — mantida de "{{ d.mantidoDe }}", descartada de "{{ d.descartadoDe }}"
              </q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>

        <q-expansion-item
          v-if="invalid.length"
          dense
          icon="report"
          :label="`Notas em inconformidade (${invalid.length})`"
          class="q-mt-sm"
        >
          <q-list dense bordered separator>
            <q-item v-for="(item, i) in invalid" :key="i">
              <q-item-section>
                Nº {{ item.numero }} / Série {{ item.serie }} — {{ item.motivo }}
              </q-item-section>
            </q-item>
          </q-list>
          <div class="q-pa-sm">
            <q-btn
              flat
              dense
              icon="download"
              label="Baixar log de inconformidades (CSV)"
              @click="downloadInconformidadesCsv"
            />
          </div>
        </q-expansion-item>

        <q-expansion-item
          v-if="naoRecuperados.length"
          dense
          icon="link_off"
          :label="`Lacunas não recuperadas localmente (${naoRecuperados.length})`"
          class="q-mt-sm"
        >
          <q-list dense bordered separator>
            <q-item v-for="(g, i) in naoRecuperados" :key="i">
              <q-item-section>Série {{ g.serie }} — Nº {{ g.numero }}</q-item-section>
            </q-item>
          </q-list>
          <div class="q-pa-sm">
            <q-btn
              flat
              dense
              icon="link"
              label="Verificar manualmente no portal TOTVS"
              @click="settingsStore.openPortal"
            />
          </div>
        </q-expansion-item>

        <q-separator class="q-my-md" />

        <div class="text-subtitle2 q-mb-sm">Relatório de sequência</div>
        <q-markup-table dense flat bordered>
          <thead>
            <tr>
              <th class="text-left">Conexão</th>
              <th>Tipo</th>
              <th>CNPJ</th>
              <th>Série</th>
              <th>Nº inicial</th>
              <th>Nº final</th>
              <th>Qtde esperada</th>
              <th>Qtde encontrada</th>
              <th>Lacunas não recuperadas</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in sequenceRows" :key="i">
              <td class="text-left">{{ r.conexao || '—' }}</td>
              <td>{{ r.tipo }}</td>
              <td>{{ r.cnpj }}</td>
              <td>{{ r.serie }}</td>
              <td>{{ r.numeroInicial }}</td>
              <td>{{ r.numeroFinal }}</td>
              <td>{{ r.quantidadeEsperada }}</td>
              <td>{{ r.quantidadeEncontrada }}</td>
              <td>
                <q-badge v-if="r.lacunas.length === 0" color="positive">Sequência completa</q-badge>
                <span v-else class="text-negative">{{ r.lacunas.join(', ') }}</span>
              </td>
            </tr>
            <tr v-if="sequenceRows.length === 0">
              <td colspan="9" class="text-center text-grey">Nenhuma série analisada.</td>
            </tr>
          </tbody>
        </q-markup-table>

        <div class="row justify-end q-mt-sm">
          <q-btn
            flat
            dense
            icon="download"
            label="Baixar CSV do relatório"
            :disable="sequenceRows.length === 0"
            @click="downloadCsv"
          />
        </div>
      </q-card-section>
    </template>
  </q-card>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useQuasar } from 'quasar'
import { useQueryStore } from '@/stores/query-store'
import { useSettingsStore } from '@/stores/settings-store'
import { toPlain } from '@/utils/ipc'

const $q = useQuasar()
const queryStore = useQueryStore()
const settingsStore = useSettingsStore()

const running = ref(false)
const cancelling = ref(false)
const progress = ref(null)
const steps = ref([])
const recovered = ref([])
const duplicates = ref([])
const invalid = ref([])
const naoRecuperados = ref([])
const reportRows = ref([])
const nfeFolderValidation = ref([])
const grupos = ref({ normal: [], offline: [], autorizada: [], cancelada: [], inutilizada: [], xmlInvalido: [] })

const grupoChips = computed(() => [
  { key: 'normal', label: 'Normal', count: grupos.value.normal.length, chaves: grupos.value.normal },
  { key: 'offline', label: 'Offline', count: grupos.value.offline.length, chaves: grupos.value.offline },
  { key: 'autorizada', label: 'Autorizada', count: grupos.value.autorizada.length, chaves: grupos.value.autorizada },
  { key: 'cancelada', label: 'Cancelada', count: grupos.value.cancelada.length, chaves: grupos.value.cancelada },
  { key: 'inutilizada', label: 'Inutilizada', count: grupos.value.inutilizada.length, chaves: grupos.value.inutilizada },
  { key: 'xmlInvalido', label: 'XML corrompido/ausente', count: grupos.value.xmlInvalido.length, chaves: grupos.value.xmlInvalido }
])

const progressValue = computed(() => {
  const p = progress.value
  if (!p) return 0
  return Math.min(1, Math.max(0, (p.step - 1) / p.totalSteps))
})

const progressIndeterminate = computed(() => progress.value?.phase === 'listing')

const progressLabel = computed(() => {
  const p = progress.value
  if (!p) return ''
  if (p.phase === 'listing') return 'Listando arquivos nas pastas configuradas...'
  if (p.phase === 'listed') return `${p.totalFound} arquivo(s) XML encontrado(s) nas pastas configuradas.`
  if (p.phase === 'extending') return 'Procurando nas pastas notas do período que não estão no banco...'
  return `${p.label}...`
})

// NFC-e (séries do banco, por conexão) e NF-e (pastas avulsas, sem conexão
// de banco) numa tabela só, com as lacunas no mesmo campo.
const sequenceRows = computed(() => [
  ...reportRows.value.map((r) => ({ ...r, tipo: 'NFC-e', lacunas: r.lacunasNaoRecuperadas })),
  ...nfeFolderValidation.value.map((r) => ({ ...r, tipo: 'NF-e', conexao: 'Pasta de NF-e avulsa' }))
])

function toggleGrupo (grupo) {
  if (queryStore.groupFilter?.label === grupo.label) {
    queryStore.clearGroupFilter()
  } else {
    queryStore.setGroupFilter(grupo.label, grupo.chaves)
  }
}

function statusIcon (status) {
  return status === 'ok' ? 'check_circle' : status === 'warn' ? 'warning' : 'error'
}

function statusColor (status) {
  return status === 'ok' ? 'positive' : status === 'warn' ? 'warning' : 'negative'
}

// Devolve o resultado da validação (null se cancelada ou com erro) — a
// execução automática mensal usa pra saber o que não deu pra recuperar.
async function run () {
  running.value = true
  queryStore.validating = true
  queryStore.validated = false
  queryStore.uploaded = null
  cancelling.value = false
  progress.value = { step: 0, totalSteps: 7 }

  const unsubscribe = window.api.validation.onProgress((info) => {
    progress.value = info
  })

  try {
    const period = { dataInicial: queryStore.dataInicial, dataFinal: queryStore.dataFinal }
    const result = await window.api.validation.run(toPlain(queryStore.rows), period)

    if (result.cancelled) {
      $q.notify({ type: 'warning', message: 'Validação cancelada.' })
      return null
    }

    steps.value = result.steps
    recovered.value = result.recovered
    grupos.value = result.grupos
    duplicates.value = result.duplicates
    invalid.value = result.invalid
    naoRecuperados.value = result.naoRecuperados
    reportRows.value = result.reportRows
    nfeFolderValidation.value = result.nfeFolderValidation ?? []
    queryStore.clearGroupFilter()

    if (result.recovered.length > 0) {
      const existingChaves = new Set(queryStore.rows.map((r) => r.chave))
      const newRows = result.recovered.filter((r) => !existingChaves.has(r.chave))
      queryStore.rows = [...queryStore.rows, ...newRows]
    }

    queryStore.selected = result.finalItems
    queryStore.validated = true
    return result
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message ?? String(err) })
    return null
  } finally {
    unsubscribe()
    running.value = false
    queryStore.validating = false
    cancelling.value = false
    progress.value = null
  }
}

// A tela de notas chama `run` na execução automática mensal.
defineExpose({ run })

async function stop () {
  cancelling.value = true
  await window.api.validation.cancel()
}

function toCsvValue (value) {
  const str = String(value ?? '')
  return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function formatCurrency (value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0)
}

function formatDate (value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(date)
}

async function downloadInconformidadesCsv () {
  const header = [
    'Número', 'Série', 'Chave', 'Data emissão', 'Valor',
    'Tp emissão', 'Status', 'XML status', 'Origem', 'Motivo'
  ]
  const lines = [header.join(';')]
  for (const item of invalid.value) {
    lines.push([
      item.numero, item.serie, item.chave, formatDate(item.dataEmissao), formatCurrency(item.valor),
      item.tpEmissao, item.status, item.xmlStatus, item.origem, item.motivo
    ].map(toCsvValue).join(';'))
  }

  const result = await window.api.export.downloadReportCsv({
    csv: lines.join('\n'),
    fileName: `inconformidades-${new Date().toISOString().slice(0, 10)}.csv`
  })

  if (!result.ok) {
    $q.notify({ type: 'negative', message: result.message ?? 'Não foi possível salvar o log.' })
  } else {
    $q.notify({ type: 'positive', message: `Log salvo em ${result.path}` })
  }
}

async function downloadCsv () {
  const header = [
    'Conexão', 'Tipo', 'CNPJ', 'Série', 'Número inicial', 'Número final',
    'Quantidade esperada', 'Quantidade encontrada', 'Lacunas não recuperadas'
  ]
  const lines = [header.join(';')]
  for (const r of sequenceRows.value) {
    lines.push([
      r.conexao, r.tipo, r.cnpj, r.serie, r.numeroInicial, r.numeroFinal,
      r.quantidadeEsperada, r.quantidadeEncontrada, r.lacunas.join(' ')
    ].map(toCsvValue).join(';'))
  }

  const result = await window.api.export.downloadReportCsv({
    csv: lines.join('\n'),
    fileName: `relatorio-quebras-${new Date().toISOString().slice(0, 10)}.csv`
  })

  if (!result.ok) {
    $q.notify({ type: 'negative', message: result.message ?? 'Não foi possível salvar o relatório.' })
  } else {
    $q.notify({ type: 'positive', message: `Relatório salvo em ${result.path}` })
  }
}
</script>

<style scoped>
.log-area {
  max-height: 340px;
  overflow-y: auto;
}

.log-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 2px 0;
}
</style>
