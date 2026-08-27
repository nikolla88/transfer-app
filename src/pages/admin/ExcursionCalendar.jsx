import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'
import { fmtDate, fmtDateFull } from '../../lib/transferUtils'

const DOW_LABELS  = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned']
const WINDOW_DAYS = 21 // 3 sedmice prikazano odjednom

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

export default function ExcursionCalendar() {
  const [groupList, setGroupList] = useState([]) // grupni izleti: id, name, default_capacity
  const [startDate, setStartDate] = useState(() => mondayOf(todayStr()))
  const [datesMap,  setDatesMap]  = useState({}) // 'excursionId|YYYY-MM-DD' → red
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')

  const [editCell, setEditCell] = useState(null) // { excursionId, excursionName, date } ili null
  const [form,     setForm]     = useState({ capacity: '', status: 'open', note: '' })
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    supabase.from('excursions').select('id,name,default_capacity').eq('type', 'grupni').order('name')
      .then(({ data }) => setGroupList(data || []))
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
    await supabase.from('excursion_dates').delete()
      .eq('excursion_id', editCell.excursionId).eq('date', editCell.date)
    setSaving(false)
    setEditCell(null)
    loadWindow()
  }

  const editRow = editCell ? datesMap[`${editCell.excursionId}|${editCell.date}`] : null
  const sold = 0 // TODO Faza 3: pravi broj prodatih mjesta iz excursion_bookings

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">📅 Kalendar izleta</h1>
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
                    const over = isOpen && row && sold > row.capacity
                    const isToday = d === todayStr()
                    return (
                      <td key={d}
                        className={`border-b border-gray-200 p-0.5 ${i % 7 === 0 ? 'border-l' : ''} ${isToday ? 'bg-brand-50/40' : ''}`}>
                        <button
                          onClick={() => openCell(exc, d)}
                          title={row?.note || ''}
                          className={`w-full h-10 rounded flex flex-col items-center justify-center leading-none transition-colors
                            ${!row
                              ? 'bg-white hover:bg-gray-50 border border-dashed border-gray-200'
                              : !isOpen
                                ? 'bg-gray-100 text-gray-400 border border-gray-200 hover:border-gray-300'
                                : over
                                  ? 'bg-red-50 text-red-700 border-2 border-red-400 hover:border-red-500'
                                  : 'bg-green-50 text-green-800 border border-green-200 hover:border-green-400'
                            }`}
                        >
                          {row && isOpen && (
                            <>
                              <span className="text-[11px] font-bold">{row.capacity}</span>
                              <span className="text-[10px]">{sold}</span>
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
      </div>

      {editCell && (
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
                Prodato mjesta: {sold}/{editRow.capacity} <span className="italic">(pravi broj rezervacija dolazi u sledećoj fazi)</span>
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
    </div>
  )
}
