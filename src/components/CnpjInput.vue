<template>
  <q-input
    ref="inputRef"
    :model-value="formatCnpj(modelValue)"
    maxlength="18"
    @update:model-value="onInput"
  />
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { formatCnpj, normalizeCnpj } from '@/utils/validators'

// Campo de CNPJ (numérico ou alfanumérico). Substitui o `mask` do QInput, que
// travava o sistema ao trocar de janela (Alt+Tab) no meio da digitação: aqui a
// máscara é só formatação do valor exibido. O v-model recebe o CNPJ sem máscara.
// Demais props/eventos (label, rules, filled...) passam direto pro q-input.
const props = defineProps({ modelValue: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])

const inputRef = ref(null)

async function onInput (value) {
  const el = inputRef.value?.getNativeElement()
  // Quantos caracteres válidos há antes do cursor, pra recolocá-lo no mesmo
  // ponto depois que a máscara reformatar o texto.
  const caret = el?.selectionStart ?? String(value).length
  const before = normalizeCnpj(String(value ?? '').slice(0, caret)).length

  const raw = normalizeCnpj(value)
  if (raw !== props.modelValue) emit('update:modelValue', raw)

  await nextTick()
  if (!el || document.activeElement !== el) return
  const formatted = formatCnpj(raw)
  // O q-input mantém o texto digitado se o model não mudou (ex.: caractere inválido).
  if (el.value !== formatted) el.value = formatted
  let pos = 0
  for (let count = 0; pos < formatted.length && count < before; pos++) {
    if (/[A-Z\d]/.test(formatted[pos])) count++
  }
  el.setSelectionRange(pos, pos)
}
</script>
