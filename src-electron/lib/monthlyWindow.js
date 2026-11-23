export const MONTHLY_HOURS = [8, 11, 14, 17, 20]

function isoDay (date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0')).join('-')
}

export function monthlyWindow (now) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const first = new Date(year, month, 1)
  const monday = 1 + (8 - first.getDay()) % 7
  const previousStart = new Date(year, month - 1, 1)
  const previousEnd = new Date(year, month, 0)
  const period = { dataInicial: isoDay(previousStart), dataFinal: isoDay(previousEnd) }
  const deadline = new Date(year, month, monday + 1, 20, 1)
  const key = isoDay(first).slice(0, 7)
  const day = now.getDate()
  const hour = now.getHours()
  const slot = (day === monday || day === monday + 1) && MONTHLY_HOURS.includes(hour) &&
    now.getMinutes() === 0 ? `${isoDay(now)}T${String(hour).padStart(2, '0')}:00` : null
  return { key, period, deadline, slot, lastSlot: !!slot && day === monday + 1 && hour === 20 }
}
