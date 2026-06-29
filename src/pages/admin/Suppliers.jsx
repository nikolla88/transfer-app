import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'

const EMPTY = { name: '', phone: '', contact_person: '', active: true }

export default function Suppliers() {
  const [rows,   setRows]   = useState([])
  const [modal,  setModal]  = useState(false)
  const [form,   setForm]   = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('suppliers').select('*').order('name')
    setRows(data || [])
  }

  function openNew()  { setForm(EMPTY); setError(''); setModal(true) }
  function openEdit(r){ setForm(r); setError(''); setModal(true) }

  async function save() {
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      phone: form.phone?.trim() || null,
      contact_person: form.contact_person?.trim() || null,
      active: form.active,
    }
    const { error: err } = form.id
      ? await supabase.from('suppliers').update(payload).eq('id', form.id)
      : await supabase.from('suppliers').insert(payload)
    if (err) { setError(err.message) } else { setModal(false); load() }
    setSaving(false)
  }

  async function remove(id) {
    if (!confirm('Obrisati suplajera? Sve cijene ovog suplajera će biti izbrisane.')) return
    await supabase.from('suppliers').delete().eq('id', id)
    load()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Suplajeri</h1>
        <button onClick={openNew} className="btn-primary">+ Dodaj suplajera</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="th">Naziv</th>
              <th className="th">Kontakt</th>
              <th className="th">Telefon</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="td font-medium">{r.name}</td>
                <td className="td text-gray-500">{r.contact_person || '—'}</td>
                <td className="td text-gray-500">{r.phone || '—'}</td>
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
              <tr><td colSpan={5} className="td text-center text-gray-400 py-8">Nema suplajera</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={form.id ? 'Uredi suplajera' : 'Novi suplajeri'}
          onClose={() => setModal(false)}
          footer={<>
            <button onClick={() => setModal(false)} className="btn-ghost">Otkaži</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Čuvanje...' : 'Sačuvaj'}</button>
          </>}
        >
          <div className="space-y-3">
            {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
            <div>
              <label className="label">Naziv firme *</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="ABC Taxi" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Kontakt osoba</label>
                <input className="input" value={form.contact_person || ''} onChange={e => setForm(f => ({...f, contact_person: e.target.value}))} placeholder="Marko" />
              </div>
              <div>
                <label className="label">Telefon</label>
                <input className="input" value={form.phone || ''} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="+382 67 000 000" />
              </div>
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
