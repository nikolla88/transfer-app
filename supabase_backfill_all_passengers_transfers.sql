-- ═══════════════════════════════════════════════════════════════
--  Backfill: prekopira all_passengers iz rooming_list u već
--  SAČUVAN raspored (transfers), za slučaj da si raspored sačuvao
--  PRIJE nego što si u rooming_list upisao imena putnika.
--
--  Pokreni u Supabase SQL editoru. Ne dira dodijeljena vozila,
--  vremena pokupljanja, niti bilo šta drugo u transfers - mijenja
--  SAMO all_passengers, i to samo tamo gdje je trenutno prazno.
--
--  Promijeni datum ispod na dan za koji radiš backfill.
-- ═══════════════════════════════════════════════════════════════

update transfers t
set all_passengers = rl.all_passengers
from rooming_list rl
where rl.claim_inc = regexp_replace(t.reservation_id, '_(arr|dep)[0-9]*$', '')::int
  and t.transfer_date = '2026-07-29'   -- <<< promijeni datum po potrebi
  and t.all_passengers is null
  and rl.all_passengers is not null;

-- Provjera nakon pokretanja:
-- select reservation_id, tourist, all_passengers
-- from transfers
-- where transfer_date = '2026-07-29'
-- order by reservation_id;
