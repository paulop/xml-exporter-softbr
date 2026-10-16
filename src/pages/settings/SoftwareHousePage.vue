<template>
  <q-page class="q-pa-md">
    <!-- Conteúdo centralizado, ocupando as 6 colunas do meio (de 12) em telas grandes. -->
    <div class="row justify-center">
      <div class="col-12 col-md-8 col-lg-6">
        <div class="row items-center q-mb-md">
          <q-btn flat dense round icon="arrow_back" to="/" aria-label="Voltar" />
          <div class="text-h6 q-ml-sm">Software House</div>
        </div>

        <q-banner v-if="setup" dense rounded class="bg-blue-1 text-primary q-mb-md">
          <template #avatar><q-icon name="waving_hand" /></template>
          Configuração inicial (2 de 3): informe a Software House responsável pelo sistema.
        </q-banner>

        <div class="text-caption text-grey q-mb-sm">
          Empresa que fornece e dá suporte ao sistema. Recebe uma cópia do envio dos XMLs, e a logo
          aparece no cabeçalho.
        </div>

        <q-form class="q-gutter-sm" @submit="save">
          <cnpj-input
            v-model="form.cnpj"
            filled
            dense
            label="CNPJ"
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
            label="Nome"
            :loading="lookingUp"
            :rules="[(v) => !setup || !!v.trim() || 'Informe o nome']"
            hide-bottom-space
          />

          <q-input
            v-model="form.whatsapp"
            filled
            dense
            label="Telefone / WhatsApp"
            :mask="phoneMask"
            unmasked-value
            hint="Aparece na tela de notas quando há lacunas não recuperadas, para o cliente entrar em contato."
            :rules="[(v) => !v || v.length === 10 || v.length === 11 || 'Informe DDD + telefone fixo (8 dígitos) ou celular (9 dígitos)']"
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

          <div class="row items-center q-gutter-sm">
            <div class="logo-preview row flex-center">
              <img v-if="form.logo" :src="form.logo" alt="Logo da Software House">
              <q-icon v-else name="image" size="32px" color="grey-5" />
            </div>
            <div class="column q-gutter-xs">
              <q-btn
                outline
                dense
                no-caps
                color="primary"
                icon="upload"
                :label="form.logo ? 'Trocar logo' : 'Escolher logo'"
                @click="chooseLogo"
              />
              <q-btn
                v-if="form.logo"
                flat
                dense
                no-caps
                color="negative"
                icon="delete"
                label="Remover logo"
                @click="form.logo = ''"
              />
              <div class="text-caption text-grey">PNG, JPG, SVG ou WebP, até 512 KB.</div>
            </div>
          </div>

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
import CnpjInput from '@/components/CnpjInput.vue'
import { nextSetupLocation } from '@/utils/setup'

const $q = useQuasar()
const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()

// Aberta pela configuração inicial (ver router/index.js): CNPJ, nome e email
// obrigatórios e, ao salvar, segue pra próxima tela pendente.
const setup = computed(() => !!route.query.setup)

const form = reactive({ cnpj: '', name: '', whatsapp: '', email: '', logo: '' })
const saving = ref(false)
const lookingUp = ref(false)

// Fixo (10 dígitos com DDD) ou celular (11), como no Contador.
const phoneMask = computed(() => (form.whatsapp.length > 10 ? '(##) #####-####' : '(##) ####-#####'))

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

// Só troca a logo no formulário: grava junto com o resto, no "Salvar".
async function chooseLogo () {
  const result = await window.api.settings.chooseSoftwareHouseLogo()
  if (result.ok) form.logo = result.logo
  else if (result.message) $q.notify({ type: 'warning', message: result.message })
}

async function save () {
  saving.value = true
  try {
    await settingsStore.saveSoftwareHouse({ ...form, email: form.email.trim() })
    $q.notify({ type: 'positive', message: 'Dados da Software House salvos.' })
    if (setup.value) await router.push(await nextSetupLocation())
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await settingsStore.load()
  Object.assign(form, settingsStore.softwareHouse)
})
</script>

<style scoped>
.logo-preview {
  width: 120px;
  height: 64px;
  border: 1px dashed #bdbdbd;
  border-radius: 4px;
  padding: 4px;
}

.logo-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
</style>
