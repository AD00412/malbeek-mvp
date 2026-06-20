// ============================================================
//  ملبّيك · Edge Function: send-upgrade-received
//  يُرسل إيميلَ استلامٍ للمشترك بعد رفع إثبات الدفع.
//
//  Body: { request_id: uuid }
//  Auth: JWT المشترك نفسه. يَتحقّق من ملكيّة الطلب.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? 'mail.mulabeek.com'
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465')
const SMTP_USER = Deno.env.get('SMTP_USER') ?? 'hello@mulabeek.com'
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? ''
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'hello@mulabeek.com'

const ALLOWED_SMTP_PORTS = new Set([465, 587])

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...cors },
  })

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST')    return json(405, { error: 'method_not_allowed' })

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'unauthenticated' })

  let body: any
  try { body = await req.json() } catch { return json(400, { error: 'invalid_json' }) }
  const requestId = body?.request_id
  if (!requestId) return json(400, { error: 'missing_request_id' })
  if (!ALLOWED_SMTP_PORTS.has(SMTP_PORT)) return json(500, { error: 'smtp_port_not_allowed' })

  // ١) تَحقّقُ ملكيّة الطلب — المشتركُ نفسُه
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json(401, { error: 'unauthenticated' })

  // ٢) جَلبُ بيانات الطلب بصلاحيّة service
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: row, error: rowErr } = await admin
    .from('plan_upgrade_requests')
    .select('id, status, amount, requested_by, subscriber_id, submitted_at')
    .eq('id', requestId)
    .maybeSingle()
  if (rowErr) return json(500, { error: 'fetch_failed', detail: rowErr.message })
  if (!row)   return json(404, { error: 'not_found' })
  if (row.requested_by !== user.id) return json(403, { error: 'not_owner' })
  if (row.status !== 'submitted')  return json(409, { error: 'wrong_stage', status: row.status })

  const { data: sub } = await admin.from('subscribers').select('org_name').eq('id', row.subscriber_id).maybeSingle()
  const { data: usr } = await admin.from('profiles').select('full_name').eq('id', row.requested_by).maybeSingle()
  const orgName = sub?.org_name || ''
  const userName = usr?.full_name || ''
  const email = user.email
  if (!email) return json(404, { error: 'email_not_found' })

  const when = (() => {
    try { return new Date(row.submitted_at).toLocaleString('ar-SA', {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    }) } catch { return '' }
  })()

  const subject = '✓ استلمنا إثباتَ دفعك — ملبّيك'

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f4faf6;font-family:'Segoe UI',Tahoma,Arial;color:#0a1f17;line-height:1.7">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(6,95,70,.08)">
      <tr><td style="background:linear-gradient(135deg,#065f46,#047857,#059669);padding:26px 28px;color:#fff">
        <div style="font-size:24px;font-weight:800">ملبّيك</div>
        <div style="font-size:11.5px;color:rgba(255,255,255,.78);letter-spacing:2.5px;margin-top:6px">mulabeek.com</div>
      </td></tr>
      <tr><td style="padding:22px 28px 0">
        <div style="display:inline-block;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:700;color:#047857">✓ استلمنا الإثبات</div>
      </td></tr>
      <tr><td style="padding:18px 28px 0">
        <div style="font-size:20px;font-weight:800">مرحبًا ${esc(userName)} 👋</div>
        <div style="font-size:14.5px;color:#5f7a6e;margin-top:10px">
          استلمنا إثباتَ دفعك لترقية حملة <strong>${esc(orgName)}</strong>${row.amount ? ` (${Number(row.amount).toLocaleString('en-US')} ﷼)` : ''}.
        </div>
      </td></tr>
      <tr><td style="padding:18px 28px 0">
        <div style="padding:16px 18px;background:#fafdfb;border:1px solid #e6efe9;border-inline-start:3px solid #059669;border-radius:12px">
          <div style="font-weight:700;font-size:14px;color:#065f46;margin-bottom:6px">ماذا الآن؟</div>
          <ul style="margin:0;padding-inline-start:18px;font-size:13.5px;line-height:2;color:#152c20">
            <li>الإدارةُ تُراجع الإثبات حاليًّا</li>
            <li>عادةً يَستغرق الأمرُ من ساعةٍ إلى ٢٤ ساعة</li>
            <li>سَتَصلك رسالةٌ بنتيجة المراجعة</li>
          </ul>
          ${when ? `<div style="margin-top:10px;font-size:12px;color:#5f7a6e">⏱ رُفع: ${esc(when)}</div>` : ''}
        </div>
      </td></tr>
      <tr><td style="padding:22px 28px 0">
        <div style="font-size:13.5px;color:#5f7a6e">
          إن كان عندك أيُّ استفسار، رَدَّ على هذا البريد أو راسلنا على <a href="mailto:hello@mulabeek.com" style="color:#059669">hello@mulabeek.com</a>.
        </div>
      </td></tr>
      <tr><td style="padding:22px 28px 8px" align="center">
        <div style="font-size:14px;font-weight:600">— فريق ملبّيك</div>
      </td></tr>
      <tr><td style="padding:18px 28px 22px;border-top:1px solid #f0f5f2">
        <div style="font-size:11.5px;color:#8aa39b"><a href="https://mulabeek.com" style="color:#5f7a6e;text-decoration:none">mulabeek.com</a> · © ملبّيك</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

  const text =
    `ملبّيك — استلمنا إثباتَ دفعك ✓\n${'─'.repeat(40)}\n` +
    `مرحبًا ${userName}،\n\n` +
    `استلمنا إثباتَ دفعك لترقية حملة ${orgName}.\n\n` +
    `ستُراجعه الإدارة وستَصلك رسالةٌ بنتيجة المراجعة.\n\n` +
    `— فريق ملبّيك\nmulabeek.com\n`

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT,
    secure: SMTP_PORT === 465, requireTLS: SMTP_PORT === 587,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  })
  try {
    await transporter.sendMail({
      from: { name: 'ملبّيك', address: MAIL_FROM },
      to: email, subject, text, html,
    })
  } catch (e) {
    return json(502, { error: 'smtp_failed', detail: String((e as Error)?.message ?? e) })
  }
  return json(200, { ok: true, sent_to: email })
})
