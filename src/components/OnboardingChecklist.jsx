import Icon from './Icon'

/**
 * جولة تهيئة ذكية للمشترك: تكتشف حالته الفعلية وتوجهه خطوة خطوة.
 * تختفي تلقائيا عند اكتمال الخطوات الأساسية.
 *
 * @param {object} sub
 * @param {Array}  trips
 * @param {object} totals   { count, paid, boarded, checked_in }
 * @param {Function} onCreateTrip
 * @param {Function} onShare
 * @param {Function} onManageFirst   فتح إدارة أول رحلة (لإضافة معتمر/ضبط الباص)
 */
export default function OnboardingChecklist({ sub, trips = [], totals, onCreateTrip, onShare, onManageFirst, onOrgData, loading = false }) {
  // ★ لا نرسم البطاقة قبل أن تصل البيانات الفعلية — يمنع وميضا
  //   من ٠٪ (state أولي فارغ) إلى ٢٥٪ (بعد load). ننتظر sub.
  //   لو sub موجود من cache نرسم فورا بقيمته الحقيقية.
  if (loading && !sub) return null
  if (!sub) return null   // مالك جديد بلا حملة بعد — لا داعي للبطاقة
  const hasTrip = trips.length > 0
  // «ضبط الباص» منجز فعلا حين تحوي رحلة صفوفا وسياسة مقاعد — لا بمجرد وجود رحلة.
  const hasBusSetup = trips.some((t) => t?.bus_rows && t?.seating_policy)
  const hasOrgInfo = !!(sub?.license_no || sub?.stamp_text || sub?.stamp_url || sub?.logo_url || sub?.contact_phone)
  const hasPassenger = (totals?.count || 0) > 0
  const hasStore = !!sub?.store_url

  const steps = [
    { key: 'trip', done: hasTrip, label: 'أنشئ أول رحلة عمرة', hint: 'حدد العنوان والمسار والتاريخ والسعة.', icon: 'trips', action: onCreateTrip, cta: 'إنشاء رحلة' },
    { key: 'bus', done: hasBusSetup, label: 'اضبط الباص وسياسة المقاعد', hint: 'الصفوف، السياسة (ذكور/إناث/عوائل)، والطاقم.', icon: 'seat', action: onManageFirst, cta: 'فتح الرحلة', need: hasTrip },
    { key: 'pax', done: hasPassenger, label: 'أضف أول معتمر', hint: 'أو شارك رابط الحجز ليسجل العملاء أنفسهم.', icon: 'customers', action: onManageFirst, cta: 'إضافة معتمر', need: hasTrip },
    { key: 'org', done: hasOrgInfo, label: 'أكمل بيانات المؤسسة للكشف', hint: 'الترخيص، الختم، وجوال التواصل.', icon: 'manifest', action: onOrgData || onManageFirst, cta: 'بيانات المؤسسة', need: hasTrip },
    { key: 'share', done: false, label: 'شارك رابط الحجز مع معتمريك', hint: 'كل يسجل بياناته ويختار مقعده.', icon: 'share', action: onShare, cta: 'نسخ الرابط', optional: true },
    { key: 'store', done: hasStore, label: 'اربط متجر الدفع (اختياري)', hint: 'سلة/زد — ليدفع العميل ويرفق الإيصال.', icon: 'payments', action: onOrgData || onManageFirst, cta: 'إضافة الرابط', optional: true, need: hasTrip },
  ]

  const core = steps.filter((s) => !s.optional)
  const doneCount = core.filter((s) => s.done).length
  const pct = Math.round((doneCount / core.length) * 100)
  if (doneCount === core.length) return null   // اكتملت الأساسيات → نخفي الجولة

  return (
    <section className="panel onb">
      <div className="panel-head">
        <span className="ic-badge"><Icon name="rocket" size={18} /></span>
        <div>
          <h3 style={{ margin: 0 }}>لنبدأ مع ملبّيك</h3>
          <span className="sub">أكملت {doneCount} من {core.length} خطوات</span>
        </div>
        <span style={{ flex: 1 }} />
        <span className="onb-pct">{pct}%</span>
      </div>
      <div className="bar" style={{ marginBottom: 14 }}><span style={{ width: pct + '%' }} /></div>

      <div className="onb-steps">
        {steps.map((s) => (
          <div className={`onb-step ${s.done ? 'done' : ''}`} key={s.key}>
            <span className="onb-check">{s.done ? <Icon name="check" size={15} /> : <Icon name={s.icon} size={15} />}</span>
            <div className="onb-main">
              <div className="onb-label">{s.label}{s.optional && <span className="tag muted" style={{ fontSize: 9, marginInlineStart: 6 }}>اختياري</span>}</div>
              <div className="onb-hint">{s.hint}</div>
            </div>
            {!s.done && s.action && (s.need === undefined || s.need) && (
              <button className="btn btn-ghost btn-sm" onClick={s.action}>{s.cta}</button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
