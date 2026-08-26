-- ═══════════════════════════════════════════════════════════════
--  Predstavnik (rep) — dozvoli SELECT na hotels i flight_schedule
--
--  "Moj raspored" (odlazak) računa pickup vrijeme iz rasporeda leta
--  (flight_schedule.scheduled_time) i vremena vožnje hotel→aerodrom
--  (hotels.time_to_tiv / time_to_tgd). Te dvije tabele trenutno imaju
--  RLS koji dozvoljava SELECT samo admin/dispatcher ulogama, pa
--  predstavnik tiho dobija 0 redova (bez greške) — otud prazno
--  pickup vrijeme i pogrešan redoslijed liste odlazaka.
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "auth_rep_hotels_select" ON hotels;
CREATE POLICY "auth_rep_hotels_select" ON hotels
  FOR SELECT TO authenticated
  USING (get_my_profile_role() = 'rep');

DROP POLICY IF EXISTS "auth_rep_flight_schedule_select" ON flight_schedule;
CREATE POLICY "auth_rep_flight_schedule_select" ON flight_schedule
  FOR SELECT TO authenticated
  USING (get_my_profile_role() = 'rep');

-- Provjera (kao rep korisnik, u SQL editoru neće raditi jer editor je uvijek admin —
-- provjeri direktno u aplikaciji ulogovan kao predstavnik):
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename IN ('hotels','flight_schedule');
