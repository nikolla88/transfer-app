-- Letovi koji su u rooming listi ali nisu u flight_schedule
SELECT DISTINCT flight_number, COUNT(*) AS rezervacija
FROM (
  SELECT arr_flight_name AS flight_number FROM rooming_list
  WHERE arr_flight_name IS NOT NULL AND arr_flight_name != ''
    AND arr_transfer_alias NOT IN ('NO TR-R','')
    AND arr_revenue IS NULL
  UNION ALL
  SELECT dep_flight_name FROM rooming_list
  WHERE dep_flight_name IS NOT NULL AND dep_flight_name != ''
    AND dep_transfer_alias NOT IN ('NO TR-R','')
    AND dep_revenue IS NULL
) t
WHERE NOT EXISTS (
  SELECT 1 FROM flight_schedule fs
  WHERE fs.flight_number = t.flight_number
     OR t.flight_number = ANY(fs.aliases)
)
GROUP BY flight_number
ORDER BY rezervacija DESC;
