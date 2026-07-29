/**
 * telegramText.js
 * Pomoćne funkcije za slanje poruka sa parse_mode: 'Markdown' (legacy) Telegramu.
 *
 * Telegram-ova Markdown pravila su stroga: _ * ` [ ] su specijalni karakteri
 * koji moraju biti u parovima (otvoreno/zatvoreno), i entitet (npr. *podebljano*)
 * ne smije lomiti unutar sebe na neočekivan način. Imena gostiju, hotela i
 * vozila dolaze iz baze/Excela i mogu slučajno sadržati takve karaktere, ili
 * (kod spojenih rezervacija) više imena razdvojenih novim redom unutar jednog
 * "*...*" bloka - oboje izazivaju grešku "can't find end of the entity" i
 * Telegram odbija cijelu poruku.
 */

// Escape-uje specijalne Markdown karaktere u proizvoljnom, dinamičkom tekstu
// (imena gostiju/hotela/vozila) prije nego što se ubaci u poruku.
export function escapeMd(s) {
  return String(s ?? '').replace(/([_*`[\]])/g, '\\$1')
}

// Podebljava tekst koji može imati više redova (npr. spojene rezervacije sa
// više imena) - podebljava SVAKI red posebno, umjesto da jedan "*...*" blok
// obuhvati novi red (što Telegram Markdown ume da odbije).
export function boldLines(s) {
  return String(s ?? '')
    .split('\n')
    .map(line => `*${escapeMd(line)}*`)
    .join('\n')
}
