-- Ubaci default cjenovnik (pokreni ako su polja prazna)
DELETE FROM bus_prices WHERE supplier_id IS NULL;

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
  (NULL, 'bus',      'TGD', 'bar',      360, 420);
