import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const DAYS   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_HR = { Mon: 'Po', Tue: 'Ut', Wed: 'Sr', Thu: 'Če', Fri: 'Pe', Sat: 'Su', Sun: 'Ne' }
const AIRPORTS = ['TIV', 'TGD']
const DIRECTIONS = ['ARR', 'DEP']
const FLIGHT_TYPES = ['Redovni', 'Charter']

const EMPTY_FORM = {
  flight_number: '',
  airline: '',
  origin: '',
  destination: '',
  airport: 'TIV',
  direction: 'ARR',
  scheduled_time: '',
  days_of_week: [],
  flight_type: 'Redovni',
  valid_from: '',
  valid_to: '',
  aliases: [],
  return_flight: '',
  notes: '',
}

export default function FlightSchedule() {
  const [rows,        setRows]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [modal,       setModal]       = useState(null)   // null | 'add' | 'edit'
  const [form,        setForm]        = useState(EMPTY_FORM)
  const [saving,      setSaving]      = useState(false)
  const [aliasInput,  setAliasInput]  = useState('')
  const [filterApt,   setFilterApt]   = useState('')
  const [filterDir,   setFilterDir]   = useState('')
  const [filterType,  setFilterType]  = useState('')
  const [search,      setSearch]      = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    let q = supabase.from('flight_schedule').select('*').order('flight_number').order('scheduled_time')
    if (filterApt)  q = q.eq('airport', filterApt)
    if (filterDir)  q = q.eq('direction', filterDir)
    if (filterType) q = q.eq('flight_type', filterType)
    const { data, error } = await q
    if (error) console.error(error)
    setRows(data || [])
    setLoading(false)
  }

  const filtered = rows.filter(r => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      r.flight_number?.toLowerCase().includes(s) ||
      r.airline?.toLowerCase().includes(s) ||
      r.origin?.toLowerCase().includes(s) ||
      r.destination?.toLowerCase().includes(s) ||
      r.aliases?.some(a => a.toLowerCase().includes(s))
    )
  })

  // ── Form helpers ──────────────────────────────────────────────
  function setF(key, val) { setForm(p => ({ ...p, [key]: val })) }

  function toggleDay(day) {
    setForm(p => ({
      ...p,
      days_of_week: p.days_of_week.includes(day)
        ? p.days_of_week.filter(d => d !== day)
        : [...p.days_of_week, day]
    }))
  }

  function addAlias() {
    const v = aliasInput.trim().toUpperCase()
    if (!v || form.aliases.includes(v)) return
    setForm(p => ({ ...p, aliases: [...p.aliases, v] }))
    setAliasInput('')
  }

  function removeAlias(a) {
    setForm(p => ({ ...p, aliases: p.aliases.filter(x => x !== a) }))
  }

  function openAdd() {
    setForm(EMPTY_FORM)
    setAliasInput('')
    setModal('add')
  }

  async function openEdit(row) {
    // Pokupi aliase sa svih redova koji imaju isti broj leta (union)
    const { data: siblings } = await supabase
      .from('flight_schedule')
      .select('aliases')
      .eq('flight_number', row.flight_number)
    const allAliases = [...new Set((siblings || []).flatMap(s => s.aliases || []))]

    setForm({
      ...row,
      days_of_week:  row.days_of_week  || [],
      aliases:       allAliases,
      valid_from:    row.valid_from    || '',
      valid_to:      row.valid_to      || '',
      return_flight: row.return_flight || '',
    })
    setAliasInput('')
    setModal('edit')
  }

  function closeModal() { setModal(null) }

  async function save() {
    if (!form.flight_number || !form.airport || !form.direction) {
      alert('Broj leta, aerodrom i smjer su obavezni.')
      return
    }
    setSaving(true)
    const payload = {
      flight_number:  form.flight_number.trim().toUpperCase(),
      airline:        form.airline       || null,
      origin:         form.origin?.trim().toUpperCase() || null,
      destination:    form.destination?.trim().toUpperCase() || null,
      airport:        form.airport,
      direction:      form.direction,
      scheduled_time: form.scheduled_time || null,
      days_of_week:   form.days_of_week.length ? form.days_of_week : null,
      flight_type:    form.flight_type,
      valid_from:     form.valid_from || null,
      valid_to:       form.valid_to   || null,
      aliases:        form.aliases,
      return_flight:  form.return_flight?.trim().toUpperCase() || null,
      notes:          form.notes || null,
    }

    let error
    if (modal === 'add') {
      ;({ error } = await supabase.from('flight_schedule').insert(payload))
    } else {
      ;({ error } = await supabase.from('flight_schedule').update(payload).eq('id', form.id))
    }

    if (error) {
      alert('Greška: ' + error.message)
    } else {
      // Propagiraj aliase na SVE redove sa istim brojem leta
      if (payload.aliases?.length > 0) {
        await supabase
          .from('flight_schedule')
          .update({ aliases: payload.aliases })
          .eq('flight_number', payload.flight_number)
          .neq('id', form.id || 0)  // ostale redove (current je već sačuvan)
      }
      closeModal()
      await load()
    }
    setSaving(false)
  }

  async function deleteFlight(id) {
    if (!confirm('Obriši ovaj let?')) return
    await supabase.from('flight_schedule').delete().eq('id', id)
    await load()
  }

  function fmtDays(days) {
    if (!days || days.length === 0) return '—'
    if (days.length === 7) return 'Svaki dan'
    return days.map(d => DAYS_HR[d] || d).join(' ')
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">✈️ Rasporedi letova</h1>
          <button onClick={openAdd}
            className="px-4 py-1.5 rounded text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors">
            + Dodaj let
          </button>
        </div>

        {/* Filteri */}
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input text-sm w-28" value={filterApt} onChange={e => setFilterApt(e.target.value)}>
            <option value="">Aerodrom</option>
            {AIRPORTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input text-sm w-28" value={filterDir} onChange={e => setFilterDir(e.target.value)}>
            <option value="">Smjer</option>
            <option value="ARR">ARR (dolasci)</option>
            <option value="DEP">DEP (odlasci)</option>
          </select>
          <select className="input text-sm w-28" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">Tip</option>
            {FLIGHT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={load} className="btn-ghost text-sm px-3">🔍 Filtriraj</button>
          {(filterApt || filterDir || filterType) && (
            <button onClick={() => { setFilterApt(''); setFilterDir(''); setFilterType(''); load() }}
              className="btn-ghost text-sm px-3 text-gray-400">✕ Reset</button>
          )}
          <input type="text" placeholder="Pretraži let, avio-kompaniju, alias..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="input text-sm w-64 ml-2" />
          <span className="text-xs text-gray-400 ml-auto">
            {loading ? 'Učitavanje...' : `${filtered.length} letova`}
          </span>
        </div>
      </div>

      {/* ── Tabela ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-center text-gray-400 py-16">Učitavanje...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <div className="text-4xl mb-3">✈️</div>
            <p>Nema letova. Dodaj prvi let.</p>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200 w-10"></th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Let</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Avio-kompanija</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Pravac</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Apt</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Smjer</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Vrijeme</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Dani</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Tip</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Važi</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Aliasi ✏️</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-r border-gray-200">Povr. let ⇄</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Napomena</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={row.id}
                  className={`border-b border-gray-100 hover:bg-blue-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                  <td className="px-2 py-1.5 border-r border-gray-100">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(row)}
                        className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-blue-50 hover:border-blue-400 text-gray-500 transition-colors">✏️</button>
                      <button onClick={() => deleteFlight(row.id)}
                        className="px-1.5 py-0.5 rounded border border-gray-200 bg-white hover:bg-red-50 hover:border-red-300 text-gray-400 transition-colors">🗑</button>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-gray-900">{row.flight_number}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-gray-700">{row.airline || '—'}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-mono text-gray-700">
                    {row.origin && row.destination ? `${row.origin} → ${row.destination}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${row.airport === 'TIV' ? 'bg-sky-100 text-sky-700' : 'bg-purple-100 text-purple-700'}`}>
                      {row.airport}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${row.direction === 'ARR' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                      {row.direction}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 font-mono text-gray-900 font-medium">{row.scheduled_time || '—'}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-gray-600">{fmtDays(row.days_of_week)}</td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${row.flight_type === 'Charter' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {row.flight_type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100 text-gray-500 text-xs">
                    {row.valid_from && row.valid_to
                      ? `${row.valid_from.slice(5)} – ${row.valid_to.slice(5)}`
                      : row.valid_from ? `od ${row.valid_from.slice(5)}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    <div className="flex flex-wrap gap-1 items-center">
                      {(row.aliases || []).map(a => (
                        <span key={a} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-mono">{a}</span>
                      ))}
                      {(!row.aliases || row.aliases.length === 0) && (
                        filtered.some(r => r.flight_number === row.flight_number && r.id !== row.id && r.aliases?.length > 0)
                          ? <span className="text-[10px] text-amber-500 italic">← ima na srodnom</span>
                          : <span className="text-gray-300">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    {row.return_flight
                      ? <span className="font-mono font-semibold text-emerald-700">⇄ {row.return_flight}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 max-w-xs truncate" title={row.notes}>{row.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add/Edit Modal ──────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{modal === 'add' ? '+ Novi let' : `✏️ ${form.flight_number}`}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              {/* Red 1 — Let i avio-kompanija */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label text-xs">Broj leta *</label>
                  <input type="text" placeholder="TK1095" className="input text-sm uppercase"
                    value={form.flight_number}
                    onChange={e => setF('flight_number', e.target.value.toUpperCase())} />
                </div>
                <div>
                  <label className="label text-xs">Avio-kompanija</label>
                  <input type="text" placeholder="Turkish Airlines" className="input text-sm"
                    value={form.airline} onChange={e => setF('airline', e.target.value)} />
                </div>
              </div>

              {/* Red 2 — Pravac */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label text-xs">Polazak (IATA)</label>
                  <input type="text" placeholder="IST" maxLength={3} className="input text-sm uppercase"
                    value={form.origin} onChange={e => setF('origin', e.target.value.toUpperCase())} />
                </div>
                <div>
                  <label className="label text-xs">Odredište (IATA)</label>
                  <input type="text" placeholder="TIV" maxLength={3} className="input text-sm uppercase"
                    value={form.destination} onChange={e => setF('destination', e.target.value.toUpperCase())} />
                </div>
                <div>
                  <label className="label text-xs">Tiempo (HH:MM)</label>
                  <input type="time" className="input text-sm"
                    value={form.scheduled_time} onChange={e => setF('scheduled_time', e.target.value)} />
                </div>
              </div>

              {/* Red 3 — Aerodrom, smjer, tip */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label text-xs">Aerodrom *</label>
                  <select className="input text-sm" value={form.airport} onChange={e => setF('airport', e.target.value)}>
                    {AIRPORTS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label text-xs">Smjer *</label>
                  <select className="input text-sm" value={form.direction} onChange={e => setF('direction', e.target.value)}>
                    <option value="ARR">ARR — dolazak</option>
                    <option value="DEP">DEP — odlazak</option>
                  </select>
                </div>
                <div>
                  <label className="label text-xs">Tip leta</label>
                  <select className="input text-sm" value={form.flight_type} onChange={e => setF('flight_type', e.target.value)}>
                    {FLIGHT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Dani u sedmici */}
              <div>
                <label className="label text-xs mb-1">Dani u sedmici</label>
                <div className="flex gap-2">
                  {DAYS.map(d => (
                    <button key={d} type="button"
                      onClick={() => toggleDay(d)}
                      className={`w-9 h-9 rounded-full text-xs font-bold border transition-colors ${
                        form.days_of_week.includes(d)
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-sky-400'
                      }`}>
                      {DAYS_HR[d]}
                    </button>
                  ))}
                  <button type="button" onClick={() => setF('days_of_week', form.days_of_week.length === 7 ? [] : [...DAYS])}
                    className="px-3 h-9 rounded text-xs border border-gray-300 hover:bg-gray-50 text-gray-500 ml-2">
                    {form.days_of_week.length === 7 ? 'Resetuj' : 'Svaki dan'}
                  </button>
                </div>
              </div>

              {/* Sezonska valjanost */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label text-xs">Važi od</label>
                  <input type="date" className="input text-sm"
                    value={form.valid_from} onChange={e => setF('valid_from', e.target.value)} />
                </div>
                <div>
                  <label className="label text-xs">Važi do</label>
                  <input type="date" className="input text-sm"
                    value={form.valid_to} onChange={e => setF('valid_to', e.target.value)} />
                </div>
              </div>

              {/* Aliases */}
              <div>
                <label className="label text-xs">
                  Aliasi
                  <span className="ml-1 font-normal text-gray-400">(alternativni nazivi iz sistema partnera)</span>
                </label>
                <div className="flex gap-2 mb-2">
                  <input type="text" placeholder="npr. TK 1095, TK-1095"
                    className="input text-sm flex-1 uppercase font-mono"
                    value={aliasInput}
                    onChange={e => setAliasInput(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAlias() } }} />
                  <button type="button" onClick={addAlias}
                    className="px-3 py-1.5 rounded text-sm border border-gray-300 hover:bg-gray-50 text-gray-600">
                    + Dodaj
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-8">
                  {form.aliases.map(a => (
                    <span key={a} className="flex items-center gap-1 px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded text-xs font-mono">
                      {a}
                      <button type="button" onClick={() => removeAlias(a)} className="text-indigo-400 hover:text-indigo-700 leading-none">×</button>
                    </span>
                  ))}
                  {form.aliases.length === 0 && <span className="text-xs text-gray-300 italic">Nema aliasa</span>}
                </div>
              </div>

              {/* Povratni let */}
              <div>
                <label className="label text-xs">
                  Povratni let
                  <span className="ml-1 font-normal text-gray-400">(za RT grupni transfer — automatski filtrira suprotni smjer)</span>
                </label>
                <select
                  className="input text-sm font-mono"
                  value={form.return_flight}
                  onChange={e => setF('return_flight', e.target.value)}
                >
                  <option value="">— Nema povratnog leta —</option>
                  {(() => {
                    const candidates = rows.filter(r =>
                      r.direction     !== form.direction &&
                      r.airport       === form.airport &&
                      r.flight_number !== form.flight_number
                    )
                    // Grupiši po flight_number, prikupi sva vremena/dane
                    const grouped = {}
                    for (const r of candidates) {
                      if (!grouped[r.flight_number]) grouped[r.flight_number] = []
                      grouped[r.flight_number].push(r)
                    }
                    return Object.entries(grouped)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([fn, schedules]) => {
                        const airline = schedules[0]?.airline || ''
                        const timesDays = schedules
                          .sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''))
                          .map(s => {
                            const t = s.scheduled_time ? s.scheduled_time.slice(0,5) : '—'
                            const d = (s.days_of_week || []).map(x => DAYS_HR[x] || x).join('')
                            return d ? `${t}(${d})` : t
                          })
                          .join(', ')
                        return (
                          <option key={fn} value={fn}>
                            {fn}{airline ? ` · ${airline}` : ''} — {timesDays}
                          </option>
                        )
                      })
                  })()}
                </select>
              </div>

              {/* Napomena */}
              <div>
                <label className="label text-xs">Napomena</label>
                <textarea className="input text-sm h-14 resize-none"
                  value={form.notes} onChange={e => setF('notes', e.target.value)} />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t flex justify-end gap-3">
              <button onClick={closeModal} className="btn-ghost">Otkaži</button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? 'Čuvanje...' : '💾 Sačuvaj'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
