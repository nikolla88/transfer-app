-- ═══════════════════════════════════════════════════════════════
--  Dodati phone kolonu u rooming_list
--  Pokreni u Supabase SQL editoru
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE rooming_list
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Indeks za pretragu po telefonu (opcionalno, za budući messaging)
CREATE INDEX IF NOT EXISTS rooming_list_phone_idx
  ON rooming_list (phone)
  WHERE phone IS NOT NULL;
