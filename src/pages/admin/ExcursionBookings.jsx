import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../App'
import Modal from '../../components/Modal'
import { fmtDateFull } from '../../lib/transferUtils'

const PAY_LABEL = { cash: 'Gotovina', card: 'Kartica', account: 'Račun' }
const STATUS_LABELS = {
  reserved:  { label: 'Rezervisano', cls: 'bg-sky-100 text-sky-700' },
  paid:      { label: 'Plaćeno',     cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Otkazano',    cls: 'bg-gray-200 text-gray-500' },
  penalty:   { label: 'Penal',       cls: 'bg-red-100 text-red-700' },
}

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

  const header = ['Vaučer', 'Datum rezervacije', 'Izlet', 'Datum izleta', 'Gost (nosilac)', 'Svi putnici', 'Broj rezervacije', 'Partner', 'Tip', 'Hotel', 'Pickup tačka', 'Odrasli', 'Djeca', 'Bebe', 'Ukupno pax', 'Cijena (€)', 'Plaćanje', 'Status', 'Predstavnik', 'Napomena']
  const data = rows.map(r => [
    'IZL-' + String(r.voucher_no).padStart(6, '0'),
    fmtDateTime(r.created_at),
    r.excursions?.name || '',
    fmtDateFull(r.date),
    r.guest_name,
    r.guest_full_names || '',
    r.claim_inc || '',
    r.partner || '',
    r.reservation_type || '',
    r.hotel_name || '',
    r.pickup_point || '',
    r.adult,
    r.child,
    r.infant || 0,
    (r.adult || 0) + (r.child || 0),
    Number(r.total_price).toFixed(2),
    PAY_LABEL[r.payment_method] || r.payment_method,
    STATUS_LABELS[r.status]?.label || r.status,
    r.profiles?.full_name || r.profiles?.email || '',
    r.note || '',
  ])
  const ws = XS.utils.aoa_to_sheet([header, ...data])
  ws['!cols'] = header.map(() => ({ wch: 15 }))
  const wb = XS.utils.book_new()
  XS.utils.book_append_sheet(wb, ws, 'Rezervacije')
  const out = XS.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `rezervacije_izleta_${todayStr()}.xlsx`
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ── Forma za izmjenu postojeće rezervacije ──────────────────────
function EditBookingModal({ row, onClose, onSaved }) {
  const [guestName,   setGuestName]   = useState(row.guest_name || '')
  const [guestFullNames, setGuestFullNames] = useState(row.guest_full_names || '')
  const [hotelName,   setHotelName]   = useState(row.hotel_name || '')
  const [pickupPoint, setPickupPoint] = useState(row.pickup_point || '')
  const [adult,  setAdult]  = useState(row.adult ?? 0)
  const [child,  setChild]  = useState(row.child ?? 0)
  const [infant, setInfant] = useState(row.infant ?? 0)
  const [priceAdult, setPriceAdult] = useState(String(row.price_adult ?? 0))
  const [priceChild, setPriceChild] = useState(String(row.price_child ?? 0))
  const [discount,   setDiscount]   = useState(String(row.discount ?? 0))
  const [paymentMethod, setPaymentMethod] = useState(row.payment_method || 'cash')
  const [status,   setStatus]   = useState(row.status || 'reserved')
  const [partner,  setPartner]  = useState(row.partner || '')
  const [reservationType, setReservationType] = useState(row.reservation_type || '')
  const [note,     setNote]     = useState(row.note || '')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const total = Math.max(0, (Number(adult) || 0) * (Number(priceAdult) || 0) + (Number(child) || 0) * (Number(priceChild) || 0) - (Number(discount) || 0))

  async function save() {
    if (!guestName.trim()) return setError('Ime gosta je obavezno.')
    if ((Number(adult) || 0) + (Number(child) || 0) <= 0) return setError('Unesi broj putnika (bar 1).')
    setSaving(true)
    setError('')

    const payload = {
      guest_name:       guestName.trim(),
      guest_full_names: guestFullNames.trim() || null,
      hotel_name:       hotelName.trim() || null,
      pickup_point:     pickupPoint.trim() || null,
      adult:            Number(adult) || 0,
      child:            Number(child) || 0,
      infant:           Number(infant) || 0,
      price_adult:      Number(priceAdult) || 0,
      price_child:      Number(priceChild) || 0,
      discount:         Number(discount) || 0,
      total_price:      total,
      payment_method:   paymentMethod,
      status,
      partner:          partner.trim() || null,
      reservation_type: reservationType || null,
      note:             note.trim() || null,
    }

    const { error: err } = await supabase.from('excursion_bookings').update(payload).eq('id', row.id)
    setSaving(false)
    if (err) { setError('Greška: ' + err.message); return }
    onSaved()
  }

  return (
    <Modal title={`Uredi rezervaciju — IZL-${String(row.voucher_no).padStart(6, '0')}`} onClose={onClose} wide
      footer={<>
        <button onClick={onClose} className="btn-ghost">Otkaži</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Čuvanje...' : 'Sačuvaj izmjene'}</button>
      </>}
    >
      <div className="space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

        <div>
          <label className="label mb-1.5">Status rezervacije</label>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(STATUS_LABELS).map(([key, s]) => (
              <button key={key} type="button" onClick={() => setStatus(key)}
                className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                  status === key ? s.cls + ' ring-2 ring-offset-1 ring-gray-400' : 'bg-gray-50 text-gray-400'
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div className="col-span-2">
            <label className="label">Ime gosta (nosilac rezervacije) *</label>
            <input className="input" value={guestName} onChange={e => setGuestName(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">Svi putnici (opciono — za štampu spiska)</label>
            <input className="input" value={guestFullNames} onChange={e => setGuestFullNames(e.target.value)} />
          </div>
          <div>
            <label className="label">Hotel</label>
            <input className="input" value={hotelName} onChange={e => setHotelName(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label">Odrasli</label>
              <input type="number" min="0" className="input" value={adult} onChange={e => setAdult(e.target.value)} />
            </div>
            <div>
              <label className="label">Djeca</label>
              <input type="number" min="0" className="input" value={child} onChange={e => setChild(e.target.value)} />
            </div>
            <div>
              <label className="label">Bebe</label>
              <input type="number" min="0" className="input" value={infant} onChange={e => setInfant(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div>
            <label className="label">Partner (agencija)</label>
            <input className="input" value={partner} onChange={e => setPartner(e.target.value)} />
          </div>
          <div>
            <label className="label">Tip rezervacije gosta</label>
            <select className="input" value={reservationType} onChange={e => setReservationType(e.target.value)}>
              <option value="">—</option>
              <option value="GRP">GRP</option>
              <option value="SHA">SHA</option>
              <option value="IND">IND</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div>
            <label className="label">Pickup tačka</label>
            <input className="input" value={pickupPoint} onChange={e => setPickupPoint(e.target.value)} />
          </div>
          <div>
            <label className="label">Način plaćanja</label>
            <select className="input" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
              <option value="cash">Gotovina</option>
              <option value="card">Kartica</option>
              <option value="account">Račun (faktura)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2 border-t">
          <div>
            <label className="label">Cijena — odrasli (€)</label>
            <input type="number" step="0.01" className="input" value={priceAdult} onChange={e => setPriceAdult(e.target.value)} />
          </div>
          <div>
            <label className="label">Cijena — djeca (€)</label>
            <input type="number" step="0.01" className="input" value={priceChild} onChange={e => setPriceChild(e.target.value)} />
          </div>
          <div>
            <label className="label">Popust (€)</label>
            <input type="number" step="0.01" className="input" value={discount} onChange={e => setDiscount(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex-1">
            <label className="label">Napomena</label>
            <input className="input" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="text-right pl-4">
            <div className="text-xs text-gray-400">UKUPNO</div>
            <div className="text-2xl font-bold text-gray-900">€{total.toFixed(2)}</div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function ExcursionBookings() {
  const { isRep } = useAuth()
  const [rows,       setRows]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [exporting,  setExporting]  = useState(false)
  const [editRow,    setEditRow]    = useState(null)

  const [excursionsList, setExcursionsList] = useState([])
  const [repsList,       setRepsList]       = useState([])

  const [excursionId, setExcursionId] = useState('')
  const [repId,       setRepId]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
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

  useEffect(() => { load() }, [excursionId, repId, statusFilter, dateFrom, dateTo])

  async function load() {
    setLoading(true)
    let q = supabase
      .from('excursion_bookings')
      .select('*, excursions(name), profiles(full_name,email)')
      .order('created_at', { ascending: false })

    if (excursionId)   q = q.eq('excursion_id', excursionId)
    if (repId)         q = q.eq('rep_id', repId)
    if (statusFilter)  q = q.eq('status', statusFilter)
    if (dateFrom)      q = q.gte('date', dateFrom)
    if (dateTo)        q = q.lte('date', dateTo)

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
          <select className="input w-44" value={excursionId} onChange={e => setExcursionId(e.target.value)}>
            <option value="">Svi izleti</option>
            {excursionsList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        {!isRep && (
          <div>
            <label className="label">Predstavnik</label>
            <select className="input w-44" value={repId} onChange={e => setRepId(e.target.value)}>
              <option value="">Svi</option>
              {repsList.map(r => <option key={r.id} value={r.id}>{r.full_name || r.email}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">Status</label>
          <select className="input w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Svi</option>
            {Object.entries(STATUS_LABELS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Datum izleta od</label>
          <input type="date" className="input w-40" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">do</label>
          <input type="date" className="input w-40" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {(excursionId || repId || statusFilter || dateFrom || dateTo) && (
          <button onClick={() => { setExcursionId(''); setRepId(''); setStatusFilter(''); setDateFrom(''); setDateTo('') }} className="btn-ghost text-xs">
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
            <div className="text-xs text-gray-500">putnika (bez beba)</div>
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
        <div className="card">
          <table className="w-full text-xs table-fixed">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="th w-[10%]">Vaučer</th>
                <th className="th w-[13%]">Izlet</th>
                <th className="th w-[18%]">Gost</th>
                <th className="th w-[9%]">Partner / tip</th>
                <th className="th w-[15%]">Hotel / pickup</th>
                <th className="th w-[8%] text-center">Pax</th>
                <th className="th w-[10%] text-right">Cijena</th>
                <th className="th w-[8%]">Status</th>
                <th className="th w-[9%]">Predstavnik</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  <td className="td">
                    {isRep ? (
                      <span className="font-mono font-semibold text-brand-700">IZL-{String(r.voucher_no).padStart(6, '0')}</span>
                    ) : (
                      <button onClick={() => setEditRow(r)}
                        className="font-mono font-semibold text-brand-700 hover:text-brand-800 hover:underline">
                        IZL-{String(r.voucher_no).padStart(6, '0')}
                      </button>
                    )}
                    <div className="text-[10px] text-gray-400 mt-0.5">{fmtDateTime(r.created_at)}</div>
                  </td>
                  <td className="td">
                    <div className="font-medium">{r.excursions?.name || '—'}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{fmtDateFull(r.date)}</div>
                  </td>
                  <td className="td">
                    {r.guest_name}
                    {r.claim_inc && <div className="text-[10px] text-gray-400 mt-0.5">#{r.claim_inc}</div>}
                  </td>
                  <td className="td text-gray-500">
                    <div>{r.partner || '—'}</div>
                    {r.reservation_type && <div className="text-[10px] mt-0.5">{r.reservation_type}</div>}
                  </td>
                  <td className="td">
                    <div>{r.hotel_name || '—'}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{r.pickup_point || '—'}</div>
                  </td>
                  <td className="td text-center font-mono">
                    {r.adult}+{r.child}
                    {r.infant > 0 && <div className="text-[10px] text-gray-400 mt-0.5">+{r.infant} bebe</div>}
                  </td>
                  <td className="td text-right font-mono font-semibold">
                    €{Number(r.total_price).toFixed(2)}
                    <div className="text-[10px] text-gray-400 mt-0.5 font-normal">{PAY_LABEL[r.payment_method] || r.payment_method}</div>
                  </td>
                  <td className="td">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap ${STATUS_LABELS[r.status]?.cls || 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABELS[r.status]?.label || r.status}
                    </span>
                  </td>
                  <td className="td text-gray-500">{r.profiles?.full_name || r.profiles?.email || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editRow && (
        <EditBookingModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => { setEditRow(null); load() }}
        />
      )}
    </div>
  )
}
