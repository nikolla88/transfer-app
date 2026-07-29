-- ═══════════════════════════════════════════════════════════════
--  Jednokratna ispravka: Mirzoian Gurgen + Tigran (30.07.2026)
--  Već sačuvan red nosi DUPLIRANU listu imena (ista imena upisana
--  dva puta), jer je sačuvan prije nego što je fix za dedupliciranje
--  bio na live sajtu. rooming_list.all_passengers za ovaj claim je
--  već ispravan (nije dupliran) - samo prekopiravamo tu čistu
--  vrijednost u transfers.
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

update transfers
set all_passengers = (
  select string_agg(distinct trim(n), '; ')
  from rooming_list rl
  cross join lateral unnest(string_to_array(rl.all_passengers, ';')) as n
  where rl.claim_inc = 90152024
    and rl.all_passengers is not null
)
where transfer_date = '2026-07-30'
  and (tourist ilike '%MIRZOIAN%' or note ilike '%MIRZOIAN%');

-- Provjera:
-- select reservation_id, tourist, pax, all_passengers
-- from transfers
-- where transfer_date = '2026-07-30' and tourist ilike '%MIRZOIAN%';
