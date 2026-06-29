/**
 * AeroDataBox flight status via RapidAPI.
 * Pristup: jedan poziv po broju leta (/flights/number/{fn}/{date}).
 * Ključevi u mapi su uvijek normalizovani (bez razmaka, uppercase).
 */

const RAPIDAPI_KEY  = import.meta.env.VITE_RAPIDAPI_KEY
const RAPIDAPI_HOST = 'aerodatabox.p.rapidapi.com'

// ── Javni API ─────────────────────────────────────────────────────

/** "TK 1095" → "TK1095" */
export function normalizeFlight(fn) {
  return fn ? fn.replace(/\s+/g, '').toUpperCase() : fn
}

/**
 * Dohvati status jednog leta.
 * @param {string} flightNumber - npr "3F151", "TK 1095"
 * @param {string} date         - "YYYY-MM-DD"
 * @returns {object|null} { status, scheduledArr, actualArr, delayMin }
 */
export async function getFlightStatus(flightNumber, date) {
  if (!RAPIDAPI_KEY || !flightNumber || !date) return null

  const fn = normalizeFlight(flightNumber)

  try {
    const res = await fetch(
      `https://${RAPIDAPI_HOST}/flights/number/${fn}/${date}`,
      {
        headers: {
          'x-rapidapi-host': RAPIDAPI_HOST,
          'x-rapidapi-key':  RAPIDAPI_KEY,
        },
      }
    )

    if (res.status === 404) return null
    if (!res.ok) {
      console.warn('[flightStatus]', fn, res.status)
      return null
    }

    const data   = await res.json()
    const flight = Array.isArray(data) ? data[0] : data
    if (!flight) return null

    const arr = flight.arrival
    if (!arr) return null

    const scheduled = arr.scheduledTime?.local
    const actual    = arr.actualTime?.local
                   || arr.runwayTime?.local
                   || arr.estimatedTime?.local
                   || scheduled

    const schedMin  = parseLocalTime(scheduled)
    const actualMin = parseLocalTime(actual)
    const delayMin  = (schedMin !== null && actualMin !== null) ? actualMin - schedMin : 0

    return {
      status:       mapStatus(flight.status),
      scheduledArr: formatTime(scheduled),
      actualArr:    formatTime(actual),
      delayMin,
    }
  } catch (e) {
    console.error('[flightStatus]', flightNumber, e)
    return null
  }
}

/**
 * Dohvati statuse za sve dolazne transfere.
 * Ključevi u rezultatu su normalizovani brojevi leta.
 * @param {Array}  transfers - lista transfera
 * @param {string} date      - "YYYY-MM-DD"
 */
export async function getFlightStatusesByAirport(transfers, date) {
  if (!RAPIDAPI_KEY) return {}

  // Uzmi jedinstvene normalizovane brojeve ARR letova
  const unique = [...new Set(
    transfers
      .filter(t => t.type === 'arr' && t.flight_number)
      .map(t => normalizeFlight(t.flight_number))
  )]

  if (!unique.length) return {}

  // Paralelni pozivi — ključevi su normalizovani
  const entries = await Promise.all(
    unique.map(fn => getFlightStatus(fn, date).then(s => [fn, s]))
  )

  return Object.fromEntries(entries)
}

// ── Utility ───────────────────────────────────────────────────────

function formatTime(str) {
  if (!str) return null
  const m = str.match(/(\d{2}:\d{2})/)
  return m ? m[1] : null
}

function parseLocalTime(str) {
  if (!str) return null
  const m = str.match(/(\d{2}):(\d{2})/)
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

function mapStatus(s) {
  switch (s) {
    case 'Scheduled': return 'scheduled'
    case 'EnRoute':   return 'enroute'
    case 'Landed':
    case 'Arrived':   return 'arrived'
    case 'Delayed':   return 'delayed'
    case 'Cancelled': return 'cancelled'
    default:          return 'unknown'
  }
}
