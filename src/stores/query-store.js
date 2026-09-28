import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import { date } from 'quasar'

function todayIso () {
  return date.formatDate(new Date(), 'YYYY-MM-DD')
}

export const useQueryStore = defineStore('query', () => {
  const dataInicial = ref(date.formatDate(date.startOfDate(new Date(), 'month'), 'YYYY-MM-DD'))
  const dataFinal = ref(todayIso())

  const rows = ref([])
  const selected = ref([])
  const count = ref(0)
  const totalValor = ref(0)
  const querying = ref(false)
  const lastError = ref('')

  function setCurrentMonth () {
    const now = new Date()
    dataInicial.value = date.formatDate(date.startOfDate(now, 'month'), 'YYYY-MM-DD')
    dataFinal.value = date.formatDate(date.endOfDate(now, 'month'), 'YYYY-MM-DD')
  }

  function setPreviousMonth () {
    const previous = date.subtractFromDate(new Date(), { months: 1 })
    dataInicial.value = date.formatDate(date.startOfDate(previous, 'month'), 'YYYY-MM-DD')
    dataFinal.value = date.formatDate(date.endOfDate(previous, 'month'), 'YYYY-MM-DD')
  }

  async function run (connectionId) {
    querying.value = true
    lastError.value = ''
    try {
      const result = await window.api.query.run({
        connectionId,
        dataInicial: dataInicial.value,
        dataFinal: dataFinal.value
      })
      rows.value = result.rows
      count.value = result.count
      totalValor.value = result.totalValor
      // todas as notas vêm pré-selecionadas por padrão
      selected.value = [...result.rows]
    } catch (err) {
      lastError.value = err.message ?? String(err)
      rows.value = []
      selected.value = []
      count.value = 0
      totalValor.value = 0
      throw err
    } finally {
      querying.value = false
    }
  }

  return {
    dataInicial,
    dataFinal,
    rows,
    selected,
    count,
    totalValor,
    querying,
    lastError,
    setCurrentMonth,
    setPreviousMonth,
    run
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useQueryStore, import.meta.hot))
}
