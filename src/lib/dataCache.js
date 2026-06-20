/**
 * ذاكرةُ تخزينٍ مؤقّتٌ بنمطِ SWR + TTL:
 *
 *  - عند فتح صفحةٍ تحتوي بيانات حديثة (< TTL): تُعرض **فورًا**، ثمّ
 *    تُحدَّث في الخلفيّة من قاعدة البيانات.
 *  - بياناتٌ أَقدمُ من TTL تُعامَل كأنّها غير موجودة → تَحميلٌ كاملٌ
 *    من DB. يَمنع عرضَ بياناتٍ بائدةٍ بعد ساعاتٍ من عدم الاستعمال.
 *  - تنمحي تلقائيًّا عند تسجيل الخروج (invalidateAll) — لا تَسرُّبَ بين حسابات.
 *  - sessionStorage فقط — تَختفي عند إغلاق التبويب، فلا تَبقى على القرص.
 *
 *  ما يُخزَّن (TTL ٥ دقائق):
 *    sub-dash:<userId>     لوحةُ المشترك  (sub + trips + paxStats)
 *    cust-dash:<userId>    لوحةُ العميل (sub + trips + bookings)
 *    admin-dash            لوحةُ الأدمن (الإحصاءات المجمَّعة)
 *    trip-mgr:<tripId>     إدارةُ الرحلة (passengers + waitlist + buses)
 *    cust-booking:<tripId>:<userId> صفحةُ حجزِ العميل
 *
 *  ما لا يُخزَّن أبدًا (لا cache):
 *    - الإشعارات (notifications) — حيٌّ بـrealtime، الـcache يُضلِّل
 *    - عدّاد الجرس (unread count) — يَتغيّر بفعل المستخدم نفسه
 *    - أيُّ بياناتٍ تَخصّ خطواتِ التهيئة (تُحسَب من cache المشترك مباشرةً)
 */
const KEY_PREFIX = 'malbeek.cache.'
const DEFAULT_TTL_MS = 5 * 60 * 1000   // ٥ دقائق — بعدها cache باطل
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

/** يُغلّف القيمةَ بـ {v, t} حيث t هو وقتُ الكتابة. شفّافٌ للمستدعِي. */
function pack(val) { return { v: val, t: Date.now() } }
function unpack(entry) {
  if (!entry) return null
  // توافقٌ خلفيٌّ مع cache قديم بدون غلاف
  if (entry.v === undefined || entry.t === undefined) return entry
  if (Date.now() - entry.t > DEFAULT_TTL_MS) return null   // باطلٌ
  return entry.v
}

/** يُعيد القيمةَ المخزّنةَ (إن كانت لم تَنتهِ صلاحيّتُها) أو null. */
export function getCached(key) {
  let entry = mem.get(key)
  if (!entry) {
    entry = readSession(key)
    if (entry) mem.set(key, entry)
  }
  const value = unpack(entry)
  if (entry && value === null) {
    // انتهت الصلاحيّةُ → امسحه ليُحرَّر المكان
    mem.delete(key)
    try { sessionStorage.removeItem(KEY_PREFIX + key) } catch { /* ignore */ }
  }
  return value
}

/** يحفظ القيمة مع طابعٍ زمنيٍّ — تنتهي صلاحيّتُها بعد ٥ دقائق. */
export function setCached(key, val) {
  const entry = pack(val)
  mem.set(key, entry)
  writeSession(key, entry)
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
