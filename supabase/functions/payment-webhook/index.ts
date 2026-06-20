// ============================================================
//  ملبّيك · Edge Function: payment-webhook
//  يستقبل تأكيد الدفع من بوّابة الدفع، يتحقّق من التوقيع، ويؤكّد حجز
//  المعتمر آليًّا (status='paid') بشكلٍ idempotent — مع سجلّ تدقيقٍ في payments.
//
//  يدعم: Moyasar / Tap / generic. التحقّق: HMAC-SHA256 (افتراضي) أو token.
//  انظر README.md في هذا المجلّد لخطوات النشر وضبط الأسرار.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SECRET = Deno.env.get('PAYMENT_WEBHOOK_SECRET') ?? ''
const PROVIDER = (Deno.env.get('PAYMENT_PROVIDER') ?? 'generic').toLowerCase()
const VERIFY = (Deno.env.get('PAYMENT_VERIFY') ?? 'hmac').toLowerCase()     // hmac | token
const SIG_HEADER = (Deno.env.get('PAYMENT_SIG_HEADER') ?? 'x-signature').toLowerCase()

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** مقارنةٌ ثابتة الزمن لتفادي تسريب التوقيت */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** تطبيع حدث المزوّد إلى صيغةٍ موحّدة */
function normalize(provider: string, ev: any): {
  paid: boolean; ref: string | null; amount: number | null; currency: string; passengerId: string | null
} {
  const meta = ev?.data?.metadata ?? ev?.metadata ?? {}
  const passengerId = meta.passenger_id ?? meta.passengerId ?? ev?.passenger_id ?? null
  if (provider === 'moyasar') {
    const d = ev?.data ?? ev
    return {
      paid: (ev?.type === 'payment_paid') || d?.status === 'paid',
      ref: d?.id ?? null,
      amount: typeof d?.amount === 'number' ? d.amount / 100 : null,   // هللات → ريال
      currency: d?.currency ?? 'SAR',
      passengerId,
    }
  }
  if (provider === 'tap') {
    return {
      paid: ev?.status === 'CAPTURED' || ev?.status === 'PAID',
      ref: ev?.id ?? ev?.reference?.transaction ?? null,
      amount: typeof ev?.amount === 'number' ? ev.amount : null,
      currency: ev?.currency ?? 'SAR',
      passengerId: passengerId ?? ev?.reference?.transaction ?? null,
    }
  }
  // generic
  return {
    paid: ev?.paid === true || ev?.status === 'paid' || ev?.status === 'success',
    ref: ev?.reference ?? ev?.ref ?? ev?.id ?? null,
    amount: typeof ev?.amount === 'number' ? ev.amount : null,
    currency: ev?.currency ?? 'SAR',
    passengerId,
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const raw = await req.text()

  // 1) التحقّق من المصدر
  if (!SECRET) return json(500, { error: 'secret_not_configured' })
  if (VERIFY === 'hmac') {
    const provided = (req.headers.get(SIG_HEADER) ?? '').replace(/^sha256=/i, '').trim().toLowerCase()
    const expected = (await hmacHex(SECRET, raw)).toLowerCase()
    if (!provided || !timingSafeEqual(provided, expected)) return json(401, { error: 'bad_signature' })
  }

  let ev: any
  try { ev = JSON.parse(raw) } catch { return json(400, { error: 'invalid_json' }) }

  if (VERIFY === 'token') {
    const token = ev?.secret_token ?? ev?.token ?? ''
    if (!timingSafeEqual(String(token), SECRET)) return json(401, { error: 'bad_token' })
  }

  // 2) التطبيع
  const e = normalize(PROVIDER, ev)
  if (!e.paid) return json(200, { ignored: 'not_a_paid_event' })       // أحداثٌ أخرى: نتجاهلها بهدوء
  if (!e.ref && !e.passengerId) return json(200, { ignored: 'no_reference' })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // 3) إيجاد الراكب: بالـ metadata أوّلًا، وإلّا بمرجع الدفع الذي ألصقه العميل
  let pax: any = null
  if (e.passengerId) {
    const { data } = await db.from('passengers')
      .select('id, trip_id, subscriber_id, amount, status').eq('id', e.passengerId).maybeSingle()
    pax = data
  }
  if (!pax && e.ref) {
    const { data } = await db.from('passengers')
      .select('id, trip_id, subscriber_id, amount, status').eq('payment_ref', e.ref).maybeSingle()
    pax = data
  }

  // 4) ★ فحصُ مبلغ الدفع: لا نَقبل دَفعةً أقلَّ من السعر المتوقَّع.
  //    المتوقَّع = pax.amount لو محدَّدٌ، وإلّا trip.price. نَسمح بسماحٍ
  //    صغيرٍ (TOLERANCE) لأخطاء التقريب بين هللاتٍ وريالاتٍ ورسوم تحويلٍ صغيرة.
  //    لو الدَفعةُ أقلّ بشكلٍ ملحوظ → نَسجّلها كـ 'underpaid' ولا نُعلّم الراكبَ
  //    'paid' — يُراجعها المالكُ يدويًّا في سجلّ المدفوعات بدل أن يَخسر فرقًا صامتًا.
  const AMOUNT_TOLERANCE = 1   // ١ ريال — يَسمح بالتقريب
  let expected: number | null = null
  if (pax) {
    expected = typeof pax.amount === 'number' ? pax.amount : null
    if (expected == null && pax.trip_id) {
      const { data: trip } = await db.from('trips')
        .select('price').eq('id', pax.trip_id).maybeSingle()
      expected = typeof trip?.price === 'number' ? trip.price : null
    }
  }
  const isUnderpaid = expected != null
    && typeof e.amount === 'number'
    && (e.amount + AMOUNT_TOLERANCE) < expected

  // 5) سجلّ الدفع (idempotent عبر القيد الفريد provider+ref) — يمنع المعالجة المكرّرة.
  //    حتّى لو underpaid نَكتب السجلَّ — للتدقيق ولتجنّب إعادة الإرسال من المزوّد.
  const payRow = {
    passenger_id: pax?.id ?? null,
    trip_id: pax?.trip_id ?? null,
    subscriber_id: pax?.subscriber_id ?? null,
    provider: PROVIDER,
    provider_ref: e.ref ?? `pax:${e.passengerId}`,
    amount: e.amount,
    currency: e.currency,
    status: isUnderpaid ? 'underpaid' : 'paid',
    raw: ev,
  }
  const { data: inserted, error: insErr } = await db
    .from('payments').upsert(payRow, { onConflict: 'provider,provider_ref', ignoreDuplicates: true }).select('id')
  if (insErr) return json(500, { error: 'record_failed' })
  if (!inserted || inserted.length === 0) return json(200, { ok: true, duplicate: true })  // عولج سابقًا

  // 6) تأكيد حجز الراكب (إن وُجد ولم يَكن underpaid) — التريغر يختم paid_at
  if (pax && !isUnderpaid && pax.status !== 'paid' && pax.status !== 'boarded' && pax.status !== 'checked_in') {
    await db.from('passengers').update({
      status: 'paid',
      amount: e.amount ?? pax.amount ?? null,
      payment_provider: PROVIDER,
    }).eq('id', pax.id)
  }

  return json(200, {
    ok: true,
    matched: Boolean(pax),
    ...(isUnderpaid ? { warning: 'underpaid', expected, actual: e.amount } : {}),
  })
})
