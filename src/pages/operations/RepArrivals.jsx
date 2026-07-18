import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

// ── Kartica gosta ────────────────────────────────────────────────
function GuestCard({ rec, onPhoneSave }) {
  const [phone, setPhone]   = useState(rec.phone || '')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const inputRef = useRef(null)

  // Sync ako se promijeni rec izvana (npr. refresh)
  useEffect(() => { setPhone(rec.phone || '') }, [rec.phone])

  async function save(val) {
    const trimmed = val.trim()
    if (trimmed === (rec.phone || '')) return   // ništa novo
    setSaving(true)
    const { error } = await supabase
      .from('rooming_list')
      .update({ phone: trimmed || null })
      .eq('claim_inc', rec.claim_inc)
      .eq('date_beg', rec.date_beg)
    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onPhoneSave(rec.claim_inc, rec.date_beg, trimmed || null)
    }
  }

  const hasPhone = !!(phone.trim())

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
          {rec.arr_flight_name && (
            <span className="text-xs font-mono font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded">
              ✈ {rec.arr_flight_name}
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
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="tel"
            inputMode="tel"
            placeholder="Upiši tel. broj..."
            value={phone}
            onChange={e => { setPhone(e.target.value); setSaved(false) }}
            onBlur={e => save(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.target.blur() } }}
            className={`w-full text-sm font-mono rounded-lg px-3 py-2.5 border-2 outline-none transition-colors
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
  const [date,    setDate]    = useState(todayStr())
  const [guests,  setGuests]  = useState([])
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState(null)
  const [query,   setQuery]   = useState('')
  const [flight,  setFlight]  = useState('')
  const searchRef = useRef(null)

  useEffect(() => { load() }, [date])

  async function load() {
    setLoading(true)
    setLoadErr(null)
    setQuery('')

    const { data, error } = await supabase
      .from('rooming_list')
      .select('claim_inc, date_beg, tourist_name, hotel_name, arr_flight_name, adult, child, phone')
      .eq('date_beg', date)
      .not('arr_flight_name', 'is', null)
      .order('arr_flight_name')
      .order('tourist_name')

    if (error) {
      // Najčešći uzrok: phone kolona ne postoji — treba pokrenuti SQL migraciju
      setLoadErr(error.message?.includes('phone')
        ? 'Kolona "phone" ne postoji u bazi. Pokreni supabase_phone.sql u Supabase SQL editoru:\n\nALTER TABLE rooming_list ADD COLUMN IF NOT EXISTS phone TEXT;'
        : 'Greška: ' + error.message
      )
    } else {
      setGuests(data || [])
    }
    setLoading(false)
  }

  // Updejtuj phone lokalno bez re-fetcha
  const handlePhoneSave = useCallback((claimInc, dateBeg, phone) => {
    setGuests(prev => prev.map(g =>
      g.claim_inc === claimInc && g.date_beg === dateBeg
        ? { ...g, phone }
        : g
    ))
  }, [])

  // Svi dostupni letovi za filter
  const flights = useMemo(() => {
    const set = new Set(guests.map(g => g.arr_flight_name).filter(Boolean))
    return [...set].sort()
  }, [guests])

  // Klijentsko filtriranje — instant, bez API poziva
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return guests.filter(g => {
      if (flight && g.arr_flight_name !== flight) return false
      if (!q) return true
      return (
        (g.tourist_name || '').toLowerCase().includes(q) ||
        (g.hotel_name || '').toLowerCase().includes(q) ||
        String(g.claim_inc).includes(q) ||
        (g.arr_flight_name || '').toLowerCase().includes(q)
      )
    })
  }, [guests, query, flight])

  // Grupiši po letu za prikaz
  const grouped = useMemo(() => {
    const map = {}
    for (const g of filtered) {
      const key = g.arr_flight_name || '—'
      if (!map[key]) map[key] = []
      map[key].push(g)
    }
    return map
  }, [filtered])

  const withPhone    = guests.filter(g => g.phone).length
  const withoutPhone = guests.length - withPhone

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-gray-900 text-white shadow-lg">
        {/* Naslov + datum */}
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <span className="text-lg">📋</span>
          <span className="font-bold text-base flex-1">Lista dolazaka</span>
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); setFlight('') }}
            onClick={e => e.target.showPicker?.()}
            className="bg-gray-800 text-white text-sm border border-gray-600 rounded-lg px-2 py-1.5 outline-none focus:border-gray-400"
          />
        </div>

        {/* Statistika */}
        {!loading && guests.length > 0 && (
          <div className="flex gap-3 px-4 pb-2 text-xs">
            <span className="text-gray-300">{guests.length} rezervacija</span>
            <span className="text-green-400 font-semibold">✓ {withPhone} sa brojem</span>
            {withoutPhone > 0 && (
              <span className="text-yellow-400">⚠ {withoutPhone} bez broja</span>
            )}
          </div>
        )}

        {/* Search bar */}
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

        {/* Filter po letu (ako ima više letova) */}
        {flights.length > 1 && (
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setFlight('')}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                !flight ? 'bg-brand-500 text-white' : 'bg-gray-700 text-gray-300'
              }`}
            >
              Svi letovi
            </button>
            {flights.map(f => (
              <button
                key={f}
                onClick={() => setFlight(f === flight ? '' : f)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  flight === f ? 'bg-sky-500 text-white' : 'bg-gray-700 text-gray-300'
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
            <p className="text-gray-400 text-sm">Učitavam goste...</p>
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

        {!loading && !loadErr && guests.length === 0 && (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">✈️</div>
            <p className="text-gray-500 font-medium">Nema dolazaka za {fmtDate(date)}</p>
            <p className="text-gray-400 text-sm mt-1">Promijeni datum ili provjeri rooming listu</p>
          </div>
        )}

        {!loading && !loadErr && guests.length > 0 && filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-gray-500">Nema rezultata za <strong>"{query}"</strong></p>
            <button onClick={() => setQuery('')} className="mt-3 text-sm text-brand-600 underline">
              Obriši pretragu
            </button>
          </div>
        )}

        {/* Grupe po letovima */}
        {!loading && !loadErr && Object.entries(grouped).map(([flightName, recs]) => (
          <div key={flightName} className="mb-5">
            {/* Let header */}
            <div className="flex items-center gap-2 mb-2 px-1">
              <div className="flex-1 h-px bg-gray-300" />
              <span className="text-xs font-bold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-300">
                ✈ {flightName} — {recs.length} rezervacija
              </span>
              <div className="flex-1 h-px bg-gray-300" />
            </div>

            {/* Kartice */}
            <div className="space-y-2">
              {recs.map(rec => (
                <GuestCard
                  key={`${rec.claim_inc}-${rec.date_beg}`}
                  rec={rec}
                  onPhoneSave={handlePhoneSave}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Fiksni bottom bar (osvježi) ─────────────────── */}
      {!loading && guests.length > 0 && (
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
