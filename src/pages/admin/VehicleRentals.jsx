import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../App'
import Modal from '../../components/Modal'

function today() { return new Date().toISOString().slice(0, 10) }
function monthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function fmtDate(s) {
  return s ? new Date(s).toLocaleDateString('sr-Latn', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
}
function fmtEur(n) { return n != null ? `€${Number(n).toFixed(0)}` : '—' }

const EMPTY_FORM = {
  vehicle_id:    '',
  rental_date:   today(),
  duration_type: 'full_day',
  time_from:     '08:00',
  time_to:       '18:00',
  client_name:   '',
  price:         '',
  notes:         '',
}

const TYPE_ICON = { car: '🚗', car_comfort: '🚗', minivan: '🚐', vclass: '⭐' }

export default function VehicleRentals() {
  const { canWrite } = useAuth()
  const canEdit = canWrite('admin_vehicleblocks')

  const [date,       setDate]       = useState(today())
  const [rentals,    setRentals]    = useState([])    // za odabrani datum
  const [allRentals, setAllRentals] = useState([])    // za statistike
  const [vehicles,   setVehicles]   = useState([])
  const [modal,      setModal]      = useState(false)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)

  // Stats filteri
  const [statsFrom, setStatsFrom] = useState(monthStart())
  const [statsTo,   setStatsTo]   = useState(today())

  useEffect(() => { loadVehicles() }, [])
  useEffect(() => { loadRentals()  }, [date])
  useEffect(() => { loadAllRentals() }, [statsFrom, statsTo])

  async function loadVehicles() {
    const { data } = await supabase
      .from('vehicles').select('id, name, type').eq('active', true).order('name')
    setVehicles(data || [])
  }

  async function loadRentals() {
    const { data } = await supabase
      .from('vehicle_rentals')
      .select('*, vehicles(name, type)')
      .eq('rental_date', date)
      .order('time_from', { nullsFirst: true })
    setRentals(data || [])
  }

  async function loadAllRentals() {
    const { data } = await supabase
      .from('vehicle_rentals')
      .select('*, vehicles(name, type)')
      .gte('rental_date', statsFrom)
      .lte('rental_date', statsTo)
      .order('rental_date', { ascending: false })
    setAllRentals(data || [])
  }

  function openNew() {
    setForm({ ...EMPTY_FORM, rental_date: date })
    setModal(true)
  }

  async function save() {
    if (!form.vehicle_id) return
    setSaving(true)
    const isHours = form.duration_type === 'hours'
    await supabase.from('vehicle_rentals').insert({
      vehicle_id:    form.vehicle_id,
      rental_date:   form.rental_date,
      duration_type: form.duration_type,
      time_from:     isHours ? (form.time_from || null) : null,
      time_to:       isHours ? (form.time_to   || null) : null,
      client_name:   form.client_name?.trim() || null,
      price:         form.price !== '' ? Number(form.price) : null,
      notes:         form.notes?.trim() || null,
    })
    setSaving(false)
    setModal(false)
    loadRentals()
    loadAllRentals()
  }

  async function remove(id) {
    if (!confirm('Obrisati zapis o najmu?')) return
    await supabase.from('vehicle_rentals').delete().eq('id', id)
    loadRentals()
    loadAllRentals()
  }

  // Statistike po vozilu
  const vehicleMap = useMemo(() => {
    const m = {}
    for (const v of vehicles) m[v.id] = v
    return m
  }, [vehicles])

  const statsByVehicle = useMemo(() => {
    const map = {}
    for (const r of allRentals) {
      const vid = r.vehicle_id
      if (!map[vid]) map[vid] = {
        id: vid,
        name: r.vehicles?.name || '—',
        type: r.vehicles?.type || 'car',
        total: 0, fullDay: 0, hours: 0, revenue: 0,
      }
      map[vid].total++
      if (r.duration_type === 'full_day') map[vid].fullDay++
      else map[vid].hours++
      map[vid].revenue += r.price || 0
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue)
  }, [allRentals])

  const totalRevenue = useMemo(() =>
    allRentals.reduce((s, r) => s + (r.price || 0), 0), [allRentals])

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">🔑 Najam vozila</h1>
          <p className="text-sm text-gray-400 mt-0.5">Evidencija najma — vozilo je <strong>blokirano za transfere</strong> dok je u najmu</p>
        </div>
        {canEdit && (
          <button onClick={openNew} className="btn-primary">+ Dodaj najam</button>
        )}
      </div>

      {/* ── Dnevni prikaz ─────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm mb-6">
        <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-700">Najami na datum:</span>
          <input
            type="date" value={date}
            onChange={e => setDate(e.target.value)}
            className="input w-40 text-sm"
          />
        </div>

        {rentals.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">
            Nema najama za {fmtDate(date)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="th">Vozilo</th>
                <th className="th">Trajanje</th>
                <th className="th">Klijent</th>
                <th className="th text-right">Cijena</th>
                <th className="th">Napomena</th>
                {canEdit && <th className="th"/>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rentals.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="td font-medium">
                    {TYPE_ICON[r.vehicles?.type] || '🚗'} {r.vehicles?.name}
                  </td>
                  <td className="td">
                    {r.duration_type === 'full_day' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        🌐 Cijeli dan
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        ⏰ {r.time_from?.slice(0, 5)} – {r.time_to?.slice(0, 5)}
                      </span>
                    )}
                  </td>
                  <td className="td text-gray-700">{r.client_name || <span className="text-gray-300">—</span>}</td>
                  <td className="td text-right font-semibold text-green-700">
                    {r.price != null ? fmtEur(r.price) : <span className="text-gray-300 font-normal">—</span>}
                  </td>
                  <td className="td text-gray-500 text-xs max-w-[200px] truncate">{r.notes || '—'}</td>
                  {canEdit && (
                    <td className="td text-right">
                      <button onClick={() => remove(r.id)}
                        className="btn-ghost text-xs text-red-500 hover:text-red-700">
                        Briši
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Statistika ─────────────────────────────────────── */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-base font-semibold text-gray-800">📊 Statistika najma</h2>
          <input type="date" value={statsFrom} onChange={e => setStatsFrom(e.target.value)} className="input w-36 text-sm"/>
          <span className="text-gray-400 text-sm">→</span>
          <input type="date" value={statsTo}   onChange={e => setStatsTo(e.target.value)}   className="input w-36 text-sm"/>
        </div>

        {/* Summary kartice */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-green-600 text-white rounded-xl p-4">
            <div className="text-xs opacity-70 mb-1">Ukupni prihod od najma</div>
            <div className="text-2xl font-bold">{fmtEur(totalRevenue)}</div>
          </div>
          <div className="bg-blue-600 text-white rounded-xl p-4">
            <div className="text-xs opacity-70 mb-1">Ukupno najama</div>
            <div className="text-2xl font-bold">{allRentals.length}</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Aktivnih vozila</div>
            <div className="text-2xl font-bold text-gray-800">{statsByVehicle.length}</div>
          </div>
        </div>

        {/* Per-vehicle tabela */}
        {statsByVehicle.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Vozilo</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Ukupno najama</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Cijeli dan</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Par sati</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Prihod</th>
                  <th className="px-4 py-3 font-medium text-gray-600 w-24">Udio</th>
                </tr>
              </thead>
              <tbody>
                {statsByVehicle.map((v, i) => {
                  const pct = totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0
                  return (
                    <tr key={v.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">
                        {TYPE_ICON[v.type] || '🚗'} {v.name}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-700 font-semibold">{v.total}</td>
                      <td className="px-4 py-2.5 text-center text-blue-600">{v.fullDay}</td>
                      <td className="px-4 py-2.5 text-center text-purple-600">{v.hours}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-green-700">{fmtEur(v.revenue)}</td>
                      <td className="px-4 py-2.5">
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }}/>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5 text-right">{pct.toFixed(1)}%</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-green-50 border-t-2 border-green-200 font-semibold">
                  <td className="px-4 py-3 text-green-800">UKUPNO</td>
                  <td className="px-4 py-3 text-center text-green-800">{allRentals.length}</td>
                  <td className="px-4 py-3 text-center text-green-700">
                    {allRentals.filter(r => r.duration_type === 'full_day').length}
                  </td>
                  <td className="px-4 py-3 text-center text-green-700">
                    {allRentals.filter(r => r.duration_type === 'hours').length}
                  </td>
                  <td className="px-4 py-3 text-right text-green-700 text-base">{fmtEur(totalRevenue)}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {statsByVehicle.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl py-10 text-center text-gray-400 text-sm shadow-sm">
            Nema najama za odabrani period.
          </div>
        )}
      </div>

      {/* ── Detaljna lista ─────────────────────────────────── */}
      {allRentals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-2.5 border-b border-gray-100 text-xs text-gray-400 font-medium">
            Svi najami u periodu — {allRentals.length} zapisa
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Datum</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Vozilo</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Trajanje</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Klijent</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Cijena</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Napomena</th>
                  {canEdit && <th className="px-4 py-3"/>}
                </tr>
              </thead>
              <tbody>
                {allRentals.map((r, i) => (
                  <tr key={r.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmtDate(r.rental_date)}</td>
                    <td className="px-4 py-2 font-medium text-gray-800">
                      {TYPE_ICON[r.vehicles?.type] || '🚗'} {r.vehicles?.name}
                    </td>
                    <td className="px-4 py-2">
                      {r.duration_type === 'full_day' ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Cijeli dan</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium font-mono">
                          {r.time_from?.slice(0,5)} – {r.time_to?.slice(0,5)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{r.client_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2 text-right font-semibold text-green-700">
                      {r.price != null ? fmtEur(r.price) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-xs max-w-[180px] truncate">{r.notes || '—'}</td>
                    {canEdit && (
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => remove(r.id)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">
                          Briši
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modal: novi najam ──────────────────────────────── */}
      {modal && (
        <Modal
          title="🔑 Novi najam vozila"
          onClose={() => setModal(false)}
          footer={<>
            <button onClick={() => setModal(false)} className="btn-ghost">Otkaži</button>
            <button onClick={save} disabled={saving || !form.vehicle_id} className="btn-primary">
              {saving ? 'Čuvanje...' : 'Sačuvaj'}
            </button>
          </>}
        >
          <div className="space-y-4">

            {/* Vozilo */}
            <div>
              <label className="label">Vozilo *</label>
              <select className="input" value={form.vehicle_id}
                onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}>
                <option value="">— Odaberi vozilo —</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {TYPE_ICON[v.type] || '🚗'} {v.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Datum */}
            <div>
              <label className="label">Datum najma *</label>
              <input type="date" className="input" value={form.rental_date}
                onChange={e => setForm(f => ({ ...f, rental_date: e.target.value }))}/>
            </div>

            {/* Trajanje */}
            <div>
              <label className="label">Trajanje</label>
              <div className="flex gap-2">
                {[['full_day','🌐 Cijeli dan'],['hours','⏰ Par sati']].map(([v,l]) => (
                  <button key={v}
                    onClick={() => setForm(f => ({ ...f, duration_type: v }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      form.duration_type === v
                        ? v === 'full_day' ? 'bg-blue-600 text-white border-blue-600'
                                           : 'bg-purple-600 text-white border-purple-600'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Vrijeme (samo za par sati) */}
            {form.duration_type === 'hours' && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label">Od</label>
                  <input type="time" className="input" value={form.time_from}
                    onChange={e => setForm(f => ({ ...f, time_from: e.target.value }))}/>
                </div>
                <div className="flex-1">
                  <label className="label">Do</label>
                  <input type="time" className="input" value={form.time_to}
                    onChange={e => setForm(f => ({ ...f, time_to: e.target.value }))}/>
                </div>
              </div>
            )}

            {/* Klijent */}
            <div>
              <label className="label">Ime klijenta</label>
              <input className="input" placeholder="Ko iznajmljuje vozilo..."
                value={form.client_name}
                onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}/>
            </div>

            {/* Cijena */}
            <div>
              <label className="label">Cijena (€)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                <input type="number" min="0" step="1" className="input pl-7"
                  placeholder="0"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}/>
              </div>
            </div>

            {/* Napomena */}
            <div>
              <label className="label">Napomena</label>
              <input className="input" placeholder="Opciono..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}/>
            </div>

          </div>
        </Modal>
      )}
    </div>
  )
}
