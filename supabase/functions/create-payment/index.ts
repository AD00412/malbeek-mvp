// ============================================================
//  ملبّيك · Edge Function: create-payment
//  ينشئ جلسة دفعٍ مُستضافةً لدى بوّابة الدفع، يضع passenger_id في
//  metadata ليطابقها webhook لاحقًا، ويُرجع رابط الدفع للعميل.
//
//  - يصادق المُستدعي عبر JWT (المستخدم نفسه) ويتحقّق من ملكيّته للحجز
//    عبر RLS، فلا يستطيع إنشاء جلسة دفعٍ لحجز شخصٍ آخر.
//  - يدعم: moyasar (افتراضي) | tap | generic.
//  - راجع README.md لخطوات النشر وضبط الأسرار.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PROVIDER       = (Deno.env.get('PAYMENT_PROVIDER') ?? 'moyasar').toLowerCase()
const MERCHANT_KEY   = Deno.env.get('PAYMENT_MERCHANT_KEY') ?? ''
const SUCCESS_URL    = Deno.env.get('PAYMENT_SUCCESS_URL') ?? ''   // مثلًا: https://app.malbeek.com/?paid={passenger_id}
const CANCEL_URL     = Deno.env.get('PAYMENT_CANCEL_URL') ?? ''
const WEBHOOK_URL    = Deno.env.get('PAYMENT_WEBHOOK_URL')
                   ?? `${SUPABASE_URL}/functions/v1/payment-webhook`

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...cors },
  })

/** يُعيد {passenger_id} في القالب بقيمةٍ فعليّة */
const fill = (tpl: string, id: string) => tpl.replace('{passenger_id}', encodeURIComponent(id))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST')    return json(405, { error: 'method_not_allowed' })

  // 1) المصادقة: JWT المُستدعي
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'unauthenticated' })

  let body: any
  try { body = await req.json() } catch { return json(400, { error: 'invalid_json' }) }
  const passengerId = body?.passenger_id
  if (!passengerId) return json(400, { error: 'missing_passenger_id' })

  // 2) قراءة الحجز بصلاحيّة المستخدم — RLS تتحقّق من الملكيّة (profile_id = auth.uid())
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: pax, error: paxErr } = await userClient
    .from('passengers')
    .select('id, full_name, phone, status, amount, trip_id')
    .eq('id', passengerId)
    .maybeSingle()
  if (paxErr) return json(500, { error: 'fetch_failed' })
  if (!pax)   return json(403, { error: 'not_authorized' })
  if (['paid', 'boarded', 'checked_in'].includes(pax.status)) {
    return json(409, { error: 'already_paid' })
  }

  // 3) السعر من الرحلة (نقرأه عبر service_role لتفادي افتقار RLS للقراءة بسعر علني)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: trip } = await admin.from('trips').select('title, price').eq('id', pax.trip_id).maybeSingle()
  const amount = Number(trip?.price ?? pax.amount ?? 0)
  if (!amount || amount <= 0) return json(400, { error: 'no_price' })

  const success = SUCCESS_URL ? fill(SUCCESS_URL, pax.id) : ''
  const cancel  = CANCEL_URL  ? fill(CANCEL_URL,  pax.id) : success
  const description = `حجز رحلة ${trip?.title || ''} — ${pax.full_name}`.slice(0, 80)

  // 4) إنشاء الجلسة لدى المزوّد
  try {
    if (PROVIDER === 'moyasar') {
      const r = await fetch('https://api.moyasar.com/v1/invoices/', {
        method: 'POST',
        headers: {
          'authorization': 'Basic ' + btoa(MERCHANT_KEY + ':'),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100),     // هللات
          currency: 'SAR',
          description,
          success_url: success || undefined,
          back_url: cancel || undefined,
          callback_url: WEBHOOK_URL,
          metadata: { passenger_id: pax.id, trip_id: pax.trip_id },
        }),
      })
      if (!r.ok) return json(502, { error: 'gateway_failed', details: (await r.text()).slice(0, 200) })
      const inv = await r.json()
      return json(200, { url: inv.url, id: inv.id, provider: 'moyasar' })
    }

    if (PROVIDER === 'tap') {
      const r = await fetch('https://api.tap.company/v2/charges/', {
        method: 'POST',
        headers: {
          'authorization': 'Bearer ' + MERCHANT_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          amount, currency: 'SAR', description,
          customer: { first_name: pax.full_name, phone: { number: pax.phone } },
          source: { id: 'src_all' },
          redirect: { url: success || undefined },
          post: { url: WEBHOOK_URL },
          metadata: { passenger_id: pax.id, trip_id: pax.trip_id },
        }),
      })
      if (!r.ok) return json(502, { error: 'gateway_failed', details: (await r.text()).slice(0, 200) })
      const ch = await r.json()
      const url = ch?.transaction?.url ?? ch?.redirect?.url
      if (!url) return json(502, { error: 'gateway_no_url' })
      return json(200, { url, id: ch.id, provider: 'tap' })
    }

    // generic: للاختبارات والتطبيقات المخصّصة — يُرجع رابطًا تركيبيًّا بحقول الـ metadata
    if (PROVIDER === 'generic') {
      const url = (Deno.env.get('PAYMENT_GENERIC_TEMPLATE') ?? '')
        .replace('{amount}', String(amount))
        .replace('{currency}', 'SAR')
        .replace('{passenger_id}', pax.id)
        .replace('{trip_id}', pax.trip_id)
      if (!url) return json(501, { error: 'generic_template_missing' })
      return json(200, { url, provider: 'generic' })
    }

    return json(501, { error: 'provider_not_configured' })
  } catch (e) {
    return json(500, { error: 'unexpected', details: String(e).slice(0, 200) })
  }
})
