import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  getDayName, fmtDate, fmtDateFull, fmtTime,
  calcPickupTime, findScheduleForDay, groupAndSort, normalize,
} from '../lib/transferUtils'

const tomorrow = () => {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Širine kolona u pikselima
const COLS = [
  { label: '#',         w: 68  },
  { label: 'Gost',      w: 160 },
  { label: 'A',         w: 22  },
  { label: 'C',         w: 22  },
  { label: 'I',         w: 22  },
  { label: 'Ch.in',     w: 48  },
  { label: 'Let dol.',  w: 60  },
  { label: 'Hotel',     w: null }, // flex
  { label: 'Partner',   w: 84  },
  { label: 'Vozilo',    w: 56  },
  { label: 'Pickup',    w: 56  },
  { label: 'Napomena',  w: 220 },
]
const FIXED_W = COLS.filter(c => c.w).reduce((s, c) => s + c.w, 0) // all except flex Hotel

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

export default function DepartureList() {
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
      .eq('date_end', selectedDate)
      .order('tourist_name')

    if (error || !records?.length) { setLoading(false); return }

    const hotelNames = [...new Set(records.map(r => r.hotel_name).filter(Boolean))]

    const [{ data: schedData }, { data: hotelData }] = await Promise.all([
      supabase.from('flight_schedule').select('flight_number,airport,direction,scheduled_time,days_of_week,aliases').eq('direction', 'DEP'),
      hotelNames.length
        ? supabase.from('hotels').select('name,hotel_code,time_to_tiv,time_to_tgd').in('name', hotelNames)
        : Promise.resolve({ data: [] }),
    ])

    const normMap = {}
    for (const s of (schedData || [])) {
      const norm = normalize(s.flight_number)
      if (!normMap[norm]) normMap[norm] = { canonical: s.flight_number, schedules: [] }
      normMap[norm].schedules.push(s)
      for (const alias of (s.aliases || [])) {
        const aliasNorm = normalize(alias)
        if (!normMap[aliasNorm]) normMap[aliasNorm] = { canonical: s.flight_number, schedules: [] }
        normMap[aliasNorm].schedules.push(s)
      }
    }

    const hotelMap = Object.fromEntries((hotelData || []).map(h => [h.name, h]))
    const dayName  = getDayName(selectedDate)

    const enriched = records.map(r => {
      const norm      = normalize(r.dep_flight_name)
      const match     = normMap[norm]
      const canonical = match?.canonical || r.dep_flight_name
      const schedule  = findScheduleForDay(match?.schedules || [], dayName)
      const hotel     = hotelMap[r.hotel_name]
      let pickupTime  = r.dep_pick_time || null  // manual override ima prednost
      if (!pickupTime && schedule && hotel) {
        const mins = schedule.airport === 'TIV' ? hotel.time_to_tiv : hotel.time_to_tgd
        pickupTime = calcPickupTime(schedule.scheduled_time, mins)
      }
      return { ...r, _canonical: canonical, _schedule: schedule, _pickupTime: pickupTime, _hotelCode: hotel?.hotel_code ?? 9999 }
    })

    // Sort: 1. GRP → SHA → IND  2. pickup_time  3. hotel_code
    const TR_ORDER = { GRP: 0, SHA: 1, IND: 2 }
    const depSortFn = (recs) => [...recs].sort((a, b) => {
      const oa = TR_ORDER[a.dep_transfer_alias] ?? 50
      const ob = TR_ORDER[b.dep_transfer_alias] ?? 50
      if (oa !== ob) return oa - ob
      const pa = a._pickupTime || '99:99'
      const pb = b._pickupTime || '99:99'
      if (pa !== pb) return pa.localeCompare(pb)
      return a._hotelCode - b._hotelCode
    })

    const { groups: g, noTransfer: nt } = groupAndSort(enriched, '_canonical', 'dep_transfer_alias', depSortFn)
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
  const VEH_OPTIONS = ['Car', 'Minivan', 'V-Class']
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
    await supabase.from('rooming_list').update({ dep_vehicle_type: vehicleType }).eq('id', id)
    const patch = r => r.id === id ? { ...r, dep_vehicle_type: vehicleType } : r
    setGroups(prev => prev.map(g => ({ ...g, records: g.records.map(patch) })))
    setNoTransfer(prev => prev.map(patch))
    setVehicleEdit(null)
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
    const NCOLS  = 13
    const ALPHA  = ['A','B','C','D','E','F','G','H','I','J','K','L','M']

    const ws = {}
    const rowHeights = []
    let rowNum = 1

    function sc(c, row, v, s = {}, t = 's') { ws[`${ALPHA[c]}${row}`] = { v, t, s } }
    function sf(c, row, f) { ws[`${ALPHA[c]}${row}`] = { f, t: 'n', s: {} } }

    function addSection(recs, headerText) {
      sc(0, rowNum, headerText, { font: { bold: true } })
      for (let c = 1; c < NCOLS; c++) sc(c, rowNum, '', {})
      rowHeights[rowNum - 1] = { hpx: 19 }
      rowNum++

      const first = rowNum
      for (const rec of recs) {
        sc(0,  rowNum, rec.claim_inc || '',          BORDER)
        sc(1,  rowNum, rec.tourist_name || '',        BORDER)
        sc(2,  rowNum, rec.adult  ?? 0,               BORDER, 'n')
        sc(3,  rowNum, rec.child  ?? 0,               BORDER, 'n')
        sc(4,  rowNum, rec.infant ?? 0,               BORDER, 'n')
        sc(5,  rowNum, fmtDate(rec.date_beg) || '',   BORDER)
        sc(6,  rowNum, rec.arr_flight_name || '',     BORDER)
        sc(7,  rowNum, rec.hotel_name || '',          BORDER)
        sc(8,  rowNum, rec.partner_alias || '',       BORDER)
        sc(9,  rowNum, rec.dep_transfer_alias || '',  BORDER)
        sc(10, rowNum, rec.dep_vehicle_type || '',    BORDER)
        sc(11, rowNum, rec._pickupTime || '',         BORDER)
        sc(12, rowNum, rec.claim_oper_note || '',     BORDER)
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
    sc(0, rowNum, `TRANSFER LISTA — ODLAZAK · ${fmtDateFull(selectedDate)}`); rowNum++
    rowNum++ // prazan red
    // Zaglavlje kolona
    ;['#','Gost','A','C','I','Ch.in','Let dol.','Hotel','Partner','Tr.','Vozilo','Pickup','Napomena']
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
      { wch: 6.16 }, { wch: 7.16 },  { wch: 23.66 }, { wch: 11.16 },{ wch: 4.83 },
      { wch: 5.16 }, { wch: 5.83 },  { wch: 21.66 },
    ]
    ws['!rows'] = rowHeights

    const wb = XLSXStyle.utils.book_new()
    XLSXStyle.utils.book_append_sheet(wb, ws, 'Odlazak')
    const out  = XLSXStyle.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `odlazak_${selectedDate}.xlsx`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  // Fiksna širina tabele = zbir svih kolona (da sve grupe budu iste širine)
  const DEP_COL_W = { num: 68, gost: 160, a: 22, c: 22, i: 22, chin: 62, letDol: 60, hotel: 300, partner: 84, tr: 48, vozilo: 56, pickup: 56, nap: 220 }
  const DEP_TABLE_W = Object.values(DEP_COL_W).reduce((s, w) => s + w, 0) // 1180px

  // ── Redizajnirana tabela ──────────────────────────────────────
  function Table({ records }) {
    return (
      <table style={{ tableLayout: 'fixed', width: DEP_TABLE_W }} className="text-[11px]">
        <colgroup>
          <col style={{ width: DEP_COL_W.num     }} />  {/* # */}
          <col style={{ width: DEP_COL_W.gost    }} />  {/* Gost */}
          <col style={{ width: DEP_COL_W.a       }} />  {/* A */}
          <col style={{ width: DEP_COL_W.c       }} />  {/* C */}
          <col style={{ width: DEP_COL_W.i       }} />  {/* I */}
          <col style={{ width: DEP_COL_W.chin    }} />  {/* Ch.in */}
          <col style={{ width: DEP_COL_W.letDol  }} />  {/* Let dol. */}
          <col style={{ width: DEP_COL_W.hotel   }} />  {/* Hotel */}
          <col style={{ width: DEP_COL_W.partner }} />  {/* Partner */}
          <col style={{ width: DEP_COL_W.tr      }} />  {/* Tr. */}
          <col style={{ width: DEP_COL_W.vozilo  }} />  {/* Vozilo */}
          <col style={{ width: DEP_COL_W.pickup  }} />  {/* Pickup */}
          <col style={{ width: DEP_COL_W.nap     }} />  {/* Napomena */}
        </colgroup>
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-500">
            <th className="px-1.5 py-1 text-left font-semibold">#</th>
            <th className="px-1.5 py-1 text-left font-semibold">Gost</th>
            <th className="px-1 py-1 text-center font-semibold">A</th>
            <th className="px-1 py-1 text-center font-semibold">C</th>
            <th className="px-1 py-1 text-center font-semibold">I</th>
            <th className="px-1.5 py-1 text-center font-semibold">Ch.in</th>
            <th className="px-1.5 py-1 text-left font-semibold">Let dol.</th>
            <th className="px-1.5 py-1 text-left font-semibold">Hotel</th>
            <th className="px-1.5 py-1 text-left font-semibold">Partner</th>
            <th className="px-1.5 py-1 text-center font-semibold">Tr.</th>
            <th className="px-1.5 py-1 text-left font-semibold">Vozilo</th>
            <th className="px-1.5 py-1 text-center font-semibold">Pickup</th>
            <th className="px-1.5 py-1 text-left font-semibold">Napomena</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => {
            const tr    = r.dep_transfer_alias
            const lbCls = TR_COLOR[tr] || 'border-l-gray-200'
            const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'
            return (
              <tr key={r.id}
                className={`border-b border-gray-100 border-l-[3px] ${lbCls} ${rowBg} hover:bg-blue-50/50 transition-colors`}>
                <td className="px-1.5 py-1 font-mono text-[10px] truncate">
                  <span onClick={() => navigate(`/rooming?search=${r.claim_inc}`)}
                    className="text-sky-600 cursor-pointer hover:underline hover:text-sky-800" title="Otvori u Rooming Listi">
                    {r.claim_inc}
                  </span>
                </td>
                <td className="px-1.5 py-1 font-medium text-gray-800 truncate" title={r.tourist_name}>
                  {r.tourist_name}
                </td>
                <td className="px-1 py-1 text-center font-medium text-gray-700">{r.adult || ''}</td>
                <td className="px-1 py-1 text-center text-gray-500">{r.child || ''}</td>
                <td className="px-1 py-1 text-center text-gray-400">{r.infant || ''}</td>
                <td className="px-1.5 py-1 text-center text-gray-600">{fmtDate(r.date_beg)}</td>
                <td className="px-1.5 py-1 font-mono text-sky-600 font-semibold truncate">{r.arr_flight_name || <span className="text-gray-300">—</span>}</td>
                <td className="px-1.5 py-1 text-gray-700 truncate" title={r.hotel_name}>{r.hotel_name || ''}</td>
                <td className="px-1.5 py-1 text-gray-500 truncate" title={r.partner_alias}>{r.partner_alias || ''}</td>
                <td className="px-1.5 py-1 text-center">
                  {TR_LABEL[tr]
                    ? <span className={`px-1 py-px rounded text-[9px] font-bold ${TR_LABEL[tr].cls}`}>{TR_LABEL[tr].text}</span>
                    : <span className="text-gray-300">—</span>
                  }
                </td>
                <td className="px-1 py-1 relative">
                  {(tr === 'IND' || tr === 'GRP') ? (
                    <>
                      <span onClick={() => setVehicleEdit(vehicleEdit === r.id ? null : r.id)}
                        title="Klikni za izmjenu vozila"
                        className={`cursor-pointer px-1.5 py-px rounded text-[9px] font-bold transition-colors ${r.dep_vehicle_type ? VEH_IDLE[r.dep_vehicle_type] || 'bg-gray-100 text-gray-600' : 'text-gray-200 hover:text-gray-400'}`}>
                        {r.dep_vehicle_type || '—'}
                      </span>
                      {vehicleEdit === r.id && (
                        <div className="absolute z-20 top-full left-0 mt-0.5 flex gap-0.5 bg-white border border-gray-200 rounded shadow-lg px-1.5 py-1">
                          {VEH_OPTIONS.map(v => (
                            <button key={v} onClick={() => saveVehicle(r.id, v)}
                              className={`px-1.5 py-px rounded text-[9px] font-bold border transition-colors ${r.dep_vehicle_type === v ? VEH_CLS[v] + ' border-transparent' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}>
                              {v === 'V-Class' ? 'VCL' : v === 'Minivan' ? 'MNV' : 'CAR'}
                            </button>
                          ))}
                          <button onClick={() => setVehicleEdit(null)} className="px-1 py-px text-[9px] text-gray-300 hover:text-gray-500 ml-0.5">✕</button>
                        </div>
                      )}
                    </>
                  ) : ''}
                </td>
                <td className="px-1 py-1 text-center">
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
                <td className="px-1.5 py-1 text-gray-400 truncate text-[10px]" title={r.claim_oper_note}>{r.claim_oper_note || ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  function FlightHeader({ flight, schedule, records, accent = 'bg-gray-800' }) {
    return (
      <div className={`flex items-center gap-2 ${accent} text-white px-3 py-1.5 rounded-t`}>
        <span className="font-mono font-bold">{flight}</span>
        {schedule && (
          <>
            <span className="text-gray-400">·</span>
            <span className="font-mono text-amber-300 font-bold text-sm">{fmtTime(schedule.scheduled_time)}</span>
            <span className="text-[11px] bg-white/10 px-1.5 py-px rounded font-medium">{schedule.airport}</span>
          </>
        )}
        {/* Bulk pickup pomak — skriva se pri štampanju */}
        <div className="flex items-center gap-0.5 ml-3 border-l border-white/20 pl-3 no-print">
          <span className="text-[9px] text-gray-300 mr-1">pickup:</span>
          {[-15,-10,-5,5,10,15].map(m => (
            <button key={m} onClick={() => shiftFlight(records, m)}
              className="text-[9px] font-mono px-1 py-px rounded bg-white/10 hover:bg-white/30 text-white transition-colors"
              title={`Pomjeri sve pickup-e za ${m > 0 ? '+' : ''}${m} min`}>
              {m > 0 ? '+' : ''}{m}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-gray-300 tabular-nums">
          {records.length} gostiju · {totalPax(records)} pax
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50">

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div className="px-5 py-2.5 border-b bg-white flex-shrink-0 flex items-center gap-3 no-print shadow-sm">
        <span className="text-sm font-bold text-gray-700 flex items-center gap-2">
          🛫 Odlazak
        </span>
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
        TRANSFER LISTA — ODLAZAK · {fmtDateFull(selectedDate)} &nbsp;·&nbsp; {total} gostiju
      </div>

      {/* ── Legenda transfera ───────────────────────────── */}
      <div className="px-5 pt-2 flex items-center gap-4 text-[10px] text-gray-500 no-print">
        <span className="flex items-center gap-1"><span className="w-2.5 h-4 rounded-sm bg-blue-500 inline-block"></span> GRP — grupni</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-4 rounded-sm bg-purple-500 inline-block"></span> SHA — dijeljeni</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-4 rounded-sm bg-amber-500 inline-block"></span> IND — individualni</span>
      </div>

      {/* ── Sadržaj ─────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 py-2">

        {!loading && groups.length === 0 && noTransfer.length === 0 && (
          <div className="text-center text-gray-400 py-20">
            <div className="text-5xl mb-3">🛫</div>
            <p className="text-sm">Nema odlaznih transfera za {fmtDateFull(selectedDate)}</p>
          </div>
        )}

        {/* Grupe po letu */}
        {groups.map(({ flight, schedule, records }) => (
          <div key={flight} className="mb-4 rounded overflow-hidden border border-gray-200 shadow-sm flight-group">
            <FlightHeader flight={flight} schedule={schedule} records={records} />
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
