-- ═══════════════════════════════════════════════════════════════
-- Detalji po svakoj kategoriji problema
-- ═══════════════════════════════════════════════════════════════

-- ── Problem 2: Koji letovi nisu u flight_schedule ─────────────
SELECT DISTINCT
  COALESCE(arr_flight_name, dep_flight_name) AS flight_number,
  COUNT(*) AS rezervacija
FROM rooming_list
WHERE (
  (arr_transfer_alias NOT IN ('NO TR-R','') AND arr_revenue IS NULL AND arr_flight_name IS NOT NULL AND arr_flight_name != '')
  OR
  (dep_transfer_alias NOT IN ('NO TR-R','') AND dep_revenue IS NULL AND dep_flight_name IS NOT NULL AND dep_flight_name != '')
)
AND NOT EXISTS (
  SELECT 1 FROM flight_schedule fs
  WHERE fs.flight_number = COALESCE(arr_flight_name, dep_flight_name)
     OR COALESCE(arr_flight_name, dep_flight_name) = ANY(fs.aliases)
)
GROUP BY 1
ORDER BY 2 DESC;

-- ── Problem 3: Koji hoteli nisu u hotels tabeli ───────────────
SELECT DISTINCT hotel_name, COUNT(*) AS rezervacija
FROM rooming_list
WHERE hotel_name IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM hotels h WHERE h.name = hotel_name)
  AND (
    (arr_transfer_alias NOT IN ('NO TR-R','') AND arr_revenue IS NULL)
    OR
    (dep_transfer_alias NOT IN ('NO TR-R','') AND dep_revenue IS NULL)
  )
GROUP BY hotel_name
ORDER BY rezervacija DESC;

-- ── Problem 4: Koje zone/aerodrom nemaju popunjene cijene ─────
SELECT
  z.name AS zona,
  sp.airport,
  CASE
    WHEN sp.group_adt IS NULL THEN 'group_adt'
    WHEN sp.ind_econ   IS NULL THEN 'ind_econ'
    WHEN sp.ind_comfort IS NULL THEN 'ind_comfort'
    WHEN sp.minivan    IS NULL THEN 'minivan'
    WHEN sp.v_class    IS NULL THEN 'v_class'
  END AS kolona_bez_cijene,
  COUNT(rl.id) AS rezervacija_pogodjena
FROM sale_prices sp
JOIN zones z ON z.id = sp.zone_id
JOIN hotels h ON h.zone_id = sp.zone_id
JOIN rooming_list rl ON rl.hotel_name = h.name
JOIN flight_schedule fs ON (
  fs.flight_number = rl.arr_flight_name OR rl.arr_flight_name = ANY(fs.aliases)
  OR fs.flight_number = rl.dep_flight_name OR rl.dep_flight_name = ANY(fs.aliases)
) AND fs.airport = sp.airport
WHERE (sp.group_adt IS NULL OR sp.ind_econ IS NULL OR sp.minivan IS NULL OR sp.v_class IS NULL)
  AND (rl.arr_revenue IS NULL OR rl.dep_revenue IS NULL)
GROUP BY z.name, sp.airport, kolona_bez_cijene
ORDER BY rezervacija_pogodjena DESC, z.name;
