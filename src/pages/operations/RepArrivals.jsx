import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../App'
import { normalize, fmtTime, getDayName, findScheduleForDay, calcPickupTime } from '../../lib/transferUtils'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

// Isti redoslijed kao na "Lista odlazaka": GRP → SHA → IND, pa po pickup_time (najranije prvo)
const TR_ORDER = { GRP: 0, SHA: 1, IND: 2 }
function sortDepartures(list) {
  return [...list].sort((a, b) => {
    const oa = TR_ORDER[a.dep_transfer_alias] ?? 50
    const ob = TR_ORDER[b.dep_transfer_alias] ?? 50
    if (oa !== ob) return oa - ob
    const pa = a._pickupTime || '99:99'
    const pb = b._pickupTime || '99:99'
    return pa.localeCompare(pb)
  })
}

// Pickup vrijeme: koristi sačuvani dep_pick_time ako postoji, inače izračunaj
// iz rasporeda leta (scheduled_time) i vremena vožnje hotel→aerodrom
// (identična logika kao u GroupSchedule.jsx / DepartureList.jsx enrich()).
function computePickupTime(r, flightNormMap, hotelMap, dayName) {
  if (r.dep_pick_time) return r.dep_pick_time
  const match = flightNormMap[normalize(r.dep_flight_name)]
  const sched = findScheduleForDay(match?.DEP || [], dayName)
  const hotel = hotelMap[r.hotel_name]
  if (sched && hotel) {
    const mins = sched.airport === 'TIV' ? hotel.time_to_tiv : hotel.time_to_tgd
    return calcPickupTime(sched.scheduled_time, mins)
  }
  return null
}

const TR_BADGE = {
  GRP: { label: '🚌 GRP', cls: 'bg-indigo-100 text-indigo-700' },
  SHA: { label: '🚐 SHA', cls: 'bg-purple-100 text-purple-700' },
  IND: { label: '🚕 IND', cls: 'bg-pink-100 text-pink-700' },
}

// ── Kartica gosta ────────────────────────────────────────────────
function GuestCard({ rec, direction, onPhoneSave, pickedUp, onTogglePickup }) {
  const [phone, setPhone]   = useState(rec.phone || '')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const inputRef = useRef(null)
  const isDep = direction === 'dep'

  // Sync ako se promijeni rec izvana (npr. refresh)
  // Skidamo vodeći + za prikaz u inputu (dodajemo ga nazad pri save)
  useEffect(() => {
    const p = rec.phone || ''
    setPhone(p.startsWith('+') ? p.slice(1) : p)
  }, [rec.phone])

  async function save(val) {
    const digits  = val.trim().replace(/^\+/, '') // ukloni + ako ga je neko ukucao
    const full    = digits ? '+' + digits : null  // uvijek čuvamo sa +
    const current = rec.phone || null
    if (full === current) return                  // ništa novo
    setSaving(true)
    const dateKey = direction === 'arr' ? 'date_beg' : 'date_end'
    const { error } = await supabase
      .from('rooming_list')
      .update({ phone: full })
      .eq('claim_inc', rec.claim_inc)
      .eq(dateKey, rec[dateKey])
    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onPhoneSave(rec.claim_inc, rec[dateKey], full)
    }
  }

  const hasPhone = !!(phone.trim())
  const flightName = direction === 'arr' ? rec.arr_flight_name : rec.dep_flight_name
  const trBadge = isDep ? TR_BADGE[rec.dep_transfer_alias] : null

  return (
    <div className={`rounded-xl border-2 p-4 transition-colors ${
      isDep && pickedUp
        ? 'border-gray-200 bg-gray-100'
        : hasPhone ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
    }`}>
      {/* Gornji red: ime + let */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className={`font-bold text-base leading-tight truncate ${
            isDep && pickedUp ? 'text-gray-400 line-through' : 'text-gray-900'
          }`}>
            {rec.tourist_name || '—'}
          </div>
          <div className="text-sm text-gray-500 mt-0.5 truncate">
            🏨 {rec.hotel_name || '—'}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {trBadge && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${trBadge.cls}`}>{trBadge.label}</span>
          )}
          {flightName && (
            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
              direction === 'arr' ? 'text-sky-700 bg-sky-100' : 'text-orange-700 bg-orange-100'
            }`}>
              ✈ {flightName}
            </span>
          )}
          {isDep && rec._pickupTime && (
            <span className="text-xs font-mono font-bold text-orange-600">
              🕐 {fmtTime(rec._pickupTime)}
            </span>
          )}
          <span className="text-xs text-gray-400">#{rec.claim_inc}</span>
        </div>
      </div>

      {/* Donji red: pax + phone input + poziv */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-gray-500 flex-shrink-0">
          👥 {(rec.adult || 0) + (rec.child || 0)} gosta
        </span>
        <div className="flex-1 relative flex items-center">
          <span className={`absolute left-3 font-mono font-bold text-sm select-none pointer-events-none
            ${hasPhone ? 'text-green-600' : 'text-gray-400'}`}>+</span>
          <input
            ref={inputRef}
            type="tel"
            inputMode="numeric"
            placeholder="Broj telefona..."
            value={phone}
            onChange={e => { setPhone(e.target.value.replace(/^\+/, '')); setSaved(false) }}
            onBlur={e => save(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.target.blur() } }}
            className={`w-full text-sm font-mono rounded-lg pl-7 pr-8 py-2.5 border-2 outline-none transition-colors
              ${hasPhone
                ? 'border-green-400 bg-white focus:border-green-500'
                : 'border-gray-300 bg-gray-50 focus:border-brand-400 focus:bg-white'
              }`}
          />
          {/* Status indikator */}
          {saving && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">⏳</span>
          )}
          {saved && !saving && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-green-600 font-bold">✓</span>
          )}
          {hasPhone && !saving && !saved && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-green-500">📞</span>
          )}
        </div>
        {hasPhone && (
          <a
            href={`tel:+${phone.trim()}`}
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg bg-green-500 text-white text-lg active:bg-green-600"
          >
            📞
          </a>
        )}
      </div>

      {/* Dugme "ukrcan" — samo kod odlaska */}
      {isDep && (
        <button
          onClick={onTogglePickup}
          className={`mt-3 w-full py-3 rounded-xl font-bold text-sm transition-colors ${
            pickedUp
              ? 'bg-green-600 text-white active:bg-green-700'
              : 'bg-gray-50 text-gray-600 border-2 border-dashed border-gray-300 active:bg-gray-200'
          }`}
        >
          {pickedUp ? '✓ U autobusu — poništi' : '☐ Označi da je ukrcan/a'}
        </button>
      )}
    </div>
  )
}

// ── Glavna stranica ──────────────────────────────────────────────
export default function RepArrivals() {
  const { profile, isRep } = useAuth()
  const [date,        setDate]        = useState(todayStr())
  const [arrivals,    setArrivals]    = useState([])
  const [departures,  setDepartures]  = useState([])
  const [hasAssignment, setHasAssignment] = useState(true) // samo relevantno za predstavnika
  const [tab,          setTab]          = useState('arr') // 'arr' | 'dep'
  const [loading,     setLoading]     = useState(false)
  const [loadErr,     setLoadErr]     = useState(null)
  const [query,       setQuery]       = useState('')
  const [flightFilter, setFlightFilter] = useState('')
  const searchRef = useRef(null)

  useEffect(() => { load() }, [date, profile?.id, isRep])

  async function load() {
    if (!profile?.id) return
    setLoading(true)
    setLoadErr(null)
    setQuery('')
    setFlightFilter('')

    // Admin i dispečer vide SVE letove tog dana (pun pristup, bez filtera po dodjeli).
    // Predstavnik vidi samo let(ove) koji su mu dodijeljeni na "Grupni transferi" stranici.
    let arrFlights = null // null = bez filtriranja (vidi sve)
    let depFlights = null

    if (isRep) {
      const { data: assigned, error: assignErr } = await supabase
        .from('group_transfer_orders')
        .select('type, arr_flight, dep_flight, flight_name')
        .eq('date', date)
        .eq('assigned_rep_id', profile.id)

      if (assignErr) {
        setLoadErr(assignErr.message?.includes('assigned_rep_id')
          ? 'Kolona "assigned_rep_id" ne postoji u bazi. Pokreni supabase_rep_flight_assignment.sql u Supabase SQL editoru.'
          : 'Greška: ' + assignErr.message
        )
        setLoading(false)
        return
      }

      arrFlights = new Set()
      depFlights = new Set()
      for (const row of (assigned || [])) {
        if (row.type === 'RT') {
          if (row.arr_flight) arrFlights.add(normalize(row.arr_flight))
          if (row.dep_flight) depFlights.add(normalize(row.dep_flight))
        } else if (row.type === 'arr' && row.flight_name) {
          arrFlights.add(normalize(row.flight_name))
        } else if (row.type === 'dep' && row.flight_name) {
          depFlights.add(normalize(row.flight_name))
        }
      }

      if (arrFlights.size === 0 && depFlights.size === 0) {
        setHasAssignment(false)
        setArrivals([])
        setDepartures([])
        setLoading(false)
        return
      }
    }
    setHasAssignment(true)

    // Učitaj goste sa rooming liste za taj datum (i filtriraj po dodijeljenom letu ako je predstavnik)
    const needArr = !isRep || arrFlights.size > 0
    const needDep = !isRep || depFlights.size > 0

    const [{ data: arrData, error: arrErr }, { data: depData, error: depErr }] = await Promise.all([
      needArr
        ? supabase.from('rooming_list')
            .select('claim_inc, date_beg, tourist_name, hotel_name, arr_flight_name, adult, child, phone')
            .eq('date_beg', date)
            .not('arr_flight_name', 'is', null)
            .order('tourist_name')
        : Promise.resolve({ data: [], error: null }),
      needDep
        ? supabase.from('rooming_list')
            .select('claim_inc, date_end, tourist_name, hotel_name, dep_flight_name, dep_pick_time, dep_transfer_alias, dep_picked_up, adult, child, phone')
            .eq('date_end', date)
            .not('dep_flight_name', 'is', null)
        : Promise.resolve({ data: [], error: null }),
    ])

    const err = arrErr || depErr
    if (err) {
      setLoadErr(err.message?.includes('dep_picked_up')
        ? 'Kolona "dep_picked_up" ne postoji u bazi. Pokreni supabase_dep_picked_up.sql u Supabase SQL editoru.'
        : err.message?.includes('phone')
        ? 'Kolona "phone" ne postoji u bazi. Pokreni supabase_phone.sql u Supabase SQL editoru:\n\nALTER TABLE rooming_list ADD COLUMN IF NOT EXISTS phone TEXT;'
        : 'Greška: ' + err.message
      )
      setLoading(false)
      return
    }

    const filteredArr = isRep
      ? (arrData || []).filter(g => arrFlights.has(normalize(g.arr_flight_name)))
      : (arrData || [])
    let depRows = isRep
      ? (depData || []).filter(g => depFlights.has(normalize(g.dep_flight_name)))
      : (depData || [])

    // Izračunaj pickup vrijeme za odlazak (dep_pick_time je često prazan u bazi —
    // stvarno vrijeme se računa iz rasporeda leta i vremena vožnje do hotela,
    // ista logika kao na "Grupni transferi" i "Lista odlazaka" stranicama).
    if (depRows.length > 0) {
      const hotelNames = [...new Set(depRows.map(r => r.hotel_name).filter(Boolean))]
      const [{ data: schedData }, { data: hotelsData }] = await Promise.all([
        supabase.from('flight_schedule')
          .select('flight_number,airport,direction,scheduled_time,days_of_week,aliases'),
        hotelNames.length
          ? supabase.from('hotels').select('name,time_to_tiv,time_to_tgd').in('name', hotelNames)
          : Promise.resolve({ data: [] }),
      ])

      const flightNormMap = {}
      for (const s of (schedData || [])) {
        const norm = normalize(s.flight_number)
        if (!flightNormMap[norm]) flightNormMap[norm] = { ARR: [], DEP: [] }
        flightNormMap[norm][s.direction]?.push(s)
        for (const alias of (s.aliases || [])) {
          const an = normalize(alias)
          if (!flightNormMap[an]) flightNormMap[an] = { ARR: [], DEP: [] }
          flightNormMap[an][s.direction]?.push(s)
        }
      }
      const hotelMap = Object.fromEntries((hotelsData || []).map(h => [h.name, h]))
      const dayName = getDayName(date)

      depRows = depRows.map(r => ({ ...r, _pickupTime: computePickupTime(r, flightNormMap, hotelMap, dayName) }))
    }

    const filteredDep = sortDepartures(depRows)
    setArrivals(filteredArr)
    setDepartures(filteredDep)
    // Ako ima samo odlazni let (bez dolaznog), otvori odmah tab odlazaka
    setTab(filteredArr.length === 0 && filteredDep.length > 0 ? 'dep' : 'arr')
    setLoading(false)
  }

  // Updejtuj phone lokalno bez re-fetcha
  const handlePhoneSave = useCallback((claimInc, dateKey, phone) => {
    setArrivals(prev => prev.map(g =>
      g.claim_inc === claimInc && g.date_beg === dateKey ? { ...g, phone } : g
    ))
    setDepartures(prev => prev.map(g =>
      g.claim_inc === claimInc && g.date_end === dateKey ? { ...g, phone } : g
    ))
  }, [])

  // Označi/poništi da je gost ukrcan u bus (odlazak) — kao precrtavanje imena na papiru
  const togglePickup = useCallback(async (rec) => {
    const next = !rec.dep_picked_up
    setDepartures(prev => prev.map(g =>
      g.claim_inc === rec.claim_inc && g.date_end === rec.date_end ? { ...g, dep_picked_up: next } : g
    ))
    const { error } = await supabase
      .from('rooming_list')
      .update({ dep_picked_up: next })
      .eq('claim_inc', rec.claim_inc)
      .eq('date_end', rec.date_end)
    if (error) {
      // vrati na staro ako čuvanje nije uspjelo
      setDepartures(prev => prev.map(g =>
        g.claim_inc === rec.claim_inc && g.date_end === rec.date_end ? { ...g, dep_picked_up: !next } : g
      ))
      alert('Greška pri čuvanju: ' + error.message)
    }
  }, [])

  const list = tab === 'arr' ? arrivals : departures

  // Svi dostupni letovi u trenutnom tabu (za filter chips — korisno kad admin/dispečer vidi sve letove)
  const flights = useMemo(() => {
    const set = new Set(list.map(g => (tab === 'arr' ? g.arr_flight_name : g.dep_flight_name)).filter(Boolean))
    return [...set].sort()
  }, [list, tab])

  // Klijentsko filtriranje — instant, bez API poziva
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return list.filter(g => {
      const flightName = tab === 'arr' ? g.arr_flight_name : g.dep_flight_name
      if (flightFilter && flightName !== flightFilter) return false
      if (!q) return true
      return (
        (g.tourist_name || '').toLowerCase().includes(q) ||
        (g.hotel_name || '').toLowerCase().includes(q) ||
        String(g.claim_inc).includes(q) ||
        (flightName || '').toLowerCase().includes(q)
      )
    })
  }, [list, query, tab, flightFilter])

  const withPhone    = list.filter(g => g.phone).length
  const withoutPhone = list.length - withPhone
  const pickedUpCount = tab === 'dep' ? list.filter(g => g.dep_picked_up).length : 0

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-gray-900 text-white shadow-lg">
        {/* Naslov + datum */}
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <span className="text-lg">📋</span>
          <span className="font-bold text-base flex-1">{isRep ? 'Moj raspored' : 'Dolasci i odlasci — svi letovi'}</span>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            onClick={e => e.target.showPicker?.()}
            className="bg-gray-800 text-white text-sm border border-gray-600 rounded-lg px-2 py-1.5 outline-none focus:border-gray-400"
          />
        </div>

        {/* Tabovi: dolazak / odlazak */}
        {!loading && hasAssignment && (arrivals.length > 0 || departures.length > 0) && (
          <div className="flex gap-2 px-4 pb-2">
            <button
              onClick={() => { setTab('arr'); setFlightFilter('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === 'arr' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400'
              }`}
            >
              🛬 Dolazak {arrivals.length > 0 && `(${arrivals.length})`}
            </button>
            <button
              onClick={() => { setTab('dep'); setFlightFilter('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === 'dep' ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400'
              }`}
            >
              🛫 Odlazak {departures.length > 0 && `(${departures.length})`}
            </button>
          </div>
        )}

        {/* Statistika */}
        {!loading && hasAssignment && list.length > 0 && (
          <div className="flex gap-3 px-4 pb-2 text-xs">
            <span className="text-gray-300">{list.length} rezervacija</span>
            {tab === 'dep' ? (
              <span className={`font-semibold ${pickedUpCount === list.length ? 'text-green-400' : 'text-sky-400'}`}>
                🚌 {pickedUpCount}/{list.length} ukrcano
              </span>
            ) : (
              <span className="text-green-400 font-semibold">✓ {withPhone} sa brojem</span>
            )}
            {withoutPhone > 0 && (
              <span className="text-yellow-400">⚠ {withoutPhone} bez broja</span>
            )}
          </div>
        )}

        {/* Search bar */}
        {!loading && hasAssignment && list.length > 0 && (
          <div className="px-4 pb-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">🔍</span>
              <input
                ref={searchRef}
                type="search"
                placeholder="Ime, hotel, broj rezervacije..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-xl pl-10 pr-4 py-3 text-base outline-none border border-gray-700 focus:border-gray-500"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xl p-1"
                >✕</button>
              )}
            </div>
          </div>
        )}

        {/* Filter po letu (korisno kad ima više letova, npr. admin/dispečer pregled) */}
        {!loading && hasAssignment && flights.length > 1 && (
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setFlightFilter('')}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                !flightFilter ? 'bg-brand-500 text-white' : 'bg-gray-700 text-gray-300'
              }`}
            >
              Svi letovi
            </button>
            {flights.map(f => (
              <button
                key={f}
                onClick={() => setFlightFilter(f === flightFilter ? '' : f)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  flightFilter === f ? 'bg-sky-500 text-white' : 'bg-gray-700 text-gray-300'
                }`}
              >
                ✈ {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Sadržaj ─────────────────────────────────────── */}
      <div className="p-3 pb-24">

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Učitavam raspored...</p>
          </div>
        )}

        {!loading && loadErr && (
          <div className="mx-1 mt-4 rounded-xl border border-red-300 bg-red-50 p-4">
            <p className="font-semibold text-red-700 mb-2">⚠️ Greška pri učitavanju</p>
            <pre className="text-xs text-red-600 whitespace-pre-wrap font-mono leading-relaxed">{loadErr}</pre>
            <button onClick={load} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium">
              Pokušaj ponovo
            </button>
          </div>
        )}

        {!loading && !loadErr && !hasAssignment && (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">📭</div>
            <p className="text-gray-500 font-medium">Nemate dodijeljen let za {fmtDate(date)}</p>
            <p className="text-gray-400 text-sm mt-1">Obratite se dispečeru da vam dodijeli nalog na stranici "Grupni transferi"</p>
          </div>
        )}

        {!loading && !loadErr && hasAssignment && list.length === 0 && (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">✈️</div>
            <p className="text-gray-500 font-medium">
              Nema {tab === 'arr' ? 'dolazaka' : 'odlazaka'} za {fmtDate(date)}
            </p>
          </div>
        )}

        {!loading && !loadErr && hasAssignment && list.length > 0 && filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-gray-500">Nema rezultata za <strong>"{query}"</strong></p>
            <button onClick={() => setQuery('')} className="mt-3 text-sm text-brand-600 underline">
              Obriši pretragu
            </button>
          </div>
        )}

        {/* Kartice */}
        {!loading && !loadErr && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map(rec => (
              <GuestCard
                key={`${rec.claim_inc}-${tab === 'arr' ? rec.date_beg : rec.date_end}`}
                rec={rec}
                direction={tab}
                onPhoneSave={handlePhoneSave}
                pickedUp={rec.dep_picked_up}
                onTogglePickup={() => togglePickup(rec)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Fiksni bottom bar (osvježi) ─────────────────── */}
      {!loading && (
        <div className="fixed bottom-0 left-0 right-0 z-10 bg-white border-t border-gray-200 px-4 py-3">
          <button
            onClick={load}
            className="w-full py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm active:bg-gray-200"
          >
            ↻ Osvježi listu
          </button>
        </div>
      )}
    </div>
  )
}
