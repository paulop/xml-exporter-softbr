<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <q-btn flat dense round icon="arrow_back" to="/" aria-label="Voltar" />
      <div class="text-h6 q-ml-sm">Pastas</div>
    </div>

    <div class="text-subtitle2 q-mb-sm">Destino de exportação</div>
    <q-input
      :model-value="settingsStore.destinationFolder || 'Nenhuma pasta selecionada'"
      readonly
      filled
      dense
      label="Pasta de destino"
    >
      <template #append>
        <q-btn flat dense icon="folder_open" label="Escolher pasta" @click="choose" />
      </template>
    </q-input>

    <div class="text-caption text-grey q-mt-sm">
      Se nenhuma pasta for configurada, o app perguntará onde salvar a cada exportação.
    </div>

    <q-separator class="q-my-lg" />

    <div class="text-subtitle2 q-mb-sm">Pastas de busca de XMLs faltantes</div>
    <div class="text-caption text-grey q-mb-sm">
      Usadas na busca em cascata para recuperar notas ausentes ou com sequência quebrada
      (ex.: pasta de custódia do caixa, pasta do Plugin Fiscal). A busca percorre
      recursivamente todas as subpastas dentro de cada pasta cadastrada. A ordem da
      lista define a prioridade de busca. O app identifica as notas pelo nome do
      arquivo (a própria chave de acesso), então não precisa abrir nem ler o
      conteúdo de arquivos que não interessam — funciona mesmo com pastas grandes.
    </div>

    <q-list bordered separator class="rounded-borders">
      <q-item v-for="folder in settingsStore.searchFolders" :key="folder">
        <q-item-section avatar><q-icon name="folder" /></q-item-section>
        <q-item-section>{{ folder }}</q-item-section>
        <q-item-section side>
          <q-btn flat dense round icon="close" @click="removeFolder(folder)" />
        </q-item-section>
      </q-item>
      <q-item v-if="settingsStore.searchFolders.length === 0">
        <q-item-section class="text-grey">Nenhuma pasta configurada.</q-item-section>
      </q-item>
    </q-list>

    <q-btn
      flat
      dense
      icon="create_new_folder"
      label="Adicionar pasta"
      class="q-mt-sm"
      @click="addFolder"
    />

    <q-separator class="q-my-lg" />

    <div class="text-h6 q-mb-md">Sobre</div>
    <div class="text-body2">Versão instalada: {{ settingsStore.appVersion }}</div>
  </q-page>
</template>

<script setup>
import { onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings-store'

const settingsStore = useSettingsStore()

async function choose () {
  await settingsStore.chooseDestinationFolder()
}

async function addFolder () {
  await settingsStore.addSearchFolder()
}

async function removeFolder (folder) {
  await settingsStore.removeSearchFolder(folder)
}

onMounted(() => settingsStore.load())
</script>
