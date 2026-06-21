# CLAUDE.md

دليل العمل في مستودع **ملبّيك (malbeek-mvp)** — منصّة إدارة حملات العُمرة.
عربي بالكامل، `dir="rtl"`، موبايل أوّلًا. React + Vite + Supabase.

> هذه القواعد ليست نصائح — كثيرٌ منها نبع من أخطاء حقيقية عولجت في ملبّيك.
> النسخة المقطّرة الكاملة لها في `MUTAMIR_MASTER_PROMPT.md` (الجزء ب).

---

## الأوامر

```bash
npm install
cp .env.example .env     # املأ مفاتيح Supabase
npm run dev              # تطوير
npm run build            # بناء إنتاجي (تحقّق منه بعد أي تغيير مهم)
npm run preview          # معاينة بناء dist
```

لا يوجد lint أو test مُهيّأ في `package.json` — التحقّق يتم عبر `npm run build`.

### قاعدة البيانات
- مصدر الحقيقة الوحيد: `supabase/schema.sql` (ملف واحد **idempotent**، ~2000 سطر).
- بعد أي تعديل على القاعدة: الصق كامل `schema.sql` في **Supabase ▸ SQL Editor** وشغّله.
- Edge Functions في `supabase/functions/` (`create-payment`, `payment-webhook`).

---

## المعمارية الفعلية

- **التوجيه:** `react-router-dom` (وليس view-state). المسارات في `src/app/App.jsx`،
  تحميل كسول (`lazy`) للوحات + حماية حسب الدور عبر `src/app/RequireAuth.jsx`.
- **الأدوار:** `admin` / `subscriber` (المكتب/الحملة) / `customer` (المعتمر).
  `homeForRole()` يوجّه كل دور للوحته (`/admin`, `/dashboard`, `/customer`).
- **المصادقة:** `src/app/AuthProvider.jsx` + `useAuth()`. عميل Supabase في
  `src/lib/supabaseClient.js` يستخدم `flowType: 'pkce'` و `storageKey: 'malbeek.auth'`
  وقفل مصادقة صوري (`noopLock`) — **لا تُعِد إضافة Web Locks**، فهي تجمّد المصادقة.
- **الوصول للبيانات:** المكوّنات تستدعي `supabase.from()` / `supabase.rpc()` مباشرةً
  (لا توجد طبقة `services/` في هذا المستودع — على عكس ما يصفه ماستر-برومبت لمشروع جديد).
  الطفرات الحرجة (المقاعد/التسكين/الحدود) تمرّ عبر **RPCs** تفرض RLS وتُعيد رموز خطأ ثابتة.
- **العزل:** RLS صارم بين الحملات على مستوى القاعدة (مفعّل دائمًا في هذا المستودع).

### بنية `src/`
```
app/        App, AuthProvider, useAuth, RequireAuth, ErrorBoundary
layout/     AppShell
pages/      auth/ (Login, Signup, CustomerJoin, JoinTeam) · app/ (Homes, TripManage)
components/ كل اللوحات والـ modals والـ sheets (الجزء الأكبر من المنطق)
lib/        supabaseClient, rpcErrors, format, pdf, docx, ics, buses, busLayout, hooks
styles/     app.css, malbeek-theme.css
```

---

## القواعد الذهبية (طبّقها حرفيًّا)

1. **معالجة الأخطاء عربيًّا عبر `src/lib/rpcErrors.js`.** كل خطأ RPC/Supabase يمرّ على
   `translateRpcError(err)`. لا تعرض رسائل إنجليزية خام للمستخدم. مصدر الحقيقة بالترتيب:
   رمز ثابت معروف في `MAP` → `err.hint` العربي من القاعدة → رسالة عربية من القاعدة → fallback.
   عند إضافة رمز خطأ جديد في القاعدة، أضِف ترجمته في `MAP`.

2. **التواريخ الفارغة `""` → `null` قبل أي insert/update.** `<input type="date">` يُعيد `""`
   و Postgres يرفضها (`invalid input syntax for type date`). حوّل: `form.date || null`.

3. **امتداد JSX إلزامي.** أي ملف فيه `<JSX/>` يجب أن يكون `.jsx` — `.js` بـ JSX يكسر بناء Vite.

4. **`schema.sql` يبقى idempotent.** استخدم `IF NOT EXISTS` / `CREATE OR REPLACE` /
   `DO $$ … END $$;`. يجب أن يعمل ×٢ بلا فشل.

5. **بعد إضافة أعمدة في القاعدة:** أنهِ السكربت بـ `NOTIFY pgrst, 'reload schema';`
   وإلّا يبقى PostgREST على schema قديم.

6. **لا تخمّن أسماء الأعمدة.** قبل كتابة `select('*, x:fk(...)')` افتح `schema.sql` وانسخ الأسماء حرفيًّا.

7. **مرّر كل المفاتيح الأجنبية (FKs) كـ props** من الأعلى للأسفل إلى أي modal فيه insert
   (مثل `organizer_id`/`trip_id`) — الحقول `NOT NULL` المنسيّة تسبّب فشلًا صريحًا.

8. **الطفرات الحرجة عبر RPC**، لا عبر `update()` مباشر: حجز المقاعد، التسكين في الغرف،
   حدود الباقة. الـ RPC يفرض القيود ذرّيًّا تحت التزاحم ويُعيد رمز خطأ ثابت.

### بيئة وأمان
- متغيرات `.env`: **فقط** `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY`.
  `VITE_SUPABASE_URL` هو العنوان الأساسي فقط (بلا `/rest/v1/` ولا اقتباس).
- **لا تضع `SERVICE_ROLE_KEY` في الواجهة أبدًا** — مكانه Edge Functions فقط.
- `.env` في `.gitignore`؛ حدّث `.env.example` عند إضافة متغير.

### واجهة وRTL
- موبايل أوّلًا: `padding: clamp(...)` بدل القيم الثابتة، وشبكات تتدرّج (`grid-cols-1 sm: lg:`).
- **لا `letter-spacing` سالب على العناوين العربية** — يلصق الحروف.
- مساعدات الأرقام/الهاتف/التاريخ/التحقّق في `src/lib/format.js`
  (`toLatinDigits`, `normalizePhone`, `isValidSaPhone`, `fmtDateTime`, …).
