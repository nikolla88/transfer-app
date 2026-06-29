// Pure-JS XLSX parser — ne zahtijeva eksterne biblioteke
// Koristi nativni browser DecompressionStream + DOMParser

const IND_TYPES = ['IND', 'CAR', 'V CLASS', 'VCLASS', 'MINIVAN']

/** Konvertuj Excel time (string ili decimala) u minute od ponoći */
export function timeToMin(v) {
  if (v == null || v === '') return -1
  const s = String(v).trim()
  if (s === '') return -1

  // HH:MM format
  if (s.includes(':')) {
    const [h, m] = s.split(':').map(Number)
    if (!isNaN(h) && !isNaN(m)) return h * 60 + m
  }

  // Excel decimal (fraction of day, e.g. 0.4548611 = 10:55)
  const f = parseFloat(s)
  if (!isNaN(f) && f > 0 && f < 1) return Math.round(f * 24 * 60)

  return -1
}

export function minToTime(m) {
  if (m < 0) return '--:--'
  const h = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function detectAirport(flightRow, sheetType) {
  const s = flightRow.toUpperCase()
  if (s.includes('PODGORICA') || s.includes('TGD')) return 'TGD'
  if (s.includes('TIVAT') || s.includes('TIV')) return 'TIV'
  return sheetType === 'arr' ? 'TIV' : 'TIV'
}

export function detectVehicleNeeded(pax, noteUpper, transferType) {
  const tt = (transferType || '').toUpperCase().trim()

  // Transfer Type kolona ima najveći prioritet
  if (tt === 'V CLASS' || tt === 'VCLASS') return 'vclass'
  if (tt === 'MINIVAN') return 'minivan'
  if (tt === 'IND' || tt === 'CAR') return 'car'  // eksplicitno car — ne gledaj dalje

  // Provjeri napomenu samo ako Transfer Type nije eksplicitan
  if (noteUpper.includes('V CLASS') || noteUpper.includes('V-CLASS') || noteUpper.includes('VCLASS')) return 'vclass'
  if (noteUpper.includes('MINIVAN') || noteUpper.includes('VAN')) return 'minivan'

  // Broj putnika — tek kao zadnji kriterij
  if (pax > 6) return 'minivan'

  return 'car'
}

/** Učitaj XLSX fajl i vrati transfere */
export async function parseXlsx(file, hotelZoneMap) {
  const buf = await file.arrayBuffer()
  const zip = await unzipBuffer(buf)

  const sharedStrings = parseSharedStrings(zip['xl/sharedStrings.xml'] || '')
  const workbook = parseWorkbook(zip['xl/workbook.xml'] || '')

  const transfers = []

  for (const sheet of workbook) {
    const sheetType = sheet.name.toLowerCase().startsWith('arr') ? 'arr' : 'dep'
    const xmlContent = zip[`xl/worksheets/${sheet.file}`] || ''
    const rows = parseSheetRows(xmlContent, sharedStrings)
    parseRows(rows, sheetType, hotelZoneMap, transfers)
  }

  return transfers
}

function parseRows(rows, sheetType, hotelZoneMap, out) {
  let airport = 'TIV'
  let headerSeen = false
  let colMap = {}

  for (const row of rows) {
    const f = row[0]
    if (f == null || String(f).trim() === '') { headerSeen = false; continue }
    const fs = String(f).trim()

    if (fs.toLowerCase().startsWith('flight ') || fs.toLowerCase().startsWith('departure report') || fs.toLowerCase().startsWith('arrival report')) {
      if (fs.toLowerCase().startsWith('flight ')) airport = detectAirport(fs, sheetType)
      headerSeen = false
      continue
    }

    if (fs === 'Reservation') {
      colMap = {}
      row.forEach((v, i) => { if (v != null) colMap[String(v).trim()] = i })
      headerSeen = true
      continue
    }

    if (!headerSeen) continue

    const g = (name, fallback) => row[colMap[name] ?? fallback] ?? null

    const ttype = String(g('Transfer Type', sheetType === 'arr' ? 13 : 11) || '').trim().toUpperCase()
    if (!IND_TYPES.includes(ttype)) continue

    const adl = parseInt(g('ADL', 2)) || 0
    const chd = parseInt(g('CHD', 3)) || 0
    // INF kolona ne postoji u svim sheet-ovima — koristi samo ako je u headeru
    const inf = colMap['INF'] !== undefined ? (parseInt(row[colMap['INF']]) || 0) : 0
    const pax = Math.max(adl + chd + inf, 1)

    const noteRaw = String(g('Operation note', sheetType === 'arr' ? 14 : 12) || '')
    const note = noteRaw.toUpperCase()
    const vehicleNeeded = detectVehicleNeeded(pax, note, ttype)

    if (sheetType === 'arr') {
      const flightMin = timeToMin(g('Flight Time', 7))
      if (flightMin < 0) continue

      const hotelName = String(g('Hotel', 11) || '').trim()
      const zone = hotelZoneMap?.[hotelName.toUpperCase()] || null

      out.push({
        reservation_id:    String(g('Reservation', 0) || fs).trim(),
        tourist:           String(g('Tourist', 1) || '').trim(),
        pax, adl, chd, inf,
        hotel_name:        hotelName,
        zone_name:         zone,
        airport,
        type:              'arr',
        flight_number:     String(g('Arr Flight', 6) || '').trim(),
        flight_time:       minToTime(flightMin),
        pickup_time:       minToTime(flightMin), // slijetanje — scheduler dodaje buffer interno
        vehicle_needed:    vehicleNeeded,
        transfer_type_raw: ttype,
        note:              noteRaw,
        status:            'pending',
        assignedVehicle:   null,
      })
    } else {
      const pickupMin = timeToMin(g('Pickup Time', 10))
      if (pickupMin < 0) continue

      const hotelName = String(g('Hotel', 9) || '').trim()
      const zone = hotelZoneMap?.[hotelName.toUpperCase()] || null
      const flightMin = timeToMin(g('Flight Time', 8))

      out.push({
        reservation_id:    String(g('Reservation', 0) || fs).trim(),
        tourist:           String(g('Tourist', 1) || '').trim(),
        pax, adl, chd, inf: 0,
        hotel_name:        hotelName,
        zone_name:         zone,
        airport,
        type:              'dep',
        flight_number:     String(g('Dep Flight', 7) || '').trim(),
        flight_time:       minToTime(flightMin),
        pickup_time:       minToTime(pickupMin),
        vehicle_needed:    vehicleNeeded,
        transfer_type_raw: ttype,
        note:              noteRaw,
        status:            'pending',
        assignedVehicle:   null,
      })
    }
  }
}

// ── ZIP / XML helpers ─────────────────────────────────────────

async function unzipBuffer(buf) {
  const files = {}
  const view = new DataView(buf)
  let pos = 0

  while (pos < buf.byteLength - 4) {
    if (view.getUint32(pos, true) !== 0x04034b50) { pos++; continue }
    const flags     = view.getUint16(pos + 6, true)
    const method    = view.getUint16(pos + 8, true)
    const compSize  = view.getUint32(pos + 18, true)
    const nameLen   = view.getUint16(pos + 26, true)
    const extraLen  = view.getUint16(pos + 28, true)
    const name      = new TextDecoder().decode(new Uint8Array(buf, pos + 30, nameLen))
    const dataStart = pos + 30 + nameLen + extraLen

    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const compressed = new Uint8Array(buf, dataStart, compSize)
      if (method === 8) {
        try {
          const ds = new DecompressionStream('deflate-raw')
          const writer = ds.writable.getWriter()
          writer.write(compressed); writer.close()
          const chunks = []
          const reader = ds.readable.getReader()
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            chunks.push(value)
          }
          const total = chunks.reduce((s, c) => s + c.length, 0)
          const out = new Uint8Array(total)
          let offset = 0
          for (const c of chunks) { out.set(c, offset); offset += c.length }
          files[name] = new TextDecoder('utf-8').decode(out)
        } catch {}
      } else if (method === 0) {
        files[name] = new TextDecoder('utf-8').decode(new Uint8Array(buf, dataStart, compSize))
      }
    }
    pos = dataStart + compSize
  }
  return files
}

function parseSharedStrings(xml) {
  if (!xml) return []
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  return Array.from(doc.querySelectorAll('si')).map(si =>
    Array.from(si.querySelectorAll('t')).map(t => t.textContent).join('')
  )
}

function parseWorkbook(xml) {
  if (!xml) return []
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  return Array.from(doc.querySelectorAll('sheet')).map(s => ({
    name: s.getAttribute('name') || '',
    file: `sheet${Array.from(doc.querySelectorAll('sheet')).indexOf(s) + 1}.xml`,
  }))
}

function parseSheetRows(xml, ss) {
  if (!xml) return []
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  return Array.from(doc.querySelectorAll('row')).map(row =>
    Array.from(row.querySelectorAll('c')).reduce((arr, c) => {
      const ref  = c.getAttribute('r') || ''
      const col  = ref.replace(/[0-9]/g, '')
      const idx  = col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
      const vEl  = c.querySelector('v')
      const t    = c.getAttribute('t')
      let val    = null
      if (vEl && vEl.textContent) {
        val = t === 's' ? ss[parseInt(vEl.textContent)] : vEl.textContent
      }
      arr[idx] = val
      return arr
    }, [])
  )
}
