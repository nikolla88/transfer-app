-- ═══════════════════════════════════════════════════════════════
--  Jednokratna ispravka: Barmin/Barmina spojeni transfer (29.07.2026)
--  koji je sačuvan PRIJE nego što je fix za spajanje imena kod
--  ručnog "Spoji" bio na live sajtu - zato ima samo imena iz jedne
--  od dvije spojene rezervacije. Ovo ne dira nijedan drugi red.
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

update transfers
set all_passengers = (
  select string_agg(distinct trim(n), '; ')
  from rooming_list rl
  cross join lateral unnest(string_to_array(rl.all_passengers, ';')) as n
  where rl.claim_inc in (21222577, 21222578)
    and rl.all_passengers is not null
)
where transfer_date = '2026-07-29'
  and note ilike '%BARMIN%';

-- Provjera:
-- select reservation_id, tourist, pax, all_passengers
-- from transfers
-- where transfer_date = '2026-07-29' and note ilike '%BARMIN%';
