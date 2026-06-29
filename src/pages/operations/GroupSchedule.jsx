import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { normalize, getDayName, findScheduleForDay, fmtTime, calcPickupTime } from '../../lib/transferUtils'

// Cjenovnik se učitava iz baze (bus_prices tabela); ovdje je fallback za slučaj greške
const PRICES_FALLBACK = {
  sprinter: {
    TIV: { budva: { OW: 115, RT: 170 }, petrovac: { OW: 145, RT: 210 }, bar: { OW: 175, RT: 250 } },
    TGD: { budva: { OW: 170, RT: 230 }, petrovac: { OW: 175, RT: 220 }, bar: { OW: 180, RT: 245 } },
  },
  midi: {
    TIV: { budva: { OW: 165, RT: 215 }, petrovac: { OW: 190, RT: 265 }, bar: { OW: 250, RT: 365 } },
    TGD: { budva: { OW: 285, RT: 360 }, petrovac: { OW: 255, RT: 350 }, bar: { OW: 295, RT: 380 } },
  },
  bus: {
    TIV: { budva: { OW: 190, RT: 260 }, petrovac: { OW: 230, RT: 320 }, bar: { OW: 290, RT: 430 } },
    TGD: { budva: { OW: 340, RT: 400 }, petrovac: { OW: 320, RT: 390 }, bar: { OW: 360, RT: 420 } },
  },
}

// Pretvori DB redove u istu strukturu kao PRICES
function buildPriceMap(rows) {
  const map = {}
  for (const r of rows) {
    if (!map[r.bus_type]) map[r.bus_type] = {}
    if (!map[r.bus_type][r.airport]) map[r.bus_type][r.airport] = {}
    map[r.bus_type][r.airport][r.zone_bucket] = { OW: Number(r.price_ow), RT: Number(r.price_rt) }
  }
  return map
}

const BUS_LABELS = { sprinter: 'Sprinter (≤19)', midi: 'Midi bus (≤35)', bus: 'Veliki bus (≤57)' }
const BUS_CAPS   = { sprinter: 19, midi: 35, bus: 57 }
const BUCKET_RANK = { budva: 0, petrovac: 1, bar: 2 }

const BUCKET_LABEL = { budva: 'Budva/Bečići', petrovac: 'Petrovac', bar: 'Bar/Sutomore' }

function zoneToBucket(zoneName) {
  if (!zoneName) return 'budva'
  const n = zoneName.toLowerCase()
  if (n.includes('petrovac')) return 'petrovac'
  if (n.includes('bar') || n.includes('sutomore')) return 'bar'
  return 'budva'
}

// Najskuplja zona grupe — određuje cijenu busa
function maxBucketOf(records) {
  let best = 'budva'
  for (const r of records) {
    if (r._bucket && BUCKET_RANK[r._bucket] > BUCKET_RANK[best]) best = r._bucket
  }
  return best
}

function busTypeOf(pax) {
  if (pax <= 19) return 'sprinter'
  if (pax <= 35) return 'midi'
  return 'bus'
}

// Razbij ukupan broj putnika na autobuse (pohlepno: punimo od većeg)
function splitBuses(pax) {
  const buses = []
  let rem = pax
  while (rem > 0) {
    if (rem > 35)      { buses.push('bus');      rem -= 57 }
    else if (rem > 19) { buses.push('midi');     rem -= 35 }
    else               { buses.push('sprinter'); rem -= 19 }
    if (rem < 0) rem = 0
  }
  return buses
}

function getPrice(priceMap, bt, airport, bucket, owrt) {
  return priceMap[bt]?.[airport]?.[bucket]?.[owrt]
      ?? PRICES_FALLBACK[bt]?.[airport]?.[bucket]?.[owrt]
      ?? 0
}

function sumPax(records) {
  return records.reduce((s, r) => s + r._pax, 0)
}

// Aggregiraj hotele iz liste zapisa → [{name, pax, pickupPoint, pickupTime}]
function aggregateHotels(records, isArr) {
  const sorted = [...records].sort((a, b) => {
    if (!isArr) {
      const pa = a._pickupTime || '99:99'
      const pb = b._pickupTime || '99:99'
      if (pa !== pb) return pa.localeCompare(pb)
      return (a._hotelCode ?? 9999) - (b._hotelCode ?? 9999)
    }
    return (a._hotelCode ?? 9999) - (b._hotelCode ?? 9999)
  })
  const agg = {}
  const order = []
  for (const r of sorted) {
    const key = r.hotel_name
    if (!agg[key]) {
      agg[key] = { name: r.hotel_name, pax: 0, pickupPoint: r._pickupPoint, pickupTime: r._pickupTime }
      order.push(key)
    }
    agg[key].pax += r._pax
  }
  return order.map(k => agg[k])
}

// Podijeli listu hotela na N dijelova proporcionalno pax-u (za multi-bus)
function distributeHotels(hotels, busList) {
  if (busList.length === 1) return [hotels]
  const total = hotels.reduce((s, h) => s + h.pax, 0)
  const caps  = busList.map(bt => BUS_CAPS[bt])
  const result = busList.map(() => [])
  let busIdx = 0
  let busUsed = 0
  for (const h of hotels) {
    result[busIdx].push(h)
    busUsed += h.pax
    if (busUsed >= caps[busIdx] && busIdx < busList.length - 1) {
      busIdx++
      busUsed = 0
    }
  }
  return result
}

function tomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10)
}
function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

// ── Nalog generation ─────────────────────────────────────────────────
function generateNalozi(arrRecords, depRecords, hotelMap, flightNormMap, date, priceMap) {
  const gp = (bt, apt, bkt, owrt) => getPrice(priceMap, bt, apt, bkt, owrt)
  const dayName = getDayName(date)

  function enrich(r, isArr) {
    const flightName = isArr ? r.arr_flight_name : r.dep_flight_name
    const match      = flightNormMap[normalize(flightName)]
    const direction  = isArr ? 'ARR' : 'DEP'
    const sched      = findScheduleForDay(match?.[direction] || [], dayName)
    const hotel      = hotelMap[r.hotel_name]
    const bucket     = zoneToBucket(hotel?.zones?.name)
    const airport    = sched?.airport || 'TIV'
    return {
      ...r,
      _flightNorm:  normalize(flightName),
      _flightName:  match?.canonical || flightName || '—',
      _flightTime:  sched?.scheduled_time || null,
      _airport:     airport,
      _bucket:      bucket,
      _pax:         (r.adult || 0) + (r.child || 0) + (r.infant || 0),
      _hotelCode:   hotel?.hotel_code ?? 9999,
      _pickupPoint: hotel?.pickup_point || r.hotel_name,
      _pickupTime:  isArr ? null : (() => {
        if (r.dep_pick_time) return r.dep_pick_time
        if (sched && hotel) {
          const mins = sched.airport === 'TIV' ? hotel.time_to_tiv : hotel.time_to_tgd
          return calcPickupTime(sched.scheduled_time, mins)
        }
        return null
      })(),
    }
  }

  const arrivals   = arrRecords.map(r => enrich(r, true))
  const departures = depRecords.map(r => enrich(r, false))

  // Grupiši po letu + aerodromu (BEZ zone — svi idu jednim busom)
  function groupBy(records) {
    const groups = {}, order = []
    for (const r of records) {
      const key = `${r._flightNorm}||${r._airport}`
      if (!groups[key]) { groups[key] = []; order.push(key) }
      groups[key].push(r)
    }
    return { groups, order }
  }

  const { groups: arrGroups, order: arrOrder } = groupBy(arrivals)
  const { groups: depGroups, order: depOrder } = groupBy(departures)

  // RT detekcija: arr let ima return_flight koji se poklapa sa dep letom
  const rtPairMap = {} // arrKey → depKey, depKey → arrKey
  for (const arrKey of arrOrder) {
    const [arrFlightNorm, airport] = arrKey.split('||')
    const returnFlights = [...new Set(
      (flightNormMap[arrFlightNorm]?.ARR || [])
        .map(s => s.return_flight).filter(Boolean).map(rf => normalize(rf))
    )]
    for (const rfNorm of returnFlights) {
      const depKey = `${rfNorm}||${airport}`
      if (depGroups[depKey] && !rtPairMap[arrKey]) {
        rtPairMap[arrKey] = depKey
        rtPairMap[depKey] = arrKey
      }
    }
  }

  const nalozi = []
  const usedDepKeys = new Set()
  let counter = 1

  // ── Obradi dolazne letove ────────────────────────────────────────
  for (const arrKey of arrOrder) {
    const arrRecs  = arrGroups[arrKey]
    const [, airport] = arrKey.split('||')
    const arrPax   = sumPax(arrRecs)
    const arrBucket = maxBucketOf(arrRecs)
    const arrHotels = aggregateHotels(arrRecs, true)
    const sample   = arrRecs[0]

    const depKey   = rtPairMap[arrKey]
    const isRT     = !!depKey && !usedDepKeys.has(depKey)

    if (isRT) {
      usedDepKeys.add(depKey)
      const depRecs    = depGroups[depKey]
      const depPax     = sumPax(depRecs)
      const depBucket  = maxBucketOf(depRecs)
      const depHotels  = aggregateHotels(depRecs, false)
      const depSample  = depRecs[0]

      // Cijena = najskuplja zona između dolaska i odlaska
      const combinedBucket = BUCKET_RANK[depBucket] > BUCKET_RANK[arrBucket] ? depBucket : arrBucket

      // Svaki smjer splituj nezavisno — tada paruj po indeksu
      const arrBusList = splitBuses(arrPax)
      const depBusList = splitBuses(depPax)
      const pairCount  = Math.min(arrBusList.length, depBusList.length)
      const totalBuses = Math.max(arrBusList.length, depBusList.length)

      const arrDist = distributeHotels(arrHotels, arrBusList)
      const depDist = distributeHotels(depHotels, depBusList)

      // RT parovi (do min od arr/dep buseva)
      for (let b = 0; b < pairCount; b++) {
        const arrBt   = arrBusList[b]
        const depBt   = depBusList[b]
        // Za RT cijenu koristimo veći bus (koji mora pokriti oba smjera)
        const rtBt    = BUS_CAPS[arrBt] >= BUS_CAPS[depBt] ? arrBt : depBt
        const busLabel = totalBuses > 1 ? ` (${b + 1}/${totalBuses})` : ''
        const price   = gp(rtBt, airport, combinedBucket, 'RT')
        const bArrPax = arrDist[b].reduce((s, h) => s + h.pax, 0)
        const bDepPax = depDist[b].reduce((s, h) => s + h.pax, 0)

        nalozi.push({
          id:      `${counter++}`,
          type:    'RT',
          busType: rtBt,
          busLabel: BUS_LABELS[rtBt] + busLabel,
          airport,
          bucket:  combinedBucket,
          price,
          arr: { flightName: sample._flightName,    flightTime: sample._flightTime,    pax: bArrPax, hotels: arrDist[b] },
          dep: { flightName: depSample._flightName, flightTime: depSample._flightTime, pax: bDepPax, hotels: depDist[b] },
          date,
        })
      }

      // Višak dolaznih buseva → OW arr
      for (let b = pairCount; b < arrBusList.length; b++) {
        const bt      = arrBusList[b]
        const busLabel = totalBuses > 1 ? ` (${b + 1}/${totalBuses})` : ''
        const bPax    = arrDist[b].reduce((s, h) => s + h.pax, 0)
        nalozi.push({
          id:         `${counter++}A`,
          type:       'arr',
          owrt:       'OW',
          busType:    bt,
          busLabel:   BUS_LABELS[bt] + busLabel,
          flightName: sample._flightName,
          flightTime: sample._flightTime,
          airport,
          bucket:     arrBucket,
          pax:        bPax,
          price:      gp(bt, airport, arrBucket, 'OW'),
          hotels:     arrDist[b],
          date,
        })
      }

      // Višak odlaznih buseva → OW dep
      for (let b = pairCount; b < depBusList.length; b++) {
        const bt      = depBusList[b]
        const busLabel = totalBuses > 1 ? ` (${b + 1}/${totalBuses})` : ''
        const bPax    = depDist[b].reduce((s, h) => s + h.pax, 0)
        nalozi.push({
          id:         `${counter++}D`,
          type:       'dep',
          owrt:       'OW',
          busType:    bt,
          busLabel:   BUS_LABELS[bt] + busLabel,
          flightName: depSample._flightName,
          flightTime: depSample._flightTime,
          airport,
          bucket:     depBucket,
          pax:        bPax,
          price:      gp(bt, airport, depBucket, 'OW'),
          hotels:     depDist[b],
          date,
        })
      }

    } else {
      // OW dolazak
      const busList = splitBuses(arrPax)
      const dist    = distributeHotels(arrHotels, busList)
      busList.forEach((bt, b) => {
        const busLabel = busList.length > 1 ? ` (${b + 1}/${busList.length})` : ''
        const bPax     = dist[b].reduce((s, h) => s + h.pax, 0)
        nalozi.push({
          id:         `${counter++}A`,
          type:       'arr',
          owrt:       'OW',
          busType:    bt,
          busLabel:   BUS_LABELS[bt] + busLabel,
          flightName: sample._flightName,
          flightTime: sample._flightTime,
          airport,
          bucket:     arrBucket,
          pax:        bPax,
          price:      gp(bt, airport, arrBucket, 'OW'),
          hotels:     dist[b],
          date,
        })
      })
    }
  }

  // ── OW odlasci (nisu upareni) ────────────────────────────────────
  for (const depKey of depOrder) {
    if (usedDepKeys.has(depKey)) continue
    const depRecs  = depGroups[depKey]
    const [, airport] = depKey.split('||')
    const depPax   = sumPax(depRecs)
    const depBucket = maxBucketOf(depRecs)
    const depHotels = aggregateHotels(depRecs, false)
    const sample   = depRecs[0]

    const busList = splitBuses(depPax)
    const dist    = distributeHotels(depHotels, busList)
    busList.forEach((bt, b) => {
      const busLabel = busList.length > 1 ? ` (${b + 1}/${busList.length})` : ''
      const bPax     = dist[b].reduce((s, h) => s + h.pax, 0)
      nalozi.push({
        id:         `${counter++}D`,
        type:       'dep',
        owrt:       'OW',
        busType:    bt,
        busLabel:   BUS_LABELS[bt] + busLabel,
        flightName: sample._flightName,
        flightTime: sample._flightTime,
        airport,
        bucket:     depBucket,
        pax:        bPax,
        price:      getPrice(bt, airport, depBucket, 'OW'),
        hotels:     dist[b],
        date,
      })
    })
  }

  return nalozi
}

// ── Hotel table ──────────────────────────────────────────────────────
function HotelTable({ hotels, showPickup }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-gray-200">
          <th className="text-left pb-1 font-semibold text-gray-500">Hotel</th>
          <th className="text-center pb-1 font-semibold text-gray-500 w-10">Pax</th>
          {showPickup && <th className="text-center pb-1 font-semibold text-gray-500 w-14">Pick-up</th>}
          <th className="text-left pb-1 font-semibold text-gray-500 pl-2">Punkt</th>
        </tr>
      </thead>
      <tbody>
        {hotels.map((h, i) => (
          <tr key={i} className="border-b border-gray-100 last:border-0">
            <td className="py-1 font-medium text-gray-800">{h.name}</td>
            <td className="py-1 text-center font-mono font-bold text-gray-700">{h.pax}</td>
            {showPickup && (
              <td className="py-1 text-center font-mono text-orange-600 font-semibold">
                {h.pickupTime ? fmtTime(h.pickupTime) : <span className="text-gray-300">—</span>}
              </td>
            )}
            <td className="py-1 pl-2 text-gray-500">{h.pickupPoint || <span className="text-gray-300">HOTEL</span>}</td>
          </tr>
        ))}
        <tr>
          <td className="pt-1.5 font-bold text-gray-700 text-xs">UKUPNO</td>
          <td className="pt-1.5 text-center font-mono font-bold text-xs">
            {hotels.reduce((s, h) => s + h.pax, 0)}
          </td>
          {showPickup && <td />}
          <td />
        </tr>
      </tbody>
    </table>
  )
}

// ── RT karton (dolazak + odlazak zajedno) ────────────────────────────
function RTCard({ nalog }) {
  return (
    <div className="border border-emerald-300 rounded-xl overflow-hidden bg-emerald-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-emerald-600 text-white flex-wrap">
        <span className="font-bold text-white/70 text-sm w-6">{nalog.id}</span>
        <span className="px-2 py-0.5 rounded text-xs font-bold bg-white text-emerald-700">RT</span>
        <span className="font-mono font-bold">
          {nalog.arr.flightName}
          {nalog.arr.flightTime && <span className="ml-1 text-emerald-200">{fmtTime(nalog.arr.flightTime)}</span>}
        </span>
        <span className="text-emerald-200">⇄</span>
        <span className="font-mono font-bold">
          {nalog.dep.flightName}
          {nalog.dep.flightTime && <span className="ml-1 text-emerald-200">{fmtTime(nalog.dep.flightTime)}</span>}
        </span>
        <span className="text-emerald-200 text-xs">{nalog.airport}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-sm font-medium text-emerald-100">{nalog.busLabel}</span>
          <span className="px-2.5 py-1 rounded-lg bg-yellow-400 text-yellow-900 text-sm font-bold">
            €{nalog.price}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-emerald-200">
        {/* Dolazak */}
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded">🛬 DOLAZAK</span>
            <span className="text-xs text-gray-500">
              {nalog.airport} → <strong>{BUCKET_LABEL[nalog.bucket]}</strong>
            </span>
            <span className="ml-auto text-xs font-mono font-bold text-gray-600">{nalog.arr.pax} pax</span>
          </div>
          <HotelTable hotels={nalog.arr.hotels} showPickup={false} />
        </div>

        {/* Odlazak */}
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded">🛫 ODLAZAK</span>
            <span className="text-xs text-gray-500">
              <strong>{BUCKET_LABEL[nalog.bucket]}</strong> → {nalog.airport}
            </span>
            <span className="ml-auto text-xs font-mono font-bold text-gray-600">{nalog.dep.pax} pax</span>
          </div>
          <HotelTable hotels={nalog.dep.hotels} showPickup={true} />
        </div>
      </div>
    </div>
  )
}

// ── OW karton (jedan smjer) ──────────────────────────────────────────
function OWCard({ nalog }) {
  const isArr = nalog.type === 'arr'
  return (
    <div className="border border-sky-200 rounded-xl overflow-hidden bg-sky-50">
      <div className="flex items-center gap-3 px-4 py-3 bg-sky-600 text-white flex-wrap">
        <span className="font-bold text-white/70 text-sm w-8">{nalog.id}</span>
        <span className="px-2 py-0.5 rounded text-xs font-bold bg-white text-sky-700">OW</span>
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${isArr ? 'bg-green-200 text-green-800' : 'bg-orange-200 text-orange-800'}`}>
          {isArr ? '🛬 DOLAZAK' : '🛫 ODLAZAK'}
        </span>
        <span className="font-mono font-bold">
          {nalog.flightName}
          {nalog.flightTime && <span className="ml-1 text-sky-200">{fmtTime(nalog.flightTime)}</span>}
        </span>
        <span className="text-sky-200 text-xs">{nalog.airport}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-sm font-medium text-sky-100">{nalog.busLabel}</span>
          <span className="text-xs text-sky-200">{nalog.pax} pax</span>
          <span className="px-2.5 py-1 rounded-lg bg-yellow-400 text-yellow-900 text-sm font-bold">
            €{nalog.price}
          </span>
        </span>
      </div>
      <div className="p-3">
        <div className="text-xs text-gray-500 mb-2">
          {isArr
            ? <>{nalog.airport} → <strong>{BUCKET_LABEL[nalog.bucket]}</strong></>
            : <><strong>{BUCKET_LABEL[nalog.bucket]}</strong> → {nalog.airport}</>}
          <span className="ml-2 text-gray-400">· cijena po {nalog.bucket === 'bar' ? 'Bar/Sutomore' : nalog.bucket === 'petrovac' ? 'Petrovac' : 'Budva'}</span>
        </div>
        <HotelTable hotels={nalog.hotels} showPickup={!isArr} />
      </div>
    </div>
  )
}

// ── HTML print naloga ────────────────────────────────────────────────
function openPrintNalozi(nalozi, date) {
  const dateStr = fmtDate(date)

  function page(type, id, isArr, airport, bucket, pax, flightName, flightTime, hotels) {
    const ft    = flightTime ? fmtTime(flightTime) : '—'
    const bkt   = BUCKET_LABEL[bucket]
    const from  = isArr ? airport : bkt
    const to    = isArr ? bkt : airport
    const dir   = isArr ? 'ARRIVAL TIME' : 'DEPARTURE TIME'
    const total = hotels.reduce((s, h) => s + h.pax, 0)

    const rows = hotels.map(h => `
      <tr>
        <td class="hn">${h.name}</td>
        <td class="hp">${h.pax}</td>
        ${isArr ? '' : `<td class="hpu">${h.pickupTime ? fmtTime(h.pickupTime) : ''}</td>`}
        <td class="hpt">${h.pickupPoint || 'HOTEL'}</td>
      </tr>`).join('')

    return `
      <div class="nalog">
        <div class="hdr">
          <div>
            <div class="company">PROMETHEUS</div>
            <div class="contacts">NIKOLA · Tel. 069 108303<br>Vlado Lalatović · Tel. 069 815828</div>
          </div>
          <div class="badges">
            <span class="tbadge">${type}</span>
            <span class="nid">${id}</span>
          </div>
        </div>

        <div class="req">Please provide us <b>BUS</b> on &nbsp;<b>${dateStr}</b></div>

        <div class="route">
          <div class="rr">
            <span class="rf">${from}</span>
            <span class="ra">→</span>
            <span class="rt">${to}</span>
            <span class="rpax"><b>${pax}</b> <span class="rpl">pax</span></span>
          </div>
          <div class="fl">
            <span class="fl-lbl">${dir}</span>
            <span class="fl-time">${ft}</span>
            <span class="fl-dot">·</span>
            <span class="fl-lbl">FLIGHT</span>
            <span class="fl-num">${flightName}</span>
          </div>
        </div>

        <table>
          <thead><tr>
            <th>Hotel</th>
            <th class="r">Pax</th>
            ${isArr ? '' : '<th>Pick-up</th>'}
            <th>Point</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr class="tot">
            <td>UKUPNO</td>
            <td class="r"><b>${total}</b></td>
            ${isArr ? '' : '<td></td>'}
            <td></td>
          </tr></tfoot>
        </table>

        <div class="foot">Thank you for your help &amp; cooperation</div>
      </div>`
  }

  const pages = []
  for (const n of nalozi) {
    if (n.type === 'RT') {
      pages.push(page('RT-ARR', n.id + 'A', true,  n.airport, n.bucket, n.arr.pax, n.arr.flightName, n.arr.flightTime, n.arr.hotels))
      pages.push(page('RT-DEP', n.id + 'D', false, n.airport, n.bucket, n.dep.pax, n.dep.flightName, n.dep.flightTime, n.dep.hotels))
    } else if (n.type === 'arr') {
      pages.push(page('OW-ARR', n.id, true,  n.airport, n.bucket, n.pax, n.flightName, n.flightTime, n.hotels))
    } else {
      pages.push(page('OW-DEP', n.id, false, n.airport, n.bucket, n.pax, n.flightName, n.flightTime, n.hotels))
    }
  }

  const html = `<!DOCTYPE html>
<html lang="hr"><head><meta charset="utf-8">
<title>Grupni nalozi · ${dateStr}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#fff;color:#111}
  .nalog{padding:18mm 22mm;min-height:100vh;display:flex;flex-direction:column;page-break-after:always}
  .nalog:last-child{page-break-after:auto}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:2.5px solid #111;margin-bottom:14px}
  .company{font-size:26px;font-weight:700;letter-spacing:-.3px}
  .contacts{font-size:11px;color:#555;line-height:1.9;margin-top:5px}
  .badges{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
  .tbadge{background:#111;color:#fff;font-size:11px;font-weight:700;padding:4px 12px;border-radius:3px;letter-spacing:.8px}
  .nid{font-size:28px;font-weight:700}
  .req{font-size:13px;color:#555;margin:10px 0 16px}
  .req b{color:#111}
  .route{background:#f3f3f3;border-left:4px solid #111;padding:13px 18px;border-radius:0 6px 6px 0;margin-bottom:18px}
  .rr{display:flex;align-items:center;gap:10px;margin-bottom:7px}
  .rf,.rt{font-size:18px;font-weight:700}
  .ra{font-size:18px;color:#bbb}
  .rpax{margin-left:auto;font-size:18px;font-weight:700}
  .rpl{font-size:12px;color:#666;font-weight:400}
  .fl{display:flex;align-items:center;gap:8px}
  .fl-lbl{color:#888;font-size:10px;text-transform:uppercase;letter-spacing:.6px}
  .fl-time{color:#333;font-weight:600;font-size:13px}
  .fl-dot{color:#ccc}
  .fl-num{font-weight:700;font-family:monospace;font-size:15px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  thead th{text-align:left;padding:7px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700;border-bottom:1.5px solid #111}
  .r{text-align:right}
  tbody tr{border-bottom:.5px solid #ddd}
  tbody td{padding:8px 8px}
  td.hn{font-weight:500}
  td.hp{text-align:right;font-weight:700;font-family:monospace}
  td.hpu{color:#b84500;font-weight:600;font-family:monospace}
  td.hpt{color:#666;font-size:12px}
  tfoot td{border-top:1.5px solid #111;padding:9px 8px 0;font-size:12px}
  .tot td.r{font-weight:700;font-family:monospace;font-size:15px;text-align:right}
  .foot{margin-top:auto;padding-top:18px;font-size:11px;color:#aaa;font-style:italic}
  @media print{
    @page{size:A4 portrait;margin:0}
    .nalog{padding:14mm 18mm}
    tbody tr.alt{background:#f7f7f7 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style></head><body>
${pages.join('\n')}
</body></html>`

  const win = window.open('', '_blank', 'width=860,height=950')
  if (!win) { alert('Dozvoli pop-up prozore za ovu stranicu.'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
}

// ── Excel export ─────────────────────────────────────────────────────
async function exportToExcel(nalozi, date) {
  // Učitaj xlsx-js-style (fork SheetJS-a s podrškom za stilove)
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

  const dateStr = fmtDate(date)
  const B = { font: { bold: true } }               // bold stil
  const AL = 'ABCDEFGH'

  // ── Gradi jedan sheet (ARR ili DEP) ────────────────────────────
  function buildSheet(list, isArr) {
    if (!list.length) return null
    const ws = {}, merges = [], rowH = []
    let r = 1

    // Postavi ćeliju
    function sc(ci, row, v, s = {}, t = 's') {
      ws[`${AL[ci]}${row}`] = { v, t, s }
    }
    // Merge (0-indexed cols, 1-indexed row)
    function mg(c1, c2, row) {
      merges.push({ s: { r: row - 1, c: c1 }, e: { r: row - 1, c: c2 } })
    }

    for (const n of list) {
      // Izvuci podatke za ovaj smjer
      let nalogType, nalogId, airport, bucket, pax, flightName, flightTime, hotels
      if (n.type === 'RT') {
        nalogType = isArr ? 'RT-ARR' : 'RT-DEP'
        nalogId   = isArr ? (n.id + 'A') : (n.id + 'D')
        airport   = n.airport
        bucket    = n.bucket
        if (isArr) {
          pax = n.arr.pax; flightName = n.arr.flightName
          flightTime = n.arr.flightTime; hotels = n.arr.hotels
        } else {
          pax = n.dep.pax; flightName = n.dep.flightName
          flightTime = n.dep.flightTime; hotels = n.dep.hotels
        }
      } else {
        nalogType  = n.type === 'arr' ? 'OW-ARR' : 'OW-DEP'
        nalogId    = n.id
        airport    = n.airport; bucket = n.bucket
        pax        = n.pax; flightName = n.flightName
        flightTime = n.flightTime; hotels = n.hotels
      }

      const ft  = flightTime ? fmtTime(flightTime) : '—'
      const bkt = BUCKET_LABEL[bucket]

      // ── ARR sheet: 7 kolona (A–G) ───────────────────────────────
      if (isArr) {
        // Zaglavlje naloga (visina 58)
        sc(0, r, 'PROMETHEUS', B); mg(0, 3, r)
        sc(5, r, nalogType, B); sc(6, r, nalogId, B)
        rowH[r - 1] = { hpx: 58 }; r++

        // Kontakti
        sc(0, r, 'NIKOLA'); mg(0, 1, r); sc(2, r, 'Tel. 069 108303'); r++
        sc(0, r, 'Vlado Lalatovic'); mg(0, 1, r); sc(2, r, 'Tel. 069 815828'); r++

        // Datum (visina 24)
        sc(0, r, 'Please provide us BUS on', B); mg(0, 2, r)
        sc(3, r, ''); sc(4, r, dateStr, B)
        rowH[r - 1] = { hpx: 24 }; r++

        r++ // prazan red između datuma i "From"

        // From [airport] to [bucket] for [pax] pax (visina 24)
        sc(0, r, 'From', B); sc(1, r, airport, B); sc(2, r, 'to', B)
        sc(3, r, bkt, B); sc(4, r, 'for', B)
        sc(5, r, pax, B, 'n'); sc(6, r, 'pax', B)
        rowH[r - 1] = { hpx: 24 }; r++

        // ARRIVAL TIME + FLIGHT (visina 24)
        sc(0, r, 'ARRIVAL TIME', B); mg(0, 1, r)
        sc(2, r, ft, B); sc(5, r, 'FLIGHT', B); sc(6, r, flightName, B)
        rowH[r - 1] = { hpx: 24 }; r++

        // HOTEL | PAX | POINT zaglavlje (visina 24)
        sc(0, r, 'HOTEL', B); mg(0, 3, r)
        sc(4, r, 'PAX', B); sc(5, r, 'POINT', B)
        rowH[r - 1] = { hpx: 24 }; r++

        // Redovi hotela
        for (const h of hotels) {
          sc(0, r, h.name); mg(0, 3, r)
          sc(4, r, h.pax, {}, 'n'); sc(5, r, h.pickupPoint || 'HOTEL'); r++
        }

        // Zbir (visina 19) + "Thank you" + separator
        sc(4, r, pax, B, 'n'); rowH[r - 1] = { hpx: 19 }; r++
        sc(0, r, 'Thank you for your help & cooperation'); r++
        r++ // prazan red između naloga

      // ── DEP sheet: 8 kolona (A–H) ───────────────────────────────
      } else {
        // Zaglavlje naloga (visina 57)
        sc(0, r, 'PROMETHEUS', B); mg(0, 3, r)
        sc(4, r, '', B); sc(5, r, '', B)
        sc(6, r, nalogType, B); sc(7, r, nalogId, B)
        rowH[r - 1] = { hpx: 57 }; r++

        // Kontakti (DEP format: "From: / To:")
        sc(0, r, 'From: '); sc(1, r, 'NIKOLA'); sc(3, r, 'Tel. 069 108303'); r++
        sc(0, r, 'To:'); sc(1, r, 'Vlado Lalatovic'); sc(3, r, 'Tel. 069 815828'); r++

        // Datum (visina 24)
        sc(0, r, 'Please provide us BUS on', B); mg(0, 3, r)
        sc(4, r, dateStr, B); rowH[r - 1] = { hpx: 24 }; r++

        // From [bucket] to [airport] for [pax] pax (visina 24)
        sc(0, r, 'From', B)
        sc(1, r, bkt, B); mg(1, 2, r)    // bucket label mergeovan B:C
        sc(3, r, 'to', B); sc(4, r, airport, B)
        sc(5, r, 'for', B); sc(6, r, pax, B, 'n'); sc(7, r, 'pax', B)
        rowH[r - 1] = { hpx: 24 }; r++

        // DEPARTURE TIME + FLIGHT (visina 24)
        sc(0, r, 'DEPARTURE TIME', B); sc(1, r, '', B)
        sc(2, r, ft, B); sc(3, r, '', B); sc(4, r, '', B)
        sc(5, r, 'FLIGHT', B); sc(6, r, flightName, B)
        rowH[r - 1] = { hpx: 24 }; r++

        // HOTEL | PAX | pick-up | POINT zaglavlje (visina 24)
        sc(0, r, 'HOTEL', B); mg(0, 3, r)
        sc(4, r, 'PAX', B); sc(5, r, 'pick-up', B); sc(6, r, 'POINT', B)
        rowH[r - 1] = { hpx: 24 }; r++

        // Redovi hotela
        for (const h of hotels) {
          sc(0, r, h.name); mg(0, 3, r)
          sc(4, r, h.pax, {}, 'n')
          sc(5, r, h.pickupTime ? fmtTime(h.pickupTime) : '')
          sc(6, r, h.pickupPoint || 'HOTEL'); r++
        }

        // Zbir + "Thank you" + separator
        sc(4, r, pax, B, 'n'); rowH[r - 1] = { hpx: 20 }; r++
        sc(0, r, 'Thank you for your help & cooperation'); r++
        r++ // prazan red između naloga
      }
    }

    ws['!merges'] = merges
    ws['!rows']   = rowH
    ws['!ref']    = `A1:${isArr ? 'G' : 'H'}${r - 1}`
    ws['!cols']   = isArr
      ? [{ wch: 32 },{ wch: 10 },{ wch: 10 },{ wch: 10 },{ wch: 10 },{ wch: 10 },{ wch: 16 }]
      : [{ wch: 32 },{ wch: 18 },{ wch: 8  },{ wch: 8  },{ wch: 10 },{ wch: 8  },{ wch: 18 },{ wch: 6 }]
    return ws
  }

  // ARR sheet: RT parovi + OW dolasci
  const arrList = nalozi.filter(n => n.type === 'RT' || n.type === 'arr')
  // DEP sheet: RT parovi + OW odlasci
  const depList = nalozi.filter(n => n.type === 'RT' || n.type === 'dep')

  const wb = XS.utils.book_new()
  const arrWs = buildSheet(arrList, true)
  const depWs = buildSheet(depList, false)
  if (arrWs) XS.utils.book_append_sheet(wb, arrWs, 'Arr-')
  if (depWs) XS.utils.book_append_sheet(wb, depWs, 'Dep-')

  const out  = XS.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `grupni_nalozi_${date}.xlsx`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ── Main Page ────────────────────────────────────────────────────────
export default function GroupSchedule() {
  const [date,      setDate]      = useState(tomorrow())
  const [loading,   setLoading]   = useState(false)
  const [nalozi,    setNalozi]    = useState([])
  const [exporting, setExporting] = useState(false)
  const [hasData,   setHasData]   = useState(false)

  async function load() {
    setLoading(true)
    setNalozi([])

    const [{ data: arrRaw }, { data: depRaw }] = await Promise.all([
      supabase.from('rooming_list').select('*').eq('date_beg', date).eq('arr_transfer_alias', 'GRP').is('arr_vehicle_type', null),
      supabase.from('rooming_list').select('*').eq('date_end', date).eq('dep_transfer_alias', 'GRP').is('dep_vehicle_type', null),
    ])

    const arr = arrRaw || []
    const dep = depRaw || []

    if (!arr.length && !dep.length) { setHasData(false); setLoading(false); return }
    setHasData(true)

    const hotelNames = [...new Set([...arr, ...dep].map(r => r.hotel_name).filter(Boolean))]

    const [{ data: hotelsData }, { data: schedData }, { data: priceRows }] = await Promise.all([
      hotelNames.length
        ? supabase.from('hotels').select('name,pickup_point,hotel_code,time_to_tiv,time_to_tgd,zones(name)').in('name', hotelNames)
        : Promise.resolve({ data: [] }),
      supabase.from('flight_schedule')
        .select('flight_number,airport,direction,scheduled_time,days_of_week,aliases,return_flight'),
      supabase.from('bus_prices').select('*').is('supplier_id', null),
    ])

    const hotelMap = Object.fromEntries((hotelsData || []).map(h => [h.name, h]))

    const flightNormMap = {}
    for (const s of (schedData || [])) {
      const norm = normalize(s.flight_number)
      if (!flightNormMap[norm]) flightNormMap[norm] = { canonical: s.flight_number, ARR: [], DEP: [] }
      flightNormMap[norm][s.direction]?.push(s)
      for (const alias of (s.aliases || [])) {
        const an = normalize(alias)
        if (!flightNormMap[an]) flightNormMap[an] = { canonical: s.flight_number, ARR: [], DEP: [] }
        flightNormMap[an][s.direction]?.push(s)
      }
    }

    const priceMap = buildPriceMap(priceRows || [])
    setNalozi(generateNalozi(arr, dep, hotelMap, flightNormMap, date, priceMap))
    setLoading(false)
  }

  async function doExport() {
    setExporting(true)
    try { await exportToExcel(nalozi, date) }
    catch (e) { alert('Greška: ' + e.message) }
    setExporting(false)
  }

  const rtNalozi  = nalozi.filter(n => n.type === 'RT')
  const owArrNalozi = nalozi.filter(n => n.type === 'arr')
  const owDepNalozi = nalozi.filter(n => n.type === 'dep')
  const totalPrice  = nalozi.reduce((s, n) => s + n.price, 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">🚌 Grupni transferi</h1>
        <input type="date" value={date}
          onChange={e => setDate(e.target.value)}
          onClick={e => e.target.showPicker?.()}
          className="input w-40" />
        <button onClick={load} disabled={loading} className="btn-primary">
          {loading ? '⏳ Učitavam...' : '📋 Generiši naloge'}
        </button>
        {nalozi.length > 0 && (
          <>
            <button onClick={() => openPrintNalozi(nalozi, date)} className="btn-ghost">
              🖨 Štampaj naloge
            </button>
            <button onClick={doExport} disabled={exporting} className="btn-ghost">
              {exporting ? '⏳ Izvozim...' : '📥 Excel'}
            </button>
          </>
        )}
      </div>

      {/* Summary stats */}
      {nalozi.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { l: 'RT parova',  v: rtNalozi.length,     c: 'text-emerald-700' },
            { l: 'OW dolazci', v: owArrNalozi.length,  c: 'text-green-700'   },
            { l: 'OW odlasci', v: owDepNalozi.length,  c: 'text-orange-700'  },
            { l: 'Ukupno €',   v: totalPrice,           c: 'text-yellow-700'  },
          ].map(s => (
            <div key={s.l} className="card p-3 text-center">
              <div className={`text-2xl font-bold ${s.c}`}>{s.v}</div>
              <div className="text-xs text-gray-500">{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Price breakdown */}
      {nalozi.length > 0 && (
        <div className="card p-3 mb-6 bg-yellow-50 border border-yellow-200 text-xs text-yellow-800 flex flex-wrap gap-x-4 gap-y-1">
          {nalozi.map(n => (
            <span key={n.id}>
              <strong>{n.id}</strong>: {n.type === 'RT' ? 'RT' : n.owrt} ·{' '}
              {n.busType === 'sprinter' ? 'SPR' : n.busType === 'midi' ? 'MID' : 'BUS'} ·{' '}
              {n.type === 'RT' ? `${n.arr.pax}↓ ${n.dep.pax}↑` : `${n.pax} pax`} · <strong>€{n.price}</strong>
            </span>
          ))}
          <span className="ml-auto font-bold text-yellow-900">UKUPNO: €{totalPrice}</span>
        </div>
      )}

      {/* No data */}
      {hasData === false && !loading && (
        <div className="card p-8 text-center text-gray-400">
          Nema grupnih transfera za {fmtDate(date)}
        </div>
      )}

      {/* RT parovi */}
      {rtNalozi.length > 0 && (
        <div className="mb-6">
          <h2 className="text-base font-bold text-emerald-700 mb-3">
            ⇄ RT transferi — {fmtDate(date)}
            <span className="ml-2 text-sm font-normal text-gray-500">({rtNalozi.length} {rtNalozi.length === 1 ? 'par' : 'para'})</span>
          </h2>
          <div className="space-y-4">
            {rtNalozi.map(n => <RTCard key={n.id} nalog={n} />)}
          </div>
        </div>
      )}

      {/* OW dolasci */}
      {owArrNalozi.length > 0 && (
        <div className="mb-6">
          <h2 className="text-base font-bold text-green-700 mb-3">
            🛬 OW dolasci
            <span className="ml-2 text-sm font-normal text-gray-500">({owArrNalozi.length})</span>
          </h2>
          <div className="space-y-3">
            {owArrNalozi.map(n => <OWCard key={n.id} nalog={n} />)}
          </div>
        </div>
      )}

      {/* OW odlasci */}
      {owDepNalozi.length > 0 && (
        <div>
          <h2 className="text-base font-bold text-orange-700 mb-3">
            🛫 OW odlasci
            <span className="ml-2 text-sm font-normal text-gray-500">({owDepNalozi.length})</span>
          </h2>
          <div className="space-y-3">
            {owDepNalozi.map(n => <OWCard key={n.id} nalog={n} />)}
          </div>
        </div>
      )}
    </div>
  )
}
