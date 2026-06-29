import { useEffect, useState } from 'react'
import { useAuth } from '../App'
import { supabase } from '../lib/supabase'
import { getFlightStatusesByAirport, normalizeFlight } from '../lib/flightStatus'
import { generateContractPDF, contractFileName } from '../lib/generateContract'
import { setDriveTimesMap, getDriveMinutes } from '../lib/driveTime'

export default function Dashboard() {
  const { canWrite } = useAuth()
  const canSend = canWrite('dashboard')
  const [stats,          setStats]          = useState(null)
  const [groups,         setGroups]         = useState([])
  const [transfers,      setTransfers]      = useState([])  // flat lista (za Telegram)
  const [drivers,        setDrivers]        = useState([])
  const [vehicles,       setVehicles]       = useState([])
  const [dbHotels,       setDbHotels]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [flightStatuses, setFlightStatuses] = useState({})
  const [fetchingFlight, setFetchingFlight] = useState(false)
  const [tgStatus,       setTgStatus]       = useState('')
  const [tgSending,      setTgSending]      = useState(false)

  const todayStr = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(todayStr)

  useEffect(() => {
    loadDriversVehicles()
  }, [])

  useEffect(() => {
    load()
    setFlightStatuses({})  // resetuj status kod promjene datuma
  }, [date])

  async function loadDriversVehicles() {
    const [{ data: dr }, { data: v }, { data: ht }, { data: dt }] = await Promise.all([
      supabase.from('drivers').select('*').eq('active', true),
      supabase.from('vehicles').select('*').eq('active', true),
      supabase.from('hotels').select('*, zones(name)'),
      supabase.from('drive_times').select('*'),
    ])
    setDrivers(dr || [])
    setVehicles(v  || [])
    setDbHotels(ht || [])
    setDriveTimesMap(dt || [])
  }

  async function load() {
    setLoading(true)

    const [{ count: total }, { count: arr }, { count: dep }, { count: own }, { count: ext }] =
      await Promise.all([
        supabase.from('transfers').select('*', { count: 'exact', head: true }).eq('transfer_date', date),
        supabase.from('transfers').select('*', { count: 'exact', head: true }).eq('transfer_date', date).eq('type', 'arr'),
        supabase.from('transfers').select('*', { count: 'exact', head: true }).eq('transfer_date', date).eq('type', 'dep'),
        supabase.from('transfers').select('*', { count: 'exact', head: true }).eq('transfer_date', date).not('assigned_vehicle_id', 'is', null),
        supabase.from('transfers').select('*', { count: 'exact', head: true }).eq('transfer_date', date).not('supplier_id', 'is', null),
      ])
    setStats({ total, arr, dep, own, ext })

    const { data: ts } = await supabase
      .from('transfers')
      .select('*, vehicles(id, name, type), suppliers(id, name)')
      .eq('transfer_date', date)
      .order('pickup_time')

    if (!ts) { setLoading(false); return }

    setTransfers(ts)

    // Grupiši po vozilu
    const byVehicle = {}
    const external  = []

    for (const t of ts) {
      if (t.assigned_vehicle_id && t.vehicles) {
        const key = t.assigned_vehicle_id
        if (!byVehicle[key]) byVehicle[key] = { vehicle: t.vehicles, jobs: [] }
        byVehicle[key].jobs.push(t)
      } else {
        external.push(t)
      }
    }

    const sorted = Object.values(byVehicle).sort((a, b) => {
      const order = { vclass: 0, minivan: 1, car: 2 }
      return (order[a.vehicle.type] ?? 3) - (order[b.vehicle.type] ?? 3) ||
        a.vehicle.name.localeCompare(b.vehicle.name)
    })

    if (external.length) {
      sorted.push({ vehicle: { name: 'Eksterni', type: 'external' }, jobs: external })
    }

    setGroups(sorted)
    setLoading(false)
  }

  // ── Flight status ─────────────────────────────────────────────────
  async function fetchFlights() {
    if (!import.meta.env.VITE_RAPIDAPI_KEY) {
      alert('Nedostaje VITE_RAPIDAPI_KEY u .env fajlu.')
      return
    }
    setFetchingFlight(true)
    // Jedan API poziv po aerodromu (TIV + TGD), lokalni fuzzy match
    const statuses = await getFlightStatusesByAirport(transfers, date)
    setFlightStatuses(statuses)
    setFetchingFlight(false)
  }

  // ── Telegram ──────────────────────────────────────────────────────
  async function sendTelegram() {
    setTgSending(true)
    setTgStatus('⏳ Priprema...')

    const token = import.meta.env.VITE_TELEGRAM_BOT_TOKEN
    if (!token) {
      setTgStatus('⚠ Nedostaje VITE_TELEGRAM_BOT_TOKEN u .env')
      setTgSending(false)
      setTimeout(() => setTgStatus(''), 5000)
      return
    }

    const tg = (method, body) =>
      fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json())

    const tgForm = (method, formData) =>
      fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        body: formData,
      }).then(r => r.json())

    try {
      // Grupiši transfere po vozilu (bez eksternih)
      const ownTransfers = transfers.filter(t => t.assigned_vehicle_id && t.vehicles)
      const byVehicle    = {}
      for (const t of ownTransfers) {
        const vid = t.assigned_vehicle_id
        if (!byVehicle[vid]) byVehicle[vid] = { vehicle: t.vehicles, jobs: [] }
        byVehicle[vid].jobs.push(t)
      }

      let sent = 0, skipped = 0
      const dateFormatted = date.split('-').reverse().join('.')
      const vehEmoji = { car: '🚗', minivan: '🚐', vclass: '⭐' }

      for (const [vid, group] of Object.entries(byVehicle)) {
        const driver = drivers.find(d => d.vehicle_id === vid)
        if (!driver?.telegram_chat_id) { skipped++; continue }

        const chatId      = driver.telegram_chat_id
        const vehicleFull = vehicles.find(v => v.id === vid) || group.vehicle
        const sortedJobs  = [...group.jobs].sort((a, b) =>
          (a.pickup_time || '').localeCompare(b.pickup_time || '')
        )

        // Poruka s rasporedom
        const lines = sortedJobs.map(t => {
          const route = t.type === 'arr'
            ? `${t.airport} → ${t.hotel_name}`
            : `${t.hotel_name} → ${t.airport}`

          let flightLine = t.flight_number || '—'
          if (t.type === 'arr' && t.flight_number) {
            const fs = flightStatuses[t.flight_number]
            if (fs) {
              if (fs.delayMin >= 5) {
                flightLine += ` ⚠️ KASNI ${fs.delayMin} min → novi dolazak ${fs.actualArr}`
              } else if (fs.delayMin <= -5) {
                flightLine += ` ✅ RANI ${Math.abs(fs.delayMin)} min → dolazak ${fs.actualArr}`
              } else if (fs.status === 'arrived') {
                flightLine += ` ✅ Sletio`
              } else if (fs.status === 'enroute') {
                flightLine += ` ✈️ U letu`
              }
            }
          }

          return `${t.pickup_time?.slice(0,5) || '--:--'} ${t.type === 'arr' ? '🛬' : '🛫'} *${t.tourist}*\n  ${route}\n  ${t.pax} put · ${flightLine}`
        }).join('\n\n')

        const emoji = vehEmoji[vehicleFull.type] || '🚗'
        const text  = `${emoji} *Raspored za ${dateFormatted}* — ${vehicleFull.name}\n\n${lines}\n\n_Ugovori u prilogu._`

        setTgStatus(`⏳ Šaljem raspored za ${vehicleFull.name}...`)
        const msgResp = await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' })
        if (!msgResp.ok) { skipped++; continue }

        // PDF ugovor za svaki transfer
        for (const t of sortedJobs) {
          try {
            setTgStatus(`⏳ PDF: ${t.tourist}...`)
            // Adapt transfer format for generateContractPDF (očekuje assignedVehicle objekt)
            const transferForPdf = { ...t, zone_name: null }
            const pdfBlob = await generateContractPDF(transferForPdf, vehicleFull, date)
            const fileName = contractFileName(transferForPdf, date)

            const form = new FormData()
            form.append('chat_id', chatId)
            form.append('document', pdfBlob, fileName)
            form.append('caption', `📄 ${t.tourist} · ${dateFormatted}`)
            await tgForm('sendDocument', form)
          } catch (err) {
            console.error('PDF greška za', t.tourist, err)
          }
        }

        sent++
      }

      setTgStatus(sent === 0 && skipped > 0
        ? '⚠ Nijedan vozač nema unesen Telegram ID.'
        : `✅ Poslato: ${sent} vozač(a) · Preskočeno: ${skipped}`)
    } catch (err) {
      setTgStatus(`❌ Greška: ${err.message}`)
    }

    setTgSending(false)
    setTimeout(() => setTgStatus(''), 8000)
  }

  // ── Vehicle timeline ──────────────────────────────────────────────
  function openVehicleTimeline() {
    const UNLOAD   = 5
    const EXIT_MIN = { TIV: 35, TGD: 45 }
    const AIRPORTS = new Set(['TIV', 'TGD'])

    function addMin(t, m) {
      if (!t || m == null) return '??:??'
      const [h, min] = t.split(':').map(Number)
      const tot = h * 60 + min + m
      return `${String(Math.floor(tot/60)).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`
    }
    function subMin(t, m) {
      if (!t || m == null) return '??:??'
      const [h, min] = t.split(':').map(Number)
      const tot = Math.max(0, h*60+min-m)
      return `${String(Math.floor(tot/60)).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`
    }
    function diffMin(t1, t2) {
      if (!t1 || !t2) return 0
      const [h1,m1] = t1.split(':').map(Number)
      const [h2,m2] = t2.split(':').map(Number)
      return (h2*60+m2)-(h1*60+m1)
    }
    function getZone(loc) {
      if (!loc || AIRPORTS.has(loc.toUpperCase())) return null
      const h = dbHotels.find(x => x.name?.toLowerCase() === loc.toLowerCase())
      return h?.zones?.name || null
    }
    function drive(from, to) {
      return getDriveMinutes(from, to, getZone(from), getZone(to))
    }
    function locLabel(loc) {
      if (!loc) return '—'
      if (AIRPORTS.has(loc.toUpperCase())) return loc
      return getZone(loc) || loc
    }

    const ev = (time, endTime, dot, content) => {
      const tHtml = endTime && endTime !== time
        ? `${time}<br><span class="tend">${endTime}</span>`
        : time
      return `<div class="ev"><span class="t">${tHtml}</span><span class="dot ${dot}"></span><span class="i">${content}</span></div>`
    }

    // Filtriraj samo vlastita vozila (ne zewnętrzni)
    const ownGroups = groups.filter(g => g.vehicle.type !== 'external')

    const sections = ownGroups.map(({ vehicle, jobs }) => {
      const arrFlights = {}
      const depList = []

      for (const j of jobs) {
        if (j.type === 'arr') {
          const key = `${j.flight_number||'?'}__${j.flight_time||'?'}__${j.airport||'TIV'}`
          if (!arrFlights[key]) arrFlights[key] = { fn: j.flight_number, ft: j.flight_time, ap: j.airport||'TIV', jobs: [] }
          arrFlights[key].jobs.push(j)
        } else {
          depList.push(j)
        }
      }

      const trips = []

      for (const fg of Object.values(arrFlights)) {
        const exitTime = addMin(fg.ft, EXIT_MIN[fg.ap] ?? 35)
        const rawStops = fg.jobs.map(j => ({
          hotel: j.hotel_name, tourist: j.tourist, pax: j.pax||1,
          dt: drive(fg.ap, j.hotel_name),
        })).filter(s => s.hotel)
        rawStops.sort((a,b) => (a.dt??999)-(b.dt??999))

        let cur = exitTime, prevDt = 0
        const stops = rawStops.map(s => {
          const dt  = s.dt??30
          const inc = prevDt===0 ? dt : Math.max(3, dt-prevDt)
          const arr = addMin(cur, inc)
          const dep = addMin(arr, UNLOAD)
          cur=dep; prevDt=dt
          return { ...s, arr, dep, inc }
        })

        const lastStop = stops[stops.length-1]
        trips.push({
          kind:'arr', fn:fg.fn, ft:fg.ft, ap:fg.ap,
          exitTime, stops,
          endTime: lastStop?.dep ?? exitTime,
          endLoc:  lastStop?.hotel ?? fg.ap,
          sortKey: fg.ft||'00:00',
        })
      }

      for (const j of depList) {
        const dt = drive(j.hotel_name, j.airport)
        trips.push({
          kind:'dep', fn:j.flight_number, ft:j.flight_time, ap:j.airport||'TIV',
          pickupTime:j.pickup_time, hotel:j.hotel_name,
          tourist:j.tourist, pax:j.pax, dt,
          endTime: addMin(j.pickup_time, dt),
          endLoc: j.airport||'TIV',
          sortKey: j.pickup_time||'00:00',
        })
      }

      trips.sort((a,b) => a.sortKey.localeCompare(b.sortKey))
      return { vehicle, trips }
    })

    function tripHTML(trip, nextTrip) {
      const lines = []

      if (trip.kind === 'arr') {
        lines.push(ev(trip.ft||'—', trip.exitTime, 'lnd', `✈️ Let <b>${trip.fn||'—'}</b> slijeće · ${trip.ap}`))
        const firstStopArr = trip.stops[0]?.arr ?? null
        lines.push(ev(trip.exitTime, firstStopArr, 'exit', `🚶 Putnici izlaze s aerodroma <small>(${EXIT_MIN[trip.ap]??35} min)</small>`))
        for (const s of trip.stops) {
          lines.push(ev(s.arr, s.dep, 'hotel', `🏨 <b>${s.hotel}</b> <small>(+${s.inc} min vožnje)</small><div class="sub">${s.tourist} · ${s.pax} pax · iskrcavanje ${UNLOAD} min</div>`))
        }
      } else {
        lines.push(ev(trip.pickupTime||'—', trip.endTime, 'pkp', `🏨 Pickup: <b>${trip.hotel||'—'}</b><div class="sub">${trip.tourist} · ${trip.pax} pax</div>`))
        lines.push(ev(trip.endTime, null, 'apdot', `✈️ Aerodrom <b>${trip.ap}</b> <small>· Let ${trip.fn||'—'} polijeće ${trip.ft||'—'}</small>`))
      }

      if (nextTrip) {
        const nextPickupLoc = nextTrip.kind==='arr' ? nextTrip.ap : nextTrip.hotel
        const needAtNextBy  = nextTrip.kind==='arr' ? nextTrip.ft : nextTrip.pickupTime
        const driveDur  = drive(trip.endLoc, nextPickupLoc)
        const mustLeave = subMin(needAtNextBy, driveDur)
        const freeMin   = diffMin(trip.endTime, mustLeave)

        if (freeMin > 0) {
          lines.push(ev(trip.endTime, mustLeave, 'freedot', `⏱ Slobodan <b>${freeMin} min</b> · ${locLabel(trip.endLoc)}`))
        } else if (freeMin < 0) {
          lines.push(`<div class="conflict">⚠️ Konflikt! Nedostaje <b>${Math.abs(freeMin)} min</b> za pravovremeni dolazak na sljedeći posao</div>`)
        }

        const leaveTime = freeMin>0 ? mustLeave : trip.endTime
        const arrNext   = addMin(leaveTime, driveDur)
        lines.push(ev(leaveTime, arrNext, 'drivedot', `🚗 Vožnja: <b>${locLabel(trip.endLoc)} → ${locLabel(nextPickupLoc)}</b> <small>(${driveDur} min)</small>`))

        if (nextTrip.kind==='arr' && arrNext < nextTrip.ft) {
          const waitMin = diffMin(arrNext, nextTrip.ft)
          if (waitMin>0) lines.push(ev(arrNext, nextTrip.ft, 'wait', `⏳ Čeka na aerodromu <b>${nextTrip.ap}</b> <small>(${waitMin} min do slijetanja)</small>`))
        }
      } else {
        lines.push(ev(trip.endTime, null, 'freedot', `📍 Slobodan · <b>${locLabel(trip.endLoc)}</b>`))
      }

      const typeLabel = trip.kind==='arr' ? 'DOLAZAK' : 'ODLAZAK'
      return `
<div class="trip ${trip.kind}">
  <div class="trip-hdr">
    <span class="badge fn">${trip.fn||'—'}</span>
    <span class="badge ap">${trip.ap}</span>
    <span class="trip-time">${trip.kind==='arr' ? 'Slijetanje' : 'Polijetanje'} ${trip.ft||'—'}</span>
    <span class="type-badge ${trip.kind}">${typeLabel}</span>
  </div>
  <div class="tl">${lines.join('\n')}</div>
</div>`
    }

    const dateStr = date.split('-').reverse().join('.')
    const vehHTML = sections.map(({ vehicle, trips }) => {
      const icon = vehicle.type==='vclass' ? '⭐' : vehicle.type==='minivan' ? '🚐' : '🚗'
      const inner = trips.length
        ? trips.map((t,i) => tripHTML(t, trips[i+1]??null)).join('')
        : '<div class="no-trips">Nema transfera.</div>'
      return `<div class="veh"><div class="veh-hdr">${icon} ${vehicle.name}</div>${inner}</div>`
    }).join('')

    const css = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f1f5f9;padding:24px;color:#1e293b}
h1{font-size:1.35rem;font-weight:800;margin-bottom:20px}
.date{color:#64748b;font-weight:400;font-size:.95rem;margin-left:8px}
.veh{background:#fff;border-radius:12px;margin-bottom:20px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.07)}
.veh-hdr{background:#0f172a;color:#fff;padding:12px 20px;font-weight:700;font-size:1rem;letter-spacing:.4px}
.no-trips{padding:16px 20px;color:#94a3b8;font-style:italic}
.trip{padding:16px 20px;border-bottom:1px solid #f1f5f9}
.trip:last-child{border-bottom:none}
.trip.arr{border-left:4px solid #22c55e}
.trip.dep{border-left:4px solid #3b82f6}
.trip-hdr{display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.badge{font-weight:700;font-size:.78rem;padding:2px 8px;border-radius:5px;font-family:monospace}
.badge.fn{background:#f3f4f6;color:#374151}
.badge.ap{background:#ede9fe;color:#6d28d9}
.trip-time{font-size:.83rem;color:#64748b}
.type-badge{font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.5px}
.type-badge.arr{background:#dcfce7;color:#15803d}
.type-badge.dep{background:#dbeafe;color:#1d4ed8}
.tl{padding-left:8px}
.ev{display:grid;grid-template-columns:62px 16px 1fr;gap:10px;align-items:start;margin-bottom:10px}
.t{font-family:monospace;font-weight:700;font-size:.88rem;text-align:right;padding-top:2px;line-height:1.45}
.tend{display:block;font-size:.75rem;font-weight:500;color:#94a3b8}
.dot{width:12px;height:12px;border-radius:50%;border:2px solid;margin-top:3px}
.dot.lnd    {background:#fbbf24;border-color:#d97706}
.dot.exit   {background:#94a3b8;border-color:#64748b}
.dot.hotel  {background:#22c55e;border-color:#16a34a}
.dot.pkp    {background:#60a5fa;border-color:#2563eb}
.dot.apdot  {background:#a78bfa;border-color:#7c3aed}
.dot.freedot{background:#f0fdf4;border-color:#86efac}
.dot.drivedot{background:#e0f2fe;border-color:#38bdf8;border-style:dashed}
.dot.wait   {background:#fef9c3;border-color:#ca8a04}
.i{font-size:.86rem;color:#334155}
.i b{font-weight:700}
.i small{color:#94a3b8}
.sub{font-size:.77rem;color:#64748b;margin-top:2px}
.conflict{margin:2px 0 8px 80px;padding:7px 12px;background:#fff1f2;border:1px solid #fda4af;border-radius:6px;font-size:.82rem;color:#be123c;font-weight:600}
@media print{body{background:#fff;padding:8px}.veh{box-shadow:none;border:1px solid #e2e8f0;page-break-inside:avoid}}`

    const html = `<!DOCTYPE html><html lang="hr"><head><meta charset="UTF-8"><title>Raspored vozila · ${dateStr}</title><style>${css}</style></head><body>
<h1>Raspored vozila<span class="date">${dateStr}</span></h1>
${vehHTML || '<p style="color:#999">Nema raspoređenih vozila.</p>'}
</body></html>`

    const win = window.open('', '_blank')
    if (!win) { alert('Dozvoli pop-up prozore za ovu stranicu.'); return }
    win.document.write(html)
    win.document.close()
    win.focus()
  }

  // ── Render ────────────────────────────────────────────────────────
  const statCards = stats ? [
    { label: 'Ukupno danas',    value: stats.total, icon: '📋' },
    { label: 'Dolasci',         value: stats.arr,   icon: '🛬' },
    { label: 'Odlasci',         value: stats.dep,   icon: '🛫' },
    { label: 'Vlastita vozila', value: stats.own,   icon: '🚗' },
    { label: 'Eksterni',        value: stats.ext,   icon: '🤝' },
  ] : []

  const hasArrFlights = transfers.some(t => t.type === 'arr' && t.flight_number)
  const hasOwnVehicles = transfers.some(t => t.assigned_vehicle_id)

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Pregled</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate(d => { const dt = new Date(d); dt.setDate(dt.getDate() - 1); return dt.toISOString().slice(0,10) })}
            className="btn-ghost px-2"
          >‹</button>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="input w-40"
          />
          <button
            onClick={() => setDate(d => { const dt = new Date(d); dt.setDate(dt.getDate() + 1); return dt.toISOString().slice(0,10) })}
            className="btn-ghost px-2"
          >›</button>
          {date !== todayStr && (
            <button onClick={() => setDate(todayStr)} className="btn-ghost text-sm">Danas</button>
          )}

          {/* Raspored vozila, Flight status + Telegram — prikaži samo kad ima sačuvanih transfera */}
          {groups.filter(g => g.vehicle.type !== 'external').length > 0 && (
            <button
              onClick={openVehicleTimeline}
              className="px-3 py-1.5 rounded text-sm font-medium bg-violet-500 text-white hover:bg-violet-600 transition-colors"
              title="Provjeri raspored i tajminge svih vozila"
            >
              🕐 Raspored vozila
            </button>
          )}
          {hasArrFlights && (
            <button
              onClick={fetchFlights}
              disabled={fetchingFlight}
              className="px-3 py-1.5 rounded text-sm font-medium bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 transition-colors"
            >
              {fetchingFlight ? '⏳ Provjera...' : '🛩️ Provjeri letove'}
            </button>
          )}
          {hasOwnVehicles && canSend && (
            <button
              onClick={sendTelegram}
              disabled={tgSending}
              className="px-3 py-1.5 rounded text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {tgSending ? '⏳ Slanje...' : '✈️ Pošalji Telegram'}
            </button>
          )}
          {tgStatus && <span className="text-sm font-medium">{tgStatus}</span>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {stats ? statCards.map(c => (
          <div key={c.label} className="card p-4 text-center">
            <div className="text-3xl mb-1">{c.icon}</div>
            <div className="text-3xl font-bold text-gray-900">{c.value ?? '—'}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        )) : (
          <div className="col-span-5 text-center text-gray-400 py-6">Učitavanje...</div>
        )}
      </div>

      {/* Raspored */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">Učitavanje rasporeda...</div>
      ) : groups.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <div className="text-4xl mb-3">📭</div>
          <p>Nema sačuvanog rasporeda za {date.split('-').reverse().join('.')}.</p>
          <p className="text-sm mt-1">Idi na <span className="font-medium">Dnevni raspored</span> i uvezi Excel.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g, i) => (
            <VehicleCard key={i} group={g} flightStatuses={flightStatuses} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Flight badge ──────────────────────────────────────────────────
function FlightBadge({ flightNumber, type, flightStatuses }) {
  if (type !== 'arr' || !flightNumber) {
    return <span className="font-mono text-gray-400">{flightNumber || '—'}</span>
  }

  const key = normalizeFlight(flightNumber)
  const checked = flightStatuses && key in flightStatuses  // da li smo uopšte provjeravali
  const fs = flightStatuses?.[key]

  let badge = null
  if (checked && !fs) {
    // Provjerili ali API nije vratio podatke
    badge = <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-400 font-medium">❓ Nije dostupno</span>
  } else if (fs) {
    if (fs.status === 'cancelled') {
      badge = <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 font-medium">❌ Otkazan</span>
    } else if (fs.delayMin >= 5) {
      badge = <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700 font-medium">⚠ +{fs.delayMin}min → {fs.actualArr}</span>
    } else if (fs.delayMin <= -5) {
      badge = <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">⏩ {fs.delayMin}min → {fs.actualArr}</span>
    } else if (fs.status === 'arrived') {
      badge = <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 font-medium">✅ Sletio {fs.actualArr}</span>
    } else if (fs.status === 'enroute') {
      badge = <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-sky-100 text-sky-700 font-medium">✈️ U letu</span>
    } else {
      badge = <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500 font-medium">🕐 {fs.scheduledArr}</span>
    }
  }

  return (
    <span className="flex items-center gap-0.5 flex-wrap">
      <span className="font-mono text-gray-400">{flightNumber}</span>
      {badge}
    </span>
  )
}

// ── Vehicle card ──────────────────────────────────────────────────
function VehicleCard({ group, flightStatuses = {} }) {
  const { vehicle, jobs } = group
  const isExternal = vehicle.type === 'external'

  const headerCls = isExternal
    ? 'bg-orange-50 border-orange-200'
    : vehicle.type === 'vclass'  ? 'bg-purple-50 border-purple-200'
    : vehicle.type === 'minivan' ? 'bg-green-50  border-green-200'
    :                              'bg-blue-50   border-blue-200'

  const icon = isExternal ? '🤝'
    : vehicle.type === 'vclass'  ? '⭐'
    : vehicle.type === 'minivan' ? '🚐'
    : '🚗'

  return (
    <div className={`card border ${headerCls}`}>
      <div className={`px-4 py-2 border-b ${headerCls} flex items-center gap-2 font-semibold`}>
        <span>{icon}</span>
        <span>{vehicle.name}</span>
        <span className="text-xs font-normal text-gray-500">
          ({jobs.length} transfer{jobs.length !== 1 ? 'a' : ''})
        </span>
      </div>
      <div className="divide-y">
        {jobs.map((t, i) => (
          <div key={i} className="px-4 py-3 flex items-start gap-4">
            {/* Pickup time + type */}
            <div className="flex-shrink-0 w-16 text-center">
              <div className="font-mono text-sm font-bold">{t.pickup_time?.slice(0,5) || '--:--'}</div>
              <div className={`text-xs mt-0.5 ${t.type === 'arr' ? 'text-green-600' : 'text-blue-600'}`}>
                {t.type === 'arr' ? '🛬 arr' : '🛫 dep'}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{t.tourist}</div>
              <div className="text-xs text-gray-500">
                {t.type === 'arr'
                  ? `${t.airport} → ${t.hotel_name}`
                  : `${t.hotel_name} → ${t.airport}`
                }
              </div>
              {t.note && (
                <div className="text-xs text-gray-400 mt-0.5 truncate" title={t.note}>{t.note}</div>
              )}
            </div>

            {/* Right side */}
            <div className="flex-shrink-0 text-right text-xs">
              <div className="text-gray-500 mb-0.5">{t.pax} pax</div>
              <FlightBadge
                flightNumber={t.flight_number}
                type={t.type}
                flightStatuses={flightStatuses}
              />
              {isExternal && t.suppliers && (
                <div className="text-orange-600 font-medium mt-1">
                  {t.suppliers.name}
                  {t.supplier_price ? ` · ${t.supplier_price}€` : ''}
                </div>
              )}
              {isExternal && !t.suppliers && (
                <div className="text-red-500 mt-1">⚠ bez suplajera</div>
              )}
              <div className={`mt-1 inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                t.status === 'completed'   ? 'bg-green-100 text-green-700' :
                t.status === 'in_progress' ? 'bg-blue-100 text-blue-700'  :
                'bg-gray-100 text-gray-500'
              }`}>
                {t.status === 'completed'   ? '✓ gotovo'
                  : t.status === 'in_progress' ? '▶ u toku'
                  : 'na čekanju'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
