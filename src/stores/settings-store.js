import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const destinationFolder = ref('')
  const searchFolders = ref([])
  const sql = ref('')
  const defaultSql = ref('')
  const appVersion = ref('')

  async function load () {
    destinationFolder.value = (await window.api.settings.getDestinationFolder()) ?? ''
    searchFolders.value = (await window.api.settings.getSearchFolders()) ?? []
    sql.value = await window.api.query.getSql()
    defaultSql.value = await window.api.query.getDefaultSql()
    appVersion.value = await window.api.app.getVersion()
  }

  async function chooseDestinationFolder () {
    destinationFolder.value = (await window.api.settings.setDestinationFolder()) ?? ''
    return destinationFolder.value
  }

  async function addSearchFolder () {
    searchFolders.value = (await window.api.settings.addSearchFolder()) ?? []
    return searchFolders.value
  }

  async function removeSearchFolder (folderPath) {
    searchFolders.value = (await window.api.settings.removeSearchFolder(folderPath)) ?? []
    return searchFolders.value
  }

  function openPortal () {
    window.api.settings.openPortal()
  }

  async function saveSql (sqlText) {
    sql.value = await window.api.query.setSql(sqlText)
  }

  async function resetSql () {
    sql.value = await window.api.query.resetSql()
  }

  return {
    destinationFolder,
    searchFolders,
    sql,
    defaultSql,
    appVersion,
    load,
    chooseDestinationFolder,
    addSearchFolder,
    removeSearchFolder,
    openPortal,
    saveSql,
    resetSql
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot))
}
