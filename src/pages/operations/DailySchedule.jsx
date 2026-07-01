import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../App'
import { supabase } from '../../lib/supabase'
import { parseXlsx } from '../../lib/xlsxParser'
import { runSchedule, groupByVehicle, computeFleetState } from '../../lib/scheduler'
import { setDriveTimesMap, getDriveMinutes } from '../../lib/driveTime'
import { generateContractPDF, contractFileName } from '../../lib/generateContract'
import { getFlightStatusesByAirport, normalizeFlight } from '../../lib/flightStatus'

const VEH_LBL = { car: 'CAR', minivan: 'MINIVAN', vclass: 'V CLASS' }

// ── Fuzzy hotel matching ──────────────────────────────────────────
function matchHotel(excelName, dbHotels) {
  const name = excelName.toUpperCase().trim()
  const exact = dbHotels.find(h => h.name.toUpperCase().trim() === name)
  if (exact) return { hotel: exact, confidence: 'exact' }

  // Contains match (Excel name sadrži DB ime ili obrnuto)
  const fuzzy = dbHotels.filter(h => {
    const db = h.name.toUpperCase().trim()
    return name.includes(db) || db.includes(name)
  })
  if (fuzzy.length === 1) return { hotel: fuzzy[0], confidence: 'fuzzy' }

  // Word overlap — makar 2 zajednička riječa
  const wordsA = name.split(/\s+/).filter(w => w.length > 2)
  const best = dbHotels
    .map(h => {
      const wordsB = h.name.toUpperCase().split(/\s+/).filter(w => w.length > 2)
      const overlap = wordsA.filter(w => wordsB.includes(w)).length
      return { hotel: h, overlap }
    })
    .filter(x => x.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)

  if (best.length > 0) return { hotel: best[0].hotel, confidence: 'fuzzy' }
  return { hotel: null, confidence: 'none' }
}

export default function DailySchedule() {
  const { canWrite } = useAuth()
  const canSave = canWrite('schedule')

  const [date,        setDate]        = useState(tomorrow())
  const [step,        setStep]        = useState('import')   // import | hotels | working | schedule
  const [transfers,   setTransfers]   = useState([])
  const [scheduled,   setScheduled]   = useState([])
  const [vehicles,    setVehicles]    = useState([])
  const [suppliers,   setSuppliers]   = useState([])
  const [prices,      setPrices]      = useState([])
  const [dbHotels,    setDbHotels]    = useState([])  // svi hoteli iz baze
  const [zones,       setZones]       = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set()) // za merge
  const [resolutions, setResolutions] = useState([])  // hotel resolution state
  const [drivers,     setDrivers]     = useState([])
  const [vehBlocks,   setVehBlocks]   = useState([])
  const [loading,        setLoading]        = useState(false)
  const [saveMsg,        setSaveMsg]        = useState('')
  const [inlinePickup,   setInlinePickup]   = useState(null)  // { id, val } za working tabelu
  const [waStatus,       setWaStatus]       = useState('')
  const [waSending,      setWaSending]      = useState(false)
  const [flightStatuses, setFlightStatuses] = useState({})  // { flightNumber: status }
  const [fetchingFlight, setFetchingFlight] = useState(false)
  const fileRef = useRef()

  useEffect(() => { loadConfig() }, [])
  useEffect(() => { loadBlocks()  }, [date])

  async function loadBlocks() {
    const { data } = await supabase
      .from('vehicle_blocks')
      .select('vehicle_id, time_from, time_to')
      .eq('block_date', date)
    setVehBlocks(data || [])
  }

  async function loadConfig() {
    const [{ data: v }, { data: s }, { data: p }, { data: h }, { data: z }, { data: dt }, { data: dr }] =
      await Promise.all([
        supabase.from('vehicles').select('*').eq('active', true).order('type').order('name'),
        supabase.from('suppliers').select('*').eq('active', true),
        supabase.from('prices').select('*, zones(name)'),
        supabase.from('hotels').select('*, zones(name)').order('name'),
        supabase.from('zones').select('id, name').order('name'),
        supabase.from('drive_times').select('from_point, to_point, minutes'),
        supabase.from('drivers').select('*').eq('active', true),
      ])
    setVehicles(v || [])
    setSuppliers(s || [])
    setPrices(p || [])
    setDbHotels(h || [])
    setZones(z || [])
    setDrivers(dr || [])
    setDriveTimesMap(dt || [])
  }

  // Gradi hotelZoneMap iz baze
  function buildHotelMap(hotels) {
    const map = {}
    for (const h of hotels) {
      if (h.zones) map[h.name.toUpperCase()] = h.zones.name
    }
    return map
  }

  // ── Učitaj IND transfere iz Rooming Liste ─────────────────────
  async function loadFromRoomingList() {
    setLoading(true)
    try {
      // 1. IND dolasci + GRP sa postavljenim tipom vozila (vozimo autom/minivanom)
      const [
        { data: indArrRows, error: e1 },
        { data: indDepRows, error: e2 },
        { data: grpArrRows, error: e3 },
        { data: grpDepRows, error: e4 },
      ] = await Promise.all([
        supabase.from('rooming_list').select('*').eq('date_beg', date).eq('arr_transfer_alias', 'IND'),
        supabase.from('rooming_list').select('*').eq('date_end', date).eq('dep_transfer_alias', 'IND'),
        supabase.from('rooming_list').select('*').eq('date_beg', date).eq('arr_transfer_alias', 'GRP').not('arr_vehicle_type', 'is', null),
        supabase.from('rooming_list').select('*').eq('date_end', date).eq('dep_transfer_alias', 'GRP').not('dep_vehicle_type', 'is', null),
      ])
      if (e1 || e2 || e3 || e4) throw new Error((e1 || e2 || e3 || e4).message)
      const arrRows = [...(indArrRows || []), ...(grpArrRows || [])]
      const depRows = [...(indDepRows || []), ...(grpDepRows || [])]

      // 2. Rasporedi letova za pickup obračun
      const { data: schedData } = await supabase
        .from('flight_schedule')
        .select('flight_number, airport, direction, scheduled_time, days_of_week')

      const normFlight = (fn) => {
        if (!fn) return ''
        let s = fn.replace(/\s*\([^)]*\)/g, '').trim().replace(/[^A-Z0-9]/gi, '').toUpperCase()
        const m = s.match(/^([A-Z\d]{2})(\d+)$/)
        return m ? m[1] + parseInt(m[2], 10).toString() : s
      }
      const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
      const dayName = DAY_NAMES[new Date(date + 'T00:00:00').getDay()]

      const schedMap = {}
      for (const s of (schedData || [])) {
        const norm = normFlight(s.flight_number)
        if (!schedMap[norm]) schedMap[norm] = { ARR: [], DEP: [] }
        schedMap[norm][s.direction]?.push(s)
      }

      function findSched(flightName, dir) {
        const entry = schedMap[normFlight(flightName)]
        if (!entry) return null
        const list = entry[dir] || []
        return list.find(s => !s.days_of_week?.length || s.days_of_week.includes(dayName)) || null
      }

      function calcPickup(time, mins) {
        if (!time || !mins) return null
        const [h, m] = time.split(':').map(Number)
        const total = h * 60 + m - mins
        if (total < 0) return null
        return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
      }

      // 3. Hoteli sa zonama — koristi matchHotel() da izbjegnemo duplikate i case mismatch
      const hotelNames = [...new Set([
        ...(arrRows || []).map(r => r.hotel_name),
        ...(depRows || []).map(r => r.hotel_name),
      ].filter(Boolean))]
      // dbHotels je već učitan u state — koristimo fuzzy matching kao pri Excel importu
      const hotelMatchCache = {}
      for (const name of hotelNames) {
        const { hotel, confidence } = matchHotel(name, dbHotels)
        hotelMatchCache[name] = { hotel, confidence }
      }
      // Wrapper koji vraća hotel objekat (ili null) za dati naziv iz rooming liste
      const getHotel = (name) => hotelMatchCache[name]?.hotel || null

      // 4. Mapping tipa vozila
      const vehMap = { 'Car': 'car', 'Minivan': 'minivan', 'V-Class': 'vclass' }

      let idCtr = 0
      const built = []

      for (const r of (arrRows || [])) {
        const sched = findSched(r.arr_flight_name, 'ARR')
        const hotel = getHotel(r.hotel_name)
        // Za dolaske NE računamo pickup_time — vozač ide na aerodrom u vrijeme slijetanja
        built.push({
          _id:              idCtr++,
          type:             'arr',
          reservation_id:   String(r.claim_inc),
          tourist:          r.tourist_name,
          hotel_name:       r.hotel_name,
          zone_name:        hotel?.zones?.name || null,
          flight_number:    r.arr_flight_name || null,
          flight_time:      sched?.scheduled_time || null,
          airport:          sched?.airport || 'TIV',
          pickup_time:      sched?.scheduled_time || null,  // = slijetanje, za scheduler sort
          pax:              (r.adult || 0) + (r.child || 0) + (r.infant || 0),
          adl:              r.adult  || 0,
          chd:              r.child  || 0,
          inf:              r.infant || 0,
          vehicle_needed:   vehMap[r.arr_vehicle_type] || 'car',
          note:             r.claim_note || null,
          transfer_type_raw: r.arr_transfer_alias || 'IND',
        })
      }

      for (const r of (depRows || [])) {
        const sched = findSched(r.dep_flight_name, 'DEP')
        const hotel = getHotel(r.hotel_name)
        // pickup_time = flight_time - time_to_tiv/tgd
        // time_to_tiv/tgd je UKUPNI lead time (vožnja + buffer na aerodromu), ne samo drive time.
        // Ovo važi i za IND i za GRP — isti izvor podataka za "kada treba pokupiti gosta".
        // getDriveMinutes() se koristi SAMO u scheduleru (može li auto stići između dva posla)
        // i u timeline prikazu (koliko vožnja fizički traje).
        const mins = sched?.airport === 'TGD' ? hotel?.time_to_tgd : hotel?.time_to_tiv
        built.push({
          _id:              idCtr++,
          type:             'dep',
          reservation_id:   String(r.claim_inc),
          tourist:          r.tourist_name,
          hotel_name:       r.hotel_name,
          zone_name:        hotel?.zones?.name || null,
          flight_number:    r.dep_flight_name || null,
          flight_time:      sched?.scheduled_time || null,
          airport:          sched?.airport || 'TIV',
          pickup_time:      calcPickup(sched?.scheduled_time, mins),
          pax:              (r.adult || 0) + (r.child || 0) + (r.infant || 0),
          adl:              r.adult  || 0,
          chd:              r.child  || 0,
          inf:              r.infant || 0,
          vehicle_needed:   vehMap[r.dep_vehicle_type] || 'car',
          note:             r.claim_note || null,
          transfer_type_raw: r.dep_transfer_alias || 'IND',
        })
      }

      if (built.length === 0) {
        alert(`Nema IND transfera za ${date} u Rooming Listi.`)
        setLoading(false)
        return
      }

      // 5. Provjeri da li neki hoteli nemaju zonu
      const res = hotelNames.map(name => {
        const { hotel, confidence } = hotelMatchCache[name]
        return {
          excelName:        name,
          matchedHotel:     hotel || null,
          confidence:       confidence,
          confirmed:        !!hotel?.zone_id,
          selectedZoneId:   hotel?.zone_id || '',
          selectedZoneName: hotel?.zones?.name || hotel?.zones?.name || '',
        }
      })

      setResolutions(res)
      setTransfers(autoMergeSameReservations(built))

      const missingZone = res.filter(r => !r.confirmed)
      if (missingZone.length === 0) {
        setStep('working')  // Svi hoteli imaju zone → preskoči hotel korak
      } else {
        setStep('hotels')
      }

    } catch (err) {
      alert('Greška: ' + err.message)
    }
    setLoading(false)
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      // Parsiramo bez zone mape — zone dodajemo u sljedećem koraku
      const parsed = await parseXlsx(file, {})
      const withIds = parsed.map((t, i) => ({ ...t, _id: i }))

      // Skupi jedinstvene hotele iz Excela
      const uniqueHotelNames = [...new Set(
        withIds.map(t => t.hotel_name).filter(Boolean)
      )]

      // Matchuj svaki hotel s bazom
      const res = uniqueHotelNames.map(excelName => {
        const { hotel, confidence } = matchHotel(excelName, dbHotels)
        return {
          excelName,
          matchedHotel: hotel,       // hotel iz baze ili null
          confidence,                // 'exact' | 'fuzzy' | 'none'
          confirmed: confidence === 'exact' && hotel?.zone_id, // auto-confirm exact+zone
          selectedZoneId: hotel?.zone_id || '',
          selectedZoneName: hotel?.zones?.name || '',
        }
      })

      setResolutions(res)
      setTransfers(withIds)

      // Ako svi hoteli imaju zonu i su exact match → preskoči hotel korak
      const needsAttention = res.filter(r => !r.confirmed)
      if (needsAttention.length === 0) {
        applyZonesToTransfers(withIds, res)
      } else {
        setStep('hotels')
      }
    } catch (err) {
      alert('Greška pri parsiranju: ' + err.message)
    }
    setLoading(false)
    e.target.value = ''
  }

  // ── Auto-spoji iste rezervacije (isti reservation_id + isti type) ───
  function autoMergeSameReservations(list) {
    const groups = {}
    const order  = []
    for (const t of list) {
      const key = `${t.reservation_id}::${t.type}`
      if (!groups[key]) { groups[key] = []; order.push(key) }
      groups[key].push(t)
    }
    const result = []
    for (const key of order) {
      const parts = groups[key]
      if (parts.length === 1) {
        result.push(parts[0])
      } else {
        // Spoji u jedan red
        result.push({
          ...parts[0],
          _isCombined:    true,
          _combinedParts: parts,
          tourist:        parts.map(p => p.tourist).join('\n'),
          pax:  parts.reduce((s, p) => s + (p.pax  || 0), 0),
          adl:  parts.reduce((s, p) => s + (p.adl  || 0), 0),
          chd:  parts.reduce((s, p) => s + (p.chd  || 0), 0),
          inf:  parts.reduce((s, p) => s + (p.inf  || 0), 0),
        })
      }
    }
    return result
  }

  function splitCombinedTransfer(transfer) {
    setTransfers(prev => {
      const idx = prev.findIndex(t => t._id === transfer._id && t._isCombined)
      if (idx === -1) return prev
      return [
        ...prev.slice(0, idx),
        ...transfer._combinedParts,
        ...prev.slice(idx + 1),
      ]
    })
  }

  function applyZonesToTransfers(transfers, res) {
    // Napravi map: excelName → zoneName
    const zoneMap = {}
    for (const r of res) {
      if (r.selectedZoneName) zoneMap[r.excelName.toUpperCase()] = r.selectedZoneName
    }
    const updated = transfers.map(t => ({
      ...t,
      zone_name: zoneMap[t.hotel_name?.toUpperCase()] || null,
    }))
    setTransfers(autoMergeSameReservations(updated))
    setStep('working')
  }

  async function confirmHotels() {
    // Ručni insert/update jer unique index je na LOWER(name) — upsert ne radi
    for (const r of resolutions.filter(r => r.selectedZoneId)) {
      const hotelName = r.matchedHotel ? r.matchedHotel.name : r.excelName

      if (r.matchedHotel?.id) {
        // Hotel postoji u bazi — samo ažuriraj zonu
        await supabase.from('hotels')
          .update({ zone_id: r.selectedZoneId })
          .eq('id', r.matchedHotel.id)
      } else {
        // Novi hotel — inseruj (ignorišemo grešku ako već postoji)
        await supabase.from('hotels')
          .insert({ name: hotelName, zone_id: r.selectedZoneId })
      }
    }

    // Refresh baze hotela i idi dalje
    const { data: freshHotels } = await supabase.from('hotels').select('*, zones(name)')
    setDbHotels(freshHotels || [])
    applyZonesToTransfers(transfers, resolutions)
  }

  function setResolutionZone(idx, zoneId) {
    const zone = zones.find(z => z.id === zoneId)
    setResolutions(rs => rs.map((r, i) => i !== idx ? r : {
      ...r,
      selectedZoneId: zoneId,
      selectedZoneName: zone?.name || '',
      confirmed: true,
    }))
  }

  function setVehicleNeeded(idx, vn) {
    setTransfers(ts => ts.map((t, i) => i === idx ? { ...t, vehicle_needed: vn } : t))
  }

  function removeTransfer(idx) {
    setTransfers(ts => ts.filter((_, i) => i !== idx))
  }

  // ── Pickup edit u working tabeli ──────────────────────────────
  function shiftTimeDS(time, minutes) {
    if (!time) return null
    const [h, m] = time.split(':').map(Number)
    let total = h * 60 + m + minutes
    total = Math.max(0, Math.min(23 * 60 + 59, total))
    return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
  }

  function saveInlinePickup() {
    if (!inlinePickup) return
    const { id, val } = inlinePickup
    const newTime = val.trim() || null
    setTransfers(ts => ts.map(t => t._id === id ? { ...t, pickup_time: newTime } : t))
    setInlinePickup(null)
  }

  function shiftFlightDS(flightNumber, deltaMin) {
    setTransfers(ts => ts.map(t =>
      t.flight_number === flightNumber && t.pickup_time
        ? { ...t, pickup_time: shiftTimeDS(t.pickup_time, deltaMin) }
        : t
    ))
  }

  function generateSchedule() {
    const hotelMap = buildHotelMap(dbHotels)
    const result = runSchedule(transfers, vehicles, suppliers, prices, hotelMap, {}, vehBlocks)
    // Dodaj _uid svakom transferu za potrebe "razdvoji" operacije
    const withUid = result.map((t, i) => ({ ...t, _uid: t._uid || `uid_${i}_${Date.now()}` }))
    setScheduled(withUid)
    setStep('schedule')
  }

  // Razdvoji jednu konkretnu instancu (job._uid) od ostalih s istim reservation_id
  function separateTransfer(uid) {
    const suffix = '_X' + Math.random().toString(36).slice(2, 5).toUpperCase()
    setScheduled(prev => prev.map(t =>
      t._uid === uid ? { ...t, reservation_id: t.reservation_id + suffix } : t
    ))
  }

  function reassignTransfer(reservationId, newVehicleId) {
    const newVehicle = newVehicleId === '__external__'
      ? null
      : vehicles.find(v => v.id === newVehicleId) || null
    setScheduled(prev => prev.map(t =>
      t.reservation_id === reservationId
        ? { ...t, assignedVehicle: newVehicle, assignedSupplier: null }
        : t
    ))
  }

  function assignSupplier(reservationId, supplier) {
    setScheduled(prev => prev.map(t =>
      t.reservation_id === reservationId
        ? { ...t, assignedSupplier: supplier }
        : t
    ))
  }

  function toggleSelect(reservationId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(reservationId) ? next.delete(reservationId) : next.add(reservationId)
      return next
    })
  }

  function mergeSelected() {
    const parts = scheduled.filter(t => selectedIds.has(t.reservation_id))
    if (parts.length < 2) return

    // Validacija: moraju biti isti tip (arr/dep) i isti aerodrom
    const types   = new Set(parts.map(t => t.type))
    const airports = new Set(parts.map(t => t.airport))
    if (types.size > 1) { alert('Ne možeš spojiti dolazak i odlazak zajedno.'); return }
    if (airports.size > 1) { alert('Transferi moraju biti s istog aerodroma.'); return }

    // Pickup time — uzmi najraniji
    const pickupTimes = parts.map(t => t.pickup_time).filter(Boolean).sort()
    const primaryPickup = pickupTimes[0]

    // Vozilo — prednost daj vozilu s više kapaciteta ili prvom
    const vehicle = parts.find(t => t.assignedVehicle)?.assignedVehicle || null

    const totalPax = parts.reduce((s, t) => s + (t.pax || 1), 0)
    const mergedId = parts[0].reservation_id

    const merged = {
      ...parts[0],
      reservation_id: mergedId,
      pickup_time:    primaryPickup,
      pax:            totalPax,
      assignedVehicle: vehicle,
      assignedSupplier: null,
      _isMerged:      true,
      _mergedParts:   parts,
    }

    // Zamijeni sve selektovane sa jednim merged transferom
    setScheduled(prev => {
      const ids = new Set(parts.map(t => t.reservation_id))
      const without = prev.filter(t => !ids.has(t.reservation_id))
      return [...without, merged]
    })
    setSelectedIds(new Set())
  }

  function reshuffleExternal() {
    const unassigned = scheduled.filter(t => !t.assignedVehicle)
    if (unassigned.length === 0) return

    const hotelMap = buildHotelMap(dbHotels)

    // Za stanje flote koristi sve dodijeljene transfere (merged razvuci na dijelove)
    const assignedForFleet = scheduled
      .filter(t => t.assignedVehicle)
      .flatMap(t => t._isMerged
        ? t._mergedParts.map(p => ({ ...p, assignedVehicle: t.assignedVehicle }))
        : [t]
      )

    const fleetState = computeFleetState(assignedForFleet, vehicles, hotelMap)

    // Ponovo rasporedi samo neraspoređene, uz inicijalno stanje flote
    const result = runSchedule(unassigned, vehicles, suppliers, prices, hotelMap, fleetState, vehBlocks)

    setScheduled(prev => [
      ...prev.filter(t => t.assignedVehicle), // zadrži ručno dodijeljene
      ...result,                               // dodaj novo raspoređene
    ])
  }

  function unmergeTransfer(mergedReservationId) {
    setScheduled(prev => {
      const merged = prev.find(t => t.reservation_id === mergedReservationId && t._isMerged)
      if (!merged) return prev
      const without = prev.filter(t => t.reservation_id !== mergedReservationId)
      return [...without, ...merged._mergedParts]
    })
  }

  /**
   * Dohvati live status za sve letove u rasporedu (samo ARR).
   */
  async function fetchFlightStatusesForSchedule() {
    if (!import.meta.env.VITE_RAPIDAPI_KEY) {
      alert('Nedostaje VITE_RAPIDAPI_KEY u .env fajlu.')
      return
    }
    setFetchingFlight(true)
    // Jedan API poziv po aerodromu (TIV + TGD), lokalni fuzzy match
    const statuses = await getFlightStatusesByAirport(scheduled, date)
    setFlightStatuses(statuses)
    setFetchingFlight(false)
  }

  /**
   * Šalje Telegram poruke svim vozačima.
   * Za svaki transfer generiše PDF ugovor i šalje ga direktno vozaču.
   */
  async function sendTelegram() {
    setWaSending(true)
    setWaStatus('⏳ Priprema...')

    const token = import.meta.env.VITE_TELEGRAM_BOT_TOKEN
    if (!token) {
      setWaStatus('⚠ Nedostaje VITE_TELEGRAM_BOT_TOKEN u .env fajlu.')
      setWaSending(false)
      setTimeout(() => setWaStatus(''), 5000)
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
      // Grupiši transfere po vozilu (samo naša, ne eksterni)
      const byVehicle = {}
      for (const t of scheduled.filter(t => t.assignedVehicle)) {
        const vid = t.assignedVehicle.id
        if (!byVehicle[vid]) byVehicle[vid] = { vehicle: t.assignedVehicle, jobs: [] }
        byVehicle[vid].jobs.push(t)
      }

      let sent = 0, skipped = 0
      const dateFormatted = date.split('-').reverse().join('.')
      const vehEmoji = { car: '🚗', minivan: '🚐', vclass: '⭐' }

      for (const [vid, group] of Object.entries(byVehicle)) {
        // Pronađi vozača koji upravlja ovim vozilom
        const driver = drivers.find(d => d.vehicle_id === vid)
        if (!driver?.telegram_chat_id) {
          console.log(`Preskačem ${group.vehicle.name} — vozač nema telegram_chat_id`)
          skipped++
          continue
        }

        const chatId = driver.telegram_chat_id
        const vehicleFull = vehicles.find(v => v.id === vid) || group.vehicle
        const sortedJobs = [...group.jobs].sort((a, b) =>
          a.pickup_time?.localeCompare(b.pickup_time)
        )

        // 1. Tekst poruka s rasporedom (uključi flight status ako je dostupan)
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

          return `${t.pickup_time} ${t.type === 'arr' ? '🛬' : '🛫'} *${t.tourist}*\n  ${route}\n  ${t.pax} put · ${flightLine}`
        }).join('\n\n')

        const emoji = vehEmoji[vehicleFull.type] || '🚗'
        const text  = `${emoji} *Raspored za ${dateFormatted}* — ${vehicleFull.name}\n\n${lines}\n\n_Ugovori u prilogu._`

        setWaStatus(`⏳ Šaljem raspored za ${vehicleFull.name}...`)
        const msgResp = await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' })
        if (!msgResp.ok) {
          console.error('sendMessage greška:', msgResp)
          skipped++
          continue
        }

        // 2. PDF ugovor za svaki transfer
        for (const t of sortedJobs) {
          try {
            setWaStatus(`⏳ PDF: ${t.tourist}...`)
            const pdfBlob = await generateContractPDF(t, vehicleFull, date)
            const fileName = contractFileName(t, date)

            const form = new FormData()
            form.append('chat_id', chatId)
            form.append('document', pdfBlob, fileName)
            form.append('caption', `📄 ${t.tourist} · ${dateFormatted}`)

            const docResp = await tgForm('sendDocument', form)
            if (!docResp.ok) console.error('sendDocument greška:', docResp)
          } catch (err) {
            console.error('PDF greška za', t.tourist, err)
          }
        }

        sent++
      }

      if (sent === 0 && skipped > 0) {
        setWaStatus('⚠ Nijedan vozač nema unesen Telegram ID. Unesi chat_id u admin vozača.')
      } else {
        setWaStatus(`✅ Poslato: ${sent} vozač(a) · Preskočeno: ${skipped}`)
      }
    } catch (err) {
      setWaStatus(`❌ Greška: ${err.message}`)
    }

    setWaSending(false)
    setTimeout(() => setWaStatus(''), 8000)
  }

  // ── Vehicle timeline checker ──────────────────────────────────────
  function openVehicleTimeline() {
    const UNLOAD   = 5
    const EXIT_MIN = { TIV: 35, TGD: 45 }
    const AIRPORTS = new Set(['TIV', 'TGD'])

    function addMin(t, m) {
      if (!t || m == null) return '??:??'
      const [h, min] = t.split(':').map(Number)
      const tot = h * 60 + min + m
      return `${String(Math.floor(tot / 60)).padStart(2,'0')}:${String(tot % 60).padStart(2,'0')}`
    }
    function subMin(t, m) {
      if (!t || m == null) return '??:??'
      const [h, min] = t.split(':').map(Number)
      const tot = Math.max(0, h * 60 + min - m)
      return `${String(Math.floor(tot / 60)).padStart(2,'0')}:${String(tot % 60).padStart(2,'0')}`
    }
    function diffMin(t1, t2) {
      if (!t1 || !t2) return 0
      const [h1, m1] = t1.split(':').map(Number)
      const [h2, m2] = t2.split(':').map(Number)
      return (h2 * 60 + m2) - (h1 * 60 + m1)
    }

    // Zona za datu lokaciju (null za aerodrome)
    function getZone(loc) {
      if (!loc || AIRPORTS.has(loc.toUpperCase())) return null
      const h = dbHotels.find(x => x.name?.toLowerCase() === loc.toLowerCase())
      return h?.zones?.name || null
    }

    // Vožnja između bilo koje dvije tačke (aerodrom, hotel, zona)
    function drive(from, to) {
      return getDriveMinutes(from, to, getZone(from), getZone(to))
    }

    // Kratka oznaka za prikaz lokacije (zona umjesto imena hotela)
    function locLabel(loc) {
      if (!loc) return '—'
      if (AIRPORTS.has(loc.toUpperCase())) return loc
      return getZone(loc) || loc
    }

    // ── Gradi trip listu po vozilu ───────────────────────────────────
    const sections = ownGroups.filter(g => g.jobs.length > 0).map(({ vehicle, jobs }) => {
      const arrFlights = {}
      const depList = []

      for (const j of jobs) {
        if (j.type === 'arr') {
          const key = `${j.flight_number || '?'}__${j.flight_time || '?'}__${j.airport || 'TIV'}`
          if (!arrFlights[key]) arrFlights[key] = { fn: j.flight_number, ft: j.flight_time, ap: j.airport || 'TIV', jobs: [] }
          arrFlights[key].jobs.push(j)
        } else {
          depList.push(j)
        }
      }

      const trips = []

      for (const fg of Object.values(arrFlights)) {
        const exitTime = addMin(fg.ft, EXIT_MIN[fg.ap] ?? 35)

        // Svi hotelski stopovi, sortirani po udaljenosti od aerodroma (bliži prvi)
        const rawStops = fg.jobs.flatMap(j => {
          const parts = j._isMerged ? j._mergedParts : [j]
          return parts.map(p => ({
            hotel:   p.hotel_name,
            tourist: p.tourist,
            pax:     p.pax || 1,
            dt:      drive(fg.ap, p.hotel_name),
          }))
        }).filter(s => s.hotel)
        rawStops.sort((a, b) => (a.dt ?? 999) - (b.dt ?? 999))

        let cur = exitTime, prevDt = 0
        const stops = rawStops.map(s => {
          const dt  = s.dt ?? 30
          const inc = prevDt === 0 ? dt : Math.max(3, dt - prevDt)
          const arr = addMin(cur, inc)
          const dep = addMin(arr, UNLOAD)
          cur = dep; prevDt = dt
          return { ...s, arr, dep, inc }
        })

        const lastStop = stops[stops.length - 1]
        // endLoc = posljednji hotel (vozilo OSTAJE tamo, ne vraća se na aerodrom)
        trips.push({
          kind: 'arr', fn: fg.fn, ft: fg.ft, ap: fg.ap,
          exitTime, stops,
          endTime: lastStop?.dep ?? exitTime,
          endLoc:  lastStop?.hotel ?? fg.ap,
          sortKey: fg.ft || '00:00',
        })
      }

      for (const j of depList) {
        const dt    = drive(j.hotel_name, j.airport)
        const arrAt = addMin(j.pickup_time, dt)
        trips.push({
          kind: 'dep', fn: j.flight_number, ft: j.flight_time, ap: j.airport || 'TIV',
          pickupTime: j.pickup_time, hotel: j.hotel_name,
          tourist: j.tourist, pax: j.pax, dt,
          endTime: arrAt, endLoc: j.airport || 'TIV',
          sortKey: j.pickup_time || '00:00',
        })
      }

      trips.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      return { vehicle, trips }
    })

    // ── HTML generacija ──────────────────────────────────────────────
    const dateStr = date.split('-').reverse().join('.')

    // ev s od-do tajmingom: endTime=null za tačke bez trajanja
    const ev = (time, endTime, dot, content) => {
      const tHtml = endTime && endTime !== time
        ? `${time}<br><span class="tend">${endTime}</span>`
        : time
      return `<div class="ev"><span class="t">${tHtml}</span><span class="dot ${dot}"></span><span class="i">${content}</span></div>`
    }

    function tripHTML(trip, nextTrip) {
      const lines = []

      if (trip.kind === 'arr') {
        lines.push(ev(trip.ft || '—', trip.exitTime, 'lnd', `✈️ Let <b>${trip.fn || '—'}</b> slijeće · ${trip.ap}`))
        const firstStopArr = trip.stops[0]?.arr ?? null
        lines.push(ev(trip.exitTime, firstStopArr, 'exit', `🚶 Putnici izlaze s aerodroma <small>(${EXIT_MIN[trip.ap] ?? 35} min)</small>`))
        for (let si = 0; si < trip.stops.length; si++) {
          const s = trip.stops[si]
          lines.push(ev(s.arr, s.dep, 'hotel', `🏨 <b>${s.hotel}</b> <small>(+${s.inc} min vožnje)</small><div class="sub">${s.tourist} · ${s.pax} pax · iskrcavanje ${UNLOAD} min</div>`))
        }
      } else {
        lines.push(ev(trip.pickupTime || '—', trip.endTime, 'pkp', `🏨 Pickup: <b>${trip.hotel || '—'}</b><div class="sub">${trip.tourist} · ${trip.pax} pax</div>`))
        lines.push(ev(trip.endTime, null, 'apdot', `✈️ Aerodrom <b>${trip.ap}</b> <small>· Let ${trip.fn || '—'} polijeće ${trip.ft || '—'}</small>`))
      }

      // ── Bridge do sljedećeg posla ──────────────────────────────────
      if (nextTrip) {
        // Gdje treba biti za sljedeći posao i kad
        const nextPickupLoc  = nextTrip.kind === 'arr' ? nextTrip.ap : nextTrip.hotel
        const needAtNextBy   = nextTrip.kind === 'arr' ? nextTrip.ft : nextTrip.pickupTime

        const driveDur   = drive(trip.endLoc, nextPickupLoc)
        const mustLeave  = subMin(needAtNextBy, driveDur)
        const freeMin    = diffMin(trip.endTime, mustLeave)

        if (freeMin > 0) {
          lines.push(ev(trip.endTime, mustLeave, 'freedot',
            `⏱ Slobodan <b>${freeMin} min</b> · ${locLabel(trip.endLoc)}`))
        } else if (freeMin < 0) {
          lines.push(`<div class="conflict">⚠️ Konflikt! Nedostaje <b>${Math.abs(freeMin)} min</b> za pravovremeni dolazak na sljedeći posao</div>`)
        }

        const leaveTime = freeMin > 0 ? mustLeave : trip.endTime
        const arrNext   = addMin(leaveTime, driveDur)
        lines.push(ev(leaveTime, arrNext, 'drivedot',
          `🚗 Vožnja: <b>${locLabel(trip.endLoc)} → ${locLabel(nextPickupLoc)}</b> <small>(${driveDur} min)</small>`))

        // Ako stigne na aerodrom prije slijetanja — prikaži čekanje
        if (nextTrip.kind === 'arr' && arrNext < nextTrip.ft) {
          const waitMin = diffMin(arrNext, nextTrip.ft)
          if (waitMin > 0) {
            lines.push(ev(arrNext, nextTrip.ft, 'wait',
              `⏳ Čeka na aerodromu <b>${nextTrip.ap}</b> <small>(${waitMin} min do slijetanja)</small>`))
          }
        }

      } else {
        // Zadnji posao — prikaži završnu lokaciju
        lines.push(ev(trip.endTime, null, 'freedot', `📍 Slobodan · <b>${locLabel(trip.endLoc)}</b>`))
      }

      const typeLabel = trip.kind === 'arr' ? 'DOLAZAK' : 'ODLAZAK'
      return `
<div class="trip ${trip.kind}">
  <div class="trip-hdr">
    <span class="badge fn">${trip.fn || '—'}</span>
    <span class="badge ap">${trip.ap}</span>
    <span class="trip-time">${trip.kind === 'arr' ? 'Slijetanje' : 'Polijetanje'} ${trip.ft || '—'}</span>
    <span class="type-badge ${trip.kind}">${typeLabel}</span>
  </div>
  <div class="tl">${lines.join('\n')}</div>
</div>`
    }

    const vehHTML = sections.map(({ vehicle, trips }) => {
      const icon = vehicle.type === 'vclass' ? '⭐' : vehicle.type === 'minivan' ? '🚐' : '🚗'
      const inner = trips.length
        ? trips.map((t, i) => tripHTML(t, trips[i + 1] ?? null)).join('')
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

    const html = `<!DOCTYPE html>
<html lang="hr">
<head><meta charset="UTF-8"><title>Raspored vozila · ${dateStr}</title>
<style>${css}</style></head>
<body>
<h1>Raspored vozila<span class="date">${dateStr}</span></h1>
${vehHTML || '<p style="color:#999">Nema raspoređenih vozila.</p>'}
</body></html>`

    const win = window.open('', '_blank')
    if (!win) { alert('Dozvoli pop-up prozore za ovu stranicu.'); return }
    win.document.write(html)
    win.document.close()
    win.focus()
  }

  async function saveSchedule() {
    setSaveMsg('Čuvanje...')

    const { count } = await supabase
      .from('transfers')
      .select('*', { count: 'exact', head: true })
      .eq('transfer_date', date)

    if (count > 0) {
      const ok = window.confirm(
        `Za datum ${date} već postoji ${count} sačuvanih transfera.\n\n` +
        `Želiš li ih zamijeniti novim rasporedom?\n` +
        `(Stari transferi će biti obrisani.)`
      )
      if (!ok) { setSaveMsg(''); return }

      const { error: delErr } = await supabase
        .from('transfers').delete().eq('transfer_date', date)
      if (delErr) {
        setSaveMsg('❌ Greška pri brisanju: ' + delErr.message)
        setTimeout(() => setSaveMsg(''), 4000)
        return
      }
    }

    // Unikalizacija reservation_id-a:
    //   - isti rid + ARR i DEP isti dan   → 12345_arr, 12345_dep
    //   - isti rid + dva DEP (dva aviona) → 12345_dep1, 12345_dep2
    //   - jedinstven rid                  → 12345 (nepromijenjeno)
    const comboCount = {}   // koliko puta se pojavio svaki (rid::type)
    const ridTypes   = {}   // koje tipove ima svaki rid
    for (const t of scheduled) {
      const k = `${t.reservation_id}::${t.type}`
      comboCount[k] = (comboCount[k] || 0) + 1
      if (!ridTypes[t.reservation_id]) ridTypes[t.reservation_id] = new Set()
      ridTypes[t.reservation_id].add(t.type)
    }
    const comboIndex = {}   // brojač za dodjelu sufiksa po kombu

    const rows = scheduled.map(t => {
      const k = `${t.reservation_id}::${t.type}`
      comboIndex[k] = (comboIndex[k] || 0) + 1

      let rid = t.reservation_id
      if (comboCount[k] > 1) {
        // Isti tip više puta (npr. dva DEP iste rezervacije) → dodaj redni broj
        rid = `${t.reservation_id}_${t.type}${comboIndex[k]}`
      } else if (ridTypes[t.reservation_id].size > 1) {
        // ARR + DEP iste rezervacije isti dan → razlikuj tipom
        rid = `${t.reservation_id}_${t.type}`
      }
      // else: jedinstven rid, bez sufiksa

      // Za merged transfere: sačuvaj sve putnike u napomeni
      const mergeNote = t._isMerged
        ? `[ZAJEDNO: ${t._mergedParts.map(p => `${p.tourist} (${p.pax}pax, res:${p.reservation_id})`).join(' + ')}]`
        : null

      return {
        transfer_date:       date,
        reservation_id:      rid,
        tourist:             t._isMerged
          ? t._mergedParts.map(p => p.tourist).join(' + ')
          : t.tourist,
        pax:                 t.pax,
        adl:                 t.adl,
        chd:                 t.chd,
        inf:                 t.inf || 0,
        hotel_name:          t.hotel_name,
        zone_id:             null,
        flight_number:       t.flight_number,
        flight_time:         t.flight_time || null,
        type:                t.type,
        airport:             t.airport,
        pickup_time:         t.pickup_time || null,
        vehicle_needed:      t.vehicle_needed,
        assigned_vehicle_id: t.assignedVehicle?.id || null,
        supplier_id:         t.assignedSupplier?.id || null,
        supplier_price:      t.assignedSupplier?.price || null,
        note:                mergeNote || t.note,
        transfer_type_raw:   t.transfer_type_raw,
        status:              'pending',
      }
    })

    const { error } = await supabase.from('transfers').insert(rows)
    setSaveMsg(error ? '❌ Greška: ' + error.message : '✅ Sačuvano!')
    setTimeout(() => setSaveMsg(''), 3000)
  }

  // Dolasci sortiramo po flight_time (slijetanje), odlasci po pickup_time (polazak iz hotela)
  const arrivalTransfers = transfers.filter(t => t.type === 'arr').sort((a,b) => (a.flight_time || '').localeCompare(b.flight_time || ''))
  const departTransfers  = transfers.filter(t => t.type === 'dep').sort((a,b) => (a.pickup_time || '').localeCompare(b.pickup_time || ''))
  const groups    = groupByVehicle(scheduled, vehicles)
  const extGroup  = groups.find(g => g.vehicle.type === 'external')
  const ownGroups = groups.filter(g => g.vehicle.type !== 'external')

  // Detektuj rezervacije koje imaju više od jednog transfera istog tipa (arr/dep).
  // Ovo pokriva: isti rid u različitim vozilima, u external listi, i neraspoređene.
  // (arr+dep na istom rid-u je normalno i NE flagujemo kao split.)
  const splitReservations = (() => {
    const ridTypeCounts = {}
    for (const t of scheduled) {
      const key = `${t.reservation_id}::${t.type}`
      ridTypeCounts[key] = (ridTypeCounts[key] || 0) + 1
    }
    return new Set(
      Object.entries(ridTypeCounts)
        .filter(([, count]) => count > 1)
        .map(([key]) => key.split('::')[0])
    )
  })()

  const needsAttention = resolutions.filter(r => !r.confirmed)
  const canProceed     = needsAttention.every(r => r.selectedZoneId)

  const STEP_LABELS = ['Import', `Hoteli (${resolutions.length})`, `Radna tabla (${transfers.length})`, 'Raspored']
  const STEP_KEYS   = ['import', 'hotels', 'working', 'schedule']

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900">Dnevni raspored</h1>
          <input
            type="date" value={date}
            onClick={e => e.target.showPicker?.()}
            onChange={e => { setDate(e.target.value); setStep('import'); setTransfers([]) }}
            className="input w-40 cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-2">
          {step !== 'import' && (
            <button onClick={() => { setStep('import'); setTransfers([]) }} className="btn-ghost">← Novi import</button>
          )}
          {step === 'hotels' && (
            <button onClick={confirmHotels} disabled={!canProceed} className="btn-primary">
              {canProceed ? 'Potvrdi hotele →' : `Dodijeli zone (${needsAttention.filter(r=>!r.selectedZoneId).length} preostalo)`}
            </button>
          )}
          {step === 'working' && transfers.length > 0 && (
            <button onClick={generateSchedule} className="btn-primary">Generiši raspored →</button>
          )}
          {step === 'schedule' && (
            <>
              <button onClick={() => setStep('working')} className="btn-ghost">← Radna tabla</button>

              {/* Merge controls */}
              {selectedIds.size >= 2 && (
                <button onClick={mergeSelected}
                  className="px-3 py-1.5 rounded text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
                  🔗 Spoji {selectedIds.size} transfera
                </button>
              )}
              {selectedIds.size === 1 && (
                <span className="text-sm text-gray-400 italic">Odaberi još jedan za spajanje</span>
              )}

              {/* Reshuffle — prikaži samo ako ima neraspoređenih */}
              {scheduled.some(t => !t.assignedVehicle) && selectedIds.size === 0 && (
                <button
                  onClick={reshuffleExternal}
                  className="px-3 py-1.5 rounded text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                  title="Zadrži ručne izmjene, a neraspoređene transfere ponovo rasporedi"
                >
                  🔄 Preraspodijeli slobodne ({scheduled.filter(t => !t.assignedVehicle).length})
                </button>
              )}

              {canSave && (
                <button onClick={saveSchedule} className="btn-primary">💾 Sačuvaj u bazu</button>
              )}
              {saveMsg && <span className="text-sm font-medium">{saveMsg}</span>}

              {/* Flight status check */}
              {scheduled.some(t => t.type === 'arr') && (
                <button
                  onClick={fetchFlightStatusesForSchedule}
                  disabled={fetchingFlight}
                  className="px-3 py-1.5 rounded text-sm font-medium bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 transition-colors"
                  title="Provjeri stvarno vrijeme slijetanja sa AeroDataBox"
                >
                  {fetchingFlight ? '⏳ Provjera...' : '🛩️ Provjeri letove'}
                </button>
              )}

              <button
                onClick={openVehicleTimeline}
                className="px-3 py-1.5 rounded text-sm font-medium bg-violet-500 text-white hover:bg-violet-600 transition-colors"
                title="Provjeri raspored i tajminge svih vozila"
              >
                🕐 Raspored vozila
              </button>

              <button
                onClick={sendTelegram}
                disabled={waSending}
                className="px-3 py-1.5 rounded text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {waSending ? '⏳ Slanje...' : '✈️ Pošalji Telegram'}
              </button>
              {waStatus && <span className="text-sm font-medium">{waStatus}</span>}
            </>
          )}
        </div>
      </div>

      {/* Step tabs */}
      <div className="flex gap-1 mb-6">
        {STEP_KEYS.map((s, i) => (
          <div key={s} className={`flex items-center gap-2 px-4 py-1.5 rounded text-sm ${
            step === s ? 'bg-brand-500 text-white font-medium' : 'text-gray-500'
          }`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
              step === s ? 'bg-white text-brand-500' : 'bg-gray-200 text-gray-500'
            }`}>{i + 1}</span>
            {STEP_LABELS[i]}
          </div>
        ))}
      </div>

      {/* ── STEP 1: IMPORT ── */}
      {step === 'import' && (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-6">🚐</div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Učitaj transfere</h2>
          <p className="text-sm text-gray-400 mb-8">Odaberi izvor podataka za dnevni raspored</p>

          {/* Primarni izvor: Rooming Lista */}
          <div className="mb-4">
            <button
              onClick={loadFromRoomingList}
              disabled={loading}
              className="btn-primary px-8 py-3 text-base w-64"
            >
              {loading ? 'Učitavanje...' : '📋 Učitaj iz Rooming Liste'}
            </button>
            <p className="text-xs text-gray-400 mt-2">IND transferi za {date} — vozilo iz rooming liste</p>
          </div>

          {/* Alternativa: Excel */}
          <div className="border-t pt-6 mt-6">
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide">ili uvezi iz Excel fajla</p>
            <input ref={fileRef} type="file" accept=".xlsx" onChange={handleFile} className="hidden" />
            <button
              onClick={() => fileRef.current.click()}
              disabled={loading}
              className="btn-ghost px-6 py-2 text-sm border border-gray-200 rounded"
            >
              {loading ? 'Parsiranje...' : '📂 Odaberi .xlsx fajl'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: HOTEL RESOLUTION ── */}
      {step === 'hotels' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <strong>Provjera hotela</strong> — Provjeri da li su hoteli iz Excela ispravno prepoznati i dodijeli zone onima koji je nemaju.
            Svaka dodijeljena zona se pamti za sljedeći import.
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="th">Hotel iz Excela</th>
                  <th className="th">Prepoznat kao</th>
                  <th className="th">Zona</th>
                  <th className="th text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {resolutions.map((r, i) => (
                  <tr key={i} className={r.confirmed ? 'bg-green-50' : 'bg-yellow-50'}>
                    {/* Excel naziv */}
                    <td className="td font-mono text-xs font-medium">{r.excelName}</td>

                    {/* Prepoznat kao */}
                    <td className="td">
                      {r.confidence === 'exact' && (
                        <span className="text-green-700 font-medium">{r.matchedHotel.name}</span>
                      )}
                      {r.confidence === 'fuzzy' && (
                        <span className="text-yellow-700">
                          ≈ {r.matchedHotel.name}
                          <span className="text-xs text-gray-400 ml-1">(sličan naziv)</span>
                        </span>
                      )}
                      {r.confidence === 'none' && (
                        <span className="text-gray-400 italic text-xs">Novi hotel — nije u bazi</span>
                      )}
                    </td>

                    {/* Zona selector */}
                    <td className="td">
                      {r.confirmed && r.confidence === 'exact' && r.matchedHotel?.zones ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                          {r.matchedHotel.zones.name}
                        </span>
                      ) : (
                        <select
                          className="input py-1 text-sm"
                          value={r.selectedZoneId || ''}
                          onChange={e => setResolutionZone(i, e.target.value)}
                        >
                          <option value="">— Odaberi zonu —</option>
                          {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                        </select>
                      )}
                    </td>

                    {/* Status */}
                    <td className="td text-center">
                      {r.confirmed ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 font-medium">✓ OK</span>
                      ) : r.selectedZoneId ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 font-medium">Zona odabrana</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700 font-medium">⚠ Potrebna zona</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="text-sm text-gray-500">
            {resolutions.filter(r => r.confirmed).length} / {resolutions.length} hotela potvrđeno.
            {needsAttention.length > 0 && (
              <span className="text-orange-600 ml-2">
                {needsAttention.filter(r => !r.selectedZoneId).length} hotela čeka dodjelu zone.
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 3: WORKING TABLE ── */}
      {step === 'working' && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { l: 'Ukupno',  v: transfers.length,                                        c: 'text-gray-900'   },
              { l: 'Dolasci', v: arrivalTransfers.length,                                 c: 'text-green-600'  },
              { l: 'Odlasci', v: departTransfers.length,                                  c: 'text-blue-600'   },
              { l: 'V Class', v: transfers.filter(t=>t.vehicle_needed==='vclass').length, c: 'text-purple-600' },
            ].map(s => (
              <div key={s.l} className="card p-3 text-center">
                <div className={`text-2xl font-bold ${s.c}`}>{s.v}</div>
                <div className="text-xs text-gray-500">{s.l}</div>
              </div>
            ))}
          </div>
          {arrivalTransfers.length > 0 && (
            <Section title="🛬 Dolasci" transfers={arrivalTransfers} allTransfers={transfers}
              transferType="arr"
              onVehicle={setVehicleNeeded} onRemove={removeTransfer}
              onSplitCombined={splitCombinedTransfer}
              inlinePickup={inlinePickup} setInlinePickup={setInlinePickup}
              saveInlinePickup={saveInlinePickup} onShiftFlight={shiftFlightDS} />
          )}
          {departTransfers.length > 0 && (
            <Section title="🛫 Odlasci" transfers={departTransfers} allTransfers={transfers}
              transferType="dep"
              onVehicle={setVehicleNeeded} onRemove={removeTransfer}
              onSplitCombined={splitCombinedTransfer}
              inlinePickup={inlinePickup} setInlinePickup={setInlinePickup}
              saveInlinePickup={saveInlinePickup} onShiftFlight={shiftFlightDS} />
          )}
        </div>
      )}

      {/* ── STEP 4: SCHEDULE ── */}
      {step === 'schedule' && (
        <div className="space-y-4">
          {ownGroups.map(g => (
            <VehicleCard
              key={g.vehicle.id || g.vehicle.name}
              group={g}
              allVehicles={vehicles}
              onReassign={reassignTransfer}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onUnmerge={unmergeTransfer}
              onSeparate={separateTransfer}
              splitReservations={splitReservations}
              flightStatuses={flightStatuses}
            />
          ))}
          {extGroup && extGroup.jobs.length > 0 && (
            <VehicleCard
              group={extGroup}
              isExternal
              allVehicles={vehicles}
              suppliers={suppliers}
              onReassign={reassignTransfer}
              onAssignSupplier={assignSupplier}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onUnmerge={unmergeTransfer}
              onSeparate={separateTransfer}
              splitReservations={splitReservations}
              flightStatuses={flightStatuses}
            />
          )}
          {groups.length === 0 && (
            <div className="card p-8 text-center text-gray-400">Nema raspoređenih transfera</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Working table section ─────────────────────────────────────────
function Section({ title, transfers, allTransfers, onVehicle, onRemove, onSplitCombined,
                   transferType, inlinePickup, setInlinePickup, saveInlinePickup, onShiftFlight }) {

  const isDep = transferType === 'dep'

  // Bulk shift dugmići po letu — samo za odlaske
  const flightGroups = isDep
    ? [...new Set(transfers.map(t => t.flight_number).filter(Boolean))]
    : []

  // Za dolaske prikazujemo flight_time (slijetanje), za odlaske pickup_time
  const getDisplayTime = (t) => isDep ? t.pickup_time : t.flight_time

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <h2 className="font-semibold text-gray-700">{title}</h2>
        {/* Bulk shift dugmići po letu — samo za odlaske */}
        {flightGroups.map(fn => (
          <div key={fn} className="flex items-center gap-0.5 bg-gray-100 rounded px-2 py-0.5">
            <span className="text-[10px] font-mono font-bold text-gray-600 mr-1">{fn}:</span>
            {[-15,-10,-5,5,10,15].map(m => (
              <button key={m} onClick={() => onShiftFlight(fn, m)}
                className="text-[9px] font-mono px-1 py-px rounded bg-gray-200 hover:bg-sky-200 hover:text-sky-800 text-gray-700 transition-colors"
                title={`Pomjeri sve pickup-e za ${fn} za ${m > 0 ? '+' : ''}${m} min`}>
                {m > 0 ? '+' : ''}{m}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="th">{isDep ? 'Pickup' : 'Slijetanje'}</th>
              <th className="th">Gost</th>
              <th className="th">Hotel</th>
              <th className="th">Zona</th>
              <th className="th">Let</th>
              <th className="th">PAX</th>
              <th className="th">Vozilo</th>
              <th className="th">Napomena</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {transfers.map((t) => {
              const idx = allTransfers.findIndex(x => x._id === t._id)
              const isCombined = !!t._isCombined
              return (
                <tr key={t._id} className={isCombined ? 'bg-violet-50 hover:bg-violet-100' : 'hover:bg-gray-50'}>
                  <td className="td">
                    {isDep && inlinePickup?.id === t._id ? (
                      <input
                        autoFocus
                        type="text"
                        placeholder="HH:MM"
                        value={inlinePickup.val}
                        onChange={e => setInlinePickup(p => ({ ...p, val: e.target.value }))}
                        onBlur={saveInlinePickup}
                        onKeyDown={e => { if (e.key === 'Enter') saveInlinePickup(); if (e.key === 'Escape') setInlinePickup(null) }}
                        className="w-16 text-center font-mono text-xs border border-sky-400 rounded px-1 py-0.5 outline-none ring-1 ring-sky-300"
                      />
                    ) : isDep ? (
                      <span
                        onClick={() => setInlinePickup({ id: t._id, val: t.pickup_time || '' })}
                        title="Klikni za izmjenu pickup vremena"
                        className="font-mono font-medium cursor-pointer px-1 py-0.5 rounded hover:bg-yellow-50 hover:text-yellow-700 transition-colors text-red-600"
                      >
                        {t.pickup_time || <span className="text-gray-300">—</span>}
                      </span>
                    ) : (
                      <span className="font-mono font-medium text-green-700">
                        {t.flight_time || <span className="text-gray-300">—</span>}
                      </span>
                    )}
                  </td>
                  <td className="td">
                    {isCombined ? (
                      <div>
                        {t._combinedParts.map((p, i) => (
                          <div key={p._id || i} className="font-medium text-violet-800 leading-snug">{p.tourist}</div>
                        ))}
                        <div className="text-xs text-violet-400 mt-0.5">{t.reservation_id} · spojeno {t._combinedParts.length}×</div>
                      </div>
                    ) : (
                      <div>
                        <div className="font-medium">{t.tourist}</div>
                        <div className="text-xs text-gray-400">{t.reservation_id}</div>
                      </div>
                    )}
                  </td>
                  <td className="td">{t.hotel_name || '—'}</td>
                  <td className="td">
                    {t.zone_name
                      ? <span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">{t.zone_name}</span>
                      : <span className="text-orange-500 text-xs">⚠ bez zone</span>
                    }
                  </td>
                  <td className="td">
                    <div className="font-mono text-xs">{t.flight_number}</div>
                    <div className="text-xs text-gray-400">{t.flight_time}</div>
                  </td>
                  <td className="td text-center">{t.pax}</td>
                  <td className="td">
                    <div className="flex gap-1 flex-wrap">
                      {['car','minivan','vclass'].map(vt => (
                        <button
                          key={vt}
                          onClick={() => onVehicle(idx, vt)}
                          className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                            t.vehicle_needed === vt
                              ? vt === 'car'     ? 'bg-blue-500 text-white border-blue-500'
                              : vt === 'minivan' ? 'bg-green-500 text-white border-green-500'
                              :                    'bg-purple-500 text-white border-purple-500'
                              : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {VEH_LBL[vt]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="td max-w-xs">
                    <div className="text-xs text-gray-500 truncate" title={t.note}>{t.note || '—'}</div>
                  </td>
                  <td className="td">
                    <div className="flex flex-col gap-1 items-start">
                      {isCombined && (
                        <button
                          onClick={() => onSplitCombined(t)}
                          title="Razdvoji u zasebne redove"
                          className="text-xs text-violet-600 hover:text-violet-800 font-medium whitespace-nowrap"
                        >
                          ✂ Razdvoji
                        </button>
                      )}
                      <button onClick={() => onRemove(idx)} className="text-gray-300 hover:text-red-500 text-lg leading-none">&times;</button>
                    </div>
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

// ── Vehicle card ──────────────────────────────────────────────────
function FlightBadge({ flightNumber, type, flightStatuses }) {
  if (type !== 'arr' || !flightNumber) return <span className="text-xs font-mono text-gray-400">{flightNumber || '—'}</span>

  const key     = normalizeFlight(flightNumber)
  const checked = flightStatuses && key in flightStatuses
  const fs      = flightStatuses?.[key]

  let badge = null
  if (checked && !fs) {
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
      <span className="text-xs font-mono text-gray-400">{flightNumber}</span>
      {badge}
    </span>
  )
}

function SupplierPicker({ transfer: t, suppliers, onAssign, open, onToggle }) {
  const [price, setPrice] = useState(t.assignedSupplier?.price?.toString() || '')
  const [selected, setSelected] = useState(t.assignedSupplier || null)

  // Sync local state when transfer changes from outside
  useEffect(() => {
    setSelected(t.assignedSupplier || null)
    setPrice(t.assignedSupplier?.price?.toString() || '')
  }, [t.assignedSupplier])

  function confirmAssign() {
    if (!selected) return
    onAssign({ ...selected, price: price ? parseFloat(price) : null })
    onToggle()
  }

  return (
    <div className="relative mt-0.5">
      <button
        onClick={onToggle}
        className={`text-xs px-2 py-0.5 rounded border transition-colors ${
          t.assignedSupplier
            ? 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100'
            : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
        }`}
      >
        {t.assignedSupplier
          ? `🤝 ${t.assignedSupplier.name}${t.assignedSupplier.price ? ` · ${t.assignedSupplier.price}€` : ''}`
          : '⚠ Dodaj suplaera'}
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-30 bg-white border border-gray-200 rounded-lg shadow-xl w-56">
          <div className="px-3 py-2 text-xs text-gray-500 font-medium border-b bg-gray-50 rounded-t-lg">Izaberi suplaera</div>
          <div className="py-1">
            {suppliers.length === 0
              ? <div className="px-3 py-2 text-xs text-gray-400">Nema aktivnih suplaera</div>
              : suppliers.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSelected({ id: s.id, name: s.name }); setPrice('') }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-orange-50 flex items-center gap-2 ${
                    selected?.id === s.id ? 'bg-orange-50 font-medium text-orange-700' : 'text-gray-700'
                  }`}
                >
                  {selected?.id === s.id ? '✓' : '○'} {s.name}
                </button>
              ))
            }
          </div>
          {selected && (
            <div className="px-3 py-2 border-t bg-gray-50">
              <label className="block text-xs text-gray-500 mb-1">Cijena (€) — opciono</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && confirmAssign()}
                  className="border border-gray-200 rounded px-2 py-1 text-sm w-20 focus:outline-none focus:ring-1 focus:ring-orange-300"
                />
                <button
                  onClick={confirmAssign}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded px-3 py-1 font-medium"
                >
                  Potvrdi
                </button>
              </div>
            </div>
          )}
          {t.assignedSupplier && (
            <div className="px-3 py-1.5 border-t">
              <button
                onClick={() => { onAssign(null); onToggle() }}
                className="text-xs text-gray-400 hover:text-red-500 w-full text-left"
              >
                ✕ Ukloni suplaera
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function VehicleCard({ group, isExternal, allVehicles = [], suppliers = [], onReassign, onAssignSupplier, selectedIds = new Set(), onToggleSelect, onUnmerge, onSeparate, splitReservations = new Set(), flightStatuses = {} }) {
  const { vehicle, jobs } = group
  const [openMenu, setOpenMenu] = useState(null)
  const [openSupplierMenu, setOpenSupplierMenu] = useState(null)

  const headerColor = isExternal
    ? 'bg-orange-50 border-orange-200'
    : vehicle.type === 'vclass'  ? 'bg-purple-50 border-purple-200'
    : vehicle.type === 'minivan' ? 'bg-green-50  border-green-200'
    :                              'bg-blue-50   border-blue-200'

  function handleReassign(reservationId, newVehicleId) {
    onReassign?.(reservationId, newVehicleId)
    setOpenMenu(null)
  }

  return (
    <div className={`card border ${headerColor}`}>
      <div className={`px-4 py-2 border-b ${headerColor} flex items-center gap-2 font-semibold`}>
        {isExternal ? '🤝' : vehicle.type === 'vclass' ? '⭐' : vehicle.type === 'minivan' ? '🚐' : '🚗'}
        {vehicle.name}
        <span className="text-xs font-normal text-gray-500">({jobs.length} transfer{jobs.length !== 1 ? 'a' : ''})</span>
      </div>
      <div className="divide-y">
        {[...jobs].sort((a,b) => a.pickup_time?.localeCompare(b.pickup_time)).map((t, i) => {
          const isSelected = selectedIds.has(t.reservation_id)
          const isMerged   = t._isMerged
          const isSplit    = splitReservations.has(t.reservation_id)

          return (
            <div
              key={i}
              className={`px-4 py-3 flex items-start gap-3 group transition-colors ${
                isSelected ? 'bg-indigo-50'
                : isSplit   ? 'bg-rose-50 border-l-2 border-rose-300'
                : isMerged  ? 'bg-blue-50/40'
                : ''
              }`}
            >
              {/* Checkbox za merge */}
              {onToggleSelect && !isMerged && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(t.reservation_id)}
                  className="mt-1 flex-shrink-0 w-4 h-4 accent-indigo-500 cursor-pointer"
                />
              )}
              {isMerged && (
                <div className="mt-1 flex-shrink-0 w-4 h-4 flex items-center justify-center text-blue-500 text-xs">🔗</div>
              )}

              {/* Pickup time + type */}
              <div className="text-center flex-shrink-0 w-16">
                <div className="font-mono text-sm font-bold">{t.pickup_time}</div>
                <div className={`text-xs mt-0.5 ${t.type === 'arr' ? 'text-green-600' : 'text-blue-600'}`}>
                  {t.type === 'arr' ? '🛬 arr' : '🛫 dep'}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                {isMerged ? (
                  // Merged transfer — prikaži sve putnike
                  <div>
                    {t._mergedParts.map((part, pi) => (
                      <div key={pi} className={`${pi > 0 ? 'mt-2 pt-2 border-t border-blue-100' : ''}`}>
                        <div className="font-medium text-sm flex items-center gap-1">
                          {pi > 0 && <span className="text-blue-400 text-xs font-bold">+</span>}
                          {part.tourist}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                          {part.flight_number && <span className="font-mono font-semibold text-gray-700">{part.flight_number}</span>}
                          {part.flight_time && (
                            <span className={`font-mono font-bold ${part.type === 'arr' ? 'text-green-600' : 'text-orange-500'}`}>
                              {part.flight_time}
                            </span>
                          )}
                          {(part.flight_number || part.flight_time) && <span className="text-gray-300">·</span>}
                          <span>{part.type === 'arr' ? `${part.airport} → ${part.hotel_name}` : `${part.hotel_name} → ${part.airport}`}</span>
                          {part.zone_name && <span className="px-1 py-0.5 rounded bg-gray-100">{part.zone_name}</span>}
                          <span className="text-gray-400">{part.pax} pax</span>
                        </div>
                        {part.note && <div className="text-xs text-gray-400 truncate">{part.note}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  // Normalan transfer
                  <>
                    <div className="font-medium text-sm">{t.tourist}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                      {/* Let + vrijeme */}
                      {t.flight_number && (
                        <span className="font-mono font-semibold text-gray-700">{t.flight_number}</span>
                      )}
                      {t.flight_time && (
                        <span className={`font-mono font-bold ${t.type === 'arr' ? 'text-green-600' : 'text-orange-500'}`}>
                          {t.flight_time}
                        </span>
                      )}
                      {(t.flight_number || t.flight_time) && <span className="text-gray-300">·</span>}
                      {/* Ruta */}
                      <span>
                        {t.type === 'arr' ? `${t.airport} → ${t.hotel_name}` : `${t.hotel_name} → ${t.airport}`}
                      </span>
                      {t.zone_name && <span className="px-1.5 py-0.5 rounded bg-gray-100">{t.zone_name}</span>}
                    </div>
                    {t.note && <div className="text-xs text-gray-400 mt-0.5 truncate">{t.note}</div>}
                  </>
                )}
              </div>

              {/* Right side */}
              <div className="flex-shrink-0 flex items-start gap-2">
                <div className="text-right">
                  <div className={`text-xs font-medium ${isMerged ? 'text-blue-600' : isSplit ? 'text-rose-600' : 'text-gray-500'}`}>
                    {t.pax} pax
                    {isMerged && <span className="font-normal text-blue-400"> (spojeno)</span>}
                    {isSplit  && <span className="font-bold text-rose-500"> ⚠ razdvojeno</span>}
                  </div>
                  {!isMerged && (
                    <FlightBadge
                      flightNumber={t.flight_number}
                      type={t.type}
                      flightStatuses={flightStatuses}
                    />
                  )}
                  {isExternal && (
                    <SupplierPicker
                      transfer={t}
                      suppliers={suppliers}
                      onAssign={(sup) => onAssignSupplier?.(t.reservation_id, sup)}
                      open={openSupplierMenu === t.reservation_id}
                      onToggle={() => setOpenSupplierMenu(openSupplierMenu === t.reservation_id ? null : t.reservation_id)}
                    />
                  )}
                </div>

                {/* Akcije: Premjesti + Rastavi */}
                <div className="flex flex-col gap-1">

                  {/* Split rezervacija — Spoji ovdje / Napravi nezavisnim */}
                  {isSplit && !isMerged && (
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => onReassign(t.reservation_id, vehicle.id)}
                        className="px-2 py-1 rounded text-xs border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 whitespace-nowrap font-medium"
                        title="Premjesti sve instance ove rezervacije u ovo vozilo"
                      >
                        🔗 Spoji ovdje
                      </button>
                      <button
                        onClick={() => onSeparate?.(t._uid)}
                        className="px-2 py-1 rounded text-xs border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 whitespace-nowrap"
                        title="Odvoji ovaj transfer kao nezavisan (dobi vlastiti ID)"
                      >
                        ✂ Napravi nez.
                      </button>
                    </div>
                  )}

                  {/* Rastavi (samo za merged) */}
                  {isMerged && onUnmerge && (
                    <button
                      onClick={() => onUnmerge(t.reservation_id)}
                      className="px-2 py-1 rounded text-xs border border-blue-300 bg-white hover:bg-blue-50 text-blue-600 whitespace-nowrap"
                      title="Rastavi spojene transfere"
                    >
                      ✂ Rastavi
                    </button>
                  )}

                  {/* Premjesti */}
                  {onReassign && (
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenu(openMenu === t.reservation_id ? null : t.reservation_id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded text-xs border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 whitespace-nowrap"
                      >
                        ↔ Premjesti
                      </button>
                      {openMenu === t.reservation_id && (
                        <div className="absolute right-0 top-7 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                          <div className="px-3 py-1 text-xs text-gray-400 font-medium border-b">Premjesti u:</div>
                          {allVehicles.map(v => (
                            <button
                              key={v.id}
                              onClick={() => handleReassign(t.reservation_id, v.id)}
                              disabled={t.assignedVehicle?.id === v.id}
                              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                                t.assignedVehicle?.id === v.id ? 'text-gray-300 cursor-default' : 'text-gray-700'
                              }`}
                            >
                              {v.type === 'vclass' ? '⭐' : v.type === 'minivan' ? '🚐' : '🚗'} {v.name}
                              {t.assignedVehicle?.id === v.id && <span className="text-xs text-gray-300 ml-auto">trenutno</span>}
                            </button>
                          ))}
                          <div className="border-t mt-1">
                            <button
                              onClick={() => handleReassign(t.reservation_id, '__external__')}
                              disabled={isExternal && !isMerged}
                              className="w-full text-left px-3 py-1.5 text-sm hover:bg-orange-50 text-orange-600 flex items-center gap-2"
                            >
                              🤝 Eksterni
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function tomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}
