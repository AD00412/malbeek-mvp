// ============================================================
//  ملبّيك — بذرُ ٤٩ معتمرًا لاختبار ترقيم الكشف الرسميّ فقط
//  • موسومون بوضوح: full_name يبدأ بـ«[بذرة-اختبار]» + notes='بذرة-اختبار-كشف'.
//  • idempotent: يحذف الموسومين القدامى ثمّ يُدرج ٤٩ من جديد.
//  • قابلون للحذف نهائيًّا عبر scripts/cleanup-seed-passengers.sql.
//  • يَستعمل service_role — شغّله محلّيًّا فقط، لا تَلتزم المفتاح.
//  الغرض الوحيد: إثبات أنّ الكشف لا يُنشئ صفحةً فارغةً بين الكشوف/الصفحات.
//
//  التشغيل:  node scripts/seed-manifest-test.mjs
//  الحذف:    شغّل scripts/cleanup-seed-passengers.sql في SQL Editor.
// ============================================================
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

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
  console.error('✗ ينقص VITE_SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY (في البيئة أو .env).')
  process.exit(1)
}
const db = createClient(URL_, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const TAG = 'بذرة-اختبار-كشف'            // وسمٌ في notes للتعرّف/الحذف
const NAME_PREFIX = '[بذرة-اختبار]'       // وسمٌ بصريٌّ في الاسم
const SLUG = 'test-campaign-mlk'
const TRIP_TITLE = 'رحلة الاختبار — قادمة'
const TOTAL = 49
const SPLIT = 30                          // أوّل مكان ركوبٍ ٣٠، والثاني ١٩ — لاختبار تعدّد الكشوف
const BP1 = 'محطّة الرياض المركزيّة'
const BP2 = 'محطّة جدة'

const FIRST = ['عبدالله','محمد','أحمد','سعد','خالد','فهد','نواف','يوسف','عمر','تركي','ماجد','سلطان','بدر','ريّان','نايف','فيصل','وليد','هاني','زياد','طلال']
const LAST  = ['الغامديّ','الزهرانيّ','العتيبيّ','القحطانيّ','الدوسريّ','الشمريّ','الحربيّ','السبيعيّ','المالكيّ','العمريّ']

async function main() {
  console.log('▶ بذرُ معتمري اختبار الكشف…')

  const { data: campaign, error: cErr } = await db.from('subscribers').select('id').eq('slug', SLUG).maybeSingle()
  if (cErr) throw cErr
  if (!campaign) { console.error(`✗ حملةُ الاختبار (${SLUG}) غير موجودة — شغّل seed-test-accounts.js أوّلًا.`); process.exit(1) }
  const SUB_ID = campaign.id

  const { data: trip, error: tErr } = await db.from('trips').select('id, capacity')
    .eq('subscriber_id', SUB_ID).eq('title', TRIP_TITLE).maybeSingle()
  if (tErr) throw tErr
  if (!trip) { console.error(`✗ رحلةُ الاختبار «${TRIP_TITLE}» غير موجودة — شغّل seed-test-accounts.js أوّلًا.`); process.exit(1) }
  const TRIP_ID = trip.id

  // idempotency: احذف الموسومين القدامى على هذه الرحلة
  const { error: delErr } = await db.from('passengers').delete().eq('trip_id', TRIP_ID).eq('notes', TAG)
  if (delErr) throw delErr

  const rows = []
  for (let i = 0; i < TOTAL; i++) {
    const n = i + 1
    const first = FIRST[i % FIRST.length]
    const last = LAST[i % LAST.length]
    const nn = String(n).padStart(2, '0')
    rows.push({
      subscriber_id: SUB_ID, trip_id: TRIP_ID,
      full_name: `${NAME_PREFIX} ${first} ${last} ${nn}`,
      national_id: `2${String(100000000 + n)}`,          // ١٠ أرقام تبدأ بـ٢ (إقامة)
      phone: `05${String(100000000 + n).slice(1)}`,       // 05XXXXXXXX (١٠ أرقام)
      gender: i % 3 === 0 ? 'female' : 'male',
      boarding_point: i < SPLIT ? BP1 : BP2,
      status: i % 4 === 0 ? 'registered' : 'paid',
      nationality: 'سعودي',
      notes: TAG,
    })
  }

  // إدراجٌ على دفعاتٍ صغيرة (أأمن)
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25)
    const { error } = await db.from('passengers').insert(batch)
    if (error) throw error
  }

  const { count } = await db.from('passengers')
    .select('*', { count: 'exact', head: true }).eq('trip_id', TRIP_ID).eq('notes', TAG)

  console.log(`  ✓ أُدرج ${count ?? rows.length} معتمرًا موسومًا على «${TRIP_TITLE}»`)
  console.log(`    ↳ ${SPLIT} في «${BP1}» + ${TOTAL - SPLIT} في «${BP2}» (لاختبار تعدّد الكشوف)`)
  console.log(`    ↳ الحملة: ${SUB_ID} · الرحلة: ${TRIP_ID}`)
  console.log('\n✓ تمّ. للحذف: scripts/cleanup-seed-passengers.sql في SQL Editor.')
  console.log('  تسجيل الدخول: test+manager@mulabeek.com / TestMalbeek2026!')
}

main().catch((e) => { console.error('\n✗ فشل البذر:', e.message || e); process.exit(1) })
