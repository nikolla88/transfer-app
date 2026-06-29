-- ============================================================
--  TRANSFER APP — Supabase Schema
--  Pokreni ovo u Supabase > SQL Editor > New Query
-- ============================================================

-- ── EXTENSIONS ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── VOZILA ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('car','minivan','vclass')),
  plate       TEXT,
  capacity    INTEGER DEFAULT 4,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── ZONE ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zones (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── HOTELI ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotels (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  zone_id     UUID REFERENCES zones(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS hotels_name_idx ON hotels (LOWER(name));

-- ── SUPLAJERI ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT,
  contact_person  TEXT,
  active          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── CIJENE (suplajeri × zone × tip vozila) ──────────────────
CREATE TABLE IF NOT EXISTS prices (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id   UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  zone_id       UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  vehicle_type  TEXT NOT NULL CHECK (vehicle_type IN ('car','minivan','vclass')),
  price         NUMERIC(10,2) NOT NULL DEFAULT 0,
  UNIQUE(supplier_id, zone_id, vehicle_type)
);

-- ── VOZAČI ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  vehicle_id  UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── KORISNIČKE ULOGE ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('dispatcher','driver')),
  driver_id  UUID REFERENCES drivers(id) ON DELETE SET NULL
);

-- ── LETOVI (keš iz AeroDataBox API-a) ───────────────────────
CREATE TABLE IF NOT EXISTS flights (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  flight_number   TEXT NOT NULL,
  flight_date     DATE NOT NULL,
  airport         TEXT NOT NULL CHECK (airport IN ('TIV','TGD')),
  direction       TEXT NOT NULL CHECK (direction IN ('arr','dep')),
  scheduled_time  TIME,
  actual_time     TIME,
  status          TEXT DEFAULT 'scheduled',
  delay_minutes   INTEGER DEFAULT 0,
  last_checked    TIMESTAMPTZ,
  UNIQUE(flight_number, flight_date, direction)
);

-- ── TRANSFERI ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_date       DATE NOT NULL,
  reservation_id      TEXT,
  tourist             TEXT NOT NULL,
  pax                 INTEGER DEFAULT 1,
  adl                 INTEGER DEFAULT 1,
  chd                 INTEGER DEFAULT 0,
  inf                 INTEGER DEFAULT 0,
  hotel_name          TEXT,
  hotel_id            UUID REFERENCES hotels(id) ON DELETE SET NULL,
  zone_id             UUID REFERENCES zones(id) ON DELETE SET NULL,
  flight_id           UUID REFERENCES flights(id) ON DELETE SET NULL,
  flight_number       TEXT,
  flight_time         TIME,
  type                TEXT NOT NULL CHECK (type IN ('arr','dep')),
  airport             TEXT NOT NULL CHECK (airport IN ('TIV','TGD')),
  pickup_time         TIME,
  vehicle_needed      TEXT CHECK (vehicle_needed IN ('car','minivan','vclass')),
  assigned_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  assigned_driver_id  UUID REFERENCES drivers(id) ON DELETE SET NULL,
  supplier_id         UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_price      NUMERIC(10,2),
  note                TEXT,
  transfer_type_raw   TEXT,
  status              TEXT DEFAULT 'pending',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS transfers_date_idx ON transfers(transfer_date);

-- ── GPS LOKACIJE VOZAČA ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_locations (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id    UUID REFERENCES drivers(id) ON DELETE CASCADE,
  lat          NUMERIC(10,7),
  lng          NUMERIC(10,7),
  recorded_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS driver_loc_driver_idx ON driver_locations(driver_id, recorded_at DESC);

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE vehicles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE zones             ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotels            ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE flights           ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_locations  ENABLE ROW LEVEL SECURITY;

-- Helper function: provjeri rolu trenutnog korisnika
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER
AS $$ SELECT role FROM user_roles WHERE user_id = auth.uid() $$;

CREATE OR REPLACE FUNCTION get_my_driver_id()
RETURNS UUID LANGUAGE sql SECURITY DEFINER
AS $$ SELECT driver_id FROM user_roles WHERE user_id = auth.uid() $$;

-- Dispatcher vidi sve, driver vidi samo određene stvari
-- Vehicles: svi autentifikovani korisnici mogu čitati
CREATE POLICY "auth read vehicles" ON vehicles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "dispatcher manage vehicles" ON vehicles FOR ALL USING (get_my_role() = 'dispatcher');

CREATE POLICY "auth read zones" ON zones FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "dispatcher manage zones" ON zones FOR ALL USING (get_my_role() = 'dispatcher');

CREATE POLICY "auth read hotels" ON hotels FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "dispatcher manage hotels" ON hotels FOR ALL USING (get_my_role() = 'dispatcher');

CREATE POLICY "auth read suppliers" ON suppliers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "dispatcher manage suppliers" ON suppliers FOR ALL USING (get_my_role() = 'dispatcher');

CREATE POLICY "auth read prices" ON prices FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "dispatcher manage prices" ON prices FOR ALL USING (get_my_role() = 'dispatcher');

CREATE POLICY "auth read drivers" ON drivers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "dispatcher manage drivers" ON drivers FOR ALL USING (get_my_role() = 'dispatcher');

CREATE POLICY "auth read user_roles" ON user_roles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "dispatcher manage user_roles" ON user_roles FOR ALL USING (get_my_role() = 'dispatcher');

CREATE POLICY "auth read flights" ON flights FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "dispatcher manage flights" ON flights FOR ALL USING (get_my_role() = 'dispatcher');

-- Transferi: dispatcher vidi sve, driver vidi samo svoje
CREATE POLICY "dispatcher all transfers" ON transfers FOR ALL USING (get_my_role() = 'dispatcher');
CREATE POLICY "driver own transfers" ON transfers FOR SELECT
  USING (get_my_role() = 'driver' AND assigned_driver_id = get_my_driver_id());

-- GPS: vozač upisuje svoju lokaciju, dispatcher čita sve
CREATE POLICY "driver insert location" ON driver_locations FOR INSERT
  WITH CHECK (driver_id = get_my_driver_id());
CREATE POLICY "dispatcher read locations" ON driver_locations FOR SELECT
  USING (get_my_role() = 'dispatcher');

-- ============================================================
--  INICIJALNI PODACI
-- ============================================================

-- Vozila (6 vozila kao što si opisao)
INSERT INTO vehicles (name, type, capacity) VALUES
  ('Passat 1',  'car',     4),
  ('Passat 2',  'car',     4),
  ('Passat 3',  'car',     4),
  ('Passat 4',  'car',     4),
  ('Vito',      'minivan', 7),
  ('V Class',   'vclass',  6)
ON CONFLICT DO NOTHING;

-- Zone
INSERT INTO zones (name) VALUES
  ('Budva'),
  ('Bar'),
  ('Kotor'),
  ('Ulcinj'),
  ('Podgorica'),
  ('Herceg Novi'),
  ('Tivat'),
  ('Boka'),
  ('Luštica'),
  ('Petrovac'),
  ('Bečići'),
  ('Sveti Stefan')
ON CONFLICT (name) DO NOTHING;
