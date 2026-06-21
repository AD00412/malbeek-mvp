// ============================================================
//  ملبّيك — بذرُ حسابات الاختبار (test+)  [§٥]
//  ينشئ حساباتٍ بكلّ الأدوار + حملةَ اختبارٍ كاملةً بثلاث رحلاتٍ
//  ومعتمرين وحجوزاتٍ — لتشغيل سيناريو E2E دون أيِّ بياناتٍ حقيقيّة.
//
//  • idempotent: يُعيد التشغيلَ بأمانٍ (يتحقّق من الموجود قبل الإنشاء).
//  • يَستعمل service_role (Admin API) — شغّله محلّيًّا فقط، لا تَلتزم المفتاح.
//
//  التشغيل:
//    SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-test-accounts.js
//  أو ضَع المفتاح في .env المحلّيّ (السطر: SUPABASE_SERVICE_ROLE_KEY=...)
//  ثمّ:  node scripts/seed-test-accounts.js
//
//  التنظيف:  شغّل scripts/cleanup-test-accounts.sql في SQL Editor.
// ============================================================
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ── تحميلُ البيئة (بلا dotenv): process.env ثمّ .env المحلّيّ ──────────
function loadEnv() {
  const env = { ...process.env }
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* .env اختياريّ */ }
  return env
}

const env = loadEnv()
const URL_ = env.VITE_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !SERVICE_KEY) {
  console.error('✗ ينقص VITE_SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY (ضَعهما في البيئة أو .env).')
  process.exit(1)
}

const db = createClient(URL_, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const PASSWORD = 'TestMalbeek2026!'        // محلّيًّا فقط
const TAG = 'بذرة اختبار'                    // وسمٌ في notes للتعرّف/التنظيف
const dayMs = 86400000
const iso = (offsetDays) => new Date(Date.now() + offsetDays * dayMs).toISOString()

// ── مساعدٌ: أنشئ مستخدمًا أو أعِد الموجود (بحثًا بالبريد) ───────────────
async function ensureUser(email, meta) {
  // ابحث في الصفحات عن البريد (قائمةُ الاختبار صغيرة)
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return { id: found.id, created: false }
    if (data.users.length < 200) break
  }
  const { data, error } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: meta,
  })
  if (error) throw error
  return { id: data.user.id, created: true }
}

// ── مساعدٌ: حدّث الملفَّ الشخصيّ (الدور/الحملة/الاسم) ───────────────────
async function setProfile(id, patch) {
  const { error } = await db.from('profiles').update(patch).eq('id', id)
  if (error) throw error
}

async function main() {
  console.log('▶ بذرُ حسابات الاختبار…')

  // ١) admin — المحفّز يَمنع admin عند التسجيل، فنرفعه بعد الإنشاء.
  const admin = await ensureUser('test+admin@mulabeek.com', { full_name: 'أحمد عبدالله الإداريّ', phone: '0500000001', role: 'support' })
  await setProfile(admin.id, { role: 'admin', full_name: 'أحمد عبدالله الإداريّ', phone: '0500000001' })
  console.log(`  ✓ admin   ${admin.created ? '(جديد)' : '(موجود)'}`)

  // ٢) support
  const support = await ensureUser('test+support@mulabeek.com', { full_name: 'محمد خالد الدعم', phone: '0500000002', role: 'support' })
  await setProfile(support.id, { role: 'support', full_name: 'محمد خالد الدعم', phone: '0500000002' })
  console.log(`  ✓ support ${support.created ? '(جديد)' : '(موجود)'}`)

  // ٣) subscriber (صاحب الحملة) + الحملة
  const sub = await ensureUser('test+sub@mulabeek.com', { full_name: 'سعد ناصر القحطانيّ', phone: '0500000003', role: 'subscriber' })
  console.log(`  ✓ subscriber ${sub.created ? '(جديد)' : '(موجود)'}`)

  // الحملة (بحثًا بالـ slug للـidempotency)
  const SLUG = 'test-campaign-mlk'
  let { data: campaign } = await db.from('subscribers').select('id').eq('slug', SLUG).maybeSingle()
  if (!campaign) {
    const { data, error } = await db.from('subscribers')
      .insert({ owner_id: sub.id, org_name: 'حملة الاختبار', slug: SLUG, plan: 'trial' })
      .select('id').single()
    if (error) throw error
    campaign = data
  }
  const SUB_ID = campaign.id
  await setProfile(sub.id, { role: 'subscriber', subscriber_id: SUB_ID, full_name: 'سعد ناصر القحطانيّ', phone: '0500000003' })
  // عضويّةُ المالك
  await db.from('subscriber_members').upsert(
    { subscriber_id: SUB_ID, profile_id: sub.id, role: 'owner' }, { onConflict: 'subscriber_id,profile_id' })
  console.log(`    ↳ حملة الاختبار (${SUB_ID})`)

  // ٤) ٣ رحلات: منقضية / جارية / قادمة
  const tripDefs = [
    { title: 'رحلة الاختبار — منقضية', depart_at: iso(-20), return_at: iso(-13), status: 'done',  price: 1500 },
    { title: 'رحلة الاختبار — جارية',   depart_at: iso(-1),  return_at: iso(6),   status: 'open',  price: 1800 },
    { title: 'رحلة الاختبار — قادمة',   depart_at: iso(14),  return_at: iso(21),  status: 'open',  price: 2000 },
  ]
  const trips = []
  for (const t of tripDefs) {
    let { data: existing } = await db.from('trips').select('id').eq('subscriber_id', SUB_ID).eq('title', t.title).maybeSingle()
    if (!existing) {
      const { data, error } = await db.from('trips').insert({
        subscriber_id: SUB_ID, title: t.title,
        route_from: 'الرياض', route_to: 'مكة المكرمة',
        depart_at: t.depart_at, return_at: t.return_at, status: t.status,
        capacity: 49, boarding_point: 'محطّة الرياض المركزيّة',
        bus_rows: 11, bus_back_row: 5, seating_policy: 'mixed',
        price: t.price, notes: TAG,
      }).select('id').single()
      if (error) throw error
      existing = data
    }
    trips.push({ ...t, id: existing.id })
  }
  console.log(`    ↳ ${trips.length} رحلات`)

  // ٥ معتمرين (مُدخَلون من الحملة، بلا حساب) — موزّعون على الرحلات
  const paxDefs = [
    { trip: 0, full_name: 'عبدالرحمن سالم الغامديّ', national_id: '1011223344', phone: '0511111111', gender: 'male',   seat_no: '1A', status: 'checked_in' },
    { trip: 0, full_name: 'فاطمة علي الزهرانيّ',     national_id: '1022334455', phone: '0511111112', gender: 'female', seat_no: '2A', status: 'boarded'    },
    { trip: 1, full_name: 'يوسف ماجد العتيبيّ',      national_id: '1033445566', phone: '0511111113', gender: 'male',   seat_no: '1A', status: 'paid'       },
    { trip: 1, full_name: 'نورة فهد الدوسريّ',       national_id: '1044556677', phone: '0511111114', gender: 'female', seat_no: '2A', status: 'registered'},
    { trip: 2, full_name: 'خالد تركي الشمريّ',       national_id: '1055667788', phone: '0511111115', gender: 'male',   seat_no: '1A', status: 'registered'},
  ]
  for (const p of paxDefs) {
    const tripId = trips[p.trip].id
    const { data: ex } = await db.from('passengers').select('id').eq('trip_id', tripId).eq('national_id', p.national_id).maybeSingle()
    if (ex) continue
    const { error } = await db.from('passengers').insert({
      subscriber_id: SUB_ID, trip_id: tripId, full_name: p.full_name,
      national_id: p.national_id, phone: p.phone, gender: p.gender,
      seat_no: p.seat_no, boarding_point: 'محطّة الرياض المركزيّة',
      status: p.status, nationality: 'سعودي', notes: TAG,
    })
    if (error) throw error
  }
  console.log(`    ↳ ${paxDefs.length} معتمرين (مُدخَلون من الحملة)`)

  // ٥) manager + agent (أعضاءُ فريق) — عبر subscriber_members + profiles.role='subscriber'
  const manager = await ensureUser('test+manager@mulabeek.com', { full_name: 'بدر صالح الحربيّ', phone: '0500000004' })
  await db.from('subscriber_members').upsert({ subscriber_id: SUB_ID, profile_id: manager.id, role: 'manager' }, { onConflict: 'subscriber_id,profile_id' })
  await setProfile(manager.id, { role: 'subscriber', subscriber_id: SUB_ID, full_name: 'بدر صالح الحربيّ', phone: '0500000004' })
  console.log(`  ✓ manager ${manager.created ? '(جديد)' : '(موجود)'}`)

  const agent = await ensureUser('test+agent@mulabeek.com', { full_name: 'ريّان عمر السبيعيّ', phone: '0500000005' })
  await db.from('subscriber_members').upsert({ subscriber_id: SUB_ID, profile_id: agent.id, role: 'staff' }, { onConflict: 'subscriber_id,profile_id' })
  await setProfile(agent.id, { role: 'subscriber', subscriber_id: SUB_ID, full_name: 'ريّان عمر السبيعيّ', phone: '0500000005' })
  console.log(`  ✓ agent   ${agent.created ? '(جديد)' : '(موجود)'}`)

  // ٦) pilgrim (معتمر) — يحجز في رحلتَين (المنقضية + القادمة) + فردُ عائلةٍ بعلاقة "زوجة"
  const pilgrim = await ensureUser('test+pilgrim@mulabeek.com', { full_name: 'عبدالله حسن المالكيّ', phone: '0500000006', role: 'customer' })
  await setProfile(pilgrim.id, { role: 'customer', subscriber_id: SUB_ID, full_name: 'عبدالله حسن المالكيّ', phone: '0500000006' })
  console.log(`  ✓ pilgrim ${pilgrim.created ? '(جديد)' : '(موجود)'}`)

  // مزامنةُ customers
  const { data: custEx } = await db.from('customers').select('id').eq('profile_id', pilgrim.id).eq('subscriber_id', SUB_ID).maybeSingle()
  if (!custEx) {
    await db.from('customers').insert({
      subscriber_id: SUB_ID, profile_id: pilgrim.id, full_name: 'عبدالله حسن المالكيّ',
      national_id: '1099887766', phone: '0500000006', email: 'test+pilgrim@mulabeek.com', pickup_location: 'محطّة الرياض المركزيّة',
    })
  }

  // حجزُ المعتمر في الرحلة المنقضية (لتمكين تقييم الطرفين) + القادمة
  const bookings = [
    { trip: 0, seat_no: '5A', status: 'checked_in', family: true },
    { trip: 2, seat_no: '3A', status: 'paid',       family: false },
  ]
  for (const b of bookings) {
    const tripId = trips[b.trip].id
    let { data: mine } = await db.from('passengers').select('id, family_group_id').eq('trip_id', tripId).eq('profile_id', pilgrim.id).maybeSingle()
    if (!mine) {
      const isFam = b.family
      const fgid = isFam ? crypto.randomUUID() : null
      const { data, error } = await db.from('passengers').insert({
        subscriber_id: SUB_ID, trip_id: tripId, profile_id: pilgrim.id,
        full_name: 'عبدالله حسن المالكيّ', national_id: '1099887766', phone: '0500000006',
        gender: 'male', is_family: isFam, family_group_id: fgid, family_relation: isFam ? 'self' : null,
        seat_no: b.seat_no, boarding_point: 'محطّة الرياض المركزيّة', status: b.status, nationality: 'سعودي', notes: TAG,
      }).select('id, family_group_id').single()
      if (error) throw error
      mine = data
      // فردُ عائلةٍ بعلاقة "زوجة" (مقعدها يُخصّص لاحقًا)
      if (isFam) {
        const { error: famErr } = await db.from('passengers').insert({
          subscriber_id: SUB_ID, trip_id: tripId, full_name: 'سارة محمد المالكيّ',
          national_id: '2088776655', phone: '0500000007', gender: 'female',
          is_family: true, family_group_id: fgid, family_relation: 'spouse',
          boarding_point: 'محطّة الرياض المركزيّة', status: b.status, nationality: 'سعودي', notes: TAG,
        })
        if (famErr) throw famErr
      }
    }
  }
  console.log(`    ↳ حجوزُ المعتمر (${bookings.length}) + فردُ عائلة`)

  console.log('\n✓ تمّ البذر. كلمة السرّ الموحّدة:', PASSWORD)
  console.log('  الحسابات: test+admin / test+support / test+sub / test+manager / test+agent / test+pilgrim @mulabeek.com')
}

main().catch((e) => { console.error('\n✗ فشل البذر:', e.message || e); process.exit(1) })
