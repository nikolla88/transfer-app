-- ═══════════════════════════════════════════════════════════════
--  Izleti — Faza 3: rezervacije (prodaja izleta) + vaučeri
--
--  Jedan red = jedna prodana rezervacija za jedan izlet na jedan
--  datum. Gost može biti povezan sa rooming_list (claim_inc) ili
--  nezavisan (ručno unešeno ime i hotel).
--
--  voucher_no — jedinstven rastući broj vaučera (IDENTITY kolona,
--  Postgres garantuje atomsku jedinstvenost bez posebne logike u
--  aplikaciji). Prikazuje se npr. kao "IZL-000123".
--
--  price_adult/price_child — snimljena cijena u trenutku prodaje
--  (ako se cjenovnik kasnije promijeni, stari vaučeri ostaju tačni).
--
--  Kompozitni FK ka excursion_dates sprječava rezervaciju na datum
--  koji nikad nije otvoren/podešen u kalendaru.
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS excursion_bookings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_no     BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,

  excursion_id   UUID NOT NULL REFERENCES excursions(id) ON DELETE RESTRICT,
  date           DATE NOT NULL,

  claim_inc      BIGINT,                  -- veza sa rooming_list (opciono — null = nezavisan gost)
  guest_name     TEXT NOT NULL,
  hotel_name     TEXT,
  pickup_point   TEXT,

  adult          INT NOT NULL DEFAULT 0,
  child          INT NOT NULL DEFAULT 0,
  price_adult    NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_child    NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount       NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_price    NUMERIC(10,2) NOT NULL DEFAULT 0,

  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'account')),
  rep_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  note           TEXT,

  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT excursion_bookings_pax_check CHECK (adult + child > 0),
  CONSTRAINT excursion_bookings_date_fk
    FOREIGN KEY (excursion_id, date) REFERENCES excursion_dates (excursion_id, date)
);

CREATE INDEX IF NOT EXISTS excursion_bookings_excursion_date_idx ON excursion_bookings (excursion_id, date);
CREATE INDEX IF NOT EXISTS excursion_bookings_claim_idx          ON excursion_bookings (claim_inc);
CREATE INDEX IF NOT EXISTS excursion_bookings_rep_idx            ON excursion_bookings (rep_id);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE excursion_bookings ENABLE ROW LEVEL SECURITY;

-- Admin i dispečer: pun pristup svim rezervacijama
DROP POLICY IF EXISTS "app_manage_excursion_bookings" ON excursion_bookings;
CREATE POLICY "app_manage_excursion_bookings" ON excursion_bookings
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- Predstavnik: vidi i pravi SAMO svoje rezervacije (privatnost — ne vidi tuđu prodaju)
DROP POLICY IF EXISTS "auth_rep_excursion_bookings_select" ON excursion_bookings;
CREATE POLICY "auth_rep_excursion_bookings_select" ON excursion_bookings
  FOR SELECT TO authenticated
  USING (get_my_profile_role() = 'rep' AND rep_id = auth.uid());

DROP POLICY IF EXISTS "auth_rep_excursion_bookings_insert" ON excursion_bookings;
CREATE POLICY "auth_rep_excursion_bookings_insert" ON excursion_bookings
  FOR INSERT TO authenticated
  WITH CHECK (get_my_profile_role() = 'rep' AND rep_id = auth.uid());

-- ── Agregirani broj prodatih mjesta (za kalendar) ───────────────
--  SECURITY DEFINER — vraća SAMO zbirne brojeve (bez imena gostiju,
--  cijena, ko je prodao), tako da predstavnik vidi tačnu popunjenost
--  kalendara (i tuđu prodaju u zbiru), a da ne vidi tuđe pojedinačne
--  rezervacije (to ostaje zaštićeno gore navedenim politikama).
CREATE OR REPLACE FUNCTION get_excursion_sold_counts(p_excursion_ids UUID[], p_start DATE, p_end DATE)
RETURNS TABLE(excursion_id UUID, date DATE, sold BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT excursion_id, date, SUM(adult + child)::BIGINT AS sold
  FROM excursion_bookings
  WHERE excursion_id = ANY(p_excursion_ids)
    AND date BETWEEN p_start AND p_end
    AND status = 'active'
  GROUP BY excursion_id, date;
$$;

GRANT EXECUTE ON FUNCTION get_excursion_sold_counts(UUID[], DATE, DATE) TO authenticated;

-- Provjera:
-- SELECT voucher_no, guest_name, hotel_name, adult, child, total_price, payment_method
-- FROM excursion_bookings ORDER BY created_at DESC LIMIT 20;
