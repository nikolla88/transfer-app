import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../App'
import { normalize, fmtTime } from '../../lib/transferUtils'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

// ── Kartica gosta ────────────────────────────────────────────────
function GuestCard({ rec, direction, onPhoneSave }) {
  const [phone, setPhone]   = useState(rec.phone || '')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const inputRef = useRef(null)

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

  return (
    <div className={`rounded-xl border-2 p-4 transition-colors ${
      hasPhone ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
    }`}>
      {/* Gornji red: ime + let */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-gray-900 text-base leading-tight truncate">
            {rec.tourist_name || '—'}
          </div>
          <div className="text-sm text-gray-500 mt-0.5 truncate">
            🏨 {rec.hotel_name || '—'}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {flightName && (
            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
              direction === 'arr' ? 'text-sky-700 bg-sky-100' : 'text-orange-700 bg-orange-100'
            }`}>
              ✈ {flightName}
            </span>
          )}
          {direction === 'dep' && rec.dep_pick_time && (
            <span className="text-xs font-mono font-bold text-orange-600">
              🕐 {fmtTime(rec.dep_pick_time)}
            </span>
          )}
          <span className="text-xs text-gray-400">#{rec.claim_inc}</span>
        </div>
      </div>

      {/* Donji red: pax + phone input */}
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
      </div>
    </div>
  )
}

// ── Glavna stranica ──────────────────────────────────────────────
export default function RepArrivals() {
  const { profile } = useAuth()
  const [date,        setDate]        = useState(todayStr())
  const [arrivals,    setArrivals]    = useState([])
  const [departures,  setDepartures]  = useState([])
  const [hasAssignment, setHasAssignment] = useState(true) // dok se ne učita, ne prikazuj prazno stanje
  const [tab,          setTab]          = useState('arr') // 'arr' | 'dep'
  const [loading,     setLoading]     = useState(false)
  const [loadErr,     setLoadErr]     = useState(null)
  const [query,       setQuery]       = useState('')
  const searchRef = useRef(null)

  useEffect(() => { load() }, [date, profile?.id])

  async function load() {
    if (!profile?.id) return
    setLoading(true)
    setLoadErr(null)
    setQuery('')

    // 1. Nađi nalog(e) dodijeljen(e) ovom predstavniku za izabrani datum
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

    const arrFlights = new Set()
    const depFlights = new Set()
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
    setHasAssignment(true)

    // 2. Učitaj goste sa rooming liste za taj datum i filtriraj po dodijeljenom letu
    const [{ data: arrData, error: arrErr }, { data: depData, error: depErr }] = await Promise.all([
      arrFlights.size
        ? supabase.from('rooming_list')
            .select('claim_inc, date_beg, tourist_name, hotel_name, arr_flight_name, adult, child, phone')
            .eq('date_beg', date)
            .not('arr_flight_name', 'is', null)
            .order('tourist_name')
        : Promise.resolve({ data: [], error: null }),
      depFlights.size
        ? supabase.from('rooming_list')
            .select('claim_inc, date_end, tourist_name, hotel_name, dep_flight_name, dep_pick_time, adult, child, phone')
            .eq('date_end', date)
            .not('dep_flight_name', 'is', null)
            .order('dep_pick_time')
        : Promise.resolve({ data: [], error: null }),
    ])

    const err = arrErr || depErr
    if (err) {
      setLoadErr(err.message?.includes('phone')
        ? 'Kolona "phone" ne postoji u bazi. Pokreni supabase_phone.sql u Supabase SQL editoru:\n\nALTER TABLE rooming_list ADD COLUMN IF NOT EXISTS phone TEXT;'
        : 'Greška: ' + err.message
      )
      setLoading(false)
      return
    }

    const filteredArr = (arrData || []).filter(g => arrFlights.has(normalize(g.arr_flight_name)))
    const filteredDep = (depData || []).filter(g => depFlights.has(normalize(g.dep_flight_name)))
    setArrivals(filteredArr)
    setDepartures(filteredDep)
    // Ako predstavnik ima samo odlazni let (bez dolaznog), otvori odmah tab odlazaka
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

  const list = tab === 'arr' ? arrivals : departures

  // Klijentsko filtriranje — instant, bez API poziva
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return list
    return list.filter(g => {
      const flightName = tab === 'arr' ? g.arr_flight_name : g.dep_flight_name
      return (
        (g.tourist_name || '').toLowerCase().includes(q) ||
        (g.hotel_name || '').toLowerCase().includes(q) ||
        String(g.claim_inc).includes(q) ||
        (flightName || '').toLowerCase().includes(q)
      )
    })
  }, [list, query, tab])

  const withPhone    = list.filter(g => g.phone).length
  const withoutPhone = list.length - withPhone

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-gray-900 text-white shadow-lg">
        {/* Naslov + datum */}
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <span className="text-lg">📋</span>
          <span className="font-bold text-base flex-1">Moj raspored</span>
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
              onClick={() => setTab('arr')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === 'arr' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400'
              }`}
            >
              🛬 Dolazak {arrivals.length > 0 && `(${arrivals.length})`}
            </button>
            <button
              onClick={() => setTab('dep')}
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
            <span className="text-green-400 font-semibold">✓ {withPhone} sa brojem</span>
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
