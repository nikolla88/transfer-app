-- ═══════════════════════════════════════════════════════════════
--  Jednokratna ispravka: rezervacija 90150046 (Bulatov/Dyupina)
--  Isti uzrok kao i Mirzoian slučaj - već sačuvan red nosi dupliranu
--  listu imena, sačuvan prije fixa za dedupliciranje.
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

update transfers
set all_passengers = (
  select string_agg(distinct trim(n), '; ')
  from rooming_list rl
  cross join lateral unnest(string_to_array(rl.all_passengers, ';')) as n
  where rl.claim_inc = 90150046
    and rl.all_passengers is not null
)
where reservation_id ilike '90150046%';

-- Provjera:
-- select reservation_id, tourist, pax, all_passengers
-- from transfers
-- where reservation_id ilike '90150046%';
