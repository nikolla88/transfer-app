import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'

const EMPTY = {
  name: '',
  hotel_code: '',
  zone_id: '',
  time_to_tiv: '',
  time_to_tgd: '',
  pickup_point: '',
  geo_lat: '',
  geo_lng: '',
}

export default function Hotels() {
  const [rows,   setRows]   = useState([])
  const [zones,  setZones]  = useState([])
  const [modal,  setModal]  = useState(false)
  const [form,   setForm]   = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [search, setSearch] = useState('')
  const [sortBy,  setSortBy]  = useState('hotel_code')
  const [sortDir, setSortDir] = useState('asc')
  // Inline edit: { id, field: 'time_to_tiv'|'time_to_tgd'|'pickup_point', val }
  const [inlineEdit, setInlineEdit] = useState(null)
  const TEXT_FIELDS = new Set(['pickup_point'])

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: h }, { data: z }] = await Promise.all([
      supabase.from('hotels').select('*, zones(name)').order('hotel_code', { nullsFirst: false }).order('name'),
      supabase.from('zones').select('id, name').order('name'),
    ])
    setRows(h || [])
    setZones(z || [])
  }

  function openNew()   { setForm(EMPTY); setError(''); setModal(true) }
  function openEdit(r) {
    setForm({
      ...EMPTY, ...r,
      zone_id:    r.zone_id    || '',
      hotel_code: r.hotel_code ?? '',
      time_to_tiv: r.time_to_tiv ?? '',
      time_to_tgd: r.time_to_tgd ?? '',
      pickup_point: r.pickup_point || '',
      geo_lat: r.geo_lat ?? '',
      geo_lng: r.geo_lng ?? '',
    })
    setError('')
    setModal(true)
  }

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })) }

  async function save() {
    setSaving(true); setError('')
    const payload = {
      name:         form.name.trim(),
      hotel_code:   form.hotel_code !== '' ? parseInt(form.hotel_code) : null,
      zone_id:      form.zone_id || null,
      time_to_tiv:  form.time_to_tiv !== '' ? parseInt(form.time_to_tiv) : null,
      time_to_tgd:  form.time_to_tgd !== '' ? parseInt(form.time_to_tgd) : null,
      pickup_point: form.pickup_point.trim() || null,
      geo_lat:      form.geo_lat !== '' ? parseFloat(form.geo_lat) : null,
      geo_lng:      form.geo_lng !== '' ? parseFloat(form.geo_lng) : null,
    }
    const { error: err } = form.id
      ? await supabase.from('hotels').update(payload).eq('id', form.id)
      : await supabase.from('hotels').insert(payload)
    if (err) { setError(err.message) } else { setModal(false); load() }
    setSaving(false)
  }

  async function remove(id) {
    if (!confirm('Obrisati hotel?')) return
    await supabase.from('hotels').delete().eq('id', id)
    load()
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const filtered = rows
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0
      if (sortBy === 'hotel_code') {
        if (a.hotel_code == null && b.hotel_code == null) cmp = 0
        else if (a.hotel_code == null) cmp = 1
        else if (b.hotel_code == null) cmp = -1
        else cmp = a.hotel_code - b.hotel_code
      } else if (sortBy === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '')
      } else if (sortBy === 'zone') {
        cmp = (a.zones?.name || '').localeCompare(b.zones?.name || '')
      } else if (sortBy === 'time_to_tiv') {
        cmp = (a.time_to_tiv ?? 9999) - (b.time_to_tiv ?? 9999)
      } else if (sortBy === 'time_to_tgd') {
        cmp = (a.time_to_tgd ?? 9999) - (b.time_to_tgd ?? 9999)
      } else if (sortBy === 'pickup_point') {
        cmp = (a.pickup_point || '').localeCompare(b.pickup_point || '')
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  function startInline(r, field) {
    setInlineEdit({ id: r.id, field, val: r[field] ?? '' })
  }

  async function saveInline() {
    if (!inlineEdit) return
    const { id, field, val } = inlineEdit
    const parsed = TEXT_FIELDS.has(field)
      ? (val.trim() || null)
      : (val !== '' ? parseInt(val) : null)
    const { error: err } = await supabase.from('hotels').update({ [field]: parsed }).eq('id', id)
    if (!err) setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: parsed } : r))
    setInlineEdit(null)
  }

  function fmtMin(min) {
    if (!min && min !== 0) return '—'
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h > 0) return `${h}h ${m}min`
    return `${m} min`
  }

  return (

    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Hoteli</h1>
        <button onClick={openNew} className="btn-primary">+ Dodaj hotel</button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <input className="input max-w-xs" placeholder="Pretraga hotela..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} hotela</span>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <SortTh col="hotel_code" label="ID"           current={sortBy} dir={sortDir} onSort={toggleSort} className="w-16 text-center" />
              <SortTh col="name"       label="Hotel"        current={sortBy} dir={sortDir} onSort={toggleSort} />
              <SortTh col="zone"       label="Zona"         current={sortBy} dir={sortDir} onSort={toggleSort} />
              <SortTh col="time_to_tiv" label="→ TIV"      current={sortBy} dir={sortDir} onSort={toggleSort} className="text-center" />
              <SortTh col="time_to_tgd" label="→ TGD"      current={sortBy} dir={sortDir} onSort={toggleSort} className="text-center" />
              <SortTh col="pickup_point" label="Pickup point" current={sortBy} dir={sortDir} onSort={toggleSort} />
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="td text-center">
                  {r.hotel_code != null
                    ? <span className="font-mono font-bold text-sky-700">{r.hotel_code}</span>
                    : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="td font-medium">{r.name}</td>
                <td className="td">
                  {r.zones
                    ? <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">{r.zones.name}</span>
                    : <span className="text-orange-500 text-xs font-medium">⚠ Bez zone</span>}
                </td>
                <td className="td text-center">
                  {inlineEdit?.id === r.id && inlineEdit.field === 'time_to_tiv' ? (
                    <input autoFocus type="number" min="0" max="300"
                      className="w-16 text-center text-xs font-mono border border-sky-400 rounded px-1 py-0.5 outline-none ring-1 ring-sky-300"
                      value={inlineEdit.val}
                      onChange={e => setInlineEdit(p => ({ ...p, val: e.target.value }))}
                      onBlur={saveInline}
                      onKeyDown={e => { if (e.key === 'Enter') saveInline(); if (e.key === 'Escape') setInlineEdit(null) }}
                    />
                  ) : (
                    <span onClick={() => startInline(r, 'time_to_tiv')}
                      className="text-xs font-medium text-gray-600 cursor-pointer hover:bg-sky-50 hover:text-sky-700 px-2 py-0.5 rounded transition-colors"
                      title="Klikni za izmjenu">
                      {fmtMin(r.time_to_tiv)}
                    </span>
                  )}
                </td>
                <td className="td text-center">
                  {inlineEdit?.id === r.id && inlineEdit.field === 'time_to_tgd' ? (
                    <input autoFocus type="number" min="0" max="300"
                      className="w-16 text-center text-xs font-mono border border-sky-400 rounded px-1 py-0.5 outline-none ring-1 ring-sky-300"
                      value={inlineEdit.val}
                      onChange={e => setInlineEdit(p => ({ ...p, val: e.target.value }))}
                      onBlur={saveInline}
                      onKeyDown={e => { if (e.key === 'Enter') saveInline(); if (e.key === 'Escape') setInlineEdit(null) }}
                    />
                  ) : (
                    <span onClick={() => startInline(r, 'time_to_tgd')}
                      className="text-xs font-medium text-gray-600 cursor-pointer hover:bg-sky-50 hover:text-sky-700 px-2 py-0.5 rounded transition-colors"
                      title="Klikni za izmjenu">
                      {fmtMin(r.time_to_tgd)}
                    </span>
                  )}
                </td>
                <td className="td max-w-xs">
                  {inlineEdit?.id === r.id && inlineEdit.field === 'pickup_point' ? (
                    <input autoFocus type="text"
                      className="w-full text-xs border border-sky-400 rounded px-1.5 py-0.5 outline-none ring-1 ring-sky-300"
                      value={inlineEdit.val}
                      onChange={e => setInlineEdit(p => ({ ...p, val: e.target.value }))}
                      onBlur={saveInline}
                      onKeyDown={e => { if (e.key === 'Enter') saveInline(); if (e.key === 'Escape') setInlineEdit(null) }}
                    />
                  ) : (
                    <span onClick={() => startInline(r, 'pickup_point')}
                      className="text-xs text-gray-500 cursor-pointer hover:bg-sky-50 hover:text-sky-700 px-1.5 py-0.5 rounded transition-colors truncate block"
                      title={r.pickup_point || 'Klikni za unos'}>
                      {r.pickup_point || <span className="text-gray-300">—</span>}
                    </span>
                  )}
                </td>
                <td className="td text-right whitespace-nowrap">
                  <button onClick={() => openEdit(r)} className="btn-ghost text-xs">Uredi</button>
                  <button onClick={() => remove(r.id)} className="btn-ghost text-xs text-red-500">Briši</button>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={7} className="td text-center text-gray-400 py-8">
                {search ? 'Nema rezultata' : 'Nema hotela — dodaj ih ili će se automatski kreirati pri importu'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Hoteli se detektuju pri importu Excel fajla. Vrijeme (→ TIV / → TGD) je u minutima i koristi se za automatski obračun pickup vremena.
      </p>

      {modal && (
        <Modal
          title={form.id ? 'Uredi hotel' : 'Novi hotel'}
          onClose={() => setModal(false)}
          footer={<>
            <button onClick={() => setModal(false)} className="btn-ghost">Otkaži</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Čuvanje...' : 'Sačuvaj'}</button>
          </>}
        >
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="label">Naziv hotela *</label>
                <input className="input" value={form.name}
                  onChange={e => setF('name', e.target.value)} placeholder="Hotel Budva Palace" />
              </div>
              <div>
                <label className="label">ID (za sortiranje) *</label>
                <input className="input font-mono" type="number" min="1" value={form.hotel_code}
                  onChange={e => setF('hotel_code', e.target.value)} placeholder="101" />
              </div>
            </div>

            <div>
              <label className="label">Zona</label>
              <select className="input" value={form.zone_id || ''} onChange={e => setF('zone_id', e.target.value)}>
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
                  <label className="label">Vrijeme do TIV (min)</label>
                  <input className="input font-mono" type="number" min="0" max="300" value={form.time_to_tiv}
                    onChange={e => setF('time_to_tiv', e.target.value)} placeholder="45" />
                  <p className="text-xs text-gray-400 mt-1">
                    {form.time_to_tiv ? `= ${fmtMin(parseInt(form.time_to_tiv))} prije polijetanja` : ''}
                  </p>
                </div>
                <div>
                  <label className="label">Vrijeme do TGD (min)</label>
                  <input className="input font-mono" type="number" min="0" max="300" value={form.time_to_tgd}
                    onChange={e => setF('time_to_tgd', e.target.value)} placeholder="120" />
                  <p className="text-xs text-gray-400 mt-1">
                    {form.time_to_tgd ? `= ${fmtMin(parseInt(form.time_to_tgd))} prije polijetanja` : ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                📍 Lokacija (opcionalno)
              </div>
              <div>
                <label className="label">Pickup point</label>
                <input className="input" value={form.pickup_point}
                  onChange={e => setF('pickup_point', e.target.value)}
                  placeholder="Pr. Ispred glavnog ulaza hotela" />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="label">Geo lat</label>
                  <input className="input font-mono text-sm" type="number" step="0.0000001" value={form.geo_lat}
                    onChange={e => setF('geo_lat', e.target.value)} placeholder="42.274680" />
                </div>
                <div>
                  <label className="label">Geo lng</label>
                  <input className="input font-mono text-sm" type="number" step="0.0000001" value={form.geo_lng}
                    onChange={e => setF('geo_lng', e.target.value)} placeholder="18.840280" />
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── SortTh — klikabilni header sa strelicom ───────────────────────
function SortTh({ col, label, current, dir, onSort, className = '' }) {
  const active = current === col
  return (
    <th
      className={`th cursor-pointer select-none hover:bg-gray-100 transition-colors ${className}`}
      onClick={() => onSort(col)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <span className="text-xs">
          {active
            ? (dir === 'asc' ? '▲' : '▼')
            : <span className="text-gray-300">↕</span>}
        </span>
      </div>
    </th>
  )
}
