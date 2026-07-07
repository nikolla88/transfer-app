import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../App'
import Modal from '../../components/Modal'

// ── helpers ───────────────────────────────────────────────────────
function today()    { return new Date().toISOString().slice(0, 10) }
function monthAgo() {
  const d = new Date(); d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 10)
}
function fmtDate(s) {
  return s ? new Date(s).toLocaleDateString('sr-Latn', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
}
function fmtEur(n)  { return n != null ? `€${Number(n).toFixed(0)}` : '—' }

const DIR_COLOR = {
  arr: 'bg-emerald-100 text-emerald-700',
  dep: 'bg-amber-100 text-amber-800',
}

// ── Main component ────────────────────────────────────────────────
export default function SupplierAccounting() {
  const { canWrite } = useAuth()
  const canEdit = canWrite('admin_accounting')

  // Data
  const [suppliers, setSuppliers] = useState([])
  const [transfers, setTransfers] = useState([])
  const [payments,  setPayments]  = useState([])
  const [loading,   setLoading]   = useState(false)

  // Filters
  const [fSupplier, setFSupplier] = useState('')
  const [dateFrom,  setDateFrom]  = useState(monthAgo())
  const [dateTo,    setDateTo]    = useState(today())
  const [tab,       setTab]       = useState('unpaid') // 'unpaid' | 'paid' | 'payments'

  // Selection & payment modal
  const [selected, setSelected] = useState(new Set())   // set of transfer IDs
  const [modal,    setModal]    = useState(null)         // null | 'pay' | 'delete_payment'
  const [payForm,  setPayForm]  = useState({ date: today(), amount: '', notes: '' })
  const [deleteTarget, setDeleteTarget] = useState(null) // payment id to delete
  const [saving,   setSaving]   = useState(false)

  // ── Load ────────────────────────────────────────────────────────
  useEffect(() => { loadSuppliers() }, [])
  useEffect(() => { load() }, [fSupplier, dateFrom, dateTo])

  async function loadSuppliers() {
    const { data } = await supabase.from('suppliers').select('id,name').eq('active', true).order('name')
    setSuppliers(data || [])
  }

  async function load() {
    setLoading(true)
    setSelected(new Set())

    let tq = supabase
      .from('transfers')
      .select('id,transfer_date,type,tourist,hotel_name,flight_number,pickup_time,adl,chd,supplier_id,supplier_price,payment_id,suppliers(name)')
      .not('supplier_id', 'is', null)
      .gte('transfer_date', dateFrom)
      .lte('transfer_date', dateTo)
      .order('transfer_date', { ascending: true })
      .limit(2000)

    if (fSupplier) tq = tq.eq('supplier_id', fSupplier)

    let pq = supabase
      .from('supplier_payments')
      .select('*,suppliers(name)')
      .gte('payment_date', dateFrom)
      .lte('payment_date', dateTo)
      .order('payment_date', { ascending: false })
      .limit(500)

    if (fSupplier) pq = pq.eq('supplier_id', fSupplier)

    const [{ data: td }, { data: pd }] = await Promise.all([tq, pq])
    setTransfers(td || [])
    setPayments(pd || [])
    setLoading(false)
  }

  // ── Derived lists ────────────────────────────────────────────────
  const unpaidTransfers = useMemo(
    () => transfers.filter(t => !t.payment_id),
    [transfers]
  )
  const paidTransfers = useMemo(
    () => transfers.filter(t => !!t.payment_id),
    [transfers]
  )
  const displayedTransfers = tab === 'paid' ? paidTransfers : unpaidTransfers

  // ── Summary ──────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const invoiced  = transfers.reduce((s, t) => s + (t.supplier_price || 0), 0)
    const paid      = paidTransfers.reduce((s, t) => s + (t.supplier_price || 0), 0)
    const paymentsTotal = payments.reduce((s, p) => s + Number(p.amount), 0)
    return {
      invoiced,
      paid,
      outstanding: invoiced - paid,
      paymentsTotal,
      unpaidCount: unpaidTransfers.length,
      paidCount:   paidTransfers.length,
    }
  }, [transfers, paidTransfers, unpaidTransfers, payments])

  // ── Selection helpers ─────────────────────────────────────────────
  const selectedTotal = useMemo(
    () => unpaidTransfers
      .filter(t => selected.has(t.id))
      .reduce((s, t) => s + (t.supplier_price || 0), 0),
    [selected, unpaidTransfers]
  )

  function toggleSelect(id) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function selectAll() {
    setSelected(new Set(unpaidTransfers.map(t => t.id)))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  // Auto-odabir po iznosu (avans)
  function autoSelectByAmount(amount) {
    const amt = Number(amount)
    if (!amt) return
    let running = 0
    const ids = new Set()
    for (const t of [...unpaidTransfers].sort((a, b) => a.transfer_date.localeCompare(b.transfer_date))) {
      const price = t.supplier_price || 0
      if (running + price <= amt + 0.01) {
        ids.add(t.id)
        running += price
      }
    }
    setSelected(ids)
  }

  // ── Payment actions ───────────────────────────────────────────────
  function openPayModal() {
    if (selected.size === 0) return
    setPayForm({ date: today(), amount: String(selectedTotal), notes: '' })
    setModal('pay')
  }

  async function savePayment() {
    if (!payForm.date || selected.size === 0) return
    setSaving(true)

    // Determine supplier: all selected transfers should share the same supplier
    // (if multiple suppliers selected, we create one payment per supplier)
    const bySupplier = {}
    for (const t of unpaidTransfers.filter(t => selected.has(t.id))) {
      const sid = t.supplier_id
      if (!bySupplier[sid]) bySupplier[sid] = { ids: [], total: 0 }
      bySupplier[sid].ids.push(t.id)
      bySupplier[sid].total += t.supplier_price || 0
    }

    const supplierIds = Object.keys(bySupplier)

    for (const sid of supplierIds) {
      const grp = bySupplier[sid]
      // If single supplier, use user-entered amount; otherwise use actual total per supplier
      const amount = supplierIds.length === 1
        ? (Number(payForm.amount) || grp.total)
        : grp.total

      const { data: pay, error } = await supabase
        .from('supplier_payments')
        .insert({ supplier_id: sid, payment_date: payForm.date, amount, notes: payForm.notes?.trim() || null })
        .select('id')
        .single()

      if (error || !pay) { console.error(error); continue }

      await supabase
        .from('transfers')
        .update({ payment_id: pay.id })
        .in('id', grp.ids)
    }

    setSaving(false)
    setModal(null)
    setSelected(new Set())
    load()
  }

  async function unmarkPayment(paymentId) {
    if (!confirm('Poništiti ovu uplatu? Transferi će biti označeni kao neplaćeni.')) return
    // Unlink transfers
    await supabase.from('transfers').update({ payment_id: null }).eq('payment_id', paymentId)
    // Delete payment record
    await supabase.from('supplier_payments').delete().eq('id', paymentId)
    load()
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">💳 Obračun suplajera</h1>
        <p className="text-sm text-gray-400 mt-0.5">Evidencija obaveza, uplata i balansa prema eksternim supla jerima</p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Supla jer</label>
            <select value={fSupplier} onChange={e => setFSupplier(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-[180px]">
              <option value="">Svi suplajeri</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
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
          <div className="flex gap-1">
            {[['1mj',1],['3mj',3],['6mj',6]].map(([l,m])=>(
              <button key={l} onClick={() => {
                const d = new Date(); d.setMonth(d.getMonth()-m)
                setDateFrom(d.toISOString().slice(0,10)); setDateTo(today())
              }} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">{l}</button>
            ))}
          </div>
          <button onClick={load}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium self-end">
            {loading ? '⏳' : '🔄 Osvježi'}
          </button>
        </div>
      </div>

      {/* Summary kartice */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Ukupno zaračunato', value: fmtEur(summary.invoiced),     cls: 'bg-gray-700 text-white' },
          { label: 'Plaćeno',           value: fmtEur(summary.paid),         cls: 'bg-green-600 text-white' },
          { label: 'Dugovanje',         value: fmtEur(summary.outstanding),  cls: summary.outstanding > 0 ? 'bg-red-500 text-white' : 'bg-green-700 text-white' },
          { label: 'Neplaćenih vožnji', value: summary.unpaidCount,          cls: 'bg-gray-50 border border-gray-200 text-gray-700' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl p-4 ${c.cls}`}>
            <div className="text-xs opacity-70 mb-1">{c.label}</div>
            <div className="text-2xl font-bold">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
        {[
          ['unpaid',   `⏳ Neplaćeno (${summary.unpaidCount})`],
          ['paid',     `✅ Plaćeno (${summary.paidCount})`],
          ['payments', `💳 Uplate (${payments.length})`],
        ].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === v
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>{l}</button>
        ))}

        {/* Selection action bar */}
        {tab === 'unpaid' && selected.size > 0 && canEdit && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-gray-500">{selected.size} odabrano · <span className="font-semibold text-gray-800">{fmtEur(selectedTotal)}</span></span>
            <button onClick={clearSelection}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500">
              Otkaži
            </button>
            <button onClick={openPayModal}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">
              💳 Unesi uplatu
            </button>
          </div>
        )}

        {/* Select all / avans buttons */}
        {tab === 'unpaid' && selected.size === 0 && unpaidTransfers.length > 0 && canEdit && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={selectAll}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
              Odaberi sve
            </button>
            <button onClick={() => {
              const amt = prompt('Unesi iznos avansa (€):')
              if (amt) { autoSelectByAmount(amt); setPayForm(f => ({ ...f, amount: amt })) }
            }}
              className="px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50">
              🔢 Avans
            </button>
          </div>
        )}
      </div>

      {loading && <div className="text-center py-20 text-gray-400">⏳ Učitavanje...</div>}

      {/* ── Tab: Neplaćeno / Plaćeno ─────────────────────────────── */}
      {!loading && (tab === 'unpaid' || tab === 'paid') && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          {displayedTransfers.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">
              {tab === 'unpaid' ? 'Nema neplaćenih vožnji za odabrani period.' : 'Nema plaćenih vožnji za odabrani period.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    {tab === 'unpaid' && canEdit && <th className="px-3 py-3 w-8"/>}
                    <th className="px-4 py-3 font-medium text-gray-600">Datum</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Supla jer</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Smjer</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Gost</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Hotel</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Let</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Cijena</th>
                    {tab === 'paid' && <th className="px-4 py-3 font-medium text-gray-600">Uplata</th>}
                    {tab === 'paid' && canEdit && <th className="px-4 py-3 w-20"/>}
                  </tr>
                </thead>
                <tbody>
                  {displayedTransfers.map((t, i) => {
                    const isSel = selected.has(t.id)
                    return (
                      <tr key={t.id}
                        className={`border-b border-gray-100 transition-colors ${
                          isSel ? 'bg-blue-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                        } ${tab === 'unpaid' && canEdit ? 'cursor-pointer hover:bg-blue-50/60' : ''}`}
                        onClick={tab === 'unpaid' && canEdit ? () => toggleSelect(t.id) : undefined}
                      >
                        {tab === 'unpaid' && canEdit && (
                          <td className="px-3 py-2.5">
                            <input type="checkbox" checked={isSel} onChange={() => toggleSelect(t.id)}
                              onClick={e => e.stopPropagation()}
                              className="w-4 h-4 rounded accent-blue-600"/>
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(t.transfer_date)}</td>
                        <td className="px-4 py-2.5 font-medium text-orange-700">
                          {t.suppliers?.name || '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${DIR_COLOR[t.type] || 'bg-gray-100 text-gray-600'}`}>
                            {t.type === 'arr' ? 'ARR' : 'DEP'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 max-w-[160px] truncate text-gray-800">{t.tourist || '—'}</td>
                        <td className="px-4 py-2.5 max-w-[140px] truncate text-gray-500 text-xs">{t.hotel_name || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{t.flight_number || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">
                          {t.supplier_price != null
                            ? <span className="text-gray-800">{fmtEur(t.supplier_price)}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        {tab === 'paid' && (
                          <td className="px-4 py-2.5 text-xs text-green-700">
                            ✅ {fmtDate(payments.find(p => p.id === t.payment_id)?.payment_date)}
                          </td>
                        )}
                        {tab === 'paid' && canEdit && (
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => unmarkPayment(t.payment_id)}
                              className="text-xs text-red-400 hover:text-red-600 transition-colors">
                              Poništi
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className={`font-semibold border-t-2 ${tab === 'paid' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                    {tab === 'unpaid' && canEdit && <td/>}
                    <td colSpan={6} className="px-4 py-3">
                      UKUPNO — {displayedTransfers.length} vožnji
                    </td>
                    <td className="px-4 py-3 text-right text-base">
                      {fmtEur(displayedTransfers.reduce((s,t) => s + (t.supplier_price||0), 0))}
                    </td>
                    {tab === 'paid' && <td colSpan={2}/>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Uplate ──────────────────────────────────────────── */}
      {!loading && tab === 'payments' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          {payments.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">Nema uplaćenih iznosa za odabrani period.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Datum uplate</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Supla jer</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Iznos</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Vožnji</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Napomena</th>
                  {canEdit && <th className="px-4 py-3 w-20"/>}
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => {
                  const linkedCount = transfers.filter(t => t.payment_id === p.id).length
                  const linkedTotal = transfers.filter(t => t.payment_id === p.id)
                    .reduce((s,t) => s + (t.supplier_price||0), 0)
                  return (
                    <tr key={p.id} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{fmtDate(p.payment_date)}</td>
                      <td className="px-4 py-2.5 text-orange-700 font-medium">{p.suppliers?.name || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="font-semibold text-green-700">{fmtEur(p.amount)}</span>
                        {Math.abs(p.amount - linkedTotal) > 0.5 && (
                          <div className="text-xs text-amber-500">≠ {fmtEur(linkedTotal)} (transferi)</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-600">{linkedCount}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{p.notes || '—'}</td>
                      {canEdit && (
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => unmarkPayment(p.id)}
                            className="text-xs text-red-400 hover:text-red-600 transition-colors">
                            Poništi
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-green-50 border-t-2 border-green-200 font-semibold text-green-800">
                  <td colSpan={2} className="px-4 py-3">UKUPNO — {payments.length} uplata</td>
                  <td className="px-4 py-3 text-right text-base">{fmtEur(payments.reduce((s,p)=>s+Number(p.amount),0))}</td>
                  <td colSpan={canEdit ? 3 : 2}/>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Balans po suplajeru (uvijek vidljiv ako nema filtera) */}
      {!loading && !fSupplier && tab !== 'payments' && (
        <BalanceBySupplier transfers={transfers} payments={payments} />
      )}

      {/* ── Modal: Nova uplata ───────────────────────────────────── */}
      {modal === 'pay' && (
        <Modal
          title="💳 Nova uplata"
          onClose={() => setModal(null)}
          footer={<>
            <button onClick={() => setModal(null)} className="btn-ghost">Otkaži</button>
            <button onClick={savePayment} disabled={saving || selected.size === 0}
              className="btn-primary">
              {saving ? 'Čuvanje...' : `Potvrdi uplatu ${fmtEur(Number(payForm.amount) || selectedTotal)}`}
            </button>
          </>}
        >
          <div className="space-y-4">
            {/* Selected transfers summary */}
            <div className="bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-500 mb-2">Odabrane vožnje ({selected.size})</p>
              {unpaidTransfers.filter(t => selected.has(t.id)).map(t => (
                <div key={t.id} className="flex justify-between text-xs py-0.5 text-gray-700">
                  <span>{fmtDate(t.transfer_date)} · {t.tourist || '—'}</span>
                  <span className="font-semibold">{fmtEur(t.supplier_price)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold text-gray-800 border-t border-gray-200 mt-2 pt-2">
                <span>Ukupno vožnji</span>
                <span>{fmtEur(selectedTotal)}</span>
              </div>
            </div>

            {/* Datum */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Datum uplate *</label>
              <input type="date" value={payForm.date}
                onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-300"/>
            </div>

            {/* Iznos */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Plaćeni iznos (€)</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                  <input type="number" min="0" step="1"
                    value={payForm.amount}
                    onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                    className="border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-300"/>
                </div>
                <button onClick={() => setPayForm(f => ({ ...f, amount: String(selectedTotal) }))}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 whitespace-nowrap">
                  = {fmtEur(selectedTotal)}
                </button>
              </div>
              {Number(payForm.amount) !== selectedTotal && payForm.amount !== '' && (
                <p className="text-xs text-amber-500 mt-1">
                  ⚠ Razlika: {fmtEur(Math.abs(Number(payForm.amount) - selectedTotal))}
                  {Number(payForm.amount) < selectedTotal ? ' (djelimična uplata)' : ' (preplaćeno)'}
                </p>
              )}
            </div>

            {/* Napomena */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Napomena / referenca</label>
              <input className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="npr. bank transfer, gotovina, br. uplatnice..."
                value={payForm.notes}
                onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}/>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Balans po suplajeru (sub-komponenta) ──────────────────────────
function BalanceBySupplier({ transfers, payments }) {
  const bySupplier = useMemo(() => {
    const map = {}
    for (const t of transfers) {
      const sid = t.supplier_id
      const name = t.suppliers?.name || '—'
      if (!map[sid]) map[sid] = { id: sid, name, invoiced: 0, paid: 0, count: 0, paidCount: 0 }
      map[sid].invoiced += t.supplier_price || 0
      map[sid].count++
      if (t.payment_id) { map[sid].paid += t.supplier_price || 0; map[sid].paidCount++ }
    }
    return Object.values(map).sort((a, b) => (b.invoiced - b.paid) - (a.invoiced - a.paid))
  }, [transfers])

  if (bySupplier.length === 0) return null

  return (
    <div className="mt-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">📋 Balans po suplajeru</h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left">
              <th className="px-4 py-3 font-medium text-gray-600">Supla jer</th>
              <th className="px-4 py-3 font-medium text-gray-600 text-right">Zaračunato</th>
              <th className="px-4 py-3 font-medium text-gray-600 text-right">Plaćeno</th>
              <th className="px-4 py-3 font-medium text-gray-600 text-right">Dugovanje</th>
              <th className="px-4 py-3 font-medium text-gray-600 w-28">Naplata %</th>
            </tr>
          </thead>
          <tbody>
            {bySupplier.map((s, i) => {
              const outstanding = s.invoiced - s.paid
              const pct = s.invoiced > 0 ? (s.paid / s.invoiced) * 100 : 0
              return (
                <tr key={s.id} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                  <td className="px-4 py-2.5 font-medium text-orange-700">🤝 {s.name}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{`€${s.invoiced.toFixed(0)}`}
                    <span className="text-xs text-gray-400 ml-1">({s.count})</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-green-700 font-medium">{`€${s.paid.toFixed(0)}`}
                    <span className="text-xs text-gray-400 ml-1">({s.paidCount})</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold">
                    <span className={outstanding > 0 ? 'text-red-600' : 'text-green-600'}>
                      {outstanding > 0 ? `€${outstanding.toFixed(0)}` : '✓ Izmireno'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full ${pct >= 100 ? 'bg-green-500' : pct > 50 ? 'bg-blue-500' : 'bg-red-400'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}/>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 text-right">{pct.toFixed(0)}%</div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
