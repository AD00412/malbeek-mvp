// ============================================================
//  ملبّيك · Edge Function: send-staff-invite
//  يُرسل بريدَ دعوةٍ منسَّقًا لمَن دَعاه الأدمن للانضمام لفريق ملبّيك.
//  يَستدعيه الأدمن من داخل التطبيق بعد إنشاء سجلٍّ في staff_invitations.
//
//  Body: { invitation_id: uuid }
//  Auth: JWT أدمن. RLS تَحمي القراءة عبر RPCs، نُحقّق هنا أيضًا.
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

const ROLE_AR: Record<string, string> = {
  admin:   'أدمن — صلاحيّةٌ كاملة',
  support: 'دعم — قراءةٌ والردُّ على الرسائل',
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

  if (!ALLOWED_SMTP_PORTS.has(SMTP_PORT)) {
    return json(500, { error: 'smtp_port_not_allowed' })
  }

  // ١) تحقّق الدور: نَستعمل عميلَ المستخدم لقراءة my_role
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: roleData, error: roleErr } = await userClient.rpc('my_role')
  if (roleErr) return json(500, { error: 'role_check_failed' })
  if (roleData !== 'admin') return json(403, { error: 'admin_only' })

  // ٢) قراءة الدعوة بصلاحيّة service لجلب token (لا يُكشَف للعميل)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: inv, error: invErr } = await admin
    .from('staff_invitations')
    .select('id, email, invited_role, invited_by_name, token, status, expires_at')
    .eq('id', invitationId)
    .maybeSingle()
  if (invErr) return json(500, { error: 'fetch_failed', detail: invErr.message })
  if (!inv)   return json(404, { error: 'invitation_not_found' })
  if (inv.status !== 'pending') return json(409, { error: 'invitation_not_pending', status: inv.status })

  const link = `${APP_URL.replace(/\/+$/,'')}/invite/${encodeURIComponent(inv.token)}`
  const roleLabel = ROLE_AR[inv.invited_role] ?? inv.invited_role
  const inviter = inv.invited_by_name ? `${inv.invited_by_name} من فريق ملبّيك` : 'فريق ملبّيك'
  const expiry = (() => {
    try { return new Date(inv.expires_at).toLocaleDateString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric',
    }) } catch { return '' }
  })()

  const compassSvg = `<svg width="56" height="56" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs>
      <linearGradient id="mlk-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#34d399"/>
        <stop offset="55%" stop-color="#059669"/>
        <stop offset="100%" stop-color="#065f46"/>
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="18" fill="url(#mlk-bg)"/>
    <path d="M14 50 V30 A8 8 0 0 1 30 30 V50" stroke="#ffffff" stroke-width="4" stroke-linecap="round" fill="none"/>
    <path d="M30 50 V34 A11 11 0 1 1 41 45" stroke="#ffffff" stroke-width="4" stroke-linecap="round" fill="none"/>
    <rect x="35" y="27.5" width="12" height="12" rx="1.3" fill="#fbbf24"/>
    <line x1="35" y1="31.5" x2="47" y2="31.5" stroke="#1a0f00" stroke-width="1.5"/>
    <rect x="39.5" y="33" width="3" height="6.5" rx="0.4" fill="#1a0f00"/>
  </svg>`

  const subjectLine = `دعوةٌ للانضمام لفريق ملبّيك — ${roleLabel}`

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(subjectLine)}</title>
</head>
<body style="margin:0;padding:0;background:#f4faf6;font-family:'Segoe UI','Helvetica Neue',Tahoma,Arial,sans-serif;color:#0a1f17;line-height:1.6;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4faf6;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(6,95,70,.08)">

        <tr><td style="background:linear-gradient(135deg,#065f46 0%,#047857 50%,#059669 100%);padding:26px 28px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="vertical-align:middle">${compassSvg}</td>
              <td align="left" style="vertical-align:middle">
                <div style="font-family:'Segoe UI',Tahoma,Arial;font-size:24px;font-weight:800;color:#ffffff;line-height:1.1">ملبّيك</div>
                <div style="font-size:11.5px;color:rgba(255,255,255,.78);letter-spacing:2.5px;text-transform:lowercase;margin-top:6px">mulabeek.com</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:22px 28px 0">
          <div style="display:inline-block;background:#fef3c7;border:1px solid #fde68a;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:700;color:#92400e">
            ✨ دعوةٌ خاصّةٌ
          </div>
        </td></tr>

        <tr><td style="padding:18px 28px 0">
          <div style="font-size:20px;font-weight:800;color:#0a1f17">السلامُ عليكم،</div>
          <div style="font-size:14.5px;color:#5f7a6e;margin-top:10px">دعاكَ <strong>${esc(inviter)}</strong> للانضمام إلى منصّة <strong>ملبّيك</strong> بصفة:</div>
        </td></tr>

        <tr><td style="padding:14px 28px 0">
          <div style="padding:18px 20px;background:#ecfdf5;border:1px solid #a7f3d0;border-inline-start:3px solid #059669;border-radius:12px;color:#065f46;font-size:16px;font-weight:700">
            ${esc(roleLabel)}
          </div>
        </td></tr>

        <tr><td style="padding:22px 28px 0">
          <div style="font-size:14.5px;color:#5f7a6e">للمتابعة، اضغط الزرَّ التالي لإكمال بياناتك. ستَخضع الموافقةُ النهائيّة لمراجعة الإدارة.</div>
        </td></tr>

        <tr><td style="padding:18px 28px 6px" align="center">
          <a href="${esc(link)}" style="display:inline-block;background:linear-gradient(135deg,#065f46,#059669);color:#ffffff;font-weight:800;font-size:15px;text-decoration:none;padding:14px 36px;border-radius:99px;box-shadow:0 4px 12px rgba(6,95,70,.25)">
            إكمالُ التَّسجيل ↩︎
          </a>
        </td></tr>

        <tr><td style="padding:14px 28px 0">
          <div style="font-size:12px;color:#8aa39b">أو انسخِ الرابطَ مباشرةً:</div>
          <div style="margin-top:6px;padding:10px 12px;background:#f6f8f6;border:1px solid #e6efe9;border-radius:8px;font-family:monospace;font-size:12px;color:#5f7a6e;word-break:break-all">${esc(link)}</div>
        </td></tr>

        ${expiry ? `<tr><td style="padding:14px 28px 0">
          <div style="font-size:12.5px;color:#8aa39b">⏱ تَنتهي صلاحيّةُ الدعوة في <strong style="color:#5f7a6e">${esc(expiry)}</strong></div>
        </td></tr>` : ''}

        <tr><td style="padding:22px 28px 8px" align="center">
          <div style="font-size:14px;color:#0a1f17;font-weight:600">— فريق ملبّيك</div>
          <div style="margin-top:4px;font-size:12px;color:#8aa39b">إن كانت هذه الدعوةُ غير متوقَّعةٍ، تَجاهلْها بأمان</div>
        </td></tr>

        <tr><td style="padding:18px 28px 22px;border-top:1px solid #f0f5f2">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="font-size:11.5px;color:#8aa39b"><a href="https://mulabeek.com" style="color:#5f7a6e;text-decoration:none">mulabeek.com</a></td>
              <td align="left" style="font-size:11.5px;color:#8aa39b">© ملبّيك</td>
            </tr>
          </table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`

  const textBody =
    `ملبّيك — دعوةُ انضمامٍ لفريق العمل\n` +
    `${'─'.repeat(40)}\n` +
    `دَعاك ${inviter} للانضمام بصفة: ${roleLabel}\n\n` +
    `أكمل تسجيلَك عبر الرابط:\n${link}\n\n` +
    (expiry ? `تَنتهي الصلاحيّة: ${expiry}\n\n` : '') +
    `${'─'.repeat(40)}\n` +
    `— فريق ملبّيك\nmulabeek.com\n`

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    requireTLS: SMTP_PORT === 587,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  })

  try {
    await transporter.sendMail({
      from: { name: 'ملبّيك', address: MAIL_FROM },
      to: inv.email,
      subject: subjectLine,
      text: textBody,
      html,
    })
  } catch (e) {
    return json(502, { error: 'smtp_failed', detail: String((e as Error)?.message ?? e) })
  }

  return json(200, { ok: true, sent_to: inv.email })
})
