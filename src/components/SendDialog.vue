<template>
  <q-dialog v-model="show" @before-show="load">
    <q-card style="width: 460px; max-width: 90vw">
      <q-card-section class="row items-center q-pb-none">
        <q-icon name="send" color="primary" size="22px" class="q-mr-sm" />
        <div class="text-h6">Enviar para a contabilidade</div>
      </q-card-section>

      <q-card-section class="q-pt-sm">
        <div class="text-caption text-grey-8">
          {{ noteCount }} nota(s) selecionada(s) · período {{ periodLabel }}
        </div>
        <div v-if="accountantName" class="text-body2 q-mt-xs">
          Contador: <strong>{{ accountantName }}</strong>
        </div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <div class="text-subtitle2 q-mb-xs">Enviar para</div>
        <q-form ref="formRef" class="q-gutter-xs" @submit="confirm">
          <div v-for="(_email, i) in emails" :key="i" class="row items-start no-wrap">
            <q-input
              v-model="emails[i]"
              filled
              dense
              type="email"
              class="col"
              placeholder="email@contabilidade.com.br"
              :rules="[(v) => isValidEmail(v) || 'Email inválido']"
              hide-bottom-space
              :autofocus="i === emails.length - 1 && i > 0"
            >
              <template #prepend><q-icon name="mail" size="18px" /></template>
            </q-input>
            <q-btn
              v-if="emails.length > 1"
              flat
              dense
              round
              icon="close"
              class="q-ml-xs q-mt-xs"
              aria-label="Remover email"
              @click="emails.splice(i, 1)"
            />
          </div>
        </q-form>

        <q-btn
          flat
          dense
          no-caps
          icon="add"
          label="Adicionar email"
          class="q-mt-xs"
          :disable="emails.length >= MAX_RECIPIENTS"
          @click="emails.push('')"
        />
        <span v-if="emails.length >= MAX_RECIPIENTS" class="text-caption text-grey q-ml-sm">
          Máximo de {{ MAX_RECIPIENTS }} destinatários.
        </span>

        <div class="text-caption text-grey q-mt-sm">
          Cada destinatário recebe por email um link para baixar o .zip (válido por 7 dias).
          Alterações aqui valem só para este envio. Para mudar o email padrão, use o menu Contador.
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Cancelar" v-close-popup />
        <q-btn color="primary" icon="send" label="Enviar" @click="formRef.submit()" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { isValidEmail } from '@/utils/validators'

defineProps({
  noteCount: { type: Number, default: 0 },
  periodLabel: { type: String, default: '' }
})
const emit = defineEmits(['confirm'])
const show = defineModel({ type: Boolean, default: false })

// Limite do serviço de email da SoftBR por envio.
const MAX_RECIPIENTS = 5

const formRef = ref(null)
const emails = ref([''])
const accountantName = ref('')

// Sempre reabre com o email cadastrado no menu Contador, descartando o que
// foi editado num envio anterior.
async function load () {
  const accountant = await window.api.settings.getAccountant()
  accountantName.value = accountant?.name ?? ''
  emails.value = [accountant?.email || '']
}

const cleanEmails = computed(() => [...new Set(emails.value.map((e) => e.trim()).filter(Boolean))])

function confirm () {
  emit('confirm', cleanEmails.value)
  show.value = false
}
</script>
