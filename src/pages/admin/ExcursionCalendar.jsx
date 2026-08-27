import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../App'
import Modal from '../../components/Modal'
import { fmtDate, fmtDateFull } from '../../lib/transferUtils'

const DOW_LABELS  = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned']
const WINDOW_DAYS = 21 // 3 sedmice prikazano odjednom
const PAY_LABEL   = { cash: 'Gotovina', card: 'Kartica', account: 'Račun (faktura)' }

function pad(n) { return String(n).padStart(2, '0') }
function toYMD(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return toYMD(d)
}
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = (d.getDay() + 6) % 7 // ponedjeljak = 0
  d.setDate(d.getDate() - dow)
  return toYMD(d)
}
function todayStr() { return toYMD(new Date()) }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ── Štampa vaučera ─────────────────────────────────────────────
function openPrintVoucher(booking, excursion) {
  const voucherCode = 'IZL-' + String(booking.voucher_no).padStart(6, '0')
  const html = `<!DOCTYPE html><html lang="hr"><head><meta charset="utf-8"><title>Vaučer ${voucherCode}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#fff;color:#111;display:flex;justify-content:center;padding:20px}
  .voucher{width:380px;border:2px dashed #999;border-radius:12px;padding:24px}
  .hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
  .company{font-size:20px;font-weight:700}
  .code{font-size:14px;font-weight:700;background:#111;color:#fff;padding:4px 10px;border-radius:4px}
  h1{font-size:22px;margin-bottom:14px}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:14px}
  .row span{color:#777}
  .row strong{text-align:right}
  .note{margin-top:12px;padding:8px 10px;background:#fef9e7;border-radius:6px;font-size:12px;color:#7a5c00}
  .foot{margin-top:18px;font-size:11px;color:#888;font-style:italic;text-align:center;line-height:1.5}
  @media print{ @page{size:A6 portrait;margin:6mm} body{padding:0} .voucher{border:1px solid #111;width:100%} }
</style></head><body>
  <div class="voucher">
    <div class="hdr"><div class="company">PROMETHEUS</div><div class="code">${voucherCode}</div></div>
    <h1>${escapeHtml(excursion?.name || '')}</h1>
    <div class="row"><span>Datum</span><strong>${fmtDateFull(booking.date)}</strong></div>
    <div class="row"><span>Gost</span><strong>${escapeHtml(booking.guest_name)}</strong></div>
    <div class="row"><span>Hotel</span><strong>${escapeHtml(booking.hotel_name || '—')}</strong></div>
    <div class="row"><span>Pick-up tačka</span><strong>${escapeHtml(booking.pickup_point || '—')}</strong></div>
    <div class="row"><span>Putnici</span><strong>${booking.adult} odraslih${booking.child ? ', ' + booking.child + ' djece' : ''}</strong></div>
    <div class="row"><span>Cijena</span><strong>€${Number(booking.total_price).toFixed(2)}</strong></div>
    <div class="row"><span>Način plaćanja</span><strong>${PAY_LABEL[booking.payment_method] || booking.payment_method}</strong></div>
    ${booking.note ? `<div class="note">${escapeHtml(booking.note)}</div>` : ''}
    <div class="foot">Ovaj vaučer je vaša karta za ulazak u autobus.<br>Molimo budite na pick-up mjestu 10 minuta prije polaska.</div>
  </div>
</body></html>`
  const win = window.open('', '_blank', 'width=480,height=720')
  if (!win) { alert('Dozvoli pop-up prozore za ovu stranicu.'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
}

// ── Forma za novu rezervaciju / prodaju izleta ──────────────────
function BookingModal({ excursions, hotels, profile, initialExcursionId, initialDate, onClose, onSaved }) {
  const [excursionId, setExcursionId] = useState(initialExcursionId || '')
  const [dateOptions, setDateOptions] = useState([])
  const [date,        setDate]        = useState(initialDate || '')
  const [loadingDates, setLoadingDates] = useState(false)

  const [claimInput,  setClaimInput]  = useState('')
  const [nameQuery,   setNameQuery]   = useState('')
  const [nameSuggestions, setNameSuggestions] = useState([])
  const [resolvedClaim, setResolvedClaim] = useState(null) // claim_inc broj ako je gost povezan

  const [guestName, setGuestName] = useState('')
  const [hotelName, setHotelName] = useState('')
  const [adult, setAdult] = useState(1)
  const [child, setChild] = useState(0)
  const [priceAdult, setPriceAdult] = useState('')
  const [priceChild, setPriceChild] = useState('')
  const [discount, setDiscount] = useState('0')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [pickupPoint, setPickupPoint] = useState('')
  const [pickupIsSuggestion, setPickupIsSuggestion] = useState(false)
  const [rememberPickup, setRememberPickup] = useState(false)
  const [note, setNote] = useState('')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [savedBooking, setSavedBooking] = useState(null)

  const selectedExcursion = excursions.find(e => e.id === excursionId) || null

  // Kad se promijeni izlet: predloži cijenu iz kataloga + učitaj otvorene datume sa slobodnim mjestima
  useEffect(() => {
    if (!excursionId) { setDateOptions([]); return }
    const exc = excursions.find(e => e.id === excursionId)
    if (exc) {
      setPriceAdult(String(exc.price_adult ?? '0'))
      setPriceChild(String(exc.price_child ?? '0'))
    }
    loadDateOptions(excursionId)
  }, [excursionId])

  async function loadDateOptions(excId) {
    setLoadingDates(true)
    const { data: rows } = await supabase
      .from('excursion_dates')
      .select('date,capacity')
      .eq('excursion_id', excId)
      .eq('status', 'open')
      .gte('date', todayStr())
      .order('date')

    if (!rows || !rows.length) { setDateOptions([]); setLoadingDates(false); return }

    const { data: soldRows } = await supabase.rpc('get_excursion_sold_counts', {
      p_excursion_ids: [excId], p_start: rows[0].date, p_end: rows[rows.length - 1].date,
    })
    const soldMap = {}
    for (const r of (soldRows || [])) soldMap[r.date] = Number(r.sold) || 0

    const withFree = rows
      .map(r => ({ ...r, sold: soldMap[r.date] || 0 }))
      .filter(r => r.sold < r.capacity)
    setDateOptions(withFree)
    setLoadingDates(false)
  }

  // Pretraga po imenu — predlozi iz rooming liste
  useEffect(() => {
    if (nameQuery.trim().length < 3) { setNameSuggestions([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('rooming_list')
        .select('claim_inc,tourist_name,all_passengers,hotel_name,adult,child')
        .ilike('tourist_name', `%${nameQuery.trim()}%`)
        .limit(8)
      if (!cancelled) setNameSuggestions(data || [])
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [nameQuery])

  async function resolveClaim(claimStr) {
    const claim = claimStr.trim()
    if (!claim) return
    const { data, error: err } = await supabase
      .from('rooming_list')
      .select('claim_inc,tourist_name,all_passengers,hotel_name,adult,child')
      .eq('claim_inc', claim)
    if (err || !data || !data.length) {
      setError(`Rezervacija #${claim} nije pronađena — možeš ručno unijeti podatke gosta ispod.`)
      return
    }
    applyClaimRows(data)
  }

  function applyClaimRows(rows) {
    const names = [...new Set(
      rows.flatMap(r => (r.all_passengers || r.tourist_name || '').split(';').map(s => s.trim()).filter(Boolean))
    )]
    const totalAdult = rows.reduce((s, r) => s + (r.adult || 0), 0)
    const totalChild = rows.reduce((s, r) => s + (r.child || 0), 0)
    setGuestName(names.join(', ') || rows[0].tourist_name || '')
    setHotelName(rows[0].hotel_name || '')
    setAdult(totalAdult || 1)
    setChild(totalChild || 0)
    setResolvedClaim(rows[0].claim_inc)
    setClaimInput(String(rows[0].claim_inc))
    setNameQuery('')
    setNameSuggestions([])
    setError('')
  }

  // Pickup tačka: predloži iz excursion_pickup_points (ako postoji), inače opšta pickup_point hotela
  useEffect(() => {
    if (!hotelName || !excursionId) return
    const hotel = hotels.find(h => h.name === hotelName)
    if (!hotel) { setPickupPoint(''); setPickupIsSuggestion(false); return }
    supabase.from('excursion_pickup_points')
      .select('pickup_point')
      .eq('excursion_id', excursionId)
      .eq('hotel_id', hotel.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.pickup_point) {
          setPickupPoint(data.pickup_point)
          setPickupIsSuggestion(false)
        } else {
          setPickupPoint(hotel.pickup_point || '')
          setPickupIsSuggestion(true)
        }
        setRememberPickup(false)
      })
  }, [hotelName, excursionId])

  const total = Math.max(0, (Number(adult) || 0) * (Number(priceAdult) || 0) + (Number(child) || 0) * (Number(priceChild) || 0) - (Number(discount) || 0))

  async function save() {
    if (!excursionId) return setError('Izaberi izlet.')
    if (!date) return setError('Izaberi datum.')
    if (!guestName.trim()) return setError('Unesi ime gosta.')
    if ((Number(adult) || 0) + (Number(child) || 0) <= 0) return setError('Unesi broj putnika (bar 1).')

    setSaving(true)
    setError('')

    const payload = {
      excursion_id:   excursionId,
      date,
      claim_inc:      resolvedClaim || null,
      guest_name:     guestName.trim(),
      hotel_name:     hotelName || null,
      pickup_point:   pickupPoint.trim() || null,
      adult:          Number(adult) || 0,
      child:          Number(child) || 0,
      price_adult:    Number(priceAdult) || 0,
      price_child:    Number(priceChild) || 0,
      discount:       Number(discount) || 0,
      total_price:    total,
      payment_method: paymentMethod,
      rep_id:         profile?.id || null,
      note:           note.trim() || null,
    }

    const { data, error: err } = await supabase.from('excursion_bookings').insert(payload).select().single()
    if (err) {
      setError('Greška pri čuvanju: ' + err.message)
      setSaving(false)
      return
    }

    if (rememberPickup && pickupPoint.trim()) {
      const hotel = hotels.find(h => h.name === hotelName)
      if (hotel) {
        await supabase.from('excursion_pickup_points').upsert({
          excursion_id: excursionId, hotel_id: hotel.id,
          pickup_point: pickupPoint.trim(), updated_at: new Date().toISOString(),
        }, { onConflict: 'excursion_id,hotel_id' })
      }
    }

    setSaving(false)
    setSavedBooking(data)
    onSaved?.()
  }

  // ── Prikaz nakon uspješnog snimanja ────────────────────────────
  if (savedBooking) {
    const voucherCode = 'IZL-' + String(savedBooking.voucher_no).padStart(6, '0')
    return (
      <Modal title="Rezervacija sačuvana ✅" onClose={onClose}
        footer={<>
          <button onClick={onClose} className="btn-ghost">Zatvori</button>
          <button onClick={() => openPrintVoucher(savedBooking, selectedExcursion)} className="btn-primary">🖨 Štampaj vaučer</button>
        </>}
      >
        <div className="space-y-2 text-sm">
          <div className="text-center mb-3">
            <span className="inline-block px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 font-bold text-lg">{voucherCode}</span>
          </div>
          <div className="flex justify-between"><span className="text-gray-500">Izlet</span><strong>{selectedExcursion?.name}</strong></div>
          <div className="flex justify-between"><span className="text-gray-500">Datum</span><strong>{fmtDateFull(savedBooking.date)}</strong></div>
          <div className="flex justify-between"><span className="text-gray-500">Gost</span><strong>{savedBooking.guest_name}</strong></div>
          <div className="flex justify-between"><span className="text-gray-500">Putnici</span><strong>{savedBooking.adult} odr. {savedBooking.child ? `+ ${savedBooking.child} dj.` : ''}</strong></div>
          <div className="flex justify-between"><span className="text-gray-500">Cijena</span><strong>€{Number(savedBooking.total_price).toFixed(2)}</strong></div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="🎟️ Nova rezervacija izleta" onClose={onClose} wide
      footer={<>
        <button onClick={onClose} className="btn-ghost">Otkaži</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Čuvanje...' : 'Sačuvaj rezervaciju'}</button>
      </>}
    >
      <div className="space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Izlet *</label>
            <select className="input" value={excursionId} onChange={e => { setExcursionId(e.target.value); setDate('') }}>
              <option value="">— Izaberi izlet —</option>
              {excursions.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Datum *</label>
            <select className="input" value={date} onChange={e => setDate(e.target.value)} disabled={!excursionId}>
              <option value="">
                {!excursionId ? '— prvo izaberi izlet —' : loadingDates ? 'Učitavam...' : dateOptions.length ? '— izaberi datum —' : 'Nema otvorenih datuma sa slobodnim mjestima'}
              </option>
              {dateOptions.map(d => (
                <option key={d.date} value={d.date}>{fmtDateFull(d.date)} — slobodno {d.capacity - d.sold}/{d.capacity}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-2 border-t">
          <label className="label mb-1.5">Pronađi gosta iz rooming liste (opciono)</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <input className="input" placeholder="Broj rezervacije..." value={claimInput}
                onChange={e => { setClaimInput(e.target.value); if (!e.target.value.trim()) setResolvedClaim(null) }}
                onBlur={e => resolveClaim(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); resolveClaim(e.target.value) } }} />
            </div>
            <div className="relative">
              <input className="input" placeholder="Ili pretraga po prezimenu..." value={nameQuery}
                onChange={e => setNameQuery(e.target.value)} />
              {nameSuggestions.length > 0 && (
                <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                  {nameSuggestions.map((s, i) => (
                    <button key={i} type="button" onClick={() => applyClaimRows([s])}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-0">
                      <div className="font-medium text-gray-800">{s.tourist_name}</div>
                      <div className="text-xs text-gray-400">#{s.claim_inc} · {s.hotel_name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {resolvedClaim && (
            <p className="text-xs text-green-600 mt-1.5">✓ Povezano sa rezervacijom #{resolvedClaim}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div className="col-span-2">
            <label className="label">Ime gosta *</label>
            <input className="input" value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="Ime i prezime" />
          </div>
          <div>
            <label className="label">Hotel</label>
            <select className="input" value={hotelName} onChange={e => setHotelName(e.target.value)}>
              <option value="">— Nezavisan gost / bez hotela —</option>
              {hotels.map(h => <option key={h.id} value={h.name}>{h.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Odrasli</label>
              <input type="number" min="0" className="input" value={adult} onChange={e => setAdult(e.target.value)} />
            </div>
            <div>
              <label className="label">Djeca</label>
              <input type="number" min="0" className="input" value={child} onChange={e => setChild(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div>
            <label className="label">Pickup tačka</label>
            <input className="input" value={pickupPoint} onChange={e => setPickupPoint(e.target.value)} placeholder="npr. Market Bečići" />
            {pickupIsSuggestion && pickupPoint && (
              <label className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500">
                <input type="checkbox" checked={rememberPickup} onChange={e => setRememberPickup(e.target.checked)} />
                Zapamti kao podrazumijevanu tačku za ovaj hotel × izlet
              </label>
            )}
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
          <div>
            <label className="label">Napomena (opciono)</label>
            <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="npr. alergija, poseban zahtjev" />
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

// ── Kalendar / matrica svih grupnih izleta ──────────────────────
export default function ExcursionCalendar() {
  const { isRep, profile } = useAuth()

  const [groupList, setGroupList] = useState([]) // grupni izleti sa svim poljima potrebnim za prodaju
  const [hotels,    setHotels]    = useState([])
  const [startDate, setStartDate] = useState(() => mondayOf(todayStr()))
  const [datesMap,  setDatesMap]  = useState({}) // 'excursionId|YYYY-MM-DD' → red
  const [soldMap,   setSoldMap]   = useState({}) // 'excursionId|YYYY-MM-DD' → broj prodatih mjesta
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')

  const [editCell, setEditCell] = useState(null) // { excursionId, excursionName, date } ili null
  const [form,     setForm]     = useState({ capacity: '', status: 'open', note: '' })
  const [saving,   setSaving]   = useState(false)

  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingInit, setBookingInit] = useState(null) // { excursionId, date } ili null

  useEffect(() => {
    supabase.from('excursions')
      .select('id,name,default_capacity,price_adult,price_child,meeting_point')
      .eq('type', 'grupni').order('name')
      .then(({ data }) => setGroupList(data || []))
    supabase.from('hotels').select('id,name,pickup_point').order('name')
      .then(({ data }) => setHotels(data || []))
  }, [])

  useEffect(() => { loadWindow() }, [startDate, groupList])

  const days  = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(startDate, i))
  const weeks = Array.from({ length: WINDOW_DAYS / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7))

  async function loadWindow() {
    if (!groupList.length) { setLoading(false); return }
    setLoading(true)
    const end = addDays(startDate, WINDOW_DAYS - 1)
    const ids = groupList.map(g => g.id)

    const { data, error: err } = await supabase
      .from('excursion_dates')
      .select('*')
      .in('excursion_id', ids)
      .gte('date', startDate)
      .lte('date', end)

    if (err) {
      setError(err.message?.includes('excursion_dates')
        ? 'Tabela "excursion_dates" ne postoji u bazi. Pokreni supabase_excursion_dates.sql u Supabase SQL editoru.'
        : 'Greška: ' + err.message)
    } else {
      setError('')
    }
    const map = {}
    for (const row of (data || [])) map[`${row.excursion_id}|${row.date}`] = row
    setDatesMap(map)

    const { data: soldRows, error: soldErr } = await supabase.rpc('get_excursion_sold_counts', {
      p_excursion_ids: ids, p_start: startDate, p_end: end,
    })
    if (!soldErr) {
      const sMap = {}
      for (const r of (soldRows || [])) sMap[`${r.excursion_id}|${r.date}`] = Number(r.sold) || 0
      setSoldMap(sMap)
    }
    setLoading(false)
  }

  function prevWindow() { setStartDate(d => addDays(d, -WINDOW_DAYS)) }
  function nextWindow() { setStartDate(d => addDays(d, WINDOW_DAYS)) }
  function goToday()    { setStartDate(mondayOf(todayStr())) }

  function openCell(exc, dateStr) {
    const row = datesMap[`${exc.id}|${dateStr}`]
    setForm({
      capacity: row ? String(row.capacity) : (exc.default_capacity != null ? String(exc.default_capacity) : ''),
      status:   row?.status || 'open',
      note:     row?.note || '',
    })
    setEditCell({ excursionId: exc.id, excursionName: exc.name, date: dateStr })
  }

  // Klik na ćeliju: admin/dispečer uređuju kapacitet/status, predstavnik odmah prodaje
  function handleCellClick(exc, dateStr) {
    if (isRep) {
      const row = datesMap[`${exc.id}|${dateStr}`]
      const cellSold = soldMap[`${exc.id}|${dateStr}`] || 0
      if (!row || row.status !== 'open' || cellSold >= row.capacity) return
      setBookingInit({ excursionId: exc.id, date: dateStr })
      setBookingOpen(true)
      return
    }
    openCell(exc, dateStr)
  }

  async function saveCell() {
    setSaving(true)
    const payload = {
      excursion_id: editCell.excursionId,
      date:         editCell.date,
      capacity:     form.capacity === '' ? 0 : Number(form.capacity),
      status:       form.status,
      note:         form.note.trim() || null,
      updated_at:   new Date().toISOString(),
    }
    const { error: err } = await supabase
      .from('excursion_dates')
      .upsert(payload, { onConflict: 'excursion_id,date' })

    if (err) {
      alert('Greška pri čuvanju: ' + err.message)
      setSaving(false)
      return
    }
    setSaving(false)
    setEditCell(null)
    loadWindow()
  }

  async function deleteCell() {
    if (!confirm('Ukloniti podešavanje za ovaj dan? Dan će ponovo biti neponuđen.')) return
    setSaving(true)
    const { error: err } = await supabase.from('excursion_dates').delete()
      .eq('excursion_id', editCell.excursionId).eq('date', editCell.date)
    setSaving(false)
    if (err) {
      alert(err.message?.includes('foreign key') || err.message?.includes('violates')
        ? 'Ne može se ukloniti — na ovaj datum već postoje rezervacije gostiju.'
        : 'Greška: ' + err.message)
      return
    }
    setEditCell(null)
    loadWindow()
  }

  const editRow  = editCell ? datesMap[`${editCell.excursionId}|${editCell.date}`] : null
  const editSold = editCell ? (soldMap[`${editCell.excursionId}|${editCell.date}`] || 0) : 0

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">📅 Kalendar izleta</h1>
        <button onClick={() => { setBookingInit(null); setBookingOpen(true) }} className="btn-primary">🎟️ Nova rezervacija</button>
        <div className="flex items-center gap-1.5 ml-auto">
          <button onClick={prevWindow} className="btn-ghost px-3">← 3 sedmice</button>
          <button onClick={goToday} className="btn-ghost px-3">Danas</button>
          <button onClick={nextWindow} className="btn-ghost px-3">3 sedmice →</button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {!loading && groupList.length === 0 && !error && (
        <div className="card p-8 text-center text-gray-400">
          Nema grupnih izleta u katalogu. Dodaj ih na stranici "Izleti".
        </div>
      )}

      {groupList.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="border-collapse text-xs w-full">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky left-0 z-20 bg-gray-50 border-b border-r px-3 py-2 text-left text-xs font-semibold text-gray-500 w-44 min-w-[11rem]">
                  Izlet
                </th>
                {weeks.map((week, wi) => (
                  <th key={wi} colSpan={7}
                    className="border-b border-l border-gray-200 px-1 py-1.5 text-center text-[11px] font-semibold text-gray-500 bg-gray-50 whitespace-nowrap">
                    {fmtDate(week[0])} – {fmtDate(week[6])}
                  </th>
                ))}
              </tr>
              <tr>
                {days.map((d, i) => (
                  <th key={d}
                    className={`border-b border-gray-200 py-1 text-center text-[10px] font-semibold w-11 min-w-[2.5rem]
                      ${i % 7 === 0 ? 'border-l' : ''}
                      ${d === todayStr() ? 'text-brand-600 bg-brand-50' : 'text-gray-400 bg-gray-50'}`}>
                    {DOW_LABELS[i % 7]}<br />{d.slice(8, 10)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupList.map(exc => (
                <tr key={exc.id}>
                  <td className="sticky left-0 z-10 bg-white border-r border-b border-gray-200 px-3 py-1 text-sm font-medium text-gray-800 whitespace-nowrap">
                    {exc.name}
                  </td>
                  {days.map((d, i) => {
                    const row = datesMap[`${exc.id}|${d}`]
                    const isOpen = row?.status === 'open'
                    const cellSold = soldMap[`${exc.id}|${d}`] || 0
                    const over = isOpen && row && cellSold > row.capacity
                    const isToday = d === todayStr()
                    const sellable = isRep && isOpen && row && cellSold < row.capacity
                    return (
                      <td key={d}
                        className={`border-b border-gray-200 p-0.5 ${i % 7 === 0 ? 'border-l' : ''} ${isToday ? 'bg-brand-50/40' : ''}`}>
                        <button
                          onClick={() => handleCellClick(exc, d)}
                          title={row?.note || ''}
                          className={`w-full h-10 rounded flex flex-col items-center justify-center leading-none transition-colors
                            ${!row
                              ? `bg-white border border-dashed border-gray-200 ${isRep ? 'cursor-default' : 'hover:bg-gray-50'}`
                              : !isOpen
                                ? `bg-gray-100 text-gray-400 border border-gray-200 ${isRep ? 'cursor-default' : 'hover:border-gray-300'}`
                                : over
                                  ? 'bg-red-50 text-red-700 border-2 border-red-400 hover:border-red-500'
                                  : `bg-green-50 text-green-800 border border-green-200 ${sellable || !isRep ? 'hover:border-green-400' : 'cursor-default opacity-50'}`
                            }`}
                        >
                          {row && isOpen && (
                            <>
                              <span className="text-[11px] font-bold">{row.capacity}</span>
                              <span className="text-[10px]">{cellSold}</span>
                            </>
                          )}
                          {row && !isOpen && <span className="text-[9px] font-semibold">Zatv.</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-4 mt-4 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-green-50 border border-green-300 inline-block" /> Otvoren
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-50 border-2 border-red-400 inline-block" /> Prekoračen kapacitet — treba veći bus
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-gray-100 border border-gray-300 inline-block" /> Zatvoren
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-white border border-dashed border-gray-200 inline-block" /> Nije podešen
        </span>
        {isRep && <span className="italic">Klikni zeleno polje da prodaš mjesto na tom datumu.</span>}
      </div>

      {/* Admin/dispečer: brzo uređivanje kapaciteta/statusa dana */}
      {editCell && !isRep && (
        <Modal
          title={`${editCell.excursionName} — ${fmtDateFull(editCell.date)}`}
          onClose={() => setEditCell(null)}
          footer={<>
            {editRow && (
              <button onClick={deleteCell} className="btn-ghost text-red-500 mr-auto">Ukloni</button>
            )}
            <button onClick={() => setEditCell(null)} className="btn-ghost">Otkaži</button>
            <button onClick={saveCell} disabled={saving} className="btn-primary">{saving ? 'Čuvanje...' : 'Sačuvaj'}</button>
          </>}
        >
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setForm(f => ({ ...f, status: 'open' }))}
                className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-colors ${
                  form.status === 'open' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'
                }`}
              >
                🟢 Otvoren
              </button>
              <button
                onClick={() => setForm(f => ({ ...f, status: 'closed' }))}
                className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-colors ${
                  form.status === 'closed' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500'
                }`}
              >
                🔴 Zatvoren
              </button>
            </div>
            <div>
              <label className="label">Broj mjesta (veličina busa)</label>
              <input
                type="number"
                className="input"
                value={form.capacity}
                onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                placeholder="npr. 50"
              />
            </div>
            {editRow && (
              <p className="text-xs text-gray-400">
                Prodato mjesta: {editSold}/{editRow.capacity}
              </p>
            )}
            <div>
              <label className="label">Napomena (opciono)</label>
              <textarea
                className="input"
                rows={2}
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="npr. rezervisan bus kod XY prevoznika"
              />
            </div>
          </div>
        </Modal>
      )}

      {bookingOpen && (
        <BookingModal
          excursions={groupList}
          hotels={hotels}
          profile={profile}
          initialExcursionId={bookingInit?.excursionId}
          initialDate={bookingInit?.date}
          onClose={() => setBookingOpen(false)}
          onSaved={loadWindow}
        />
      )}
    </div>
  )
}
