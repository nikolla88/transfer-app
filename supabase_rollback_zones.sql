-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK: Ukloni zone koje smo greškom dodali
-- Briše SAMO zone iz naše liste koje nemaju nijedan hotel
-- (sigurno su duplikati — originalne zone imaju hotele)
-- ═══════════════════════════════════════════════════════════════

-- Korak 1: Obriši sale_prices tabelu (ima FK na zones)
DROP TABLE IF EXISTS sale_prices;

-- Korak 2: Obriši zone iz naše liste koje NISU vezane ni za jedan hotel
DELETE FROM zones
WHERE name IN (
  'Ada Bojana','Bar','Becici','Bijela','Budva','Canj','Djenovici',
  'Dobra Voda','Dobrota','Dubrovnik Airport','Dubrovnik Hotel',
  'Herceg-Novi','Igalo','Jaz','Kamenari','Kolasin','Kotor','Kumbor',
  'Lustica','Njivice','Orahovac','Perast','Petrovac','Prcanj','Przno',
  'Rafailovici','Rezevici','Risan','Sutomore','Sv. Stefan','Tivat',
  'Ulcinj','Vrmac - Hyatt'
)
AND id NOT IN (
  SELECT zone_id FROM hotels WHERE zone_id IS NOT NULL
);

-- Provjera: pokaži šta je ostalo od naše liste
SELECT name FROM zones
WHERE name IN (
  'Ada Bojana','Bar','Becici','Bijela','Budva','Canj','Djenovici',
  'Dobra Voda','Dobrota','Dubrovnik Airport','Dubrovnik Hotel',
  'Herceg-Novi','Igalo','Jaz','Kamenari','Kolasin','Kotor','Kumbor',
  'Lustica','Njivice','Orahovac','Perast','Petrovac','Prcanj','Przno',
  'Rafailovici','Rezevici','Risan','Sutomore','Sv. Stefan','Tivat',
  'Ulcinj','Vrmac - Hyatt'
)
ORDER BY name;
