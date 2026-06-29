# Transfer App — Setup Uputstvo

## Šta ti treba
- Node.js 18+ (preuzmi sa nodejs.org)
- Supabase nalog (supabase.com) — već imaš ✅
- Git (opcionalno, za deployment)

---

## Korak 1 — Supabase: Postavi bazu

1. Idi na **supabase.com** → tvoj projekt
2. Klikni **SQL Editor** → **New query**
3. Otvori fajl `schema.sql` iz ovog foldera, kopij sav sadržaj i nalijepite u editor
4. Klikni **Run** (zeleno dugme)
5. Trebalo bi da vidiš: "Success. No rows returned"

---

## Korak 2 — API ključevi

1. U Supabase: **Settings** (lijeva strana) → **API**
2. Kopiraj:
   - **Project URL** (npr. `https://abcdef.supabase.co`)
   - **anon / public** ključ (dug JWT string)

---

## Korak 3 — Konfiguracija app

1. U folderu `transfer-app`, nađi fajl `.env.example`
2. Kopiraj ga i preimenuj u `.env`
3. Otvori `.env` (Notepad ili bilo koji tekst editor) i unesi:

```
VITE_SUPABASE_URL=https://TVOJ-PROJEKT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...tvoj-kljuc...
```

---

## Korak 4 — Instalacija i pokretanje

Otvori **Terminal** (Mac) ili **Command Prompt** (Windows) u folderu `transfer-app`:

```bash
# Instaliraj pakete (samo jednom)
npm install

# Pokrenit app lokalno
npm run dev
```

App se otvara na: **http://localhost:5173**

---

## Korak 5 — Kreiranje prvog korisnika (Dispečer)

1. U Supabase: **Authentication** → **Users** → **Add user** → **Create new user**
2. Unesi email i lozinku za dispečera
3. Kopiraj **User UID** (UUID koji se pojavi)
4. Idi u **SQL Editor** i pokreni:

```sql
INSERT INTO user_roles (user_id, role)
VALUES ('TVOJ-UID-OVDJE', 'dispatcher');
```

---

## Korak 6 — Kreiranje vozača

Za svakog vozača koji treba login:

1. **Authentication** → **Add user** → unesi email/lozinku vozača
2. U SQL Editor:

```sql
-- Prvo pronađi id vozača iz tabele drivers
SELECT id, name FROM drivers;

-- Zatim dodaj ulogu
INSERT INTO user_roles (user_id, role, driver_id)
VALUES ('UID-VOZACA', 'driver', 'ID-IZ-DRIVERS-TABELE');
```

---

## Korak 7 — Početna konfiguracija u app

Nakon prijave u app:

1. **Vozila** — provjeri da li su sva vozila tu (6 vozila automatski kreirana)
2. **Zone** — provjeri zone, dodaj ako nedostaje
3. **Hoteli** — dodaj hotele i dodijeli zone (ili će se automatski kreirati pri importu)
4. **Suplajeri** — unesi suplajere sa kontaktima
5. **Cijene** — unesi cijene po suplajeru, zoni i tipu vozila

---

## Deployment (opciono — da app bude online)

### Najlakši način: Netlify Drop

1. Pokreni u terminalu: `npm run build`
2. Idi na **netlify.com** → **Drop** (drag & drop)
3. Povuci folder `dist` na stranicu
4. App je online za 30 sekundi

### Vercel (preporučeno za stalni hosting)

1. Napravi nalog na **vercel.com**
2. Instaliraj Vercel CLI: `npm i -g vercel`
3. U folderu `transfer-app`: `vercel`
4. Prati upute, unesi env varijable kada pitaju

---

## Česta pitanja

**Q: App kaže "Nedostaju Supabase env varijable"**  
A: Provjeri da li `.env` fajl postoji (ne `.env.example`) i da URL i ključ nisu prazni.

**Q: Prijava ne radi**  
A: Provjeri da li je korisnik kreiran u Supabase Authentication i da ima red u `user_roles` tabeli.

**Q: Hoteli nemaju zonu nakon importa**  
A: Idi u **Hoteli** tab i ručno dodijeli zonu svakom hotelu. Sljedeći put će se automatski koristiti.

**Q: Neću da koristim online hosting**  
A: `npm run dev` radi lokalno i to je sasvim ok za svakodnevnu upotrebu. App se otvara u browseru.
