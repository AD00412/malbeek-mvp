import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import Icon from './Icon'
import { fmtDateTime } from '../lib/format'

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']
const DAYS_AR = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']

function arabicDateLong(d = new Date()) {
  return `${DAYS_AR[d.getDay()]} ${d.getDate()} ${MONTHS_AR[d.getMonth()]}`
}
function firstName(full) {
  const n = (full || '').trim().split(/\s+/)[0]
  return n || 'صديقنا'
}
function money(n) { return Number(n || 0).toLocaleString('en-US') }
function relTime(iso) {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'الآن'
  if (s < 3600) return `قبل ${Math.floor(s / 60)} دقيقة`
  if (s < 86400) return `قبل ${Math.floor(s / 3600)} ساعة`
  if (s < 7 * 86400) return `قبل ${Math.floor(s / 86400)} يوم`
  return fmtDateTime(iso).split(' ')[0]
}

/**
 * لوحةُ الرئيسيّة الجديدة للإدارة:
 *  ١) شريطُ تَرحيب + تاريخٌ بالعربيّة
 *  ٢) شبكةُ KPI أنيقة (٤ بطاقات + بطاقةُ الإيرادات الكبيرة)
 *  ٣) اختصاراتٌ سريعة (٤ بطاقات بألوان مميَّزة)
 *  ٤) النشاطُ الحيّ — آخر ٥ أحداث (مشتركون، رسائل، تَوظيف)
 */
export default function AdminDashboard({ subs, paid, trips, pax, collected, recent7, onTab }) {
  const { profile } = useAuth()
  const [activity, setActivity] = useState([])
  const [pendingHiring, setPendingHiring] = useState(0)
  const [openFb, setOpenFb] = useState(0)
  const [openMsg, setOpenMsg] = useState(0)

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
        ...hirRows.slice(0, 2).map(h => ({ id: 'h' + h.id, kind: 'hir', label: 'طلبُ توظيفٍ يَنتظر', name: h.applicant_full_name || h.email, at: h.submitted_at || h.created_at, icon: 'sparkle', tone: 'gold' })),
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
    <div className="adm-dash">
      {/* ─── شريطُ تَرحيب ─── */}
      <section className="adm-hero">
        <div className="adm-hero-bg" />
        <div className="adm-hero-inner">
          <div className="adm-hero-greet">
            <div className="adm-hero-eyebrow">{arabicDateLong()}</div>
            <h1 className="adm-hero-title">
              {greeting}، <span className="adm-hero-name">{firstName(profile?.full_name)}</span> 👋
            </h1>
            <div className="adm-hero-sub">إشرافٌ كاملٌ على منصّة ملبّيك — كلُّ الأرقام أمامك.</div>
          </div>
          {recent7 > 0 && (
            <div className="adm-hero-pulse">
              <span className="adm-hero-pulse-dot" />
              <div>
                <div className="adm-hero-pulse-num">+{recent7}</div>
                <div className="adm-hero-pulse-lb">مشتركٌ هذا الأسبوع</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─── شبكةُ KPI ─── */}
      <div className="adm-kpi-grid">
        <button type="button" className="adm-kpi" onClick={() => onTab?.('subs')}>
          <div className="adm-kpi-ic"><Icon name="building" size={20} /></div>
          <div className="adm-kpi-num">{subs.length}</div>
          <div className="adm-kpi-lb">المشتركون</div>
          {recent7 > 0 && <div className="adm-kpi-trend">+{recent7} هذا الأسبوع</div>}
        </button>
        <button type="button" className="adm-kpi adm-kpi-ok" onClick={() => onTab?.('subs')}>
          <div className="adm-kpi-ic"><Icon name="payments" size={20} /></div>
          <div className="adm-kpi-num">{paid}</div>
          <div className="adm-kpi-lb">باقاتٌ مدفوعة</div>
        </button>
        <button type="button" className="adm-kpi adm-kpi-info" onClick={() => onTab?.('trips')}>
          <div className="adm-kpi-ic"><Icon name="trips" size={20} /></div>
          <div className="adm-kpi-num">{trips}</div>
          <div className="adm-kpi-lb">رحلات</div>
        </button>
        <button type="button" className="adm-kpi adm-kpi-warn" onClick={() => onTab?.('search')}>
          <div className="adm-kpi-ic"><Icon name="customers" size={20} /></div>
          <div className="adm-kpi-num">{money(pax)}</div>
          <div className="adm-kpi-lb">معتمرون</div>
        </button>
      </div>

      {/* ─── إيرادات المنصّة ─── */}
      <section className="adm-revenue">
        <div className="adm-revenue-side">
          <div className="adm-revenue-lb">إجمالي المحصَّل عبر المنصّة</div>
          <div className="adm-revenue-num">
            {money(collected)} <span className="adm-revenue-cur">﷼</span>
          </div>
          <div className="adm-revenue-hint">
            متوسط {subs.length > 0 ? money(Math.round(collected / subs.length)) : 0} ﷼ لكلّ مشترك
          </div>
        </div>
        <div className="adm-revenue-icn"><Icon name="chart" size={64} /></div>
      </section>

      {/* ─── اختصارات ─── */}
      <section className="adm-section">
        <div className="adm-section-head">
          <h3>اختصاراتٌ سريعة</h3>
        </div>
        <div className="adm-actions">
          <button type="button" className="adm-action" onClick={() => onTab?.('subs')}>
            <span className="adm-action-ic"><Icon name="building" size={18} /></span>
            <div>
              <div className="adm-action-ttl">المشتركون</div>
              <div className="adm-action-sub">إدارة الحملات</div>
            </div>
          </button>
          <button type="button" className="adm-action" onClick={() => onTab?.('search')}>
            <span className="adm-action-ic"><Icon name="search" size={18} /></span>
            <div>
              <div className="adm-action-ttl">البحث عن معتمر</div>
              <div className="adm-action-sub">عبر الجوّال أو الاسم</div>
            </div>
          </button>
          <button type="button" className="adm-action adm-action-alert" onClick={() => onTab?.('messages')}>
            <span className="adm-action-ic"><Icon name="message" size={18} /></span>
            <div>
              <div className="adm-action-ttl">
                الرسائل العامّة
                {openMsg > 0 && <span className="adm-action-badge">{openMsg}</span>}
              </div>
              <div className="adm-action-sub">مفتوحةٌ تَنتظر الردّ</div>
            </div>
          </button>
          <button type="button" className="adm-action adm-action-alert" onClick={() => onTab?.('feedback')}>
            <span className="adm-action-ic"><Icon name="bell" size={18} /></span>
            <div>
              <div className="adm-action-ttl">
                التغذية الراجعة
                {openFb > 0 && <span className="adm-action-badge">{openFb}</span>}
              </div>
              <div className="adm-action-sub">مفتوحة</div>
            </div>
          </button>
          <button type="button" className="adm-action adm-action-em" onClick={() => onTab?.('team')}>
            <span className="adm-action-ic"><Icon name="customers" size={18} /></span>
            <div>
              <div className="adm-action-ttl">
                فريق ملبّيك
                {pendingHiring > 0 && <span className="adm-action-badge">{pendingHiring}</span>}
              </div>
              <div className="adm-action-sub">طلبات توظيفٍ نشطة</div>
            </div>
          </button>
          <button type="button" className="adm-action" onClick={() => onTab?.('audit')}>
            <span className="adm-action-ic"><Icon name="manifest" size={18} /></span>
            <div>
              <div className="adm-action-ttl">سجلّ النَّشاط</div>
              <div className="adm-action-sub">كلُّ إجراءٍ موثَّق</div>
            </div>
          </button>
        </div>
      </section>

      {/* ─── النشاطُ الحيّ ─── */}
      <section className="adm-section">
        <div className="adm-section-head">
          <h3>النشاطُ الحيّ</h3>
          <span className="adm-section-meta">آخر {activity.length} حدث</span>
        </div>
        {activity.length === 0 ? (
          <div className="adm-feed-empty">
            <Icon name="sparkle" size={28} />
            <div>لا نَشاطَ جديد — كلُّ شيءٍ هادئ.</div>
          </div>
        ) : (
          <ul className="adm-feed">
            {activity.map(e => (
              <li key={e.id} className={`adm-feed-row tone-${e.tone}`}>
                <span className="adm-feed-ic"><Icon name={e.icon} size={16} /></span>
                <div className="adm-feed-body">
                  <div className="adm-feed-ttl">{e.label}</div>
                  <div className="adm-feed-name">{e.name}</div>
                </div>
                <span className="adm-feed-time">{relTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
