-- ═══════════════════════════════════════════════════════
--  Najam vozila — tabela i RLS politike
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vehicle_rentals (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    UUID         NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  rental_date   DATE         NOT NULL,
  duration_type TEXT         NOT NULL DEFAULT 'full_day'
                             CHECK (duration_type IN ('full_day', 'hours')),
  time_from     TIME,                           -- samo za duration_type = 'hours'
  time_to       TIME,                           -- samo za duration_type = 'hours'
  client_name   TEXT,                           -- ko iznajmljuje
  price         NUMERIC(10,2),                  -- cijena najma (prihod)
  notes         TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vehicle_rentals_vehicle_id_idx ON vehicle_rentals (vehicle_id);
CREATE INDEX IF NOT EXISTS vehicle_rentals_date_idx       ON vehicle_rentals (rental_date);

ALTER TABLE vehicle_rentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicle_rentals_all" ON vehicle_rentals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
