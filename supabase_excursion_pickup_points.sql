-- ═══════════════════════════════════════════════════════════════
--  Izleti — Faza 3: pickup tačke po hotelu, specifične za izlet
--
--  Isti hotel može imati RAZLIČITU pickup tačku za različite izlete
--  (npr. Montenegro Beach → "Market Bečići" za Ostrog, ali → "Aqua
--  Park" za Albaniju). Ova tabela čuva te izuzetke. Ako za neki
--  hotel+izlet ne postoji red ovdje, aplikacija koristi opštu
--  hotels.pickup_point kao predlog (koji se uvijek može ručno
--  izmijeniti pri unosu rezervacije).
--
--  Redovi se dodaju postepeno — kad predstavnik pri prodaji čekira
--  "Zapamti ovu tačku", aplikacija upisuje/ažurira red ovdje.
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS excursion_pickup_points (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  excursion_id  UUID NOT NULL REFERENCES excursions(id) ON DELETE CASCADE,
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  pickup_point  TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (excursion_id, hotel_id)
);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE excursion_pickup_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_manage_excursion_pickup_points" ON excursion_pickup_points;
CREATE POLICY "app_manage_excursion_pickup_points" ON excursion_pickup_points
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- Predstavnik: čita postojeće tačke (za predlog pri prodaji) i može
-- upisati/izmijeniti (kad čekira "Zapamti ovu tačku" u formi prodaje).
DROP POLICY IF EXISTS "auth_rep_excursion_pickup_points_select" ON excursion_pickup_points;
CREATE POLICY "auth_rep_excursion_pickup_points_select" ON excursion_pickup_points
  FOR SELECT TO authenticated
  USING (get_my_profile_role() = 'rep');

DROP POLICY IF EXISTS "auth_rep_excursion_pickup_points_upsert" ON excursion_pickup_points;
CREATE POLICY "auth_rep_excursion_pickup_points_upsert" ON excursion_pickup_points
  FOR INSERT TO authenticated
  WITH CHECK (get_my_profile_role() = 'rep');

DROP POLICY IF EXISTS "auth_rep_excursion_pickup_points_update" ON excursion_pickup_points;
CREATE POLICY "auth_rep_excursion_pickup_points_update" ON excursion_pickup_points
  FOR UPDATE TO authenticated
  USING    (get_my_profile_role() = 'rep')
  WITH CHECK (get_my_profile_role() = 'rep');
