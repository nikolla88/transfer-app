-- ═══════════════════════════════════════════════════════════
-- Sale Prices — sve zone, poznate cijene popunjene
-- Pokreni u Supabase SQL Editoru
-- ═══════════════════════════════════════════════════════════

-- ── Korak 1: Kreira tabelu sa zone_id FK ─────────────────────
DROP TABLE IF EXISTS sale_prices;

CREATE TABLE sale_prices (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  airport     TEXT    NOT NULL CHECK (airport IN ('TIV', 'TGD')),
  zone_id     UUID    NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  group_adt   NUMERIC,
  group_chd   NUMERIC,
  ind_econ    NUMERIC,
  ind_comfort NUMERIC,
  minivan     NUMERIC,
  v_class     NUMERIC,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (airport, zone_id)
);

ALTER TABLE sale_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp_read"  ON sale_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "sp_write" ON sale_prices FOR ALL    TO authenticated USING (true);

-- ── Korak 2: Dodaj red za svaku zonu × aerodrom (cijene NULL) ─
INSERT INTO sale_prices (airport, zone_id)
SELECT a.airport, z.id
FROM zones z
CROSS JOIN (VALUES ('TIV'), ('TGD')) AS a(airport)
ON CONFLICT (airport, zone_id) DO NOTHING;

-- ── Korak 3: Popuni poznate cijene iz cjenovnika Pasha 2026 ───
UPDATE sale_prices sp
SET
  group_adt   = p.ga,
  group_chd   = p.gc,
  ind_econ    = p.ie,
  ind_comfort = p.ic,
  minivan     = p.mn,
  v_class     = p.vc,
  updated_at  = NOW()
FROM (
  SELECT 'TIV' AS airport, id AS zone_id, 11 AS ga, 8 AS gc, 50 AS ie, 70 AS ic, 100 AS mn, 150 AS vc FROM zones WHERE name = 'Budva'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 11 AS ga, 8 AS gc, 50 AS ie, 70 AS ic, 100 AS mn, 150 AS vc FROM zones WHERE name = 'Jaz'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 12 AS ga, 9 AS gc, 55 AS ie, 75 AS ic, 100 AS mn, 150 AS vc FROM zones WHERE name = 'Becici'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 12 AS ga, 9 AS gc, 55 AS ie, 75 AS ic, 100 AS mn, 150 AS vc FROM zones WHERE name = 'Rafailovici'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 13 AS ga, 10 AS gc, 60 AS ie, 80 AS ic, 110 AS mn, 160 AS vc FROM zones WHERE name = 'Przno'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 13 AS ga, 10 AS gc, 60 AS ie, 80 AS ic, 110 AS mn, 160 AS vc FROM zones WHERE name = 'Sv. Stefan'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 14 AS ga, 10 AS gc, 65 AS ie, 85 AS ic, 115 AS mn, 165 AS vc FROM zones WHERE name = 'Rezevici'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 14 AS ga, 10 AS gc, 65 AS ie, 85 AS ic, 115 AS mn, 165 AS vc FROM zones WHERE name = 'Petrovac'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 70 AS ie, 90 AS ic, 120 AS mn, 175 AS vc FROM zones WHERE name = 'Canj'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 75 AS ie, 95 AS ic, 130 AS mn, 180 AS vc FROM zones WHERE name = 'Sutomore'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 75 AS ie, 95 AS ic, 130 AS mn, 180 AS vc FROM zones WHERE name = 'Bar'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 100 AS ie, 120 AS ic, 150 AS mn, 200 AS vc FROM zones WHERE name = 'Dobra Voda'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 100 AS ie, 120 AS ic, 150 AS mn, 200 AS vc FROM zones WHERE name = 'Ulcinj'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 120 AS ie, 125 AS ic, 160 AS mn, 210 AS vc FROM zones WHERE name = 'Ada Bojana'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 30 AS ie, 50 AS ic, 60 AS mn, 110 AS vc FROM zones WHERE name = 'Tivat'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 45 AS ie, 65 AS ic, 80 AS mn, 130 AS vc FROM zones WHERE name = 'Lustica'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 45 AS ie, 65 AS ic, 80 AS mn, 130 AS vc FROM zones WHERE name = 'Kotor'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 45 AS ie, 65 AS ic, 80 AS mn, 130 AS vc FROM zones WHERE name = 'Prcanj'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 45 AS ie, 65 AS ic, 80 AS mn, 130 AS vc FROM zones WHERE name = 'Dobrota'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 50 AS ie, 75 AS ic, 85 AS mn, 135 AS vc FROM zones WHERE name = 'Vrmac - Hyatt'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 50 AS ie, 75 AS ic, 85 AS mn, 135 AS vc FROM zones WHERE name = 'Orahovac'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 55 AS ie, 75 AS ic, 95 AS mn, 145 AS vc FROM zones WHERE name = 'Perast'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 55 AS ie, 75 AS ic, 95 AS mn, 145 AS vc FROM zones WHERE name = 'Risan'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 19 AS ga, 14 AS gc, 75 AS ie, 95 AS ic, 120 AS mn, 170 AS vc FROM zones WHERE name = 'Bijela'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 19 AS ga, 14 AS gc, 75 AS ie, 95 AS ic, 120 AS mn, 170 AS vc FROM zones WHERE name = 'Kamenari'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 19 AS ga, 14 AS gc, 75 AS ie, 95 AS ic, 120 AS mn, 170 AS vc FROM zones WHERE name = 'Kumbor'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 19 AS ga, 14 AS gc, 80 AS ie, 95 AS ic, 120 AS mn, 170 AS vc FROM zones WHERE name = 'Djenovici'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 20 AS ga, 14 AS gc, 80 AS ie, 100 AS ic, 130 AS mn, 180 AS vc FROM zones WHERE name = 'Herceg-Novi'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 20 AS ga, 14 AS gc, 80 AS ie, 100 AS ic, 130 AS mn, 180 AS vc FROM zones WHERE name = 'Igalo'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 20 AS ga, 16 AS gc, 85 AS ie, 110 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Njivice'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 140 AS ie, 170 AS ic, 200 AS mn, 250 AS vc FROM zones WHERE name = 'Kolasin'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 200 AS ie, 240 AS ic, 280 AS mn, 330 AS vc FROM zones WHERE name = 'Dubrovnik Airport'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 200 AS ie, 240 AS ic, 280 AS mn, 330 AS vc FROM zones WHERE name = 'Dubrovnik Hotel'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18 AS ga, 13 AS gc, 65 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Budva'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18 AS ga, 13 AS gc, 65 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Jaz'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18 AS ga, 13 AS gc, 65 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Becici'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18 AS ga, 13 AS gc, 65 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Rafailovici'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18 AS ga, 13 AS gc, 65 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Przno'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18 AS ga, 13 AS gc, 65 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Sv. Stefan'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18 AS ga, 13 AS gc, 65 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Rezevici'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18 AS ga, 13 AS gc, 65 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Petrovac'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 70 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Canj'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 70 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Sutomore'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 70 AS ie, 95 AS ic, 140 AS mn, 190 AS vc FROM zones WHERE name = 'Bar'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 110 AS ie, 130 AS ic, 150 AS mn, 200 AS vc FROM zones WHERE name = 'Dobra Voda'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 110 AS ie, 130 AS ic, 150 AS mn, 200 AS vc FROM zones WHERE name = 'Ulcinj'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 120 AS ie, 130 AS ic, 150 AS mn, 200 AS vc FROM zones WHERE name = 'Ada Bojana'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 100 AS ie, 130 AS ic, 165 AS mn, 215 AS vc FROM zones WHERE name = 'Tivat'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 100 AS ie, 130 AS ic, 165 AS mn, 215 AS vc FROM zones WHERE name = 'Lustica'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 110 AS ie, 130 AS ic, 175 AS mn, 225 AS vc FROM zones WHERE name = 'Kotor'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 110 AS ie, 130 AS ic, 175 AS mn, 225 AS vc FROM zones WHERE name = 'Prcanj'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 110 AS ie, 130 AS ic, 175 AS mn, 225 AS vc FROM zones WHERE name = 'Dobrota'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 110 AS ie, 130 AS ic, 175 AS mn, 225 AS vc FROM zones WHERE name = 'Vrmac - Hyatt'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 110 AS ie, 130 AS ic, 175 AS mn, 225 AS vc FROM zones WHERE name = 'Orahovac'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 125 AS ie, 150 AS ic, 190 AS mn, 240 AS vc FROM zones WHERE name = 'Perast'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 125 AS ie, 150 AS ic, 190 AS mn, 240 AS vc FROM zones WHERE name = 'Risan'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23 AS ga, 17 AS gc, 130 AS ie, 170 AS ic, 200 AS mn, 250 AS vc FROM zones WHERE name = 'Bijela'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23 AS ga, 17 AS gc, 130 AS ie, 170 AS ic, 200 AS mn, 250 AS vc FROM zones WHERE name = 'Kamenari'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23 AS ga, 17 AS gc, 130 AS ie, 170 AS ic, 200 AS mn, 250 AS vc FROM zones WHERE name = 'Kumbor'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23 AS ga, 17 AS gc, 130 AS ie, 190 AS ic, 200 AS mn, 250 AS vc FROM zones WHERE name = 'Djenovici'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23 AS ga, 17 AS gc, 140 AS ie, 190 AS ic, 200 AS mn, 250 AS vc FROM zones WHERE name = 'Herceg-Novi'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23 AS ga, 17 AS gc, 140 AS ie, 190 AS ic, 210 AS mn, 260 AS vc FROM zones WHERE name = 'Igalo'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23 AS ga, 17 AS gc, 150 AS ie, 200 AS ic, 210 AS mn, 260 AS vc FROM zones WHERE name = 'Njivice'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 100 AS ie, 120 AS ic, 140 AS mn, 200 AS vc FROM zones WHERE name = 'Kolasin'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 260 AS ie, 320 AS ic, 360 AS mn, 400 AS vc FROM zones WHERE name = 'Dubrovnik Airport'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL AS ga, NULL AS gc, 260 AS ie, 320 AS ic, 360 AS mn, 400 AS vc FROM zones WHERE name = 'Dubrovnik Hotel'
) p
WHERE sp.airport = p.airport AND sp.zone_id = p.zone_id;
