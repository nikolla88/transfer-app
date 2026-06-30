import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { parseRoomingXlsx } from '../lib/roomingParser'
import { buildFlightMatcher } from '../lib/flightMatcher'

// ── Kolone tabele ─────────────────────────────────────────────────
const COLS = [
  { key: 'claim_inc',          label: 'Rez. br.',   width: 74,   type: 'number' },
  { key: 'tourist_name',       label: 'Gost',        width: 148,  type: 'text'   },
  { key: 'adult',              label: 'A',           width: 28,   type: 'number' },
  { key: 'child',              label: 'C',           width: 28,   type: 'number' },
  { key: 'infant',             label: 'I',           width: 28,   type: 'number' },
  { key: 'date_beg',           label: 'Dolazak',     width: 80,   type: 'date'   },
  { key: 'arr_flight_name',    label: 'Let dol.',    width: 70,   type: 'flight-arr' },
  { key: 'date_end',           label: 'Odlazak',     width: 80,   type: 'date'   },
  { key: 'dep_flight_name',    label: 'Let odl.',    width: 70,   type: 'flight-dep' },
  { key: 'hotel_town',         label: 'Dest.',       width: 62,   type: 'text'   },
  { key: 'hotel_name',         label: 'Hotel',       width: 205,  type: 'text'   },
  { key: 'meal',               label: 'Ish.',        width: 42,   type: 'text'   },
  { key: 'room',               label: 'Soba',        width: 96,   type: 'text'   },
  { key: 'partner_alias',      label: 'Partner',     width: 84,   type: 'text'   },
  { key: 'arr_transfer_alias', label: 'Tr. dol.',    width: 80,   type: 'transfer', vehKey: 'arr_vehicle_type' },
  { key: 'dep_transfer_alias', label: 'Tr. odl.',    width: 80,   type: 'transfer', vehKey: 'dep_vehicle_type' },
  { key: 'claim_note',         label: 'Napomena',    width: 190,  type: 'text'   },
  { key: 'claim_oper_note',    label: 'Oper. nap.',  width: 190,  type: 'text'   },
]

const TRANSFER_TYPES = ['GRP', 'IND', 'SHA', 'NO TR-R']
const VEHICLE_TYPES  = ['Car', 'Minivan', 'V-Class']
const VEHICLE_ICON   = { 'Car': '🚗', 'Minivan': '🚐', 'V-Class': '⭐' }
const BATCH = 100

const EMPTY_FILTERS = {
  arrFrom: '', arrTo: '', depFrom: '', depTo: '',
  hotel: '', town: '', arrFlight: '', depFlight: '',
  arrTransfer: '', depTransfer: '', partner: '', meal: '', search: '',
}

export default function RoomingList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows,        setRows]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [importing,   setImporting]   = useState(false)
  const [importMsg,   setImportMsg]   = useState('')
  const [editRow,     setEditRow]     = useState(null)
  const [saving,      setSaving]      = useState(false)
  const urlSearch = searchParams.get('search') || ''
  const [filters,     setFilters]     = useState({ ...EMPTY_FILTERS, search: urlSearch })
  const [applied,     setApplied]     = useState(EMPTY_FILTERS)
  const [quickEdit,   setQuickEdit]   = useState(null)

  // ── Import flow state ─────────────────────────────────────────
  // importPhase: idle | hotels | flights | importing
  const [importPhase, setImportPhase] = useState('idle')
  const [hotelItems,  setHotelItems]  = useState([])  // hoteli kojih nema u bazi
  const [flightItems, setFlightItems] = useState([])  // letovi koji trebaju razrješenje
  // useRef umjesto useState da se izbjegne stale closure
  const pendingRecordsRef  = useRef([])
  const pendingFlightMapRef = useRef({})   // canonical mapa za exact matcheve između faza

  // ── Opcije letova iz flight_schedule ──────────────────────────
  const [arrFlightOpts, setArrFlightOpts] = useState([])
  const [depFlightOpts, setDepFlightOpts] = useState([])

  const fileRef = useRef()

  useEffect(() => {
    load(applied)
    loadFlightOpts()
    if (urlSearch) setSearchParams({}, { replace: true })
  }, [])

  // Auto server-side pretraga kad korisnik ukuca broj rezervacije
  useEffect(() => {
    const s = filters.search?.trim()
    if (!s || !/^\d+$/.test(s)) return  // samo za numeričke vrijednosti
    const timer = setTimeout(() => load({ ...applied, search: s }), 400)
    return () => clearTimeout(timer)
  }, [filters.search])

  useEffect(() => {
    if (!quickEdit) return
    const handler = (e) => { if (!e.target.closest('[data-quick-popup]')) setQuickEdit(null) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [quickEdit])

  function setF(key, val) { setFilters(prev => ({ ...prev, [key]: val })) }

  async function loadFlightOpts() {
    try {
      const { data } = await supabase
        .from('flight_schedule')
        .select('flight_number, direction')
        .order('flight_number')
      if (data) {
        const arr = [...new Set(data.filter(f => f.direction === 'ARR').map(f => f.flight_number))]
        const dep = [...new Set(data.filter(f => f.direction === 'DEP').map(f => f.flight_number))]
        setArrFlightOpts(arr)
        setDepFlightOpts(dep)
      }
    } catch (e) {
      console.warn('loadFlightOpts:', e.message)
    }
  }

  async function load(f = applied) {
    setLoading(true)
    let q = supabase.from('rooming_list').select('*')
      .order('date_beg', { ascending: true })
      .order('tourist_name', { ascending: true })
    if (f.arrFrom)     q = q.gte('date_beg', f.arrFrom)
    if (f.arrTo)       q = q.lte('date_beg', f.arrTo)
    if (f.depFrom)     q = q.gte('date_end', f.depFrom)
    if (f.depTo)       q = q.lte('date_end', f.depTo)
    if (f.hotel)       q = q.ilike('hotel_name', `%${f.hotel}%`)
    if (f.town)        q = q.ilike('hotel_town', `%${f.town}%`)
    if (f.arrFlight)   q = q.eq('arr_flight_name', f.arrFlight)
    if (f.depFlight)   q = q.eq('dep_flight_name', f.depFlight)
    if (f.arrTransfer) q = q.eq('arr_transfer_alias', f.arrTransfer)
    if (f.depTransfer) q = q.eq('dep_transfer_alias', f.depTransfer)
    if (f.partner)     q = q.ilike('partner_alias', `%${f.partner}%`)
    if (f.meal)        q = q.ilike('meal', `%${f.meal}%`)
    // Ako je search samo broj — traži kroz cijelu bazu (ignoriši datumske filtere)
    if (f.search && /^\d+$/.test(f.search.trim())) {
      const num = f.search.trim()
      q = supabase.from('rooming_list').select('*')
        .or(`order_inc::text.ilike.%${num}%,claim_inc::text.ilike.%${num}%,partner_inc::text.ilike.%${num}%`)
        .order('date_beg', { ascending: true })
        .order('tourist_name', { ascending: true })
    }
    const { data, error } = await q.limit(2000)
    if (error) console.error(error)
    setRows(data || [])
    setLoading(false)
  }

  function applyFilters() { setApplied(filters); load(filters) }
  function resetFilters()  { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); load(EMPTY_FILTERS) }

  // ── Quick edit transfer/vozilo ────────────────────────────────
  function openQuickEdit(e, row, col) {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setQuickEdit({ rowId: row.id, trKey: col.key, vehKey: col.vehKey, rect })
  }

  async function saveQuickField(rowId, key, val) {
    const { error } = await supabase.from('rooming_list').update({ [key]: val }).eq('id', rowId)
    if (!error) setRows(prev => prev.map(r => r.id === rowId ? { ...r, [key]: val } : r))
  }

  async function deleteRow(row) {
    const name = row.tourist_name || row.claim_inc || row.id
    if (!window.confirm(`Obrisati rezervaciju?\n\n${name}\n\nOva akcija se ne može poništiti.`)) return
    const { error } = await supabase.from('rooming_list').delete().eq('id', row.id)
    if (!error) setRows(prev => prev.filter(r => r.id !== row.id))
  }

  // ── Import Excel ──────────────────────────────────────────────
  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    setImportMsg('⏳ Parsiranje...')

    try {
      const buffer = await file.arrayBuffer()
      const parsed = await parseRoomingXlsx(buffer)

      console.log('[Import] Parsovano zapisa:', parsed.length)

      if (parsed.length === 0) {
        setImportMsg('⚠️ Excel fajl ne sadrži zapise')
        setImporting(false)
        return
      }

      pendingRecordsRef.current = parsed

      // ── 1. Provjeri hotele ──────────────────────────────────────
      setImportMsg('⏳ Provjera hotela...')
      try {
        const hotelMap = new Map()
        for (const r of parsed) {
          if (r.hotel_name && !hotelMap.has(r.hotel_name.toLowerCase())) {
            hotelMap.set(r.hotel_name.toLowerCase(), { name: r.hotel_name, town: r.hotel_town })
          }
        }
        const { data: existingHotels } = await supabase.from('hotels').select('name')
        const existingNames = new Set((existingHotels || []).map(h => h.name.toLowerCase()))
        const missing = [...hotelMap.values()].filter(h => !existingNames.has(h.name.toLowerCase()))

        console.log('[Import] Hotela u excelu:', hotelMap.size, '| Nedostaje:', missing.length)

        if (missing.length > 0) {
          setHotelItems(missing)
          setImportPhase('hotels')
          setImporting(false)
          setImportMsg('')
          return // čekamo da korisnik doda hotele
        }
      } catch (hotelErr) {
        console.warn('[Import] Hotel check preskočen:', hotelErr.message)
      }

      // ── 2. Provjeri letove ──────────────────────────────────────
      await checkFlightsAndImport(parsed)

    } catch (err) {
      console.error('[Import] Greška:', err)
      setImportMsg(`❌ Greška: ${err.message || String(err)}`)
      setImporting(false)
    }
  }

  // Nastavak importa: provjera letova → upsert
  async function checkFlightsAndImport(records) {
    setImporting(true)
    setImportMsg('⏳ Provjera letova...')

    let needsResolution = []
    const canonicalMap  = {}   // raw Excel ime → kanonski flight_number iz DB

    try {
      const flightSources = new Map()
      for (const r of records) {
        if (r.arr_flight_name) {
          const s = flightSources.get(r.arr_flight_name) || { arr: false, dep: false }
          flightSources.set(r.arr_flight_name, { ...s, arr: true })
        }
        if (r.dep_flight_name) {
          const s = flightSources.get(r.dep_flight_name) || { arr: false, dep: false }
          flightSources.set(r.dep_flight_name, { ...s, dep: true })
        }
      }
      const { match } = await buildFlightMatcher()
      for (const [raw, sources] of flightSources) {
        const matchResult = match(raw)
        // Za SVE prepoznate letove (exact i alias) zapamti kanonsko ime
        if (matchResult.schedule) {
          canonicalMap[raw] = matchResult.schedule.flight_number
        }
        if (matchResult.status !== 'exact') needsResolution.push({ raw, sources, matchResult })
      }
      console.log('[Import] Letova za razrješavanje:', needsResolution.length, '| canonicalMap:', canonicalMap)
    } catch (flightErr) {
      console.warn('[Import] Flight check preskočen:', flightErr.message)
      needsResolution = []
    }

    setImporting(false)
    setImportMsg('')

    if (needsResolution.length === 0) {
      await doImport(records, canonicalMap)
    } else {
      pendingRecordsRef.current  = records
      pendingFlightMapRef.current = canonicalMap   // sačuvaj za spajanje sa modal mapom
      setFlightItems(needsResolution)
      setImportPhase('flights')
    }
  }

  // ── Finalni uvoz (nakon razrješavanja letova) ─────────────────
  async function doImport(records, flightMap) {
    console.log('[doImport] Zapisa primljeno:', records?.length, '| flightMap keys:', Object.keys(flightMap || {}))

    if (!records || records.length === 0) {
      setImportMsg('⚠️ Nema zapisa za uvoz')
      setImportPhase('idle')
      setFlightItems([])
      return
    }

    setImportPhase('importing')
    setImporting(true)

    try {
      // Primijeni zamjenu naziva letova
      const finalRecords = records.map(r => ({
        ...r,
        arr_flight_name: (r.arr_flight_name && flightMap?.[r.arr_flight_name]) || r.arr_flight_name,
        dep_flight_name: (r.dep_flight_name && flightMap?.[r.dep_flight_name]) || r.dep_flight_name,
      }))

      // Deduplikuj po order_inc — u slučaju da Excel ima duplikate, zadrži zadnji
      const deduped = [...new Map(finalRecords.map(r => [r.order_inc, r])).values()]
      console.log('[doImport] Nakon deduplikacije:', deduped.length, '(uklonjeno:', finalRecords.length - deduped.length, 'duplikata)')

      // Dohvati postojeće zapise iz baze (po order_inc) da bi sačuvali
      // ručno unesene podatke (tip transfera, vozilo) pri re-importu
      setImportMsg('⏳ Provjera postojećih zapisa...')
      const orderIncs = deduped.map(r => r.order_inc).filter(Boolean)
      const { data: existingRows } = await supabase
        .from('rooming_list')
        .select('order_inc, arr_transfer_alias, dep_transfer_alias, arr_vehicle_type, dep_vehicle_type')
        .in('order_inc', orderIncs)
      const existingMap = Object.fromEntries((existingRows || []).map(r => [r.order_inc, r]))

      console.log('[doImport] Postojećih u bazi:', Object.keys(existingMap).length, '| Novih:', finalRecords.length - Object.keys(existingMap).length)

      // Za postojeće zapise: preuzmi ručno postavljene vrijednosti da ih ne izgubimo
      const mergedRecords = deduped.map(r => {
        const ex = existingMap[r.order_inc]
        if (!ex) return r
        return {
          ...r,
          arr_transfer_alias: ex.arr_transfer_alias ?? r.arr_transfer_alias,
          dep_transfer_alias: ex.dep_transfer_alias ?? r.dep_transfer_alias,
          arr_vehicle_type:   ex.arr_vehicle_type   ?? r.arr_vehicle_type,
          dep_vehicle_type:   ex.dep_vehicle_type   ?? r.dep_vehicle_type,
        }
      })

      setImportMsg(`⏳ Upisujem ${mergedRecords.length} zapisa...`)
      let processed = 0
      for (let i = 0; i < mergedRecords.length; i += BATCH) {
        const batch = mergedRecords.slice(i, i + BATCH)
        // ignoreDuplicates: false → ažurira postojeće zapise (ne preskače ih)
        const { error } = await supabase.from('rooming_list')
          .upsert(batch, { onConflict: 'order_inc', ignoreDuplicates: false })
        if (error) {
          console.error('[doImport] Upsert error na batchu', i, error)
          throw error
        }
        processed += batch.length
        setImportMsg(`⏳ ${processed} / ${mergedRecords.length}...`)
      }

      const newCount = deduped.length - Object.keys(existingMap).length
      const updCount = Object.keys(existingMap).length
      setImportMsg(`✅ ${newCount} novih · ${updCount} ažuriranih`)
      await load(applied)
    } catch (err) {
      console.error('[doImport] Greška:', err)
      setImportMsg(`❌ Greška: ${err.message || String(err)}`)
    }

    setImporting(false)
    setImportPhase('idle')
    setHotelItems([])
    setFlightItems([])
    pendingRecordsRef.current = []
    setTimeout(() => setImportMsg(''), 5000)
  }

  // ── Edit modal ────────────────────────────────────────────────
  function openEdit(row)  { setEditRow({ ...row }) }
  function closeEdit()    { setEditRow(null) }

  async function saveEdit() {
    if (!editRow) return
    setSaving(true)
    const { id, created_at, updated_at, ...payload } = editRow
    const { error } = await supabase.from('rooming_list').update(payload).eq('id', id)
    if (error) { alert('Greška: ' + error.message) }
    else { setRows(prev => prev.map(r => r.id === id ? { ...editRow } : r)); closeEdit() }
    setSaving(false)
  }

  // ── Client-side search ────────────────────────────────────────
  const filtered = rows.filter(r => {
    if (!filters.search) return true
    const s = filters.search.toLowerCase()
    return (
      r.tourist_name?.toLowerCase().includes(s) ||
      r.hotel_name?.toLowerCase().includes(s) ||
      String(r.claim_inc  || '').includes(s) ||
      String(r.order_inc  || '').includes(s) ||
      String(r.partner_inc || '').includes(s) ||
      r.arr_flight_name?.toLowerCase().includes(s) ||
      r.dep_flight_name?.toLowerCase().includes(s) ||
      r.room?.toLowerCase().includes(s)
    )
  })

  function fmt(d) {
    if (!d) return '—'
    const [y, m, dd] = d.split('-')
    return `${dd}.${m}.${y}`
  }

  function displayVal(row, col) {
    const v = row[col.key]
    if (col.type === 'transfer') {
      const veh = row[col.vehKey]
      if (!v && !veh) return <span className="text-gray-300">—</span>
      return (
        <div>
          {v && <div className="font-medium">{v}</div>}
          {veh && <div className="text-gray-400 text-xs leading-tight">{VEHICLE_ICON[veh]} {veh}</div>}
        </div>
      )
    }
    if (v === null || v === undefined || v === '') return <span className="text-gray-300">—</span>
    if (col.type === 'date') return fmt(v)
    return v
  }

  const hasFilters = Object.values(applied).some(v => v !== '')

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-6 pt-4 pb-0 border-b bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">Rooming List</h1>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx" onChange={handleFile} className="hidden" />
            <button onClick={() => fileRef.current.click()} disabled={importing || importPhase !== 'idle'}
              className="px-3 py-1.5 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors">
              {importing ? '⏳ Uvoz...' : '📥 Uvezi Excel'}
            </button>
            {importMsg && <span className="text-sm font-medium">{importMsg}</span>}
          </div>
        </div>

        {/* Filteri */}
        <div className="grid grid-cols-6 gap-x-3 gap-y-2 pb-3">
          <div><label className="label text-xs">Dolazak od</label>
            <input type="date" className="input text-xs w-full" value={filters.arrFrom} onChange={e => setF('arrFrom', e.target.value)} /></div>
          <div><label className="label text-xs">Dolazak do</label>
            <input type="date" className="input text-xs w-full" value={filters.arrTo} onChange={e => setF('arrTo', e.target.value)} /></div>
          <div><label className="label text-xs">Odlazak od</label>
            <input type="date" className="input text-xs w-full" value={filters.depFrom} onChange={e => setF('depFrom', e.target.value)} /></div>
          <div><label className="label text-xs">Odlazak do</label>
            <input type="date" className="input text-xs w-full" value={filters.depTo} onChange={e => setF('depTo', e.target.value)} /></div>
          <div><label className="label text-xs">Destinacija</label>
            <input type="text" placeholder="Budva, Kotor..." className="input text-xs w-full"
              value={filters.town} onChange={e => setF('town', e.target.value)} onKeyDown={e => e.key === 'Enter' && applyFilters()} /></div>
          <div><label className="label text-xs">Hotel</label>
            <input type="text" placeholder="Naziv hotela..." className="input text-xs w-full"
              value={filters.hotel} onChange={e => setF('hotel', e.target.value)} onKeyDown={e => e.key === 'Enter' && applyFilters()} /></div>

          <div><label className="label text-xs">Let dolazni</label>
            <select className="input text-xs w-full" value={filters.arrFlight} onChange={e => {
              const val = e.target.value
              const next = { ...filters, arrFlight: val }
              setFilters(next); setApplied(next); load(next)
            }}>
              <option value="">— svi —</option>
              {arrFlightOpts.map(f => <option key={f} value={f}>{f}</option>)}
            </select></div>
          <div><label className="label text-xs">Let odlazni</label>
            <select className="input text-xs w-full" value={filters.depFlight} onChange={e => {
              const val = e.target.value
              const next = { ...filters, depFlight: val }
              setFilters(next); setApplied(next); load(next)
            }}>
              <option value="">— svi —</option>
              {depFlightOpts.map(f => <option key={f} value={f}>{f}</option>)}
            </select></div>
          <div><label className="label text-xs">Transfer dolazni</label>
            <select className="input text-xs w-full" value={filters.arrTransfer} onChange={e => {
              const val = e.target.value
              const next = { ...filters, arrTransfer: val }
              setFilters(next); setApplied(next); load(next)
            }}>
              {['', ...TRANSFER_TYPES].map(t => <option key={t} value={t}>{t || '— svi —'}</option>)}
            </select></div>
          <div><label className="label text-xs">Transfer odlazni</label>
            <select className="input text-xs w-full" value={filters.depTransfer} onChange={e => {
              const val = e.target.value
              const next = { ...filters, depTransfer: val }
              setFilters(next); setApplied(next); load(next)
            }}>
              {['', ...TRANSFER_TYPES].map(t => <option key={t} value={t}>{t || '— svi —'}</option>)}
            </select></div>
          <div><label className="label text-xs">Partner</label>
            <input type="text" placeholder="Naziv..." className="input text-xs w-full"
              value={filters.partner} onChange={e => setF('partner', e.target.value)} onKeyDown={e => e.key === 'Enter' && applyFilters()} /></div>
          <div><label className="label text-xs">Ishrana</label>
            <input type="text" placeholder="BB, HB..." className="input text-xs w-full"
              value={filters.meal} onChange={e => setF('meal', e.target.value)} onKeyDown={e => e.key === 'Enter' && applyFilters()} /></div>
        </div>

        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <button onClick={applyFilters}
              className="px-3 py-1.5 rounded text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 transition-colors">
              🔍 Filtriraj
            </button>
            {hasFilters && (
              <button onClick={resetFilters}
                className="px-3 py-1.5 rounded text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors">
                ✕ Reset
              </button>
            )}
            <input type="text" placeholder="Brza pretraga (gost, rez. br., soba...)"
              value={filters.search} onChange={e => setF('search', e.target.value)}
              className="input text-xs w-64 ml-2" />
          </div>
          <div className="text-xs text-gray-400">
            {loading ? 'Učitavanje...' : (
              <><span className="font-medium text-gray-700">{filtered.length}</span> zapisa
              {rows.length !== filtered.length && ` (od ${rows.length})`}
              {hasFilters && <span className="ml-2 text-sky-600 font-medium">● Filter aktivan</span>}</>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabela ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-center text-gray-400 py-16">Učitavanje...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <div className="text-4xl mb-3">📋</div>
            <p>{hasFilters ? 'Nema rezultata za odabrane filtere.' : 'Nema podataka. Uvezi Excel fajl.'}</p>
          </div>
        ) : (
          <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: 36 + COLS.reduce((s, c) => s + c.width, 0) }}>
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                <th style={{ width: 36 }} className="px-1.5 py-2 text-center font-semibold text-gray-600 border-r border-gray-200 sticky left-0 bg-gray-50 z-20"></th>
                {COLS.map(c => (
                  <th key={c.key} style={{ width: c.width }}
                    className="px-2 py-2 text-left font-semibold text-gray-600 border-r border-gray-200 whitespace-nowrap overflow-hidden">
                    <div className="truncate">{c.label}{c.type === 'transfer' && <span className="ml-0.5 text-gray-300 font-normal">✏</span>}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={row.id}
                  className={`border-b border-gray-100 hover:bg-blue-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                  <td style={{ width: 36 }} className="px-1.5 py-1 text-center border-r border-gray-100 sticky left-0 bg-inherit z-10">
                    <button onClick={() => openEdit(row)}
                      className="px-1.5 py-0.5 rounded text-xs border border-gray-300 bg-white hover:bg-blue-50 hover:border-blue-400 text-gray-500 transition-colors">
                      ✏️
                    </button>
                  </td>
                  {COLS.map(c => {
                    const rawVal = c.type !== 'transfer' ? (row[c.key] ?? '') : ''
                    const tipText = c.type === 'transfer'
                      ? [row[c.key], row[c.vehKey]].filter(Boolean).join(' · ') || 'Klikni za izmjenu'
                      : String(rawVal)
                    return (
                      <td key={c.key} style={{ width: c.width }}
                        className={`px-2 py-1 border-r border-gray-100 align-middle ${c.type === 'transfer' ? 'cursor-pointer hover:bg-yellow-50' : ''}`}
                        onClick={c.type === 'transfer' ? (e) => openQuickEdit(e, row, c) : undefined}
                        title={tipText}>
                        <div className="truncate overflow-hidden">{displayVal(row, c)}</div>
                      </td>
                    )
                  })}
                  <td className="px-1 py-1 text-center">
                    <button
                      onClick={() => deleteRow(row)}
                      title="Obriši rezervaciju"
                      className="px-1 py-0.5 rounded text-xs text-red-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Quick Edit Popup ────────────────────────────────────── */}
      {quickEdit && (
        <QuickTransferPopup
          quickEdit={quickEdit}
          rows={rows}
          onSave={saveQuickField}
          onClose={() => setQuickEdit(null)}
        />
      )}

      {/* ── Hotel Resolution Modal ──────────────────────────────── */}
      {importPhase === 'hotels' && (
        <HotelResolutionModal
          items={hotelItems}
          recordCount={pendingRecordsRef.current.length}
          onComplete={() => {
            setImportPhase('idle')
            setHotelItems([])
            checkFlightsAndImport(pendingRecordsRef.current)
          }}
          onCancel={() => {
            setImportPhase('idle')
            setHotelItems([])
            pendingRecordsRef.current = []
          }}
        />
      )}

      {/* ── Flight Resolution Modal ─────────────────────────────── */}
      {importPhase === 'flights' && (
        <FlightResolutionModal
          items={flightItems}
          recordCount={pendingRecordsRef.current.length}
          onComplete={(flightMap) => doImport(pendingRecordsRef.current, { ...pendingFlightMapRef.current, ...flightMap })}
          onCancel={() => { setImportPhase('idle'); pendingRecordsRef.current = []; setFlightItems([]) }}
        />
      )}

      {/* ── Edit Modal ──────────────────────────────────────────── */}
      {editRow && (
        <EditModal
          row={editRow}
          cols={COLS}
          onChange={setEditRow}
          onSave={saveEdit}
          onClose={closeEdit}
          saving={saving}
          arrFlightOpts={arrFlightOpts}
          depFlightOpts={depFlightOpts}
        />
      )}
    </div>
  )
}

// ── Flight Resolution Modal ───────────────────────────────────────
const DAYS    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const DAYS_HR = { Mon:'Po', Tue:'Ut', Wed:'Sr', Thu:'Če', Fri:'Pe', Sat:'Su', Sun:'Ne' }

const EMPTY_FLIGHT = {
  flight_number: '', airline: '', origin: '', destination: '',
  airport: 'TIV', direction: 'ARR', scheduled_time: '',
  days_of_week: [], flight_type: 'Redovni',
  valid_from: '', valid_to: '', aliases: [], notes: '',
}

function FlightResolutionModal({ items, recordCount, onComplete, onCancel }) {
  // resolutions: raw → { type: 'confirmed'|'rejected', flightNumber }
  const [resolutions, setResolutions] = useState({})
  const [addingFor,   setAddingFor]   = useState(null)  // raw string koji se dodaje
  const [addForm,     setAddForm]     = useState(EMPTY_FLIGHT)
  const [savingNew,   setSavingNew]   = useState(false)

  const aliasItems   = items.filter(i => i.matchResult.status === 'alias')
  const unknownItems = items.filter(i => i.matchResult.status === 'unknown')

  const totalNeeded  = items.length
  const totalDone    = Object.keys(resolutions).length
  const allResolved  = totalDone === totalNeeded

  function confirm(raw, flightNumber) {
    setResolutions(p => ({ ...p, [raw]: { type: 'confirmed', flightNumber } }))
  }

  function reject(raw) {
    // Zadrži originalni naziv
    setResolutions(p => ({ ...p, [raw]: { type: 'rejected', flightNumber: raw } }))
  }

  function openAdd(raw, sources) {
    const normalized = raw.replace(/[\s\-_]/g, '').toUpperCase()
    const guessDir   = sources.arr && !sources.dep ? 'ARR' : sources.dep && !sources.arr ? 'DEP' : 'ARR'
    setAddForm({ ...EMPTY_FLIGHT, flight_number: normalized, direction: guessDir })
    setAddingFor(raw)
  }

  function setAF(key, val) { setAddForm(p => ({ ...p, [key]: val })) }

  function toggleDay(day) {
    setAddForm(p => ({
      ...p,
      days_of_week: p.days_of_week.includes(day)
        ? p.days_of_week.filter(d => d !== day)
        : [...p.days_of_week, day],
    }))
  }

  async function saveNewFlight() {
    if (!addForm.flight_number) return
    setSavingNew(true)
    const payload = {
      ...addForm,
      flight_number: addForm.flight_number.trim().toUpperCase(),
      origin:        addForm.origin?.toUpperCase() || null,
      destination:   addForm.destination?.toUpperCase() || null,
      days_of_week:  addForm.days_of_week.length ? addForm.days_of_week : null,
      valid_from:    addForm.valid_from || null,
      valid_to:      addForm.valid_to   || null,
    }
    const { error } = await supabase.from('flight_schedule').insert(payload)
    if (error) {
      alert('Greška pri dodavanju leta: ' + error.message)
    } else {
      const canonical = payload.flight_number
      setResolutions(p => ({ ...p, [addingFor]: { type: 'confirmed', flightNumber: canonical } }))
      setAddingFor(null)
    }
    setSavingNew(false)
  }

  function proceed() {
    const flightMap = {}
    Object.entries(resolutions).forEach(([raw, res]) => {
      if (res.flightNumber !== raw) flightMap[raw] = res.flightNumber
    })
    onComplete(flightMap)
  }

  // ── Render add form ───────────────────────────────────────────
  if (addingFor) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div>
              <div className="font-bold text-gray-900">+ Dodaj novi let u raspored</div>
              <div className="text-xs text-gray-400 mt-0.5">
                Iz Excela: <span className="font-mono text-red-500">{addingFor}</span>
              </div>
            </div>
            <button onClick={() => setAddingFor(null)} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label text-xs">Broj leta *</label>
                <input type="text" className="input text-sm font-mono uppercase"
                  value={addForm.flight_number} onChange={e => setAF('flight_number', e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className="label text-xs">Avio-kompanija</label>
                <input type="text" placeholder="Turkish Airlines" className="input text-sm"
                  value={addForm.airline} onChange={e => setAF('airline', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label text-xs">Polazak</label>
                <input type="text" placeholder="IST" maxLength={3} className="input text-sm uppercase font-mono"
                  value={addForm.origin} onChange={e => setAF('origin', e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className="label text-xs">Odredište</label>
                <input type="text" placeholder="TIV" maxLength={3} className="input text-sm uppercase font-mono"
                  value={addForm.destination} onChange={e => setAF('destination', e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className="label text-xs">Vrijeme</label>
                <input type="time" className="input text-sm"
                  value={addForm.scheduled_time} onChange={e => setAF('scheduled_time', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label text-xs">Aerodrom *</label>
                <select className="input text-sm" value={addForm.airport} onChange={e => setAF('airport', e.target.value)}>
                  <option>TIV</option><option>TGD</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">Smjer *</label>
                <select className="input text-sm" value={addForm.direction} onChange={e => setAF('direction', e.target.value)}>
                  <option value="ARR">ARR — dolazak</option>
                  <option value="DEP">DEP — odlazak</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">Tip</label>
                <select className="input text-sm" value={addForm.flight_type} onChange={e => setAF('flight_type', e.target.value)}>
                  <option>Redovni</option><option>Charter</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label text-xs mb-1">Dani u sedmici</label>
              <div className="flex gap-2 flex-wrap">
                {DAYS.map(d => (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    className={`w-9 h-9 rounded-full text-xs font-bold border transition-colors ${
                      addForm.days_of_week.includes(d)
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-sky-400'
                    }`}>
                    {DAYS_HR[d]}
                  </button>
                ))}
                <button type="button"
                  onClick={() => setAF('days_of_week', addForm.days_of_week.length === 7 ? [] : [...DAYS])}
                  className="px-3 h-9 rounded text-xs border border-gray-300 hover:bg-gray-50 text-gray-500 ml-1">
                  {addForm.days_of_week.length === 7 ? 'Reset' : 'Svaki dan'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label text-xs">Važi od</label>
                <input type="date" className="input text-sm"
                  value={addForm.valid_from} onChange={e => setAF('valid_from', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Važi do</label>
                <input type="date" className="input text-sm"
                  value={addForm.valid_to} onChange={e => setAF('valid_to', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="px-5 py-4 border-t flex justify-end gap-3">
            <button onClick={() => setAddingFor(null)} className="btn-ghost">Nazad</button>
            <button onClick={saveNewFlight} disabled={savingNew || !addForm.flight_number} className="btn-primary">
              {savingNew ? 'Čuvanje...' : '💾 Sačuvaj i nastavi'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render resolution list ────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b">
          <div className="font-bold text-gray-900 text-lg">✈️ Provjera letova</div>
          <div className="text-sm text-gray-500 mt-0.5">
            Pronađeno {items.length} letova koji trebaju potvrdu prije uvoza {recordCount} zapisa.
          </div>
          {/* Progress */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full">
              <div className="h-1.5 bg-green-500 rounded-full transition-all"
                style={{ width: `${totalNeeded ? (totalDone / totalNeeded) * 100 : 0}%` }} />
            </div>
            <span className="text-xs text-gray-500">{totalDone}/{totalNeeded} riješeno</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Alias matches */}
          {aliasItems.length > 0 && (
            <div>
              <div className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3">
                🔍 Slični letovi — potvrdi ili odbij prijedlog
              </div>
              <div className="space-y-2">
                {aliasItems.map(item => {
                  const res = resolutions[item.raw]
                  const s   = item.matchResult.schedule
                  return (
                    <div key={item.raw}
                      className={`p-3 rounded-lg border text-sm ${res ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-gray-700">{item.raw}</span>
                            <span className="text-gray-400">→</span>
                            <span className="font-mono font-bold text-sky-700">{s.flight_number}</span>
                            {s.airline && <span className="text-gray-500 text-xs">({s.airline})</span>}
                          </div>
                          {(s.origin || s.destination || s.scheduled_time) && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              {s.origin && s.destination && `${s.origin} → ${s.destination}`}
                              {s.scheduled_time && ` · ${s.scheduled_time}`}
                              {` · ${s.airport} ${s.direction}`}
                            </div>
                          )}
                        </div>
                        {res ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              res.type === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {res.type === 'confirmed' ? '✓ Potvrđeno' : '✗ Zadržan original'}
                            </span>
                            <button onClick={() => setResolutions(p => { const n={...p}; delete n[item.raw]; return n })}
                              className="text-xs text-gray-400 hover:text-gray-700">Izmijeni</button>
                          </div>
                        ) : (
                          <div className="flex gap-2 shrink-0">
                            <button onClick={() => confirm(item.raw, s.flight_number)}
                              className="px-3 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700">
                              ✓ Da, to je taj let
                            </button>
                            <button onClick={() => reject(item.raw)}
                              className="px-3 py-1 rounded text-xs border border-gray-300 hover:bg-gray-100 text-gray-600">
                              ✗ Nije isti
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Unknown flights */}
          {unknownItems.length > 0 && (
            <div>
              <div className="text-xs font-bold text-red-700 uppercase tracking-wide mb-3">
                ❓ Nepoznati letovi — potrebno dodati u raspored
              </div>
              <div className="space-y-2">
                {unknownItems.map(item => {
                  const res = resolutions[item.raw]
                  return (
                    <div key={item.raw}
                      className={`p-3 rounded-lg border text-sm ${res ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <span className="font-mono font-bold text-red-700">{item.raw}</span>
                          <span className="ml-2 text-xs text-gray-500">
                            {item.sources.arr && item.sources.dep ? 'dolazak + odlazak'
                              : item.sources.arr ? 'dolazak' : 'odlazak'}
                          </span>
                        </div>
                        {res ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
                              ✓ Dodan kao {res.flightNumber}
                            </span>
                            <button onClick={() => setResolutions(p => { const n={...p}; delete n[item.raw]; return n })}
                              className="text-xs text-gray-400 hover:text-gray-700">Izmijeni</button>
                          </div>
                        ) : (
                          <button onClick={() => openAdd(item.raw, item.sources)}
                            className="px-3 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 shrink-0">
                            + Dodaj u raspored letova
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center justify-between">
          <button onClick={onCancel} className="btn-ghost text-sm">✕ Otkaži uvoz</button>
          <button onClick={proceed} disabled={!allResolved}
            className="px-5 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {allResolved
              ? `✅ Nastavi uvoz (${recordCount} zapisa)`
              : `Čeka se ${totalNeeded - totalDone} od ${totalNeeded}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Quick Transfer Popup ──────────────────────────────────────────
function QuickTransferPopup({ quickEdit, rows, onSave, onClose }) {
  const row = rows.find(r => r.id === quickEdit.rowId)
  if (!row) return null
  const trVal  = row[quickEdit.trKey]  || ''
  const vehVal = row[quickEdit.vehKey] || ''
  const { rect } = quickEdit
  const top  = Math.min(rect.bottom + 4, window.innerHeight - 160)
  const left = Math.min(rect.left, window.innerWidth - 260)

  async function pick(key, val) {
    const newVal = row[key] === val ? null : val
    await onSave(quickEdit.rowId, key, newVal)
    if (key === quickEdit.trKey && newVal === 'IND' && !row[quickEdit.vehKey]) {
      await onSave(quickEdit.rowId, quickEdit.vehKey, 'Car')
    }
  }

  return (
    <div data-quick-popup
      className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-56"
      style={{ top, left }}>
      <div className="text-xs font-semibold text-gray-500 mb-2">Tip transfera</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {TRANSFER_TYPES.map(t => (
          <button key={t} onClick={() => pick(quickEdit.trKey, t)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
              trVal === t ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-700 border-gray-300 hover:border-sky-400 hover:text-sky-600'
            }`}>{t}</button>
        ))}
      </div>
      <div className="text-xs font-semibold text-gray-500 mb-2">Tip vozila</div>
      <div className="flex flex-wrap gap-1.5">
        {VEHICLE_TYPES.map(v => (
          <button key={v} onClick={() => pick(quickEdit.vehKey, v)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
              vehVal === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'
            }`}>{VEHICLE_ICON[v]} {v}</button>
        ))}
      </div>
    </div>
  )
}

// ── Edit Modal ────────────────────────────────────────────────────
function EditModal({ row, cols, onChange, onSave, onClose, saving, arrFlightOpts = [], depFlightOpts = [] }) {
  function set(key, val) { onChange(prev => ({ ...prev, [key]: val || null })) }

  const editCols = [
    ...cols.filter(c => c.type !== 'transfer'),
    { key: 'arr_transfer_alias',  label: 'Transfer dol.',    type: 'transfer-sel' },
    { key: 'arr_vehicle_type',    label: 'Vozilo dol.',      type: 'vehicle-sel'  },
    { key: 'dep_transfer_alias',  label: 'Transfer odl.',    type: 'transfer-sel' },
    { key: 'dep_vehicle_type',    label: 'Vozilo odl.',      type: 'vehicle-sel'  },
    { key: 'placement',           label: 'Smještaj (opis)',  type: 'text'         },
    { key: 'arr_pick_time',       label: 'Pickup dol.',      type: 'text'         },
    { key: 'dep_pick_time',       label: 'Pickup odl.',      type: 'text'         },
    { key: 'customer_private_note', label: 'Privatna napomena', type: 'text'      },
  ].filter((c, i, arr) => arr.findIndex(x => x.key === c.key) === i)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <div className="font-bold text-gray-900">{row.tourist_name || '—'}</div>
            <div className="text-xs text-gray-400">Rez. {row.claim_inc} · {row.hotel_name}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {editCols.map(c => (
              <div key={c.key}>
                <label className="label text-xs">{c.label}</label>
                {c.type === 'date' ? (
                  <input type="date" className="input text-sm"
                    value={row[c.key] || ''} onChange={e => set(c.key, e.target.value)} />
                ) : c.type === 'flight-arr' ? (
                  <FlightSelect
                    value={row[c.key] || ''} opts={arrFlightOpts}
                    onChange={val => set(c.key, val)} />
                ) : c.type === 'flight-dep' ? (
                  <FlightSelect
                    value={row[c.key] || ''} opts={depFlightOpts}
                    onChange={val => set(c.key, val)} />
                ) : c.type === 'transfer-sel' ? (
                  <select className="input text-sm" value={row[c.key] || ''} onChange={e => set(c.key, e.target.value)}>
                    <option value="">—</option>
                    {TRANSFER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : c.type === 'vehicle-sel' ? (
                  <select className="input text-sm" value={row[c.key] || ''} onChange={e => set(c.key, e.target.value)}>
                    <option value="">—</option>
                    {VEHICLE_TYPES.map(t => <option key={t} value={t}>{VEHICLE_ICON[t]} {t}</option>)}
                  </select>
                ) : c.key.includes('note') || c.key.includes('comment') ? (
                  <textarea className="input text-sm h-16 resize-none"
                    value={row[c.key] || ''} onChange={e => set(c.key, e.target.value)} />
                ) : (
                  <input type={c.type === 'number' ? 'number' : 'text'} className="input text-sm"
                    value={row[c.key] ?? ''} onChange={e => set(c.key, e.target.value)} />
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost">Otkaži</button>
          <button onClick={onSave} disabled={saving} className="btn-primary">
            {saving ? 'Čuvanje...' : '💾 Sačuvaj'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FlightSelect ──────────────────────────────────────────────────
// Searchable dropdown za izbor leta iz predefinisane liste.
// Ako trenutna vrijednost nije u listi (npr. importovana kao alias),
// prikazuje je kao extra opciju da se ne izgubi podatak.
function FlightSelect({ value, opts, onChange }) {
  const [search, setSearch] = useState('')
  const [open,   setOpen]   = useState(false)
  const ref = useRef()

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const lower    = search.toLowerCase()
  const filtered = opts.filter(o => o.toLowerCase().includes(lower))

  // Ako postojeća vrijednost nije u listi (alias ili nepoznat let), prikaži je na vrhu
  const showExtra = value && !opts.includes(value)

  function select(val) { onChange(val); setSearch(''); setOpen(false) }
  function clear(e)    { e.stopPropagation(); onChange(''); setOpen(false) }

  return (
    <div ref={ref} className="relative">
      <div className={`input text-sm flex items-center gap-1 cursor-pointer select-none ${open ? 'ring-2 ring-sky-400 border-sky-400' : ''}`}
        onClick={() => setOpen(o => !o)}>
        {value
          ? <span className="font-mono font-semibold text-sky-700 flex-1">{value}</span>
          : <span className="text-gray-400 flex-1">— odaberi let —</span>}
        {value && (
          <button onClick={clear} className="text-gray-300 hover:text-gray-600 text-base leading-none ml-1">×</button>
        )}
        <span className="text-gray-400 text-xs ml-1">▾</span>
      </div>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b">
            <input autoFocus type="text" placeholder="Pretraži..."
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:border-sky-400"
              value={search} onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()} />
          </div>
          <div className="max-h-52 overflow-y-auto">
            <div className="px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50 cursor-pointer"
              onClick={() => select('')}>— bez leta —</div>
            {showExtra && (
              <div className="px-3 py-1.5 text-sm font-mono font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 cursor-pointer flex items-center gap-2"
                onClick={() => select(value)}>
                {value}
                <span className="text-xs font-normal text-amber-500">(nije u rasporedu)</span>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">Nema rezultata</div>
            )}
            {filtered.map(o => (
              <div key={o}
                className={`px-3 py-1.5 text-sm font-mono cursor-pointer hover:bg-sky-50 transition-colors ${o === value ? 'bg-sky-50 font-bold text-sky-700' : 'text-gray-800'}`}
                onClick={() => select(o)}>
                {o}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Hotel Resolution Modal ────────────────────────────────────────
const EMPTY_HOTEL_FORM = {
  hotel_code: '', zone_id: '',
  time_to_tiv: '', time_to_tgd: '',
  pickup_point: '', geo_lat: '', geo_lng: '',
}

function HotelResolutionModal({ items, recordCount, onComplete, onCancel }) {
  const [added,      setAdded]      = useState(new Set())     // names that are done
  const [addingFor,  setAddingFor]  = useState(null)          // { name, town }
  const [form,       setForm]       = useState(EMPTY_HOTEL_FORM)
  const [zones,      setZones]      = useState([])
  const [saving,     setSaving]     = useState(false)
  const [formError,  setFormError]  = useState('')

  useEffect(() => {
    supabase.from('zones').select('id, name').order('name').then(({ data }) => setZones(data || []))
  }, [])

  const allDone = added.size === items.length

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })) }

  function openAdd(item) {
    setForm({ ...EMPTY_HOTEL_FORM })
    setFormError('')
    setAddingFor(item)
  }

  async function saveHotel() {
    if (!form.hotel_code || !form.time_to_tiv || !form.time_to_tgd) {
      setFormError('ID, Vrijeme do TIV i Vrijeme do TGD su obavezna polja')
      return
    }
    setSaving(true)
    setFormError('')
    const payload = {
      name:         addingFor.name,
      hotel_code:   parseInt(form.hotel_code),
      zone_id:      form.zone_id || null,
      time_to_tiv:  parseInt(form.time_to_tiv),
      time_to_tgd:  parseInt(form.time_to_tgd),
      pickup_point: form.pickup_point.trim() || null,
      geo_lat:      form.geo_lat !== '' ? parseFloat(form.geo_lat) : null,
      geo_lng:      form.geo_lng !== '' ? parseFloat(form.geo_lng) : null,
    }
    const { error } = await supabase.from('hotels').insert(payload)
    if (error) {
      setFormError('Greška: ' + error.message)
    } else {
      setAdded(s => new Set([...s, addingFor.name]))
      setAddingFor(null)
    }
    setSaving(false)
  }

  function fmtMin(min) {
    if (!min) return ''
    const h = Math.floor(min / 60), m = min % 60
    return h > 0 ? `${h}h ${m}min` : `${m} min`
  }

  // ── Add form ─────────────────────────────────────────────────
  if (addingFor) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          <div className="px-5 py-4 border-b">
            <div className="font-bold text-gray-900">🏨 Dodaj hotel u bazu</div>
            <div className="text-sm text-gray-500 mt-0.5">
              <span className="font-semibold text-red-600">{addingFor.name}</span>
              {addingFor.town && <span className="text-gray-400"> · {addingFor.town}</span>}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {formError && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{formError}</div>}

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="label text-xs">Naziv hotela</label>
                <input className="input text-sm bg-gray-50" value={addingFor.name} disabled />
              </div>
              <div>
                <label className="label text-xs">ID (sortiranje) *</label>
                <input autoFocus className="input text-sm font-mono" type="number" min="1"
                  placeholder="101" value={form.hotel_code} onChange={e => setF('hotel_code', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label text-xs">Zona</label>
              <select className="input text-sm" value={form.zone_id} onChange={e => setF('zone_id', e.target.value)}>
                <option value="">— Odaberi zonu —</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>

            <div className="border-t pt-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                ⏱ Pickup vremena (minute prije polijetanja)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">→ TIV (min) *</label>
                  <input className="input text-sm font-mono" type="number" min="0" max="300"
                    placeholder="45" value={form.time_to_tiv} onChange={e => setF('time_to_tiv', e.target.value)} />
                  {form.time_to_tiv && (
                    <p className="text-xs text-gray-400 mt-1">{fmtMin(parseInt(form.time_to_tiv))} prije polijetanja</p>
                  )}
                </div>
                <div>
                  <label className="label text-xs">→ TGD (min) *</label>
                  <input className="input text-sm font-mono" type="number" min="0" max="300"
                    placeholder="120" value={form.time_to_tgd} onChange={e => setF('time_to_tgd', e.target.value)} />
                  {form.time_to_tgd && (
                    <p className="text-xs text-gray-400 mt-1">{fmtMin(parseInt(form.time_to_tgd))} prije polijetanja</p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                📍 Lokacija (opcionalno)
              </div>
              <div>
                <label className="label text-xs">Pickup point</label>
                <input className="input text-sm" placeholder="Ispred glavnog ulaza"
                  value={form.pickup_point} onChange={e => setF('pickup_point', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="label text-xs">Geo lat</label>
                  <input className="input text-sm font-mono" type="number" step="0.0000001"
                    placeholder="42.274680" value={form.geo_lat} onChange={e => setF('geo_lat', e.target.value)} />
                </div>
                <div>
                  <label className="label text-xs">Geo lng</label>
                  <input className="input text-sm font-mono" type="number" step="0.0000001"
                    placeholder="18.840280" value={form.geo_lng} onChange={e => setF('geo_lng', e.target.value)} />
                </div>
              </div>
            </div>
          </div>
          <div className="px-5 py-4 border-t flex justify-end gap-3">
            <button onClick={() => setAddingFor(null)} className="btn-ghost text-sm">Nazad</button>
            <button onClick={saveHotel} disabled={saving} className="px-5 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Čuvanje...' : '💾 Sačuvaj hotel'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Lista hotela za dodavanje ─────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b">
          <div className="font-bold text-gray-900 text-lg">🏨 Provjera hotela</div>
          <div className="text-sm text-gray-500 mt-0.5">
            Pronađeno {items.length} {items.length === 1 ? 'hotel koji nije' : 'hotela koji nisu'} u bazi.
            Potrebno dodati prije uvoza {recordCount} zapisa.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full">
              <div className="h-1.5 bg-blue-500 rounded-full transition-all"
                style={{ width: `${items.length ? (added.size / items.length) * 100 : 0}%` }} />
            </div>
            <span className="text-xs text-gray-500">{added.size}/{items.length} dodano</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {items.map(item => {
            const done = added.has(item.name)
            return (
              <div key={item.name}
                className={`p-3 rounded-lg border text-sm flex items-center justify-between gap-4 ${done ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'}`}>
                <div>
                  <div className="font-semibold text-gray-800">{item.name}</div>
                  {item.town && <div className="text-xs text-gray-500">{item.town}</div>}
                </div>
                {done ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium shrink-0">
                    ✓ Dodan
                  </span>
                ) : (
                  <button onClick={() => openAdd(item)}
                    className="px-3 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 shrink-0">
                    + Dodaj hotel
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-5 py-4 border-t flex items-center justify-between">
          <button onClick={onCancel} className="btn-ghost text-sm">✕ Otkaži uvoz</button>
          <button onClick={onComplete} disabled={!allDone}
            className="px-5 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {allDone ? `✅ Nastavi (provjera letova →)` : `Čeka se ${items.length - added.size} hotela`}
          </button>
        </div>
      </div>
    </div>
  )
}
