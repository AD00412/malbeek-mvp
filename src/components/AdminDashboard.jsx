import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import Icon from './Icon'
import CompassMark from './CompassMark'
import { fmtDateTime } from '../lib/format'

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']
const DAYS_AR = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']

function arabicDate(d = new Date()) {
  return `${DAYS_AR[d.getDay()]} · ${d.getDate()} ${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`
}
function firstName(full) {
  return (full || '').trim().split(/\s+/)[0] || 'صديقنا'
}
function money(n) { return Number(n || 0).toLocaleString('en-US') }
function relTime(iso) {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'الآن'
  if (s < 3600) return `قبل ${Math.floor(s / 60)} د`
  if (s < 86400) return `قبل ${Math.floor(s / 3600)} س`
  if (s < 7 * 86400) return `قبل ${Math.floor(s / 86400)} ي`
  return fmtDateTime(iso).split(' ')[0]
}

/**
 * لوحةُ «الرئيسيّة» — هويّةُ ملبّيك v3
 *   ١) شريطُ تَرحيبٍ بعَلامة ملبّيك المائيّة + نقشٍ هندسيٍّ
 *   ٢) شريطُ الإيرادات المميَّز (gold accent)
 *   ٣) ٤ بطاقات KPI زجاجيّة قابلةٌ للنَّقر
 *   ٤) شبكةُ ٦ اختصاراتٍ
 *   ٥) فيدُ النَّشاط — timeline بخطٍّ زُمرّديّ
 */
export default function AdminDashboard({ subs, paid, trips, pax, collected, recent7, onTab }) {
  const { profile } = useAuth()
  const [activity, setActivity] = useState([])
  const [pendingHiring, setPendingHiring] = useState(0)
  const [openFb, setOpenFb] = useState(0)
  const [openMsg, setOpenMsg] = useState(0)
  const mountedRef = useRef(false)

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const [fbR, msgR, hirR, recSubs, recMsgs] = await Promise.all([
        supabase.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('public_messages').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.rpc('list_staff_invitations', { p_filter: 'review' }),
        supabase.from('subscribers').select('id, org_name, created_at').order('created_at', { ascending: false }).limit(3),
        supabase.from('public_messages').select('id, name, subject, created_at').order('created_at', { ascending: false }).limit(2),
      ])
      if (!active) return
      if (typeof fbR.count === 'number') setOpenFb(fbR.count)
      if (typeof msgR.count === 'number') setOpenMsg(msgR.count)
      const hirRows = Array.isArray(hirR.data) ? hirR.data : []
      setPendingHiring(hirRows.length)
      const events = [
        ...(recSubs.data || []).map(s => ({ id: 's' + s.id, kind: 'new_sub', label: 'مشتركٌ جديد', name: s.org_name, at: s.created_at, icon: 'building', tone: 'em' })),
        ...(recMsgs.data || []).map(m => ({ id: 'm' + m.id, kind: 'msg', label: 'رسالةٌ عامّة', name: m.name || '—', at: m.created_at, icon: 'message', tone: 'info' })),
        ...hirRows.slice(0, 2).map(h => ({ id: 'h' + h.id, kind: 'hir', label: 'طلبُ توظيف', name: h.applicant_full_name || h.email, at: h.submitted_at || h.created_at, icon: 'sparkle', tone: 'gold' })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6)
      setActivity(events)
    })()
    return () => { active = false }
  }, [subs.length])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 5) return 'مساءَ النور'
    if (h < 12) return 'صباحَ الخير'
    if (h < 17) return 'مساءَ الخير'
    return 'مساءَ النور'
  }, [])

  return (
    <div className="mlk-dash">
      {/* ─── ١) هيرو ─── */}
      <section className="mlk-hero">
        <span className="mlk-hero-mark"><CompassMark size={170} /></span>
        <div className="mlk-hero-pattern" aria-hidden="true" />
        <div className="mlk-hero-content">
          <div className="mlk-hero-eyebrow">
            <span className="mlk-hero-dot" />
            {arabicDate()}
          </div>
          <h1 className="mlk-hero-title">
            {greeting}، <span className="mlk-hero-name">{firstName(profile?.full_name)}</span>
          </h1>
          <p className="mlk-hero-sub">إشرافٌ كاملٌ على منصّة ملبّيك — كلُّ الأرقام أمامك.</p>
          {recent7 > 0 && (
            <div className="mlk-hero-pulse">
              <span className="mlk-hero-pulse-ring" />
              <span className="mlk-hero-pulse-text">
                <strong>+{recent7}</strong> مشتركٌ هذا الأسبوع
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ─── ٢) شريطُ الإيرادات ─── */}
      <section className="mlk-revenue">
        <div className="mlk-revenue-grain" aria-hidden="true" />
        <div className="mlk-revenue-icn"><Icon name="chart" size={28} /></div>
        <div className="mlk-revenue-body">
          <div className="mlk-revenue-lb">إجمالي المحصَّل عبر المنصّة</div>
          <div className="mlk-revenue-num">
            {money(collected)}<span className="mlk-revenue-cur"> ﷼</span>
          </div>
          <div className="mlk-revenue-hint">
            {subs.length > 0 ? `متوسّط ${money(Math.round(collected / subs.length))} ﷼ لكلّ مشترك` : 'لا مشتركون بعد'}
          </div>
        </div>
      </section>

      {/* ─── ٣) KPIs ─── */}
      <div className="mlk-kpi-grid">
        <KpiCard tone="em"   icon="building"  num={subs.length} label="المشتركون" sub={recent7 > 0 ? `+${recent7} هذا الأسبوع` : null} onClick={() => onTab?.('subs')} />
        <KpiCard tone="ok"   icon="payments"  num={paid}         label="باقاتٌ مدفوعة" onClick={() => onTab?.('subs')} />
        <KpiCard tone="info" icon="trips"     num={trips}        label="رحلات" onClick={() => onTab?.('trips')} />
        <KpiCard tone="warn" icon="customers" num={money(pax)}   label="معتمرون" onClick={() => onTab?.('search')} />
      </div>

      {/* ─── ٤) اختصاراتٌ سريعة ─── */}
      <section className="mlk-block">
        <header className="mlk-block-head">
          <span className="mlk-block-bar" />
          <h3>اختصاراتٌ سريعة</h3>
        </header>
        <div className="mlk-shortcuts">
          <Shortcut icon="building"  title="المشتركون"      sub="إدارة الحملات"           onClick={() => onTab?.('subs')} />
          <Shortcut icon="search"    title="البحث عن معتمر" sub="عبر الجوّال أو الاسم"     onClick={() => onTab?.('search')} />
          <Shortcut icon="message"   title="الرسائل العامّة" sub="مفتوحةٌ تَنتظر الردّ"     badge={openMsg} tone="warn" onClick={() => onTab?.('messages')} />
          <Shortcut icon="bell"      title="التغذية الراجعة" sub="ملاحظاتٌ تَنتظر"          badge={openFb}  tone="warn" onClick={() => onTab?.('feedback')} />
          <Shortcut icon="customers" title="فريق ملبّيك"    sub="طلباتُ توظيفٍ نَشِطة"    badge={pendingHiring} tone="em" onClick={() => onTab?.('team')} />
          <Shortcut icon="manifest"  title="سجلّ النَّشاط"  sub="كلُّ إجراءٍ مُوثَّق"      onClick={() => onTab?.('audit')} />
        </div>
      </section>

      {/* ─── ٥) النشاطُ الحيّ ─── */}
      <section className="mlk-block">
        <header className="mlk-block-head">
          <span className="mlk-block-bar" />
          <h3>النشاطُ الحيّ</h3>
          <span className="mlk-block-meta">{activity.length} حدث</span>
        </header>
        {activity.length === 0 ? (
          <div className="mlk-feed-empty">
            <Icon name="sparkle" size={26} />
            <span>لا نَشاطَ جديد — كلُّ شيءٍ هادئ.</span>
          </div>
        ) : (
          <ol className="mlk-feed">
            {activity.map(e => (
              <li key={e.id} className={`mlk-feed-row tone-${e.tone}`}>
                <span className="mlk-feed-dot">
                  <Icon name={e.icon} size={13} />
                </span>
                <div className="mlk-feed-body">
                  <div className="mlk-feed-lb">{e.label}</div>
                  <div className="mlk-feed-name">{e.name}</div>
                </div>
                <span className="mlk-feed-time">{relTime(e.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function KpiCard({ tone = 'em', icon, num, label, sub, onClick }) {
  return (
    <button type="button" className={`mlk-kpi mlk-kpi-${tone}`} onClick={onClick}>
      <span className="mlk-kpi-glow" aria-hidden="true" />
      <span className="mlk-kpi-ic"><Icon name={icon} size={18} /></span>
      <span className="mlk-kpi-num">{num}</span>
      <span className="mlk-kpi-lb">{label}</span>
      {sub && <span className="mlk-kpi-sub">{sub}</span>}
    </button>
  )
}

function Shortcut({ icon, title, sub, badge, tone, onClick }) {
  return (
    <button type="button" className={`mlk-sc ${tone ? 'mlk-sc-' + tone : ''}`} onClick={onClick}>
      <span className="mlk-sc-ic"><Icon name={icon} size={18} /></span>
      <span className="mlk-sc-body">
        <span className="mlk-sc-ttl">
          {title}
          {badge > 0 && <span className="mlk-sc-badge">{badge}</span>}
        </span>
        <span className="mlk-sc-sub">{sub}</span>
      </span>
      <span className="mlk-sc-arrow" aria-hidden="true">←</span>
    </button>
  )
}
