import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, REP_ALLOWED_KEYS } from '../App'

// Sve stranice sa ključevima permisija
// permKey: null = uvijek vidljivo | '__admin_only__' = samo admin
const NAV_ITEMS = [
  { to: '/dashboard',        icon: '📊', label: 'Pregled',           permKey: 'dashboard'          },
  { to: '/schedule',         icon: '📅', label: 'Dnevni raspored',   permKey: 'schedule'           },
  { divider: true },
  { to: '/admin/vehicles',   icon: '🚗', label: 'Vozila',            permKey: 'admin_vehicles'     },
  { to: '/admin/drivers',    icon: '👤', label: 'Vozači',            permKey: 'admin_drivers'      },
  { to: '/admin/zones',      icon: '🗺️', label: 'Zone',              permKey: 'admin_zones'        },
  { to: '/admin/hotels',     icon: '🏨', label: 'Hoteli',            permKey: 'admin_hotels'       },
  { to: '/admin/suppliers',  icon: '🤝', label: 'Suplajeri',         permKey: 'admin_suppliers'    },
  { to: '/admin/prices',     icon: '💶', label: 'Cijene',            permKey: 'admin_prices'       },
  { to: '/admin/bus-prices', icon: '🚌', label: 'Cijene autobusa',   permKey: 'admin_bus_prices'   },
  { to: '/admin/drivetimes', icon: '⏱️', label: 'Vremena vožnje',   permKey: 'admin_drivetimes'   },
  { to: '/admin/vehicle-rentals', icon: '🔑', label: 'Najam vozila',  permKey: 'admin_vehicleblocks'},
  { to: '/admin/vehicle-costs',       icon: '💸', label: 'Troškovi vozila',  permKey: 'admin_vehicle_costs'},
  { to: '/admin/supplier-accounting', icon: '💳', label: 'Obračun suplajera', permKey: 'admin_accounting'   },
  { divider: true },
  { to: '/rooming',             icon: '🛏️', label: 'Rooming List',    permKey: 'rooming'           },
  { to: '/flights',             icon: '✈️',  label: 'Rasporedi letova',permKey: 'flights'           },
  { divider: true },
  { to: '/transfers/departure', icon: '🛫', label: 'Lista odlazaka',  permKey: 'transfers_departure'},
  { to: '/transfers/arrival',   icon: '🛬', label: 'Lista dolazaka',  permKey: 'transfers_arrival'  },
  { to: '/schedule/group',      icon: '🚌', label: 'Grupni transferi',permKey: 'schedule_group'     },
  { to: '/rep',                 icon: '📱', label: 'Moj raspored',    permKey: 'rep_arrivals'       },
  { divider: true },
  { to: '/admin/excursions',    icon: '🏝️', label: 'Izleti',          permKey: 'admin_excursions'   },
  { to: '/admin/excursions/calendar', icon: '📅', label: 'Kalendar izleta', permKey: 'excursions_calendar' },
  { divider: true },
  { to: '/sale-prices',         icon: '💰', label: 'Cjenovnik prodaje', permKey: 'sale_prices'       },
  { to: '/reports',             icon: '📈', label: 'Izvještaji',         permKey: 'reports'           },
  { to: '/admin/users',         icon: '👥', label: 'Korisnici',         permKey: '__admin_only__'    },
]

export default function Layout() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { session, profile, isAdmin, isRep, canRead } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Zatvori meni pri svakoj navigaciji
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // Filtriranje vidljivih stavki menija
  function isVisible(item) {
    // Predstavnik vidi samo ograničeni skup stranica
    if (isRep) return REP_ALLOWED_KEYS.includes(item.permKey)
    if (!item.permKey) return true
    if (item.permKey === '__admin_only__') return isAdmin
    return isAdmin || canRead(item.permKey)
  }

  // Provjeri da li sekcija (između dvaju dividerа) ima barem jednu vidljivu stavku
  function buildVisibleNav() {
    const result = []
    let pendingDivider = null

    for (const item of NAV_ITEMS) {
      if (item.divider) {
        pendingDivider = item
        continue
      }
      if (isVisible(item)) {
        if (pendingDivider) {
          result.push(pendingDivider)
          pendingDivider = null
        }
        result.push(item)
      }
    }
    return result
  }

  const visibleNav = buildVisibleNav()

  // Sadržaj sidebar-a — isti za desktop i mobile overlay
  function SidebarContent() {
    return (
      <>
        <div className="px-4 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-white">🚗 Transfer App</div>
            <div className="text-xs text-gray-400 mt-0.5">{session?.user?.email}</div>
            {profile && (
              <div className={`text-xs mt-1 font-medium ${
                isAdmin ? 'text-amber-400' : isRep ? 'text-green-400' : 'text-sky-400'
              }`}>
                {isAdmin ? '⭐ Administrator' : isRep ? '📱 Predstavnik' : '🎧 Dispečer'}
              </div>
            )}
          </div>
          {/* Dugme za zatvaranje — vidljivo samo na mobilnom */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-gray-400 hover:text-white text-2xl leading-none p-1"
          >✕</button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {visibleNav.map((item, i) => {
            if (item.divider) return (
              <div key={`div-${i}`} className="border-t border-gray-700 my-1.5" />
            )
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded text-sm transition-colors ${
                    isActive
                      ? 'bg-brand-500 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="px-2 py-3 border-t border-gray-700">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <span>🚪</span> Odjava
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Mobilna gornja traka ─────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-gray-900 text-white flex items-center px-4 gap-3 flex-shrink-0 shadow-lg">
        <button onClick={() => setMobileOpen(true)} className="text-xl p-1 text-gray-300 hover:text-white">
          ☰
        </button>
        <span className="font-bold text-sm">🚗 Transfer App</span>
      </div>

      {/* ── Mobile sidebar overlay ───────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          {/* Sidebar panel */}
          <aside className="relative z-10 w-64 bg-gray-900 text-gray-200 flex flex-col h-full shadow-2xl">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar ──────────────────────── */}
      <aside className="hidden md:flex w-56 bg-gray-900 text-gray-200 flex-col flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* ── Main content ────────────────────────── */}
      {/* Na mobilnom: padding-top 48px zbog fiksne gornje trake */}
      <main className="flex-1 overflow-y-auto pt-12 md:pt-0">
        <Outlet />
      </main>
    </div>
  )
}
