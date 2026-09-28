<template>
  <q-dialog v-model="isOpen" @hide="onHide">
    <q-card class="nota-detail-card">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">Nota fiscal {{ row?.numero }}/{{ row?.serie }}</div>
        <q-space />
        <q-btn flat dense round icon="close" v-close-popup />
      </q-card-section>

      <q-tabs v-model="tab" dense align="left" class="text-grey" active-color="primary" indicator-color="primary">
        <q-tab name="cupom" label="Cupom Térmico" />
        <q-tab name="xml" label="XML" />
      </q-tabs>

      <q-separator />

      <q-card-section v-if="tab === 'cupom'" class="nota-detail-card__cupom">
        <div class="row justify-end q-mb-sm">
          <q-btn
            unelevated
            dense
            color="primary"
            icon="picture_as_pdf"
            label="Baixar em PDF"
            :loading="downloadingPdf"
            :disable="!nota"
            @click="downloadPdf"
          />
        </div>
        <q-banner v-if="pdfMessage" :class="pdfOk ? 'text-positive' : 'text-negative'" dense class="q-mb-sm">
          {{ pdfMessage }}
        </q-banner>
        <q-scroll-area class="nota-detail-card__scroll">
          <div class="nota-detail-card__zoom">
            <ThermalReceipt :nota="nota" :qr-code-svg="qrCodeSvg" />
          </div>
        </q-scroll-area>
      </q-card-section>

      <q-card-section v-else class="nota-detail-card__xml">
        <div class="row justify-end q-mb-sm">
          <q-btn flat dense icon="content_copy" label="Copiar XML" :disable="!xmlText" @click="copyXml" />
        </div>
        <q-scroll-area class="nota-detail-card__scroll">
          <pre class="nota-detail-card__xml-pre" v-html="highlightedXml"></pre>
        </q-scroll-area>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useQuasar } from 'quasar'
import QRCode from 'qrcode'
import ThermalReceipt from './ThermalReceipt.vue'
import { decodeBase64Xml, parseNFCe, formatXml, highlightXml } from '@/utils/nfce'
import { buildReceiptHtml } from '@/utils/receiptHtml'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  row: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue'])

const $q = useQuasar()

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const tab = ref('cupom')
const downloadingPdf = ref(false)
const pdfMessage = ref('')
const pdfOk = ref(true)

const xmlText = ref('')
const nota = ref(null)
const qrCodeSvg = ref('')

const formattedXml = computed(() => formatXml(xmlText.value))
const highlightedXml = computed(() => highlightXml(formattedXml.value))

watch(() => props.row, (row) => {
  xmlText.value = row?.xmlContent ? decodeBase64Xml(row.xmlContent) : ''
  nota.value = xmlText.value ? parseNFCe(xmlText.value) : null
}, { immediate: true })

watch(nota, async (value) => {
  qrCodeSvg.value = ''
  if (!value?.qrCode) return
  try {
    qrCodeSvg.value = await QRCode.toString(value.qrCode, { type: 'svg', margin: 1, width: 180 })
  } catch {
    qrCodeSvg.value = ''
  }
}, { immediate: true })

function onHide () {
  tab.value = 'cupom'
  pdfMessage.value = ''
}

async function copyXml () {
  try {
    await navigator.clipboard.writeText(xmlText.value)
    $q.notify({ type: 'positive', message: 'XML copiado para a área de transferência.' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message ?? String(err) })
  }
}

async function downloadPdf () {
  if (!nota.value) return
  downloadingPdf.value = true
  pdfMessage.value = ''
  try {
    const html = buildReceiptHtml(nota.value, qrCodeSvg.value)
    const fileName = `cupom-${nota.value.chave || props.row?.chave || 'nfce'}.pdf`
    const result = await window.api.export.downloadReceiptPdf({ html, fileName })
    pdfOk.value = result.ok
    pdfMessage.value = result.ok ? `PDF salvo em ${result.path}` : result.message
  } catch (err) {
    pdfOk.value = false
    pdfMessage.value = err.message ?? String(err)
  } finally {
    downloadingPdf.value = false
  }
}
</script>

<style scoped>
.nota-detail-card {
  width: 860px;
  max-width: 95vw;
}

.nota-detail-card__scroll {
  height: 70vh;
}

.nota-detail-card__cupom .nota-detail-card__scroll {
  background: #f5f5f5;
  border-radius: 4px;
}

.nota-detail-card__zoom {
  zoom: 1.6;
  padding: 12px 0;
}

.nota-detail-card__xml-pre {
  margin: 0;
  padding: 12px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.nota-detail-card__xml-pre :deep(.xml-tag) {
  color: #1565c0;
  font-weight: bold;
}

.nota-detail-card__xml-pre :deep(.xml-attr) {
  color: #6a1b9a;
}

.nota-detail-card__xml-pre :deep(.xml-value) {
  color: #2e7d32;
}
</style>
