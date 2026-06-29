/**
 * generateContract.js
 * Generiše PDF ugovor od nule koristeći HTML → html2canvas → jsPDF.
 * Pečati se ubacuju direktno u HTML s mix-blend-mode: multiply
 * koji uklanja bijelu pozadinu i čini ih prirodnim.
 */

const DAVALAC = {
  naziv:     'Biblio Globus doo',
  adresa:    'Ulica XVI br 15',
  pib:       '03016277',
  ovlasceno: 'Kotlaja Nikola',
}

const KORISNIK = {
  naziv:     'Vinteka Bussiness ltd',
  adresa:    'Limassol Cyprus',
  pib:       '',
  ovlasceno: 'D.A Accounting & Secretarial LTD',
}

function vehicleLabel(type) {
  if (type === 'vclass')  return 'Luksuzno vozilo'
  if (type === 'minivan') return 'Kombinirano vozilo'
  return 'Putničko vozilo'
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${d}.${m}.${y}.`
}

function buildHTML(transfer, vehicle, dateStr) {
  const datum   = formatDate(dateStr)
  const vrsta   = `${vehicleLabel(vehicle?.type)}, ${vehicle?.name || ''}`
  const pax     = transfer.pax || 1
  const tourist = transfer.tourist || ''

  const passengers = []
  for (let i = 0; i < pax && i < 8; i++) passengers.push(tourist)
  while (passengers.length < 8) passengers.push('')

  const ROWS = [
    { label: 'DATUM:',                      value: datum       },
    { label: 'VRSTA VOZILA:',               value: vrsta       },
    { label: 'VRIJEME TRAJANJA USLUGE:',    value: '6 sati'    },
    { label: 'CIJENA PO JEDINICI VREMENA:', value: ''          },
    { label: 'UKUPNA CIJENA SA PDV-OM:',    value: '180,00 €'  },
    { label: 'NAČIN PLAĆANJA:',             value: 'Faktura'   },
    { label: 'BROJ PUTNIKA:',               value: String(pax) },
    { label: 'NAPOMENA:',                   value: ''          },
  ]

  const tableRows = ROWS.map((r, i) => `
    <tr>
      <td class="lbl">${r.label}</td>
      <td class="val">${r.value}</td>
      <td class="pas">${passengers[i]}</td>
      <td class="num">${i + 1}</td>
    </tr>`).join('')

  return `<div class="contract">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  .contract {
    font-family: Arial, sans-serif;
    font-size: 10px;
    background: #fff;
    color: #000;
    width: 794px;
    padding: 28px 36px 32px;
  }
  h1 {
    text-align: center;
    font-size: 15px;
    font-weight: bold;
    margin-bottom: 16px;
    letter-spacing: 0.3px;
  }
  .boxes { display: flex; gap: 12px; margin-bottom: 14px; }
  .box {
    border: 1.5px solid #000;
    padding: 7px 10px;
    flex: 1;
    line-height: 1.75;
    font-size: 9.5px;
  }
  .box-title { font-weight: bold; font-size: 10.5px; margin-bottom: 2px; }
  .clan { text-align: center; font-weight: bold; font-size: 10.5px; margin: 10px 0 4px; }
  .intro { font-weight: bold; font-size: 9.5px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  td { border: 1px solid #000; padding: 4px 6px; vertical-align: middle; }
  .lbl { font-weight: bold; font-size: 9px; width: 195px; }
  .val { font-size: 9.5px; width: 175px; }
  .pas { font-size: 9.5px; }
  .num { font-size: 9px; width: 22px; text-align: center; font-weight: bold; }
  .legal { font-size: 8.5px; line-height: 1.7; margin-bottom: 16px; }
  .legal p { margin-bottom: 2px; }
  .datum-line { font-size: 9.5px; margin-bottom: 10px; }
  .sigs { display: flex; justify-content: space-between; padding: 0 10px; }
  .sig { width: 240px; text-align: center; position: relative; }
  .sig-stamp {
    width: 110px;
    height: 110px;
    object-fit: contain;
    mix-blend-mode: multiply;
    opacity: 0.88;
    display: block;
    margin: 0 auto -30px;
    position: relative;
    z-index: 1;
  }
  .sig-line {
    border-bottom: 1px solid #000;
    width: 100%;
    margin-bottom: 5px;
    position: relative;
    z-index: 0;
  }
  .sig-label { font-size: 9.5px; }
</style>

<h1>UGOVOR O PREVOZU – LIMO SERVIS</h1>

<div class="boxes">
  <div class="box">
    <div class="box-title">DAVALAC USLUGA:</div>
    <div>Naziv: <strong>${DAVALAC.naziv}</strong></div>
    <div>Adresa: ${DAVALAC.adresa}</div>
    <div>PIB: ${DAVALAC.pib}</div>
    <div>Ovlašćeno lice: ${DAVALAC.ovlasceno}</div>
  </div>
  <div class="box">
    <div class="box-title">KORISNIK USLUGA:</div>
    <div>Naziv: <strong>${KORISNIK.naziv}</strong></div>
    <div>Adresa: ${KORISNIK.adresa}</div>
    <div>PIB: ${KORISNIK.pib}</div>
    <div>Ovlašćeno lice: ${KORISNIK.ovlasceno}</div>
  </div>
</div>

<div class="clan">Član 1.</div>
<div class="intro">Ovim Ugovorom, Davalac i Korisnik usluga ugovaraju sljedeću uslugu limo servisa:</div>

<table>${tableRows}</table>

<div class="clan">Član 2:</div>
<div class="intro">Davalac i Korisnik usluga su, takođe, saglasni i sa sljedećim:</div>
<div class="legal">
  <p>- vrijeme trajanja usluge limo servisa iz člana 1. ovog Ugovora se može promijeniti samo uz obostranu saglasnost, uz promjenu cijene po istom obračunskom modelu. U skladu sa propisima, vrijeme trajanja usluge limo servisa ne može biti kraće od 3 sata.</p>
  <p>- da Davalac usluge obezbijedi vozilo visoke klase, opremljeno klima uređajem, sa svom dokumentacijom neophodnom za obavljanje usluga limo servisa.</p>
  <p>- da je predmetna usluga limo servisa u cjelosti pokrivena polisom osiguranja putnika.</p>
  <p>- da sva eventualna šteta na vozilu, nastala od strane putnika, tokom trajanja usluge limo servisa, pada na teret Korisnika usluga.</p>
  <p>- eventualne primjedbe se razmatraju samo ako su izrečene do izlaska putnika iz vozila.</p>
  <p>- da tokom trajanja usluge limo servisa, vozač koji vrši uslugu nije odgovoran za putnike i prtljag, već je to isključiva odgovornost vodiča ili vođe grupe.</p>
  <p>- da je u slučaju spora nadležan sudski organ u Podgorici.</p>
</div>

<div class="datum-line">Datum: <strong>${datum}</strong></div>

<div class="sigs">
  <div class="sig">
    <img class="sig-stamp" src="/pecat-biblio.png" alt="pecat" />
    <div class="sig-line"></div>
    <div class="sig-label">Davalac usluga</div>
  </div>
  <div class="sig">
    <img class="sig-stamp" src="/pecat-vinteka.png" alt="pecat" />
    <div class="sig-line"></div>
    <div class="sig-label">Korisnik usluga</div>
  </div>
</div>

</div>`
}

export async function generateContractPDF(transfer, vehicle, dateStr) {
  const [{ jsPDF }, html2canvas] = await Promise.all([
    import('jspdf'),
    import('html2canvas').then(m => m.default),
  ])

  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;z-index:-1;'
  container.innerHTML = buildHTML(transfer, vehicle, dateStr)
  document.body.appendChild(container)

  try {
    // Sačekaj da se slike pečata učitaju
    const imgs = container.querySelectorAll('img')
    await Promise.all([...imgs].map(img =>
      img.complete ? Promise.resolve() : new Promise(res => {
        img.onload  = res
        img.onerror = res
      })
    ))

    const canvas = await html2canvas(container.firstElementChild, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
    })

    const pdf  = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' })
    const pdfW = 210
    const pdfH = Math.min((canvas.height / canvas.width) * pdfW, 297)
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pdfW, pdfH)

    return new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' })
  } finally {
    document.body.removeChild(container)
  }
}

export function contractFileName(transfer, dateStr) {
  const cleanDate    = dateStr.replace(/-/g, '')
  const cleanTourist = (transfer.tourist || 'putnik')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40)
  return `ugovor_${cleanDate}_${cleanTourist}.pdf`
}
