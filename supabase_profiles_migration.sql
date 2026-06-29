-- ============================================================
-- PROFILES MIGRATION — pokrenuti u Supabase > SQL Editor
-- ============================================================

-- 1. Kreirati tabelu profila korisnika
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'dispatcher'
              CHECK (role IN ('admin', 'dispatcher')),
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Row Level Security
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Svaki korisnik može čitati vlastiti profil
CREATE POLICY "own_profile_select" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Admin može raditi sve s profilima
CREATE POLICY "admin_full_access" ON profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p2
      WHERE p2.id = auth.uid() AND p2.role = 'admin'
    )
  );

-- 3. Trigger — automatski kreiraj profil pri registraciji novog korisnika
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role, permissions)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'dispatcher'),
    COALESCE((NEW.raw_user_meta_data->>'permissions')::jsonb, '{}'::jsonb)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Ukloni stari trigger ako postoji, pa kreiraj novi
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 4. Kreiraj profil za tvog admin korisnika
-- !! ZAMIJENI 'tvoj@email.com' sa tvojim stvarnim emailom !!
-- ============================================================
INSERT INTO profiles (id, email, full_name, role, permissions)
SELECT
  id,
  email,
  COALESCE(raw_user_meta_data->>'full_name', email),
  'admin',
  '{}'::jsonb
FROM auth.users
WHERE email = 'tvoj@email.com'  -- <-- ZAMIJENI OVO
ON CONFLICT (id) DO UPDATE
  SET role = 'admin';

-- ============================================================
-- GOTOVO. Provjeri da li je profil kreiran:
-- SELECT * FROM profiles;
-- ============================================================
