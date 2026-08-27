-- ═══════════════════════════════════════════════════════════════
--  Izleti — Faza 1: katalog izleta (proizvodi)
--
--  Jedan red = jedan izlet (npr. "Ostrog"), sa svim detaljima:
--  opis, slike (linkovi), video (link), itinerer (strukturisan
--  po tačkama: vrijeme + naslov + opis), cijena, trajanje.
--
--  type = 'grupni'      → ima kalendar i deljeni kapacitet (Faza 2)
--  type = 'individualni' → nema deljeni kalendar, rezervuje se ad-hoc
--
--  default_capacity — podrazumijevani broj mjesta kad menadžer
--  otvori novi datum za grupni izlet (može se promijeniti po datumu).
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS excursions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'grupni' CHECK (type IN ('grupni', 'individualni')),
  description      TEXT,
  meeting_point    TEXT,
  duration_label   TEXT,                              -- npr. "Cijeli dan (8h)"
  price_adult      NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_child      NUMERIC(10,2) NOT NULL DEFAULT 0,
  default_capacity INT,                                -- samo za grupni tip
  images           TEXT[] NOT NULL DEFAULT '{}',        -- linkovi ka slikama
  video_url        TEXT,                                -- link ka videu (YouTube i sl.)
  itinerary        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{time, title, description}, ...]
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS excursions_active_idx ON excursions (active);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE excursions ENABLE ROW LEVEL SECURITY;

-- Admin i dispečer: pun pristup (kreiranje/izmjena/brisanje kataloga)
DROP POLICY IF EXISTS "app_manage_excursions" ON excursions;
CREATE POLICY "app_manage_excursions" ON excursions
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- Predstavnik: samo čitanje (treba mu katalog da bi prodavao izlete — Faza 3)
DROP POLICY IF EXISTS "auth_rep_excursions_select" ON excursions;
CREATE POLICY "auth_rep_excursions_select" ON excursions
  FOR SELECT TO authenticated
  USING (get_my_profile_role() = 'rep');

-- Provjera:
-- SELECT id, name, type, price_adult, active FROM excursions ORDER BY name;
