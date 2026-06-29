import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'

export default function Zones() {
  const [rows,   setRows]   = useState([])
  const [modal,  setModal]  = useState(false)
  const [form,   setForm]   = useState({ name: '' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabase.from('zones').select('*').order('name')
    setRows(data || [])
  }

  function openNew()  { setForm({ name: '' }); setError(''); setModal(true) }
  function openEdit(r){ setForm(r); setError(''); setModal(true) }

  async function save() {
    setSaving(true); setError('')
    const { error: err } = form.id
      ? await supabase.from('zones').update({ name: form.name.trim() }).eq('id', form.id)
      : await supabase.from('zones').insert({ name: form.name.trim() })
    if (err) { setError(err.message) } else { setModal(false); load() }
    setSaving(false)
  }

  async function remove(id) {
    if (!confirm('Obrisati zonu? Hoteli koji koriste ovu zonu ostaju bez zone.')) return
    await supabase.from('zones').delete().eq('id', id)
    load()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Zone</h1>
        <button onClick={openNew} className="btn-primary">+ Dodaj zonu</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="th">Naziv zone</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="td font-medium">{r.name}</td>
                <td className="td text-right">
                  <button onClick={() => openEdit(r)} className="btn-ghost text-xs">Uredi</button>
                  <button onClick={() => remove(r.id)} className="btn-ghost text-xs text-red-500">Briši</button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={2} className="td text-center text-gray-400 py-8">Nema zona</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={form.id ? 'Uredi zonu' : 'Nova zona'}
          onClose={() => setModal(false)}
          footer={<>
            <button onClick={() => setModal(false)} className="btn-ghost">Otkaži</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Čuvanje...' : 'Sačuvaj'}</button>
          </>}
        >
          <div className="space-y-3">
            {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
            <div>
              <label className="label">Naziv zone *</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Budva" autoFocus />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
