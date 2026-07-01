import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../App'

const CATEGORIES = [
  { value: 'fuel',    label: 'Gorivo',   icon: '⛽', color: 'bg-orange-100 text-orange-700' },
  { value: 'service', label: 'Servis',   icon: '🔧', color: 'bg-blue-100 text-blue-700'   },
  { value: 'salary',  label: 'Plata',    icon: '👤', color: 'bg-green-100 text-green-700'  },
  { value: 'other',   label: 'Ostalo',   icon: '📋', color: 'bg-gray-100 text-gray-600'    },
]

const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]))

function today() { return new Date().toISOString().slice(0, 10) }
function monthStart() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('sr-Latn', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—' }
function fmtEur(n) { return n != null ? `€${Number(n).toFixed(2)}` : '—' }

const EMPTY_FORM = { vehicle_id: '', cost_date: today(), category: 'fuel', amount: '', description: '' }

export default function VehicleCosts() {
  const { canWrite } = useAuth()
  const canEdit = canWrite('admin_vehicle_costs')

  const [vehicles, setVehicles] = useState([])
  const [costs,    setCosts]    = useState([])
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)

  const [form,     setForm]     = useState(EMPTY_FORM)
  const [editId,   setEditId]   = useState(null)

  // Filteri
  const [dateFrom,   setDateFrom]   = useState(monthStart())
  const [dateTo,     setDateTo]     = useState(today())
  const [fVehicle,   setFVehicle]   = useState('')
  const [fCategory,  setFCategory]  = useState('')

  useEffect(() => { loadAll() }, [dateFrom, dateTo])

  async function loadAll() {
    setLoading(true)
    const [vRes, cRes] = await Promise.all([
      supabase.from('vehicles').select('id,name,plate,type').order('name'),
      supabase.from('vehicle_costs')
        .select('*')
        .gte('cost_date', dateFrom)
        .lte('cost_date', dateTo)
        .order('cost_date', { ascending: false }),
    ])
    setVehicles(vRes.data || [])
    setCosts(cRes.data || [])
    setLoading(false)
  }

  async function save() {
    if (!form.vehicle_id || !form.amount || !form.cost_date) return
    setSaving(true)
    const payload = {
      vehicle_id:  form.vehicle_id,
      cost_date:   form.cost_date,
      category:    form.category,
      amount:      parseFloat(form.amount),
      description: form.description?.trim() || null,
    }
    let error
    if (editId) {
      ;({ error } = await supabase.from('vehicle_costs').update(payload).eq('id', editId))
    } else {
      ;({ error } = await supabase.from('vehicle_costs').insert(payload))
    }
    if (error) { alert('Greška: ' + error.message); setSaving(false); return }
    setForm(EMPTY_FORM)
    setEditId(null)
    await loadAll()
    setSaving(false)
  }

  async function deleteCost(id) {
    if (!confirm('Obriši ovaj trošak?')) return
    await supabase.from('vehicle_costs').delete().eq('id', id)
    setCosts(prev => prev.filter(c => c.id !== id))
  }

  function startEdit(c) {
    setForm({ vehicle_id: c.vehicle_id, cost_date: c.cost_date, category: c.category,
      amount: String(c.amount), description: c.description || '' })
    setEditId(c.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() { setForm(EMPTY_FORM); setEditId(null) }

  const vehicleMap = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, v])), [vehicles])

  // Lokalni filteri
  const filtered = useMemo(() => costs.filter(c => {
    if (fVehicle  && c.vehicle_id !== fVehicle) return false
    if (fCategory && c.category   !== fCategory) return false
    return true
  }), [costs, fVehicle, fCategory])

  // Summary po kategoriji
  const summary = useMemo(() => {
    const total = filtered.reduce((s, c) => s + Number(c.amount), 0)
    const byCat = {}
    for (const c of filtered) {
      byCat[c.category] = (byCat[c.category] || 0) + Number(c.amount)
    }
    return { total, byCat }
  }, [filtered])

  // Summary po vozilu
  const byVehicle = useMemo(() => {
    const map = {}
    for (const c of filtered) {
      if (!map[c.vehicle_id]) map[c.vehicle_id] = { id: c.vehicle_id, total: 0 }
      map[c.vehicle_id].total += Number(c.amount)
    }
    return Object.values(map).sort((a,b) => b.total - a.total)
  }, [filtered])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-800">🔧 Troškovi vozila</h1>
        <p className="text-sm text-gray-400 mt-0.5">Evidencija goriva, servisa, plata i ostalih troškova</p>
      </div>

      {/* ── Forma za unos ── */}
      {canEdit && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">
            {editId ? '✏️ Izmijeni trošak' : '➕ Novi trošak'}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            {/* Vozilo */}
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs text-gray-500 mb-1">Vozilo *</label>
              <select value={form.vehicle_id} onChange={e => setForm(f => ({...f, vehicle_id: e.target.value}))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="">— Izaberi vozilo —</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.type === 'vclass' ? '⭐' : v.type === 'minivan' ? '🚐' : '🚗'} {v.name}{v.plate ? ` (${v.plate})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Datum */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Datum *</label>
              <input type="date" value={form.cost_date} onChange={e => setForm(f => ({...f, cost_date: e.target.value}))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
            </div>

            {/* Iznos */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Iznos (€) *</label>
              <input type="number" min="0.01" step="0.01" placeholder="0.00"
                value={form.amount} onChange={e => setForm(f => ({...f, amount: e.target.value}))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
            </div>
          </div>

          {/* Kategorija */}
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Kategorija *</label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map(c => (
                <button key={c.value} onClick={() => setForm(f => ({...f, category: c.value}))}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    form.category === c.value
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Opis */}
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">Opis / napomena</label>
            <input type="text" placeholder="npr. Punjenje gorivo, Zamjena ulja, Plata za jun..."
              value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
              onKeyDown={e => e.key === 'Enter' && save()}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !form.vehicle_id || !form.amount}
              className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">
              {saving ? '⏳ Čuvam...' : editId ? '💾 Sačuvaj izmjenu' : '➕ Dodaj trošak'}
            </button>
            {editId && (
              <button onClick={cancelEdit}
                className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                Odustani
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Filteri ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Od datuma</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Do datuma</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div className="h-8 w-px bg-gray-200"/>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Vozilo</label>
            <select value={fVehicle} onChange={e => setFVehicle(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="">Sva vozila</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kategorija</label>
            <div className="flex gap-1">
              <button onClick={() => setFCategory('')}
                className={`px-2.5 py-1.5 text-xs rounded border ${!fCategory ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Sve
              </button>
              {CATEGORIES.map(c => (
                <button key={c.value} onClick={() => setFCategory(fCategory === c.value ? '' : c.value)}
                  className={`px-2.5 py-1.5 text-xs rounded border ${fCategory === c.value ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Summary kartice ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <div className="col-span-2 md:col-span-1 bg-red-600 text-white rounded-xl p-3">
          <div className="text-xs opacity-70 mb-1">Ukupni troškovi</div>
          <div className="font-bold text-xl">{fmtEur(summary.total)}</div>
        </div>
        {CATEGORIES.map(c => (
          <div key={c.value} className={`rounded-xl p-3 ${c.color} border border-gray-100`}>
            <div className="text-xs opacity-70 mb-1">{c.icon} {c.label}</div>
            <div className="font-bold text-lg">{fmtEur(summary.byCat[c.value] || 0)}</div>
          </div>
        ))}
      </div>

      {/* ── Summary po vozilu ── */}
      {byVehicle.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Troškovi po vozilu</p>
          <div className="flex flex-wrap gap-3">
            {byVehicle.map(r => {
              const v = vehicleMap[r.id]
              if (!v) return null
              const pct = summary.total > 0 ? (r.total / summary.total) * 100 : 0
              return (
                <div key={r.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                  <span>{v.type === 'vclass' ? '⭐' : v.type === 'minivan' ? '🚐' : '🚗'}</span>
                  <span className="font-medium text-gray-700">{v.name}</span>
                  <span className="font-semibold text-red-600">{fmtEur(r.total)}</span>
                  <span className="text-xs text-gray-400">{pct.toFixed(1)}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Tabela troškova ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="text-xs text-gray-400 px-4 py-2 border-b border-gray-100 flex items-center justify-between">
          <span>{filtered.length} unosa</span>
        </div>
        {loading
          ? <div className="text-center py-16 text-gray-400">⏳ Učitavanje...</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-4 py-3 font-medium text-gray-600">Datum</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Vozilo</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Kategorija</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Opis</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Iznos</th>
                    {canEdit && <th className="px-4 py-3 w-20"/>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => {
                    const cat = CAT_MAP[c.category]
                    const v = vehicleMap[c.vehicle_id]
                    return (
                      <tr key={c.id} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(c.cost_date)}</td>
                        <td className="px-4 py-2.5">
                          {v
                            ? <span className="font-medium text-gray-800">
                                {v.type === 'vclass' ? '⭐' : v.type === 'minivan' ? '🚐' : '🚗'} {v.name}
                              </span>
                            : <span className="text-gray-400">—</span>
                          }
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${cat?.color || 'bg-gray-100 text-gray-600'}`}>
                            {cat?.icon} {cat?.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-sm max-w-[200px] truncate">
                          {c.description || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-600">{fmtEur(c.amount)}</td>
                        {canEdit && (
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1 justify-end">
                              <button onClick={() => startEdit(c)}
                                className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-500">
                                ✏️
                              </button>
                              <button onClick={() => deleteCost(c.id)}
                                className="text-xs px-2 py-1 border border-red-100 rounded hover:bg-red-50 text-red-400">
                                🗑
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="bg-red-50 border-t-2 border-red-100 font-semibold">
                      <td className="px-4 py-3 text-red-800" colSpan={4}>UKUPNO</td>
                      <td className="px-4 py-3 text-right text-red-800 text-base">{fmtEur(summary.total)}</td>
                      {canEdit && <td/>}
                    </tr>
                  </tfoot>
                )}
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-16 text-gray-400">
                  Nema troškova za odabrani period i filtere.
                </div>
              )}
            </div>
          )
        }
      </div>
    </div>
  )
}
