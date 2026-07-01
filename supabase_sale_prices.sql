-- ═══════════════════════════════════════════════════════════
-- Sale Prices migracija — zone_id FK (Pasha 2026, od 15.04)
-- Pokreni u Supabase SQL Editoru
-- ═══════════════════════════════════════════════════════════

-- ── Korak 1: Dodaj sve destinacije kao zone (ako ne postoje) ──
DO $$
DECLARE
  zone_names TEXT[] := ARRAY['Ada Bojana', 'Bar', 'Becici', 'Bijela', 'Budva', 'Canj', 'Djenovici', 'Dobra Voda', 'Dobrota', 'Dubrovnik Airport', 'Dubrovnik Hotel', 'Herceg-Novi', 'Igalo', 'Jaz', 'Kamenari', 'Kolasin', 'Kotor', 'Kumbor', 'Lustica', 'Njivice', 'Orahovac', 'Perast', 'Petrovac', 'Prcanj', 'Przno', 'Rafailovici', 'Rezevici', 'Risan', 'Sutomore', 'Sv. Stefan', 'Tivat', 'Ulcinj', 'Vrmac - Hyatt'];
  n TEXT;
BEGIN
  FOREACH n IN ARRAY zone_names LOOP
    IF NOT EXISTS (SELECT 1 FROM zones WHERE name = n) THEN
      INSERT INTO zones (name) VALUES (n);
    END IF;
  END LOOP;
END $$;

-- ── Korak 2: Kreira tabelu sa zone_id FK ──────────────────────
DROP TABLE IF EXISTS sale_prices;

CREATE TABLE sale_prices (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  airport     TEXT    NOT NULL CHECK (airport IN ('TIV', 'TGD')),
  zone_id     UUID    NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  group_adt   NUMERIC,   -- grupni transfer, odrasli (EUR/osobi)
  group_chd   NUMERIC,   -- grupni transfer, djeca 2-12 (EUR/osobi)
  ind_econ    NUMERIC,   -- indiv. Economy Car, 1-3 pax (EUR/vozilu)
  ind_comfort NUMERIC,   -- indiv. Comfort Car, 1-3 pax (EUR/vozilu)
  minivan     NUMERIC,   -- Minivan Standard 4-7 pax (EUR/vozilu)
  v_class     NUMERIC,   -- Mercedes V-Class 4-7 pax (EUR/vozilu)
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (airport, zone_id)
);

ALTER TABLE sale_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp_read"  ON sale_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "sp_write" ON sale_prices FOR ALL    TO authenticated USING (true);

-- ── Korak 3: Unos cijena (veže se na zones po imenu) ──────────
INSERT INTO sale_prices (airport, zone_id, group_adt, group_chd, ind_econ, ind_comfort, minivan, v_class)
  SELECT 'TIV' AS airport, id AS zone_id, 11, 8, 50, 70, 100, 150 FROM zones WHERE name = 'Budva'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 11, 8, 50, 70, 100, 150 FROM zones WHERE name = 'Jaz'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 12, 9, 55, 75, 100, 150 FROM zones WHERE name = 'Becici'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 12, 9, 55, 75, 100, 150 FROM zones WHERE name = 'Rafailovici'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 13, 10, 60, 80, 110, 160 FROM zones WHERE name = 'Przno'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 13, 10, 60, 80, 110, 160 FROM zones WHERE name = 'Sv. Stefan'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 14, 10, 65, 85, 115, 165 FROM zones WHERE name = 'Rezevici'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 14, 10, 65, 85, 115, 165 FROM zones WHERE name = 'Petrovac'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 70, 90, 120, 175 FROM zones WHERE name = 'Canj'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 75, 95, 130, 180 FROM zones WHERE name = 'Sutomore'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 75, 95, 130, 180 FROM zones WHERE name = 'Bar'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 100, 120, 150, 200 FROM zones WHERE name = 'Dobra Voda'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 100, 120, 150, 200 FROM zones WHERE name = 'Ulcinj'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 120, 125, 160, 210 FROM zones WHERE name = 'Ada Bojana'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 30, 50, 60, 110 FROM zones WHERE name = 'Tivat'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 45, 65, 80, 130 FROM zones WHERE name = 'Lustica'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 45, 65, 80, 130 FROM zones WHERE name = 'Kotor'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 45, 65, 80, 130 FROM zones WHERE name = 'Prcanj'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 45, 65, 80, 130 FROM zones WHERE name = 'Dobrota'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 50, 75, 85, 135 FROM zones WHERE name = 'Vrmac - Hyatt'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 50, 75, 85, 135 FROM zones WHERE name = 'Orahovac'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 55, 75, 95, 145 FROM zones WHERE name = 'Perast'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 55, 75, 95, 145 FROM zones WHERE name = 'Risan'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 19, 14, 75, 95, 120, 170 FROM zones WHERE name = 'Bijela'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 19, 14, 75, 95, 120, 170 FROM zones WHERE name = 'Kamenari'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 19, 14, 75, 95, 120, 170 FROM zones WHERE name = 'Kumbor'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 19, 14, 80, 95, 120, 170 FROM zones WHERE name = 'Djenovici'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 20, 14, 80, 100, 130, 180 FROM zones WHERE name = 'Herceg-Novi'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 20, 14, 80, 100, 130, 180 FROM zones WHERE name = 'Igalo'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, 20, 16, 85, 110, 140, 190 FROM zones WHERE name = 'Njivice'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 140, 170, 200, 250 FROM zones WHERE name = 'Kolasin'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 200, 240, 280, 330 FROM zones WHERE name = 'Dubrovnik Airport'
UNION ALL
  SELECT 'TIV' AS airport, id AS zone_id, NULL, NULL, 200, 240, 280, 330 FROM zones WHERE name = 'Dubrovnik Hotel'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18, 13, 65, 95, 140, 190 FROM zones WHERE name = 'Budva'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18, 13, 65, 95, 140, 190 FROM zones WHERE name = 'Jaz'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18, 13, 65, 95, 140, 190 FROM zones WHERE name = 'Becici'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18, 13, 65, 95, 140, 190 FROM zones WHERE name = 'Rafailovici'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18, 13, 65, 95, 140, 190 FROM zones WHERE name = 'Przno'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18, 13, 65, 95, 140, 190 FROM zones WHERE name = 'Sv. Stefan'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18, 13, 65, 95, 140, 190 FROM zones WHERE name = 'Rezevici'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 18, 13, 65, 95, 140, 190 FROM zones WHERE name = 'Petrovac'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 70, 95, 140, 190 FROM zones WHERE name = 'Canj'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 70, 95, 140, 190 FROM zones WHERE name = 'Sutomore'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 70, 95, 140, 190 FROM zones WHERE name = 'Bar'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 110, 130, 150, 200 FROM zones WHERE name = 'Dobra Voda'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 110, 130, 150, 200 FROM zones WHERE name = 'Ulcinj'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 120, 130, 150, 200 FROM zones WHERE name = 'Ada Bojana'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 100, 130, 165, 215 FROM zones WHERE name = 'Tivat'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 100, 130, 165, 215 FROM zones WHERE name = 'Lustica'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 110, 130, 175, 225 FROM zones WHERE name = 'Kotor'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 110, 130, 175, 225 FROM zones WHERE name = 'Prcanj'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 110, 130, 175, 225 FROM zones WHERE name = 'Dobrota'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 110, 130, 175, 225 FROM zones WHERE name = 'Vrmac - Hyatt'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 110, 130, 175, 225 FROM zones WHERE name = 'Orahovac'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 125, 150, 190, 240 FROM zones WHERE name = 'Perast'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 125, 150, 190, 240 FROM zones WHERE name = 'Risan'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23, 17, 130, 170, 200, 250 FROM zones WHERE name = 'Bijela'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23, 17, 130, 170, 200, 250 FROM zones WHERE name = 'Kamenari'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23, 17, 130, 170, 200, 250 FROM zones WHERE name = 'Kumbor'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23, 17, 130, 190, 200, 250 FROM zones WHERE name = 'Djenovici'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23, 17, 140, 190, 200, 250 FROM zones WHERE name = 'Herceg-Novi'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23, 17, 140, 190, 210, 260 FROM zones WHERE name = 'Igalo'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, 23, 17, 150, 200, 210, 260 FROM zones WHERE name = 'Njivice'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 100, 120, 140, 200 FROM zones WHERE name = 'Kolasin'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 260, 320, 360, 400 FROM zones WHERE name = 'Dubrovnik Airport'
UNION ALL
  SELECT 'TGD' AS airport, id AS zone_id, NULL, NULL, 260, 320, 360, 400 FROM zones WHERE name = 'Dubrovnik Hotel'
ON CONFLICT (airport, zone_id) DO UPDATE SET
  group_adt   = EXCLUDED.group_adt,
  group_chd   = EXCLUDED.group_chd,
  ind_econ    = EXCLUDED.ind_econ,
  ind_comfort = EXCLUDED.ind_comfort,
  minivan     = EXCLUDED.minivan,
  v_class     = EXCLUDED.v_class,
  updated_at  = NOW();
