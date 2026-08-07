-- ═══════════════════════════════════════════════════════════════
--  Ispravka RLS pravila na profiles tabeli — permisije se nisu
--  čuvale jer je pravilo "da li sam admin" provjeravalo samo sebe
--  (čitalo iz iste profiles tabele koju štiti) - Postgres/Supabase
--  ovakvo "samoprovjeravanje" često tiho odbija, bez greške.
--
--  Ispravka: provjera admin statusa ide kroz posebnu funkciju
--  (SECURITY DEFINER) koja zaobilazi to ograničenje - ovo je
--  zvanično preporučen Supabase način za ovakve slučajeve.
--
--  Pokreni u Supabase SQL editoru.
-- ═══════════════════════════════════════════════════════════════

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "admin_full_access" on profiles;
create policy "admin_full_access" on profiles
  for all
  using (is_admin())
  with check (is_admin());

-- Provjera nakon pokretanja (kao admin, u SQL editoru):
-- update profiles set full_name = full_name where id = auth.uid();
