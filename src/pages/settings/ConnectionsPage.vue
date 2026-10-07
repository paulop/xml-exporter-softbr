<template>
  <q-page class="q-pa-md">
    <!-- Conteúdo centralizado, ocupando as 6 colunas do meio (de 12) em telas grandes. -->
    <div class="row justify-center">
      <div class="col-12 col-md-8 col-lg-6">
        <div class="row items-center justify-between q-mb-md">
          <div class="row items-center">
            <q-btn flat dense round icon="arrow_back" to="/" aria-label="Voltar" />
            <div class="text-h6 q-ml-sm">Conexões</div>
          </div>
          <q-btn color="primary" icon="add" label="Nova conexão" @click="openNew" />
        </div>

        <q-list dense bordered separator>
          <q-item v-for="connection in connectionsStore.connections" :key="connection.id">
            <q-item-section>
              <q-item-label>{{ connection.name }}</q-item-label>
              <q-item-label caption>
                {{ connection.host }}:{{ connection.port }} · {{ connection.database }} ·
                {{ connection.user }}
              </q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="row q-gutter-xs">
                <q-btn flat dense round icon="edit" @click="openEdit(connection)" />
                <q-btn flat dense round icon="delete" color="negative" @click="confirmDelete(connection)" />
              </div>
            </q-item-section>
          </q-item>

          <q-item v-if="connectionsStore.connections.length === 0">
            <q-item-section class="text-grey">Nenhuma conexão cadastrada.</q-item-section>
          </q-item>
        </q-list>

        <q-separator class="q-my-md" />

        <div class="text-subtitle2 q-mb-sm">Consulta SQL</div>

        <q-banner v-if="!sqlValid" class="bg-warning text-white q-mb-md">
          {{ sqlValidationMessage }}
        </q-banner>

        <q-input
          v-model="sqlText"
          type="textarea"
          autogrow
          filled
          dense
          class="sql-editor"
          label="SQL"
          @update:model-value="validateSql"
        />

        <div class="row justify-end q-gutter-sm q-mt-md">
          <q-btn flat label="Restaurar padrão" @click="restoreDefaultSql" />
          <q-btn color="primary" label="Salvar" :disable="!sqlValid" :loading="savingSql" @click="saveSql" />
        </div>

        <ConnectionFormDialog v-model="dialogOpen" :connection="editingConnection" />
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { useConnectionsStore } from '@/stores/connections-store'
import { useSettingsStore } from '@/stores/settings-store'
import ConnectionFormDialog from '@/components/ConnectionFormDialog.vue'

const $q = useQuasar()
const connectionsStore = useConnectionsStore()
const settingsStore = useSettingsStore()

const dialogOpen = ref(false)
const editingConnection = ref(null)

function openNew () {
  editingConnection.value = null
  dialogOpen.value = true
}

function openEdit (connection) {
  editingConnection.value = connection
  dialogOpen.value = true
}

function confirmDelete (connection) {
  $q.dialog({
    title: 'Excluir conexão',
    message: `Tem certeza que deseja excluir "${connection.name}"?`,
    cancel: true,
    persistent: true
  }).onOk(async () => {
    await connectionsStore.remove(connection.id)
  })
}

// Consulta SQL usada em todas as conexões (editável abaixo da lista).
const sqlText = ref('')
const savingSql = ref(false)
const sqlValid = ref(true)
const sqlValidationMessage = ref('')

const REQUIRED_PLACEHOLDERS = ['@dataInicial', '@dataFinal']

function validateSql () {
  const missing = REQUIRED_PLACEHOLDERS.filter(
    (token) => !new RegExp(`${token}\\b`, 'i').test(sqlText.value)
  )
  sqlValid.value = missing.length === 0
  sqlValidationMessage.value = missing.length
    ? `A consulta precisa conter os parâmetros ${missing.join(' e ')}.`
    : ''
}

async function saveSql () {
  savingSql.value = true
  try {
    await settingsStore.saveSql(sqlText.value)
    $q.notify({ type: 'positive', message: 'SQL salvo com sucesso.' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message ?? String(err) })
  } finally {
    savingSql.value = false
  }
}

async function restoreDefaultSql () {
  await settingsStore.resetSql()
  sqlText.value = settingsStore.sql
  validateSql()
}

onMounted(async () => {
  connectionsStore.load()
  await settingsStore.load()
  sqlText.value = settingsStore.sql
  validateSql()
})
</script>

<style scoped>
.sql-editor :deep(textarea) {
  font-family: 'Courier New', monospace;
  font-size: 13px;
}
</style>
