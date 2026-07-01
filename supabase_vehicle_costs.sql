-- Tabela za evidenciju troškova vozila
CREATE TABLE IF NOT EXISTS vehicle_costs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  cost_date   DATE NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('fuel', 'service', 'salary', 'other')),
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index za brže filtriranje po vozilu i datumu
CREATE INDEX IF NOT EXISTS idx_vehicle_costs_vehicle_id ON vehicle_costs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_costs_date ON vehicle_costs(cost_date);

-- RLS politike (isto kao ostale tabele)
ALTER TABLE vehicle_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read vehicle_costs"
  ON vehicle_costs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert vehicle_costs"
  ON vehicle_costs FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update vehicle_costs"
  ON vehicle_costs FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete vehicle_costs"
  ON vehicle_costs FOR DELETE
  TO authenticated USING (true);
