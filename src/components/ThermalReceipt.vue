<template>
  <div class="thermal-receipt" :class="{ 'thermal-receipt--print': printMode }">
    <template v-if="nota">
      <div class="text-center text-weight-bold">{{ nota.emitente.nome }}</div>
      <div class="text-center">
        CNPJ: {{ nota.emitente.cnpj }}<template v-if="nota.emitente.ie"> — IE: {{ nota.emitente.ie }}</template>
      </div>
      <div v-if="nota.emitente.endereco" class="text-center">{{ nota.emitente.endereco }}<template v-if="nota.emitente.bairro"> — {{ nota.emitente.bairro }}</template></div>
      <div v-if="nota.emitente.cidade" class="text-center">{{ nota.emitente.cidade }} - {{ nota.emitente.uf }}</div>

      <div class="thermal-receipt__divider" />

      <div class="text-center text-weight-bold">DANFE NFC-e</div>
      <div class="text-center">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
      <div class="text-center text-italic">Não permite aproveitamento de crédito de ICMS</div>

      <div class="thermal-receipt__divider" />

      <div class="thermal-receipt__header-row text-weight-bold">
        <span>ITEM CÓD DESC QTD UN VL_UNI</span>
        <span>VL_TOT</span>
      </div>

      <template v-for="item in nota.itens" :key="item.numero">
        <div class="text-weight-bold">{{ String(item.numero).padStart(3, '0') }} {{ item.codigo }} {{ item.descricao }}</div>
        <div class="thermal-receipt__row">
          <span>{{ formatQty(item.quantidade) }} {{ item.unidade }} x R$ {{ formatMoney(item.valorUnitario) }}</span>
          <span>R$ {{ formatMoney(item.valorTotal) }}</span>
        </div>
      </template>

      <div class="thermal-receipt__divider" />

      <div class="thermal-receipt__row">
        <span>Qtd. Total de Itens:</span>
        <span>{{ nota.totais.quantidadeItens }}</span>
      </div>
      <div class="thermal-receipt__row">
        <span>Valor Total Produtos R$:</span>
        <span>{{ nota.totais.valorProdutos }}</span>
      </div>
      <div class="thermal-receipt__row text-weight-bold">
        <span>VALOR A PAGAR R$:</span>
        <span>{{ nota.totais.valorTotal }}</span>
      </div>
      <div v-if="nota.totais.tributos" class="thermal-receipt__row">
        <span>Trib. Totais (Lei 12.741/12):</span>
        <span>R$ {{ nota.totais.tributos }}</span>
      </div>

      <template v-if="nota.pagamentos.length">
        <div class="thermal-receipt__divider" />
        <div class="text-weight-bold">FORMA PAGAMENTO</div>
        <div v-for="(pag, idx) in nota.pagamentos" :key="idx" class="thermal-receipt__row">
          <span>{{ pag.descricao }}:</span>
          <span>R$ {{ formatMoney(pag.valor) }}</span>
        </div>
      </template>

      <template v-if="nota.consumidor">
        <div class="thermal-receipt__divider" />
        <div class="text-weight-bold">CONSUMIDOR</div>
        <div>{{ nota.consumidor.documento }}</div>
        <div v-if="nota.consumidor.nome">{{ nota.consumidor.nome }}</div>
      </template>

      <div class="thermal-receipt__divider" />

      <div class="text-center">NFC-e N° {{ nota.identificacao.numero }} Série {{ nota.identificacao.serie }}</div>
      <div class="text-center">Emissão: {{ nota.identificacao.emissao }}</div>
      <div v-if="nota.protocolo.numero" class="text-center">Protocolo de Autorização: {{ nota.protocolo.numero }}</div>
      <div v-if="nota.protocolo.autorizacao" class="text-center">Data de Autorização: {{ nota.protocolo.autorizacao }}</div>
      <div class="text-center">Ambiente: {{ nota.identificacao.ambiente.toUpperCase() }}</div>

      <div class="thermal-receipt__divider" />

      <div class="text-center text-weight-bold">CHAVE DE ACESSO</div>
      <div class="text-center">{{ nota.chave }}</div>

      <template v-if="nota.informacoesComplementares">
        <div class="thermal-receipt__divider" />
        <div class="text-weight-bold">INFORMAÇÕES COMPLEMENTARES</div>
        <div class="thermal-receipt__info">{{ nota.informacoesComplementares }}</div>
      </template>

      <div class="thermal-receipt__divider" />

      <div class="text-center">Consulta via leitor de QR Code / SEFAZ</div>
      <div
        v-if="qrCodeSvg"
        class="text-center q-my-xs thermal-receipt__qrcode"
        v-html="qrCodeSvg"
      />
    </template>
    <div v-else class="text-center text-grey">Não foi possível ler o XML desta nota.</div>
  </div>
</template>

<script setup>
defineProps({
  nota: { type: Object, default: null },
  qrCodeSvg: { type: String, default: '' },
  printMode: { type: Boolean, default: false }
})

function formatMoney (value) {
  return Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatQty (value) {
  return Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
</script>

<style scoped>
.thermal-receipt {
  width: 80mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 4mm;
  font-family: 'Courier New', Courier, monospace;
  font-size: 9px;
  line-height: 1.4;
  color: #000;
  background: #fff;
  box-sizing: border-box;
  word-break: break-word;
}

.thermal-receipt__divider {
  border-top: 1px dashed #000;
  margin: 4px 0;
}

.thermal-receipt__row,
.thermal-receipt__header-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.thermal-receipt__info {
  white-space: pre-wrap;
  word-break: break-word;
}

.thermal-receipt__qrcode :deep(svg) {
  width: 140px;
  height: 140px;
}

.thermal-receipt--print {
  width: 100%;
}
</style>
