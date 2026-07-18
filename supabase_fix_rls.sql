-- ═══════════════════════════════════════════════════════════════
--  Fix RLS — migracija sa user_roles na profiles tabelu
--
--  PROBLEM: Stari RLS koristi get_my_role() → user_roles tabela.
--           Novi korisnici su samo u profiles tabeli → RLS ih blokira.
--
--  RJEŠENJE: Nova helper funkcija + ažurirane politike za sve tabele.
--
--  Pokreni u Supabase SQL editoru (Database → SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Nova helper funkcija (čita iz profiles, ne user_roles) ───
CREATE OR REPLACE FUNCTION get_my_profile_role()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- ── 2. TRANSFERS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "dispatcher all transfers"  ON transfers;
DROP POLICY IF EXISTS "driver own transfers"       ON transfers;
DROP POLICY IF EXISTS "app_user_all_transfers"     ON transfers;

CREATE POLICY "app_user_all_transfers" ON transfers
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 3. ROOMING LIST ──────────────────────────────────────────────
--  (Vjerovatno nema nikakvih politika — dodajemo)
ALTER TABLE rooming_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_rooming_list"  ON rooming_list;
DROP POLICY IF EXISTS "all_rooming_list"        ON rooming_list;

CREATE POLICY "auth_all_rooming_list" ON rooming_list
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 4. VEHICLES ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "dispatcher manage vehicles" ON vehicles;
DROP POLICY IF EXISTS "app_manage_vehicles"        ON vehicles;

CREATE POLICY "app_manage_vehicles" ON vehicles
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 5. ZONES ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "dispatcher manage zones" ON zones;
DROP POLICY IF EXISTS "app_manage_zones"        ON zones;

CREATE POLICY "app_manage_zones" ON zones
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 6. HOTELS ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "dispatcher manage hotels" ON hotels;
DROP POLICY IF EXISTS "app_manage_hotels"        ON hotels;

CREATE POLICY "app_manage_hotels" ON hotels
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 7. SUPPLIERS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "dispatcher manage suppliers" ON suppliers;
DROP POLICY IF EXISTS "app_manage_suppliers"        ON suppliers;

CREATE POLICY "app_manage_suppliers" ON suppliers
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 8. PRICES ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "dispatcher manage prices" ON prices;
DROP POLICY IF EXISTS "app_manage_prices"        ON prices;

CREATE POLICY "app_manage_prices" ON prices
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 9. DRIVERS ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "dispatcher manage drivers" ON drivers;
DROP POLICY IF EXISTS "app_manage_drivers"        ON drivers;

CREATE POLICY "app_manage_drivers" ON drivers
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 10. FLIGHTS (flight_schedule) ───────────────────────────────
DROP POLICY IF EXISTS "dispatcher manage flights" ON flights;
DROP POLICY IF EXISTS "app_manage_flights"        ON flights;

CREATE POLICY "app_manage_flights" ON flights
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- Provjeri da flight_schedule tabela ima politike
ALTER TABLE IF EXISTS flight_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_flight_schedule" ON flight_schedule;
CREATE POLICY "auth_all_flight_schedule" ON flight_schedule
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 11. USER_ROLES ───────────────────────────────────────────────
DROP POLICY IF EXISTS "dispatcher manage user_roles" ON user_roles;
DROP POLICY IF EXISTS "app_manage_user_roles"        ON user_roles;

CREATE POLICY "app_manage_user_roles" ON user_roles
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 12. DRIVER LOCATIONS ─────────────────────────────────────────
DROP POLICY IF EXISTS "dispatcher read locations" ON driver_locations;
DROP POLICY IF EXISTS "app_read_locations"        ON driver_locations;

CREATE POLICY "app_read_locations" ON driver_locations
  FOR SELECT TO authenticated
  USING (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 13. SALE PRICES ──────────────────────────────────────────────
ALTER TABLE IF EXISTS sale_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_sale_prices" ON sale_prices;
CREATE POLICY "auth_all_sale_prices" ON sale_prices
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 14. VEHICLE COSTS ────────────────────────────────────────────
ALTER TABLE IF EXISTS vehicle_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_vehicle_costs" ON vehicle_costs;
CREATE POLICY "auth_all_vehicle_costs" ON vehicle_costs
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── 15. VEHICLE RENTALS ──────────────────────────────────────────
ALTER TABLE IF EXISTS vehicle_rentals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_vehicle_rentals" ON vehicle_rentals;
CREATE POLICY "auth_all_vehicle_rentals" ON vehicle_rentals
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- ── PROVJERA (pokreni nakon migracije) ──────────────────────────
-- SELECT tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
