-- ═══════════════════════════════════════════════════════════════
--  Izleti — Faza 2: kalendar i kapacitet (samo grupni izleti)
--
--  Jedan red = jedan datum za jedan izlet. Manager otvara/zatvara
--  pojedine datume i podešava broj mjesta (kapacitet) u zavisnosti
--  od tražnje i raspoloživih autobusa.
--
--  status='open'   → datum je ponuđen, predstavnici mogu prodavati (Faza 3)
--  status='closed' → datum nije ponuđen (ali kapacitet/napomena ostaju
--                     sačuvani ako se kasnije ponovo otvori)
--
--  Nema reda za neki datum = taj datum nikad nije podešavan
--  (tretira se kao zatvoren/neponuđen).
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS excursion_dates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  excursion_id UUID NOT NULL REFERENCES excursions(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  capacity     INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (excursion_id, date)
);

CREATE INDEX IF NOT EXISTS excursion_dates_excursion_idx ON excursion_dates (excursion_id);
CREATE INDEX IF NOT EXISTS excursion_dates_date_idx       ON excursion_dates (date);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE excursion_dates ENABLE ROW LEVEL SECURITY;

-- Admin i dispečer: pun pristup (otvaranje/zatvaranje datuma, kapacitet)
DROP POLICY IF EXISTS "app_manage_excursion_dates" ON excursion_dates;
CREATE POLICY "app_manage_excursion_dates" ON excursion_dates
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- Predstavnik: samo čitanje (treba mu da vidi otvorene datume i slobodna mjesta — Faza 3)
DROP POLICY IF EXISTS "auth_rep_excursion_dates_select" ON excursion_dates;
CREATE POLICY "auth_rep_excursion_dates_select" ON excursion_dates
  FOR SELECT TO authenticated
  USING (get_my_profile_role() = 'rep');

-- Provjera:
-- SELECT e.name, d.date, d.status, d.capacity
-- FROM excursion_dates d JOIN excursions e ON e.id = d.excursion_id
-- ORDER BY d.date;
