// ============================================================
//  ملبّيك · Edge Function: send-upgrade-decision
//  يُرسل قرارَ ترقية الباقة للمشترك (قَبول أو رفض مع سبب).
//
//  Body: { request_id: uuid }
//  Auth: JWT أدمن. يَقرأ حالةَ plan_upgrade_requests.
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
const APP_URL   = Deno.env.get('APP_URL')   ?? 'https://mulabeek.com'

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

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  })
  const { data: role, error: rErr } = await userClient.rpc('my_role')
  if (rErr) return json(500, { error: 'role_check_failed' })
  if (role !== 'admin') return json(403, { error: 'admin_only' })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: row, error: rowErr } = await admin
    .from('plan_upgrade_requests')
    .select('id, status, amount, reject_reason, subscriber_id, requested_by')
    .eq('id', requestId)
    .maybeSingle()
  if (rowErr) return json(500, { error: 'fetch_failed', detail: rowErr.message })
  if (!row)   return json(404, { error: 'not_found' })

  const { data: sub } = await admin.from('subscribers').select('org_name').eq('id', row.subscriber_id).maybeSingle()
  const { data: usr } = await admin.from('profiles').select('full_name').eq('id', row.requested_by).maybeSingle()
  const { data: auth_usr } = await admin.auth.admin.getUserById(row.requested_by)
  const email = auth_usr?.user?.email
  if (!email) return json(404, { error: 'email_not_found' })

  const orgName = sub?.org_name || ''
  const userName = usr?.full_name || ''

  const isAccept = row.status === 'approved'
  const isReject = row.status === 'rejected'
  if (!isAccept && !isReject) {
    return json(409, { error: 'wrong_stage', status: row.status })
  }

  const subject = isAccept
    ? '🎉 تَمّت ترقيةُ حملتك إلى الباقة المدفوعة — ملبّيك'
    : 'بخصوصِ طلب الترقية — ملبّيك'

  const html = isAccept ? `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f4faf6;font-family:'Segoe UI',Tahoma,Arial;color:#0a1f17;line-height:1.7">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(6,95,70,.08)">
      <tr><td style="background:linear-gradient(135deg,#065f46,#047857,#059669);padding:26px 28px;color:#fff">
        <div style="font-size:24px;font-weight:800">ملبّيك</div>
        <div style="font-size:11.5px;color:rgba(255,255,255,.78);letter-spacing:2.5px;margin-top:6px">mulabeek.com</div>
      </td></tr>
      <tr><td style="padding:22px 28px 0">
        <div style="display:inline-block;background:#dcfce7;border:1px solid #86efac;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:700;color:#166534">🎉 رُقّيت لمدفوعة</div>
      </td></tr>
      <tr><td style="padding:18px 28px 0">
        <div style="font-size:20px;font-weight:800">مَبروك ${esc(userName)} 🎊</div>
        <div style="font-size:14.5px;color:#5f7a6e;margin-top:10px">
          تَحقّقنا من دَفعك (${Number(row.amount).toLocaleString('en-US')} ﷼) ورُقّيت حملتُك <strong>${esc(orgName)}</strong> إلى باقة ملبّيك المدفوعة.
        </div>
      </td></tr>
      <tr><td style="padding:14px 28px 0">
        <div style="padding:18px 20px;background:#fafdfb;border:1px solid #e6efe9;border-inline-start:3px solid #059669;border-radius:12px;color:#065f46">
          <div style="font-weight:700;font-size:14px;margin-bottom:6px">✓ ما الذي تَحصل عليه:</div>
          <ul style="margin:0;padding-inline-start:18px;font-size:13.5px;line-height:2;color:#152c20">
            <li>رحلاتٌ غير محدودة</li>
            <li>بحثٌ كاملٌ لمعتمرين</li>
            <li>تَقاريرُ PDF و Word</li>
            <li>دعمٌ ذو أولويّة</li>
          </ul>
        </div>
      </td></tr>
      <tr><td style="padding:22px 28px 6px" align="center">
        <a href="${esc(APP_URL)}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#065f46,#059669);color:#fff;font-weight:800;font-size:15px;text-decoration:none;padding:14px 36px;border-radius:99px;box-shadow:0 4px 12px rgba(6,95,70,.25)">
          ادخل لِلوحتك ↩︎
        </a>
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
  : `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f4faf6;font-family:'Segoe UI',Tahoma,Arial;color:#0a1f17;line-height:1.7">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(6,95,70,.08)">
      <tr><td style="background:linear-gradient(135deg,#374151,#1f2937);padding:26px 28px;color:#fff">
        <div style="font-size:24px;font-weight:800">ملبّيك</div>
        <div style="font-size:11.5px;color:rgba(255,255,255,.78);letter-spacing:2.5px;margin-top:6px">mulabeek.com</div>
      </td></tr>
      <tr><td style="padding:22px 28px 0">
        <div style="font-size:18px;font-weight:800">عزيزي ${esc(userName)},</div>
        <div style="font-size:14.5px;color:#5f7a6e;margin-top:10px">
          راجَعنا طلبَك لترقية حملة <strong>${esc(orgName)}</strong> ولم نَتمكّن من المُوافقة عليه في هذه المرحلة.
        </div>
      </td></tr>
      ${row.reject_reason ? `<tr><td style="padding:14px 28px 0">
        <div style="padding:14px 16px;background:#fafafa;border:1px solid #e5e7eb;border-inline-start:3px solid #9ca3af;border-radius:10px;color:#374151;font-size:13.5px;white-space:pre-wrap">${esc(row.reject_reason)}</div>
      </td></tr>` : ''}
      <tr><td style="padding:22px 28px 0">
        <div style="font-size:13.5px;color:#5f7a6e">
          إن كان هناك ما يُمكن تَصحيحه، تَواصل معنا على <a href="mailto:hello@mulabeek.com" style="color:#059669">hello@mulabeek.com</a> ونُساعدك في إكمال الطلب.
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

  const text = isAccept
    ? `ملبّيك — رُقّيت حملتُك ${orgName} لمدفوعة 🎉\n${'─'.repeat(40)}\nمبروك ${userName}،\n\nادخل لِلوحتك: ${APP_URL}/dashboard\n\n— فريق ملبّيك\n`
    : `ملبّيك\n${'─'.repeat(40)}\nشكرًا لاهتمامك. اعتذرنا عن طلب ترقية ${orgName}.\n${row.reject_reason ? '\n' + row.reject_reason + '\n' : ''}\n— فريق ملبّيك\n`

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
  return json(200, { ok: true, sent_to: email, kind: isAccept ? 'approved' : 'rejected' })
})
