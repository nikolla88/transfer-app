import { createContext, useContext, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Vehicles from './pages/admin/Vehicles'
import Drivers from './pages/admin/Drivers'
import Zones from './pages/admin/Zones'
import Hotels from './pages/admin/Hotels'
import Suppliers from './pages/admin/Suppliers'
import Prices from './pages/admin/Prices'
import DriveTimesPage from './pages/admin/DriveTimesPage'
import VehicleBlocks from './pages/admin/VehicleBlocks'
import DailySchedule from './pages/operations/DailySchedule'
import RoomingList    from './pages/RoomingList'
import FlightSchedule from './pages/FlightSchedule'
import DepartureList  from './pages/DepartureList'
import ArrivalList    from './pages/ArrivalList'
import GroupSchedule  from './pages/operations/GroupSchedule'
import BusPrices      from './pages/admin/BusPrices'
import Users          from './pages/admin/Users'

// ── Auth Context ─────────────────────────────────────────────
const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

// Dozvoljene vrijednosti permisija po stranici
// 'none' = ne vidi, 'read' = samo čita, 'write' = može i mijenjati
const PERM_NONE  = 'none'
const PERM_READ  = 'read'
const PERM_WRITE = 'write'

function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = učitavanje
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, s) => {
      setSession(s)
      if (s) loadProfile(s.user.id); else setProfile(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(uid) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single()
    setProfile(data || { _fallback: true }) // fallback ako nema zapisa u bazi
  }

  // Ako nema profila u bazi (SQL nije pokrenut ili INSERT nije prošao)
  // → tretiramo kao admin da se ne blokira pristup
  const isAdmin = !profile || profile._fallback || profile?.role === 'admin'

  // Vrati nivo permisije za datu stranicu ('none' ako nije definirano)
  function perm(key) {
    if (isAdmin) return PERM_WRITE
    return profile?.permissions?.[key] ?? PERM_NONE
  }

  // Da li korisnik može vidjeti stranicu (read ili write)
  function canRead(key) {
    return perm(key) === PERM_READ || perm(key) === PERM_WRITE
  }

  // Da li korisnik može unositi/mijenjati podatke
  function canWrite(key) {
    return perm(key) === PERM_WRITE
  }

  if (session === undefined) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">
        Učitavanje...
      </div>
    )
  }

  return (
    <AuthCtx.Provider value={{ session, profile, isAdmin, canRead, canWrite }}>
      {children}
    </AuthCtx.Provider>
  )
}

function RequireAuth({ children }) {
  const { session } = useAuth()
  return session ? children : <Navigate to="/login" replace />
}

// Zaštiti rutu: preusmjeri na /dashboard ako korisnik nema pristup stranici
// Za dashboard i __admin_only__ → prikaži poruku umjesto beskonačnog redirecta
function RequirePermission({ permKey, children }) {
  const { isAdmin, canRead } = useAuth()
  if (isAdmin || canRead(permKey)) return children
  if (permKey === 'dashboard' || permKey === '__admin_only__') {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 flex-col gap-3">
        <div className="text-4xl">🔒</div>
        <p className="text-lg font-medium">Nemate pristup ovoj stranici.</p>
        <p className="text-sm">Kontaktirajte administratora.</p>
      </div>
    )
  }
  return <Navigate to="/dashboard" replace />
}

// ── App ──────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Navigate to="/dashboard" replace />} />

            {/* Operativne stranice */}
            <Route path="dashboard"
              element={<RequirePermission permKey="dashboard"><Dashboard /></RequirePermission>} />
            <Route path="schedule"
              element={<RequirePermission permKey="schedule"><DailySchedule /></RequirePermission>} />
            <Route path="schedule/group"
              element={<RequirePermission permKey="schedule_group"><GroupSchedule /></RequirePermission>} />

            {/* Transferi */}
            <Route path="transfers/departure"
              element={<RequirePermission permKey="transfers_departure"><DepartureList /></RequirePermission>} />
            <Route path="transfers/arrival"
              element={<RequirePermission permKey="transfers_arrival"><ArrivalList /></RequirePermission>} />

            {/* Rooming & letovi */}
            <Route path="rooming"
              element={<RequirePermission permKey="rooming"><RoomingList /></RequirePermission>} />
            <Route path="flights"
              element={<RequirePermission permKey="flights"><FlightSchedule /></RequirePermission>} />

            {/* Admin stranice — samo admin ili sa dopuštenjem */}
            <Route path="admin/vehicles"
              element={<RequirePermission permKey="admin_vehicles"><Vehicles /></RequirePermission>} />
            <Route path="admin/drivers"
              element={<RequirePermission permKey="admin_drivers"><Drivers /></RequirePermission>} />
            <Route path="admin/zones"
              element={<RequirePermission permKey="admin_zones"><Zones /></RequirePermission>} />
            <Route path="admin/hotels"
              element={<RequirePermission permKey="admin_hotels"><Hotels /></RequirePermission>} />
            <Route path="admin/suppliers"
              element={<RequirePermission permKey="admin_suppliers"><Suppliers /></RequirePermission>} />
            <Route path="admin/prices"
              element={<RequirePermission permKey="admin_prices"><Prices /></RequirePermission>} />
            <Route path="admin/bus-prices"
              element={<RequirePermission permKey="admin_bus_prices"><BusPrices /></RequirePermission>} />
            <Route path="admin/drivetimes"
              element={<RequirePermission permKey="admin_drivetimes"><DriveTimesPage /></RequirePermission>} />
            <Route path="admin/vehicleblocks"
              element={<RequirePermission permKey="admin_vehicleblocks"><VehicleBlocks /></RequirePermission>} />

            {/* Korisnici — samo admin */}
            <Route path="admin/users"
              element={<RequirePermission permKey="__admin_only__"><Users /></RequirePermission>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
