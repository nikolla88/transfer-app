-- ═══════════════════════════════════════════════════════════════
--  Dodjela predstavnika (rep) na grupni nalog (dolazni + odlazni let)
--
--  Svaki predstavnik može biti zadužen za jedan nalog (RT ili OW)
--  iz "Grupni transferi" stranice. Kad se dodijeli, predstavnik na
--  svojoj /rep stranici vidi SAMO goste sa svog dodijeljenog leta
--  (i dolazak i odlazak), umjesto svih letova tog dana.
--
--  group_transfer_orders RLS je već permisivan (FOR ALL USING true),
--  tako da predstavnik već može čitati svoj red — nije potrebna
--  dodatna RLS politika, samo nova kolona.
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE group_transfer_orders
  ADD COLUMN IF NOT EXISTS assigned_rep_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS gto_assigned_rep_idx ON group_transfer_orders (assigned_rep_id);

-- Provjera:
-- SELECT date, nalog_id, type, arr_flight, dep_flight, assigned_rep_id
-- FROM group_transfer_orders
-- ORDER BY date DESC LIMIT 20;
