-- ═══════════════════════════════════════════════════════════════
--  Izleti — proširenje rezervacija: bebe, partner, tip, status
--
--  1. infant           — broj beba (ne računa se u cijenu ni u
--                         "ukupno putnika", samo informativno)
--  2. partner          — partner agencija preko koje je gost došao
--                         (povlači se iz rooming_list.partner_alias)
--  3. reservation_type — GRP/SHA/IND transfera gosta iz rooming liste
--                         (rooming_list.arr_transfer_alias) — NIJE
--                         isto što i tip izleta (grupni/individualni)
--  4. status — prošireno sa 'active'/'cancelled' na puni tok:
--       reserved  — rezervisano, još nije naplaćeno
--       paid      — predstavnik je predao novac firmi
--       cancelled — otkazano bez penala
--       penalty   — otkazano sa penalom
--
--  Pokreni u Supabase SQL editoru (posle supabase_excursion_bookings.sql).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE excursion_bookings ADD COLUMN IF NOT EXISTS infant           INT NOT NULL DEFAULT 0;
ALTER TABLE excursion_bookings ADD COLUMN IF NOT EXISTS partner          TEXT;
ALTER TABLE excursion_bookings ADD COLUMN IF NOT EXISTS reservation_type TEXT;

-- Proširi status opcije (staro 'active' → 'reserved')
ALTER TABLE excursion_bookings DROP CONSTRAINT IF EXISTS excursion_bookings_status_check;
UPDATE excursion_bookings SET status = 'reserved' WHERE status = 'active';
ALTER TABLE excursion_bookings ALTER COLUMN status SET DEFAULT 'reserved';
ALTER TABLE excursion_bookings ADD CONSTRAINT excursion_bookings_status_check
  CHECK (status IN ('reserved', 'paid', 'cancelled', 'penalty'));

-- Preračunaj popunjenost: broji samo rezervisano+plaćeno (otkazano/penal oslobađaju mjesto)
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
    AND status IN ('reserved', 'paid')
  GROUP BY excursion_id, date;
$$;

GRANT EXECUTE ON FUNCTION get_excursion_sold_counts(UUID[], DATE, DATE) TO authenticated;
