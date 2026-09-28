<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated>
      <q-toolbar>
        <q-btn
          flat
          dense
          round
          icon="menu"
          aria-label="Menu"
          @click="toggleLeftDrawer"
        />

        <q-toolbar-title>
          XML Exporter SoftBR
        </q-toolbar-title>

        <q-btn
          v-if="updateReady"
          color="positive"
          icon="system_update"
          label="Reiniciar e atualizar"
          dense
          @click="installUpdate"
        />
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="leftDrawerOpen"
      show-if-above
      bordered
    >
      <q-list>
        <q-item-label header>Navegação</q-item-label>

        <q-item clickable to="/" exact>
          <q-item-section avatar><q-icon name="receipt_long" /></q-item-section>
          <q-item-section>Notas fiscais</q-item-section>
        </q-item>

        <q-item-label header>Configurações</q-item-label>

        <q-item clickable to="/settings/connections">
          <q-item-section avatar><q-icon name="dns" /></q-item-section>
          <q-item-section>Conexões</q-item-section>
        </q-item>

        <q-item clickable to="/settings/sql">
          <q-item-section avatar><q-icon name="code" /></q-item-section>
          <q-item-section>Consulta SQL</q-item-section>
        </q-item>

        <q-item clickable to="/settings/export">
          <q-item-section avatar><q-icon name="folder_zip" /></q-item-section>
          <q-item-section>Exportação</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'

const $q = useQuasar()
const leftDrawerOpen = ref(false)
const updateReady = ref(false)

function toggleLeftDrawer () {
  leftDrawerOpen.value = !leftDrawerOpen.value
}

function installUpdate () {
  window.api.app.installUpdate()
}

let unsubscribeAvailable
let unsubscribeDownloaded

onMounted(() => {
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
