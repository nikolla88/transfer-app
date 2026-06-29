/**
 * transferUtils.js
 * Zajednički helperi za DepartureList i ArrivalList stranice.
 */

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Normalizuje broj leta za pouzdano poređenje:
 * - Uklanja GDS/BSP sufikse u zagradama: (GDS), (BSP)...
 * - Uklanja sve ne-alfanumeričke znakove (razmaci, crtice...)
 * - Normalizuje vodeće nule u broju leta: J2034 = J234, J2 034 = J234
 *
 * Primjeri:
 *   "J2 034"        → "J234"
 *   "J2034"         → "J234"
 *   "J2 34 (GDS)"   → "J234"
 *   "TK1098"        → "TK1098"
 *   "KC636"         → "KC636"
 *   "3F152"         → "3F152"
 */
export function normalize(fn) {
  if (!fn) return ''
  // 1. Ukloni sufiks u zagradama: (GDS), (BSP), (CRS) itd.
  let s = fn.replace(/\s*\([^)]*\)/g, '').trim()
  // 2. Ukloni sve osim slova i cifara
  s = s.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  // 3. Normalizuj vodeće nule u numeričkom dijelu broja leta
  //    IATA kod = prva 2 znaka (slovo+cifra ili 2 slova), ostatak je broj
  const m = s.match(/^([A-Z\d]{2})(\d+)$/)
  if (m) return m[1] + parseInt(m[2], 10).toString()
  return s
}

export function getDayName(dateStr) {
  if (!dateStr) return null
  return DAY_NAMES[new Date(dateStr + 'T00:00:00').getDay()]
}

/** "HH:MM:SS" ili "HH:MM" → "HH:MM" */
export function fmtTime(t) {
  if (!t) return '—'
  return t.slice(0, 5)
}

export function fmtDate(d) {
  if (!d) return '—'
  const [, m, dd] = d.split('-')
  return `${dd}.${m}.`
}

export function fmtDateFull(d) {
  if (!d) return '—'
  const [y, m, dd] = d.split('-')
  return `${dd}.${m}.${y}`
}

export function nightsBetween(d1, d2) {
  if (!d1 || !d2) return '—'
  return Math.round((new Date(d2) - new Date(d1)) / 86400000)
}

/**
 * Izračunaj pickup time.
 * @param {string} scheduledTime  — "HH:MM" ili "HH:MM:SS"
 * @param {number} hotelMinutes   — minuta od hotela do aerodroma
 * @returns {string|null}         — "HH:MM" ili null
 */
export function calcPickupTime(scheduledTime, hotelMinutes) {
  if (!scheduledTime || !hotelMinutes) return null
  const [h, m] = scheduledTime.split(':').map(Number)
  const flightMins = h * 60 + m
  const pickupMins = flightMins - hotelMinutes
  if (pickupMins < 0) return null
  return `${String(Math.floor(pickupMins / 60)).padStart(2, '0')}:${String(pickupMins % 60).padStart(2, '0')}`
}

/**
 * Pronađi odgovarajući raspored leta za dati dan u sedmici.
 * Jedan let može imati više redova u flight_schedule (različita vremena po danima).
 *
 * @param {Array}  schedules  — svi schedules za jedan flight_number
 * @param {string} dayName    — 'Mon','Tue',...
 * @returns {Object|null}
 */
export function findScheduleForDay(schedules, dayName) {
  if (!schedules?.length) return null
  const match = schedules.find(s =>
    !s.days_of_week || s.days_of_week.length === 0 || s.days_of_week.includes(dayName)
  )
  return match || null
}

/**
 * Grupiraj zapise po letu i sortiraj:
 * - grupe po scheduled_time leta
 * - unutar grupe: GRP → SHA → IND (po pickup_time), NO TR-R na kraju
 *
 * @param {Array}  records     — enriched rooming_list records
 * @param {string} flightKey   — 'dep_flight_name' | 'arr_flight_name'
 * @param {string} trKey       — 'dep_transfer_alias' | 'arr_transfer_alias'
 * @returns {{ groups: Array, noTransfer: Array }}
 */
/**
 * @param {Function} [sortFn] — opciona custom sort funkcija za zapise unutar grupe.
 *   Ako nije proslijeđena, koristi se defaultni sort: GRP→SHA→IND, pa pickup_time.
 */
export function groupAndSort(records, flightKey, trKey, sortFn = null) {
  const TR_ORDER = { GRP: 0, SHA: 1, IND: 2 }

  const groupMap = {}
  const noTransfer = []

  for (const r of records) {
    const tr = r[trKey]
    if (tr === 'NO TR-R') { noTransfer.push(r); continue }

    const flight = r[flightKey] || '—'
    if (!groupMap[flight]) groupMap[flight] = []
    groupMap[flight].push(r)
  }

  const defaultSort = (recs) =>
    [...recs].sort((a, b) => {
      const oa = TR_ORDER[a[trKey]] ?? 50
      const ob = TR_ORDER[b[trKey]] ?? 50
      if (oa !== ob) return oa - ob
      const pa = a._pickupTime || '99:99'
      const pb = b._pickupTime || '99:99'
      return pa.localeCompare(pb)
    })

  const sortRecords = sortFn || defaultSort

  const groups = Object.entries(groupMap)
    .map(([flight, recs]) => ({
      flight,
      schedule: recs[0]?._schedule || null,
      records: sortRecords(recs),
    }))
    .sort((a, b) => {
      const ta = a.schedule?.scheduled_time || '99:99'
      const tb = b.schedule?.scheduled_time || '99:99'
      return ta.localeCompare(tb)
    })

  return { groups, noTransfer: sortRecords(noTransfer) }
}
