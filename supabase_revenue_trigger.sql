-- ═══════════════════════════════════════════════════════════════════
-- Transfer Revenue — kolone + trigger za automatski obračun prihoda
-- Pokreni u Supabase SQL Editoru
-- ═══════════════════════════════════════════════════════════════════

-- ── Korak 1: Dodaj kolone ──────────────────────────────────────────
ALTER TABLE rooming_list
  ADD COLUMN IF NOT EXISTS arr_revenue NUMERIC,
  ADD COLUMN IF NOT EXISTS dep_revenue NUMERIC;

-- ── Korak 2: Funkcija za izračun jedne noge transfera ─────────────
CREATE OR REPLACE FUNCTION calc_leg_revenue(
  p_flight_name   TEXT,
  p_hotel_name    TEXT,
  p_transfer      TEXT,   -- 'GRP', 'IND', 'SHA', 'NO TR-R'
  p_vehicle       TEXT,   -- 'Car', 'Car Comfort', 'Minivan', 'V-Class'
  p_adult         INT,
  p_child         INT
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_airport  TEXT;
  v_zone_id  UUID;
  v_ga       NUMERIC; v_gc NUMERIC;
  v_ie       NUMERIC; v_ic NUMERIC;
  v_mn       NUMERIC; v_vc NUMERIC;
BEGIN
  -- Preskoči ako nema transfera
  IF p_transfer IS NULL OR p_transfer IN ('NO TR-R', '') THEN
    RETURN NULL;
  END IF;

  -- Aerodrom iz rasporeda letova (provjerava i aliases)
  SELECT fs.airport INTO v_airport
  FROM flight_schedule fs
  WHERE fs.flight_number = p_flight_name
     OR p_flight_name = ANY(fs.aliases)
  LIMIT 1;

  IF v_airport IS NULL THEN RETURN NULL; END IF;

  -- Zona iz hotela
  SELECT h.zone_id INTO v_zone_id
  FROM hotels h
  WHERE h.name = p_hotel_name
  LIMIT 1;

  IF v_zone_id IS NULL THEN RETURN NULL; END IF;

  -- Dohvati cijene za tu zonu i aerodrom
  SELECT sp.group_adt, sp.group_chd,
         sp.ind_econ,  sp.ind_comfort,
         sp.minivan,   sp.v_class
  INTO v_ga, v_gc, v_ie, v_ic, v_mn, v_vc
  FROM sale_prices sp
  WHERE sp.airport = v_airport AND sp.zone_id = v_zone_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Izračunaj prema tipu transfera
  IF p_transfer = 'GRP' THEN
    RETURN COALESCE(p_adult, 0) * COALESCE(v_ga, 0)
         + COALESCE(p_child, 0) * COALESCE(v_gc, 0);

  ELSIF p_transfer IN ('IND', 'SHA') THEN
    RETURN CASE p_vehicle
      WHEN 'Car Comfort' THEN v_ic
      WHEN 'Minivan'     THEN v_mn
      WHEN 'V-Class'     THEN v_vc
      ELSE                    v_ie  -- 'Car' ili bilo šta → Economy
    END;
  END IF;

  RETURN NULL;
END;
$$;

-- ── Korak 3: Trigger funkcija ──────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_calc_revenue()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.arr_revenue := calc_leg_revenue(
    NEW.arr_flight_name, NEW.hotel_name,
    NEW.arr_transfer_alias, NEW.arr_vehicle_type,
    NEW.adult, NEW.child
  );
  NEW.dep_revenue := calc_leg_revenue(
    NEW.dep_flight_name, NEW.hotel_name,
    NEW.dep_transfer_alias, NEW.dep_vehicle_type,
    NEW.adult, NEW.child
  );
  RETURN NEW;
END;
$$;

-- ── Korak 4: Zakači trigger ────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_transfer_revenue ON rooming_list;
CREATE TRIGGER trg_transfer_revenue
BEFORE INSERT OR UPDATE ON rooming_list
FOR EACH ROW EXECUTE FUNCTION trg_calc_revenue();

-- ── Korak 5: Retroaktivno izračunaj sve postojeće redove ──────────
UPDATE rooming_list SET updated_at = NOW();

-- Provjera: koliko redova ima izračunat prihod
SELECT
  COUNT(*) FILTER (WHERE arr_revenue IS NOT NULL) AS arr_sa_prihodom,
  COUNT(*) FILTER (WHERE dep_revenue IS NOT NULL) AS dep_sa_prihodom,
  COUNT(*) AS ukupno
FROM rooming_list;
