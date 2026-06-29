import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { computeAutoMinutes, setDriveTimesMap } from '../../lib/driveTime'

const AIRPORTS = ['TIV', 'TGD']

// Stilovi za zaglavlje kolona/redova
function ptLabel(pt) {
  if (pt === 'TIV') return { text: 'TIV', cls: 'bg-sky-600 text-white' }
  if (pt === 'TGD') return { text: 'TGD', cls: 'bg-indigo-600 text-white' }
  return { text: pt, cls: 'bg-gray-100 text-gray-700' }
}

export default function DriveTimesPage() {
  const [zones,  setZones]  = useState([])
  const [dbRows, setDbRows] = useState([])
  const [edits,  setEdits]  = useState({})
  const [saving, setSaving] = useState(false)
  const [msg,    setMsg]    = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: z }, { data: dt }] = await Promise.all([
      supabase.from('zones').select('id, name').order('name'),
      supabase.from('drive_times').select('from_point, to_point, minutes'),
    ])
    setZones(z || [])
    setDbRows(dt || [])
    if (dt) setDriveTimesMap(dt)
    setEdits({})
  }

  // Sve tačke: TIV, TGD, zatim zone abecedno
  const points = useMemo(
    () => [...AIRPORTS, ...(zones.map(z => z.name.toUpperCase()))],
    [zones]
  )

  // DB mapa (simetrična)
  const dbMap = useMemo(() => {
    const m = {}
    for (const r of dbRows) {
      m[`${r.from_point}|${r.to_point}`] = r.minutes
      m[`${r.to_point}|${r.from_point}`] = r.minutes
    }
    return m
  }, [dbRows])

  function k(a, b) { return `${a}|${b}` }

  // Vrijednost za ćeliju: edit > DB > ''
  function getVal(a, b) {
    const ka = k(a, b), kb = k(b, a)
    if (edits[ka] !== undefined) return edits[ka]
    if (edits[kb] !== undefined) return edits[kb]
    if (dbMap[ka] !== undefined) return String(dbMap[ka])
    return ''
  }

  // Automatska procjena iz formule (za placeholder)
  function getAuto(a, b) {
    const v = computeAutoMinutes(a, b)
    return v !== null ? `${v}` : ''
  }

  function hasEdit(a, b) {
    return edits[k(a, b)] !== undefined || edits[k(b, a)] !== undefined
  }

  function inDB(a, b) {
    return dbMap[k(a, b)] !== undefined
  }

  function handleChange(a, b, val) {
    setEdits(e => ({ ...e, [k(a, b)]: val }))
    setMsg('')
  }

  const dirtyCount = Object.keys(edits).length

  async function saveAll() {
    setSaving(true)
    const upserts = []
    for (const [key, val] of Object.entries(edits)) {
      const mins = parseInt(val, 10)
      if (isNaN(mins) || mins < 0) continue
      const [a, b] = key.split('|')
      upserts.push({ from_point: a, to_point: b, minutes: mins })
      upserts.push({ from_point: b, to_point: a, minutes: mins })
    }
    if (upserts.length) {
      const { error } = await supabase
        .from('drive_times')
        .upsert(upserts, { onConflict: 'from_point,to_point' })
      if (error) { alert('Greška: ' + error.message); setSaving(false); return }
    }
    await load()
    setSaving(false)
    setMsg('✓ Sačuvano')
    setTimeout(() => setMsg(''), 3000)
  }

  async function resetCell(a, b) {
    const ka = k(a, b), kb = k(b, a)
    // Ako postoji u edits, samo ukloni edit
    if (edits[ka] || edits[kb]) {
      setEdits(e => { const n = { ...e }; delete n[ka]; delete n[kb]; return n })
      return
    }
    // Inače briši iz DB
    if (!confirm(`Obrisati ručno unijeto vrijeme ${a} ↔ ${b}?`)) return
    await supabase.from('drive_times').delete()
      .or(`and(from_point.eq.${a},to_point.eq.${b}),and(from_point.eq.${b},to_point.eq.${a})`)
    await load()
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Vremena vožnje</h1>
          <p className="text-sm text-gray-500">
            Upiši minute čiste vožnje između tačaka. Program automatski dodaje: <strong>+5 min</strong> za ukrcaj/iskrcaj,{' '}
            <strong>+40 min</strong> za izlaz putnika sa aerodroma, grace period <strong>25 min</strong> za dolazak na aerodrom.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {msg && <span className="text-sm text-green-600 font-medium">{msg}</span>}
          {dirtyCount > 0 && (
            <button onClick={saveAll} disabled={saving} className="btn-primary whitespace-nowrap">
              {saving ? 'Čuvanje...' : `Sačuvaj (${dirtyCount})`}
            </button>
          )}
        </div>
      </div>

      {/* Legenda */}
      <div className="flex gap-5 mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border border-gray-300 bg-white inline-block" />
          Prazno = automatska procjena (placeholder)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border border-amber-400 bg-amber-50 inline-block" />
          Ručno uneseno
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border border-blue-400 bg-blue-50 inline-block" />
          Nesačuvana izmjena
        </span>
      </div>

      {/* Matrica */}
      <div className="overflow-auto rounded-lg border border-gray-200 shadow-sm">
        <table className="text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {/* Corner cell */}
              <th className="sticky left-0 z-20 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 min-w-[110px]" />
              {points.map(pt => {
                const lbl = ptLabel(pt)
                return (
                  <th
                    key={pt}
                    className="border-b border-gray-200 px-1 py-1.5 text-center min-w-[72px]"
                  >
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${lbl.cls}`}>
                      {lbl.text}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {points.map((rowPt, ri) => {
              const rowLbl = ptLabel(rowPt)
              return (
                <tr key={rowPt} className="border-b border-gray-100 last:border-0">
                  {/* Row header */}
                  <td className="sticky left-0 z-10 bg-white border-r border-gray-200 px-2 py-1 whitespace-nowrap">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${rowLbl.cls}`}>
                      {rowLbl.text}
                    </span>
                  </td>

                  {points.map((colPt, ci) => {
                    // Dijagonala
                    if (ri === ci) {
                      return (
                        <td key={colPt} className="px-1 py-1 text-center bg-gray-100 text-gray-300 select-none">
                          —
                        </td>
                      )
                    }

                    // Gornji trokut (ri < ci): editabilno
                    // Donji trokut (ri > ci): ogledalo
                    const isUpper = ri < ci
                    const a = isUpper ? rowPt : colPt
                    const b = isUpper ? colPt : rowPt

                    const val      = getVal(a, b)
                    const auto     = getAuto(a, b)
                    const dirty    = hasEdit(a, b)
                    const saved    = inDB(a, b)

                    if (!isUpper) {
                      // Ogledalo — prikaz
                      return (
                        <td key={colPt} className={`px-1 py-1 text-center text-gray-400 ${
                          saved ? 'bg-amber-50/60' : 'bg-gray-50/50'
                        }`}>
                          {val || (auto ? <span className="text-gray-300">{auto}</span> : '?')}
                        </td>
                      )
                    }

                    // Editabilna ćelija (gornji trokut)
                    return (
                      <td key={colPt} className="px-0.5 py-0.5 relative group">
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            min="0"
                            max="300"
                            placeholder={auto || '?'}
                            value={val}
                            onChange={e => handleChange(a, b, e.target.value)}
                            className={`w-14 text-center rounded border px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-400 transition-colors ${
                              dirty ? 'border-blue-400 bg-blue-50 font-medium text-blue-800'
                              : saved ? 'border-amber-300 bg-amber-50 text-gray-800'
                              : 'border-gray-200 bg-white text-gray-500 placeholder-gray-300'
                            }`}
                          />
                          {(dirty || saved) && (
                            <button
                              title={dirty ? 'Poništi izmjenu' : 'Obriši ručno unijeto'}
                              onClick={() => resetCell(a, b)}
                              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-[10px] transition-opacity w-3"
                            >✕</button>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Gornji trokut = unosiš · Donji trokut = ogledalo · Prazno = automatska procjena po položaju zone
      </p>
    </div>
  )
}
