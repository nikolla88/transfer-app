import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const BUS_TYPES     = ['sprinter', 'midi', 'bus']
const AIRPORTS      = ['TIV', 'TGD']
const BUCKETS       = ['budva', 'petrovac', 'bar']
const BUS_LABELS    = { sprinter: 'Sprinter (≤19)', midi: 'Midi bus (≤35)', bus: 'Veliki bus (≤57)' }
const BUCKET_LABELS = { budva: 'Budva/Bečići', petrovac: 'Petrovac', bar: 'Bar/Sutomore' }

// PriceCell mora biti VAN roditeljske komponente da ne bi remountovao na svaki render
function PriceCell({ value, isSaving, onSave }) {
  const [local, setLocal] = useState(value ?? '')

  useEffect(() => { setLocal(value ?? '') }, [value])

  return (
    <input
      type="number"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => onSave(local)}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      placeholder="0"
      className={`w-20 text-center font-mono text-sm border rounded px-2 py-1 outline-none transition-colors
        focus:border-brand-400 focus:ring-1 focus:ring-brand-300
        ${isSaving ? 'bg-yellow-50 border-yellow-300' : 'border-gray-300 hover:border-gray-400'}`}
    />
  )
}

export default function BusPrices() {
  const [suppliers,   setSuppliers]   = useState([])
  const [supplierId,  setSupplierId]  = useState('null')
  const [prices,      setPrices]      = useState({})
  const [saving,      setSaving]      = useState({})
  const [loading,     setLoading]     = useState(false)

  useEffect(() => {
    supabase.from('suppliers').select('id,name').order('name').then(({ data }) => {
      setSuppliers(data || [])
    })
  }, [])

  useEffect(() => { loadPrices() }, [supplierId])

  async function loadPrices() {
    setLoading(true)
    const sid = supplierId === 'null' ? null : supplierId
    let q = supabase.from('bus_prices').select('*')
    q = sid === null ? q.is('supplier_id', null) : q.eq('supplier_id', sid)
    const { data, error } = await q
    if (!error) {
      const map = {}
      for (const row of (data || [])) {
        map[`${row.bus_type}||${row.airport}||${row.zone_bucket}`] = {
          id: row.id,
          price_ow: Number(row.price_ow),
          price_rt: Number(row.price_rt),
        }
      }
      setPrices(map)
    }
    setLoading(false)
  }

  async function saveCell(bt, apt, bkt, field, value) {
    const key = `${bt}||${apt}||${bkt}`
    const num = parseFloat(value)
    if (isNaN(num)) return
    const skey = `${key}||${field}`
    setSaving(s => ({ ...s, [skey]: true }))

    const sid      = supplierId === 'null' ? null : supplierId
    const existing = prices[key]

    if (existing?.id) {
      await supabase.from('bus_prices').update({ [field]: num }).eq('id', existing.id)
      setPrices(p => ({ ...p, [key]: { ...p[key], [field]: num } }))
    } else {
      const { data } = await supabase.from('bus_prices').insert({
        supplier_id: sid, bus_type: bt, airport: apt, zone_bucket: bkt,
        price_ow: field === 'price_ow' ? num : 0,
        price_rt: field === 'price_rt' ? num : 0,
      }).select().single()
      if (data) {
        setPrices(p => ({
          ...p,
          [key]: { id: data.id, price_ow: Number(data.price_ow), price_rt: Number(data.price_rt) },
        }))
      }
    }

    setSaving(s => { const n = { ...s }; delete n[skey]; return n })
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-xl font-bold text-gray-900">🚌 Cjenovnik autobusa</h1>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-sm text-gray-600">Partner:</label>
          <select
            value={supplierId}
            onChange={e => setSupplierId(e.target.value)}
            className="input w-48 text-sm"
          >
            <option value="null">— Default cjenovnik —</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-8">Učitavam...</div>
      ) : (
        <div className="space-y-6">
          {AIRPORTS.map(apt => (
            <div key={apt} className="card overflow-hidden">
              <div className="bg-gray-800 text-white px-4 py-2 font-bold text-sm">
                Aerodrom {apt}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-gray-600 w-44">Autobus</th>
                    {BUCKETS.map(bkt => (
                      <th key={bkt} colSpan={2} className="text-center px-2 py-2 font-semibold text-gray-600">
                        {BUCKET_LABELS[bkt]}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b bg-gray-50/50">
                    <th />
                    {BUCKETS.flatMap(bkt => [
                      <th key={`${bkt}-ow`} className="text-center px-2 py-1 text-xs font-medium text-sky-600 w-24">OW €</th>,
                      <th key={`${bkt}-rt`} className="text-center px-2 py-1 text-xs font-medium text-emerald-600 w-24">RT €</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {BUS_TYPES.map((bt, i) => {
                    return (
                      <tr key={bt} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
                        <td className="px-4 py-2.5 font-medium text-gray-700">{BUS_LABELS[bt]}</td>
                        {BUCKETS.flatMap(bkt => {
                          const key = `${bt}||${apt}||${bkt}`
                          return [
                            <td key={`${bkt}-ow`} className="px-2 py-2 text-center">
                              <PriceCell
                                value={prices[key]?.price_ow}
                                isSaving={!!saving[`${key}||price_ow`]}
                                onSave={v => saveCell(bt, apt, bkt, 'price_ow', v)}
                              />
                            </td>,
                            <td key={`${bkt}-rt`} className="px-2 py-2 text-center">
                              <PriceCell
                                value={prices[key]?.price_rt}
                                isSaving={!!saving[`${key}||price_rt`]}
                                onSave={v => saveCell(bt, apt, bkt, 'price_rt', v)}
                              />
                            </td>,
                          ]
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-gray-400">
        Klikni na polje i unesi cijenu, potvrdi Enter ili klikni van polja. Promjene se čuvaju automatski.
      </p>
    </div>
  )
}
