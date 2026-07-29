/**
 * passengerNamesParser.js
 * Parsira mali Excel fajl sa svim imenima putnika po rezervaciji.
 *
 * Ovo je REZULTAT sql server skripte "sqlserver_generate_all_passengers_updates.sql"
 * (copy with headers → nov Excel list → sačuvaj), koja ima kolone:
 *   claim_inc, svi_gosti, update_stmt
 *
 * Ovaj parser čita samo prve dvije (claim_inc, svi_gosti / all_passengers) i
 * ignoriše sve ostalo (npr. update_stmt kolonu, koja se ovim putem uvoza više
 * i ne koristi).
 */
export async function parsePassengerNamesXlsx(buffer) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')

  const wb  = XLSX.read(buffer, { type: 'array' })
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  if (raw.length < 2) throw new Error('Fajl ne sadrži dovoljno podataka.')

  const header = raw[0].map(c => (typeof c === 'string' ? c.trim().toLowerCase() : null))
  const claimIdx = header.findIndex(h => h === 'claim_inc')
  const namesIdx = header.findIndex(h => h === 'svi_gosti' || h === 'all_passengers')

  if (claimIdx === -1 || namesIdx === -1) {
    throw new Error('Fajl mora imati kolone "claim_inc" i "svi_gosti" (tačno kao rezultat SQL Server upita).')
  }

  const records = []
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r]
    if (!row || row.every(v => v === null || v === '')) continue

    const claimRaw = row[claimIdx]
    if (claimRaw === null || claimRaw === '') continue
    const claim_inc = parseInt(claimRaw, 10)
    if (!claim_inc) continue

    const namesRaw = row[namesIdx]
    const all_passengers = typeof namesRaw === 'string' ? namesRaw.trim() : null
    if (!all_passengers) continue

    records.push({ claim_inc, all_passengers })
  }

  return records
}
