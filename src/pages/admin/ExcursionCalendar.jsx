import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'
import { fmtDateFull } from '../../lib/transferUtils'

const MONTH_NAMES = ['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Jun', 'Jul', 'Avgust', 'Septembar', 'Oktobar', 'Novembar', 'Decembar']
const DOW_LABELS  = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned']

function pad(n) { return String(n).padStart(2, '0') }
function ymd(year, month, day) { return `${year}-${pad(month + 1)}-${pad(day)}` } // month je 0-indeksiran
function todayStr() {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth(), d.getDate())
}

// Vrati niz ćelija za mjesec: null za prazne ćelije prije 1. u mjesecu, inače broj dana
function buildGrid(year, month) {
  const first = new Date(year, month, 1)
  const startDow = (first.getDay() + 6) % 7 // ponedjeljak = 0
  const numDays = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= numDays; d++) cells.push(d)
  return cells
}

export default function ExcursionCalendar() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [excursion, setExcursion] = useState(null)
  const [groupList, setGroupList] = useState([])
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0-indeksiran
  const [datesMap, setDatesMap] = useState({}) // 'YYYY-MM-DD' → red iz excursion_dates
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const [editDay, setEditDay] = useState(null) // 'YYYY-MM-DD' ili null
  const [form,    setForm]    = useState({ capacity: '', status: 'open', note: '' })
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    supabase.from('excursions').select('id,name,type').eq('type', 'grupni').order('name')
      .then(({ data }) => setGroupList(data || []))
  }, [])

  useEffect(() => {
    if (!id) return
    supabase.from('excursions').select('*').eq('id', id).single()
      .then(({ data }) => setExcursion(data || null))
  }, [id])

  useEffect(() => { loadMonth() }, [id, year, month])

  async function loadMonth() {
    if (!id) return
    setLoading(true)
    const first = ymd(year, month, 1)
    const last  = ymd(year, month, new Date(year, month + 1, 0).getDate())
    const { data, error: err } = await supabase
      .from('excursion_dates')
      .select('*')
      .eq('excursion_id', id)
      .gte('date', first)
      .lte('date', last)

    if (err) {
      setError(err.message?.includes('excursion_dates')
        ? 'Tabela "excursion_dates" ne postoji u bazi. Pokreni supabase_excursion_dates.sql u Supabase SQL editoru.'
        : 'Greška: ' + err.message)
    } else {
      setError('')
    }
    const map = {}
    for (const row of (data || [])) map[row.date] = row
    setDatesMap(map)
    setLoading(false)
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else { setMonth(m => m - 1) }
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else { setMonth(m => m + 1) }
  }

  function openDay(dateStr) {
    const row = datesMap[dateStr]
    setForm({
      capacity: row ? String(row.capacity) : (excursion?.default_capacity != null ? String(excursion.default_capacity) : ''),
      status:   row?.status || 'open',
      note:     row?.note || '',
    })
    setEditDay(dateStr)
  }

  async function saveDay() {
    setSaving(true)
    const payload = {
      excursion_id: id,
      date:         editDay,
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
    setEditDay(null)
    loadMonth()
  }

  async function deleteDay() {
    if (!confirm('Ukloniti podešavanje za ovaj dan? Dan će ponovo biti neponuđen, kao da nikad nije podešen.')) return
    setSaving(true)
    await supabase.from('excursion_dates').delete().eq('excursion_id', id).eq('date', editDay)
    setSaving(false)
    setEditDay(null)
    loadMonth()
  }

  const isGroup = !excursion || excursion.type === 'grupni'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button onClick={() => navigate('/admin/excursions')} className="btn-ghost text-sm">← Nazad na katalog</button>
        <h1 className="text-xl font-bold text-gray-900">📅 Kalendar</h1>
        <select
          className="input w-64"
          value={id}
          onChange={e => navigate(`/admin/excursions/${e.target.value}/calendar`)}
        >
          {!groupList.some(g => g.id === id) && excursion && (
            <option value={id}>{excursion.name}</option>
          )}
          {groupList.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {!isGroup && (
        <div className="card p-8 text-center text-gray-400">
          Ovaj izlet je <strong>individualni</strong> tip i nema deljeni kalendar/kapacitet.
          Kalendar je predviđen samo za grupne izlete.
        </div>
      )}

      {isGroup && (
        <>
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <button onClick={prevMonth} className="btn-ghost px-3">←</button>
              <div className="font-bold text-gray-900">{MONTH_NAMES[month]} {year}</div>
              <button onClick={nextMonth} className="btn-ghost px-3">→</button>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-gray-400 mb-1.5">
              {DOW_LABELS.map(d => <div key={d}>{d}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {buildGrid(year, month).map((d, i) => {
                if (d === null) return <div key={i} />
                const dateStr = ymd(year, month, d)
                const row = datesMap[dateStr]
                const isOpen = row?.status === 'open'
                const isPast = dateStr < todayStr()
                return (
                  <button
                    key={i}
                    onClick={() => openDay(dateStr)}
                    className={`aspect-square rounded-lg p-1 flex flex-col items-center justify-center text-xs border-2 transition-colors
                      ${isPast ? 'opacity-40' : ''}
                      ${!row
                        ? 'border-dashed border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                        : isOpen
                          ? 'border-green-300 bg-green-50 text-green-800 hover:border-green-400'
                          : 'border-red-200 bg-red-50 text-red-700 hover:border-red-300'
                      }`}
                  >
                    <span className="font-bold">{d}</span>
                    {row && (
                      <span className="text-[10px] font-semibold mt-0.5 leading-none">
                        {isOpen ? `🎟 ${row.capacity}` : 'Zatvoreno'}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex gap-4 mt-4 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-green-50 border-2 border-green-300 inline-block" /> Otvoren
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-red-50 border-2 border-red-200 inline-block" /> Zatvoren
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-white border-2 border-dashed border-gray-200 inline-block" /> Nije podešen
            </span>
          </div>
        </>
      )}

      {editDay && (
        <Modal
          title={`Podešavanje — ${fmtDateFull(editDay)}`}
          onClose={() => setEditDay(null)}
          footer={<>
            {datesMap[editDay] && (
              <button onClick={deleteDay} className="btn-ghost text-red-500 mr-auto">Ukloni</button>
            )}
            <button onClick={() => setEditDay(null)} className="btn-ghost">Otkaži</button>
            <button onClick={saveDay} disabled={saving} className="btn-primary">{saving ? 'Čuvanje...' : 'Sačuvaj'}</button>
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
              <label className="label">Broj mjesta (kapacitet)</label>
              <input
                type="number"
                className="input"
                value={form.capacity}
                onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                placeholder="npr. 50"
              />
            </div>
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
