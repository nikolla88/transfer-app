import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

const AIRPORTS = [
  { code: 'TIV', label: '✈️ Tivat (TIV)' },
  { code: 'TGD', label: '✈️ Podgorica (TGD)' },
]

const COLS = [
  { key: 'group_adt',   label: 'Grup. ADT',   title: 'Grupni transfer — odrasli (€/os)', color: 'bg-blue-50' },
  { key: 'group_chd',   label: 'Grup. DJT',   title: 'Grupni transfer — djeca 2-12 (€/os)', color: 'bg-blue-50' },
  { key: 'ind_econ',    label: 'IND Econ',    title: 'Individualni Economy Car, 1-3 pax (€/voz)', color: 'bg-green-50' },
  { key: 'ind_comfort', label: 'IND Comfort', title: 'Individualni Comfort Car, 1-3 pax (€/voz)', color: 'bg-green-50' },
  { key: 'minivan',     label: 'Minivan',     title: 'Minivan Standard, 4-7 pax (€/voz)', color: 'bg-amber-50' },
  { key: 'v_class',     label: 'V-Class',     title: 'Mercedes V-Class, 4-7 pax (€/voz)', color: 'bg-purple-50' },
]

export default function SalePrices() {
  const { isAdmin, canWrite } = useAuth()
  const canEdit = isAdmin || canWrite('sale_prices')

  const [airport, setAirport] = useState('TIV')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState({}) // { rowId_colKey: value }
  const [saving, setSaving] = useState(null)

  useEffect(() => { load(airport) }, [airport])

  async function load(ap) {
    setLoading(true)
    const { data, error } = await supabase
      .from('sale_prices')
      .select('*, zones(name)')
      .eq('airport', ap)
      .order('zones(name)')
    if (error) console.error(error)
    setRows(data || [])
    setEditing({})
    setLoading(false)
  }

  function cellKey(rowId, col) { return `${rowId}__${col}` }

  function startEdit(rowId, col, currentVal) {
    if (!canEdit) return
    setEditing(prev => ({ ...prev, [cellKey(rowId, col)]: currentVal ?? '' }))
  }

  function onChange(rowId, col, val) {
    setEditing(prev => ({ ...prev, [cellKey(rowId, col)]: val }))
  }

  async function saveCell(row, col) {
    const key = cellKey(row.id, col)
    const raw = editing[key]
    if (raw === undefined) return
    const val = raw === '' ? null : parseFloat(raw)
    if (val !== null && isNaN(val)) return

    setSaving(key)
    const { error } = await supabase
      .from('sale_prices')
      .update({ [col]: val, updated_at: new Date().toISOString() })
      .eq('id', row.id)

    if (!error) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, [col]: val } : r))
      setEditing(prev => { const n = { ...prev }; delete n[key]; return n })
    }
    setSaving(null)
  }

  function fmt(val) {
    if (val === null || val === undefined) return <span className="text-gray-300">—</span>
    return <span>€{val}</span>
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">Cjenovnik transfera</h1>
          <p className="text-sm text-gray-500 mt-0.5">Prodajne cijene — Prometheus Travel 2026</p>
        </div>
        {canEdit && (
          <span className="text-xs text-gray-400">Klikni na cijenu da je izmijeniš</span>
        )}
      </div>

      {/* Airport tabs */}
      <div className="flex gap-2 mb-5">
        {AIRPORTS.map(ap => (
          <button
            key={ap.code}
            onClick={() => setAirport(ap.code)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              airport === ap.code
                ? 'bg-blue-600 text-white shadow'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {ap.label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 inline-block"/>Grupni (€/osobi)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 inline-block"/>Individualni 1-3 pax (€/vozilu)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 inline-block"/>Minivan 4-7 pax (€/vozilu)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-100 inline-block"/>V-Class 4-7 pax (€/vozilu)</span>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Učitavanje...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-40">Destinacija</th>
                {COLS.map(c => (
                  <th key={c.key} title={c.title}
                    className={`text-center px-2 py-2.5 font-medium text-gray-600 w-24 ${c.color}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id}
                  className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                  <td className="px-4 py-2 font-medium text-gray-700">{row.zones?.name}</td>
                  {COLS.map(c => {
                    const key = cellKey(row.id, c.key)
                    const isEditing = key in editing
                    const isSaving = saving === key
                    return (
                      <td key={c.key}
                        className={`px-2 py-1 text-center ${c.color}`}
                        onClick={() => !isEditing && startEdit(row.id, c.key, row[c.key])}>
                        {isEditing ? (
                          <input
                            autoFocus
                            type="number"
                            value={editing[key]}
                            onChange={e => onChange(row.id, c.key, e.target.value)}
                            onBlur={() => saveCell(row, c.key)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveCell(row, c.key)
                              if (e.key === 'Escape') {
                                setEditing(prev => { const n = { ...prev }; delete n[key]; return n })
                              }
                            }}
                            className="w-16 text-center border border-blue-400 rounded px-1 py-0.5 text-sm outline-none"
                          />
                        ) : isSaving ? (
                          <span className="text-gray-400 text-xs">💾</span>
                        ) : (
                          <span className={canEdit ? 'cursor-pointer hover:bg-white/70 rounded px-1' : ''}>
                            {fmt(row[c.key])}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        Cijene u EUR • Važeće od 15.04.2026 • Izvor: Pasha cjenovnik 2026
      </p>
    </div>
  )
}
