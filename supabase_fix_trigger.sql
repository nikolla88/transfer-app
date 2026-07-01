-- Fix: trigger da vraća NULL (ne 0) kad cijena nije unešena
CREATE OR REPLACE FUNCTION calc_leg_revenue(
  p_flight_name   TEXT,
  p_hotel_name    TEXT,
  p_transfer      TEXT,
  p_vehicle       TEXT,
  p_adult         INT,
  p_child         INT
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_airport  TEXT;
  v_zone_id  UUID;
  v_ga NUMERIC; v_gc NUMERIC;
  v_ie NUMERIC; v_ic NUMERIC;
  v_mn NUMERIC; v_vc NUMERIC;
BEGIN
  IF p_transfer IS NULL OR p_transfer IN ('NO TR-R', '') THEN
    RETURN NULL;
  END IF;

  SELECT fs.airport INTO v_airport
  FROM flight_schedule fs
  WHERE fs.flight_number = p_flight_name
     OR p_flight_name = ANY(fs.aliases)
  LIMIT 1;
  IF v_airport IS NULL THEN RETURN NULL; END IF;

  SELECT h.zone_id INTO v_zone_id
  FROM hotels h WHERE h.name = p_hotel_name LIMIT 1;
  IF v_zone_id IS NULL THEN RETURN NULL; END IF;

  SELECT sp.group_adt, sp.group_chd,
         sp.ind_econ, sp.ind_comfort,
         sp.minivan, sp.v_class
  INTO v_ga, v_gc, v_ie, v_ic, v_mn, v_vc
  FROM sale_prices sp
  WHERE sp.airport = v_airport AND sp.zone_id = v_zone_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF p_transfer = 'GRP' THEN
    -- Ako grupna cijena nije unesena → NULL, ne 0
    IF v_ga IS NULL THEN RETURN NULL; END IF;
    RETURN COALESCE(p_adult, 0) * v_ga
         + COALESCE(p_child, 0) * COALESCE(v_gc, 0);

  ELSIF p_transfer IN ('IND', 'SHA') THEN
    -- Direktno vraća NULL ako cijena nije unesena
    RETURN CASE p_vehicle
      WHEN 'Car Comfort' THEN v_ic
      WHEN 'Minivan'     THEN v_mn
      WHEN 'V-Class'     THEN v_vc
      ELSE                    v_ie
    END;
  END IF;

  RETURN NULL;
END;
$$;

-- Retroaktivno ažuriraj sve redove
UPDATE rooming_list SET updated_at = NOW();

-- Provjera: treba biti 0 redova sa arr_revenue=0 gdje je transfer GRP
SELECT COUNT(*) AS gresaka_0_umjesto_null
FROM rooming_list
WHERE arr_transfer_alias = 'GRP' AND arr_revenue = 0;
