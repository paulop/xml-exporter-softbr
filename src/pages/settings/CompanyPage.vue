<template>
  <q-page class="q-pa-md">
    <!-- Conteúdo centralizado, ocupando as 6 colunas do meio (de 12) em telas grandes. -->
    <div class="row justify-center">
      <div class="col-12 col-md-8 col-lg-6">
        <div class="row items-center q-mb-md">
          <q-btn flat dense round icon="arrow_back" to="/" aria-label="Voltar" />
          <div class="text-h6 q-ml-sm">Empresa</div>
        </div>

        <q-banner v-if="setup" dense rounded class="bg-blue-1 text-primary q-mb-md">
          <template #avatar><q-icon name="waving_hand" /></template>
          Configuração inicial (1 de 2): informe o CNPJ da empresa licenciada.
        </q-banner>

        <q-form class="q-gutter-sm" @submit="save">
          <q-input
            v-model="form.cnpj"
            filled
            dense
            label="CNPJ"
            mask="##.###.###/####-##"
            unmasked-value
            :rules="[
              (v) => !setup || !!v || 'Informe o CNPJ',
              (v) => !v || isValidCnpj(v) || 'CNPJ inválido'
            ]"
            hide-bottom-space
            @update:model-value="onCnpjInput"
          />

          <q-input
            v-model="form.name"
            filled
            dense
            label="Nome (fantasia)"
            :loading="lookingUp"
            hide-bottom-space
          />

          <q-input
            v-model="form.email"
            filled
            dense
            type="email"
            label="Email"
            hint="Recebe uma cópia do envio dos XMLs, junto com o contador."
            :rules="[(v) => !v || isValidEmail(v) || 'Email inválido']"
          >
            <template #prepend><q-icon name="mail" size="18px" /></template>
          </q-input>

          <q-input
            :model-value="licenseLabel"
            filled
            dense
            readonly
            label="Validade da licença"
          />

          <div>
            <q-btn type="submit" color="primary" :label="setup ? 'Salvar e continuar' : 'Salvar'" :loading="saving" />
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

// Aberta pela configuração inicial (ver router/index.js): CNPJ obrigatório
// e, ao salvar, segue pra próxima tela pendente.
const setup = computed(() => !!route.query.setup)

const form = reactive({ cnpj: '', name: '', email: '' })
const saving = ref(false)
const lookingUp = ref(false)

// Ao completar um CNPJ válido, busca o nome fantasia e preenche o campo.
// Só sobrescreve se a consulta retornar algo, pra não apagar edição manual à toa.
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

// A licença ainda não tem de onde vir — fica só informativo até existir.
const licenseLabel = 'Não disponível'

async function save () {
  saving.value = true
  try {
    await settingsStore.saveCompany({ ...form, email: form.email.trim() })
    $q.notify({ type: 'positive', message: 'Dados da empresa salvos.' })
    if (setup.value) await router.push(await nextSetupLocation())
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await settingsStore.load()
  Object.assign(form, settingsStore.company)
})
</script>
