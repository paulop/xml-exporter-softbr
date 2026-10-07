<template>
  <q-page class="q-pa-md">
    <!-- Conteúdo centralizado, ocupando as 6 colunas do meio (de 12) em telas grandes. -->
    <div class="row justify-center">
      <div class="col-12 col-md-8 col-lg-6">
        <div class="row items-center q-mb-md">
          <q-btn flat dense round icon="arrow_back" to="/" aria-label="Voltar" />
          <div class="text-h6 q-ml-sm">Contador</div>
        </div>

        <q-banner v-if="setup" dense rounded class="bg-blue-1 text-primary q-mb-md">
          <template #avatar><q-icon name="waving_hand" /></template>
          Configuração inicial (2 de 2): informe o contador que recebe os XMLs.
        </q-banner>

        <div class="text-caption text-grey q-mb-sm">
          Dados de contato usados no envio do .zip de XML para a contabilidade.
        </div>

        <q-form class="q-gutter-sm" @submit="save">
          <q-input
            v-model="form.cnpj"
            filled
            dense
            label="CNPJ do contador"
            mask="##.###.###/####-##"
            unmasked-value
            :rules="[(v) => !v || isValidCnpj(v) || 'CNPJ inválido']"
            hide-bottom-space
            @update:model-value="onCnpjInput"
          />

          <q-input
            v-model="form.name"
            filled
            dense
            label="Nome do contador"
            :loading="lookingUp"
            :rules="[(v) => !setup || !!v.trim() || 'Informe o contador']"
            hide-bottom-space
          />

          <q-input
            v-model="form.whatsapp"
            filled
            dense
            label="WhatsApp"
            mask="(##) #####-####"
            unmasked-value
            :rules="[(v) => !v || v.length === 11 || 'Informe DDD + 9 dígitos']"
            hide-bottom-space
          >
            <template #prepend><q-icon name="chat" size="18px" /></template>
          </q-input>

          <q-input
            v-model="form.email"
            filled
            dense
            type="email"
            label="Email"
            :rules="[
              (v) => !setup || !!v.trim() || 'Informe o email',
              (v) => !v || isValidEmail(v) || 'Email inválido'
            ]"
            hide-bottom-space
          >
            <template #prepend><q-icon name="mail" size="18px" /></template>
          </q-input>

          <div>
            <q-toggle
              v-model="form.autoOpen"
              dense
              label="Abrir o sistema automaticamente"
              :disable="savingToggles"
              @update:model-value="saveToggles"
            />
            <div class="text-caption text-grey q-ml-lg">
              Na primeira segunda-feira de cada mês, às 8h, o sistema abre sozinho e já consulta e valida
              o mês anterior. Se não abrir no dia (computador desligado), abre automaticamente assim que
              o computador for ligado nos dias seguintes.
            </div>
          </div>

          <div>
            <q-toggle
              v-model="form.sendWithoutReview"
              dense
              label="Enviar sem revisar"
              :disable="!form.autoOpen || savingToggles"
              @update:model-value="saveToggles"
            />
            <div class="text-caption text-grey q-ml-lg">
              Ligado: na abertura automática, envia para o email acima sem esperar revisão.
              Desligado: faz todo o processo e aguarda você clicar em "Enviar".
            </div>
          </div>

          <div>
            <q-btn type="submit" color="primary" :label="setup ? 'Salvar e começar' : 'Salvar'" :loading="saving" />
          </div>
        </q-form>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useSettingsStore } from '@/stores/settings-store'
import { isValidCnpj, isValidEmail } from '@/utils/validators'
import { nextSetupLocation } from '@/utils/setup'

const $q = useQuasar()
const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()

// Aberta pela configuração inicial (ver router/index.js): contador e email
// obrigatórios e, ao salvar, segue pra tela de notas.
const setup = computed(() => !!route.query.setup)

const form = reactive({ name: '', cnpj: '', whatsapp: '', email: '', autoOpen: false, sendWithoutReview: false })
const saving = ref(false)
const lookingUp = ref(false)
const savingToggles = ref(false)

// Ao completar um CNPJ válido, busca o nome (fantasia ou razão social) e preenche o campo.
async function onCnpjInput (value) {
  if (!value || value.length !== 14 || !isValidCnpj(value)) return
  lookingUp.value = true
  try {
    const name = await window.api.settings.lookupCnpj(value)
    if (name && form.cnpj === value) form.name = name
  } finally {
    lookingUp.value = false
  }
}

// Os toggles salvam na hora, sem o botão "Salvar". Grava só eles, por cima do
// contador já salvo: edições ainda não salvas nos campos de texto (e ainda
// não validadas) ficam de fora. Ligar/desligar a abertura automática cria
// ou remove a tarefa agendada do Windows.
async function saveToggles () {
  savingToggles.value = true
  try {
    const wasAutoOpen = !!settingsStore.accountant.autoOpen
    await settingsStore.saveAccountant({
      ...settingsStore.accountant,
      autoOpen: form.autoOpen,
      sendWithoutReview: form.sendWithoutReview
    })
    if (form.autoOpen !== wasAutoOpen) {
      const task = await window.api.settings.syncAutoOpenTask()
      if (!task.ok) {
        $q.notify({ type: 'warning', message: task.message })
        return
      }
    }
    $q.notify({ type: 'positive', message: 'Configuração salva.' })
  } finally {
    savingToggles.value = false
  }
}

async function save () {
  saving.value = true
  try {
    const wasAutoOpen = !!settingsStore.accountant.autoOpen
    await settingsStore.saveAccountant({ ...form, email: form.email.trim() })
    $q.notify({ type: 'positive', message: 'Dados do contador salvos.' })
    // Cria a tarefa agendada do Windows ao ligar (recriando, se já existia) e remove ao desligar.
    if (form.autoOpen || wasAutoOpen) {
      const task = await window.api.settings.syncAutoOpenTask()
      if (!task.ok) $q.notify({ type: 'warning', message: task.message })
    }
    if (setup.value) await router.push(await nextSetupLocation())
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await settingsStore.load()
  Object.assign(form, settingsStore.accountant)
})
</script>
