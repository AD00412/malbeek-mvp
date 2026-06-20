// ============================================================
//  ملبّيك · Edge Function: send-staff-interview
//  يُرسل بريدَ موافقةٍ مَبدئيّةٍ + موعد مقابلةٍ للمتقدّم.
//  يَستدعيه الأدمن بعد preliminary_approve_invitation.
//
//  Body: { invitation_id: uuid }
//  Auth: JWT أدمن.
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
  const invitationId = body?.invitation_id
  if (!invitationId) return json(400, { error: 'missing_invitation_id' })
  if (!ALLOWED_SMTP_PORTS.has(SMTP_PORT)) return json(500, { error: 'smtp_port_not_allowed' })

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  })
  const { data: role, error: rErr } = await userClient.rpc('my_role')
  if (rErr) return json(500, { error: 'role_check_failed' })
  if (role !== 'admin') return json(403, { error: 'admin_only' })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: inv, error: invErr } = await admin
    .from('staff_invitations')
    .select('id, email, applicant_full_name, invited_role, interview_at, interview_location, interview_notes, status')
    .eq('id', invitationId)
    .maybeSingle()
  if (invErr) return json(500, { error: 'fetch_failed', detail: invErr.message })
  if (!inv)   return json(404, { error: 'not_found' })
  if (inv.status !== 'prelim_approved') return json(409, { error: 'wrong_stage', status: inv.status })

  const when = (() => {
    try { return new Date(inv.interview_at).toLocaleString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) } catch { return '' }
  })()

  const subject = 'موافقةٌ مَبدئيّةٌ + موعد مقابلة — ملبّيك'

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f4faf6;font-family:'Segoe UI',Tahoma,Arial;color:#0a1f17;line-height:1.7">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(6,95,70,.08)">
      <tr><td style="background:linear-gradient(135deg,#065f46,#047857,#059669);padding:26px 28px;color:#fff">
        <div style="font-size:24px;font-weight:800">ملبّيك</div>
        <div style="font-size:11.5px;color:rgba(255,255,255,.78);letter-spacing:2.5px;margin-top:6px">mulabeek.com</div>
      </td></tr>
      <tr><td style="padding:22px 28px 0">
        <div style="display:inline-block;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:700;color:#047857">موافقةٌ مَبدئيّة ✓</div>
      </td></tr>
      <tr><td style="padding:18px 28px 0">
        <div style="font-size:20px;font-weight:800">مرحبًا ${esc(inv.applicant_full_name || '')} 👋،</div>
        <div style="font-size:14.5px;color:#5f7a6e;margin-top:10px">
          راجَعنا وَثائقَك بسرور — وَوافقنا مَبدئيًّا على متابعتك للمرحلة التالية: <strong>المقابلة</strong>.
        </div>
      </td></tr>
      <tr><td style="padding:18px 28px 0">
        <div style="padding:18px 20px;background:#fafdfb;border:1px solid #e6efe9;border-inline-start:3px solid #059669;border-radius:12px">
          <div style="font-weight:700;font-size:15px;color:#065f46">🗓 موعدُ المقابلة</div>
          <div style="margin-top:8px;font-size:15px">${esc(when)}</div>
          ${inv.interview_location ? `<div style="margin-top:8px;font-size:14px;color:#5f7a6e">📍 ${esc(inv.interview_location)}</div>` : ''}
          ${inv.interview_notes ? `<div style="margin-top:10px;font-size:13.5px;color:#5f7a6e;white-space:pre-wrap">${esc(inv.interview_notes)}</div>` : ''}
        </div>
      </td></tr>
      <tr><td style="padding:22px 28px 0">
        <div style="font-size:14px;color:#5f7a6e">
          نَتطلّع للقائك. لو تَعذّر الحضور في الموعد المحدَّد، رَدَّ على هذا البريد لتَنسيق موعدٍ آخر.
        </div>
      </td></tr>
      <tr><td style="padding:22px 28px 8px" align="center">
        <div style="font-size:14px;font-weight:600">— فريق ملبّيك</div>
        <div style="margin-top:4px;font-size:12px;color:#8aa39b">القرارُ النهائيّ بعد المقابلة</div>
      </td></tr>
      <tr><td style="padding:18px 28px 22px;border-top:1px solid #f0f5f2">
        <div style="font-size:11.5px;color:#8aa39b"><a href="https://mulabeek.com" style="color:#5f7a6e;text-decoration:none">mulabeek.com</a> · © ملبّيك</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

  const text =
    `ملبّيك — موافقةٌ مَبدئيّة\n${'─'.repeat(40)}\n` +
    `مرحبًا ${inv.applicant_full_name || ''}،\n\n` +
    `وافقنا مبدئيًّا — موعد المقابلة:\n${when}\n` +
    (inv.interview_location ? `الموقع: ${inv.interview_location}\n` : '') +
    (inv.interview_notes ? `ملاحظات: ${inv.interview_notes}\n` : '') +
    `\n— فريق ملبّيك\nmulabeek.com\n`

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT,
    secure: SMTP_PORT === 465, requireTLS: SMTP_PORT === 587,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  })
  try {
    await transporter.sendMail({
      from: { name: 'ملبّيك', address: MAIL_FROM },
      to: inv.email, subject, text, html,
    })
  } catch (e) {
    return json(502, { error: 'smtp_failed', detail: String((e as Error)?.message ?? e) })
  }
  return json(200, { ok: true, sent_to: inv.email })
})
