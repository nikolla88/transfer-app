-- ═══════════════════════════════════════════════════════════════
--  Odlazak — "ukrcan u bus" checkbox za predstavnike
--
--  Kad predstavnik na terenu pokupi gosta (kod odlaska), označi ga
--  kao ukrcanog — isto kao da je precrtao ime na papiru. Ostaje
--  sačuvano u bazi (rooming_list), pa se ne gubi na refresh/drugi
--  telefon.
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE rooming_list
  ADD COLUMN IF NOT EXISTS dep_picked_up BOOLEAN NOT NULL DEFAULT false;

-- RLS: rep već ima UPDATE pravo na cijelu rooming_list tabelu
-- (auth_rep_rooming_list_update politika, iz supabase_rep_role.sql),
-- tako da nije potrebna dodatna politika.

-- Provjera:
-- SELECT claim_inc, tourist_name, dep_transfer_alias, dep_pick_time, dep_picked_up
-- FROM rooming_list WHERE date_end = CURRENT_DATE ORDER BY dep_pick_time;
