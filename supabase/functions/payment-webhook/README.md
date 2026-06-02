# payment-webhook — تأكيد الدفع الآليّ

دالّةُ حافّةٍ (Edge Function) تستقبل إشعار الدفع من بوّابة الدفع، تتحقّق من
أصالته، وتؤكّد حجز المعتمر تلقائيًّا (`status = 'paid'`) مع تسجيلٍ تدقيقيٍّ في
جدول `payments`. **idempotent**: تكرار الإشعار لا يضاعف المعالجة.

## كيف يطابق الدفعةَ بالمعتمر؟
1. إن أرسل المزوّد `metadata.passenger_id` → يُستخدم مباشرةً (الأفضل).
2. وإلّا → يطابق `payments.provider_ref` مع `passengers.payment_ref` — أي رقم
   العملية الذي يلصقه العميل حاليًّا في شاشة الحجز. فالتدفّق الحاليّ يعمل دون تغيير.

## المتطلّبات الأمنيّة (مهمّ)
- **حارس الراكب**: شغّل `supabase/schema.sql` المحدّث أوّلًا. التحديث يسمح
  لـ `service_role` (بلا JWT) بتأكيد الدفع، مع إبقاء العميل المصدَّق محروسًا
  تمامًا (لا يستطيع رفع حالته بنفسه).
- الدالّة تستخدم `SUPABASE_SERVICE_ROLE_KEY` (يُحقَن تلقائيًّا في بيئة الحافّة)
  لتجاوز RLS عند الكتابة — لا يُكشف هذا المفتاح للعميل أبدًا.

## النشر
```bash
# 1) اربط مشروعك
supabase link --project-ref <your-project-ref>

# 2) اضبط الأسرار
supabase secrets set PAYMENT_WEBHOOK_SECRET="<سرٌّ قويٌّ تشاركه مع المزوّد>"
supabase secrets set PAYMENT_PROVIDER="moyasar"     # moyasar | tap | generic
supabase secrets set PAYMENT_VERIFY="hmac"           # hmac (افتراضي) | token
# اختياري: ترويسة التوقيع إن اختلفت
supabase secrets set PAYMENT_SIG_HEADER="x-signature"

# 3) انشر
supabase functions deploy payment-webhook --no-verify-jwt
```
> `--no-verify-jwt` ضروريٌّ: المزوّد لا يرسل JWT؛ التحقّق يتمّ بالتوقيع/التوكن.

عنوان الـ Webhook بعد النشر:
`https://<project-ref>.functions.supabase.co/payment-webhook`
سجّله في لوحة مزوّد الدفع.

## أوضاع التحقّق
- **hmac** (موصى): المزوّد يوقّع جسم الطلب بـ HMAC-SHA256 بنفس
  `PAYMENT_WEBHOOK_SECRET`، ويُرسل التوقيع في ترويسة (`PAYMENT_SIG_HEADER`).
  تُقارَن بزمنٍ ثابت. (يقبل بادئة `sha256=`.)
- **token**: المزوّد (مثل Moyasar) يرسل سرًّا داخل الحمولة (`secret_token`)
  يساوي `PAYMENT_WEBHOOK_SECRET`. استخدم هذا الوضع مع Moyasar إن لم تُفعّل HMAC.

## ملاحظاتٌ خاصّةٌ بالمزوّدين
- **Moyasar**: المبالغ بالهللات (تُقسَم على ١٠٠ آليًّا). مرّر
  `metadata[passenger_id]` عند إنشاء الدفع لربطٍ دقيق. وضع التحقّق الأنسب
  غالبًا `token`.
- **Tap**: حدث `CAPTURED/PAID`. مرّر `metadata.passenger_id` أو استخدم
  `reference.transaction = <ticket_code/payment_ref>`.
- **generic**: يتوقّع `{ paid|status, reference|ref|id, amount, currency,
  passenger_id? }`.

## الاختبار محليًّا
```bash
supabase functions serve payment-webhook --no-verify-jwt --env-file ./supabase/.env.local
# ثم أرسل طلبًا موقّعًا (generic/hmac):
BODY='{"status":"paid","reference":"REF123","amount":1500,"currency":"SAR"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYMENT_WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST http://localhost:54321/functions/v1/payment-webhook \
  -H "x-signature: $SIG" -H 'content-type: application/json' -d "$BODY"
```
المتوقّع: `{"ok":true,...}`. وتأكّد أنّ المعتمر صاحب `payment_ref='REF123'`
أصبح `status='paid'` في القاعدة.

## السلوك عند الحالات
| الحالة | النتيجة |
|---|---|
| توقيعٌ خاطئ | 401 `bad_signature` |
| حدثٌ ليس دفعًا ناجحًا | 200 `ignored` (بهدوء) |
| إشعارٌ مكرّر | 200 `duplicate` (لا تُعاد المعالجة) |
| لا معتمرَ مطابق | 200، يُسجَّل في `payments` بلا ربطٍ (يُراجَع يدويًّا) |
| نجاح | 200 `ok`، الحجز = مدفوع + سجلّ دفع |
