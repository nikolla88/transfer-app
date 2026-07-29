-- ═══════════════════════════════════════════════════════════════
--  Dodaje all_passengers kolonu u rooming_list i transfers
--  Pokreni u Supabase SQL editoru
--
--  Svrha: rooming_list.tourist_name / transfers.tourist trenutno
--  čuvaju SAMO JEDNO ime po rezervaciji, iako rezervacija (claim_inc)
--  može imati više putnika. all_passengers čuva SVA imena za tu
--  rezervaciju (razdvojena sa "; "), da bi se u ugovoru o prevozu
--  ispisala stvarna imena putnika umjesto ponavljanja jednog imena.
--
--  Ovo je čisto dodavanje - ne dira, ne briše i ne mijenja nijednu
--  postojeću kolonu niti postojeći Excel import. Ako se all_passengers
--  ne popuni (ostane NULL), aplikacija se ponaša potpuno isto kao i
--  do sad (vidi fallback u generateContract.js).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE rooming_list
  ADD COLUMN IF NOT EXISTS all_passengers TEXT;

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS all_passengers TEXT;
