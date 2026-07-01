-- ═══════════════════════════════════════════════════════════════
-- Dijagnoza: zašto "bez cijene" transferi nemaju izračunat prihod
-- Pokreni u Supabase SQL Editoru i pošalji rezultate
-- ═══════════════════════════════════════════════════════════════

WITH legs AS (
  SELECT id, tourist_name, hotel_name, date_beg,
         arr_flight_name AS flight, arr_transfer_alias AS tip, 'ARR' AS dir
  FROM rooming_list
  WHERE arr_transfer_alias IS NOT NULL
    AND arr_transfer_alias NOT IN ('NO TR-R','')
    AND arr_revenue IS NULL

  UNION ALL

  SELECT id, tourist_name, hotel_name, date_end,
         dep_flight_name AS flight, dep_transfer_alias AS tip, 'DEP' AS dir
  FROM rooming_list
  WHERE dep_transfer_alias IS NOT NULL
    AND dep_transfer_alias NOT IN ('NO TR-R','')
    AND dep_revenue IS NULL
),
diagnosed AS (
  SELECT
    l.dir, l.tip, l.hotel_name, l.flight,
    CASE
      WHEN l.flight IS NULL OR l.flight = ''
        THEN '1. Let nije unesen'
      WHEN NOT EXISTS (
        SELECT 1 FROM flight_schedule fs
        WHERE fs.flight_number = l.flight OR l.flight = ANY(fs.aliases)
      ) THEN '2. Let nije u flight_schedule'
      WHEN NOT EXISTS (
        SELECT 1 FROM hotels h WHERE h.name = l.hotel_name
      ) THEN '3. Hotel nije u hotels tabeli'
      WHEN NOT EXISTS (
        SELECT 1 FROM hotels h WHERE h.name = l.hotel_name AND h.zone_id IS NOT NULL
      ) THEN '4. Hotel nema zonu'
      WHEN NOT EXISTS (
        SELECT 1 FROM sale_prices sp
        JOIN hotels h ON h.name = l.hotel_name AND h.zone_id = sp.zone_id
        JOIN flight_schedule fs ON (fs.flight_number = l.flight OR l.flight = ANY(fs.aliases))
          AND fs.airport = sp.airport
      ) THEN '5. Nema cijene za tu zonu+aerodrom'
      ELSE '6. Cijena NULL u sale_prices (kolona nije popunjena)'
    END AS razlog
  FROM legs l
)

-- ── Sumarna tabela razloga ─────────────────────────────────────
SELECT razlog, COUNT(*) AS broj_transfera
FROM diagnosed
GROUP BY razlog
ORDER BY razlog;
