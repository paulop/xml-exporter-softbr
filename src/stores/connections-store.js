import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref, computed } from 'vue'
import { toPlain } from '@/utils/ipc'

export const useConnectionsStore = defineStore('connections', () => {
  const connections = ref([])
  const activeConnectionId = ref(null)
  const loading = ref(false)

  const activeConnection = computed(
    () => connections.value.find((c) => c.id === activeConnectionId.value) ?? null
  )

  async function load () {
    loading.value = true
    try {
      connections.value = await window.api.connections.list()
      const active = await window.api.connections.getActive()
      activeConnectionId.value = active?.id ?? connections.value[0]?.id ?? null
    } finally {
      loading.value = false
    }
  }

  async function save (payload) {
    await window.api.connections.save(toPlain(payload))
    await load()
  }

  async function remove (id) {
    await window.api.connections.delete(id)
    await load()
  }

  async function test (payload) {
    return window.api.connections.test(toPlain(payload))
  }

  async function setActive (id) {
    activeConnectionId.value = id
    await window.api.connections.setActive(id)
  }

  return {
    connections,
    activeConnectionId,
    activeConnection,
    loading,
    load,
    save,
    remove,
    test,
    setActive
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useConnectionsStore, import.meta.hot))
}
