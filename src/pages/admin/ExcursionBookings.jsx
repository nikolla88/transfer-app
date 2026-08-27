import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../App'
import { fmtDateFull } from '../../lib/transferUtils'

const PAY_LABEL = { cash: 'Gotovina', card: 'Kartica', account: 'Račun' }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function exportToExcel(rows) {
  const XS = await new Promise((resolve, reject) => {
    if (window.__xlsxStyle) return resolve(window.__xlsxStyle)
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js'
    s.onload = () => {
      const lib = window.XLSXStyle ?? window.XLSX
      if (lib?.utils) { window.__xlsxStyle = lib; resolve(lib) }
      else reject(new Error('xlsx-js-style nije pronađen'))
    }
    s.onerror = reject
    document.head.appendChild(s)
  })

  const header = ['Vaučer', 'Kreirano', 'Izlet', 'Datum izleta', 'Gost', 'Broj rezervacije', 'Hotel', 'Pickup tačka', 'Odrasli', 'Djeca', 'Cijena (€)', 'Plaćanje', 'Predstavnik', 'Napomena']
  const data = rows.map(r => [
    'IZL-' + String(r.voucher_no).padStart(6, '0'),
    fmtDateTime(r.created_at),
    r.excursions?.name || '',
    fmtDateFull(r.date),
    r.guest_name,
    r.claim_inc || '',
    r.hotel_name || '',
    r.pickup_point || '',
    r.adult,
    r.child,
    Number(r.total_price).toFixed(2),
    PAY_LABEL[r.payment_method] || r.payment_method,
    r.profiles?.full_name || r.profiles?.email || '',
    r.note || '',
  ])
  const ws = XS.utils.aoa_to_sheet([header, ...data])
  ws['!cols'] = header.map(() => ({ wch: 16 }))
  const wb = XS.utils.book_new()
  XS.utils.book_append_sheet(wb, ws, 'Rezervacije')
  const out = XS.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `rezervacije_izleta_${todayStr()}.xlsx`
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
}

export default function ExcursionBookings() {
  const { isRep } = useAuth()
  const [rows,       setRows]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [exporting,  setExporting]  = useState(false)

  const [excursionsList, setExcursionsList] = useState([])
  const [repsList,       setRepsList]       = useState([])

  const [excursionId, setExcursionId] = useState('')
  const [repId,       setRepId]       = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')

  useEffect(() => {
    supabase.from('excursions').select('id,name').order('name')
      .then(({ data }) => setExcursionsList(data || []))
    if (!isRep) {
      supabase.from('profiles').select('id,full_name,email').order('full_name')
        .then(({ data }) => setRepsList(data || []))
    }
  }, [isRep])

  useEffect(() => { load() }, [excursionId, repId, dateFrom, dateTo])

  async function load() {
    setLoading(true)
    let q = supabase
      .from('excursion_bookings')
      .select('*, excursions(name), profiles(full_name,email)')
      .order('created_at', { ascending: false })

    if (excursionId) q = q.eq('excursion_id', excursionId)
    if (repId)       q = q.eq('rep_id', repId)
    if (dateFrom)    q = q.gte('date', dateFrom)
    if (dateTo)      q = q.lte('date', dateTo)

    const { data, error: err } = await q
    if (err) {
      setError(err.message?.includes('excursion_bookings')
        ? 'Tabela "excursion_bookings" ne postoji u bazi. Pokreni supabase_excursion_bookings.sql u Supabase SQL editoru.'
        : 'Greška: ' + err.message)
    } else {
      setError('')
    }
    setRows(data || [])
    setLoading(false)
  }

  async function doExport() {
    setExporting(true)
    try { await exportToExcel(rows) }
    catch (e) { alert('Greška: ' + e.message) }
    setExporting(false)
  }

  const totalPax   = rows.reduce((s, r) => s + (r.adult || 0) + (r.child || 0), 0)
  const totalPrice = rows.reduce((s, r) => s + Number(r.total_price || 0), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Link to="/admin/excursions/calendar" className="btn-ghost text-sm">← Kalendar</Link>
        <h1 className="text-xl font-bold text-gray-900">📋 Rezervacije izleta</h1>
        <button onClick={doExport} disabled={exporting || !rows.length} className="btn-ghost ml-auto">
          {exporting ? '⏳ Izvozim...' : '📥 Excel'}
        </button>
      </div>

      <div className="card p-3 mb-4 flex flex-wrap gap-2 items-end">
        <div>
          <label className="label">Izlet</label>
          <select className="input w-48" value={excursionId} onChange={e => setExcursionId(e.target.value)}>
            <option value="">Svi izleti</option>
            {excursionsList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        {!isRep && (
          <div>
            <label className="label">Predstavnik</label>
            <select className="input w-48" value={repId} onChange={e => setRepId(e.target.value)}>
              <option value="">Svi</option>
              {repsList.map(r => <option key={r.id} value={r.id}>{r.full_name || r.email}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">Datum izleta od</label>
          <input type="date" className="input w-40" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">do</label>
          <input type="date" className="input w-40" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {(excursionId || repId || dateFrom || dateTo) && (
          <button onClick={() => { setExcursionId(''); setRepId(''); setDateFrom(''); setDateTo('') }} className="btn-ghost text-xs">
            ✕ Poništi filtere
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="card p-3 text-center">
            <div className="text-2xl font-bold text-gray-800">{rows.length}</div>
            <div className="text-xs text-gray-500">rezervacija</div>
          </div>
          <div className="card p-3 text-center">
            <div className="text-2xl font-bold text-gray-800">{totalPax}</div>
            <div className="text-xs text-gray-500">putnika</div>
          </div>
          <div className="card p-3 text-center">
            <div className="text-2xl font-bold text-yellow-700">€{totalPrice.toFixed(2)}</div>
            <div className="text-xs text-gray-500">ukupno</div>
          </div>
        </div>
      )}

      {loading && <div className="text-center text-gray-400 py-12">Učitavam...</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="card p-8 text-center text-gray-400">Nema rezervacija za izabrane filtere.</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="th">Vaučer</th>
                <th className="th">Kreirano</th>
                <th className="th">Izlet</th>
                <th className="th">Datum</th>
                <th className="th">Gost</th>
                <th className="th">Hotel</th>
                <th className="th">Pickup tačka</th>
                <th className="th text-center">Pax</th>
                <th className="th text-right">Cijena</th>
                <th className="th">Plaćanje</th>
                <th className="th">Predstavnik</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="td font-mono font-semibold text-brand-700">IZL-{String(r.voucher_no).padStart(6, '0')}</td>
                  <td className="td text-gray-500">{fmtDateTime(r.created_at)}</td>
                  <td className="td font-medium">{r.excursions?.name || '—'}</td>
                  <td className="td">{fmtDateFull(r.date)}</td>
                  <td className="td">
                    {r.guest_name}
                    {r.claim_inc && <span className="text-gray-400 ml-1">#{r.claim_inc}</span>}
                  </td>
                  <td className="td">{r.hotel_name || '—'}</td>
                  <td className="td">{r.pickup_point || '—'}</td>
                  <td className="td text-center font-mono">{r.adult}{r.child ? `+${r.child}` : ''}</td>
                  <td className="td text-right font-mono font-semibold">€{Number(r.total_price).toFixed(2)}</td>
                  <td className="td">{PAY_LABEL[r.payment_method] || r.payment_method}</td>
                  <td className="td">{r.profiles?.full_name || r.profiles?.email || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
