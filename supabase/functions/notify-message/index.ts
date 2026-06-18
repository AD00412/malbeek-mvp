// ============================================================
//  ملبّيك · Edge Function: notify-message
//  يُرسل بريدًا إلى صندوق الدعم (hello@mulabeek.com) عند وصول رسالةٍ
//  جديدةٍ من نموذج الـ Landing (public_messages)، مع روابطٍ موقَّعةٍ
//  للمرفقات. يُستدعى عبر Database Webhook (INSERT على public_messages).
//
//  v2: استُبدل denomailer بـ nodemailer (npm:) لأنّه يُنتج MIME سليمًا
//  لـ UTF-8 + multipart — denomailer أنتج رسائلَ تُعرَض كنصٍّ raw مشفّرٍ
//  في Gmail/Apple Mail (encoded-words غير مفكوكةٍ، quoted-printable مكسور).
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

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

  // ٢) روابطٌ موقَّعةٌ للمرفقات (صلاحيّةُ ٧ أيّام)
  let attachLinks: string[] = []
  const paths: string[] = Array.isArray(rec.attachments) ? rec.attachments : []
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from('public-attachments')
      .createSignedUrls(paths, 60 * 60 * 24 * 7)
    attachLinks = (signed ?? []).map((s: any) => s.signedUrl).filter(Boolean)
  }

  // ٣) بناءُ المحتوى
  const kindAr = KIND_AR[rec.kind] ?? rec.kind ?? '—'
  const modeAr = rec.mode === 'contact' ? 'تواصل' : 'ملاحظة'
  const subjectLine = `ملبّيك · ${modeAr} جديدة من ${rec.name}`
  const createdAt = (() => {
    try { return new Date(rec.created_at ?? Date.now()).toLocaleString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }) } catch { return '' }
  })()

  const attachHtml = attachLinks.length
    ? `<div style="margin-top:18px;padding:14px 16px;background:#fafdfb;border:1px solid #e6efe9;border-radius:12px">
         <div style="font-size:13px;color:#5f7a6e;font-weight:600;margin-bottom:8px">المرفقات (${attachLinks.length})</div>
         <table style="width:100%;border-collapse:collapse">
         ${attachLinks.map((u, i) => `<tr>
           <td style="padding:6px 0;font-size:14px"><a href="${esc(u)}" style="color:#047857;font-weight:600;text-decoration:none">📎 مرفق ${i + 1}</a></td>
         </tr>`).join('')}
         </table>
         <div style="font-size:11px;color:#8aa39b;margin-top:6px">الروابط فعّالةٌ لمدة ٧ أيّامٍ</div>
       </div>`
    : ''

  // المرسل ledger — هويّةُ ملبّيك بـ M·٢ الطواف (إيموجي عوضًا عن SVG لأنّ بعض
  // عملاء البريد يحجبون الصور افتراضيًّا، فنريد عرضًا فوريًّا بلا تحميل).
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

      <!-- البطاقة الرئيسيّة -->
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(6,95,70,.08)">

        <!-- شريطٌ علويٌّ بهويّة ملبّيك -->
        <tr><td style="background:linear-gradient(135deg,#059669 0%,#047857 60%,#065f46 100%);padding:24px 28px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="vertical-align:middle">
                <div style="display:inline-block;background:rgba(255,255,255,.18);border-radius:12px;padding:8px 14px;font-size:11px;font-weight:600;color:#ffffff;letter-spacing:.5px">رسالةٌ جديدة</div>
                <div style="margin-top:10px;font-family:'Segoe UI',Tahoma,Arial;font-size:22px;font-weight:800;color:#ffffff">ملبّيك</div>
                <div style="font-size:12px;color:rgba(255,255,255,.78);letter-spacing:2px;text-transform:lowercase">mulabeek.com</div>
              </td>
              <td align="left" style="vertical-align:middle">
                <div style="width:56px;height:56px;border-radius:16px;background:rgba(255,255,255,.18);text-align:center;line-height:56px;font-size:28px;font-weight:900;color:#ffffff">م</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- شريحةُ النوع -->
        <tr><td style="padding:20px 28px 0">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:700;color:#047857">
                ${esc(modeAr)} · ${esc(kindAr)}
              </td>
              ${createdAt ? `<td style="padding-inline-start:10px;font-size:12px;color:#8aa39b">${esc(createdAt)}</td>` : ''}
            </tr>
          </table>
        </td></tr>

        <!-- جدولُ المعلومات -->
        <tr><td style="padding:18px 28px 0">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border:1px solid #e6efe9;border-radius:12px;overflow:hidden">
            <tr>
              <td style="padding:12px 16px;background:#fafdfb;border-bottom:1px solid #e6efe9;color:#5f7a6e;font-size:13px;width:90px">الاسم</td>
              <td style="padding:12px 16px;background:#fafdfb;border-bottom:1px solid #e6efe9;font-size:14px;font-weight:600;color:#0a1f17">${esc(rec.name)}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;border-bottom:1px solid #e6efe9;color:#5f7a6e;font-size:13px">البريد</td>
              <td style="padding:12px 16px;border-bottom:1px solid #e6efe9;font-size:14px"><a href="mailto:${esc(rec.email)}" style="color:#047857;font-weight:600;text-decoration:none" dir="ltr">${esc(rec.email)}</a></td>
            </tr>
            ${rec.subject ? `<tr>
              <td style="padding:12px 16px;background:#fafdfb;color:#5f7a6e;font-size:13px">الموضوع</td>
              <td style="padding:12px 16px;background:#fafdfb;font-size:14px;font-weight:600;color:#0a1f17">${esc(rec.subject)}</td>
            </tr>` : ''}
          </table>
        </td></tr>

        <!-- نصُّ الرسالة -->
        <tr><td style="padding:18px 28px 0">
          <div style="font-size:12px;font-weight:600;color:#5f7a6e;margin-bottom:8px">نصّ الرسالة</div>
          <div style="padding:16px 18px;background:#fafdfb;border:1px solid #e6efe9;border-inline-start:3px solid #059669;border-radius:12px;white-space:pre-wrap;line-height:1.85;color:#152c20;font-size:14.5px">${esc(rec.body)}</div>
        </td></tr>

        <!-- المرفقات (إن وُجدت) -->
        <tr><td style="padding:0 28px">${attachHtml}</td></tr>

        <!-- زرّ الردّ السريع -->
        <tr><td style="padding:24px 28px 8px" align="center">
          <a href="mailto:${esc(rec.email)}?subject=${encodeURIComponent('Re: ' + subjectLine)}"
             style="display:inline-block;background:linear-gradient(135deg,#059669,#047857);color:#ffffff;text-decoration:none;font-weight:700;font-size:14.5px;padding:13px 28px;border-radius:12px;box-shadow:0 4px 12px rgba(5,150,105,.28)">
            ↩︎ ردٌّ على ${esc(rec.name)}
          </a>
          <div style="margin-top:8px;font-size:11.5px;color:#8aa39b">أو اضغط «رد» في بريدك — يصل المُرسِل مباشرةً</div>
        </td></tr>

        <!-- التذييل -->
        <tr><td style="padding:18px 28px 22px;border-top:1px solid #f0f5f2;margin-top:18px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="font-size:11.5px;color:#8aa39b">إشعارٌ تلقائيٌّ من نموذج التواصل في <a href="https://mulabeek.com" style="color:#5f7a6e;text-decoration:none">mulabeek.com</a></td>
              <td align="left" style="font-size:11.5px;color:#8aa39b">© ملبّيك</td>
            </tr>
          </table>
        </td></tr>

      </table>

    </td></tr>
  </table>
</body></html>`

  // نسخةٌ نصّيّةٌ بسيطةٌ (fallback لعملاء النصّ فقط)
  const textBody =
    `ملبّيك · ${modeAr} جديدة\n` +
    `${'─'.repeat(40)}\n` +
    `النوع:    ${modeAr} · ${kindAr}\n` +
    `الاسم:    ${rec.name}\n` +
    `البريد:   ${rec.email}\n` +
    (rec.subject ? `الموضوع:  ${rec.subject}\n` : '') +
    (createdAt ? `التاريخ:  ${createdAt}\n` : '') +
    `${'─'.repeat(40)}\n\n` +
    `${rec.body}\n` +
    (attachLinks.length ? `\n${'─'.repeat(40)}\nالمرفقات:\n${attachLinks.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n` : '') +
    `\n${'─'.repeat(40)}\nللردّ: استخدم زرّ "رد" — يصل ${rec.email} مباشرةً.\nmulabeek.com\n`

  // ٤) الإرسال عبر nodemailer — يتولّى ترميز UTF-8 وMIME تلقائيًّا
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,                  // true لـ 465 (SSL)، false لـ 587 (STARTTLS)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })

  try {
    await transporter.sendMail({
      from: { name: 'ملبّيك', address: MAIL_FROM },
      to: MAIL_TO,
      replyTo: { name: rec.name, address: rec.email },
      subject: subjectLine,
      text: textBody,
      html,
    })
  } catch (e) {
    return json(502, { error: 'smtp_failed', detail: String((e as Error)?.message ?? e) })
  }

  return json(200, { ok: true })
})
