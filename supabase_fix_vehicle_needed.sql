-- 1. Ukloni stari check constraint i dodaj novi sa 'car_comfort'
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_vehicle_needed_check;

ALTER TABLE transfers
  ADD CONSTRAINT transfers_vehicle_needed_check
  CHECK (vehicle_needed IN ('car', 'car_comfort', 'minivan', 'vclass'));

-- 2. Popravi postojeće zapise gdje je Car Comfort pogrešno sačuvan kao 'car'
UPDATE transfers t
SET vehicle_needed = 'car_comfort'
FROM rooming_list rl
WHERE t.reservation_id = rl.claim_inc::text
  AND t.type = 'arr'
  AND rl.arr_vehicle_type = 'Car Comfort'
  AND t.vehicle_needed = 'car';

UPDATE transfers t
SET vehicle_needed = 'car_comfort'
FROM rooming_list rl
WHERE t.reservation_id = rl.claim_inc::text
  AND t.type = 'dep'
  AND rl.dep_vehicle_type = 'Car Comfort'
  AND t.vehicle_needed = 'car';

-- 3. Provjera
SELECT vehicle_needed, COUNT(*) FROM transfers GROUP BY vehicle_needed ORDER BY COUNT(*) DESC;
