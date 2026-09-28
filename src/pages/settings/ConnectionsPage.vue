<template>
  <q-page class="q-pa-md">
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h6">Conexões</div>
      <q-btn color="primary" icon="add" label="Nova conexão" @click="openNew" />
    </div>

    <q-list bordered separator>
      <q-item v-for="connection in connectionsStore.connections" :key="connection.id">
        <q-item-section>
          <q-item-label>{{ connection.name }}</q-item-label>
          <q-item-label caption>
            {{ connection.host }}:{{ connection.port }} · {{ connection.database }} ·
            {{ connection.user }}
          </q-item-label>
        </q-item-section>

        <q-item-section side>
          <q-badge v-if="connection.id === connectionsStore.activeConnectionId" color="primary">
            Ativa
          </q-badge>
        </q-item-section>

        <q-item-section side>
          <div class="row q-gutter-xs">
            <q-btn
              v-if="connection.id !== connectionsStore.activeConnectionId"
              flat
              dense
              label="Usar"
              @click="connectionsStore.setActive(connection.id)"
            />
            <q-btn flat dense round icon="edit" @click="openEdit(connection)" />
            <q-btn flat dense round icon="delete" color="negative" @click="confirmDelete(connection)" />
          </div>
        </q-item-section>
      </q-item>

      <q-item v-if="connectionsStore.connections.length === 0">
        <q-item-section class="text-grey">Nenhuma conexão cadastrada.</q-item-section>
      </q-item>
    </q-list>

    <ConnectionFormDialog v-model="dialogOpen" :connection="editingConnection" />
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { useConnectionsStore } from '@/stores/connections-store'
import ConnectionFormDialog from '@/components/ConnectionFormDialog.vue'

const $q = useQuasar()
const connectionsStore = useConnectionsStore()

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

onMounted(() => connectionsStore.load())
</script>
