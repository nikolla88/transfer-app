import { useEffect, useState } from 'react'
import { supabase, supabaseAdmin } from '../../lib/supabase'

// ── Definicija svih stranica i njihovih permisija ────────────────────────────
const PAGE_GROUPS = [
  {
    label: 'Operativne stranice',
    pages: [
      { key: 'dashboard',         label: 'Pregled',           icon: '📊' },
      { key: 'schedule',          label: 'Dnevni raspored',   icon: '📅' },
      { key: 'schedule_group',    label: 'Grupni transferi',  icon: '🚌' },
    ],
  },
  {
    label: 'Transferi i spiskovi',
    pages: [
      { key: 'transfers_departure', label: 'Lista odlazaka',    icon: '🛫' },
      { key: 'transfers_arrival',   label: 'Lista dolazaka',    icon: '🛬' },
      { key: 'rooming',             label: 'Rooming List',      icon: '🛏️' },
      { key: 'flights',             label: 'Rasporedi letova',  icon: '✈️' },
    ],
  },
  {
    label: 'Administracija',
    pages: [
      { key: 'admin_vehicles',     label: 'Vozila',           icon: '🚗' },
      { key: 'admin_drivers',      label: 'Vozači',           icon: '👤' },
      { key: 'admin_zones',        label: 'Zone',             icon: '🗺️' },
      { key: 'admin_hotels',       label: 'Hoteli',           icon: '🏨' },
      { key: 'admin_suppliers',    label: 'Suplajeri',        icon: '🤝' },
      { key: 'admin_prices',       label: 'Cijene',           icon: '💶' },
      { key: 'admin_bus_prices',   label: 'Cijene autobusa',  icon: '🚌' },
      { key: 'admin_drivetimes',   label: 'Vremena vožnje',   icon: '⏱️' },
      { key: 'admin_vehicleblocks',label: 'Blokade vozila',   icon: '🔒' },
      { key: 'sale_prices',        label: 'Cjenovnik prodaje', icon: '💰' },
      { key: 'reports',            label: 'Izvještaji',         icon: '📈' },
    ],
  },
]

const ALL_KEYS = PAGE_GROUPS.flatMap(g => g.pages.map(p => p.key))

// Defaultne permisije — sve na 'none' za novog dispečera
function defaultPerms() {
  return Object.fromEntries(ALL_KEYS.map(k => [k, 'none']))
}

// Permisija badge
function PermBadge({ value }) {
  if (value === 'write') return <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 font-medium">Piše</span>
  if (value === 'read')  return <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">Čita</span>
  return <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-400">—</span>
}

// Radio dugmad za permisiju jedne stranice
function PermRadio({ pageKey, value, onChange, disabled }) {
  return (
    <div className="flex gap-1">
      {['none', 'read', 'write'].map(lvl => (
        <label key={lvl} className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-xs font-medium border transition-colors ${
          value === lvl
            ? lvl === 'write' ? 'bg-green-500 text-white border-green-500'
            : lvl === 'read'  ? 'bg-blue-500 text-white border-blue-500'
            :                   'bg-gray-200 text-gray-600 border-gray-300'
            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
          <input
            type="radio"
            className="sr-only"
            name={pageKey}
            value={lvl}
            checked={value === lvl}
            onChange={() => !disabled && onChange(pageKey, lvl)}
            disabled={disabled}
          />
          {lvl === 'none' ? '—' : lvl === 'read' ? 'Čita' : 'Piše'}
        </label>
      ))}
    </div>
  )
}

export default function Users() {
  const [users,       setUsers]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showCreate,  setShowCreate]  = useState(false)
  const [editUser,    setEditUser]    = useState(null)   // profil koji uređujemo
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState('')

  // Forma za novog korisnika
  const [newEmail,    setNewEmail]    = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newName,     setNewName]     = useState('')
  const [newRole,     setNewRole]     = useState('dispatcher')
  const [newPerms,    setNewPerms]    = useState(defaultPerms())

  // Forma za uređivanje permisija
  const [editPerms,   setEditPerms]   = useState({})
  const [editRole,    setEditRole]    = useState('dispatcher')

  const hasAdminClient = !!supabaseAdmin

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers(data || [])
    setLoading(false)
  }

  function flash(text, isError = false) {
    setMsg(isError ? `❌ ${text}` : `✅ ${text}`)
    setTimeout(() => setMsg(''), 5000)
  }

  // ── Kreiranje korisnika ──────────────────────────────────────────────────
  async function createUser(e) {
    e.preventDefault()
    if (!hasAdminClient) return
    setSaving(true)

    try {
      // Korak 1: Kreiraj korisnika u Supabase Auth (bez user_metadata — izbjegavamo 500)
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email:         newEmail,
        password:      newPassword,
        email_confirm: true,  // aktiviraj odmah, bez email potvrde
      })

      if (authErr) throw authErr

      // Korak 2: Upiši profil direktno u profiles tabelu (service role zaobilazi RLS)
      const { error: profErr } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id:          authData.user.id,
          email:       newEmail,
          full_name:   newName,
          role:        newRole,
          permissions: newPerms,
        })

      if (profErr) throw profErr

      flash(`Korisnik ${newEmail} je uspješno kreiran.`)
      setShowCreate(false)
      setNewEmail(''); setNewPassword(''); setNewName('')
      setNewRole('dispatcher'); setNewPerms(defaultPerms())
      loadUsers()
    } catch (err) {
      flash(err.message, true)
    }

    setSaving(false)
  }

  // ── Uređivanje permisija ─────────────────────────────────────────────────
  function openEdit(user) {
    setEditUser(user)
    setEditRole(user.role)
    // Merge sa defaultPerms da se osigura da svi ključevi postoje
    setEditPerms({ ...defaultPerms(), ...user.permissions })
  }

  async function saveEdit() {
    if (!editUser) return
    setSaving(true)

    const { error } = await supabase
      .from('profiles')
      .update({ role: editRole, permissions: editPerms, full_name: editUser.full_name })
      .eq('id', editUser.id)

    if (error) { flash(error.message, true) }
    else {
      flash('Permisije sačuvane.')
      setEditUser(null)
      loadUsers()
    }
    setSaving(false)
  }

  // ── Brisanje korisnika ───────────────────────────────────────────────────
  async function deleteUser(user) {
    if (!window.confirm(`Obrisati korisnika ${user.email}?\nOva akcija se ne može poništiti.`)) return
    if (!hasAdminClient) { flash('Nedostaje service role key za brisanje korisnika.', true); return }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)
    if (error) { flash(error.message, true); return }
    // profiles se briše automatski (ON DELETE CASCADE)
    flash(`Korisnik ${user.email} je obrisan.`)
    loadUsers()
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">👥 Upravljanje korisnicima</h1>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm font-medium">{msg}</span>}
          <button
            onClick={() => setShowCreate(true)}
            disabled={!hasAdminClient}
            title={!hasAdminClient ? 'Dodaj VITE_SUPABASE_SERVICE_ROLE_KEY u .env fajl' : ''}
            className="px-4 py-2 bg-brand-500 text-white rounded font-medium text-sm hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            + Novi korisnik
          </button>
        </div>
      </div>

      {!hasAdminClient && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <strong>⚠ Kreiranje korisnika nije dostupno</strong> — dodaj{' '}
          <code className="font-mono bg-amber-100 px-1 rounded">VITE_SUPABASE_SERVICE_ROLE_KEY</code>{' '}
          u <code className="font-mono bg-amber-100 px-1 rounded">.env</code> fajl.
          Service role key nađeš u Supabase → Project Settings → API.
        </div>
      )}

      {/* Lista korisnika */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">Učitavanje...</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Korisnik</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Rola</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Pristup (pregled)</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map(u => {
                const writeCount = Object.values(u.permissions || {}).filter(v => v === 'write').length
                const readCount  = Object.values(u.permissions || {}).filter(v => v === 'read').length
                return (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{u.full_name || '—'}</div>
                      <div className="text-gray-500 text-xs">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        u.role === 'admin'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-sky-100 text-sky-700'
                      }`}>
                        {u.role === 'admin' ? '⭐ Administrator' : '🎧 Dispečer'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.role === 'admin' ? (
                        <span className="text-xs text-amber-600 font-medium">Pun pristup svemu</span>
                      ) : (
                        <span className="text-xs text-gray-500">
                          {writeCount > 0 && <span className="text-green-600 font-medium">{writeCount} piše</span>}
                          {writeCount > 0 && readCount > 0 && <span className="mx-1 text-gray-300">·</span>}
                          {readCount  > 0 && <span className="text-blue-600 font-medium">{readCount} čita</span>}
                          {writeCount === 0 && readCount === 0 && <span className="text-red-400">Nema pristupa</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(u)}
                          className="px-3 py-1 rounded border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                        >
                          ✏️ Permisije
                        </button>
                        {hasAdminClient && (
                          <button
                            onClick={() => deleteUser(u)}
                            className="px-3 py-1 rounded border border-red-200 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal: Novi korisnik ─────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-bold">Novi korisnik</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={createUser} className="px-6 py-4 space-y-5">
              {/* Osnovni podaci */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ime i prezime</label>
                  <input
                    className="input w-full"
                    placeholder="Marko Marković"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rola</label>
                  <select className="input w-full" value={newRole} onChange={e => setNewRole(e.target.value)}>
                    <option value="dispatcher">🎧 Dispečer</option>
                    <option value="admin">⭐ Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    className="input w-full"
                    type="email"
                    placeholder="marko@firma.com"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lozinka</label>
                  <input
                    className="input w-full"
                    type="password"
                    placeholder="Minimalno 6 karaktera"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>
              </div>

              {/* Permisije (samo za dispečera) */}
              {newRole === 'dispatcher' && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Permisije po stranicama</h3>
                  <PermissionsGrid perms={newPerms} onChange={(k, v) => setNewPerms(p => ({ ...p, [k]: v }))} />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2 border-t">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost">Odustani</button>
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? 'Kreiranje...' : 'Kreiraj korisnika'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Uređivanje permisija ──────────────────────────────── */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-bold">Permisije — {editUser.full_name || editUser.email}</h2>
                <div className="text-xs text-gray-500">{editUser.email}</div>
              </div>
              <button onClick={() => setEditUser(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-5">
              {/* Ime i rola */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ime i prezime</label>
                  <input
                    className="input w-full"
                    value={editUser.full_name || ''}
                    onChange={e => setEditUser(u => ({ ...u, full_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rola</label>
                  <select className="input w-full" value={editRole} onChange={e => setEditRole(e.target.value)}>
                    <option value="dispatcher">🎧 Dispečer</option>
                    <option value="admin">⭐ Administrator</option>
                  </select>
                </div>
              </div>

              {/* Permisije (samo za dispečera) */}
              {editRole === 'dispatcher' && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Permisije po stranicama</h3>
                  <PermissionsGrid
                    perms={editPerms}
                    onChange={(k, v) => setEditPerms(p => ({ ...p, [k]: v }))}
                  />
                </div>
              )}
              {editRole === 'admin' && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  ⭐ Administrator ima pun pristup svim stranicama. Individualne permisije se ne primjenjuju.
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2 border-t">
                <button onClick={() => setEditUser(null)} className="btn-ghost">Odustani</button>
                <button onClick={saveEdit} disabled={saving} className="btn-primary">
                  {saving ? 'Čuvanje...' : 'Sačuvaj'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Komponenta za grid permisija ─────────────────────────────────────────────
function PermissionsGrid({ perms, onChange }) {
  // Postavi sve na određeni nivo
  function setAll(level) {
    ALL_KEYS.forEach(k => onChange(k, level))
  }

  const allKeys = PAGE_GROUPS.flatMap(g => g.pages.map(p => p.key))

  return (
    <div className="space-y-4">
      {/* Bulk akcije */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500 mr-1">Postavi sve na:</span>
        <button onClick={() => setAll('none')}  className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-100 text-gray-600">— Ništa</button>
        <button onClick={() => setAll('read')}  className="px-2 py-1 rounded border border-blue-200 hover:bg-blue-50 text-blue-600">Čita sve</button>
        <button onClick={() => setAll('write')} className="px-2 py-1 rounded border border-green-200 hover:bg-green-50 text-green-600">Piše sve</button>
      </div>

      {/* Po grupama */}
      {PAGE_GROUPS.map(group => (
        <div key={group.label}>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group.label}</div>
          <div className="space-y-1.5">
            {group.pages.map(page => (
              <div key={page.key} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-gray-100">
                <span className="text-sm text-gray-700">
                  <span className="mr-1.5">{page.icon}</span>
                  {page.label}
                </span>
                <PermRadio
                  pageKey={page.key}
                  value={perms[page.key] ?? 'none'}
                  onChange={onChange}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

