# برومبت بناء «معتمر» — النسخة الماستر الشاملة

> منصّة عمرة متكاملة لمكاتب وحملات العمرة، مبنية على خبرة منصّة ملبّيك بكل أخطائها المعالَجة.
> هذا الملف مواصفات بناء كاملة من الـ bootstrap حتى الإنتاج — انسخه كاملاً وأرسله لـ Claude Code في مشروع فارغ.

---

# الجزء أ — الرؤية والقرارات التقنية

## أ-1. الهوية

| العنصر | القيمة |
|---|---|
| اسم المنتج | **معتمر** (Mu'tamir) |
| النوع | SaaS متعدّد المستأجرين (multi-tenant) لمكاتب وحملات العمرة |
| اللغة | عربي بالكامل، `dir="rtl"` افتراضياً |
| النبرة البصرية | روحاني دافئ مُلهِم — زمرّدي عميق + ذهبي |
| المستخدمون | platform_owner / admin / organizer (مكتب) / customer (معتمر) |

## أ-2. تقنيات إلزامية (بإصدارات مُختبَرة)

```
node >= 20
vite ^5.4
react ^18.3
react-dom ^18.3
@supabase/supabase-js ^2.45
tailwindcss ^3.4
lucide-react ^0.460
recharts ^2.13
jspdf ^2.5
xlsx ^0.18
qrcode ^1.5
html5-qrcode ^2.3
```

- **بدون TypeScript** في مكوّنات React (JSX فقط) — TS مسموح لـ `*.config.ts` فقط.
- **بدون React Router** — استخدم نمط `view` state في `App.jsx` (أبسط، أسرع للـ SaaS).
- **بدون state library** — React state + custom hooks تكفي.

## أ-3. خطّ الزمن الموصى به لـ Claude Code

| المرحلة | الزمن المتوقّع | المخرَج |
|---|---|---|
| 0. Bootstrap + identity + tokens | 30 د | مشروع يفتح بصفحة فارغة منسّقة |
| 1. Database baseline + Supabase | 45 د | كل الجداول جاهزة + RLS معطّل مؤقّتاً |
| 2. Auth (signup/login/setup) | 1 ساعة | تسجيل + دخول + إعداد مكتب |
| 3. Organizer Dashboard + Trips | 2 ساعة | إنشاء رحلة عمرة كاملة |
| 4. Pilgrims + Buses + Rooms | 3 ساعات | إضافة معتمر + مقعد + غرفة |
| 5. Public Booking + Guest Portal | 2 ساعة | حجز عام + بطاقة معتمر |
| 6. Admin + Subscriptions | 2 ساعة | لوحة أدمن كاملة |
| 7. Reports + Settings | 1 ساعة | PDF/Excel + إعدادات المكتب |
| 8. RLS lockdown + deploy | 1 ساعة | إنتاج جاهز |

**الإجمالي:** ~12 ساعة عمل لـ MVP إنتاجي.

---

# الجزء ب — ⚠️ القواعد الذهبية (اقرأها قبل أي سطر كود)

> **هذه ليست نصائح — هي أخطاء واجهناها فعلاً في ملبّيك وكلّفتنا أياماً. كل قاعدة هنا تنبع من حادث حقيقي.**

## ب-1. طبقة الخدمات إلزامية (Services Layer)

**ممنوع** استدعاء `supabase.from()` مباشرة من أي مكوّن React. كل وصول للقاعدة عبر `src/services/*.js`.

عقد موحّد:
```js
// كل دالة خدمة تُعيد هذا الشكل — لا ترمي استثناءات أبداً.
return { data: T | null, error: { message: string, code?: string, raw?: any } | null };
```

## ب-2. ⚠️ خطأ SELECT بعد INSERT (الأخطر — كلّفنا 3 جلسات)

**المشكلة:** `.insert(payload).select(COLS_WHITELIST).single()` — إن نقص أي عمود من الـ whitelist على القاعدة الحيّة (schema drift)، يفشل INSERT كاملاً برسالة غامضة `"could not find the X column"`.

**القاعدة الذهبية:** بعد INSERT **اختر `.select('id')` فقط** — المُنشئ يحتاج المعرّف للـ logging والتنقّل. لا تختر قائمة كاملة.

```js
// ❌ خطأ
await supabase.from('trips').insert(payload).select(COLS_TRIP_DETAIL).single();

// ✅ صحيح
await supabase.from('trips').insert(payload).select('id').single();
```

## ب-3. ⚠️ القوائم المختفية صامتاً

**المشكلة:** `listX` يستخدم `.select(COLS_WHITELIST)` — إن نقص عمود اختياري واحد، تفشل القائمة كلها وتظهر فارغة بدون أي إشارة لأن الـ frontend يكتب `data || []`.

**القاعدة:** دوال `listX` **تستخدم `.select('*')`**. والصفحات التي تستهلكها تستخرج `error` صراحةً وتعرضه في toast.

```js
// ✅ في الخدمة
const { data, error } = await supabase.from('buses').select('*').eq('trip_id', tripId);

// ✅ في الصفحة
const [{ data, error }] = await Promise.all([listBusesByTrip(tripId)]);
if (error) { showToast(error.message, 'error'); return; }
```

## ب-4. ⚠️ التواريخ الفارغة `""`

`<input type="date">` يُرجع `""` عند الفراغ. Postgres يرفضها: `invalid input syntax for type date: ""`.

**القاعدة:** قبل **أي** insert/update، حوّل الفراغات لـ `null`:
```js
const payload = {
  name: form.name.trim(),
  check_in: form.check_in || null,
  check_out: form.check_out || null,
  city: form.city?.trim() || null,
  notes: form.notes?.trim() || null,
};
```

## ب-5. ⚠️ حقول NOT NULL المنسيّة

`hotels.organizer_id NOT NULL` — لو النموذج لا يمرّره (نسي prop)، فشل صريح.

**القاعدة:** كل modal فيه insert يستقبل **كل** الـ FKs كـ props من الأعلى ويُمرّرها للـ payload. تتبّع props من `App → Page → Modal`.

## ب-6. ⚠️ أسماء أعمدة الـ joins

لا تخمّن. `hotels` أعمدته الفعلية `name/city/check_in/check_out` — **ليس** `hotel_name/check_in_date`.

**القاعدة:** قبل كتابة `select('*, x:fk(...)')` افتح ملف الـ baseline migration وانسخ الأسماء الصحيحة حرفياً.

## ب-7. ⚠️ امتداد JSX

أي ملف فيه `<JSX/>` **يجب** أن يكون `.jsx`. ملف `.js` بـ JSX يكسر Vite build بـ:
> Failed to parse source for import analysis because the content contains invalid JS syntax. If you are using JSX, make sure to name the file with the .jsx or .tsx extension.

## ب-8. PostgREST schema cache

بعد أي migration يضيف أعمدة:
```sql
NOTIFY pgrst, 'reload schema';
```
وإلا PostgREST يبقى يبحث عن schema قديم حتى لو القاعدة محدّثة.

## ب-9. Migrations idempotent

كل migration يجب أن يعمل ✕٢ بدون فشل:
```sql
ALTER TABLE x ADD COLUMN IF NOT EXISTS y text;
CREATE TABLE IF NOT EXISTS x ...;
DO $$ BEGIN IF NOT EXISTS (...) THEN ... END IF; END $$;
```

## ب-10. errorMapper مركزي

لا تعرض `error.message` الإنجليزية للمستخدم. كل خطأ Supabase/Postgres يمرّ على `mapError()` ويُترجم لرسالة عربية واضحة.

## ب-11. RLS أثناء التطوير

عطّل RLS على كل الجداول أثناء التطوير لتسريع الاختبار (mirations: `dev_disable_rls.sql`). **فعّله قبل الإطلاق** عبر migration مقابل.

## ب-12. لا تعدّل ملفات `.js` بـ JSX، ولا تعدّل state hooks بلا حاجة

عند الـ refactor للـ UI، **ممنوع** لمس `useEffect/useState/useCallback` أو أي data-fetching. الـ UI overhaul = styling فقط.

## ب-13. mobile-first إلزامي

- `padding: clamp(12px, 4vw, 32px)` بدل قيم ثابتة.
- شبكات Tailwind: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` بدل `auto-fit minmax(190px, 1fr)` الذي قد يتجاوز viewport.
- لا تستخدم `letter-spacing` سالباً على العناوين العربية — يلصق الحروف.

## ب-14. لا تستخدم `npm install` على Vercel غير الـ lock

استخدم `npm ci` في CI. اربط Vite بـ `manualChunks` لتفادي ملف ضخم >1MB.

## ب-15. متغيّرات البيئة

- `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` فقط في `.env`.
- لا تضع `SERVICE_ROLE_KEY` في الـ frontend أبداً.
- `.env` في `.gitignore`، أنشئ `.env.example` بالقيم الفارغة.

---

# الجزء ج — Bootstrap (الأوامر بالترتيب)

```bash
# 1. إنشاء المشروع
npm create vite@latest mutamir -- --template react
cd mutamir
npm install

# 2. التبعيات
npm install @supabase/supabase-js lucide-react recharts jspdf xlsx qrcode html5-qrcode
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p

# 3. Supabase CLI (محلي)
npm install -D supabase
npx supabase init

# 4. ربط بمشروع Supabase موجود (تحتاج Reference ID من الـ Dashboard)
npx supabase link --project-ref YOUR_REF

# 5. تشغيل التطوير
npm run dev
```

---

# الجزء د — هيكل الملفات الكامل

```
mutamir/
├── .env.example
├── .gitignore
├── README.md
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.js
├── supabase/
│   └── migrations/
│       ├── 00000000000000_baseline.sql      # كل الجداول + الدوال + الفهارس
│       ├── 00000000000001_seed_admin.sql    # إدخال platform_owner الأول
│       └── 00000000000002_dev_disable_rls.sql  # تطوير فقط
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    ├── supabaseClient.js
    ├── icons.jsx
    ├── lib/
    │   ├── identity.config.ts        # tokens الهوية
    │   ├── roles.js                  # ROLE_PRIORITY + can()
    │   ├── format.js                 # toWesternDigits, formatHijri, money
    │   └── notifications.js          # إشعارات داخلية
    ├── services/
    │   ├── errorMapper.js
    │   ├── authService.js
    │   ├── organizerService.js
    │   ├── tripsService.js
    │   ├── pilgrimsService.js
    │   ├── busesService.js
    │   ├── hotelsService.js
    │   ├── hotelRoomsService.js
    │   ├── financesService.js
    │   ├── subscriptionService.js
    │   ├── supportService.js
    │   ├── adminService.js
    │   └── platformService.js
    ├── hooks/
    │   ├── useAuth.js
    │   ├── useOrganizer.js
    │   ├── useToast.js
    │   └── useRealtimeStatus.js
    ├── components/
    │   ├── Toast.jsx
    │   ├── ComingSoon.jsx
    │   ├── BusSeatMap.jsx
    │   ├── QRBadge.jsx
    │   ├── RealtimeStatusBadge.jsx
    │   ├── NotificationBell.jsx
    │   └── primitives/
    │       ├── Field.jsx
    │       ├── Input.jsx
    │       ├── Select.jsx
    │       ├── Modal.jsx
    │       ├── EmptyState.jsx
    │       └── PageLoader.jsx
    └── pages/
        ├── Landing.jsx
        ├── auth/
        │   ├── Login.jsx
        │   ├── Signup.jsx
        │   └── SetupWorkspace.jsx
        ├── dashboard/
        │   ├── Overview.jsx           # الصفحة الرئيسية للمكتب
        │   ├── Trips.jsx              # مركز الرحلات
        │   ├── CreateTrip.jsx
        │   ├── TripDashboard.jsx      # تفاصيل رحلة (مع تبويبات)
        │   ├── Pilgrims.jsx
        │   ├── RoomAllocation.jsx
        │   ├── Finances.jsx
        │   ├── Reports.jsx
        │   ├── WorkspaceTeam.jsx
        │   └── OrganizerSettings.jsx
        ├── public/
        │   ├── PublicBooking.jsx      # حجز عام برابط
        │   └── GuestPortal.jsx        # بطاقة المعتمر
        └── admin/
            ├── AdminDashboard.jsx
            ├── OrganizersManagement.jsx
            ├── SubscriptionRequests.jsx
            ├── RolesManager.jsx
            └── PlatformStats.jsx
```

---

# الجزء هـ — كود نواة جاهز للنسخ

## هـ-1. `src/lib/identity.config.ts`

```ts
export const color = {
  emeraldDeep:  '#062821',
  emerald:      '#0A3D2E',
  emeraldMid:   '#0F4F3E',
  emeraldSoft:  'rgba(10,61,46,0.55)',
  gold:         '#C9A961',
  goldMid:      '#E0AE35',
  goldDark:     '#8E6B2E',
  goldSoft:     'rgba(201,169,97,0.12)',
  goldBorder:   'rgba(201,169,97,0.35)',
  goldGlow:     'rgba(201,169,97,0.45)',
  text:         '#F5F0E8',
  textMuted:    'rgba(245,240,232,0.55)',
  textDim:      'rgba(245,240,232,0.35)',
  success:      '#10B981',
  successSoft:  'rgba(16,185,129,0.12)',
  warn:         '#FBBF24',
  warnSoft:     'rgba(251,191,36,0.12)',
  danger:       '#EF4444',
  dangerSoft:   'rgba(239,68,68,0.12)',
  info:         '#38BDF8',
  infoSoft:     'rgba(56,189,248,0.12)',
  royal:        '#A78BFA',
};

export const surface = {
  glassWhisper: 'rgba(255,255,255,0.03)',
  glassDark:    'rgba(255,255,255,0.06)',
  glass:        'rgba(255,255,255,0.08)',
  glassLight:   'rgba(255,255,255,0.12)',
  border:       'rgba(255,255,255,0.10)',
  borderLight:  'rgba(255,255,255,0.16)',
  borderStrong: 'rgba(255,255,255,0.22)',
  overlay:      'rgba(5,31,23,0.88)',
};

export const font = {
  display: "'Beiruti','Tajawal',sans-serif",
  body:    "'Tajawal',sans-serif",
  english: "'Outfit',sans-serif",
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24 };
export const blur   = { card: 'blur(32px)', overlay: 'blur(14px)' };

export const identity = { color, surface, font, radius, blur };
```

## هـ-2. `src/services/errorMapper.js`

```js
const PATTERNS = [
  // Auth
  [/invalid login credentials/i,            'بيانات الدخول غير صحيحة.'],
  [/email not confirmed/i,                  'البريد لم يُؤكَّد بعد.'],
  [/user already registered/i,              'هذا البريد مسجّل مسبقاً.'],
  [/email rate limit exceeded/i,            'تم تجاوز الحد المسموح. حاول بعد دقيقة.'],
  [/password should be at least/i,          'كلمة المرور قصيرة جدّاً.'],
  // RLS
  [/permission denied|row-level/i,          'غير مصرّح لك بهذه العملية.'],
  [/jwt expired|invalid jwt/i,              'انتهت الجلسة. سجّل دخول من جديد.'],
  // Schema drift (CRITICAL — see Rules ب-2, ب-3)
  [/could not find the .* column/i,         'حقل مطلوب غير موجود في القاعدة. تواصل مع الدعم.'],
  [/column .* does not exist/i,             'حقل مطلوب غير موجود في القاعدة. تواصل مع الدعم.'],
  [/could not find the table .* in the schema/i, 'بنية القاعدة غير محدّثة. تواصل مع الدعم.'],
  // Data integrity
  [/duplicate key value/i,                  'هذا السجل موجود مسبقاً.'],
  [/violates foreign key/i,                 'لا يمكن إتمام العملية — سجل مرتبط.'],
  [/violates check constraint/i,            'قيمة غير مقبولة.'],
  [/violates not-null constraint/i,         'حقل مطلوب لم يُعبَّأ.'],
  [/invalid input syntax for type date/i,   'تاريخ غير صالح.'],
  [/invalid input syntax for type uuid/i,   'معرّف غير صالح.'],
  // Network
  [/failed to fetch|network|timeout/i,      'تعذّر الاتصال. تحقّق من الشبكة.'],
];

export const mapError = (err) => {
  if (!err) return { message: 'خطأ غير معروف.' };
  const text = String(err?.message || err?.error_description || err || '');
  for (const [re, ar] of PATTERNS) {
    if (re.test(text)) return { message: ar, code: err?.code, raw: err };
  }
  const isArabic = /[؀-ۿ]/.test(text);
  return {
    message: isArabic && text.length < 200 ? text : 'حدث خطأ. حاول مرة أخرى.',
    code: err?.code,
    raw: err,
  };
};

export const toResult = ({ data, error }) =>
  error ? { data: null, error: mapError(error) } : { data, error: null };
```

## هـ-3. `src/supabaseClient.js`

```js
import { createClient } from '@supabase/supabase-js';

const url  = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.error('Missing Supabase env vars. Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { headers: { 'x-client-info': 'mutamir-web' } },
});
```

## هـ-4. عقد خدمة قياسي (مثال `tripsService.js`)

```js
import { supabase } from '../supabaseClient';
import { mapError, toResult } from './errorMapper';

// ── List: select('*') لمناعة ضد schema drift (Rule ب-3) ──────────────
export const listTripsByOrganizer = async (organizerId, filters = {}) => {
  if (!organizerId) return { data: null, error: { message: 'معرّف المكتب مفقود.' } };
  try {
    let q = supabase.from('trips').select('*').eq('organizer_id', organizerId);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.search) q = q.or(`name.ilike.%${filters.search}%,city.ilike.%${filters.search}%`);
    const { data, error } = await q.order('departure_date', { ascending: false });
    if (error) return { data: null, error: mapError(error) };
    return { data: data || [], error: null };
  } catch (e) { return { data: null, error: mapError(e) }; }
};

// ── Get: '*' (تفاصيل كاملة) ─────────────────────────────────────────
export const getTripById = async (tripId) => {
  if (!tripId) return { data: null, error: { message: 'معرّف الرحلة مفقود.' } };
  try {
    return toResult(
      await supabase.from('trips').select('*').eq('id', tripId).maybeSingle()
    );
  } catch (e) { return { data: null, error: mapError(e) }; }
};

// ── Create: select('id') فقط (Rule ب-2) ──────────────────────────────
export const createTrip = async (payload) => {
  if (!payload?.organizer_id) return { data: null, error: { message: 'معرّف المكتب مفقود.' } };
  if (!payload?.name?.trim()) return { data: null, error: { message: 'اسم الرحلة مطلوب.' } };
  // Coerce empty dates → null (Rule ب-4)
  const clean = {
    ...payload,
    name: payload.name.trim(),
    departure_date: payload.departure_date || null,
    return_date:    payload.return_date    || null,
    boarding_time:  payload.boarding_time  || null,
    makkah_checkin:  payload.makkah_checkin  || null,
    makkah_checkout: payload.makkah_checkout || null,
    madinah_checkin:  payload.madinah_checkin  || null,
    madinah_checkout: payload.madinah_checkout || null,
  };
  try {
    return toResult(
      await supabase.from('trips').insert(clean).select('id').single()
    );
  } catch (e) { return { data: null, error: mapError(e) }; }
};

// ── Update ──────────────────────────────────────────────────────────
const PROTECTED = new Set(['id', 'organizer_id', 'created_at']);
const sanitize = (u) =>
  Object.fromEntries(Object.entries(u || {}).filter(([k]) => !PROTECTED.has(k)));

export const updateTrip = async (tripId, updates) => {
  if (!tripId) return { data: null, error: { message: 'معرّف الرحلة مفقود.' } };
  const safe = sanitize(updates);
  if (!Object.keys(safe).length) return { data: null, error: { message: 'لا حقول صالحة للحفظ.' } };
  try {
    return toResult(
      await supabase.from('trips').update({ ...safe, updated_at: new Date().toISOString() })
        .eq('id', tripId).select('id').single()
    );
  } catch (e) { return { data: null, error: mapError(e) }; }
};

export const deleteTrip = async (tripId) => {
  if (!tripId) return { data: null, error: { message: 'معرّف الرحلة مفقود.' } };
  try {
    const { error } = await supabase.from('trips').delete().eq('id', tripId);
    if (error) return { data: null, error: mapError(error) };
    return { data: true, error: null };
  } catch (e) { return { data: null, error: mapError(e) }; }
};
```

**كل خدمة جديدة تتبع هذا القالب حرفياً.**

---

# الجزء و — Database Baseline كامل (migration واحد)

> ⚠️ **درس من ملبّيك:** عشرات الـ migrations المتراكمة → drift لا يُحَل. **migration واحد نظيف من اليوم الأول.**

ملف `supabase/migrations/00000000000000_baseline.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- معتمر — Baseline schema (Umrah platform)
-- Single source of truth. Every column, function, index, policy.
-- ═══════════════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── user_roles ────────────────────────────────────────────────────────
CREATE TABLE public.user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('platform_owner','admin','organizer','customer')),
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);

-- ─── organizers (المكاتب) ──────────────────────────────────────────────
CREATE TABLE public.organizers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name       text,
  logo_url           text,
  stamp_url          text,
  email              text,
  phone              text,
  whatsapp           text,
  full_name          text,
  description        text,
  store_platform     text CHECK (store_platform IN ('zid','salla','other')),
  store_url          text,
  bank_name          text,
  iban               text,
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','suspended','pending')),
  plan_type          text NOT NULL DEFAULT 'trial'
                       CHECK (plan_type IN ('trial','pro','premium')),
  plan_status        text NOT NULL DEFAULT 'trial'
                       CHECK (plan_status IN ('trial','active','expired','suspended')),
  trial_started_at   timestamptz NOT NULL DEFAULT now(),
  suspended_at       timestamptz,
  suspended_reason   text,
  suspended_by       uuid,
  admin_notes        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  setup_completed    boolean GENERATED ALWAYS AS (
    company_name IS NOT NULL AND btrim(company_name) <> ''
    AND logo_url IS NOT NULL AND btrim(logo_url) <> ''
  ) STORED
);
CREATE INDEX idx_organizers_user ON public.organizers(user_id);
CREATE INDEX idx_organizers_status ON public.organizers(status);

-- ─── trips (رحلات العمرة — حقول مدمجة لا template_type) ────────────────
CREATE TABLE public.trips (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id        uuid NOT NULL REFERENCES public.organizers(id) ON DELETE CASCADE,
  name                text NOT NULL,
  departure_date      date,
  return_date         date,
  boarding_time       timestamptz,
  departure_point     text,
  city                text DEFAULT 'مكة المكرمة والمدينة المنورة',
  status              text NOT NULL DEFAULT 'upcoming'
                        CHECK (status IN ('upcoming','active','ongoing','completed','cancelled')),
  price               numeric(12,2) NOT NULL DEFAULT 0,
  payment_link        text,
  notes               text,
  seats_count         integer NOT NULL DEFAULT 49,
  bus_config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- حقول عمرة خاصة (بدل template_fields العام):
  makkah_hotel            text,
  makkah_hotel_distance   text,
  makkah_checkin          date,
  makkah_checkout         date,
  madinah_hotel           text,
  madinah_hotel_distance  text,
  madinah_checkin         date,
  madinah_checkout        date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trips_organizer ON public.trips(organizer_id);
CREATE INDEX idx_trips_status    ON public.trips(status);
CREATE INDEX idx_trips_departure ON public.trips(departure_date);

-- ─── buses ─────────────────────────────────────────────────────────────
CREATE TABLE public.buses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  bus_number       text,
  capacity         integer NOT NULL DEFAULT 49,
  seats_count      integer DEFAULT 49,
  bus_type         text DEFAULT 'default' CHECK (bus_type IN ('default','male','female','mixed')),
  driver_name      text,
  driver_phone     text,
  supervisor_name  text,
  supervisor_phone text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trip_id, bus_number)
);
CREATE INDEX idx_buses_trip ON public.buses(trip_id);

-- ─── pilgrims (المعتمرون) ──────────────────────────────────────────────
CREATE TABLE public.pilgrims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id               uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  bus_id                uuid REFERENCES public.buses(id) ON DELETE SET NULL,
  full_name             text NOT NULL,
  identity_number       text NOT NULL,
  mobile_number         text NOT NULL,
  gender                text NOT NULL CHECK (gender IN ('male','female')),
  nationality           text DEFAULT 'سعودي',
  pickup_location       text,
  relationship          text,
  seat_number           integer,
  room_number           text,
  payment_status        text NOT NULL DEFAULT 'pending_payment'
                          CHECK (payment_status IN ('pending_payment','paid','refunded','cancelled')),
  external_order_id     text,
  booking_confirmed_at  timestamptz,
  paid_amount           numeric(12,2) DEFAULT 0,
  total_amount          numeric(12,2) DEFAULT 0,
  notes                 text,
  ready_flag            boolean DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pilgrims_trip      ON public.pilgrims(trip_id);
CREATE INDEX idx_pilgrims_bus       ON public.pilgrims(bus_id);
CREATE INDEX idx_pilgrims_payment   ON public.pilgrims(payment_status);
CREATE INDEX idx_pilgrims_identity  ON public.pilgrims(identity_number);

-- قيود مقاعد جزئية (دعم متعدد الحافلات — درس من ملبّيك)
CREATE UNIQUE INDEX pilgrims_unique_seat_in_bus
  ON public.pilgrims (bus_id, seat_number)
  WHERE bus_id IS NOT NULL AND seat_number IS NOT NULL;
CREATE UNIQUE INDEX pilgrims_unique_seat_in_trip_no_bus
  ON public.pilgrims (trip_id, seat_number)
  WHERE bus_id IS NULL AND seat_number IS NOT NULL;

-- ─── hotels + hotel_rooms ──────────────────────────────────────────────
CREATE TABLE public.hotels (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  organizer_id   uuid NOT NULL REFERENCES public.organizers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  city           text,
  check_in       date,
  check_out      date,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hotels_trip ON public.hotels(trip_id);

CREATE TABLE public.hotel_rooms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  trip_id      uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  room_number  text NOT NULL,
  capacity     integer DEFAULT 2,
  gender       text DEFAULT 'mixed' CHECK (gender IN ('male','female','mixed')),
  occupants    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rooms_trip  ON public.hotel_rooms(trip_id);
CREATE INDEX idx_rooms_hotel ON public.hotel_rooms(hotel_id);

-- ─── expenses ──────────────────────────────────────────────────────────
CREATE TABLE public.expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  organizer_id uuid REFERENCES public.organizers(id) ON DELETE CASCADE,
  category     text,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  description  text,
  expense_date date DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_trip ON public.expenses(trip_id);

-- ─── subscription_requests ─────────────────────────────────────────────
CREATE TABLE public.subscription_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name          text NOT NULL,
  company_name       text NOT NULL,
  email              text NOT NULL,
  phone              text NOT NULL,
  whatsapp           text,
  plan_type          text DEFAULT 'pro',
  message            text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected','contacted')),
  reviewed_by        uuid REFERENCES auth.users(id),
  reviewed_at        timestamptz,
  review_notes       text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_subreq_status ON public.subscription_requests(status);

-- ─── notifications ─────────────────────────────────────────────────────
CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text,
  link       text,
  type       text DEFAULT 'info',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON public.notifications(user_id, created_at DESC);

-- ─── support_tickets + messages ────────────────────────────────────────
CREATE TABLE public.support_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  uuid REFERENCES public.organizers(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  subject       text NOT NULL,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','pending','resolved','closed')),
  priority      text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ticket_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES auth.users(id),
  body        text NOT NULL,
  is_internal boolean DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_messages_ticket ON public.ticket_messages(ticket_id);

-- ─── audit_logs ────────────────────────────────────────────────────────
CREATE TABLE public.audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES auth.users(id),
  action     text NOT NULL,
  entity     text,
  entity_id  uuid,
  meta       jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor ON public.audit_logs(actor_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- RPCs
-- ═══════════════════════════════════════════════════════════════════════

-- فحص دور الأدمن (للسياسات والكود)
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role IN ('platform_owner','admin')
  );
$$;

-- قفل مقعد ذرّي (يمنع الحجز المزدوج تحت التزاحم)
CREATE OR REPLACE FUNCTION public.lock_seat(
  p_trip_id uuid, p_pilgrim_id uuid, p_seat_number integer, p_bus_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_existing uuid; v_capacity integer;
BEGIN
  IF p_bus_id IS NOT NULL THEN
    SELECT capacity INTO v_capacity FROM public.buses WHERE id = p_bus_id AND trip_id = p_trip_id;
    IF v_capacity IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'الحافلة غير موجودة');
    END IF;
    IF p_seat_number < 1 OR p_seat_number > v_capacity THEN
      RETURN jsonb_build_object('success', false, 'error', 'رقم المقعد خارج النطاق');
    END IF;
    SELECT id INTO v_existing FROM public.pilgrims
      WHERE bus_id = p_bus_id AND seat_number = p_seat_number AND id <> p_pilgrim_id FOR UPDATE;
  ELSE
    SELECT seats_count INTO v_capacity FROM public.trips WHERE id = p_trip_id;
    IF p_seat_number < 1 OR p_seat_number > v_capacity THEN
      RETURN jsonb_build_object('success', false, 'error', 'رقم المقعد خارج النطاق');
    END IF;
    SELECT id INTO v_existing FROM public.pilgrims
      WHERE trip_id = p_trip_id AND seat_number = p_seat_number AND bus_id IS NULL
        AND id <> p_pilgrim_id FOR UPDATE;
  END IF;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'المقعد محجوز');
  END IF;
  UPDATE public.pilgrims SET seat_number = p_seat_number, bus_id = p_bus_id, updated_at = now()
    WHERE id = p_pilgrim_id;
  RETURN jsonb_build_object('success', true, 'seat_number', p_seat_number);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'error', 'تم حجز المقعد بالتزامن');
END $$;

GRANT EXECUTE ON FUNCTION public.lock_seat(uuid,uuid,integer,uuid) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Updated_at triggers (يحدّث updated_at تلقائياً)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='updated_at'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();', r.table_name, r.table_name);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- RLS policies (مُعطَّلة افتراضياً، طبّق dev_disable_rls أثناء التطوير)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.user_roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buses                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilgrims              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotels                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_rooms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs            ENABLE ROW LEVEL SECURITY;

-- organizers: المكتب يرى صفّه، الأدمن يرى الكل
CREATE POLICY org_self_read ON public.organizers FOR SELECT
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
CREATE POLICY org_self_update ON public.organizers FOR UPDATE
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
CREATE POLICY org_self_insert ON public.organizers FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- trips: ملكية تتدرّج عبر organizers
CREATE POLICY trips_owner_all ON public.trips FOR ALL
  USING (organizer_id IN (SELECT id FROM public.organizers WHERE user_id = auth.uid())
         OR public.is_platform_admin(auth.uid()))
  WITH CHECK (organizer_id IN (SELECT id FROM public.organizers WHERE user_id = auth.uid())
              OR public.is_platform_admin(auth.uid()));

-- قراءة عامة للحجز (الـ trips فقط — لا pilgrims/buses)
CREATE POLICY trips_public_read ON public.trips FOR SELECT TO anon
  USING (status IN ('upcoming','active'));

-- pilgrims: انضمام للحجز العام بإدخال anon، قراءة/تعديل عبر المكتب
CREATE POLICY pilgrims_owner_all ON public.pilgrims FOR ALL
  USING (trip_id IN (SELECT t.id FROM public.trips t JOIN public.organizers o ON o.id=t.organizer_id WHERE o.user_id = auth.uid())
         OR public.is_platform_admin(auth.uid()))
  WITH CHECK (trip_id IN (SELECT t.id FROM public.trips t JOIN public.organizers o ON o.id=t.organizer_id WHERE o.user_id = auth.uid())
              OR public.is_platform_admin(auth.uid()));
CREATE POLICY pilgrims_public_insert ON public.pilgrims FOR INSERT TO anon
  WITH CHECK (true);  -- يقفله lock_seat RPC منطقياً

-- buses / hotels / hotel_rooms / expenses: نفس نمط trips
CREATE POLICY buses_owner_all ON public.buses FOR ALL
  USING (trip_id IN (SELECT t.id FROM public.trips t JOIN public.organizers o ON o.id=t.organizer_id WHERE o.user_id = auth.uid())
         OR public.is_platform_admin(auth.uid()));
CREATE POLICY hotels_owner_all ON public.hotels FOR ALL
  USING (organizer_id IN (SELECT id FROM public.organizers WHERE user_id = auth.uid())
         OR public.is_platform_admin(auth.uid()));
CREATE POLICY rooms_owner_all ON public.hotel_rooms FOR ALL
  USING (trip_id IN (SELECT t.id FROM public.trips t JOIN public.organizers o ON o.id=t.organizer_id WHERE o.user_id = auth.uid())
         OR public.is_platform_admin(auth.uid()));
CREATE POLICY expenses_owner_all ON public.expenses FOR ALL
  USING (trip_id IN (SELECT t.id FROM public.trips t JOIN public.organizers o ON o.id=t.organizer_id WHERE o.user_id = auth.uid())
         OR public.is_platform_admin(auth.uid()));

-- subscription_requests: anon يدخل، الأدمن يرى/يعدّل
CREATE POLICY subreq_public_insert ON public.subscription_requests FOR INSERT TO anon
  WITH CHECK (true);
CREATE POLICY subreq_admin_all ON public.subscription_requests FOR ALL
  USING (public.is_platform_admin(auth.uid()));

-- user_roles: الأدمن فقط
CREATE POLICY user_roles_admin_all ON public.user_roles FOR ALL
  USING (public.is_platform_admin(auth.uid()));
CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT
  USING (user_id = auth.uid());

-- notifications: للمستخدم نفسه
CREATE POLICY notif_self ON public.notifications FOR ALL
  USING (user_id = auth.uid());

-- support_tickets + messages: المكتب يرى/يفتح، الأدمن يرى الكل
CREATE POLICY tickets_owner ON public.support_tickets FOR ALL
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
CREATE POLICY ticket_msgs_owner ON public.ticket_messages FOR ALL
  USING (ticket_id IN (SELECT id FROM public.support_tickets WHERE user_id = auth.uid() OR public.is_platform_admin(auth.uid())));

-- audit_logs: قراءة للأدمن فقط، كتابة من service
CREATE POLICY audit_admin_read ON public.audit_logs FOR SELECT
  USING (public.is_platform_admin(auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
```

ملف `00000000000002_dev_disable_rls.sql` (تطوير فقط):
```sql
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
```

---

# الجزء ز — App.jsx routing pattern (view state)

```jsx
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import Landing from './pages/Landing';
import Login from './pages/auth/Login';
import SetupWorkspace from './pages/auth/SetupWorkspace';
import Overview from './pages/dashboard/Overview';
import AdminDashboard from './pages/admin/AdminDashboard';
import GuestPortal from './pages/public/GuestPortal';
import PublicBooking from './pages/public/PublicBooking';

const ROLE_PRIORITY = ['platform_owner', 'admin', 'organizer', 'customer'];

export default function App() {
  const [view, setView] = useState('landing');
  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);
  const [organizer, setOrganizer] = useState(null);
  const [loading, setLoading] = useState(true);

  // قراءة URL params مرة واحدة عند التحميل
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('booking')) { setView('public-booking'); return; }
    if (params.get('guest'))   { setView('guest-portal'); return; }
  }, []);

  // متابعة الجلسة
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user;
      setUser(u || null);
      if (!u) { setView('landing'); setLoading(false); return; }

      // اقرأ الأدوار + المكتب
      const [{ data: roleRows }, { data: orgRow }] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', u.id),
        supabase.from('organizers').select('*').eq('user_id', u.id).maybeSingle(),
      ]);
      const userRoles = (roleRows || []).map(r => r.role);
      setRoles(userRoles);
      setOrganizer(orgRow);

      // وجِّه بحسب أعلى دور
      const top = ROLE_PRIORITY.find(r => userRoles.includes(r)) || 'organizer';
      if (top === 'platform_owner' || top === 'admin') setView('admin');
      else if (top === 'organizer') {
        if (!orgRow?.setup_completed) setView('setup');
        else setView('dashboard');
      } else setView('guest-portal');
      setLoading(false);
    });

    supabase.auth.getSession();  // يحفّز onAuthStateChange بـ INITIAL_SESSION
    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <PageLoader />;

  switch (view) {
    case 'landing':         return <Landing onLogin={() => setView('login')} />;
    case 'login':           return <Login onSuccess={() => setLoading(true)} />;
    case 'setup':           return <SetupWorkspace user={user} onComplete={() => setLoading(true)} />;
    case 'dashboard':       return <Overview user={user} organizer={organizer} />;
    case 'admin':           return <AdminDashboard user={user} />;
    case 'public-booking':  return <PublicBooking />;
    case 'guest-portal':    return <GuestPortal />;
    default:                return <Landing />;
  }
}
```

---

# الجزء ح — Tailwind config

`tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        emerald: { deep: '#062821', DEFAULT: '#0A3D2E', mid: '#0F4F3E' },
        gold:    { DEFAULT: '#C9A961', mid: '#E0AE35', dark: '#8E6B2E' },
        warm:    { text: '#F5F0E8' },
      },
      fontFamily: {
        display: ['Beiruti', 'Tajawal', 'sans-serif'],
        body:    ['Tajawal', 'sans-serif'],
        english: ['Outfit', 'sans-serif'],
      },
      backdropBlur: { '3xl': '32px' },
    },
  },
  plugins: [],
};
```

`src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body { background: #030f09; color: #F5F0E8; }
  body { font-family: 'Tajawal', sans-serif; }
  * { box-sizing: border-box; }
}
```

`index.html` — أضف خطوط Google:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Beiruti:wght@400;600;800;900&family=Tajawal:wght@300;400;500;700;800;900&family=Outfit:wght@400;600;700;800;900&display=swap" rel="stylesheet">
```

---

# الجزء ط — Vite config (chunks محسّنة)

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':    ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-charts':   ['recharts'],
          'vendor-export':   ['jspdf', 'xlsx'],
        },
      },
    },
  },
});
```

---

# الجزء ي — مواصفات الصفحات (Page-by-Page)

## ي-1. Landing

- Hero: لوغو + شعار + CTA "ابدأ تجربتك" (يفتح Login).
- شرح مميزات (3-4 cards): إدارة معتمرين، حجز ذاتي، تقارير، فرق العمل.
- قسم "اشترك" (نموذج subscription_request).
- footer: اتصل بنا، سياسة الخصوصية.

## ي-2. Auth — Login + Signup

- نموذج بسيط: email + password.
- زر "إنشاء حساب" يفتح Signup.
- بعد الـ signup الناجح: أنشئ صف في `organizers` فارغ ثم وجّه لـ SetupWorkspace.

## ي-3. SetupWorkspace

حقول مطلوبة:
- اسم الشركة *
- الشعار (رفع لـ Supabase Storage bucket `org-logos`)
- الاسم الكامل
- الجوال (بدء بـ 05 وعشرة أرقام)
- الواتساب
- منصة المتجر (zid/salla/أخرى) — اختياري
- رابط المتجر — اختياري

**زر "حفظ" يُفعّل فقط بعد ملء الحقول الإلزامية.**

## ي-4. Overview (dashboard الرئيسية)

- Hero الترحيب بـ company_name + logo.
- KPIs: عدد الرحلات النشطة، المعتمرون، المدفوع، الصاعدون.
- شريط نسبة إكمال إعداد المكتب (إن لم يكتمل).
- زر "رحلة جديدة" بارز.
- آخر 5 رحلات في بطاقات.

## ي-5. Trips (مركز الرحلات)

- شبكة بطاقات + بحث + فلتر حالة (الكل/قادمة/نشطة/منتهية).
- كل بطاقة: اسم الرحلة، التواريخ، عدد المعتمرين/المقاعد، الإشغال %، حالة.
- زر "رحلة جديدة" → CreateTrip.

## ي-6. CreateTrip (نموذج عمرة)

**أقسام:**

1. **معلومات أساسية:**
   - اسم الرحلة *
   - تاريخ المغادرة + تاريخ العودة
   - وقت الصعود (datetime)
   - نقطة الانطلاق

2. **الحافلة (أولي — يضاف لاحقاً تفصيل):**
   - عدد المقاعد (افتراضي 49)
   - نوع الحافلة (افتراضي/رجال/نساء/عوائل)
   - اسم السائق + جواله

3. **فنادق مكة:**
   - اسم الفندق
   - المسافة عن الحرم
   - تاريخ الدخول / الخروج

4. **فنادق المدينة:**
   - نفس الحقول

5. **الدفع:**
   - السعر للمعتمر *
   - رابط الدفع (Zid/Salla)

6. **ملاحظات.**

**عند الحفظ:** `createTrip()` ثم وجّه لـ TripDashboard للرحلة الجديدة.

## ي-7. TripDashboard (تبويبات)

- **نظرة عامة:** KPIs + دائرة نسبة السداد + قائمة المصاريف.
- **المعتمرون:** قائمة + بحث + إضافة (modal) + تعديل + حذف + تبديل حالة الدفع.
- **الحافلات:** قائمة الحافلات + إضافة (كل الحقول) + `BusSeatMap` لتعيين المقاعد.
- **التسكين:** فنادق + غرف + drag-and-drop المعتمرين على الغرف (أو modal اختيار).
- **المالية:** قائمة المصاريف + إضافة.
- **التقارير:** زرّان: تصدير PDF + تصدير Excel.

## ي-8. BusSeatMap

شبكة 4 أعمدة (السائق في الأمام). كل مقعد:
- أخضر = حر.
- ذهبي = محجوز.
- نقرة على حرّ → modal لاختيار معتمر (من غير مقاعد) → استدعاء `lock_seat` RPC.
- نقرة على محجوز → عرض اسم المعتمر + زر "إفراغ المقعد".

## ي-9. RoomAllocation

- قائمة فنادق الرحلة (بطاقات قابلة للطي).
- داخل كل فندق: قائمة غرفه + سعة كل غرفة + المعتمرون المسكَّنون.
- "إضافة غرفة" (modal): رقم، سعة، نوع، أو إضافة جماعية (prefix + بداية + عدد).
- "إضافة فندق" (modal): الاسم، المدينة، التواريخ، ملاحظات. **يستقبل organizerId كـ prop ويُضمّنه في payload.**

## ي-10. PublicBooking

- يُفتح بـ `/?booking=<trip_id>` أو `?trip=<id>`.
- صفحة مفتوحة (لا auth) تعرض ملخّص الرحلة.
- نموذج: الاسم، الهوية، الجوال، الجنس + اختيار مقعد عبر `BusSeatMap`.
- يستخدم `pilgrims_public_insert` policy + `lock_seat` RPC.
- بعد النجاح: عرض QR + رقم الحجز + رابط لـ guest portal.

## ي-11. GuestPortal

- يُفتح بـ `/?guest=<pilgrim_id>` أو رمز قصير.
- تبويبات: بطاقتي (QR + بيانات) / رحلتي / القبلة / تواصل.
- **هذه الميزات تُجمَّد بـ `<ComingSoon />` حتى تختبر:**
  - الإرشاد الصوتي
  - معرض الذكريات
  - المساعد الذكي
  - زر SOS

## ي-12. AdminDashboard

- سايدبار: المؤسسات / طلبات الاشتراك / الأدوار / الإحصائيات.
- صفحة افتراضية: KPIs (عدد المكاتب، الرحلات، المعتمرين) عبر `count: 'exact', head: true`.

## ي-13. OrganizersManagement

- جدول قابل للفرز/البحث + pagination.
- لكل مكتب: حالة، باقة، تاريخ التسجيل، عدد الرحلات.
- إجراءات: تعليق (بسبب)، تفعيل، تغيير باقة، ملاحظات.

## ي-14. SubscriptionRequests

- قائمة الطلبات pending أولاً.
- لكل طلب: قبول / رفض / تواصل + ملاحظات.

## ي-15. RolesManager

- بحث عن مستخدم بالـ email.
- منح/سحب دور (platform_owner / admin / organizer / customer).
- آخر 50 تغيير دور.

---

# الجزء ك — معايير القبول (Definition of Done)

## قبل اعتبار MVP جاهزاً

- [ ] مكتب جديد: signup → setup → ينشئ رحلة عمرة بكامل الحقول → تُحفظ بنجاح بلا أخطاء.
- [ ] إضافة معتمر يدوياً + تعيين مقعد عبر `BusSeatMap` + تسكينه في غرفة.
- [ ] حافلة بكامل حقولها (بما فيها مشرف ونوع) تظهر فوراً في القائمة بعد الإضافة.
- [ ] رابط حجز عام يعمل، معتمر خارجي يحجز بنجاح ويحصل على QR.
- [ ] guest portal يفتح بـ pilgrim_id ويعرض بطاقة كاملة.
- [ ] لوحة أدمن: عرض المكاتب + تعليق + إحصائيات حيّة.
- [ ] تصدير كشف PDF + Excel بأسماء عربية ظاهرة.
- [ ] `npm run build` نظيف بلا warnings حرجة، أكبر chunk < 800KB gzip < 320KB.
- [ ] لا أخطاء console عند تصفّح كل الصفحات في الجوال.
- [ ] RLS مفعّل (شغّل سكريبت re_enable_rls قبل الإطلاق).
- [ ] إنشاء حساب اختبار `qa@mutamir.test` + مكتب وهمي + رحلة كاملة كنموذج.

## anti-patterns checklist (مراجعة سريعة)

- [ ] **صفر** ‎`.select(COLS_X)‎` بعد ‎`.insert()`‎ — كل INSERT يتبعه ‎`.select('id')`‎ فقط.
- [ ] **صفر** ‎`data || []`‎ يبتلع أخطاء — كل list error يُعرض toast.
- [ ] **صفر** ‎`form.check_in`‎ خام في payload — كله ‎`|| null`‎.
- [ ] **صفر** ‎`supabase.from()`‎ في مكوّن React — كله عبر services.
- [ ] **صفر** ‎`.js`‎ فيه JSX — كله ‎`.jsx`‎.
- [ ] **صفر** hardcoded ألوان في مكوّنات — كله من `identity.config.ts`.
- [ ] **صفر** `letter-spacing` سالب على العناوين العربية.
- [ ] كل migration يبدأ بـ `CREATE TABLE IF NOT EXISTS` أو `ADD COLUMN IF NOT EXISTS`.
- [ ] كل migration ينتهي بـ `NOTIFY pgrst, 'reload schema';`.

---

# الجزء ل — Deployment

## Supabase
```bash
npx supabase link --project-ref YOUR_REF
npx supabase db push
# للتحقّق:
npx supabase db diff
```

## Vercel
1. اربط المستودع.
2. Build command: `npm run build`
3. Output dir: `dist`
4. Environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. `vercel.json` (للـ SPA routing):
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/" }]
}
```

## ما بعد الإطلاق
- شغّل `re_enable_rls.sql` على Supabase prod.
- أنشئ حساب platform_owner الأول يدوياً عبر SQL Editor:
  ```sql
  INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'platform_owner' FROM auth.users WHERE email = 'owner@example.com'
  ON CONFLICT DO NOTHING;
  ```

---

# الجزء م — README مقترح للمشروع

```markdown
# معتمر — منصّة إدارة رحلات العمرة

## التشغيل المحلي
1. ‎`npm install`‎
2. انسخ ‎`.env.example → .env`‎ واملأ مفاتيح Supabase.
3. ‎`npx supabase link --project-ref YOUR_REF`‎
4. ‎`npx supabase db push`‎
5. ‎`npm run dev`‎

## النشر
- Vercel: اربط الريبو + متغيّرات البيئة → نشر تلقائي على push.
- Supabase: ‎`supabase db push`‎ بعد كل migration جديد.

## بنية المشروع
- ‎`src/services/`‎ — كل وصول للقاعدة (Rule ب-1).
- ‎`src/pages/`‎ — صفحات الـ UI.
- ‎`src/lib/identity.config.ts`‎ — مصدر التوكنات (لا hardcoded ألوان).
- ‎`supabase/migrations/`‎ — schema (migration واحد baseline).

## القواعد الذهبية
انظر MUTAMIR_MASTER_PROMPT.md الجزء ب.
```

---

# الخلاصة — تعليمات Claude Code

1. **ابنِ بترتيب المراحل في الجزء أ-3.** لا تقفز.
2. **بعد كل مرحلة، شغّل `npm run build`** للتحقق.
3. **طبّق القواعد الذهبية (الجزء ب) حرفياً** — كل كود تكتبه يجب أن يمرّ على checklist anti-patterns.
4. **النواة في الجزء هـ جاهزة للنسخ** — انسخها كما هي ولا تعيد اختراعها.
5. **schema baseline في الجزء و migration واحد فقط** — لا تجزّئه.
6. **اختبر يدوياً Definition of Done في الجزء ك** قبل أن تعتبر MVP جاهزاً.
7. لا تضف ميزات خارج هذا البرومبت بدون موافقة صريحة.

*بُني من خبرة منصّة ملبّيك الفعلية — كل قاعدة هنا نبعت من حادث حقيقي عالجناه.*
