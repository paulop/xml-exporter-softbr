import { store, lastExportStore } from '../lib/store.js'
import { monthlyWindow } from '../lib/monthlyWindow.js'
import { sendProblemsReport } from './export.js'

let active = null
let checking = false

function getClosing (key) {
  return lastExportStore.get('monthlyClosings')[key] ?? { attempts: {} }
}

function saveClosing (key, closing) {
  lastExportStore.set('monthlyClosings', { ...lastExportStore.get('monthlyClosings'), [key]: closing })
}

function overdueWindows (now, since) {
  if (!since) return []
  const current = monthlyWindow(now)
  const previous = monthlyWindow(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const older = Object.keys(lastExportStore.get('monthlyClosings'))
    .filter((key) => key >= since && key < previous.key)
    .map((key) => monthlyWindow(new Date(key + '-01T00:00:00')))
  return [...older, previous, current].filter((window) => {
    const closing = getClosing(window.key)
    return window.key >= since && now >= window.deadline && !closing.finished && !closing.alerted
  })
}

export function hasScheduledWork (now) {
  if (!store.get('accountant')?.autoOpen) return false
  const since = store.get('monthlyScheduleSince')
  const window = monthlyWindow(now)
  const closing = getClosing(window.key)
  return !!(window.slot && (!since || window.key >= since) &&
    !closing.finished && !closing.alerted && !Object.hasOwn(closing.attempts, window.slot)) ||
    overdueWindows(now, since).length > 0
}

async function notifyFailure (window, closing) {
  const attempts = Object.entries(closing.attempts)
  const errors = attempts.flatMap(([slot, problems]) =>
    (problems?.length ? problems : ['Execução interrompida antes de concluir.']).map((problem) => `${slot}: ${problem}`))
  if (!errors.length) errors.push('Nenhuma tentativa foi registrada nos horários previstos.')
  const result = await sendProblemsReport({}, window.period, ['Fechamento mensal não concluído.', ...errors])
  if (result?.sent || result?.skipped) saveClosing(window.key, { ...closing, alerted: true })
  return result
}

export async function begin (scheduledAt) {
  if (checking || active || !store.get('accountant')?.autoOpen) return null
  checking = true
  try {
    const now = new Date()
    const window = monthlyWindow(scheduledAt ?? now)
    const since = store.get('monthlyScheduleSince')
    let alert
    for (const candidate of overdueWindows(now, since)) {
      if (window.slot && candidate.key === window.key) continue
      alert = await notifyFailure(candidate, getClosing(candidate.key))
    }
    if (!scheduledAt || !window.slot || (since && window.key < since)) return alert ? { alert } : null
    const closing = getClosing(window.key)
    if (closing.finished || closing.alerted || Object.hasOwn(closing.attempts, window.slot)) {
      return alert ? { alert } : null
    }
    saveClosing(window.key, { ...closing, attempts: { ...closing.attempts, [window.slot]: null } })
    active = window
    return { period: window.period, alert }
  } finally {
    checking = false
  }
}

export async function finish (sourceErrors = []) {
  if (!active) return null
  const window = active
  try {
    const closing = getClosing(window.key)
    const updated = {
      ...closing,
      finished: !sourceErrors.length,
      attempts: { ...closing.attempts, [window.slot]: sourceErrors.map(String) }
    }
    saveClosing(window.key, updated)
    if (sourceErrors.length && (window.lastSlot || new Date() >= window.deadline)) {
      return await notifyFailure(window, updated)
    }
    return null
  } finally {
    active = null
  }
}
