-- ═══════════════════════════════════════════════════════
--  Obračun suplajera — tabele i RLS politike
-- ═══════════════════════════════════════════════════════

-- 1. Tabela za evidenciju uplata supla jeru
CREATE TABLE IF NOT EXISTS supplier_payments (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   UUID         NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  payment_date  DATE         NOT NULL,
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  notes         TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS supplier_payments_supplier_idx ON supplier_payments (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_payments_date_idx     ON supplier_payments (payment_date);

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_payments_all" ON supplier_payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Dodati payment_id na transfers tabelu (nullable — null = neplaćeno)
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES supplier_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transfers_payment_idx ON transfers (payment_id);
