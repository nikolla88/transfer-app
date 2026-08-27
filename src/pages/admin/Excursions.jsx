import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'

const EMPTY = {
  name: '', type: 'grupni', description: '', meeting_point: '', duration_label: '',
  price_adult: '', price_child: '', default_capacity: '', video_url: '', active: true,
  images: [''],
  itinerary: [{ time: '', title: '', description: '' }],
}

export default function Excursions() {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(false)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase.from('excursions').select('*').order('name')
    if (err) setError(err.message?.includes('relation "excursions"')
      ? 'Tabela "excursions" ne postoji u bazi. Pokreni supabase_excursions.sql u Supabase SQL editoru.'
      : 'Greška: ' + err.message)
    else setError('')
    setRows(data || [])
    setLoading(false)
  }

  function openNew() { setForm(EMPTY); setError(''); setModal(true) }

  function openEdit(row) {
    setForm({
      ...row,
      price_adult:      String(row.price_adult ?? ''),
      price_child:      String(row.price_child ?? ''),
      default_capacity: row.default_capacity != null ? String(row.default_capacity) : '',
      images:           row.images && row.images.length ? row.images : [''],
      itinerary:        row.itinerary && row.itinerary.length ? row.itinerary : [{ time: '', title: '', description: '' }],
    })
    setError('')
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { setError('Naziv je obavezan.'); return }
    setSaving(true)
    setError('')

    const payload = {
      name:             form.name.trim(),
      type:             form.type,
      description:      form.description?.trim() || null,
      meeting_point:    form.meeting_point?.trim() || null,
      duration_label:   form.duration_label?.trim() || null,
      price_adult:      form.price_adult === '' ? 0 : Number(form.price_adult),
      price_child:      form.price_child === '' ? 0 : Number(form.price_child),
      default_capacity: form.type === 'grupni' && form.default_capacity !== '' ? Number(form.default_capacity) : null,
      video_url:        form.video_url?.trim() || null,
      active:           form.active,
      images:           form.images.map(s => s.trim()).filter(Boolean),
      itinerary:        form.itinerary
        .filter(it => it.time?.trim() || it.title?.trim() || it.description?.trim())
        .map(it => ({ time: it.time?.trim() || '', title: it.title?.trim() || '', description: it.description?.trim() || '' })),
      updated_at: new Date().toISOString(),
    }

    const { error: err } = form.id
      ? await supabase.from('excursions').update(payload).eq('id', form.id)
      : await supabase.from('excursions').insert(payload)

    if (err) setError(err.message)
    else { setModal(false); load() }
    setSaving(false)
  }

  async function remove(id) {
    if (!confirm('Obrisati izlet? Ova akcija se ne može poništiti.')) return
    const { error: err } = await supabase.from('excursions').delete().eq('id', id)
    if (err) {
      alert(err.message?.includes('violates') || err.message?.includes('foreign key')
        ? 'Ne može se obrisati — postoje rezervacije gostiju vezane za ovaj izlet.'
        : 'Greška: ' + err.message)
      return
    }
    load()
  }

  // ── Dinamičke liste: slike ────────────────────────────────────
  function updateImage(i, val) {
    setForm(f => ({ ...f, images: f.images.map((v, idx) => idx === i ? val : v) }))
  }
  function addImage() { setForm(f => ({ ...f, images: [...f.images, ''] })) }
  function removeImage(i) { setForm(f => ({ ...f, images: f.images.filter((_, idx) => idx !== i) })) }

  // ── Dinamičke liste: itinerer ─────────────────────────────────
  function updateStop(i, field, val) {
    setForm(f => ({ ...f, itinerary: f.itinerary.map((s, idx) => idx === i ? { ...s, [field]: val } : s) }))
  }
  function addStop() { setForm(f => ({ ...f, itinerary: [...f.itinerary, { time: '', title: '', description: '' }] })) }
  function removeStop(i) { setForm(f => ({ ...f, itinerary: f.itinerary.filter((_, idx) => idx !== i) })) }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900">🏝️ Izleti — katalog</h1>
        <div className="flex items-center gap-2">
          <Link to="/admin/excursions/calendar" className="btn-ghost">📅 Kalendar izleta</Link>
          <button onClick={openNew} className="btn-primary">+ Dodaj izlet</button>
        </div>
      </div>

      {error && !modal && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {loading && <div className="text-center text-gray-400 py-12">Učitavam...</div>}

      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map(r => (
            <div key={r.id} className="card overflow-hidden flex flex-col">
              <div className="h-36 bg-gray-100 flex items-center justify-center overflow-hidden">
                {r.images?.[0]
                  ? <img src={r.images[0]} alt={r.name} className="w-full h-full object-cover"
                      onError={e => { e.target.style.display = 'none' }} />
                  : <span className="text-4xl">🏔️</span>}
              </div>
              <div className="p-3 flex-1 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    r.type === 'grupni' ? 'bg-indigo-100 text-indigo-700' : 'bg-pink-100 text-pink-700'
                  }`}>
                    {r.type === 'grupni' ? '🚌 Grupni' : '🚗 Individualni'}
                  </span>
                  {!r.active && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-500">Neaktivan</span>
                  )}
                </div>
                <div className="font-bold text-gray-900 leading-tight">{r.name}</div>
                {r.description && (
                  <div className="text-sm text-gray-500 line-clamp-2">{r.description}</div>
                )}
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-sm font-semibold text-gray-700">
                    €{Number(r.price_adult).toFixed(2)} <span className="text-xs text-gray-400 font-normal">odrasli</span>
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(r)} className="btn-ghost text-xs">Uredi</button>
                    <button onClick={() => remove(r.id)} className="btn-ghost text-xs text-red-500">Briši</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {!rows.length && (
            <div className="col-span-full card p-8 text-center text-gray-400">Nema dodatih izleta</div>
          )}
        </div>
      )}

      {modal && (
        <Modal
          title={form.id ? 'Uredi izlet' : 'Novi izlet'}
          onClose={() => setModal(false)}
          wide
          footer={<>
            <button onClick={() => setModal(false)} className="btn-ghost">Otkaži</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Čuvanje...' : 'Sačuvaj'}</button>
          </>}
        >
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

            {/* Osnovno */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Naziv izleta *</label>
                <input className="input" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="npr. Ostrog" />
              </div>
              <div>
                <label className="label">Tip izleta</label>
                <select className="input" value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="grupni">🚌 Grupni (deljeni kapacitet, kalendar)</option>
                  <option value="individualni">🚗 Individualni (ad-hoc, bez kalendara)</option>
                </select>
              </div>
              <div>
                <label className="label">Trajanje</label>
                <input className="input" value={form.duration_label || ''}
                  onChange={e => setForm(f => ({ ...f, duration_label: e.target.value }))} placeholder="npr. Cijeli dan (8h)" />
              </div>
              <div className="col-span-2">
                <label className="label">Mjesto okupljanja / polaska</label>
                <input className="input" value={form.meeting_point || ''}
                  onChange={e => setForm(f => ({ ...f, meeting_point: e.target.value }))} placeholder="npr. Ispred hotela, po pick-up rasporedu" />
              </div>
              <div className="col-span-2">
                <label className="label">Opis</label>
                <textarea className="input" rows={3} value={form.description || ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Kratak marketinški opis izleta..." />
              </div>
            </div>

            {/* Cijena i kapacitet */}
            <div className="grid grid-cols-3 gap-3 pt-2 border-t">
              <div>
                <label className="label">Cijena — odrasli (€)</label>
                <input type="number" step="0.01" className="input" value={form.price_adult}
                  onChange={e => setForm(f => ({ ...f, price_adult: e.target.value }))} />
              </div>
              <div>
                <label className="label">Cijena — djeca (€)</label>
                <input type="number" step="0.01" className="input" value={form.price_child}
                  onChange={e => setForm(f => ({ ...f, price_child: e.target.value }))} />
              </div>
              {form.type === 'grupni' && (
                <div>
                  <label className="label">Podrazumijevani kapacitet</label>
                  <input type="number" className="input" value={form.default_capacity}
                    onChange={e => setForm(f => ({ ...f, default_capacity: e.target.value }))} placeholder="npr. 50" />
                </div>
              )}
            </div>

            {/* Slike i video */}
            <div className="pt-2 border-t">
              <label className="label mb-1.5">Slike (linkovi)</label>
              <div className="space-y-2">
                {form.images.map((url, i) => (
                  <div key={i} className="flex gap-2">
                    <input className="input flex-1" value={url}
                      onChange={e => updateImage(i, e.target.value)} placeholder="https://..." />
                    {form.images.length > 1 && (
                      <button onClick={() => removeImage(i)} className="btn-ghost text-red-500 px-2">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addImage} className="mt-2 text-xs text-brand-600 font-medium">+ Dodaj još jednu sliku</button>

              <div className="mt-3">
                <label className="label">Video (link)</label>
                <input className="input" value={form.video_url || ''}
                  onChange={e => setForm(f => ({ ...f, video_url: e.target.value }))} placeholder="npr. YouTube link" />
              </div>
            </div>

            {/* Itinerer */}
            <div className="pt-2 border-t">
              <label className="label mb-1.5">Itinerer (program po tačkama)</label>
              <div className="space-y-2">
                {form.itinerary.map((stop, i) => (
                  <div key={i} className="flex gap-2 items-start bg-gray-50 rounded-lg p-2">
                    <input className="input w-24 flex-shrink-0" value={stop.time}
                      onChange={e => updateStop(i, 'time', e.target.value)} placeholder="08:00" />
                    <div className="flex-1 space-y-1.5">
                      <input className="input" value={stop.title}
                        onChange={e => updateStop(i, 'title', e.target.value)} placeholder="Naslov (npr. Polazak iz Budve)" />
                      <input className="input" value={stop.description}
                        onChange={e => updateStop(i, 'description', e.target.value)} placeholder="Opis (opciono)" />
                    </div>
                    {form.itinerary.length > 1 && (
                      <button onClick={() => removeStop(i)} className="btn-ghost text-red-500 px-2 flex-shrink-0">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addStop} className="mt-2 text-xs text-brand-600 font-medium">+ Dodaj tačku programa</button>
            </div>

            {/* Aktivan */}
            <div className="pt-2 border-t flex items-center gap-2">
              <input type="checkbox" id="excursion-active" checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              <label htmlFor="excursion-active" className="text-sm text-gray-700">Aktivan (vidljiv za prodaju)</label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
