<template>
  <q-dialog v-model="show" persistent>
    <q-card style="min-width: 420px">
      <q-card-section>
        <div class="text-h6">{{ isEdit ? 'Editar conexão' : 'Nova conexão' }}</div>
      </q-card-section>

      <q-card-section class="q-gutter-y-sm">
        <q-input v-model="form.name" label="Nome (ex: Filial 1)" dense />
        <div class="row no-wrap" style="gap: 8px">
          <q-input v-model="form.host" label="Host / IP" dense class="col" />
          <q-input v-model.number="form.port" label="Porta" type="number" dense style="width: 110px" />
        </div>
        <q-input v-model="form.database" label="Banco de dados" dense />
        <q-input v-model="form.user" label="Usuário" dense />
        <q-input
          v-model="form.password"
          :label="isEdit ? 'Senha (deixe em branco para manter)' : 'Senha'"
          type="password"
          dense
        />
        <q-checkbox v-model="form.options.encrypt" label="Usar criptografia (TLS)" dense />
        <q-checkbox
          v-model="form.options.trustServerCertificate"
          dense
          label="Confiar no certificado do servidor"
        />

        <div v-if="testResult" class="q-mt-sm">
          <q-banner :class="testResult.ok ? 'bg-positive text-white' : 'bg-negative text-white'">
            {{ testResult.message }}
          </q-banner>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Cancelar" @click="close" />
        <q-btn flat label="Testar conexão" :loading="testing" @click="test" />
        <q-btn color="primary" label="Salvar" :loading="saving" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { useConnectionsStore } from '@/stores/connections-store'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  connection: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'saved'])

const connectionsStore = useConnectionsStore()

const show = ref(props.modelValue)
const saving = ref(false)
const testing = ref(false)
const testResult = ref(null)

const isEdit = ref(false)

const form = reactive({
  id: null,
  name: '',
  host: '',
  port: 1433,
  database: '',
  user: '',
  password: '',
  options: { encrypt: false, trustServerCertificate: true }
})

watch(
  () => props.modelValue,
  (value) => {
    show.value = value
    if (value) resetForm()
  }
)

watch(show, (value) => emit('update:modelValue', value))

function resetForm () {
  testResult.value = null
  isEdit.value = !!props.connection

  if (props.connection) {
    Object.assign(form, {
      id: props.connection.id,
      name: props.connection.name,
      host: props.connection.host,
      port: props.connection.port,
      database: props.connection.database,
      user: props.connection.user,
      password: '',
      options: { ...props.connection.options }
    })
  } else {
    Object.assign(form, {
      id: null,
      name: '',
      host: '',
      port: 1433,
      database: '',
      user: '',
      password: '',
      options: { encrypt: false, trustServerCertificate: true }
    })
  }
}

function close () {
  show.value = false
}

async function test () {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await connectionsStore.test({ ...form })
  } finally {
    testing.value = false
  }
}

async function save () {
  saving.value = true
  try {
    await connectionsStore.save({ ...form })
    emit('saved')
    close()
  } finally {
    saving.value = false
  }
}
</script>
