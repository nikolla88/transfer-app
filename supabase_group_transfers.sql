-- ═══════════════════════════════════════════════════════════════
--  Grupni transferi — RLS popravka + nova tabela za potvrđene naloge
--  Pokreni u Supabase SQL editoru
-- ═══════════════════════════════════════════════════════════════

-- ── 1. bus_prices — dodati RLS politike ─────────────────────────
--  (tabela postoji ali vjerovatno nema politika → write blokiran)

ALTER TABLE bus_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bus_prices_all" ON bus_prices;
CREATE POLICY "bus_prices_all" ON bus_prices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2. Inicijalni podaci (ako je tabela prazna) ──────────────────
INSERT INTO bus_prices (supplier_id, bus_type, airport, zone_bucket, price_ow, price_rt) VALUES
  (NULL, 'sprinter', 'TIV', 'budva',    115, 170),
  (NULL, 'sprinter', 'TIV', 'petrovac', 145, 210),
  (NULL, 'sprinter', 'TIV', 'bar',      175, 250),
  (NULL, 'sprinter', 'TGD', 'budva',    170, 230),
  (NULL, 'sprinter', 'TGD', 'petrovac', 175, 220),
  (NULL, 'sprinter', 'TGD', 'bar',      180, 245),
  (NULL, 'midi',     'TIV', 'budva',    165, 215),
  (NULL, 'midi',     'TIV', 'petrovac', 190, 265),
  (NULL, 'midi',     'TIV', 'bar',      250, 365),
  (NULL, 'midi',     'TGD', 'budva',    285, 360),
  (NULL, 'midi',     'TGD', 'petrovac', 255, 350),
  (NULL, 'midi',     'TGD', 'bar',      295, 380),
  (NULL, 'bus',      'TIV', 'budva',    190, 260),
  (NULL, 'bus',      'TIV', 'petrovac', 230, 320),
  (NULL, 'bus',      'TIV', 'bar',      290, 430),
  (NULL, 'bus',      'TGD', 'budva',    340, 400),
  (NULL, 'bus',      'TGD', 'petrovac', 320, 390),
  (NULL, 'bus',      'TGD', 'bar',      360, 420)
ON CONFLICT (supplier_id, bus_type, airport, zone_bucket) DO NOTHING;

-- ── 3. group_transfer_orders — potvrđeni grupni nalozi ──────────
--  Jedan red = jedan nalog (RT ima i dolazne i odlazne podatke)

CREATE TABLE IF NOT EXISTS group_transfer_orders (
  id             BIGSERIAL    PRIMARY KEY,
  date           DATE         NOT NULL,
  nalog_id       TEXT         NOT NULL,
  type           TEXT         NOT NULL CHECK (type IN ('RT','arr','dep')),
  owrt           TEXT,                                           -- 'OW' za jednosmjerne
  bus_type       TEXT         NOT NULL,
  bus_label      TEXT         NOT NULL,
  airport        TEXT         NOT NULL,
  bucket         TEXT         NOT NULL,
  price          NUMERIC(10,2) NOT NULL DEFAULT 0,
  supplier_id    UUID         REFERENCES suppliers(id) ON DELETE SET NULL,
  payment_id     UUID         REFERENCES supplier_payments(id) ON DELETE SET NULL,

  -- RT polja
  arr_flight     TEXT,
  arr_flight_time TEXT,
  arr_pax        INT,
  dep_flight     TEXT,
  dep_flight_time TEXT,
  dep_pax        INT,
  arr_hotels     JSONB,
  dep_hotels     JSONB,

  -- OW polja
  flight_name    TEXT,
  flight_time    TEXT,
  pax            INT,
  hotels         JSONB,

  confirmed_at   TIMESTAMPTZ  DEFAULT NOW(),

  UNIQUE (date, nalog_id)
);

CREATE INDEX IF NOT EXISTS gto_date_idx        ON group_transfer_orders (date);
CREATE INDEX IF NOT EXISTS gto_supplier_idx    ON group_transfer_orders (supplier_id);
CREATE INDEX IF NOT EXISTS gto_payment_idx     ON group_transfer_orders (payment_id);

ALTER TABLE group_transfer_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gto_all" ON group_transfer_orders;
CREATE POLICY "gto_all" ON group_transfer_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
