import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  getDayName, fmtDate, fmtDateFull, fmtTime,
  nightsBetween, calcPickupTime, findScheduleForDay, groupAndSort, normalize,
} from '../lib/transferUtils'

const tomorrow = () => {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

const TR_COLOR = {
  GRP:      'border-l-blue-500',
  SHA:      'border-l-purple-500',
  IND:      'border-l-amber-500',
  'NO TR-R':'border-l-gray-300',
}
const TR_LABEL = {
  GRP: { text: 'GRP', cls: 'text-blue-600 bg-blue-50' },
  SHA: { text: 'SHA', cls: 'text-purple-600 bg-purple-50' },
  IND: { text: 'IND', cls: 'text-amber-600 bg-amber-50' },
}

// ── Pickup helpers ────────────────────────────────────────────────
function shiftTime(time, minutes) {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  let total = h * 60 + m + minutes
  total = Math.max(0, Math.min(23 * 60 + 59, total))
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
}

export default function ArrivalList() {
  const navigate = useNavigate()
  const [selectedDate,  setSelectedDate]  = useState(tomorrow())
  const [groups,        setGroups]        = useState([])
  const [noTransfer,    setNoTransfer]    = useState([])
  const [loading,       setLoading]       = useState(false)
  const [inlinePickup,  setInlinePickup]  = useState(null) // { id, val }
  const [savingPickup,  setSavingPickup]  = useState(false)
  const [vehicleEdit,   setVehicleEdit]   = useState(null)  // id reda koji se edituje

  useEffect(() => { loadData() }, [selectedDate])

  async function loadData() {
    setLoading(true)
    setGroups([]); setNoTransfer([])

    const { data: records, error } = await supabase
      .from('rooming_list')
      .select('*')
      .eq('date_beg', selectedDate)
      .order('tourist_name')

    if (error || !records?.length) { setLoading(false); return }

    const hotelNames = [...new Set(records.map(r => r.hotel_name).filter(Boolean))]

    const [{ data: schedData }, { data: hotelData }] = await Promise.all([
      supabase.from('flight_schedule').select('flight_number,airport,direction,scheduled_time,days_of_week,aliases'),
      hotelNames.length
        ? supabase.from('hotels').select('name,hotel_code,time_to_tiv,time_to_tgd').in('name', hotelNames)
        : Promise.resolve({ data: [] }),
    ])

    const normMap = {}
    for (const s of (schedData || [])) {
      // Indeksiraj po flight_number
      const norm = normalize(s.flight_number)
      if (!normMap[norm]) normMap[norm] = { canonical: s.flight_number, ARR: [], DEP: [] }
      normMap[norm][s.direction]?.push(s)
      // Indeksiraj i po svakom aliasu
      for (const alias of (s.aliases || [])) {
        const aliasNorm = normalize(alias)
        if (!normMap[aliasNorm]) normMap[aliasNorm] = { canonical: s.flight_number, ARR: [], DEP: [] }
        normMap[aliasNorm][s.direction]?.push(s)
      }
    }

    const hotelMap = Object.fromEntries((hotelData || []).map(h => [h.name, h]))

    const enriched = records.map(r => {
      const arrDayName = getDayName(selectedDate)
      const depDayName = getDayName(r.date_end)

      const arrMatch = normMap[normalize(r.arr_flight_name)]
      const depMatch = normMap[normalize(r.dep_flight_name)]

      const arrCanonical = arrMatch?.canonical || r.arr_flight_name
      const depCanonical = depMatch?.canonical || r.dep_flight_name

      const arrSchedule = findScheduleForDay(arrMatch?.ARR || [], arrDayName)
      const depSchedule = findScheduleForDay(depMatch?.DEP || [], depDayName)

      const hotel = hotelMap[r.hotel_name]
      let pickupTime = r.dep_pick_time || null  // manual override ima prednost
      if (!pickupTime && depSchedule && hotel) {
        const mins = depSchedule.airport === 'TIV' ? hotel.time_to_tiv : hotel.time_to_tgd
        pickupTime = calcPickupTime(depSchedule.scheduled_time, mins)
      }

      return {
        ...r,
        _arrCanonical: arrCanonical,
        _depCanonical: depCanonical,
        _arrSchedule: arrSchedule,
        _depSchedule: depSchedule,
        _schedule: arrSchedule,   // groupAndSort koristi _schedule za header
        _pickupTime: pickupTime,
        _nights: nightsBetween(r.date_beg, r.date_end),
        _hotelCode: hotel?.hotel_code ?? 9999,
      }
    })

    // Sort: 1. GRP → SHA → IND  2. hotel_code ASC
    const TR_ORDER = { GRP: 0, SHA: 1, IND: 2 }
    const arrSortFn = (recs) => [...recs].sort((a, b) => {
      const oa = TR_ORDER[a.arr_transfer_alias] ?? 50
      const ob = TR_ORDER[b.arr_transfer_alias] ?? 50
      if (oa !== ob) return oa - ob
      return a._hotelCode - b._hotelCode
    })

    const { groups: g, noTransfer: nt } = groupAndSort(enriched, '_arrCanonical', 'arr_transfer_alias', arrSortFn)
    setGroups(g)
    setNoTransfer(nt)
    setLoading(false)
  }

  const totalPax = (arr) => arr.reduce((s, r) => s + (r.adult || 0) + (r.child || 0) + (r.infant || 0), 0)
  const total    = groups.reduce((s, g) => s + g.records.length, 0) + noTransfer.length

  // ── Pickup inline edit ────────────────────────────────────────
  function startPickup(r) {
    setInlinePickup({ id: r.id, val: r._pickupTime || '' })
  }

  async function savePickup() {
    if (!inlinePickup || savingPickup) return
    setSavingPickup(true)
    const { id, val } = inlinePickup
    const newTime = val.trim() || null
    await supabase.from('rooming_list').update({ dep_pick_time: newTime }).eq('id', id)
    const patch = r => r.id === id ? { ...r, _pickupTime: newTime, dep_pick_time: newTime } : r
    setGroups(prev => prev.map(g => ({ ...g, records: g.records.map(patch) })))
    setNoTransfer(prev => prev.map(patch))
    setInlinePickup(null)
    setSavingPickup(false)
  }

  // ── Vehicle type inline edit ──────────────────────────────────
  const VEH_OPTIONS = ['Car', 'Car Comfort', 'Minivan', 'V-Class']
  const VEH_CLS = {
    'Car':     'bg-blue-500 text-white',
    'Minivan': 'bg-green-500 text-white',
    'V-Class': 'bg-purple-500 text-white',
  }
  const VEH_IDLE = {
    'Car':     'bg-blue-50 text-blue-700',
    'Minivan': 'bg-green-50 text-green-700',
    'V-Class': 'bg-purple-50 text-purple-700',
  }

  async function saveVehicle(id, vehicleType) {
    await supabase.from('rooming_list').update({ arr_vehicle_type: vehicleType || null }).eq('id', id)
    const patch = r => r.id === id ? { ...r, arr_vehicle_type: vehicleType || null } : r
    setGroups(prev => prev.map(g => ({ ...g, records: g.records.map(patch) })))
    setNoTransfer(prev => prev.map(patch))
    setVehicleEdit(null)
  }

  // ── Lista telefona (print forma za aerodrom) ─────────────────
  function openPhoneList(flight, schedule, records) {
    const dateStr  = fmtDateFull(selectedDate)
    const flightHdr = [
      flight,
      schedule ? fmtTime(schedule.scheduled_time) : '',
      schedule?.airport || '',
    ].filter(Boolean).join(' · ')
    const pax = r => (r.adult || 0) + (r.child || 0) + (r.infant || 0)

    const rows = records.map((r, i) => `
      <tr class="${i % 2 === 0 ? '' : 'alt'}">
        <td class="br">${r.claim_inc || ''}</td>
        <td class="ime">${r.tourist_name || ''}</td>
        <td class="pax">${pax(r)}</td>
        <td class="hotel">${r.hotel_name || ''}</td>
        <td class="tel"></td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="hr"><head><meta charset="utf-8">
<title>Telefoni · ${flightHdr}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;padding:12mm 14mm}
  .hdr{margin-bottom:6mm}
  .hdr h1{font-size:13pt;font-weight:bold}
  .hdr p{font-size:9pt;color:#555;margin-top:2mm}
  table{width:100%;border-collapse:collapse;margin-top:3mm}
  thead th{font-size:8pt;font-weight:bold;text-transform:uppercase;letter-spacing:.04em;
           padding:3px 5px 5px;border-top:2px solid #000;border-bottom:1px solid #000;white-space:nowrap}
  tbody tr{height:28px}
  tbody tr.alt{background:#f5f5f5}
  tbody td{font-size:10.5pt;padding:1px 5px;border-bottom:1px solid #d8d8d8;vertical-align:middle}
  .br   {width:82px;font-family:monospace;font-size:9.5pt}
  .ime  {width:175px;font-weight:500}
  .pax  {width:32px;text-align:center}
  .hotel{width:165px}
  .tel  {border-bottom:1.5px solid #000 !important}
  @media print{
    @page{size:A4 portrait;margin:12mm 14mm}
    body{padding:0}
    tbody tr.alt{background:#f5f5f5 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style></head><body>
<div class="hdr">
  <h1>&#128222; Lista telefona &nbsp;&middot;&nbsp; ${flightHdr}</h1>
  <p>${dateStr} &nbsp;&middot;&nbsp; ${records.length} gostiju</p>
</div>
<table>
  <thead><tr>
    <th class="br">Br. rezervacije</th>
    <th class="ime">Ime gostiju</th>
    <th class="pax">Pax</th>
    <th class="hotel">Hotel</th>
    <th class="tel">Broj telefona</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`

    const win = window.open('', '_blank', 'width=820,height=700')
    win.document.write(html)
    win.document.close()
    win.focus()
  }

  // ── Bulk pomak svih pickup-a u jednom letu ────────────────────
  async function shiftFlight(flightRecords, deltaMin) {
    const updates = flightRecords
      .filter(r => r._pickupTime)
      .map(r => ({ id: r.id, newTime: shiftTime(r._pickupTime, deltaMin) }))
    if (!updates.length) return
    await Promise.all(updates.map(u =>
      supabase.from('rooming_list').update({ dep_pick_time: u.newTime }).eq('id', u.id)
    ))
    const idMap = Object.fromEntries(updates.map(u => [u.id, u.newTime]))
    const patch = r => idMap[r.id] != null ? { ...r, _pickupTime: idMap[r.id], dep_pick_time: idMap[r.id] } : r
    setGroups(prev => prev.map(g => ({ ...g, records: g.records.map(patch) })))
  }

  // ── Excel export ─────────────────────────────────────────────
  async function exportToExcel() {
    // xlsx-js-style = SheetJS fork s podrškom za cell styles (border, bold)
    // Eksportuje kao window.XLSX (drop-in za SheetJS), kešira u window.__xlsxStyle
    const XLSXStyle = await new Promise((resolve, reject) => {
      if (window.__xlsxStyle) return resolve(window.__xlsxStyle)
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js'
      s.onload = () => {
        const lib = window.XLSXStyle ?? window.XLSX
        if (lib?.utils) { window.__xlsxStyle = lib; resolve(lib) }
        else reject(new Error('xlsx-js-style: library not found after load'))
      }
      s.onerror = reject
      document.head.appendChild(s)
    })

    const THIN   = { style: 'thin', color: { rgb: '000000' } }
    const BORDER = { border: { top: THIN, bottom: THIN, left: THIN, right: THIN } }
    const NCOLS  = 15
    const ALPHA  = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O']

    const ws = {}
    const rowHeights = []
    let rowNum = 1

    // Postavi ćeliju
    function sc(c, row, v, s = {}, t = 's') { ws[`${ALPHA[c]}${row}`] = { v, t, s } }
    // Postavi formulu
    function sf(c, row, f) { ws[`${ALPHA[c]}${row}`] = { f, t: 'n', s: {} } }

    // Dodaj sekciju: header (bold) + data (border) + SUM (C,D,E)
    function addSection(recs, headerText) {
      sc(0, rowNum, headerText, { font: { bold: true } })
      for (let c = 1; c < NCOLS; c++) sc(c, rowNum, '', {})
      rowHeights[rowNum - 1] = { hpx: 19 }
      rowNum++

      const first = rowNum
      for (const rec of recs) {
        sc(0,  rowNum, rec.claim_inc || '',                            BORDER)
        sc(1,  rowNum, rec.tourist_name || '',                         BORDER)
        sc(2,  rowNum, rec.adult  ?? 0,                                BORDER, 'n')
        sc(3,  rowNum, rec.child  ?? 0,                                BORDER, 'n')
        sc(4,  rowNum, rec.infant ?? 0,                                BORDER, 'n')
        sc(5,  rowNum, fmtDate(rec.date_beg) || '',                    BORDER)
        sc(6,  rowNum, typeof rec._nights === 'number' ? rec._nights : '', BORDER)
        sc(7,  rowNum, fmtDate(rec.date_end) || '',                    BORDER)
        sc(8,  rowNum, rec._depCanonical || rec.dep_flight_name || '', BORDER)
        sc(9,  rowNum, rec.hotel_name || '',                           BORDER)
        sc(10, rowNum, rec.partner_alias || '',                        BORDER)
        sc(11, rowNum, rec.arr_transfer_alias || '',                   BORDER)
        sc(12, rowNum, rec.arr_vehicle_type || '',                     BORDER)
        sc(13, rowNum, rec._pickupTime || '',                          BORDER)
        sc(14, rowNum, rec.claim_oper_note || '',                      BORDER)
        rowNum++
      }
      const last = rowNum - 1
      if (first === last) {
        sf(2, rowNum, `SUM(C${first})`); sf(3, rowNum, `SUM(D${first})`); sf(4, rowNum, `SUM(E${first})`)
      } else {
        sf(2, rowNum, `SUM(C${first}:C${last})`); sf(3, rowNum, `SUM(D${first}:D${last})`); sf(4, rowNum, `SUM(E${first}:E${last})`)
      }
      rowNum++
    }

    // Naslov
    sc(0, rowNum, `TRANSFER LISTA — DOLAZAK · ${fmtDateFull(selectedDate)}`); rowNum++
    rowNum++ // prazan red
    // Zaglavlje kolona
    ;['#','Gost','A','C','I','Ch.in','N','Ch.out','Let odl.','Hotel','Partner','Tr.','Vozilo','Pickup odl.','Napomena']
      .forEach((h, c) => sc(c, rowNum, h))
    rowNum++

    for (const { flight, schedule, records } of groups) {
      const hdr = [flight, schedule ? fmtTime(schedule.scheduled_time) : '', schedule?.airport || '']
        .filter(Boolean).join(' ')
      addSection(records, hdr)
    }
    if (noTransfer.length) addSection(noTransfer, 'BEZ TRANSFERA')

    ws['!ref']  = `A1:${ALPHA[NCOLS - 1]}${rowNum - 1}`
    ws['!cols'] = [
      { wch: 9.33 }, { wch: 22.16 }, { wch: 3.0 },  { wch: 2.83 }, { wch: 2.33 },
      { wch: 6.16 }, { wch: 3.83 },  { wch: 6.0 },  { wch: 7.16 }, { wch: 23.66 },
      { wch: 11.16 },{ wch: 4.83 },  { wch: 5.16 }, { wch: 5.83 }, { wch: 21.66 },
    ]
    ws['!rows'] = rowHeights

    const wb = XLSXStyle.utils.book_new()
    XLSXStyle.utils.book_append_sheet(wb, ws, 'Dolazak')
    const out  = XLSXStyle.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `dolazak_${selectedDate}.xlsx`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  // ── Kompaktna tabela ──────────────────────────────────────────
  // Kolone: # | Gost | A C I | Ch.in | Noći | Ch.out | Let odl. | Hotel | Partner | Vozilo | Pickup | Napomena
  // Arr flight + vrijme su u group headeru → ne trebaju u redu
  // Fiksna širina tabele = zbir svih kolona (da sve grupe budu iste širine)
  const ARR_COL_W = { num: 68, gost: 160, a: 22, c: 22, i: 22, chin: 62, n: 32, chout: 62, letOdl: 60, hotel: 300, partner: 84, tr: 48, vozilo: 56, pickup: 72, nap: 200 }
  const ARR_TABLE_W = Object.values(ARR_COL_W).reduce((s, w) => s + w, 0) // 1270px

  function Table({ records }) {
    return (
      <table style={{ tableLayout: 'fixed', width: ARR_TABLE_W }} className="text-[11px]">
        <colgroup>
          <col style={{ width: ARR_COL_W.num     }} />
          <col style={{ width: ARR_COL_W.gost    }} />
          <col style={{ width: ARR_COL_W.a       }} />
          <col style={{ width: ARR_COL_W.c       }} />
          <col style={{ width: ARR_COL_W.i       }} />
          <col style={{ width: ARR_COL_W.chin    }} />
          <col style={{ width: ARR_COL_W.n       }} />
          <col style={{ width: ARR_COL_W.chout   }} />
          <col style={{ width: ARR_COL_W.letOdl  }} />
          <col style={{ width: ARR_COL_W.hotel   }} />
          <col style={{ width: ARR_COL_W.partner }} />
          <col style={{ width: ARR_COL_W.tr      }} />
          <col style={{ width: ARR_COL_W.vozilo  }} />
          <col style={{ width: ARR_COL_W.pickup  }} />
          <col style={{ width: ARR_COL_W.nap     }} />
        </colgroup>
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-500">
            <th className="px-1.5 py-1 text-left font-semibold">#</th>
            <th className="px-1.5 py-1 text-left font-semibold">Gost</th>
            <th className="px-1 py-1 text-center font-semibold">A</th>
            <th className="px-1 py-1 text-center font-semibold">C</th>
            <th className="px-1 py-1 text-center font-semibold">I</th>
            <th className="px-1.5 py-1 text-center font-semibold">Ch.in</th>
            <th className="px-1 py-1 text-center font-semibold">N</th>
            <th className="px-1.5 py-1 text-center font-semibold">Ch.out</th>
            <th className="px-1.5 py-1 text-left font-semibold">Let odl.</th>
            <th className="px-1.5 py-1 text-left font-semibold">Hotel</th>
            <th className="px-1.5 py-1 text-left font-semibold">Partner</th>
            <th className="px-1.5 py-1 text-center font-semibold">Tr.</th>
            <th className="px-1.5 py-1 text-left font-semibold">Vozilo</th>
            <th className="px-1.5 py-1 text-center font-semibold">Pickup odl.</th>
            <th className="px-1.5 py-1 text-left font-semibold">Napomena</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => {
            const tr    = r.arr_transfer_alias
            const lbCls = TR_COLOR[tr] || 'border-l-gray-200'
            const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'
            return (
              <tr key={r.id}
                className={`border-b border-gray-100 border-l-[3px] ${lbCls} ${rowBg} hover:bg-sky-50/40 transition-colors`}>
                <td className="px-1.5 py-0.5 font-mono text-[10px] truncate">
                  <span onClick={() => navigate(`/rooming?search=${r.claim_inc}`)}
                    className="text-sky-600 cursor-pointer hover:underline hover:text-sky-800" title="Otvori u Rooming Listi">
                    {r.claim_inc}
                  </span>
                </td>
                <td className="px-1.5 py-0.5 font-medium text-gray-800 truncate" title={r.tourist_name}>
                  {r.tourist_name}
                </td>
                <td className="px-1 py-0.5 text-center font-medium text-gray-700">{r.adult || ''}</td>
                <td className="px-1 py-0.5 text-center text-gray-500">{r.child || ''}</td>
                <td className="px-1 py-0.5 text-center text-gray-400">{r.infant || ''}</td>
                <td className="px-1.5 py-0.5 text-center text-gray-600">{fmtDate(r.date_beg)}</td>
                <td className="px-1 py-0.5 text-center font-bold text-purple-600">
                  {r._nights !== '—' ? r._nights : ''}
                </td>
                <td className="px-1.5 py-0.5 text-center text-gray-600">{fmtDate(r.date_end)}</td>
                <td className="px-1.5 py-0.5 font-mono text-orange-600 font-semibold truncate">
                  {r._depCanonical || r.dep_flight_name || <span className="text-gray-300">—</span>}
                </td>
                <td className="px-1.5 py-0.5 text-gray-700 truncate" title={r.hotel_name}>{r.hotel_name || ''}</td>
                <td className="px-1.5 py-0.5 text-gray-500 truncate" title={r.partner_alias}>{r.partner_alias || ''}</td>
                <td className="px-1.5 py-0.5 text-center">
                  {TR_LABEL[tr]
                    ? <span className={`px-1 py-px rounded text-[9px] font-bold ${TR_LABEL[tr].cls}`}>{TR_LABEL[tr].text}</span>
                    : <span className="text-gray-300">—</span>
                  }
                </td>
                <td className="px-1 py-0.5 relative">
                  {(tr === 'IND' || tr === 'GRP') ? (
                    <>
                      <span onClick={() => setVehicleEdit(vehicleEdit === r.id ? null : r.id)}
                        title="Klikni za izmjenu vozila"
                        className={`cursor-pointer px-1.5 py-px rounded text-[9px] font-bold transition-colors ${r.arr_vehicle_type ? VEH_IDLE[r.arr_vehicle_type] || 'bg-gray-100 text-gray-600' : 'text-gray-200 hover:text-gray-400'}`}>
                        {r.arr_vehicle_type || '—'}
                      </span>
                      {vehicleEdit === r.id && (
                        <div className="fixed z-50 flex gap-0.5 bg-white border border-gray-200 rounded shadow-lg px-1.5 py-1"
                          style={{ top: 'var(--veh-y)', left: 'var(--veh-x)' }}
                          ref={el => {
                            if (el) {
                              const span = el.previousSibling
                              if (span) {
                                const rect = span.getBoundingClientRect()
                                el.style.setProperty('--veh-y', rect.bottom + 2 + 'px')
                                el.style.setProperty('--veh-x', rect.left + 'px')
                                el.style.top = (rect.bottom + 2) + 'px'
                                el.style.left = rect.left + 'px'
                              }
                            }
                          }}>
                          {VEH_OPTIONS.map(v => (
                            <button key={v} onClick={() => { saveVehicle(r.id, v); setVehicleEdit(null) }}
                              className={`px-1.5 py-px rounded text-[9px] font-bold border transition-colors ${r.arr_vehicle_type === v ? VEH_CLS[v] + ' border-transparent' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}>
                              {v === 'V-Class' ? 'VCL' : v === 'Minivan' ? 'MNV' : 'CAR'}
                            </button>
                          ))}
                          <button
                            onClick={() => { saveVehicle(r.id, null); setVehicleEdit(null) }}
                            title="Ukloni vozilo"
                            className="px-1.5 py-px text-[9px] font-bold text-red-400 border border-red-200 rounded hover:bg-red-50 ml-0.5">
                            ✕
                          </button>
                        </div>
                      )}
                    </>
                  ) : ''}
                </td>
                <td className="px-1 py-0.5 text-center">
                  {inlinePickup?.id === r.id ? (
                    <input
                      autoFocus
                      type="text"
                      placeholder="HH:MM"
                      value={inlinePickup.val}
                      onChange={e => setInlinePickup(p => ({ ...p, val: e.target.value }))}
                      onBlur={savePickup}
                      onKeyDown={e => { if (e.key === 'Enter') savePickup(); if (e.key === 'Escape') setInlinePickup(null) }}
                      className="w-14 text-center font-mono text-xs border border-sky-400 rounded px-1 py-0.5 outline-none ring-1 ring-sky-300"
                    />
                  ) : (
                    <span
                      onClick={() => startPickup(r)}
                      title="Klikni za izmjenu pickup vremena"
                      className={`font-mono font-bold tabular-nums cursor-pointer px-1 py-0.5 rounded hover:bg-yellow-50 hover:text-yellow-700 transition-colors ${r._pickupTime ? 'text-red-600' : 'text-gray-200'}`}
                    >
                      {r._pickupTime || '—'}
                    </span>
                  )}
                </td>
                <td className="px-1.5 py-0.5 text-gray-400 truncate text-[10px]" title={r.claim_oper_note}>{r.claim_oper_note || ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50">

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div className="px-5 py-2.5 border-b bg-white flex-shrink-0 flex items-center gap-3 no-print shadow-sm">
        <span className="text-sm font-bold text-gray-700">🛬 Dolazak</span>
        <input type="date" className="input text-sm w-38 h-8 cursor-pointer" value={selectedDate}
          onClick={e => e.target.showPicker?.()}
          onChange={e => setSelectedDate(e.target.value)} />
        <span className="text-xs text-gray-400 ml-1">
          {loading ? '⏳' : `${total} gostiju`}
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={loadData}
            className="px-2.5 py-1.5 rounded text-xs border border-gray-300 hover:bg-gray-50 text-gray-600">
            ↻ Osvježi
          </button>
          <button onClick={exportToExcel}
            className="px-2.5 py-1.5 rounded text-xs border border-gray-300 hover:bg-gray-50 text-gray-600">
            📥 Excel
          </button>
          <button onClick={() => window.print()}
            className="px-2.5 py-1.5 rounded text-xs border border-gray-300 hover:bg-gray-50 text-gray-600">
            🖨 Štampaj
          </button>
        </div>
      </div>

      {/* Print header */}
      <div className="print-only px-5 py-2 text-sm font-bold">
        TRANSFER LISTA — DOLAZAK · {fmtDateFull(selectedDate)} &nbsp;·&nbsp; {total} gostiju
      </div>

      {/* Legenda */}
      <div className="px-5 pt-2 flex items-center gap-4 text-[10px] text-gray-500 no-print">
        <span className="flex items-center gap-1"><span className="w-2.5 h-4 rounded-sm bg-blue-500 inline-block"></span> GRP — grupni</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-4 rounded-sm bg-purple-500 inline-block"></span> SHA — dijeljeni</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-4 rounded-sm bg-amber-500 inline-block"></span> IND — individualni</span>
        <span className="ml-4 text-gray-400">· Kolona <strong>N</strong> = broj noćenja · <strong>Pickup odl.</strong> = datum i vrijme polaska na aerodrom</span>
      </div>

      {/* ── Sadržaj ─────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 py-2">

        {!loading && groups.length === 0 && noTransfer.length === 0 && (
          <div className="text-center text-gray-400 py-20">
            <div className="text-5xl mb-3">🛬</div>
            <p className="text-sm">Nema dolaznih transfera za {fmtDateFull(selectedDate)}</p>
          </div>
        )}

        {/* Grupe po dolaznom letu */}
        {groups.map(({ flight, schedule, records }) => (
          <div key={flight} className="mb-4 rounded overflow-hidden border border-sky-200 shadow-sm flight-group">
            <div className="flex items-center gap-2 bg-sky-800 text-white px-3 py-1.5">
              <span className="font-mono font-bold">{flight}</span>
              {schedule && (
                <>
                  <span className="text-sky-400">·</span>
                  <span className="font-mono text-amber-300 font-bold text-sm">{fmtTime(schedule.scheduled_time)}</span>
                  <span className="text-[11px] bg-white/10 px-1.5 py-px rounded font-medium">{schedule.airport}</span>
                </>
              )}
              {/* Bulk pickup pomak + lista telefona — skriva se pri štampanju */}
              <div className="flex items-center gap-0.5 ml-3 border-l border-sky-600 pl-3 no-print">
                <span className="text-[9px] text-sky-300 mr-1">pickup:</span>
                {[-15,-10,-5,5,10,15].map(m => (
                  <button key={m} onClick={() => shiftFlight(records, m)}
                    className="text-[9px] font-mono px-1 py-px rounded bg-white/10 hover:bg-white/30 text-white transition-colors"
                    title={`Pomjeri sve pickup-e za ${m > 0 ? '+' : ''}${m} min`}>
                    {m > 0 ? '+' : ''}{m}
                  </button>
                ))}
                <button
                  onClick={() => openPhoneList(flight, schedule, records)}
                  className="ml-2 text-[9px] font-medium px-2 py-px rounded bg-white/15 hover:bg-white/30 text-white border border-white/20 transition-colors"
                  title="Otvori formu za upis brojeva telefona">
                  📞 Telefoni
                </button>
              </div>
              <span className="ml-auto text-[11px] text-sky-200 tabular-nums">
                {records.length} gostiju · {totalPax(records)} pax
              </span>
            </div>
            <Table records={records} />
          </div>
        ))}

        {/* NO TR-R */}
        {noTransfer.length > 0 && (
          <div className="mb-4 rounded overflow-hidden border border-gray-200 shadow-sm flight-group">
            <div className="flex items-center gap-3 bg-gray-500 text-white px-3 py-1.5">
              <span className="font-semibold text-sm">BEZ TRANSFERA (NO TR-R)</span>
              <span className="ml-auto text-[11px] text-gray-200">{noTransfer.length} gostiju · {totalPax(noTransfer)} pax</span>
            </div>
            <Table records={noTransfer} />
          </div>
        )}

        <div className="h-4" />
      </div>

    </div>
  )
}
