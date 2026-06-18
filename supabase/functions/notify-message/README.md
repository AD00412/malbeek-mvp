# notify-message — إشعارُ بريدٍ عند وصول رسالةٍ من نموذج Landing

Edge Function تُرسل بريدًا إلى صندوق الدعم (`hello@mulabeek.com`) عند إدراج
صفٍّ جديدٍ في `public.public_messages` (نموذج التواصل/الملاحظات في الـ Landing).
تُستدعى عبر **Database Webhook** على حدث `INSERT`.

## كيف يشتغل
```
زائرٌ يرسل من Landing → RPC submit_public_message → INSERT في public_messages
   → Database Webhook (INSERT) → notify-message → SMTP → hello@mulabeek.com
```
- المرفقات تُرفق كروابطَ موقَّعةٍ (٧ أيّام) لتُفتح من البريد مباشرةً.
- `Reply-To` = بريد المُرسِل، فزرّ «رد» في بريدك يصله مباشرةً.

## الأمان
- ترويسة `x-webhook-secret` تمنع الاستدعاء العشوائيّ (تُضبط في الـ webhook).
- بيانات SMTP تبقى في أسرار الـ Edge — لا تُكشف للعميل أبدًا.

## ١) ضبط الأسرار
```bash
supabase secrets set \
  SMTP_HOST="mail.mulabeek.com" \
  SMTP_PORT="465" \
  SMTP_USER="hello@mulabeek.com" \
  SMTP_PASS="<<كلمة مرور البريد>>" \
  MAIL_TO="hello@mulabeek.com" \
  MAIL_FROM="hello@mulabeek.com" \
  NOTIFY_WEBHOOK_SECRET="<<سرٌّ عشوائيٌّ طويل>>"
```
> لتوليد سرٍّ عشوائيّ: `openssl rand -hex 24`

## ٢) النشر
```bash
supabase functions deploy notify-message --no-verify-jwt
```
> `--no-verify-jwt` ضروريّ — الـ Database Webhook لا يرسل JWT مستخدم؛
> نعتمد على `x-webhook-secret` بدلًا منه للتحقّق.

## ٣) إنشاء الـ Database Webhook
في Supabase Dashboard → **Database → Webhooks → Create a new hook**:
- **Name:** `notify-public-message`
- **Table:** `public.public_messages`
- **Events:** `Insert` فقط
- **Type:** `HTTP Request` → `POST`
- **URL:** `https://<project-ref>.supabase.co/functions/v1/notify-message`
- **HTTP Headers:** أضف
  - `x-webhook-secret` = نفس قيمة `NOTIFY_WEBHOOK_SECRET`
  - `Content-Type` = `application/json`

## اختبار
أرسل رسالةً من نموذج Landing → خلال ثوانٍ يصلك بريدٌ على `hello@mulabeek.com`.
لو لم يصل: راجع **Logs** في Supabase → Edge Functions → notify-message.

## السلوك عند الحالات
| الحالة | HTTP | الردّ |
|---|---|---|
| سرّ webhook خاطئ | 401 | `{ error: 'unauthorized' }` |
| لا سجلّ في الـ payload | 400 | `{ error: 'no_record' }` |
| فشل SMTP | 502 | `{ error: 'smtp_failed', detail }` |
| نجاح | 200 | `{ ok: true }` |
