-- Popravi transfer_type_raw za sve sačuvane transfere koji su zapravo GRP
-- Logika: pronađi odgovarajući zapis u rooming_list po rezervacionom broju
-- i kopiraj pravi alias (arr_transfer_alias / dep_transfer_alias)

UPDATE transfers t
SET transfer_type_raw = rl.arr_transfer_alias
FROM rooming_list rl
WHERE t.reservation_id = rl.claim_inc::text
  AND t.type = 'arr'
  AND rl.arr_transfer_alias IS NOT NULL
  AND rl.arr_transfer_alias <> 'NO TR-R'
  AND t.transfer_type_raw <> rl.arr_transfer_alias;

UPDATE transfers t
SET transfer_type_raw = rl.dep_transfer_alias
FROM rooming_list rl
WHERE t.reservation_id = rl.claim_inc::text
  AND t.type = 'dep'
  AND rl.dep_transfer_alias IS NOT NULL
  AND rl.dep_transfer_alias <> 'NO TR-R'
  AND t.transfer_type_raw <> rl.dep_transfer_alias;

-- Provjera: koliko je transfera promijenjeno po tipu
SELECT transfer_type_raw, COUNT(*) FROM transfers GROUP BY transfer_type_raw ORDER BY COUNT(*) DESC;
