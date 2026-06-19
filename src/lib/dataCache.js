/**
 * ذاكرةُ تخزينٍ مؤقّتٌ بسيطٌ بنمطِ SWR (Stale-While-Revalidate):
 *
 *  - عند فتح صفحةٍ تحتوي بيانات في الذاكرة: تُعرض **فورًا** بلا انتظار،
 *    ثمّ تُحدَّث في الخلفيّة من قاعدة البيانات.
 *  - تنمحي تلقائيًّا عند تسجيل الخروج (manyAll()) لمنع تسرّبَ بياناتِ
 *    حسابٍ إلى حسابٍ آخر.
 *  - تُحفظ في sessionStorage فقط (تنمحي عند إغلاق التبويب)، فلا تبقى
 *    البيانات الحسّاسةُ على القرص.
 *
 *  المفاتيحُ المعياريّةُ:
 *    sub-dash:<userId>     — لوحةُ المشترك (الحملة + الرحلات + الإحصاءات)
 *    cust-dash:<userId>    — لوحةُ العميل (الحملة + الرحلات + حجوزاتي)
 *    admin-dash            — لوحةُ الأدمن (الإحصاءات المجمَّعة)
 */
const KEY_PREFIX = 'malbeek.cache.'
const mem = new Map()

function readSession(key) {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function writeSession(key, val) {
  if (typeof sessionStorage === 'undefined') return
  try { sessionStorage.setItem(KEY_PREFIX + key, JSON.stringify(val)) } catch { /* ممتلئٌ — تجاهل */ }
}

/** يُعيد القيمةَ المخزّنةَ أو null. ينقلُ من sessionStorage إلى الذاكرة المباشرة عند أوّل قراءة. */
export function getCached(key) {
  if (mem.has(key)) return mem.get(key)
  const s = readSession(key)
  if (s) mem.set(key, s)
  return s
}

/** يحفظ القيمة في الذاكرة + sessionStorage. */
export function setCached(key, val) {
  mem.set(key, val)
  writeSession(key, val)
}

/** يحذف مفتاحًا واحدًا من الذاكرة + sessionStorage. */
export function invalidate(key) {
  mem.delete(key)
  if (typeof sessionStorage === 'undefined') return
  try { sessionStorage.removeItem(KEY_PREFIX + key) } catch { /* ignore */ }
}

/** يحذف كلّ ما هو مخزّنٌ بهذا البادئ — يُستدعى عند signOut. */
export function invalidateAll() {
  mem.clear()
  if (typeof sessionStorage === 'undefined') return
  try {
    const toRemove = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(KEY_PREFIX)) toRemove.push(k)
    }
    for (const k of toRemove) sessionStorage.removeItem(k)
  } catch { /* ignore */ }
}

/**
 * يُولّد إحصاءَ المعتمرين من قائمة الـ status — منطقُ التجميع نفسُه المستخدَم
 * في SubscriberHome.load. يفصلُ المنطقَ ليُعاد استخدامُه في الـ prefetch والـ refresh.
 */
export function buildPaxStats(rows = []) {
  const byTrip = new Map()
  const totals = { count: 0, paid: 0, boarded: 0, checked_in: 0 }
  for (const p of rows) {
    const e = byTrip.get(p.trip_id) || { count: 0, paid: 0, boarded: 0, checked_in: 0 }
    e.count++; totals.count++
    if (p.status === 'paid' || p.status === 'boarded' || p.status === 'checked_in') { e.paid++; totals.paid++ }
    if (p.status === 'boarded' || p.status === 'checked_in') { e.boarded++; totals.boarded++ }
    if (p.status === 'checked_in') { e.checked_in++; totals.checked_in++ }
    byTrip.set(p.trip_id, e)
  }
  // ملاحظة: Map لا يُسلسَل بـ JSON.stringify، لذا نخزّن `byTripEntries` كمصفوفةٍ.
  return { byTrip, totals, byTripEntries: Array.from(byTrip.entries()) }
}

/** يعيد بناءَ byTrip كـ Map من النسخة المسلسَلة. */
export function rehydratePaxStats(snapshot) {
  if (!snapshot) return { byTrip: new Map(), totals: { count: 0, paid: 0, boarded: 0, checked_in: 0 } }
  if (snapshot.byTrip instanceof Map) return snapshot
  const byTrip = new Map(snapshot.byTripEntries || [])
  return { byTrip, totals: snapshot.totals }
}
