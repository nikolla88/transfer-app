import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Konstante ─────────────────────────────────────────────────────
const REPORTS = [
  { id: 'transfer_revenue', icon: '💰', label: 'Prihod od transfera',   ready: true  },
  { id: 'vehicles',         icon: '🚗', label: 'Izvještaj po vozilima',  ready: true  },
  { id: 'suppliers',        icon: '🤝', label: 'Externi suplajeri',      ready: true  },
  { id: 'buses',            icon: '🚌', label: 'Izvještaj po autobusima', ready: false },
]

const TRANSFER_TYPES = ['GRP', 'IND', 'SHA']
const VEHICLE_TYPES  = ['Car', 'Car Comfort', 'Minivan', 'V-Class']

const GROUP_BY_OPTIONS = [
  { value: 'none',     label: 'Detaljan prikaz' },
  { value: 'date',     label: 'Po datumu' },
  { value: 'flight',   label: 'Po letu' },
  { value: 'type',     label: 'Po tipu transfera' },
  { value: 'vehicle',  label: 'Po vozilu' },
  { value: 'partner',  label: 'Po partneru' },
  { value: 'town',     label: 'Po destinaciji' },
]

// prihod filter opcije
const REV_FILTERS = [
  { value: 'all',     label: 'Svi' },
  { value: 'has',     label: 'Sa prihodom' },
  { value: 'zero',    label: 'Nulti (€0)' },
  { value: 'missing', label: 'Bez cijene' },
]

function today()    { return new Date().toISOString().slice(0, 10) }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('sr-Latn', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—' }
function fmtEur(n)  { return n != null ? `€${Number(n).toFixed(0)}` : '—' }

// ── Glavni export ─────────────────────────────────────────────────
export default function Reports() {
  const [activeReport, setActiveReport] = useState('transfer_revenue')
  return (
    <div className="flex h-full">
      <aside className="w-52 border-r border-gray-200 bg-gray-50 flex-shrink-0 py-4 px-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Izvještaji</p>
        {REPORTS.map(r => (
          <button key={r.id} onClick={() => r.ready && setActiveReport(r.id)}
            className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
              activeReport === r.id ? 'bg-blue-600 text-white font-medium'
              : r.ready ? 'text-gray-700 hover:bg-gray-200'
              : 'text-gray-400 cursor-not-allowed'
            }`}>
            <span>{r.icon}</span>
            <span className="leading-tight">{r.label}</span>
            {!r.ready && <span className="ml-auto text-xs opacity-60">uskoro</span>}
          </button>
        ))}
      </aside>
      <div className="flex-1 overflow-y-auto">
        {activeReport === 'transfer_revenue' && <TransferRevenueReport />}
        {activeReport === 'vehicles'         && <VehicleReport />}
        {activeReport === 'suppliers'        && <SupplierReport />}
      </div>
    </div>
  )
}

// ── Izvještaj: Prihod od transfera ────────────────────────────────
function TransferRevenueReport() {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(false)

  // Serverski filteri (okidaju load)
  const [dateFrom,  setDateFrom]  = useState(daysAgo(7))
  const [dateTo,    setDateTo]    = useState(today())
  const [direction, setDirection] = useState('all')

  // Lokalni filteri (bez novog loadа)
  const [fType,     setFType]     = useState('')
  const [fVehicle,  setFVehicle]  = useState('')
  const [fFlight,   setFFlight]   = useState('')
  const [fTown,     setFTown]     = useState('')
  const [fPartner,  setFPartner]  = useState('')
  const [fRevenue,  setFRevenue]  = useState('all')

  const [groupBy,   setGroupBy]   = useState('date')
  const [sortCol,   setSortCol]   = useState('date')
  const [sortAsc,   setSortAsc]   = useState(true)

  useEffect(() => { load() }, [dateFrom, dateTo, direction])

  async function load() {
    setLoading(true)
    let q = supabase.from('rooming_list').select(
      'id,claim_inc,tourist_name,hotel_name,hotel_town,partner_alias,adult,child,' +
      'date_beg,date_end,' +
      'arr_flight_name,arr_transfer_alias,arr_vehicle_type,arr_revenue,' +
      'dep_flight_name,dep_transfer_alias,dep_vehicle_type,dep_revenue'
    )
    if (direction === 'arr') {
      if (dateFrom) q = q.gte('date_beg', dateFrom)
      if (dateTo)   q = q.lte('date_beg', dateTo)
    } else if (direction === 'dep') {
      if (dateFrom) q = q.gte('date_end', dateFrom)
      if (dateTo)   q = q.lte('date_end', dateTo)
    } else {
      if (dateFrom) q = q.or(`date_beg.gte.${dateFrom},date_end.gte.${dateFrom}`)
      if (dateTo)   q = q.or(`date_beg.lte.${dateTo},date_end.lte.${dateTo}`)
    }
    const { data, error } = await q.limit(5000)
    if (error) console.error(error)
    setRows(data || [])
    setLoading(false)
  }

  // Razvij u "noge"
  const legs = useMemo(() => {
    const result = []
    for (const r of rows) {
      const inArr = (!dateFrom || r.date_beg >= dateFrom) && (!dateTo || r.date_beg <= dateTo)
      const inDep = (!dateFrom || r.date_end >= dateFrom) && (!dateTo || r.date_end <= dateTo)

      if ((direction === 'all' || direction === 'arr') && r.arr_transfer_alias && r.arr_transfer_alias !== 'NO TR-R' && inArr) {
        result.push({
          id: r.id+'_arr', claimInc: r.claim_inc, guest: r.tourist_name, date: r.date_beg, dir: 'ARR',
          flight: r.arr_flight_name||'—', type: r.arr_transfer_alias,
          vehicle: r.arr_vehicle_type||'—', town: r.hotel_town||'—',
          partner: r.partner_alias||'—', adult: r.adult||0, child: r.child||0,
          revenue: r.arr_revenue,
        })
      }
      if ((direction === 'all' || direction === 'dep') && r.dep_transfer_alias && r.dep_transfer_alias !== 'NO TR-R' && inDep) {
        result.push({
          id: r.id+'_dep', claimInc: r.claim_inc, guest: r.tourist_name, date: r.date_end, dir: 'DEP',
          flight: r.dep_flight_name||'—', type: r.dep_transfer_alias,
          vehicle: r.dep_vehicle_type||'—', town: r.hotel_town||'—',
          partner: r.partner_alias||'—', adult: r.adult||0, child: r.child||0,
          revenue: r.dep_revenue,
        })
      }
    }
    return result
  }, [rows, direction, dateFrom, dateTo])

  // Lokalni filteri
  const filtered = useMemo(() => legs.filter(l => {
    if (fType    && l.type !== fType) return false
    if (fVehicle && l.vehicle !== fVehicle) return false
    if (fFlight  && !l.flight.toLowerCase().includes(fFlight.toLowerCase())) return false
    if (fTown    && !l.town.toLowerCase().includes(fTown.toLowerCase())) return false
    if (fPartner && !l.partner.toLowerCase().includes(fPartner.toLowerCase())) return false
    if (fRevenue === 'has'     && !(l.revenue > 0))    return false
    if (fRevenue === 'zero'    && l.revenue !== 0)      return false
    if (fRevenue === 'missing' && l.revenue !== null)   return false
    return true
  }), [legs, fType, fVehicle, fFlight, fTown, fPartner, fRevenue])

  // Sortiranje za detaljan prikaz
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol]
      if (va == null) va = sortAsc ? Infinity : -Infinity
      if (vb == null) vb = sortAsc ? Infinity : -Infinity
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortAsc ? va - vb : vb - va
    })
    return arr
  }, [filtered, sortCol, sortAsc])

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  // Statistike
  const stats = useMemo(() => ({
    total:   filtered.reduce((s,l) => s + (l.revenue||0), 0),
    arrRev:  filtered.filter(l=>l.dir==='ARR').reduce((s,l)=>s+(l.revenue||0),0),
    depRev:  filtered.filter(l=>l.dir==='DEP').reduce((s,l)=>s+(l.revenue||0),0),
    count:   filtered.length,
    pax:     filtered.reduce((s,l)=>s+l.adult+l.child,0),
    missing: filtered.filter(l=>l.revenue==null).length,
    zero:    filtered.filter(l=>l.revenue===0).length,
  }), [filtered])

  // Grupisanje
  const grouped = useMemo(() => {
    if (groupBy === 'none') return null
    const keyFn = { date: l=>l.date, flight: l=>l.flight, type: l=>l.type,
      vehicle: l=>l.vehicle||'—', partner: l=>l.partner, town: l=>l.town }[groupBy]
    const map = {}
    for (const l of filtered) {
      const k = keyFn(l)||'—'
      if (!map[k]) map[k] = { key:k, count:0, pax:0, revenue:0, noPrice:0, zeroPrice:0 }
      map[k].count++
      map[k].pax += l.adult + l.child
      map[k].revenue += l.revenue||0
      if (l.revenue == null) map[k].noPrice++
      if (l.revenue === 0)   map[k].zeroPrice++
    }
    return Object.values(map).sort((a,b) =>
      groupBy === 'date' ? a.key.localeCompare(b.key) : b.revenue - a.revenue
    )
  }, [filtered, groupBy])

  function clearFilters() {
    setFType(''); setFVehicle(''); setFFlight('')
    setFTown(''); setFPartner(''); setFRevenue('all')
  }

  const hasLocalFilters = fType||fVehicle||fFlight||fTown||fPartner||(fRevenue!=='all')

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-800">💰 Prihod od transfera</h1>
        <p className="text-sm text-gray-400 mt-0.5">Analiza prihoda prema unesenim transferima iz rooming liste</p>
      </div>

      {/* ── Serverski filteri (period + smjer) ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3 shadow-sm">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Period i smjer</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Od datuma</label>
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Do datuma</label>
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div className="flex gap-1">
            {[['7 dana',7],['14 dana',14],['30 dana',30]].map(([l,n])=>(
              <button key={l} onClick={()=>{setDateFrom(daysAgo(n));setDateTo(today())}}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">{l}</button>
            ))}
          </div>
          <div className="h-8 w-px bg-gray-200"/>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Smjer</label>
            <select value={direction} onChange={e=>setDirection(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="all">Dolasci + polasci</option>
              <option value="arr">Samo dolasci</option>
              <option value="dep">Samo polasci</option>
            </select>
          </div>
          <button onClick={load}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium self-end">
            {loading ? '⏳' : '🔄 Osvježi'}
          </button>
        </div>
      </div>

      {/* ── Lokalni filteri ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Filteri</p>
          {hasLocalFilters && (
            <button onClick={clearFilters} className="text-xs text-blue-500 hover:text-blue-700">✕ Očisti filtere</button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          {/* Tip transfera */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tip transfera</label>
            <div className="flex gap-1">
              <button onClick={()=>setFType('')}
                className={`px-2.5 py-1 text-xs rounded border ${!fType?'bg-gray-700 text-white border-gray-700':'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>Svi</button>
              {TRANSFER_TYPES.map(t=>(
                <button key={t} onClick={()=>setFType(fType===t?'':t)}
                  className={`px-2.5 py-1 text-xs rounded border ${fType===t?'bg-gray-700 text-white border-gray-700':'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{t}</button>
              ))}
            </div>
          </div>

          {/* Vozilo */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Vozilo</label>
            <div className="flex gap-1 flex-wrap">
              <button onClick={()=>setFVehicle('')}
                className={`px-2.5 py-1 text-xs rounded border ${!fVehicle?'bg-gray-700 text-white border-gray-700':'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>Sva</button>
              {VEHICLE_TYPES.map(v=>(
                <button key={v} onClick={()=>setFVehicle(fVehicle===v?'':v)}
                  className={`px-2.5 py-1 text-xs rounded border ${fVehicle===v?'bg-gray-700 text-white border-gray-700':'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{v}</button>
              ))}
            </div>
          </div>

          {/* Prihod */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Prihod</label>
            <div className="flex gap-1">
              {REV_FILTERS.map(r=>(
                <button key={r.value} onClick={()=>setFRevenue(r.value)}
                  className={`px-2.5 py-1 text-xs rounded border ${fRevenue===r.value?'bg-gray-700 text-white border-gray-700':'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{r.label}</button>
              ))}
            </div>
          </div>

          <div className="h-auto w-px bg-gray-200 self-stretch"/>

          {/* Tekstualni filteri */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Let</label>
            <input type="text" placeholder="npr. KC635" value={fFlight} onChange={e=>setFFlight(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Destinacija</label>
            <input type="text" placeholder="Budva..." value={fTown} onChange={e=>setFTown(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Partner</label>
            <input type="text" placeholder="PAKS..." value={fPartner} onChange={e=>setFPartner(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
        </div>
      </div>

      {/* ── Summary kartice ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
        {[
          { label:'Ukupan prihod', value:fmtEur(stats.total),  cls:'bg-blue-600 text-white col-span-2 lg:col-span-2' },
          { label:'Dolasci',       value:fmtEur(stats.arrRev), cls:'bg-green-50 text-green-800 border border-gray-200' },
          { label:'Polasci',       value:fmtEur(stats.depRev), cls:'bg-amber-50 text-amber-800 border border-gray-200' },
          { label:'Transfera',     value:stats.count,           cls:'bg-gray-50 text-gray-700 border border-gray-200' },
          { label:'Putnika',       value:stats.pax,             cls:'bg-gray-50 text-gray-700 border border-gray-200' },
          { label:'Bez cijene',    value:stats.missing,         cls:`border border-gray-200 ${stats.missing>0?'bg-amber-50 text-amber-700':'bg-gray-50 text-gray-400'}` },
          { label:'Nulti prihod',  value:stats.zero,            cls:`border border-gray-200 ${stats.zero>0?'bg-red-50 text-red-700':'bg-gray-50 text-gray-400'}` },
        ].map(c=>(
          <div key={c.label} className={`rounded-xl p-3 ${c.cls}`}>
            <div className="text-xs opacity-70 mb-1">{c.label}</div>
            <div className="font-bold text-xl">{c.value}</div>
          </div>
        ))}
      </div>

      {/* ── Group By ── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Grupiši po:</span>
        {GROUP_BY_OPTIONS.map(o=>(
          <button key={o.value} onClick={()=>setGroupBy(o.value)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              groupBy===o.value ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}>{o.label}</button>
        ))}
      </div>

      {/* ── Tabela ── */}
      {loading
        ? <div className="text-center py-20 text-gray-400">⏳ Učitavanje...</div>
        : grouped
          ? <GroupedTable grouped={grouped} groupBy={groupBy}/>
          : <DetailTable legs={sorted} sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort}/>
      }
    </div>
  )
}

// ── Grupisana tabela ──────────────────────────────────────────────
function GroupedTable({ grouped, groupBy }) {
  const labelMap = { date:'Datum', flight:'Let', type:'Tip transfera', vehicle:'Vozilo', partner:'Partner', town:'Destinacija' }
  const totalRev = grouped.reduce((s,r)=>s+r.revenue,0)
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
            <th className="px-4 py-3 font-medium text-gray-600 w-28">Grafikon</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map((r,i)=>{
            const pct = totalRev>0 ? (r.revenue/totalRev)*100 : 0
            return (
              <tr key={r.key} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                <td className="px-4 py-2.5 font-medium text-gray-800">
                  {groupBy==='date' ? fmtDate(r.key) : r.key}
                  {r.noPrice>0  && <span className="ml-2 text-xs text-amber-500">({r.noPrice} bez cijene)</span>}
                  {r.zeroPrice>0 && <span className="ml-1 text-xs text-red-400">({r.zeroPrice} ×€0)</span>}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-600">{r.count}</td>
                <td className="px-4 py-2.5 text-right text-gray-600">{r.pax}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmtEur(r.revenue)}</td>
                <td className="px-4 py-2.5 text-right text-gray-500 text-xs">{pct.toFixed(1)}%</td>
                <td className="px-4 py-2.5">
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{width:`${pct}%`}}/>
                  </div>
                </td>
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
            <td/>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Detaljna tabela ───────────────────────────────────────────────
function DetailTable({ legs, sortCol, sortAsc, onSort }) {
  const navigate = useNavigate()
  const TYPE_COLOR = { GRP:'bg-blue-100 text-blue-700', IND:'bg-green-100 text-green-700', SHA:'bg-purple-100 text-purple-700' }
  const DIR_COLOR  = { ARR:'bg-emerald-100 text-emerald-700', DEP:'bg-amber-100 text-amber-800' }

  function Th({ col, children, right }) {
    const active = sortCol === col
    return (
      <th onClick={()=>onSort(col)}
        className={`px-3 py-2.5 font-medium text-gray-600 cursor-pointer select-none hover:bg-gray-100 ${right?'text-right':''}`}>
        {children} {active ? (sortAsc?'↑':'↓') : <span className="text-gray-300">↕</span>}
      </th>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="text-xs text-gray-400 px-4 py-2 border-b border-gray-100">{legs.length} transfera</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left">
              <Th col="date">Datum</Th>
              <th className="px-3 py-2.5 font-medium text-gray-600">Smjer</th>
              <Th col="guest">Gost</Th>
              <Th col="flight">Let</Th>
              <Th col="town">Destinacija</Th>
              <Th col="partner">Partner</Th>
              <Th col="type">Tip</Th>
              <Th col="vehicle">Vozilo</Th>
              <Th col="adult" right>Pax</Th>
              <Th col="revenue" right>Prihod</Th>
            </tr>
          </thead>
          <tbody>
            {legs.map((l,i)=>(
              <tr key={l.id} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(l.date)}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${DIR_COLOR[l.dir]}`}>{l.dir}</span>
                </td>
                <td className="px-3 py-2 max-w-[190px]">
                  <div className="font-medium text-gray-800 truncate">{l.guest}</div>
                  {l.claimInc && (
                    <button
                      onClick={() => navigate(`/rooming?search=${l.claimInc}`)}
                      className="text-xs text-blue-500 hover:text-blue-700 hover:underline font-mono mt-0.5"
                    >
                      #{l.claimInc}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600 font-mono text-xs">{l.flight}</td>
                <td className="px-3 py-2 text-gray-600">{l.town}</td>
                <td className="px-3 py-2 text-gray-500 text-xs">{l.partner}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_COLOR[l.type]||'bg-gray-100 text-gray-600'}`}>{l.type}</span>
                </td>
                <td className="px-3 py-2 text-gray-600 text-xs">{l.vehicle}</td>
                <td className="px-3 py-2 text-right text-gray-600 text-xs">{l.adult+l.child}</td>
                <td className="px-3 py-2 text-right font-semibold">
                  {l.revenue == null
                    ? <span className="text-amber-400 text-xs">bez cijene</span>
                    : l.revenue === 0
                      ? <span className="text-red-400">€0</span>
                      : <span className="text-gray-800">{fmtEur(l.revenue)}</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {legs.length===0 && <div className="text-center py-16 text-gray-400">Nema podataka za odabrane filtere.</div>}
      </div>
    </div>
  )
}

// ── Izvještaj: Vozila ─────────────────────────────────────────────
function VehicleReport() {
  const [transfers, setTransfers] = useState([])
  const [vehicles,  setVehicles]  = useState([])
  const [loading,   setLoading]   = useState(false)

  // Lookup mape za prihod
  const [hotelZone,   setHotelZone]   = useState({}) // hotel_name → zone_id
  const [priceMap,    setPriceMap]    = useState({}) // `${zone_id}|${airport}` → price row

  const [dateFrom,  setDateFrom]  = useState(daysAgo(7))
  const [dateTo,    setDateTo]    = useState(today())
  const [fVehicle,  setFVehicle]  = useState('')
  const [groupBy,   setGroupBy]   = useState('vehicle') // vehicle | date | none

  const [sortCol,   setSortCol]   = useState('transfer_date')
  const [sortAsc,   setSortAsc]   = useState(true)

  useEffect(() => { loadAll() }, [dateFrom, dateTo])

  async function loadAll() {
    setLoading(true)
    const [tRes, vRes, hRes, pRes] = await Promise.all([
      supabase.from('transfers')
        .select('id,transfer_date,type,airport,flight_number,tourist,adl,chd,pax,hotel_name,pickup_time,transfer_type_raw,vehicle_needed,assigned_vehicle_id,supplier_id,status')
        .is('supplier_id', null)
        .not('assigned_vehicle_id', 'is', null)
        .gte('transfer_date', dateFrom)
        .lte('transfer_date', dateTo)
        .order('transfer_date', { ascending: true })
        .limit(5000),
      supabase.from('vehicles').select('id,name,type,plate'),
      supabase.from('hotels').select('name,zone_id'),
      supabase.from('sale_prices').select('zone_id,airport,group_adt,group_chd,ind_econ,ind_comfort,minivan,v_class'),
    ])
    if (tRes.error) console.error('transfers:', tRes.error)
    if (vRes.error) console.error('vehicles:',  vRes.error)
    if (hRes.error) console.error('hotels:',    hRes.error)
    if (pRes.error) console.error('prices:',    pRes.error)

    // Izgradi lookup mape
    const hz = {}
    for (const h of hRes.data || []) hz[h.name] = h.zone_id
    const pm = {}
    for (const p of pRes.data || []) pm[`${p.zone_id}|${p.airport}`] = p

    setHotelZone(hz)
    setPriceMap(pm)
    setVehicles(vRes.data || [])
    setTransfers(tRes.data || [])
    setLoading(false)
  }

  // Izračunaj prihod za jedan transfer
  // Napomena: vehicle_needed se čuva kao lowercase ('car','minivan','vclass','car_comfort')
  // transfer_type_raw je uvijek 'IND' u transfers tabeli (GRP se ne čuva zasebno)
  function calcRevenue(t) {
    const zoneId = hotelZone[t.hotel_name]
    if (!zoneId || !t.airport) return null
    const key = `${zoneId}|${t.airport}`
    const p = priceMap[key]
    if (!p) return null
    const tt = (t.transfer_type_raw || '').toUpperCase()
    const vt = (t.vehicle_needed || '').toLowerCase()
    const adl = t.adl || 0
    const chd = t.chd || 0
    if (tt === 'GRP') {
      if (p.group_adt == null) return null
      return adl * (p.group_adt || 0) + chd * (p.group_chd || 0)
    }
    // IND ili SHA — vehicle_needed: 'car'|'car_comfort'|'minivan'|'vclass'
    let price = null
    if (vt === 'car')          price = p.ind_econ
    else if (vt === 'car_comfort') price = p.ind_comfort
    else if (vt === 'minivan') price = p.minivan
    else if (vt === 'vclass')  price = p.v_class
    return price
  }

  const vehicleMap = useMemo(() => {
    const m = {}
    for (const v of vehicles) m[v.id] = v
    return m
  }, [vehicles])

  // Obogati transfere
  const enriched = useMemo(() => transfers.map(t => ({
    ...t,
    vehicleName: vehicleMap[t.assigned_vehicle_id]?.name || '—',
    vehiclePlate: vehicleMap[t.assigned_vehicle_id]?.plate || '',
    revenue: calcRevenue(t),
    paxTotal: (t.adl || 0) + (t.chd || 0),
  })), [transfers, vehicleMap, hotelZone, priceMap])

  // Filter po vozilu
  const filtered = useMemo(() => {
    if (!fVehicle) return enriched
    return enriched.filter(t => t.assigned_vehicle_id === fVehicle)
  }, [enriched, fVehicle])

  // Sortirano za detaljan prikaz
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol]
      if (va == null) va = sortAsc ? '￿' : ''
      if (vb == null) vb = sortAsc ? '￿' : ''
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortAsc ? va - vb : vb - va
    })
    return arr
  }, [filtered, sortCol, sortAsc])

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  // Summary kartice
  const stats = useMemo(() => ({
    trips:   filtered.length,
    pax:     filtered.reduce((s,t) => s + t.paxTotal, 0),
    revenue: filtered.reduce((s,t) => s + (t.revenue || 0), 0),
    missing: filtered.filter(t => t.revenue == null).length,
  }), [filtered])

  // Grupisanje po vozilu
  const byVehicle = useMemo(() => {
    const map = {}
    for (const t of filtered) {
      const k = t.assigned_vehicle_id || '—'
      if (!map[k]) map[k] = { id: k, name: t.vehicleName, plate: t.vehiclePlate, trips: 0, pax: 0, revenue: 0, missing: 0 }
      map[k].trips++
      map[k].pax += t.paxTotal
      map[k].revenue += t.revenue || 0
      if (t.revenue == null) map[k].missing++
    }
    return Object.values(map).sort((a,b) => b.revenue - a.revenue)
  }, [filtered])

  // Grupisanje po datumu
  const byDate = useMemo(() => {
    const map = {}
    for (const t of filtered) {
      const k = t.transfer_date
      if (!map[k]) map[k] = { date: k, trips: 0, pax: 0, revenue: 0, missing: 0 }
      map[k].trips++
      map[k].pax += t.paxTotal
      map[k].revenue += t.revenue || 0
      if (t.revenue == null) map[k].missing++
    }
    return Object.values(map).sort((a,b) => a.date.localeCompare(b.date))
  }, [filtered])

  function Th({ col, children, right }) {
    const active = sortCol === col
    return (
      <th onClick={() => toggleSort(col)}
        className={`px-3 py-2.5 font-medium text-gray-600 cursor-pointer select-none hover:bg-gray-100 ${right ? 'text-right' : ''}`}>
        {children} {active ? (sortAsc ? '↑' : '↓') : <span className="text-gray-300">↕</span>}
      </th>
    )
  }

  const DIR_COLOR = { arr: 'bg-emerald-100 text-emerald-700', dep: 'bg-amber-100 text-amber-800' }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-800">🚗 Izvještaj po vozilima</h1>
        <p className="text-sm text-gray-400 mt-0.5">Pregled sačuvanih vožnji iz dnevnog rasporeda — samo vlastita vozila</p>
      </div>

      {/* Filteri */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
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
            {[['7 dana',7],['14 dana',14],['30 dana',30]].map(([l,n])=>(
              <button key={l} onClick={() => { setDateFrom(daysAgo(n)); setDateTo(today()) }}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">{l}</button>
            ))}
          </div>
          <div className="h-8 w-px bg-gray-200"/>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Vozilo</label>
            <select value={fVehicle} onChange={e => setFVehicle(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="">Sva vozila</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{v.name} {v.plate ? `(${v.plate})` : ''}</option>
              ))}
            </select>
          </div>
          <button onClick={loadAll}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium self-end">
            {loading ? '⏳' : '🔄 Osvježi'}
          </button>
        </div>
      </div>

      {/* Summary kartice */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Ukupan prihod', value: fmtEur(stats.revenue), cls: 'bg-blue-600 text-white' },
          { label: 'Vožnji',        value: stats.trips,            cls: 'bg-gray-50 text-gray-700 border border-gray-200' },
          { label: 'Putnika',       value: stats.pax,              cls: 'bg-gray-50 text-gray-700 border border-gray-200' },
          { label: 'Bez cijene',    value: stats.missing,          cls: `border border-gray-200 ${stats.missing > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-400'}` },
        ].map(c => (
          <div key={c.label} className={`rounded-xl p-3 ${c.cls}`}>
            <div className="text-xs opacity-70 mb-1">{c.label}</div>
            <div className="font-bold text-xl">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Group By */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 font-medium">Grupiši po:</span>
        {[['vehicle','Po vozilu'],['date','Po datumu'],['none','Detaljan prikaz']].map(([v,l]) => (
          <button key={v} onClick={() => setGroupBy(v)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              groupBy === v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}>{l}</button>
        ))}
      </div>

      {loading
        ? <div className="text-center py-20 text-gray-400">⏳ Učitavanje...</div>
        : groupBy === 'vehicle'
          ? (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-4 py-3 font-medium text-gray-600">Vozilo</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Vožnji</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Putnika</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Prihod</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Bez cijene</th>
                    <th className="px-4 py-3 font-medium text-gray-600 w-24">Udio</th>
                  </tr>
                </thead>
                <tbody>
                  {byVehicle.map((r, i) => {
                    const pct = stats.revenue > 0 ? (r.revenue / stats.revenue) * 100 : 0
                    return (
                      <tr key={r.id} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-800">{r.name}</div>
                          {r.plate && <div className="text-xs text-gray-400 font-mono">{r.plate}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{r.trips}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{r.pax}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmtEur(r.revenue)}</td>
                        <td className="px-4 py-2.5 text-right text-xs">
                          {r.missing > 0 ? <span className="text-amber-500">{r.missing}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div className="bg-blue-500 h-2 rounded-full" style={{width:`${pct}%`}}/>
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5 text-right">{pct.toFixed(1)}%</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
                    <td className="px-4 py-3 text-blue-800">UKUPNO</td>
                    <td className="px-4 py-3 text-right text-blue-800">{stats.trips}</td>
                    <td className="px-4 py-3 text-right text-blue-800">{stats.pax}</td>
                    <td className="px-4 py-3 text-right text-blue-800 text-base">{fmtEur(stats.revenue)}</td>
                    <td className="px-4 py-3 text-right text-blue-800">{stats.missing > 0 ? stats.missing : '—'}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
              {byVehicle.length === 0 && <div className="text-center py-16 text-gray-400">Nema vožnji za odabrani period.</div>}
            </div>
          )
          : groupBy === 'date'
          ? (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-4 py-3 font-medium text-gray-600">Datum</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Vožnji</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Putnika</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Prihod</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Bez cijene</th>
                    <th className="px-4 py-3 font-medium text-gray-600 w-24">Grafikon</th>
                  </tr>
                </thead>
                <tbody>
                  {byDate.map((r, i) => {
                    const pct = stats.revenue > 0 ? (r.revenue / stats.revenue) * 100 : 0
                    return (
                      <tr key={r.date} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{fmtDate(r.date)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{r.trips}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{r.pax}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmtEur(r.revenue)}</td>
                        <td className="px-4 py-2.5 text-right text-xs">
                          {r.missing > 0 ? <span className="text-amber-500">{r.missing}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full" style={{width:`${pct}%`}}/>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
                    <td className="px-4 py-3 text-blue-800">UKUPNO</td>
                    <td className="px-4 py-3 text-right text-blue-800">{stats.trips}</td>
                    <td className="px-4 py-3 text-right text-blue-800">{stats.pax}</td>
                    <td className="px-4 py-3 text-right text-blue-800 text-base">{fmtEur(stats.revenue)}</td>
                    <td className="px-4 py-3 text-right text-blue-800">{stats.missing > 0 ? stats.missing : '—'}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
              {byDate.length === 0 && <div className="text-center py-16 text-gray-400">Nema vožnji za odabrani period.</div>}
            </div>
          )
          : (
            /* Detaljan prikaz */
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="text-xs text-gray-400 px-4 py-2 border-b border-gray-100">{sorted.length} vožnji</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-left">
                      <Th col="transfer_date">Datum</Th>
                      <Th col="vehicleName">Vozilo</Th>
                      <th className="px-3 py-2.5 font-medium text-gray-600">Smjer</th>
                      <Th col="pickup_time">Polazak</Th>
                      <Th col="tourist">Gost</Th>
                      <Th col="hotel_name">Hotel</Th>
                      <Th col="flight_number">Let</Th>
                      <Th col="transfer_type_raw">Tip</Th>
                      <Th col="paxTotal" right>Pax</Th>
                      <Th col="revenue" right>Prihod</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((t, i) => (
                      <tr key={t.id} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(t.transfer_date)}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{t.vehicleName}</div>
                          {t.vehiclePlate && <div className="text-xs text-gray-400 font-mono">{t.vehiclePlate}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${DIR_COLOR[t.type] || 'bg-gray-100 text-gray-600'}`}>
                            {t.type === 'arr' ? 'ARR' : t.type === 'dep' ? 'DEP' : t.type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600 font-mono text-xs">{t.pickup_time || '—'}</td>
                        <td className="px-3 py-2 max-w-[160px] truncate text-gray-800">{t.tourist || '—'}</td>
                        <td className="px-3 py-2 max-w-[140px] truncate text-gray-600 text-xs">{t.hotel_name || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 font-mono text-xs">{t.flight_number || '—'}</td>
                        <td className="px-3 py-2">
                          {t.transfer_type_raw && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              t.transfer_type_raw==='GRP'?'bg-blue-100 text-blue-700':
                              t.transfer_type_raw==='IND'?'bg-green-100 text-green-700':
                              'bg-purple-100 text-purple-700'
                            }`}>{t.transfer_type_raw}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 text-xs">{t.paxTotal}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {t.revenue == null
                            ? <span className="text-amber-400 text-xs">bez cijene</span>
                            : t.revenue === 0
                              ? <span className="text-red-400">€0</span>
                              : <span className="text-gray-800">{fmtEur(t.revenue)}</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sorted.length === 0 && <div className="text-center py-16 text-gray-400">Nema vožnji za odabrani period.</div>}
              </div>
            </div>
          )
      }
    </div>
  )
}

// ── Izvještaj: Externi suplajeri ──────────────────────────────────
function SupplierReport() {
  const [transfers,  setTransfers]  = useState([])
  const [suppliers,  setSuppliers]  = useState([])
  const [loading,    setLoading]    = useState(false)
  const [dateFrom,   setDateFrom]   = useState(daysAgo(7))
  const [dateTo,     setDateTo]     = useState(today())
  const [fSupplier,  setFSupplier]  = useState('')
  const [groupBy,    setGroupBy]    = useState('supplier')

  useEffect(() => { loadAll() }, [dateFrom, dateTo])

  async function loadAll() {
    setLoading(true)
    const [tRes, sRes] = await Promise.all([
      supabase.from('transfers')
        .select('id,transfer_date,type,airport,flight_number,tourist,adl,chd,pax,hotel_name,pickup_time,transfer_type_raw,vehicle_needed,supplier_id,supplier_price,status')
        .not('supplier_id', 'is', null)
        .gte('transfer_date', dateFrom)
        .lte('transfer_date', dateTo)
        .order('transfer_date', { ascending: true })
        .limit(5000),
      supabase.from('suppliers').select('id,name').eq('active', true),
    ])
    if (tRes.error) console.error(tRes.error)
    if (sRes.error) console.error(sRes.error)
    setSuppliers(sRes.data || [])
    setTransfers(tRes.data || [])
    setLoading(false)
  }

  const supplierMap = useMemo(() => {
    const m = {}
    for (const s of suppliers) m[s.id] = s.name
    return m
  }, [suppliers])

  const enriched = useMemo(() => transfers.map(t => ({
    ...t,
    supplierName: supplierMap[t.supplier_id] || 'Nepoznat',
    paxTotal: (t.adl || 0) + (t.chd || 0),
  })), [transfers, supplierMap])

  const filtered = useMemo(() => {
    if (!fSupplier) return enriched
    return enriched.filter(t => t.supplier_id === fSupplier)
  }, [enriched, fSupplier])

  const stats = useMemo(() => ({
    trips:   filtered.length,
    pax:     filtered.reduce((s,t) => s + t.paxTotal, 0),
    cost:    filtered.reduce((s,t) => s + (t.supplier_price || 0), 0),
    missing: filtered.filter(t => t.supplier_price == null).length,
  }), [filtered])

  // Grupisanje po suplajeru
  const bySupplier = useMemo(() => {
    const map = {}
    for (const t of filtered) {
      const k = t.supplier_id || '—'
      if (!map[k]) map[k] = { id: k, name: t.supplierName, trips: 0, pax: 0, cost: 0, missing: 0 }
      map[k].trips++
      map[k].pax += t.paxTotal
      map[k].cost += t.supplier_price || 0
      if (t.supplier_price == null) map[k].missing++
    }
    return Object.values(map).sort((a,b) => b.cost - a.cost)
  }, [filtered])

  // Grupisanje po datumu
  const byDate = useMemo(() => {
    const map = {}
    for (const t of filtered) {
      const k = t.transfer_date
      if (!map[k]) map[k] = { date: k, trips: 0, pax: 0, cost: 0 }
      map[k].trips++
      map[k].pax += t.paxTotal
      map[k].cost += t.supplier_price || 0
    }
    return Object.values(map).sort((a,b) => a.date.localeCompare(b.date))
  }, [filtered])

  const DIR_COLOR = { arr: 'bg-emerald-100 text-emerald-700', dep: 'bg-amber-100 text-amber-800' }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-800">🤝 Externi suplajeri</h1>
        <p className="text-sm text-gray-400 mt-0.5">Pregled vožnji sa externim supla jerom i troškovi</p>
      </div>

      {/* Filteri */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
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
            {[['7 dana',7],['14 dana',14],['30 dana',30]].map(([l,n])=>(
              <button key={l} onClick={() => { setDateFrom(daysAgo(n)); setDateTo(today()) }}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">{l}</button>
            ))}
          </div>
          <div className="h-8 w-px bg-gray-200"/>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Supla jer</label>
            <select value={fSupplier} onChange={e => setFSupplier(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="">Svi suplajeri</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button onClick={loadAll}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium self-end">
            {loading ? '⏳' : '🔄 Osvježi'}
          </button>
        </div>
      </div>

      {/* Summary kartice */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Ukupni troškovi', value: fmtEur(stats.cost),  cls: 'bg-orange-500 text-white' },
          { label: 'Vožnji',          value: stats.trips,          cls: 'bg-gray-50 text-gray-700 border border-gray-200' },
          { label: 'Putnika',         value: stats.pax,            cls: 'bg-gray-50 text-gray-700 border border-gray-200' },
          { label: 'Bez cijene',      value: stats.missing,        cls: `border border-gray-200 ${stats.missing > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-400'}` },
        ].map(c => (
          <div key={c.label} className={`rounded-xl p-3 ${c.cls}`}>
            <div className="text-xs opacity-70 mb-1">{c.label}</div>
            <div className="font-bold text-xl">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Group By */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 font-medium">Grupiši po:</span>
        {[['supplier','Po suplajeru'],['date','Po datumu'],['none','Detaljan prikaz']].map(([v,l]) => (
          <button key={v} onClick={() => setGroupBy(v)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              groupBy === v ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}>{l}</button>
        ))}
      </div>

      {loading
        ? <div className="text-center py-20 text-gray-400">⏳ Učitavanje...</div>
        : groupBy === 'supplier'
        ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Supla jer</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Vožnji</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Putnika</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Ukupno</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Bez cijene</th>
                  <th className="px-4 py-3 font-medium text-gray-600 w-24">Udio</th>
                </tr>
              </thead>
              <tbody>
                {bySupplier.map((r, i) => {
                  const pct = stats.cost > 0 ? (r.cost / stats.cost) * 100 : 0
                  return (
                    <tr key={r.id} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">🤝 {r.name}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{r.trips}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{r.pax}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmtEur(r.cost)}</td>
                      <td className="px-4 py-2.5 text-right text-xs">
                        {r.missing > 0 ? <span className="text-amber-500">{r.missing}</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className="bg-orange-400 h-2 rounded-full" style={{width:`${pct}%`}}/>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5 text-right">{pct.toFixed(1)}%</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-orange-50 border-t-2 border-orange-200 font-semibold">
                  <td className="px-4 py-3 text-orange-800">UKUPNO</td>
                  <td className="px-4 py-3 text-right text-orange-800">{stats.trips}</td>
                  <td className="px-4 py-3 text-right text-orange-800">{stats.pax}</td>
                  <td className="px-4 py-3 text-right text-orange-800 text-base">{fmtEur(stats.cost)}</td>
                  <td className="px-4 py-3 text-right text-orange-800">{stats.missing > 0 ? stats.missing : '—'}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
            {bySupplier.length === 0 && <div className="text-center py-16 text-gray-400">Nema externih vožnji za odabrani period.</div>}
          </div>
        )
        : groupBy === 'date'
        ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Datum</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Vožnji</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Putnika</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Troškovi</th>
                  <th className="px-4 py-3 font-medium text-gray-600 w-24">Grafikon</th>
                </tr>
              </thead>
              <tbody>
                {byDate.map((r, i) => {
                  const pct = stats.cost > 0 ? (r.cost / stats.cost) * 100 : 0
                  return (
                    <tr key={r.date} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{fmtDate(r.date)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{r.trips}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{r.pax}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmtEur(r.cost)}</td>
                      <td className="px-4 py-2.5">
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className="bg-orange-400 h-2 rounded-full" style={{width:`${pct}%`}}/>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-orange-50 border-t-2 border-orange-200 font-semibold">
                  <td className="px-4 py-3 text-orange-800">UKUPNO</td>
                  <td className="px-4 py-3 text-right text-orange-800">{stats.trips}</td>
                  <td className="px-4 py-3 text-right text-orange-800">{stats.pax}</td>
                  <td className="px-4 py-3 text-right text-orange-800 text-base">{fmtEur(stats.cost)}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
            {byDate.length === 0 && <div className="text-center py-16 text-gray-400">Nema externih vožnji za odabrani period.</div>}
          </div>
        )
        : (
          /* Detaljan */
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="text-xs text-gray-400 px-4 py-2 border-b border-gray-100">{filtered.length} vožnji</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left">
                    <th className="px-3 py-2.5 font-medium text-gray-600">Datum</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">Supla jer</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">Smjer</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">Polazak</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">Gost</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">Hotel</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600">Let</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-right">Pax</th>
                    <th className="px-3 py-2.5 font-medium text-gray-600 text-right">Cijena</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t, i) => (
                    <tr key={t.id} className={`border-b border-gray-100 ${i%2===0?'bg-white':'bg-gray-50/40'}`}>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(t.transfer_date)}</td>
                      <td className="px-3 py-2 font-medium text-orange-700">{t.supplierName}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${DIR_COLOR[t.type] || 'bg-gray-100 text-gray-600'}`}>
                          {t.type === 'arr' ? 'ARR' : t.type === 'dep' ? 'DEP' : t.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-xs">{t.pickup_time || '—'}</td>
                      <td className="px-3 py-2 max-w-[150px] truncate text-gray-800">{t.tourist || '—'}</td>
                      <td className="px-3 py-2 max-w-[130px] truncate text-gray-600 text-xs">{t.hotel_name || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-xs">{t.flight_number || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600 text-xs">{t.paxTotal}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {t.supplier_price == null
                          ? <span className="text-amber-400 text-xs">bez cijene</span>
                          : <span className="text-gray-800">{fmtEur(t.supplier_price)}</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="text-center py-16 text-gray-400">Nema externih vožnji za odabrani period.</div>}
            </div>
          </div>
        )
      }
    </div>
  )
}
