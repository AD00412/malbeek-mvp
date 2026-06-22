// إرسالُ Web Push لأجهزة مستخدمٍ معيّن (إشعارٌ حدثيٌّ يصل والتطبيق مقفول).
// يقرأ push_subscriptions (بمفتاح الخدمة، يتجاوز RLS) ويرسل عبر web-push.
// الأسرار المطلوبة (Edge Function Secrets): VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY.
// SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY مُحقَنان تلقائيًّا.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return new Response(JSON.stringify({ error: 'VAPID secrets غير مضبوطة (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    webpush.setVapidDetails('mailto:hello@mulabeek.com', VAPID_PUBLIC, VAPID_PRIVATE)

    const { user_id, title, body, url } = await req.json()
    if (!user_id) return new Response(JSON.stringify({ error: 'user_id مطلوب' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: subs, error } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', user_id)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const payload = JSON.stringify({ title: title || 'ملبّيك', body: body || '', url: url || '/', tag: 'mlk-test' })
    let sent = 0, failed = 0, removed = 0
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        sent++
      } catch (e) {
        failed++
        if (e && (e.statusCode === 410 || e.statusCode === 404)) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint); removed++
        }
      }
    }
    return new Response(JSON.stringify({ ok: true, subscriptions: (subs || []).length, sent, failed, removed }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
