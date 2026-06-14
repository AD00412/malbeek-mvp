# create-payment — رابطُ دفعٍ مُستضاف

Edge Function تُنشئ جلسة دفعٍ مُستضافةً لدى البوّابة (Moyasar/Tap/Generic)،
وتمرّر `passenger_id` في `metadata` ليطابقها webhook عند الإشعار، وتُرجع
رابط الدفع للعميل. تُكمل دائرة الدفع التي بدأها `payment-webhook`.

## الأمان
- المُستدعي يُصادَق عبر **JWT المستخدم**.
- قراءة الحجز تتمّ بصلاحيّة المستخدم، فـ RLS تتحقّق أنّ `profile_id = auth.uid()`؛
  لا يستطيع شخصٌ إنشاء جلسة دفعٍ لحجز غيره.
- السعر يُقرأ بـ `service_role` تفاديًا لأيّ افتقارٍ لقراءة `trips.price` العلنيّة.
- مفتاح التاجر `PAYMENT_MERCHANT_KEY` يبقى في بيئة الـ Edge — لا يُكشف للعميل.

## النشر
```bash
supabase secrets set \
  PAYMENT_PROVIDER="moyasar" \
  PAYMENT_MERCHANT_KEY="sk_live_xxx" \
  PAYMENT_SUCCESS_URL="https://app.malbeek.com/?paid={passenger_id}" \
  PAYMENT_CANCEL_URL="https://app.malbeek.com/?canceled=1"
# (PAYMENT_WEBHOOK_URL اختياري — افتراضيًّا = ${SUPABASE_URL}/functions/v1/payment-webhook)

supabase functions deploy create-payment
```
> هذه الدالّة **تطلب** JWT (بخلاف `payment-webhook` الذي لا يطلبه) — لذلك
> لا تستخدم `--no-verify-jwt`.

## الاستدعاء من الواجهة
```js
const { data, error } = await supabase.functions.invoke('create-payment', {
  body: { passenger_id: booking.id }
})
if (data?.url) window.location.href = data.url
```

## السلوك عند الحالات
| الحالة | HTTP | الردّ |
|---|---|---|
| غير مصدَّق | 401 | `{ error: 'unauthenticated' }` |
| لا يملك الحجز / غير موجود | 403 | `{ error: 'not_authorized' }` |
| مدفوعٌ مسبقًا | 409 | `{ error: 'already_paid' }` |
| لا سعر للرحلة | 400 | `{ error: 'no_price' }` |
| فشل البوّابة | 502 | `{ error: 'gateway_failed', details }` |
| نجاح | 200 | `{ url, id, provider }` |

## ملاحظاتٌ خاصّةٌ بالمزوّدين
- **Moyasar**: المبالغ بالهللات (الدالّة تضرب × ١٠٠). `success_url`/`back_url` يُفتحان بعد الدفع/الإلغاء، و`callback_url` يستقبل الـ webhook.
- **Tap**: المبالغ بالريال مباشرةً، يدعم redirect + post (webhook).
- **generic**: للاختبار — اضبط `PAYMENT_GENERIC_TEMPLATE` بقالبٍ يحوي
  `{amount}/{currency}/{passenger_id}/{trip_id}` ويُعاد كرابطٍ.
