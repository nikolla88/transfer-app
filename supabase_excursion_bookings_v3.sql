-- ═══════════════════════════════════════════════════════════════
--  Izleti — razdvoji "ime nosioca rezervacije" od punog spiska putnika
--
--  guest_name       — SAMO nosilac rezervacije (prikazuje se u
--                      spisku/izvještaju, kratko i pregledno)
--  guest_full_names — svi putnici iz te rezervacije, odvojeni
--                      zarezom (za buduće štampanje vaučera/spiskova
--                      po pickup tačkama — Faza 4)
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE excursion_bookings ADD COLUMN IF NOT EXISTS guest_full_names TEXT;
