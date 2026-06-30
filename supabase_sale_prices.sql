-- Sale Prices tabela za Prometheus Travel
-- Pokreni u Supabase SQL Editoru

CREATE TABLE IF NOT EXISTS sale_prices (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  airport      TEXT        NOT NULL CHECK (airport IN ('TIV', 'TGD')),
  destination  TEXT        NOT NULL,
  group_adt    NUMERIC,   -- grupni transfer, odrasli (po osobi)
  group_chd    NUMERIC,   -- grupni transfer, djeca 2-12 (po osobi)
  ind_econ     NUMERIC,   -- individualni Economy Car, 1-3 pax (po vozilu)
  ind_comfort  NUMERIC,   -- individualni Comfort Car, 1-3 pax (po vozilu)
  minivan      NUMERIC,   -- Minivan Standard, 4-7 pax (po vozilu)
  v_class      NUMERIC,   -- Mercedes V-Class, 4-7 pax (po vozilu)
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (airport, destination)
);

-- RLS
ALTER TABLE sale_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read" ON sale_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write" ON sale_prices FOR ALL TO authenticated USING (true);

-- Podaci iz cjenovnika Pasha 2026 (valid from 15.04.2026)
INSERT INTO sale_prices (airport, destination, group_adt, group_chd, ind_econ, ind_comfort, minivan, v_class)
VALUES
  ('TIV', 'Budva', 11, 8, 50, 70, 100, 150),
  ('TIV', 'Jaz', 11, 8, 50, 70, 100, 150),
  ('TIV', 'Becici', 12, 9, 55, 75, 100, 150),
  ('TIV', 'Rafailovici', 12, 9, 55, 75, 100, 150),
  ('TIV', 'Przno', 13, 10, 60, 80, 110, 160),
  ('TIV', 'Sv. Stefan', 13, 10, 60, 80, 110, 160),
  ('TIV', 'Rezevici', 14, 10, 65, 85, 115, 165),
  ('TIV', 'Petrovac', 14, 10, 65, 85, 115, 165),
  ('TIV', 'Canj', NULL, NULL, 70, 90, 120, 175),
  ('TIV', 'Sutomore', NULL, NULL, 75, 95, 130, 180),
  ('TIV', 'Bar', NULL, NULL, 75, 95, 130, 180),
  ('TIV', 'Dobra Voda', NULL, NULL, 100, 120, 150, 200),
  ('TIV', 'Ulcinj', NULL, NULL, 100, 120, 150, 200),
  ('TIV', 'Ada Bojana', NULL, NULL, 120, 125, 160, 210),
  ('TIV', 'Tivat', NULL, NULL, 30, 50, 60, 110),
  ('TIV', 'Lustica', NULL, NULL, 45, 65, 80, 130),
  ('TIV', 'Kotor', NULL, NULL, 45, 65, 80, 130),
  ('TIV', 'Prcanj', NULL, NULL, 45, 65, 80, 130),
  ('TIV', 'Dobrota', NULL, NULL, 45, 65, 80, 130),
  ('TIV', 'Vrmac - Hyatt', NULL, NULL, 50, 75, 85, 135),
  ('TIV', 'Orahovac', NULL, NULL, 50, 75, 85, 135),
  ('TIV', 'Perast', NULL, NULL, 55, 75, 95, 145),
  ('TIV', 'Risan', NULL, NULL, 55, 75, 95, 145),
  ('TIV', 'Bijela', 19, 14, 75, 95, 120, 170),
  ('TIV', 'Kamenari', 19, 14, 75, 95, 120, 170),
  ('TIV', 'Kumbor', 19, 14, 75, 95, 120, 170),
  ('TIV', 'Djenovici', 19, 14, 80, 95, 120, 170),
  ('TIV', 'Herceg-Novi', 20, 14, 80, 100, 130, 180),
  ('TIV', 'Igalo', 20, 14, 80, 100, 130, 180),
  ('TIV', 'Njivice', 20, 16, 85, 110, 140, 190),
  ('TIV', 'Kolasin', NULL, NULL, 140, 170, 200, 250),
  ('TIV', 'Dubrovnik Airport', NULL, NULL, 200, 240, 280, 330),
  ('TIV', 'Dubrovnik Hotel', NULL, NULL, 200, 240, 280, 330),
  ('TGD', 'Budva', 18, 13, 65, 95, 140, 190),
  ('TGD', 'Jaz', 18, 13, 65, 95, 140, 190),
  ('TGD', 'Becici', 18, 13, 65, 95, 140, 190),
  ('TGD', 'Rafailovici', 18, 13, 65, 95, 140, 190),
  ('TGD', 'Przno', 18, 13, 65, 95, 140, 190),
  ('TGD', 'Sv. Stefan', 18, 13, 65, 95, 140, 190),
  ('TGD', 'Rezevici', 18, 13, 65, 95, 140, 190),
  ('TGD', 'Petrovac', 18, 13, 65, 95, 140, 190),
  ('TGD', 'Canj', NULL, NULL, 70, 95, 140, 190),
  ('TGD', 'Sutomore', NULL, NULL, 70, 95, 140, 190),
  ('TGD', 'Bar', NULL, NULL, 70, 95, 140, 190),
  ('TGD', 'Dobra Voda', NULL, NULL, 110, 130, 150, 200),
  ('TGD', 'Ulcinj', NULL, NULL, 110, 130, 150, 200),
  ('TGD', 'Ada Bojana', NULL, NULL, 120, 130, 150, 200),
  ('TGD', 'Tivat', NULL, NULL, 100, 130, 165, 215),
  ('TGD', 'Lustica', NULL, NULL, 100, 130, 165, 215),
  ('TGD', 'Kotor', NULL, NULL, 110, 130, 175, 225),
  ('TGD', 'Prcanj', NULL, NULL, 110, 130, 175, 225),
  ('TGD', 'Dobrota', NULL, NULL, 110, 130, 175, 225),
  ('TGD', 'Vrmac - Hyatt', NULL, NULL, 110, 130, 175, 225),
  ('TGD', 'Orahovac', NULL, NULL, 110, 130, 175, 225),
  ('TGD', 'Perast', NULL, NULL, 125, 150, 190, 240),
  ('TGD', 'Risan', NULL, NULL, 125, 150, 190, 240),
  ('TGD', 'Bijela', 23, 17, 130, 170, 200, 250),
  ('TGD', 'Kamenari', 23, 17, 130, 170, 200, 250),
  ('TGD', 'Kumbor', 23, 17, 130, 170, 200, 250),
  ('TGD', 'Djenovici', 23, 17, 130, 190, 200, 250),
  ('TGD', 'Herceg-Novi', 23, 17, 140, 190, 200, 250),
  ('TGD', 'Igalo', 23, 17, 140, 190, 210, 260),
  ('TGD', 'Njivice', 23, 17, 150, 200, 210, 260),
  ('TGD', 'Kolasin', NULL, NULL, 100, 120, 140, 200),
  ('TGD', 'Dubrovnik Airport', NULL, NULL, 260, 320, 360, 400),
  ('TGD', 'Dubrovnik Hotel', NULL, NULL, 260, 320, 360, 400)
ON CONFLICT (airport, destination) DO UPDATE SET
  group_adt   = EXCLUDED.group_adt,
  group_chd   = EXCLUDED.group_chd,
  ind_econ    = EXCLUDED.ind_econ,
  ind_comfort = EXCLUDED.ind_comfort,
  minivan     = EXCLUDED.minivan,
  v_class     = EXCLUDED.v_class,
  updated_at  = NOW();
