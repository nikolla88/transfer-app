/**
 * roomingParser.js
 * Parsira Rooming List Excel fajl.
 *
 * Struktura fajla:
 *   Red 0 — brojevi redosljeda prikaza (1–19 iznad odabranih kolona)
 *   Red 1 — nazivi kolona (claim_inc, tourist_name, ...)
 *   Red 2+ — podaci
 *
 * Koristi SheetJS via dinamički CDN import (nema npm paketa).
 */

// ── Normalizacija tipova transfera ────────────────────────────────
const TRANSFER_COLS = new Set(['arr_transfer_alias', 'dep_transfer_alias'])
const TRANSFER_MAP  = {
  'NON':      'NO TR-R',
  'NO TR-R':  'NO TR-R',
  'GRP':      'GRP',
  'IND':      'IND',
  'SHA':      'SHA',
}
function normalizeTransfer(val) {
  if (!val) return null
  const key = val.trim().toUpperCase()
  return TRANSFER_MAP[key] ?? val.trim()  // nepoznate vrijednosti ostavljamo kakve su
}

const DATE_COLS = new Set([
  'date_beg', 'date_end', 'claim_create_date',
  'arr_transfer_date', 'dep_transfer_date', 'flight_out_date',
])

const INT_COLS = new Set([
  'claim_inc', 'order_inc', 'partner_inc',
  'reserve', 'rcount', 'adult', 'child', 'infant',
])

/**
 * Parsira ArrayBuffer xlsx fajla i vraća array objekata za upsert u bazu.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<Object>>}
 */
export async function parseRoomingXlsx(buffer) {
  // Dinamički import SheetJS — isto kao jsPDF u generateContract.js
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')

  const wb  = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  if (raw.length < 2) throw new Error('Fajl ne sadrži dovoljno podataka.')

  // Auto-detektuj koji red je header:
  //   Stari format: red 0 = numerički indeksi, red 1 = nazivi kolona, podaci od 2
  //   Novi format:  red 0 = direktno nazivi kolona, podaci od 1
  const KNOWN_COLS = ['claim_inc', 'tourist_name', 'order_inc', 'date_beg', 'hotel_name']
  const row0HasHeaders = raw[0].some(
    c => typeof c === 'string' && KNOWN_COLS.includes(c.trim())
  )
  const headerRowIdx = row0HasHeaders ? 0 : 1
  const dataStartRow = headerRowIdx + 1

  const colNames = raw[headerRowIdx].map(c => (typeof c === 'string' ? c.trim() : null))

  const records = []

  for (let r = dataStartRow; r < raw.length; r++) {
    const row = raw[r]
    if (!row || row.every(v => v === null || v === '')) continue

    const obj = {}

    colNames.forEach((name, i) => {
      if (!name) return
      let val = row[i]

      // "NULL" string → null
      if (typeof val === 'string' && val.trim().toUpperCase() === 'NULL') val = null

      // Datumi
      if (DATE_COLS.has(name)) {
        if (val instanceof Date) {
          // Koristimo lokalne getters (ne toISOString/UTC) da izbjegnemo timezone pomak
          const y = val.getFullYear()
          const m = String(val.getMonth() + 1).padStart(2, '0')
          const d = String(val.getDate()).padStart(2, '0')
          val = `${y}-${m}-${d}`
        } else if (typeof val === 'number') {
          const d = XLSX.SSF.parse_date_code(val)
          val = d
            ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
            : null
        } else {
          val = null
        }
      }

      // Cijeli brojevi
      if (INT_COLS.has(name)) {
        val = (val !== null && val !== '') ? (parseInt(val) || null) : null
      }

      // Tipovi transfera — normalizacija
      if (TRANSFER_COLS.has(name)) {
        val = normalizeTransfer(val)
      // Stringovi
      } else if (typeof val === 'string') {
        val = val.trim() || null
      }

      obj[name] = val
    })

    if (!obj.claim_inc) continue  // obavezno polje

    // IND transfer → default vozilo Car (ako nije eksplicitno postavljeno u excelu)
    if (obj.arr_transfer_alias === 'IND' && !obj.arr_vehicle_type) obj.arr_vehicle_type = 'Car'
    if (obj.dep_transfer_alias === 'IND' && !obj.dep_vehicle_type) obj.dep_vehicle_type = 'Car'

    records.push(obj)
  }

  return records
}
