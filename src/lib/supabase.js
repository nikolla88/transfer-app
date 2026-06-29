import { createClient } from '@supabase/supabase-js'

const url        = import.meta.env.VITE_SUPABASE_URL
const key        = import.meta.env.VITE_SUPABASE_ANON_KEY
const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Nedostaju Supabase env varijable. Provjeri .env fajl.')
}

// Standardni klijent — koristi anon key, podliježe RLS-u
export const supabase = createClient(url, key)

// Admin klijent — koristi service_role key, zaobilazi RLS
// Potreban za kreiranje novih korisnika (auth.admin.createUser)
// Zahtijeva VITE_SUPABASE_SERVICE_ROLE_KEY u .env fajlu
// NAPOMENA: Ovaj key se ne smije dijeljiti — koristiti samo na internoj mreži
export const supabaseAdmin = serviceKey
  ? createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null
