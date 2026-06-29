// Vremena vožnje u minutama od aerodroma TIV i TGD do hotela/zona
// Ključ = naziv zone ili hotela (uppercase)
//
// Ove vrijednosti su ZADANE (fallback).
// Vrijednosti iz baze podataka (tabela drive_times) imaju prednost.

export const AIRPORT_TO_AIRPORT = { 'TIV|TGD': 90, 'TGD|TIV': 90 }

// Prosječna vremena vožnje od TIV po zoni (minuti)
export const ZONE_DRIVE_FROM_TIV = {
  'TIVAT':        10,
  'LUŠTICA':      15,
  'BOKA':         25,
  'KOTOR':        30,
  'HERCEG NOVI':  65,  // ~60-70 min (tunelom ili kroz Kotor)
  'BUDVA':        25,
  'BEČIĆI':       28,
  'SVETI STEFAN': 33,
  'PETROVAC':     42,
  'BAR':          58,
  'ULCINJ':       82,
  'PODGORICA':    75,
}

// Prosječna vremena vožnje od TGD po zoni (minuti)
export const ZONE_DRIVE_FROM_TGD = {
  'PODGORICA':    15,
  'BUDVA':        60,
  'BEČIĆI':       63,
  'BAR':          65,
  'KOTOR':        80,
  'LUŠTICA':      85,
  'TIVAT':        75,
  'BOKA':         75,
  'HERCEG NOVI':  100,
  'SVETI STEFAN': 68,
  'PETROVAC':     60,
  'ULCINJ':       100,
}

// Zone sjeverozapadno od TIV (Boka kotorska, prema Herceg Novom)
export const NW_ZONES = new Set(['HERCEG NOVI', 'BOKA', 'KOTOR'])
// Zone jugoistočno od TIV (obalna traka prema Baru i dalje)
export const SE_ZONES = new Set(['BUDVA', 'BEČIĆI', 'SVETI STEFAN', 'PETROVAC', 'BAR', 'ULCINJ'])

// ── DB override map ─────────────────────────────────────────────────────────
// Popunjava se pri pokretanju DailySchedule i DriveTimesPage
let _dtMap = {}

/**
 * Postavi vrijednosti iz baze. Poziva se jednom pri učitavanju stranice.
 * entries: [{ from_point, to_point, minutes }]
 */
export function setDriveTimesMap(entries) {
  _dtMap = {}
  for (const e of (entries || [])) {
    const k = `${e.from_point.toUpperCase()}|${e.to_point.toUpperCase()}`
    _dtMap[k] = e.minutes
  }
}

/**
 * Vrati sačuvanu DB mapu kao plain object { 'FROM|TO': minutes }
 * (koristimo u admin stranici za prikaz)
 */
export function getDriveTimesMap() {
  return _dtMap
}

// ── Glavna funkcija ──────────────────────────────────────────────────────────
/**
 * Vrati prosječno vrijeme vožnje u minutama između dvije tačke.
 * from/to mogu biti: 'TIV', 'TGD', ili naziv zone (uppercase).
 *
 * Redosljed pretrage:
 *  1. DB vrijednost (from|to)
 *  2. DB vrijednost (to|from) — simetrično
 *  3. Hardkodirane vrijednosti (fallback)
 */
export function getDriveMinutes(from, to, zoneFrom, zoneTo) {
  if (!from || !to) return 40

  const fromU = from.toUpperCase()
  const toU   = to.toUpperCase()

  // Isto mjesto — nema vožnje
  if (fromU === toU) return 0

  // Normalizirane zone (ako su proslijeđene)
  const zF = zoneFrom ? zoneFrom.toUpperCase() : null
  const zT = zoneTo   ? zoneTo.toUpperCase()   : null

  // 1a. DB override — direktnim imenom (hotel ili aerodrom)
  const k1 = `${fromU}|${toU}`
  const k2 = `${toU}|${fromU}`
  if (_dtMap[k1] !== undefined) return _dtMap[k1]
  if (_dtMap[k2] !== undefined) return _dtMap[k2]

  // 1b. DB override — kombinacije sa imenom zone
  // Problem: getDriveMinutes('STELLA DI MARE', 'TIV', null, 'RAFAILOVICI')
  // DB čuva 'RAFAILOVICI|TIV', ne 'STELLA DI MARE|TIV' — treba probati zone ključeve
  if (zF && zT) {
    const a = `${zF}|${zT}`, b = `${zT}|${zF}`
    if (_dtMap[a] !== undefined) return _dtMap[a]
    if (_dtMap[b] !== undefined) return _dtMap[b]
  }
  if (zT) {
    // from je hotel, zT je zona destinacije ili zona izvora (hotel→aerodrom)
    const a = `${fromU}|${zT}`, b = `${zT}|${fromU}`
    const c = `${zT}|${toU}`,  d = `${toU}|${zT}`
    if (_dtMap[a] !== undefined) return _dtMap[a]
    if (_dtMap[b] !== undefined) return _dtMap[b]
    if (_dtMap[c] !== undefined) return _dtMap[c]
    if (_dtMap[d] !== undefined) return _dtMap[d]
  }
  if (zF) {
    const a = `${zF}|${toU}`,  b = `${toU}|${zF}`
    const c = `${fromU}|${zF}`, d = `${zF}|${fromU}`
    if (_dtMap[a] !== undefined) return _dtMap[a]
    if (_dtMap[b] !== undefined) return _dtMap[b]
    if (_dtMap[c] !== undefined) return _dtMap[c]
    if (_dtMap[d] !== undefined) return _dtMap[d]
  }

  // 2. Aerodrom ↔ Aerodrom
  if (AIRPORT_TO_AIRPORT[k1] !== undefined) return AIRPORT_TO_AIRPORT[k1]

  // 3. Hardkodirane zone (fallback ako nije u DB)
  // Za lookup: koristi zonu ako postoji, inače ime mjesta
  const lookupFrom = zF || fromU
  const lookupTo   = zT || toU

  if (fromU === 'TIV') return ZONE_DRIVE_FROM_TIV[lookupTo]  ?? 40
  if (fromU === 'TGD') return ZONE_DRIVE_FROM_TGD[lookupTo]  ?? 60
  // hotel → aerodrom: zona je proslijeđena kao zT, ali pripada "from" hotelu
  if (toU === 'TIV')   return ZONE_DRIVE_FROM_TIV[zT] ?? ZONE_DRIVE_FROM_TIV[lookupFrom] ?? 40
  if (toU === 'TGD')   return ZONE_DRIVE_FROM_TGD[zT] ?? ZONE_DRIVE_FROM_TGD[lookupFrom] ?? 60

  // 4. Zona → zona
  const a = ZONE_DRIVE_FROM_TIV[lookupFrom]
  const b = ZONE_DRIVE_FROM_TIV[lookupTo]
  if (a !== undefined && b !== undefined) {
    const opposites = (NW_ZONES.has(lookupFrom) && SE_ZONES.has(lookupTo)) ||
                      (SE_ZONES.has(lookupFrom) && NW_ZONES.has(lookupTo))
    return opposites ? a + b - 10 : Math.abs(a - b) + 12
  }

  return 45
}

/**
 * Izračunaj "automatsku" vrijednost po formuli (bez DB override-a).
 * Koristi se u admin UI za prikaz zadane vrijednosti.
 */
export function computeAutoMinutes(fromU, toU) {
  if (fromU === toU) return 0
  const k1 = `${fromU}|${toU}`
  if (AIRPORT_TO_AIRPORT[k1] !== undefined) return AIRPORT_TO_AIRPORT[k1]
  if (fromU === 'TIV') return ZONE_DRIVE_FROM_TIV[toU] ?? null
  if (fromU === 'TGD') return ZONE_DRIVE_FROM_TGD[toU] ?? null
  if (toU   === 'TIV') return ZONE_DRIVE_FROM_TIV[fromU] ?? null
  if (toU   === 'TGD') return ZONE_DRIVE_FROM_TGD[fromU] ?? null
  const a = ZONE_DRIVE_FROM_TIV[fromU]
  const b = ZONE_DRIVE_FROM_TIV[toU]
  if (a !== undefined && b !== undefined) {
    const opposites = (NW_ZONES.has(fromU) && SE_ZONES.has(toU)) ||
                      (SE_ZONES.has(fromU) && NW_ZONES.has(toU))
    return opposites ? a + b - 10 : Math.abs(a - b) + 12
  }
  return null
}
