import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import { toPlain } from '@/utils/ipc'

export const useSettingsStore = defineStore('settings', () => {
  const destinationFolder = ref('')
  const searchFolders = ref([])
  const nfeCopyFolders = ref([])
  const company = ref({ cnpj: '' })
  const accountant = ref({ name: '', cnpj: '', whatsapp: '', email: '' })
  const sql = ref('')
  const defaultSql = ref('')
  const appVersion = ref('')

  async function load () {
    destinationFolder.value = (await window.api.settings.getDestinationFolder()) ?? ''
    searchFolders.value = (await window.api.settings.getSearchFolders()) ?? []
    nfeCopyFolders.value = (await window.api.settings.getNfeCopyFolders()) ?? []
    company.value = (await window.api.settings.getCompany()) ?? company.value
    accountant.value = (await window.api.settings.getAccountant()) ?? accountant.value
    sql.value = await window.api.query.getSql()
    defaultSql.value = await window.api.query.getDefaultSql()
    appVersion.value = await window.api.app.getVersion()
  }

  async function chooseDestinationFolder () {
    destinationFolder.value = (await window.api.settings.setDestinationFolder()) ?? ''
    return destinationFolder.value
  }

  async function saveCompany (payload) {
    company.value = await window.api.settings.setCompany(toPlain(payload))
    return company.value
  }

  async function saveAccountant (payload) {
    accountant.value = await window.api.settings.setAccountant(toPlain(payload))
    return accountant.value
  }

  async function addSearchFolder () {
    searchFolders.value = (await window.api.settings.addSearchFolder()) ?? []
    return searchFolders.value
  }

  async function removeSearchFolder (folderPath) {
    searchFolders.value = (await window.api.settings.removeSearchFolder(folderPath)) ?? []
    return searchFolders.value
  }

  async function addNfeCopyFolder () {
    nfeCopyFolders.value = (await window.api.settings.addNfeCopyFolder()) ?? []
    return nfeCopyFolders.value
  }

  async function removeNfeCopyFolder (folderPath) {
    nfeCopyFolders.value = (await window.api.settings.removeNfeCopyFolder(folderPath)) ?? []
    return nfeCopyFolders.value
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
    nfeCopyFolders,
    company,
    accountant,
    sql,
    defaultSql,
    appVersion,
    load,
    chooseDestinationFolder,
    saveCompany,
    saveAccountant,
    addSearchFolder,
    removeSearchFolder,
    addNfeCopyFolder,
    removeNfeCopyFolder,
    openPortal,
    saveSql,
    resetSql
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot))
}
