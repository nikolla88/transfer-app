import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'

const EMPTY = {
  vehicle_id: '',
  block_date: today(),
  all_day: true,
  time_from: '08:00',
  time_to: '18:00',
  reason: '',
}

export default function VehicleBlocks() {
  const [date,     setDate]     = useState(today())
  const [blocks,   setBlocks]   = useState([])
  const [vehicles, setVehicles] = useState([])
  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)

  useEffect(() => { loadVehicles() }, [])
  useEffect(() => { loadBlocks()   }, [date])

  async function loadVehicles() {
    const { data } = await supabase
      .from('vehicles').select('id, name, type').eq('active', true).order('name')
    setVehicles(data || [])
  }

  async function loadBlocks() {
    const { data } = await supabase
      .from('vehicle_blocks')
      .select('*, vehicles(name, type)')
      .eq('block_date', date)
      .order('time_from', { nullsFirst: true })
    setBlocks(data || [])
  }

  function openNew() {
    setForm({ ...EMPTY, block_date: date })
    setModal(true)
  }

  async function save() {
    if (!form.vehicle_id) return
    setSaving(true)
    const payload = {
      vehicle_id: form.vehicle_id,
      block_date: form.block_date,
      time_from:  form.all_day ? null : form.time_from || null,
      time_to:    form.all_day ? null : form.time_to   || null,
      reason:     form.reason?.trim() || null,
    }
    await supabase.from('vehicle_blocks').insert(payload)
    setSaving(false)
    setModal(false)
    loadBlocks()
  }

  async function remove(id) {
    if (!confirm('Obrisati blokadu?')) return
    await supabase.from('vehicle_blocks').delete().eq('id', id)
    loadBlocks()
  }

  const TYPE_ICON = { car: '🚗', minivan: '🚐', vclass: '⭐' }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900">Blokade vozila</h1>
          <input
            type="date" value={date}
            onChange={e => setDate(e.target.value)}
            className="input w-40"
          />
        </div>
        <button onClick={openNew} className="btn-primary">+ Dodaj blokadu</button>
      </div>

      {/* Info box */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 mb-4">
        Vozila sa aktivnom blokadu <strong>neće biti raspoređena</strong> za transfere u tom terminu.
      </div>

      {/* Lista blokada */}
      <div className="card overflow-hidden">
        {blocks.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Nema blokada za {date.split('-').reverse().join('.')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="th">Vozilo</th>
                <th className="th">Termin</th>
                <th className="th">Razlog</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {blocks.map(b => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="td font-medium">
                    {TYPE_ICON[b.vehicles?.type] || '🚗'} {b.vehicles?.name}
                  </td>
                  <td className="td">
                    {!b.time_from && !b.time_to ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                        🔴 Cijeli dan
                      </span>
                    ) : (
                      <span className="font-mono text-sm">
                        {b.time_from?.slice(0,5)} – {b.time_to?.slice(0,5)}
                      </span>
                    )}
                  </td>
                  <td className="td text-gray-500">{b.reason || '—'}</td>
                  <td className="td text-right">
                    <button onClick={() => remove(b.id)} className="btn-ghost text-xs text-red-500">
                      Briši
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <Modal
          title="Nova blokada"
          onClose={() => setModal(false)}
          footer={<>
            <button onClick={() => setModal(false)} className="btn-ghost">Otkaži</button>
            <button onClick={save} disabled={saving || !form.vehicle_id} className="btn-primary">
              {saving ? 'Čuvanje...' : 'Sačuvaj'}
            </button>
          </>}
        >
          <div className="space-y-3">
            <div>
              <label className="label">Vozilo *</label>
              <select
                className="input"
                value={form.vehicle_id}
                onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}
              >
                <option value="">— Odaberi vozilo —</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {TYPE_ICON[v.type]} {v.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Datum</label>
              <input
                type="date"
                className="input"
                value={form.block_date}
                onChange={e => setForm(f => ({ ...f, block_date: e.target.value }))}
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.all_day}
                onChange={e => setForm(f => ({ ...f, all_day: e.target.checked }))}
              />
              <span className="text-sm font-medium">Cijeli dan</span>
            </label>

            {!form.all_day && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label">Od</label>
                  <input
                    type="time"
                    className="input"
                    value={form.time_from}
                    onChange={e => setForm(f => ({ ...f, time_from: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="label">Do</label>
                  <input
                    type="time"
                    className="input"
                    value={form.time_to}
                    onChange={e => setForm(f => ({ ...f, time_to: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label">Razlog (opciono)</label>
              <input
                className="input"
                placeholder="npr. servis, privatno, bolovanje..."
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function today() {
  return new Date().toISOString().slice(0, 10)
}
