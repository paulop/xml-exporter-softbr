import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import { toPlain } from '@/utils/ipc'

export const useConnectionsStore = defineStore('connections', () => {
  const connections = ref([])
  const loading = ref(false)

  async function load () {
    loading.value = true
    try {
      connections.value = await window.api.connections.list()
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

  return {
    connections,
    loading,
    load,
    save,
    remove,
    test
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useConnectionsStore, import.meta.hot))
}
