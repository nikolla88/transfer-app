-- ═══════════════════════════════════════════════════════════════
--  Faza 3 — Dodati 'rep' (Predstavnik) rolu
--
--  1. Proširiti CHECK constraint na profiles.role
--  2. Dozvoliti 'rep' korisniku READ pristup rooming_list
--     (samo SELECT — za /rep stranicu s brojevima telefona)
--
--  Pokreni u Supabase SQL editoru (Database → SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Proširiti CHECK constraint na profiles.role ───────────────
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'dispatcher', 'rep'));

-- ── 2. RLS za rooming_list — 'rep' može samo čitati ─────────────
--  'rep' treba SELECT da vidi goste i upiše telefon,
--  ali ne treba INSERT/DELETE.

-- Ukloni staru politiku (ako postoji)
DROP POLICY IF EXISTS "auth_all_rooming_list" ON rooming_list;

-- Admin i dispatcher — pun pristup
CREATE POLICY "auth_admin_dispatcher_rooming_list" ON rooming_list
  FOR ALL TO authenticated
  USING    (get_my_profile_role() IN ('admin', 'dispatcher'))
  WITH CHECK (get_my_profile_role() IN ('admin', 'dispatcher'));

-- Rep — samo SELECT i UPDATE (za upisivanje telefona)
CREATE POLICY "auth_rep_rooming_list_select" ON rooming_list
  FOR SELECT TO authenticated
  USING (get_my_profile_role() = 'rep');

CREATE POLICY "auth_rep_rooming_list_update" ON rooming_list
  FOR UPDATE TO authenticated
  USING    (get_my_profile_role() = 'rep')
  WITH CHECK (get_my_profile_role() = 'rep');

-- ── PROVJERA ────────────────────────────────────────────────────
-- SELECT conname, consrc
-- FROM pg_constraint
-- WHERE conrelid = 'profiles'::regclass AND contype = 'c';

-- SELECT policyname, cmd, roles
-- FROM pg_policies
-- WHERE tablename = 'rooming_list';
