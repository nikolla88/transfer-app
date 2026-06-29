import { getDriveMinutes } from './driveTime'
import { timeToMin, minToTime } from './xlsxParser'

// Minuta od slijetanja do izlaska putnika iz aerodroma (prtljag + pasoški)
const ARRIVAL_PASSENGER_READY = 40

// Vozilo može stići na aerodrom ovdje minuta NAKON slijetanja i dalje biti na vrijeme
// (jer putnici nisu odmah vani — ovaj broj mora biti < ARRIVAL_PASSENGER_READY)
const ARRIVAL_VEHICLE_GRACE = 25

// Buffer za ukrcaj/iskrcaj na svakom transferu
const TRANSFER_BUFFER = 5

/**
 * Greedy scheduling — prioritet: vclass → minivan → car
 * Unutar grupe: sortiramo po pickup_time
 * Za car zahtjeve: preferuj car vozila (čuvaj minivan/vclass)
 * Za minivan zahtjeve: preferuj minivan nad vclass
 */
/**
 * Izračunaj stanje flote (freeAt, location) na osnovu već dodijeljenih transfera.
 * Koristi se za "reraspored" — vozila koja već imaju posao kreću od svog zadnjeg stanja.
 */
export function computeFleetState(assignedTransfers, vehicles, hotelZoneMap) {
  const state = {}

  for (const v of vehicles) {
    const jobs = assignedTransfers
      .filter(t => t.assignedVehicle?.id === v.id)
      .sort((a, b) => timeToMin(a.pickup_time) - timeToMin(b.pickup_time))

    if (jobs.length === 0) {
      state[v.id] = { freeAt: 0, location: 'TIV' }
      continue
    }

    let freeAt = 0
    let location = 'TIV'

    for (const t of jobs) {
      const zone      = t.zone_name || hotelZoneMap?.[t.hotel_name?.toUpperCase()] || null
      const pickupLoc = t.type === 'arr' ? t.airport    : t.hotel_name
      const dropLoc   = t.type === 'arr' ? t.hotel_name : t.airport
      const pickup    = timeToMin(t.pickup_time)
      const drive     = getDriveMinutes(pickupLoc, dropLoc, null, zone)
      // Za dolazak: pickup_time = slijetanje, putnici gotovi tek za ARRIVAL_BUFFER_MIN
      // arr: landing + izlaz putnika + vožnja do hotela + iskrcaj
      // dep: pickup_time + vožnja do aerodroma + buffer
      const passengerReady = t.type === 'arr' ? ARRIVAL_PASSENGER_READY : 0
      freeAt   = pickup + passengerReady + drive + TRANSFER_BUFFER
      location = dropLoc
    }

    state[v.id] = { freeAt, location }
  }

  return state
}

/**
 * Provjeri je li vozilo blokirano za vremenski prozor transfera [pickupMin, finishMin].
 * Blokada se primjenjuje ako se BILO KOJI DIO transfera preklapa s blokadom.
 * blocks: [{ vehicle_id, time_from, time_to }]
 * time_from/time_to null = cijeli dan
 */
function isBlocked(vehicleId, pickupMin, finishMin, blocks) {
  for (const b of blocks) {
    if (b.vehicle_id !== vehicleId) continue
    if (!b.time_from && !b.time_to) return true  // cijeli dan
    const from = b.time_from ? timeToMin(b.time_from.slice(0, 5)) : 0
    const to   = b.time_to   ? timeToMin(b.time_to.slice(0, 5))   : 1440
    // Preklapanje intervala: [pickupMin, finishMin] ∩ [from, to] ≠ ∅
    if (pickupMin < to && finishMin > from) return true
  }
  return false
}

export function runSchedule(transfers, vehicles, suppliers, prices, hotelZoneMap, initialFleetState = {}, vehicleBlocks = []) {
  const priorityOf = vn => vn === 'vclass' ? 0 : vn === 'minivan' ? 1 : 2

  const sorted = [...transfers].sort((a, b) => {
    const pd = priorityOf(a.vehicle_needed) - priorityOf(b.vehicle_needed)
    if (pd !== 0) return pd
    return timeToMin(a.pickup_time) - timeToMin(b.pickup_time)
  })

  const fleet = vehicles
    .filter(v => v.active !== false)
    .map(v => ({
      id:       v.id,
      name:     v.name,
      type:     v.type,
      freeAt:   initialFleetState[v.id]?.freeAt   ?? 0,
      location: initialFleetState[v.id]?.location ?? 'TIV',
      jobs:     [],
    }))

  const result = sorted.map(t => {
    const pickup = timeToMin(t.pickup_time)
    if (pickup < 0) return { ...t, assignedVehicle: null, assignedSupplier: null }

    const zone = t.zone_name || hotelZoneMap?.[t.hotel_name?.toUpperCase()] || null
    const pickupLoc = t.type === 'arr' ? t.airport    : t.hotel_name
    const dropLoc   = t.type === 'arr' ? t.hotel_name : t.airport

    // Procijenjeno završno vrijeme transfera (pickup → drop)
    const driveToDrop    = getDriveMinutes(pickupLoc, dropLoc, null, zone)
    const passengerReady = t.type === 'arr' ? ARRIVAL_PASSENGER_READY : 0
    const finishMin      = pickup + passengerReady + driveToDrop + TRANSFER_BUFFER

    // Eligibilnost po tipu zahtjeva + provjera blokade (cijeli vremenski prozor)
    function eligible(v) {
      if (isBlocked(v.id, pickup, finishMin, vehicleBlocks)) return false
      if (t.vehicle_needed === 'vclass')  return v.type === 'vclass'
      if (t.vehicle_needed === 'minivan') return v.type === 'minivan' || v.type === 'vclass'
      return true // car: sva vozila
    }

    // Penalizacija za praznu vožnju do pickupa
    function deadheadPenalty(v) {
      const drive = getDriveMinutes(v.location || 'TIV', pickupLoc, null, zone)
      if (drive === 0)  return 0
      if (drive <= 15)  return 2
      if (drive <= 35)  return 5
      if (drive <= 60)  return 10
      return 18
    }

    // Manji score = bolji kandidat
    function score(v) {
      let base = 0
      if (t.vehicle_needed === 'car') {
        if (v.type === 'car')          base = 0
        else if (v.type === 'minivan') base = 10
        else if (v.type === 'vclass')  base = 20
      } else if (t.vehicle_needed === 'minivan') {
        if (v.type === 'minivan')      base = 0
        else if (v.type === 'vclass')  base = 10
      }
      return base + deadheadPenalty(v)
    }

    const candidates = fleet
      .filter(eligible)
      .sort((a, b) => score(a) - score(b) || a.freeAt - b.freeAt)

    const deadline = t.type === 'arr'
      ? pickup + ARRIVAL_VEHICLE_GRACE
      : pickup - TRANSFER_BUFFER

    for (const v of candidates) {
      const driveToPickup   = getDriveMinutes(v.location, pickupLoc, null, zone)
      const arrivalAtPickup = v.freeAt + driveToPickup
      const canMakeIt = v.freeAt === 0 || arrivalAtPickup <= deadline

      if (canMakeIt) {
        const driveToDrop    = getDriveMinutes(pickupLoc, dropLoc, null, zone)
        const passengerReady = t.type === 'arr' ? ARRIVAL_PASSENGER_READY : 0
        const finishAt       = pickup + passengerReady + driveToDrop + TRANSFER_BUFFER

        v.freeAt   = finishAt
        v.location = dropLoc
        v.jobs.push(t.reservation_id || t.tourist)

        return { ...t, assignedVehicle: v, assignedSupplier: null, zone_name: zone }
      }
    }

    const supplier = findCheapestSupplier(zone, t.vehicle_needed, t.airport, suppliers, prices)
    return { ...t, assignedVehicle: null, assignedSupplier: supplier, zone_name: zone }
  })

  // Post-processing optimizacije (redosljed je bitan):
  // 1. Swap: eksterni dolasci ↔ dodijeljeni polasci (već postojeće)
  // 2. Chain absorption: ubaci eksterne u raspored već dodijeljenih vozila
  // 3. Reassign-to-unlock: premjesti auto-klase da otključa kapacitet
  // 4. Još jedan krug chain absorption (reassign je možda otvorio nove prilike)
  let r = postProcessSwap(result, initialFleetState, suppliers, prices)
  r = postProcessChainAbsorption(r, initialFleetState, vehicleBlocks)
  r = postProcessReassignToUnlock(r, initialFleetState, vehicleBlocks)
  r = postProcessChainAbsorption(r, initialFleetState, vehicleBlocks)
  return r
}

/**
 * Post-processing optimizacija: pokušaj smanjiti broj eksternih DOLAZAKA
 * tako što zamijeni neku dodijeljenu ODLAZNU vožnju sa eksternim dolaskom.
 *
 * Problem koji rješava:
 *   Greedy algoritam nije vidio naprijed — dodijelio je vozilo odlaznoj vožnji
 *   koja završava prekasno za deadline dolaska. Ako tu odlaznu vožnju prebacimo
 *   u eksterno, vozilo bi stiglo na aerodrom za dolazak na vrijeme.
 *
 * Logika:
 *   Za svaki eksterni dolazak T_ext:
 *     Za svaku dodijeljenu odlaznu vožnju T_swap (najkasnije pickup prvo):
 *       - Simuliraj stanje vozila BEZ T_swap
 *       - Može li vozilo stići na aerodrom za T_ext deadline?
 *       - Da li naknadne vožnje vozila i dalje rade?
 *       → Ako da: prebaci T_swap u eksterno, T_ext vozilu
 */
function postProcessSwap(result, initialFleetState, suppliers, prices) {
  const externalArrivals = result.filter(t => !t.assignedVehicle && t.type === 'arr')
  console.log('[swap] eksterni dolasci:', externalArrivals.map(t => t.tourist))
  if (externalArrivals.length === 0) return result

  let current = [...result]

  for (const T_ext of externalArrivals) {
    const extPickup     = timeToMin(T_ext.pickup_time)
    const extDeadline   = extPickup + ARRIVAL_VEHICLE_GRACE
    const extPickupLoc  = T_ext.airport
    const extDropLoc    = T_ext.hotel_name
    const extZone       = T_ext.zone_name
    const extDriveToDrop = getDriveMinutes(extPickupLoc, extDropLoc, null, extZone)

    // Kandidirane odlazne vožnje: samo one čiji pickup je ≤ deadline T_ext
    // (sortiramo najkasnije prvo — vjerovatno je to "bloker")
    const swapCandidates = current
      .filter(t => t.assignedVehicle && t.type === 'dep')
      .filter(t => timeToMin(t.pickup_time) <= extDeadline)
      .sort((a, b) => timeToMin(b.pickup_time) - timeToMin(a.pickup_time))

    for (const T_swap of swapCandidates) {
      const v = T_swap.assignedVehicle

      // Sve vožnje ovog vozila, bez T_swap
      const vJobsWithout = current
        .filter(t => t.assignedVehicle?.id === v.id && t !== T_swap)
        .sort((a, b) => timeToMin(a.pickup_time) - timeToMin(b.pickup_time))

      // Simuliraj stanje vozila poslije svih vožnji koje završe PRIJE extDeadline (bez T_swap)
      let simFreeAt   = initialFleetState[v.id]?.freeAt   ?? 0
      let simLocation = initialFleetState[v.id]?.location ?? 'TIV'

      for (const job of vJobsWithout) {
        if (timeToMin(job.pickup_time) >= extDeadline) break
        const jZone      = job.zone_name
        const jPickupLoc = job.type === 'arr' ? job.airport    : job.hotel_name
        const jDropLoc   = job.type === 'arr' ? job.hotel_name : job.airport
        const jPickup    = timeToMin(job.pickup_time)
        const jDrive     = getDriveMinutes(jPickupLoc, jDropLoc, null, jZone)
        const jReady     = job.type === 'arr' ? ARRIVAL_PASSENGER_READY : 0
        simFreeAt   = jPickup + jReady + jDrive + TRANSFER_BUFFER
        simLocation = jDropLoc
      }

      // Može li vozilo stići na aerodrom za T_ext?
      const driveToExt = getDriveMinutes(simLocation, extPickupLoc, null, extZone)
      if (simFreeAt !== 0 && simFreeAt + driveToExt > extDeadline) continue

      // Simuliraj vozilo koje uzima T_ext, pa nastavlja sa kasnijim vožnjama
      const extFinishAt  = extPickup + ARRIVAL_PASSENGER_READY + extDriveToDrop + TRANSFER_BUFFER
      const extFinishLoc = extDropLoc

      const jobsAfter = vJobsWithout
        .filter(j => timeToMin(j.pickup_time) >= extDeadline)
        .sort((a, b) => timeToMin(a.pickup_time) - timeToMin(b.pickup_time))

      let afterFreeAt   = extFinishAt
      let afterLocation = extFinishLoc
      let subsequentOk  = true

      for (const job of jobsAfter) {
        const jZone      = job.zone_name
        const jPickupLoc = job.type === 'arr' ? job.airport    : job.hotel_name
        const jDropLoc   = job.type === 'arr' ? job.hotel_name : job.airport
        const jPickup    = timeToMin(job.pickup_time)
        const jDeadline  = job.type === 'arr'
          ? jPickup + ARRIVAL_VEHICLE_GRACE
          : jPickup - TRANSFER_BUFFER
        const driveToJ = getDriveMinutes(afterLocation, jPickupLoc, null, jZone)

        if (afterFreeAt + driveToJ > jDeadline) { subsequentOk = false; break }

        const jDrive  = getDriveMinutes(jPickupLoc, jDropLoc, null, jZone)
        const jReady  = job.type === 'arr' ? ARRIVAL_PASSENGER_READY : 0
        afterFreeAt   = jPickup + jReady + jDrive + TRANSFER_BUFFER
        afterLocation = jDropLoc
      }

      if (!subsequentOk) continue

      // Provjeri kompatibilnost tipa vozila sa zahtjevom T_ext
      if (!canVehicleTake(v.type, T_ext.vehicle_needed)) continue

      // Zamjena je moguća — T_swap ide u eksterno, T_ext dobija vozilo
      const swapSupplier = findCheapestSupplier(
        T_swap.zone_name, T_swap.vehicle_needed, T_swap.airport, suppliers, prices
      )
      const vehicleRef = { ...v }  // referenca na vozilo
      current = current.map(t => {
        if (t === T_ext)  return { ...t, assignedVehicle: vehicleRef, assignedSupplier: null }
        if (t === T_swap) return { ...t, assignedVehicle: null, assignedSupplier: swapSupplier }
        return t
      })
      break // pronašli zamjenu za T_ext, idemo na sljedeći eksterni dolazak
    }
  }

  return current
}

// ─── Helpers za chain optimizacije ───────────────────────────────────────────

function canVehicleTake(vehicleType, needed) {
  if (needed === 'vclass')  return vehicleType === 'vclass'
  if (needed === 'minivan') return vehicleType === 'minivan' || vehicleType === 'vclass'
  return true // car: sva vozila
}

function getUniqueVehicles(current) {
  const seen = new Set()
  const list = []
  for (const t of current) {
    if (t.assignedVehicle && !seen.has(t.assignedVehicle.id)) {
      seen.add(t.assignedVehicle.id)
      list.push(t.assignedVehicle)
    }
  }
  return list
}

function getVehicleJobs(current, vehicleId) {
  return current
    .filter(t => t.assignedVehicle?.id === vehicleId)
    .sort((a, b) => timeToMin(a.pickup_time) - timeToMin(b.pickup_time))
}

/**
 * Simulira vozilo kroz sve poslove (uključujući T ubačen na odgovarajuće mjesto).
 * Vraća true ako svi deadlines mogu biti ispunjeni.
 */
function canInsert(T, vJobs, initState) {
  const allJobs = [...vJobs, T].sort((a, b) => timeToMin(a.pickup_time) - timeToMin(b.pickup_time))
  return scheduleStillWorks(allJobs, initState)
}

/**
 * Simulira vozilo kroz datu listu poslova. Vraća true ako su svi deadlines ok.
 */
function scheduleStillWorks(jobs, initState) {
  let freeAt   = initState?.freeAt   ?? 0
  let location = initState?.location ?? 'TIV'

  for (const job of [...jobs].sort((a, b) => timeToMin(a.pickup_time) - timeToMin(b.pickup_time))) {
    const jPickup    = timeToMin(job.pickup_time)
    const jPickupLoc = job.type === 'arr' ? job.airport    : job.hotel_name
    const jDropLoc   = job.type === 'arr' ? job.hotel_name : job.airport
    const jDrive     = getDriveMinutes(jPickupLoc, jDropLoc, null, job.zone_name)
    const jReady     = job.type === 'arr' ? ARRIVAL_PASSENGER_READY : 0
    const jDeadline  = job.type === 'arr'
      ? jPickup + ARRIVAL_VEHICLE_GRACE
      : jPickup - TRANSFER_BUFFER

    if (freeAt > 0) {
      const driveToPickup = getDriveMinutes(location, jPickupLoc, null, job.zone_name)
      if (freeAt + driveToPickup > jDeadline) return false
    }

    freeAt   = jPickup + jReady + jDrive + TRANSFER_BUFFER
    location = jDropLoc
  }

  return true
}

/**
 * Chain absorption: pokušaj ubaciti externe transfere u rasporede već dodijeljenih vozila.
 *
 * Problem koji rješava:
 *   Greedy dodijeli Vito samo SARKYTBAYEV (arr TGD). Ali Vito ide ka TGD
 *   pa može usput pokupiti NAIDENOVA (dep Petrovac→TGD) i VLASOVU (dep Budva→TIV).
 *
 * Logika: za svaki eksterni transfer T, proba ga ubaciti u raspored svakog dodijeljenog
 * vozila koristeći simulaciju — ako sve timing constraints prolaze, dodijeli T vozilu.
 */
function postProcessChainAbsorption(result, initialFleetState, vehicleBlocks) {
  let current = [...result]
  let madeChange = true

  while (madeChange) {
    madeChange = false

    const externals = current
      .filter(t => !t.assignedVehicle)
      .sort((a, b) => timeToMin(a.pickup_time) - timeToMin(b.pickup_time))

    outer:
    for (const T of externals) {
      const tPickup    = timeToMin(T.pickup_time)
      const tPickupLoc = T.type === 'arr' ? T.airport    : T.hotel_name
      const tDropLoc   = T.type === 'arr' ? T.hotel_name : T.airport
      const tDrive     = getDriveMinutes(tPickupLoc, tDropLoc, null, T.zone_name)
      const tReady     = T.type === 'arr' ? ARRIVAL_PASSENGER_READY : 0
      const tFinish    = tPickup + tReady + tDrive + TRANSFER_BUFFER

      for (const v of getUniqueVehicles(current)) {
        if (!canVehicleTake(v.type, T.vehicle_needed)) continue
        if (isBlocked(v.id, tPickup, tFinish, vehicleBlocks)) continue

        const vJobs = getVehicleJobs(current, v.id)
        if (canInsert(T, vJobs, initialFleetState[v.id])) {
          current = current.map(t => t === T
            ? { ...t, assignedVehicle: v, assignedSupplier: null }
            : t
          )
          console.log(`[chain] ${T.tourist} → ${v.name}`)
          madeChange = true
          break outer
        }
      }
    }
  }

  return current
}

/**
 * Reassign-to-unlock: premjesti auto-klase transfer T sa V1 na V2,
 * ako to oslobodi V1 da preuzme barem jedan eksterni transfer.
 *
 * Problem koji rješava:
 *   VLASOVA je na Passatu 2. Ako je premjestimo na Vito (koji ima slobodan slot),
 *   Passat 2 može preuzeti KONYAKHINU (eksternu). Neto: –1 eksterni.
 *
 * Logika:
 *   Za svaki dodijeljeni auto-klase transfer T (V1):
 *     Za svako drugo vozilo V2:
 *       – Može li V2 primiti T bez kršenja deadlinea?
 *       – Ostaju li V1-ovi preostali poslovi izvodljivi?
 *       – Može li V1 (bez T) preuzeti barem jedan eksterni?
 *       → Ako sve Da: uradi premještaj + upis eksternog.
 */
function postProcessReassignToUnlock(result, initialFleetState, vehicleBlocks) {
  let current = [...result]
  let madeChange = true

  while (madeChange) {
    madeChange = false

    // Kandidati za premještanje: auto-klase transferi dodijeljeni vozilima
    const candidates = current
      .filter(t => t.assignedVehicle && t.vehicle_needed === 'car')
      .sort((a, b) => timeToMin(a.pickup_time) - timeToMin(b.pickup_time))

    outer:
    for (const T of candidates) {
      const v1     = T.assignedVehicle
      const v1Jobs = getVehicleJobs(current, v1.id).filter(j => j !== T)

      // Provjeri ostaju li V1 ostali poslovi izvodljivi bez T
      if (!scheduleStillWorks(v1Jobs, initialFleetState[v1.id])) continue

      const tPickup    = timeToMin(T.pickup_time)
      const tPickupLoc = T.type === 'arr' ? T.airport    : T.hotel_name
      const tDropLoc   = T.type === 'arr' ? T.hotel_name : T.airport
      const tDrive     = getDriveMinutes(tPickupLoc, tDropLoc, null, T.zone_name)
      const tReady     = T.type === 'arr' ? ARRIVAL_PASSENGER_READY : 0
      const tFinish    = tPickup + tReady + tDrive + TRANSFER_BUFFER

      for (const v2 of getUniqueVehicles(current)) {
        if (v2.id === v1.id) continue
        if (!canVehicleTake(v2.type, T.vehicle_needed)) continue
        if (isBlocked(v2.id, tPickup, tFinish, vehicleBlocks)) continue

        const v2Jobs = getVehicleJobs(current, v2.id)
        if (!canInsert(T, v2Jobs, initialFleetState[v2.id])) continue

        // Privremeno premjesti T na V2 — provjeri može li V1 sad preuzeti eksterni
        const tempCurrent = current.map(t => t === T ? { ...t, assignedVehicle: v2 } : t)
        const externals   = tempCurrent.filter(t => !t.assignedVehicle)

        for (const ext of externals.sort((a, b) => timeToMin(a.pickup_time) - timeToMin(b.pickup_time))) {
          if (!canVehicleTake(v1.type, ext.vehicle_needed)) continue

          const ePickup    = timeToMin(ext.pickup_time)
          const ePickupLoc = ext.type === 'arr' ? ext.airport    : ext.hotel_name
          const eDropLoc   = ext.type === 'arr' ? ext.hotel_name : ext.airport
          const eDrive     = getDriveMinutes(ePickupLoc, eDropLoc, null, ext.zone_name)
          const eReady     = ext.type === 'arr' ? ARRIVAL_PASSENGER_READY : 0
          const eFinish    = ePickup + eReady + eDrive + TRANSFER_BUFFER
          if (isBlocked(v1.id, ePickup, eFinish, vehicleBlocks)) continue

          const v1JobsNew = getVehicleJobs(tempCurrent, v1.id)
          if (canInsert(ext, v1JobsNew, initialFleetState[v1.id])) {
            // Zamjena je isplativa — uradi je
            console.log(`[reassign] ${T.tourist}: ${v1.name} → ${v2.name} | ${ext.tourist} → ${v1.name}`)
            current = tempCurrent.map(t => t === ext
              ? { ...t, assignedVehicle: v1, assignedSupplier: null }
              : t
            )
            madeChange = true
            break outer
          }
        }
      }
    }
  }

  return current
}

// ─────────────────────────────────────────────────────────────────────────────

function findCheapestSupplier(zone, vehicleType, airport, suppliers, prices) {
  if (!zone) return null
  const apt = airport || 'TIV'
  // Traži cijenu specifičnu za aerodrom; ako nema, uzmi bez aerodroma (stari podaci)
  const relevant = prices.filter(p =>
    p.zones?.name === zone &&
    p.vehicle_type === vehicleType &&
    (p.airport === apt || !p.airport)
  )
  if (!relevant.length) return null
  // Preferiraj cijene sa tačnim aerodromom
  const withApt    = relevant.filter(p => p.airport === apt)
  const candidates = withApt.length ? withApt : relevant
  const cheapest   = candidates.reduce((best, p) => p.price < best.price ? p : best)
  const sup        = suppliers.find(s => s.id === cheapest.supplier_id)
  return sup ? { ...sup, price: cheapest.price } : null
}

export function groupByVehicle(scheduled, vehicles) {
  const byVehicle = {}
  for (const v of vehicles) {
    byVehicle[v.id] = { vehicle: v, jobs: [] }
  }
  byVehicle['__external__'] = { vehicle: { name: 'Eksterni', type: 'external' }, jobs: [] }

  for (const t of scheduled) {
    if (t.assignedVehicle) {
      const vid = t.assignedVehicle.id
      if (!byVehicle[vid]) byVehicle[vid] = { vehicle: t.assignedVehicle, jobs: [] }
      byVehicle[vid].jobs.push(t)
    } else {
      byVehicle['__external__'].jobs.push(t)
    }
  }

  return Object.values(byVehicle).filter(g => g.jobs.length > 0)
}
