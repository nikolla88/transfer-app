import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// ── Konstante ─────────────────────────────────────────────────────
const REPORTS = [
  { id: 'transfer_revenue', icon: '💰', label: 'Prihod od transfera', ready: true  },
  { id: 'drivers',          icon: '👤', label: 'Izvještaj po vozačima', ready: false },
  { id: 'buses',            icon: '🚌', label: 'Izvještaj po autobusima', ready: false },
  { id: 'suppliers',        icon: '🤝', label: 'Externi suplajeri', ready: false },
]

const TRANSFER_TYPES = ['GRP', 'IND', 'SHA']
const VEHICLE_TYPES  = ['Car', 'Car Comfort', 'Minivan', 'V-Class']
const AIRPORTS       = ['TIV', 'TGD']

const GROUP_BY_OPTIONS = [
  { value: 'none',     label: 'Detaljan prikaz' },
  { value: 'date',     label: 'Po datumu' },
  { value: 'flight',   label: 'Po letu' },
  { value: 'type',     label: 'Po tipu transfera' },
  { value: 'vehicle',  label: 'Po vozilu' },
  { value: 'partner',  label: 'Po partneru' },
  { value: 'town',     label: 'Po destinaciji' },
]

function today()     { return new Date().toISOString().slice(0, 10) }
function daysAgo(n)  { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
function fmtDate(s)  { return s ? new Date(s).toLocaleDateString('sr-Latn', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—' }
function fmtEur(n)   { return n != null ? `€${Number(n).toFixed(0)}` : '—' }

// ── Glavni export ─────────────────────────────────────────────────
export default function Reports() {
  const [activeReport, setActiveReport] = useState('transfer_revenue')

  return (
    <div className="flex h-full">
      {/* Sidebar s listom izvještaja */}
      <aside className="w-52 border-r border-gray-200 bg-gray-50 flex-shrink-0 py-4 px-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Izvještaji</p>
        {REPORTS.map(r => (
          <button
            key={r.id}
            onClick={() => r.ready && setActiveReport(r.id)}
            className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
              activeReport === r.id
                ? 'bg-blue-600 text-white font-medium'
                : r.ready
                  ? 'text-gray-700 hover:bg-gray-200'
                  : 'text-gray-400 cursor-not-allowed'
            }`}
          >
            <span>{r.icon}</span>
            <span className="leading-tight">{r.label}</span>
            {!r.ready && <span className="ml-auto text-xs opacity-60">uskoro</span>}
          </button>
        ))}
      </aside>

      {/* Sadržaj aktivnog izvještaja */}
      <div className="flex-1 overflow-y-auto">
        {activeReport === 'transfer_revenue' && <TransferRevenueReport />}
      </div>
    </div>
  )
}

// ── Izvještaj: Prihod od transfera ────────────────────────────────
function TransferRevenueReport() {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(false)

  const [dateFrom,  setDateFrom]  = useState(daysAgo(7))
  const [dateTo,    setDateTo]    = useState(today())
  const [direction, setDirection] = useState('all')   // all | arr | dep
  const [fType,     setFType]     = useState('')       // '' | GRP | IND | SHA
  const [fVehicle,  setFVehicle]  = useState('')
  const [fAirport,  setFAirport]  = useState('')
  const [fFlight,   setFFlight]   = useState('')
  const [groupBy,   setGroupBy]   = useState('date')

  useEffect(() => { load() }, [dateFrom, dateTo, direction])

  async function load() {
    setLoading(true)
    let q = supabase.from('rooming_list').select(
      'id, tourist_name, hotel_name, hotel_town, partner_alias, adult, child,' +
      'date_beg, date_end,' +
      'arr_flight_name, arr_transfer_alias, arr_vehicle_type, arr_revenue,' +
      'dep_flight_name, dep_transfer_alias, dep_vehicle_type, dep_revenue'
    )

    if (direction === 'arr') {
      if (dateFrom) q = q.gte('date_beg', dateFrom)
      if (dateTo)   q = q.lte('date_beg', dateTo)
    } else if (direction === 'dep') {
      if (dateFrom) q = q.gte('date_end', dateFrom)
      if (dateTo)   q = q.lte('date_end', dateTo)
    } else {
      // all — uzmi redove gdje je arrivals ILI departures u periodu
      if (dateFrom && dateTo)
        q = q.or(`date_beg.gte.${dateFrom},date_end.gte.${dateFrom}`)
          .or(`date_beg.lte.${dateTo},date_end.lte.${dateTo}`)
      else if (dateFrom)
        q = q.or(`date_beg.gte.${dateFrom},date_end.gte.${dateFrom}`)
      else if (dateTo)
        q = q.or(`date_beg.lte.${dateTo},date_end.lte.${dateTo}`)
    }

    const { data, error } = await q.limit(5000)
    if (error) console.error(error)
    setRows(data || [])
    setLoading(false)
  }

  // Razvij svaki red u "noge" (arr + dep odvojeno)
  const legs = useMemo(() => {
    const result = []
    for (const r of rows) {
      const inArr = (!dateFrom || r.date_beg >= dateFrom) && (!dateTo || r.date_beg <= dateTo)
      const inDep = (!dateFrom || r.date_end >= dateFrom) && (!dateTo || r.date_end <= dateTo)

      if ((direction === 'all' || direction === 'arr') && r.arr_transfer_alias && r.arr_transfer_alias !== 'NO TR-R' && inArr) {
        result.push({
          id:       r.id + '_arr',
          guest:    r.tourist_name,
          date:     r.date_beg,
          dir:      'ARR',
          flight:   r.arr_flight_name || '—',
          type:     r.arr_transfer_alias,
          vehicle:  r.arr_vehicle_type || '—',
          town:     r.hotel_town,
          partner:  r.partner_alias || '—',
          adult:    r.adult || 0,
          child:    r.child || 0,
          revenue:  r.arr_revenue,
        })
      }

      if ((direction === 'all' || direction === 'dep') && r.dep_transfer_alias && r.dep_transfer_alias !== 'NO TR-R' && inDep) {
        result.push({
          id:       r.id + '_dep',
          guest:    r.tourist_name,
          date:     r.date_end,
          dir:      'DEP',
          flight:   r.dep_flight_name || '—',
          type:     r.dep_transfer_alias,
          vehicle:  r.dep_vehicle_type || '—',
          town:     r.hotel_town,
          partner:  r.partner_alias || '—',
          adult:    r.adult || 0,
          child:    r.child || 0,
          revenue:  r.dep_revenue,
        })
      }
    }
    return result
  }, [rows, direction, dateFrom, dateTo])

  // Primijeni lokalne filtere
  const filtered = useMemo(() => legs.filter(l =>
    (!fType    || l.type    === fType) &&
    (!fVehicle || l.vehicle === fVehicle) &&
    (!fFlight  || l.flight.toLowerCase().includes(fFlight.toLowerCase()))
  ), [legs, fType, fVehicle, fFlight])

  // Statistike
  const stats = useMemo(() => {
    const total   = filtered.reduce((s, l) => s + (l.revenue || 0), 0)
    const arrRev  = filtered.filter(l => l.dir==='ARR').reduce((s,l) => s+(l.revenue||0), 0)
    const depRev  = filtered.filter(l => l.dir==='DEP').reduce((s,l) => s+(l.revenue||0), 0)
    const known   = filtered.filter(l => l.revenue != null).length
    const unknown = filtered.filter(l => l.revenue == null).length
    const pax     = filtered.reduce((s,l) => s + l.adult + l.child, 0)
    return { total, arrRev, depRev, known, unknown, pax, count: filtered.length }
  }, [filtered])

  // Grupisanje
  const grouped = useMemo(() => {
    if (groupBy === 'none') return null

    const keyFn = {
      date:    l => l.date,
      flight:  l => l.flight,
      type:    l => l.type,
      vehicle: l => (l.vehicle || '—'),
      partner: l => l.partner,
      town:    l => l.town,
    }[groupBy]

    const map = {}
    for (const l of filtered) {
      const k = keyFn(l) || '—'
      if (!map[k]) map[k] = { key: k, count: 0, pax: 0, revenue: 0, noPrice: 0 }
      map[k].count++
      map[k].pax += l.adult + l.child
      map[k].revenue += l.revenue || 0
      if (l.revenue == null) map[k].noPrice++
    }

    return Object.values(map).sort((a, b) => {
      if (groupBy === 'date') return a.key.localeCompare(b.key)
      return b.revenue - a.revenue
    })
  }, [filtered, groupBy])

  const dirLabel = { all: 'Svi transferi', arr: 'Samo dolasci', dep: 'Samo polasci' }

  return (
    <div className="p-6">
      {/* Naslov */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-800">💰 Prihod od transfera</h1>
        <p className="text-sm text-gray-400 mt-0.5">Analiza prihoda iz rooming liste prema unesenim transferima</p>
      </div>

      {/* Filteri */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Period */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Od datuma</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Do datuma</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>

          {/* Brzi periodi */}
          <div className="flex gap-1">
            {[
              { label: '7 dana', fn: () => { setDateFrom(daysAgo(7));  setDateTo(today()) } },
              { label: '14 dana', fn: () => { setDateFrom(daysAgo(14)); setDateTo(today()) } },
              { label: '30 dana', fn: () => { setDateFrom(daysAgo(30)); setDateTo(today()) } },
            ].map(p => (
              <button key={p.label} onClick={p.fn}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                {p.label}
              </button>
            ))}
          </div>

          <div className="h-8 w-px bg-gray-200" />

          {/* Smjer */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Smjer</label>
            <select value={direction} onChange={e => setDirection(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="all">Dolasci + polasci</option>
              <option value="arr">Samo dolasci</option>
              <option value="dep">Samo polasci</option>
            </select>
          </div>

          {/* Tip transfera */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tip transfera</label>
            <select value={fType} onChange={e => setFType(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="">Svi tipovi</option>
              {TRANSFER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Vozilo */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Vozilo</label>
            <select value={fVehicle} onChange={e => setFVehicle(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="">Sva vozila</option>
              {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {/* Let */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Let</label>
            <input type="text" placeholder="npr. KC635" value={fFlight}
              onChange={e => setFFlight(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>

          <button onClick={load}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium self-end">
            {loading ? '⏳' : '🔄 Osvježi'}
          </button>
        </div>
      </div>

      {/* Summary kartice */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {[
          { label: 'Ukupan prihod', value: fmtEur(stats.total), color: 'bg-blue-600 text-white', big: true },
          { label: 'Dolasci',        value: fmtEur(stats.arrRev), color: 'bg-green-50 text-green-800' },
          { label: 'Polasci',        value: fmtEur(stats.depRev), color: 'bg-amber-50 text-amber-800' },
          { label: 'Transfera',      value: stats.count,          color: 'bg-gray-50 text-gray-700' },
          { label: 'Putnika',        value: stats.pax,            color: 'bg-gray-50 text-gray-700' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl p-4 ${c.color} ${c.big ? 'shadow-sm' : 'border border-gray-200'}`}>
            <div className={`text-xs ${c.big ? 'text-blue-100' : 'text-gray-500'} mb-1`}>{c.label}</div>
            <div className={`font-bold ${c.big ? 'text-2xl' : 'text-xl'}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {stats.unknown > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-2 mb-4">
          ⚠️ {stats.unknown} transfera nema izračunat prihod — vjerovatno nedostaju cijene u cjenovniku ili hotel nije mapiran na zonu.
        </div>
      )}

      {/* Group By toggle */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Grupiši po:</span>
        {GROUP_BY_OPTIONS.map(o => (
          <button key={o.value} onClick={() => setGroupBy(o.value)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              groupBy === o.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}>
            {o.label}
          </button>
        ))}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">⏳ Učitavanje...</div>
      ) : grouped ? (
        <GroupedTable grouped={grouped} groupBy={groupBy} />
      ) : (
        <DetailTable legs={filtered} />
      )}
    </div>
  )
}

// ── Grupisana tabela ──────────────────────────────────────────────
function GroupedTable({ grouped, groupBy }) {
  const labelMap = {
    date:    'Datum',
    flight:  'Let',
    type:    'Tip transfera',
    vehicle: 'Vozilo',
    partner: 'Partner',
    town:    'Destinacija',
  }
  const totalRev = grouped.reduce((s, r) => s + r.revenue, 0)

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 text-left">
            <th className="px-4 py-3 font-medium text-gray-600">{labelMap[groupBy]}</th>
            <th className="px-4 py-3 font-medium text-gray-600 text-right">Transfera</th>
            <th className="px-4 py-3 font-medium text-gray-600 text-right">Putnika</th>
            <th className="px-4 py-3 font-medium text-gray-600 text-right">Prihod</th>
            <th className="px-4 py-3 font-medium text-gray-600 text-right">Udio</th>
            {groupBy !== 'date' && (
              <th className="px-4 py-3 font-medium text-gray-600 text-right w-32">Grafikon</th>
            )}
          </tr>
        </thead>
        <tbody>
          {grouped.map((r, i) => {
            const pct = totalRev > 0 ? (r.revenue / totalRev) * 100 : 0
            return (
              <tr key={r.key} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                <td className="px-4 py-2.5 font-medium text-gray-800">
                  {groupBy === 'date' ? fmtDate(r.key) : r.key}
                  {r.noPrice > 0 && <span className="ml-2 text-xs text-amber-500">({r.noPrice} bez cijene)</span>}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-600">{r.count}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">{r.pax}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmtEur(r.revenue)}</td>
                <td className="px-4 py-2.5 text-right text-gray-500 text-xs">{pct.toFixed(1)}%</td>
                {groupBy !== 'date' && (
                  <td className="px-4 py-2.5">
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
            <td className="px-4 py-3 text-blue-800">UKUPNO</td>
            <td className="px-4 py-3 text-right text-blue-800">{grouped.reduce((s,r)=>s+r.count,0)}</td>
            <td className="px-4 py-3 text-right text-blue-800">{grouped.reduce((s,r)=>s+r.pax,0)}</td>
            <td className="px-4 py-3 text-right text-blue-800 text-base">{fmtEur(totalRev)}</td>
            <td className="px-4 py-3 text-right text-blue-800">100%</td>
            {groupBy !== 'date' && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Detaljna tabela ───────────────────────────────────────────────
function DetailTable({ legs }) {
  const TYPE_COLOR = { GRP: 'bg-blue-100 text-blue-700', IND: 'bg-green-100 text-green-700', SHA: 'bg-purple-100 text-purple-700' }
  const DIR_COLOR  = { ARR: 'bg-emerald-100 text-emerald-700', DEP: 'bg-amber-100 text-amber-800' }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="text-xs text-gray-400 px-4 py-2 border-b border-gray-100">
        {legs.length} transfera
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left">
              <th className="px-3 py-2.5 font-medium text-gray-600">Datum</th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Smjer</th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Gost</th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Let</th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Destinacija</th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Partner</th>
              <th className="px-3 py-2.5 font-medium text-gray-600 text-center">Tip</th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Vozilo</th>
              <th className="px-3 py-2.5 font-medium text-gray-600 text-center">Pax</th>
              <th className="px-3 py-2.5 font-medium text-gray-600 text-right">Prihod</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((l, i) => (
              <tr key={l.id} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(l.date)}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${DIR_COLOR[l.dir]}`}>{l.dir}</span>
                </td>
                <td className="px-3 py-2 font-medium text-gray-800 max-w-[160px] truncate">{l.guest}</td>
                <td className="px-3 py-2 text-gray-600 font-mono text-xs">{l.flight}</td>
                <td className="px-3 py-2 text-gray-600">{l.town}</td>
                <td className="px-3 py-2 text-gray-500 text-xs">{l.partner}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_COLOR[l.type] || 'bg-gray-100 text-gray-600'}`}>
                    {l.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600 text-xs">{l.vehicle}</td>
                <td className="px-3 py-2 text-center text-gray-600 text-xs">{l.adult + l.child}</td>
                <td className="px-3 py-2 text-right font-semibold">
                  {l.revenue != null
                    ? <span className="text-gray-800">{fmtEur(l.revenue)}</span>
                    : <span className="text-amber-400 text-xs">bez cijene</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {legs.length === 0 && (
          <div className="text-center py-16 text-gray-400">Nema podataka za odabrane filtere.</div>
        )}
      </div>
    </div>
  )
}
