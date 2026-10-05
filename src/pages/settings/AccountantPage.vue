<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <q-btn flat dense round icon="arrow_back" to="/" aria-label="Voltar" />
      <div class="text-h6 q-ml-sm">Contador</div>
    </div>

    <q-banner v-if="setup" dense rounded class="bg-blue-1 text-primary q-mb-md" style="max-width: 420px">
      <template #avatar><q-icon name="waving_hand" /></template>
      Configuração inicial (2 de 2): informe o contador que recebe os XMLs.
    </q-banner>

    <div class="text-caption text-grey q-mb-sm">
      Dados de contato usados no envio do .zip de XML para a contabilidade.
    </div>

    <q-form class="q-gutter-sm" style="max-width: 420px" @submit="save">
      <q-input
        v-model="form.name"
        filled
        dense
        label="Contador"
        :rules="[(v) => !setup || !!v.trim() || 'Informe o contador']"
        hide-bottom-space
      />

      <q-input
        v-model="form.cnpj"
        filled
        dense
        label="CNPJ do contador"
        mask="##.###.###/####-##"
        unmasked-value
        :rules="[(v) => !v || isValidCnpj(v) || 'CNPJ inválido']"
        hide-bottom-space
        style="max-width: 220px"
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
        style="max-width: 220px"
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
        <q-btn type="submit" color="primary" :label="setup ? 'Salvar e começar' : 'Salvar'" :loading="saving" />
      </div>
    </q-form>
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

const form = reactive({ name: '', cnpj: '', whatsapp: '', email: '' })
const saving = ref(false)

async function save () {
  saving.value = true
  try {
    await settingsStore.saveAccountant({ ...form, email: form.email.trim() })
    $q.notify({ type: 'positive', message: 'Dados do contador salvos.' })
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
