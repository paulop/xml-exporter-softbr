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

              <q-item v-close-popup clickable to="/settings/export">
                <q-item-section avatar><q-icon name="folder_zip" /></q-item-section>
                <q-item-section>Pastas</q-item-section>
              </q-item>

              <q-item v-close-popup clickable to="/company">
                <q-item-section avatar><q-icon name="business" /></q-item-section>
                <q-item-section>Empresa</q-item-section>
              </q-item>

              <q-item v-close-popup clickable to="/settings/accountant">
                <q-item-section avatar><q-icon name="contact_mail" /></q-item-section>
                <q-item-section>Contador</q-item-section>
              </q-item>

              <q-separator />

              <q-item clickable :disable="checkingUpdate" @click="checkForUpdates">
                <q-item-section avatar>
                  <q-spinner v-if="checkingUpdate" color="primary" size="24px" />
                  <q-icon v-else name="system_update" />
                </q-item-section>
                <q-item-section>Verificar atualizações</q-item-section>
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
const checkingUpdate = ref(false)

function installUpdate () {
  window.api.app.installUpdate()
}

async function checkForUpdates () {
  checkingUpdate.value = true
  try {
    const result = await window.api.app.checkForUpdates()
    if (!result.ok) {
      $q.notify({ type: 'info', message: result.message })
    } else {
      $q.notify({ type: 'positive', message: 'Verificação concluída.' })
    }
  } finally {
    checkingUpdate.value = false
  }
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
