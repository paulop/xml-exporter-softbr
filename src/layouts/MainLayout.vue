<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title class="row items-center no-wrap">
          <span>Gerador de Arquivos XML - SoftBR</span>
          <q-chip v-if="appVersion" dense outline color="white" text-color="white" class="q-ml-sm">
            v{{ appVersion }}
          </q-chip>
        </q-toolbar-title>

        <q-btn
          v-if="updateReady"
          color="positive"
          icon="system_update"
          label="Reiniciar e atualizar"
          dense
          class="q-mr-sm"
          @click="installUpdate"
        />

        <q-btn flat dense round icon="settings" aria-label="Menu">
          <q-menu anchor="bottom right" self="top right">
            <q-list style="min-width: 220px">
              <q-item-label header>Navegação</q-item-label>

              <q-item v-close-popup clickable to="/" exact>
                <q-item-section avatar><q-icon name="receipt_long" /></q-item-section>
                <q-item-section>Notas fiscais</q-item-section>
              </q-item>

              <q-separator />
              <q-item-label header>Configurações</q-item-label>

              <q-item v-close-popup clickable to="/settings/connections">
                <q-item-section avatar><q-icon name="dns" /></q-item-section>
                <q-item-section>Conexões</q-item-section>
              </q-item>

              <q-item v-close-popup clickable to="/settings/sql">
                <q-item-section avatar><q-icon name="code" /></q-item-section>
                <q-item-section>Consulta SQL</q-item-section>
              </q-item>

              <q-item v-close-popup clickable to="/settings/export">
                <q-item-section avatar><q-icon name="folder_zip" /></q-item-section>
                <q-item-section>Exportação</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'

const $q = useQuasar()
const updateReady = ref(false)
const appVersion = ref('')

function installUpdate () {
  window.api.app.installUpdate()
}

let unsubscribeAvailable
let unsubscribeDownloaded

onMounted(async () => {
  appVersion.value = await window.api.app.getVersion()

  unsubscribeAvailable = window.api.app.onUpdateAvailable(() => {
    window.api.app.downloadUpdate()
    $q.notify({ type: 'info', message: 'Nova versão disponível, baixando em segundo plano...' })
  })
  unsubscribeDownloaded = window.api.app.onUpdateDownloaded(() => {
    updateReady.value = true
  })
})

onUnmounted(() => {
  unsubscribeAvailable?.()
  unsubscribeDownloaded?.()
})
</script>
