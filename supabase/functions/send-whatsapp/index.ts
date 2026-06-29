/**
 * Supabase Edge Function: send-whatsapp
 *
 * Prima JSON body:
 * {
 *   messages: [
 *     {
 *       to: "+38269XXXXXX",           // telefon vozača (E.164 format)
 *       body: "Pozdrav Nikola...",    // tekst poruke
 *       mediaUrls: ["https://..."]    // opcioni URL-ovi PDF ugovora
 *     },
 *     ...
 *   ]
 * }
 *
 * Env varijable (podesi u Supabase Dashboard → Edge Functions → Secrets):
 *   TWILIO_ACCOUNT_SID   — Account SID iz Twilio konzole
 *   TWILIO_AUTH_TOKEN    — Auth Token iz Twilio konzole
 *   TWILIO_WHATSAPP_FROM — Twilio WhatsApp broj, npr: "whatsapp:+14155238886"
 *                         (za sandbox) ili tvoj odobreni broj
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const { messages } = await req.json() as {
      messages: Array<{
        to: string
        body: string
        mediaUrls?: string[]
      }>
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')
    const from       = Deno.env.get('TWILIO_WHATSAPP_FROM') // 'whatsapp:+14155238886'

    if (!accountSid || !authToken || !from) {
      return new Response(
        JSON.stringify({ error: 'Nedostaju Twilio env varijable.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const credentials = btoa(`${accountSid}:${authToken}`)
    const apiUrl      = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`

    const results = []

    for (const msg of messages) {
      // Twilio WhatsApp zahtijeva 'whatsapp:' prefiks
      const toFormatted = msg.to.startsWith('whatsapp:') ? msg.to : `whatsapp:${msg.to}`

      const params = new URLSearchParams({
        From: from,
        To:   toFormatted,
        Body: msg.body,
      })

      // Dodaj media URL-ove (PDF ugovori)
      if (msg.mediaUrls?.length) {
        msg.mediaUrls.forEach((url, i) => {
          params.append(`MediaUrl${i}`, url)
        })
      }

      const resp = await fetch(apiUrl, {
        method:  'POST',
        headers: {
          Authorization:  `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })

      const data = await resp.json()

      results.push({
        to:      msg.to,
        sid:     data.sid,
        status:  data.status,
        error:   data.code ? `${data.code}: ${data.message}` : null,
      })
    }

    const errors = results.filter(r => r.error)
    const ok     = results.filter(r => !r.error)

    return new Response(
      JSON.stringify({ sent: ok.length, failed: errors.length, results }),
      {
        status: errors.length === results.length ? 500 : 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
