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
  const groupFilter = ref(null)

  // Cada clique em "Consultar" gera um token novo. Se o usuário mudar o
  // período e consultar de novo antes da primeira resposta chegar, a
  // resposta do clique antigo (de outro período) é descartada ao chegar —
  // senão ela sobrescreveria/misturaria o resultado do clique mais recente.
  let requestToken = 0

  function setGroupFilter (label, chaves) {
    groupFilter.value = { label, chaves }
  }

  function clearGroupFilter () {
    groupFilter.value = null
  }

  // Desloca o período em `delta` meses a partir do início do período atual
  // (ex.: -1 vai pro mês anterior, +1 pro seguinte), sempre ajustando pro
  // mês cheio — é o que os botões "<" / ">" do seletor de período usam.
  function shiftMonth (delta) {
    const anchor = date.extractDate(dataInicial.value, 'YYYY-MM-DD')
    const shifted = date.addToDate(anchor, { months: delta })
    dataInicial.value = date.formatDate(date.startOfDate(shifted, 'month'), 'YYYY-MM-DD')
    dataFinal.value = date.formatDate(date.endOfDate(shifted, 'month'), 'YYYY-MM-DD')
  }

  async function run () {
    const token = ++requestToken

    querying.value = true
    lastError.value = ''
    groupFilter.value = null
    // Limpa a tabela imediatamente: o resultado é sempre a consulta do
    // período atual, nunca um acúmulo do período anterior.
    rows.value = []
    selected.value = []
    count.value = 0
    totalValor.value = 0
    try {
      const result = await window.api.query.run({
        dataInicial: dataInicial.value,
        dataFinal: dataFinal.value
      })
      if (token !== requestToken) return [] // resposta de uma consulta já superada

      rows.value = result.rows
      count.value = result.count
      totalValor.value = result.totalValor
      // todas as notas vêm pré-selecionadas por padrão
      selected.value = [...result.rows]
      return result.errors ?? []
    } catch (err) {
      if (token !== requestToken) return []

      lastError.value = err.message ?? String(err)
      rows.value = []
      selected.value = []
      count.value = 0
      totalValor.value = 0
      throw err
    } finally {
      if (token === requestToken) querying.value = false
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
    groupFilter,
    setGroupFilter,
    clearGroupFilter,
    shiftMonth,
    run
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useQueryStore, import.meta.hot))
}
