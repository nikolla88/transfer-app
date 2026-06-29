import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const VEH_TYPES  = ['car', 'minivan', 'vclass']
const VEH_LABELS = { car: 'Auto (€)', minivan: 'Minivan (€)', vclass: 'V Class (€)' }
const AIRPORTS   = [
  { code: 'TIV', label: '✈ Tivat (TIV)' },
  { code: 'TGD', label: '✈ Podgorica (TGD)' },
]

export default function Prices() {
  const [suppliers, setSuppliers] = useState([])
  const [zones,     setZones]     = useState([])
  const [prices,    setPrices]    = useState({}) // key: `${sup}|${zone}|${vtype}|${airport}`
  const [selSup,    setSelSup]    = useState('')
  const [selApt,    setSelApt]    = useState('TIV')
  const [saving,    setSaving]    = useState(false)
  const [dirty,     setDirty]     = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: s }, { data: z }, { data: p }] = await Promise.all([
      supabase.from('suppliers').select('id, name').eq('active', true).order('name'),
      supabase.from('zones').select('id, name').order('name'),
      supabase.from('prices').select('*'),
    ])
    setSuppliers(s || [])
    setZones(z || [])
    const map = {}
    for (const row of (p || [])) {
      const apt = row.airport || 'TIV'
      map[`${row.supplier_id}|${row.zone_id}|${row.vehicle_type}|${apt}`] = row.price
    }
    setPrices(map)
    if (s?.length && !selSup) setSelSup(s[0].id)
  }

  function key(supId, zoneId, vtype, apt) {
    return `${supId}|${zoneId}|${vtype}|${apt}`
  }

  function getPrice(supId, zoneId, vtype, apt) {
    const k = key(supId, zoneId, vtype, apt)
    return dirty[k] !== undefined ? dirty[k] : (prices[k] ?? '')
  }

  function setPrice(supId, zoneId, vtype, apt, val) {
    setDirty(d => ({ ...d, [key(supId, zoneId, vtype, apt)]: val }))
  }

  async function saveAll() {
    setSaving(true)
    const upserts = []
    for (const [k, val] of Object.entries(dirty)) {
      const [supplier_id, zone_id, vehicle_type, airport] = k.split('|')
      const price = parseFloat(val)
      if (!isNaN(price) && price >= 0) {
        upserts.push({ supplier_id, zone_id, vehicle_type, airport, price })
      }
    }
    if (upserts.length) {
      await supabase.from('prices').upsert(upserts, {
        onConflict: 'supplier_id,zone_id,vehicle_type,airport'
      })
    }
    setDirty({})
    await load()
    setSaving(false)
  }

  const hasDirty    = Object.keys(dirty).length > 0
  const dirtyForApt = Object.keys(dirty).filter(k => k.endsWith(`|${selApt}`)).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Cijene po suplajeru i zoni</h1>
        {hasDirty && (
          <button onClick={saveAll} disabled={saving} className="btn-primary">
            {saving ? 'Čuvanje...' : `Sačuvaj sve izmjene (${Object.keys(dirty).length})`}
          </button>
        )}
      </div>

      {suppliers.length === 0 && (
        <div className="card p-8 text-center text-gray-400">
          Nema suplajera. Dodaj ih u sekciji Suplajeri.
        </div>
      )}

      {suppliers.length > 0 && (
        <>
          {/* Supplier tabs */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {suppliers.map(s => (
              <button
                key={s.id}
                onClick={() => setSelSup(s.id)}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  selSup === s.id
                    ? 'bg-brand-500 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>

          {/* Airport tabs */}
          {selSup && (
            <div className="flex gap-2 mb-4">
              {AIRPORTS.map(a => {
                const aptDirty = Object.keys(dirty).filter(k =>
                  k.startsWith(selSup) && k.endsWith(`|${a.code}`)
                ).length
                return (
                  <button
                    key={a.code}
                    onClick={() => setSelApt(a.code)}
                    className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      selApt === a.code
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {a.label}
                    {aptDirty > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                        selApt === a.code ? 'bg-white/30 text-white' : 'bg-blue-100 text-blue-600'
                      }`}>
                        {aptDirty}
                      </span>
                    )}
                  </button>
                )
              })}
              <span className="self-center text-xs text-gray-400 ml-2">
                Cijene se unose odvojeno za svaki aerodrom
              </span>
            </div>
          )}

          {/* Price grid */}
          {selSup && (
            <div className="card overflow-hidden">
              <div className={`px-4 py-2 text-sm font-medium border-b ${
                selApt === 'TIV'
                  ? 'bg-sky-50 text-sky-700 border-sky-100'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-100'
              }`}>
                {selApt === 'TIV' ? '✈ Tivat (TIV)' : '✈ Podgorica (TGD)'} → zone
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="th">Zona</th>
                    {VEH_TYPES.map(vt => (
                      <th key={vt} className="th text-center">{VEH_LABELS[vt]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {zones.map(z => (
                    <tr key={z.id} className="hover:bg-gray-50">
                      <td className="td font-medium">{z.name}</td>
                      {VEH_TYPES.map(vt => {
                        const k       = key(selSup, z.id, vt, selApt)
                        const isDirty = dirty[k] !== undefined
                        const val     = getPrice(selSup, z.id, vt, selApt)
                        return (
                          <td key={vt} className="td text-center">
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              className={`w-24 text-center rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                                isDirty
                                  ? 'border-brand-500 bg-blue-50 font-medium'
                                  : val ? 'border-gray-200' : 'border-gray-100 text-gray-300'
                              }`}
                              value={val}
                              onChange={e => setPrice(selSup, z.id, vt, selApt, e.target.value)}
                              placeholder="—"
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-2">
            Prazno polje = suplajeri nije dostupan za tu kombinaciju.
            {hasDirty && (
              <span className="text-brand-500 font-medium ml-1">
                Imaš {Object.keys(dirty).length} nesačuvanih izmjena.
              </span>
            )}
          </p>
        </>
      )}
    </div>
  )
}
