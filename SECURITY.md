# سياسةُ الأمان — ملبّيك (mulabeek.com)

## الإبلاغ عن ثغرة
راسلنا على **hello@mulabeek.com** مع وصفٍ واضحٍ وخطوات إعادة الإنتاج.
نردّ خلال يومَي عمل. نُقدّر الإفصاح المسؤول ولا نلاحق الباحثين بحسن نيّة.

---

## طبقاتُ الأمان المطبَّقة

### قاعدة البيانات (Supabase Postgres)
- **Row-Level Security** مفعّلٌ على كلّ جدول — عزلٌ بيانيٌّ بين الحملات.
- جدول `public_messages`: لا `INSERT` مباشرٌ — الإدخالُ عبر RPC
  `submit_public_message` فقط (`SECURITY DEFINER` بضوابطَ صارمة).
- Rate-limit: ٥ رسائلَ من نفس البريد كلّ ساعة.
- القراءةُ للإدارة فقط (`my_role() = 'admin'`).

### التخزين (Storage)
- bucket `public-attachments` خاصٌّ (private) — القراءةُ للإدارة فقط.
- الرفعُ محصورٌ في مجلّد `public/` + أنواع MIME محدّدةٌ + ٥ ميغا/ملفّ.
- الامتدادُ يُشتقّ من MIME لا من اسم الملف (يمنع spoofing).

### الـ Edge Function (notify-message)
- `timingSafeEq` لمقارنة `x-webhook-secret` (يمنع timing attacks).
- `sanitize()` يزيل CR/LF وأحرف التحكّم (يمنع email header injection).
- `isSafePath()` يرفض مسارات `../` (يمنع path traversal).
- `encodeURIComponent` على روابط mailto.
- بيانات SMTP في أسرار الـ Edge فقط — لا تُكشف للعميل.

### الواجهة الأماميّة
- لا `dangerouslySetInnerHTML` ولا `eval` ولا `console.log` في الإنتاج.
- مفاتيح Supabase من `import.meta.env` فقط (anon key علنيٌّ بطبيعته،
  محميٌّ بـ RLS). الملفّ `.env` غير متعقّبٍ في git.
- بريدُ المصادقة عبر Supabase Auth (bcrypt) — لا تخزينَ محليٌّ لكلمات المرور.

---

## ثغراتٌ معروفةٌ غير قابلةٍ للاستغلال

### DOMPurify عبر jspdf@2.5.2 (transitive)
- **التقييم:** غير قابلةٍ للاستغلال في ملبّيك.
- **السبب:** ثغراتُ DOMPurify المُبلَّغة تتطلّب تمرير HTML خبيثٍ عبر
  `jsPDF.html()`. توليدُ الـ PDF في ملبّيك **image-based** بالكامل
  (`html2canvas` → `canvas.toDataURL` → `addImage`)، فلا يُستدعى
  `.html()` ولا DOMPurify إطلاقًا.
- **التحقّق:** `grep -rn "\.html(" src/` = صفر · لا استيرادٌ مباشرٌ
  لـ DOMPurify.
- **القرار:** عدمُ ترقية jspdf إلى 4.x (تغييرٌ كاسرٌ يُعطّل توليد
  الكشوف والتذاكر) مقابل فائدةٍ أمنيّةٍ معدومةٍ. يُعاد التقييمُ عند توفّر
  ترقيةٍ غير كاسرةٍ أو عند تغيّر طريقة توليد الـ PDF.
- **المراجعة:** ٢٠٢٦/٠٦/١٩.
