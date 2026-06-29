import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'

const EMPTY = { name: '', phone: '', vehicle_id: '', telegram_chat_id: '', active: true }

export default function Drivers() {
  const [rows,     setRows]     = useState([])
  const [vehicles, setVehicles] = useState([])
  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: d }, { data: v }] = await Promise.all([
      supabase.from('drivers').select('*, vehicles(name, type)').order('name'),
      supabase.from('vehicles').select('id, name, type').eq('active', true).order('name'),
    ])
    setRows(d || [])
    setVehicles(v || [])
  }

  function openNew()  { setForm(EMPTY); setError(''); setModal(true) }
  function openEdit(r){ setForm({...r, vehicle_id: r.vehicle_id || ''}); setError(''); setModal(true) }

  async function save() {
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      phone: form.phone?.trim() || null,
      vehicle_id: form.vehicle_id || null,
      telegram_chat_id: form.telegram_chat_id?.trim() || null,
      active: form.active,
    }
    const { error: err } = form.id
      ? await supabase.from('drivers').update(payload).eq('id', form.id)
      : await supabase.from('drivers').insert(payload)
    if (err) { setError(err.message) } else { setModal(false); load() }
    setSaving(false)
  }

  async function remove(id) {
    if (!confirm('Obrisati vozača?')) return
    await supabase.from('drivers').delete().eq('id', id)
    load()
  }

  const TYPE_BADGE = { car: 'badge-car', minivan: 'badge-minivan', vclass: 'badge-vclass' }
  const TYPE_LBL   = { car: 'Auto', minivan: 'Minivan', vclass: 'V Class' }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Vozači</h1>
        <button onClick={openNew} className="btn-primary">+ Dodaj vozača</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="th">Ime</th>
              <th className="th">Telefon</th>
              <th className="th">Telegram ID</th>
              <th className="th">Vozilo</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="td font-medium">{r.name}</td>
                <td className="td text-gray-500">{r.phone || '—'}</td>
                <td className="td text-gray-500 font-mono text-xs">
                  {r.telegram_chat_id
                    ? <span className="text-green-700">✓ {r.telegram_chat_id}</span>
                    : <span className="text-orange-400">⚠ nije unesen</span>
                  }
                </td>
                <td className="td">
                  {r.vehicles
                    ? <span className={TYPE_BADGE[r.vehicles.type]}>{r.vehicles.name} · {TYPE_LBL[r.vehicles.type]}</span>
                    : <span className="text-gray-400 text-xs">Nedodjeljeno</span>
                  }
                </td>
                <td className="td">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {r.active ? 'Aktivan' : 'Neaktivan'}
                  </span>
                </td>
                <td className="td text-right">
                  <button onClick={() => openEdit(r)} className="btn-ghost text-xs">Uredi</button>
                  <button onClick={() => remove(r.id)} className="btn-ghost text-xs text-red-500">Briši</button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="td text-center text-gray-400 py-8">Nema vozača</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={form.id ? 'Uredi vozača' : 'Novi vozač'}
          onClose={() => setModal(false)}
          footer={<>
            <button onClick={() => setModal(false)} className="btn-ghost">Otkaži</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Čuvanje...' : 'Sačuvaj'}</button>
          </>}
        >
          <div className="space-y-3">
            {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
            <div>
              <label className="label">Ime i prezime *</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Marko Nikolić" />
            </div>
            <div>
              <label className="label">Telefon</label>
              <input className="input" value={form.phone || ''} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="+382 67 000 000" />
            </div>
            <div>
              <label className="label">Telegram Chat ID</label>
              <input className="input" value={form.telegram_chat_id || ''} onChange={e => setForm(f => ({...f, telegram_chat_id: e.target.value}))} placeholder="npr. 123456789" />
              <p className="text-xs text-gray-400 mt-1">Vozač treba da pošalje /start tvom botu, pa provjeri ID na: api.telegram.org/bot<em>TOKEN</em>/getUpdates</p>
            </div>
            <div>
              <label className="label">Vozilo</label>
              <select className="input" value={form.vehicle_id || ''} onChange={e => setForm(f => ({...f, vehicle_id: e.target.value}))}>
                <option value="">— Bez vozila —</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({...f, active: e.target.checked}))} />
              <span className="text-sm">Aktivan</span>
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
