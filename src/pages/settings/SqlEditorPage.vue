<template>
  <q-page class="q-pa-md">
    <div class="text-h6 q-mb-md">Consulta SQL</div>

    <q-banner v-if="!isValid" class="bg-warning text-white q-mb-md">
      {{ validationMessage }}
    </q-banner>

    <q-input
      v-model="sqlText"
      type="textarea"
      autogrow
      filled
      class="sql-editor"
      label="SQL"
      @update:model-value="validate"
    />

    <div class="row justify-end q-gutter-sm q-mt-md">
      <q-btn flat label="Restaurar padrão" @click="restoreDefault" />
      <q-btn color="primary" label="Salvar" :disable="!isValid" :loading="saving" @click="save" />
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { useSettingsStore } from '@/stores/settings-store'

const $q = useQuasar()
const settingsStore = useSettingsStore()

const sqlText = ref('')
const saving = ref(false)
const isValid = ref(true)
const validationMessage = ref('')

const REQUIRED_PLACEHOLDERS = ['@dataInicial', '@dataFinal']

function validate () {
  const missing = REQUIRED_PLACEHOLDERS.filter(
    (token) => !new RegExp(`${token}\\b`, 'i').test(sqlText.value)
  )
  isValid.value = missing.length === 0
  validationMessage.value = missing.length
    ? `A consulta precisa conter os parâmetros ${missing.join(' e ')}.`
    : ''
}

async function save () {
  saving.value = true
  try {
    await settingsStore.saveSql(sqlText.value)
    $q.notify({ type: 'positive', message: 'SQL salvo com sucesso.' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message ?? String(err) })
  } finally {
    saving.value = false
  }
}

async function restoreDefault () {
  await settingsStore.resetSql()
  sqlText.value = settingsStore.sql
  validate()
}

onMounted(async () => {
  await settingsStore.load()
  sqlText.value = settingsStore.sql
  validate()
})
</script>

<style scoped>
.sql-editor :deep(textarea) {
  font-family: 'Courier New', monospace;
  font-size: 13px;
}
</style>
