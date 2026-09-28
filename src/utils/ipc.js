// Objetos reativos do Vue/Pinia (Proxy) não podem cruzar a fronteira do
// contextBridge do Electron (que clona argumentos como o IPC faz). Sempre
// que passar dados de um ref/store/QTable row pra `window.api.*`, converta
// com esta função primeiro.
export function toPlain (value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}
