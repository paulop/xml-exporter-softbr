<template>
  <q-page class="q-pa-md">
    <div class="text-h6 q-mb-md">Destino de exportação</div>

    <q-input
      :model-value="settingsStore.destinationFolder || 'Nenhuma pasta selecionada'"
      readonly
      filled
      label="Pasta de destino"
    >
      <template #append>
        <q-btn flat dense icon="folder_open" label="Escolher pasta" @click="choose" />
      </template>
    </q-input>

    <div class="text-caption text-grey q-mt-sm">
      Se nenhuma pasta for configurada, o app perguntará onde salvar a cada exportação.
    </div>

    <q-separator class="q-my-lg" />

    <div class="text-h6 q-mb-md">Sobre</div>
    <div class="text-body2">Versão instalada: {{ settingsStore.appVersion }}</div>
    <q-btn class="q-mt-sm" flat dense label="Verificar atualizações" @click="checkForUpdates" />
  </q-page>
</template>

<script setup>
import { onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { useSettingsStore } from '@/stores/settings-store'

const $q = useQuasar()
const settingsStore = useSettingsStore()

async function choose () {
  await settingsStore.chooseDestinationFolder()
}

async function checkForUpdates () {
  const result = await window.api.app.checkForUpdates()
  if (!result.ok) {
    $q.notify({ type: 'info', message: result.message })
  }
}

onMounted(() => settingsStore.load())
</script>
