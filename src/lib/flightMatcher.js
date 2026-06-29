/**
 * flightMatcher.js
 *
 * Matching logika: flight_number iz Excela → flight_schedule tabela u bazi
 *
 * Status rezultata:
 *   'exact'   — tačno podudaranje po flight_number
 *   'alias'   — podudaranje po aliases polju
 *   'unknown' — nije pronađen, korisnik mora ručno da potvrdi
 */

import { supabase } from './supabase'

/**
 * Normalizuje broj leta: uklanja GDS sufikse, razmake/crtice,
 * uppercase, i normalizuje vodeće nule u broju (J2034 = J234).
 * Identično sa normalize() u transferUtils.js.
 */
function normalize(fn) {
  if (!fn) return ''
  let s = fn.replace(/\s*\([^)]*\)/g, '').trim()
  s = s.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  const m = s.match(/^([A-Z\d]{2})(\d+)$/)
  if (m) return m[1] + parseInt(m[2], 10).toString()
  return s
}

/**
 * Učita sve letove iz baze jednom i vrati matcher funkciju.
 * Koristiti pri importu Rooming Liste da se izbjegnu višestruki upiti.
 *
 * @returns {{ match: Function, schedules: Array }}
 */
export async function buildFlightMatcher() {
  const { data, error } = await supabase
    .from('flight_schedule')
    .select('id, flight_number, airline, origin, destination, airport, direction, scheduled_time, aliases')

  if (error) throw error

  const schedules = data || []

  // Indeks: normalizovani flight_number → schedule
  const byNumber = new Map()
  // Indeks: normalizovani alias → schedule
  const byAlias  = new Map()

  for (const s of schedules) {
    byNumber.set(normalize(s.flight_number), s)
    for (const alias of (s.aliases || [])) {
      byAlias.set(normalize(alias), s)
    }
  }

  /**
   * Pronađi match za jedan broj leta iz Excela.
   *
   * @param {string} rawFlight — originalni string iz Excela (npr. "TK 1095")
   * @returns {{
   *   status: 'exact' | 'alias' | 'unknown',
   *   raw: string,
   *   normalized: string,
   *   schedule: Object | null
   * }}
   */
  function match(rawFlight) {
    if (!rawFlight) return { status: 'unknown', raw: rawFlight, normalized: '', schedule: null }

    const norm = normalize(rawFlight)

    const exactMatch = byNumber.get(norm)
    if (exactMatch) return { status: 'exact', raw: rawFlight, normalized: norm, schedule: exactMatch }

    const aliasMatch = byAlias.get(norm)
    if (aliasMatch) return { status: 'alias', raw: rawFlight, normalized: norm, schedule: aliasMatch }

    return { status: 'unknown', raw: rawFlight, normalized: norm, schedule: null }
  }

  return { match, schedules }
}

/**
 * Analizira listu zapisa iz Rooming Liste i grupira neprepoznate letove.
 * Koristiti nakon importa da se prikaže korisiku koje letove treba potvrditi.
 *
 * @param {Array} records - parsovani rooming list zapisi
 * @returns {{
 *   results: Array,         // svaki zapis + matchArr + matchDep
 *   unknownFlights: Set     // skup nepoznatih flight_number stringova
 * }}
 */
export async function matchFlightsInRoomingList(records) {
  const { match } = await buildFlightMatcher()

  const unknownFlights = new Set()
  const results = records.map(r => {
    const matchArr = r.arr_flight_name ? match(r.arr_flight_name) : null
    const matchDep = r.dep_flight_name ? match(r.dep_flight_name) : null

    if (matchArr?.status === 'unknown') unknownFlights.add(r.arr_flight_name)
    if (matchDep?.status === 'unknown') unknownFlights.add(r.dep_flight_name)

    return { ...r, matchArr, matchDep }
  })

  return { results, unknownFlights }
}
