import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../App'

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
  { to: '/admin/vehicleblocks', icon: '🔒', label: 'Blokade vozila', permKey: 'admin_vehicleblocks'},
  { divider: true },
  { to: '/rooming',             icon: '🛏️', label: 'Rooming List',    permKey: 'rooming'           },
  { to: '/flights',             icon: '✈️',  label: 'Rasporedi letova',permKey: 'flights'           },
  { divider: true },
  { to: '/transfers/departure', icon: '🛫', label: 'Lista odlazaka',  permKey: 'transfers_departure'},
  { to: '/transfers/arrival',   icon: '🛬', label: 'Lista dolazaka',  permKey: 'transfers_arrival'  },
  { to: '/schedule/group',      icon: '🚌', label: 'Grupni transferi',permKey: 'schedule_group'     },
  { divider: true },
  { to: '/sale-prices',         icon: '💰', label: 'Cjenovnik prodaje', permKey: 'sale_prices'       },
  { to: '/reports',             icon: '📈', label: 'Izvještaji',         permKey: 'reports'           },
  { to: '/admin/users',         icon: '👥', label: 'Korisnici',         permKey: '__admin_only__'    },
]

export default function Layout() {
  const navigate = useNavigate()
  const { session, profile, isAdmin, canRead } = useAuth()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // Filtriranje vidljivih stavki menija
  function isVisible(item) {
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

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-gray-200 flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-gray-700">
          <div className="text-lg font-bold text-white">🚗 Transfer App</div>
          <div className="text-xs text-gray-400 mt-0.5">{session?.user?.email}</div>
          {profile && (
            <div className={`text-xs mt-1 font-medium ${
              isAdmin ? 'text-amber-400' : 'text-sky-400'
            }`}>
              {isAdmin ? '⭐ Administrator' : '🎧 Dispečer'}
            </div>
          )}
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
                  `flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors ${
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
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
