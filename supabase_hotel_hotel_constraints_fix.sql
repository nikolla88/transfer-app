-- ═══════════════════════════════════════════════════════════════
--  HOTEL-HOTEL transferi — ispravka ograničenja na transfers tabeli
--  Pokreni u Supabase SQL editoru (poslije supabase_hotel_hotel_transfers.sql)
--
--  Ova skripta je bezbjedna za ponovno pokretanje (idempotentna) — ako
--  neki dio već postoji/nedostaje, jednostavno se preskače, neće dati
--  grešku.
-- ═══════════════════════════════════════════════════════════════

-- 1. airport smije biti prazno (arr/dep i dalje uvijek imaju airport popunjen)
ALTER TABLE transfers ALTER COLUMN airport DROP NOT NULL;

-- 2. type smije biti i 'hh', ne samo 'arr'/'dep'
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_type_check;
ALTER TABLE transfers ADD CONSTRAINT transfers_type_check CHECK (type IN ('arr', 'dep', 'hh'));
