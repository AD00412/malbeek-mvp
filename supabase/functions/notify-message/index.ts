// ============================================================
//  ملبّيك · Edge Function: notify-message
//  يُرسل بريدًا إلى صندوق الدعم (hello@mulabeek.com) عند وصول رسالةٍ
//  جديدةٍ من نموذج الـ Landing (public_messages)، مع روابطٍ موقَّعةٍ
//  للمرفقات. يُستدعى عبر Database Webhook (INSERT على public_messages).
//
//  الأمان:
//  - يتحقّق من ترويسة x-webhook-secret لمنع الاستدعاء العشوائيّ.
//  - SMTP credentials تبقى في أسرار الـ Edge — لا تُكشف أبدًا للعميل.
//  انظر README.md لخطوات النشر وضبط الأسرار.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? 'mail.mulabeek.com'
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465')
const SMTP_USER = Deno.env.get('SMTP_USER') ?? 'hello@mulabeek.com'
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? ''
const MAIL_TO   = Deno.env.get('MAIL_TO')   ?? 'hello@mulabeek.com'
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'hello@mulabeek.com'
const HOOK_SECRET = Deno.env.get('NOTIFY_WEBHOOK_SECRET') ?? ''

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const KIND_AR: Record<string, string> = {
  contact: 'تواصل', suggestion: 'اقتراح', problem: 'مشكلة',
  question: 'سؤال', feature: 'ميزة جديدة',
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // ١) تحقّقٌ من سرّ الـ webhook (يُمرَّر كترويسةٍ من إعداد الـ Database Webhook)
  if (HOOK_SECRET) {
    const got = req.headers.get('x-webhook-secret') ?? ''
    if (got !== HOOK_SECRET) return json(401, { error: 'unauthorized' })
  }

  let payload: any
  try { payload = await req.json() } catch { return json(400, { error: 'bad_json' }) }

  // Database Webhook يرسل { type, table, record, old_record }
  const rec = payload?.record ?? payload
  if (!rec?.id || !rec?.body) return json(400, { error: 'no_record' })

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // ٢) روابطٌ موقَّعةٌ للمرفقات (صلاحيّةُ ٧ أيّام) — حتّى تُفتح من البريد مباشرةً
  let attachLinks: string[] = []
  const paths: string[] = Array.isArray(rec.attachments) ? rec.attachments : []
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from('public-attachments')
      .createSignedUrls(paths, 60 * 60 * 24 * 7)
    attachLinks = (signed ?? []).map((s) => s.signedUrl).filter(Boolean)
  }

  // ٣) بناءُ الرسالة — نتجنّب الإيموجي في العنوان لتحسين التوافق مع webmail
  //    القديم (يعرضه raw)؛ الإيموجي يبقى مرئيًّا داخل محتوى HTML.
  const kindAr = KIND_AR[rec.kind] ?? rec.kind ?? '—'
  const modeAr = rec.mode === 'contact' ? 'تواصل' : 'ملاحظة'
  const subjectLine = `Malbeek | ${modeAr} - ${rec.name}`

  const attachHtml = attachLinks.length
    ? `<p style="margin:14px 0 4px;font-weight:700">المرفقات (${attachLinks.length}):</p>
       <ul style="margin:0;padding-inline-start:18px">
       ${attachLinks.map((u, i) => `<li><a href="${esc(u)}">مرفق ${i + 1}</a></li>`).join('')}
       </ul>`
    : ''

  const html = `<!doctype html><html dir="rtl" lang="ar"><body style="font-family:system-ui,Arial,sans-serif;background:#f4faf6;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;border:1px solid #e2e8e4">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
        <div style="width:40px;height:40px;border-radius:11px;background:linear-gradient(140deg,#34d399,#059669);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px">م</div>
        <strong style="font-size:18px;color:#0a1f17">ملبّيك · رسالةٌ جديدة</strong>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#0a1f17">
        <tr><td style="padding:8px 0;color:#5f7a6e;width:90px">النوع</td><td style="padding:8px 0;font-weight:600">${esc(modeAr)} · ${esc(kindAr)}</td></tr>
        <tr><td style="padding:8px 0;color:#5f7a6e">الاسم</td><td style="padding:8px 0;font-weight:600">${esc(rec.name)}</td></tr>
        <tr><td style="padding:8px 0;color:#5f7a6e">البريد</td><td style="padding:8px 0"><a href="mailto:${esc(rec.email)}" style="color:#059669">${esc(rec.email)}</a></td></tr>
        ${rec.subject ? `<tr><td style="padding:8px 0;color:#5f7a6e">الموضوع</td><td style="padding:8px 0;font-weight:600">${esc(rec.subject)}</td></tr>` : ''}
      </table>
      <div style="margin-top:14px;padding:14px;background:#f4faf6;border-radius:10px;white-space:pre-wrap;line-height:1.8;color:#152c20">${esc(rec.body)}</div>
      ${attachHtml}
      <p style="margin-top:18px;font-size:12px;color:#5f7a6e">للردّ، اضغط «رد» — سيصل مباشرةً لبريد المُرسِل (${esc(rec.email)}).</p>
    </div>
  </body></html>`

  // ٤) الإرسال عبر SMTP (cPanel — SSL/TLS على المنفذ 465)
  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: SMTP_PORT === 465,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  })

  try {
    await client.send({
      from: `ملبّيك <${MAIL_FROM}>`,
      to: MAIL_TO,
      replyTo: `${rec.name} <${rec.email}>`,   // الردّ يذهب للمُرسِل مباشرةً
      subject: subjectLine,
      html,
      content: `${modeAr} · ${kindAr}\nالاسم: ${rec.name}\nالبريد: ${rec.email}\n\n${rec.body}`,
    })
    await client.close()
  } catch (e) {
    try { await client.close() } catch (_) { /* ignore */ }
    return json(502, { error: 'smtp_failed', detail: String((e as Error)?.message ?? e) })
  }

  return json(200, { ok: true })
})
