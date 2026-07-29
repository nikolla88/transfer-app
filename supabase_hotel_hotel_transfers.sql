-- ═══════════════════════════════════════════════════════════════
--  HOTEL-HOTEL transferi — nova kolona hotel_to
--  Pokreni u Supabase SQL editoru
--
--  Svrha: kad se gost seli direktno iz jednog hotela u drugi (bez
--  aerodroma), aplikacija sad prepoznaje taj slučaj kao poseban tip
--  transfera ('hh') umjesto da ga (pogrešno) tretira kao dva odvojena
--  aerodromska transfera. hotel_to čuva odredišni hotel (polazni
--  hotel je već postojeće hotel_name polje).
--
--  Ovo je čisto dodavanje - ne dira, ne briše i ne mijenja nijednu
--  postojeću kolonu, ne dira postojeći Excel import, niti obično
--  arr/dep ponašanje (koje ostaje potpuno isto).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS hotel_to TEXT;
