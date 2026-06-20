import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import Icon from './Icon'
import { fmtDateTime } from '../lib/format'

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']
const DAYS_AR = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']

function arabicDate(d = new Date()) {
  return `${DAYS_AR[d.getDay()]} ${d.getDate()} ${MONTHS_AR[d.getMonth()]}`
}
function firstName(full) {
  return (full || '').trim().split(/\s+/)[0] || ''
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
 * «الرئيسيّة» — هويّةُ ملبّيك v4
 *   مَنهجٌ: لا تَكرار · لا زَخرفة · لا حركات لافتة
 *
 *   ١) شريطُ تَرحيبٍ هادئ — اسمٌ + تاريخ + سَطرٌ تَنفيذيٌّ واحد
 *   ٢) شَريطُ KPIs — للقراءة فقط، لا روابط (الـsidebar للتنقّل)
 *   ٣) «تَحتاج انتباهك» — يَظهر فقط لو فيه عدّاد > 0
 *   ٤) النشاطُ الحيّ — قائمةٌ بسيطة
 */
export default function AdminDashboard({ subs, paid, trips, pax, collected, recent7, onTab, openFb = 0, openMsg = 0 }) {
  const { profile } = useAuth()
  const [activity, setActivity] = useState([])
  const [pendingHiring, setPendingHiring] = useState(0)

  // مَلاحظة: openFb و openMsg تَأتيان من AdminHome — لا نَعيد جَلبَهما هنا.
  // كذلك آخر المشتركين من prop `subs` مباشرةً — لا طلب إضافيّ.
  // التَّبعيّةُ على عدد المشتركين فقط — لا على مَرجع المصفوفة، لتَجنُّب
  // إطلاق list_staff_invitations مع كلّ refresh لـadmin_campaign_stats.
  const subsCount = subs.length
  useEffect(() => {
    let active = true
    ;(async () => {
      const [hirR, recMsgs] = await Promise.all([
        supabase.rpc('list_staff_invitations', { p_filter: 'review' }),
        supabase.from('public_messages').select('id, name, created_at').order('created_at', { ascending: false }).limit(2),
      ])
      if (!active) return
      const hirRows = Array.isArray(hirR.data) ? hirR.data : []
      setPendingHiring(hirRows.length)
      setActivity(prev => {
        const recentSubs = [...subs]
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
          .slice(0, 3)
        return [
          ...recentSubs.map(s => ({ id: 's' + s.id, kind: 'مشترك', name: s.org_name, at: s.created_at })),
          ...(recMsgs.data || []).map(m => ({ id: 'm' + m.id, kind: 'رسالة', name: m.name || '—', at: m.created_at })),
          ...hirRows.slice(0, 2).map(h => ({ id: 'h' + h.id, kind: 'توظيف', name: h.applicant_full_name || h.email, at: h.submitted_at || h.created_at })),
        ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6)
      })
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsCount])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'صباحَ الخير'
    if (h < 17) return 'مساءَ الخير'
    return 'مساءَ النور'
  }, [])

  const attention = [
    openMsg > 0     && { count: openMsg,        label: 'رسالةٌ عامّةٌ مفتوحة',   tab: 'messages' },
    openFb > 0      && { count: openFb,         label: 'تَغذيةٌ راجعةٌ مفتوحة',   tab: 'feedback' },
    pendingHiring > 0 && { count: pendingHiring, label: 'طلبُ توظيفٍ للمراجعة', tab: 'team'     },
  ].filter(Boolean)

  return (
    <div className="mlk-dash">
      {/* ─── ١) شريطُ التَّرحيب ─── */}
      <header className="mlk-hello">
        <div className="mlk-hello-date">{arabicDate()}</div>
        <h1 className="mlk-hello-title">
          {greeting}{firstName(profile?.full_name) ? '، ' : ''}
          <span className="mlk-hello-name">{firstName(profile?.full_name)}</span>
        </h1>
      </header>

      {/* ─── ٢) KPIs ـ للقراءة ـ ─── */}
      <section className="mlk-kpis">
        <div className="mlk-kpi">
          <div className="mlk-kpi-num">{subs.length}</div>
          <div className="mlk-kpi-lb">مشتركون</div>
          {recent7 > 0 && <div className="mlk-kpi-delta">+{recent7} هذا الأسبوع</div>}
        </div>
        <div className="mlk-kpi">
          <div className="mlk-kpi-num">{paid}</div>
          <div className="mlk-kpi-lb">باقاتٌ مدفوعة</div>
        </div>
        <div className="mlk-kpi">
          <div className="mlk-kpi-num">{trips}</div>
          <div className="mlk-kpi-lb">رحلات</div>
        </div>
        <div className="mlk-kpi">
          <div className="mlk-kpi-num">{money(pax)}</div>
          <div className="mlk-kpi-lb">معتمرون</div>
        </div>
      </section>

      {/* ─── ٣) الإيرادات — كَسطرٍ مَيَّز ─── */}
      <section className="mlk-revenue">
        <div className="mlk-revenue-lb">إجمالي المحصَّل عبر المنصّة</div>
        <div className="mlk-revenue-num">
          {money(collected)} <span className="mlk-revenue-cur">﷼</span>
        </div>
        {subs.length > 0 && (
          <div className="mlk-revenue-avg">
            متوسّط <strong>{money(Math.round(collected / subs.length))}</strong> ﷼ لكلّ مشترك
          </div>
        )}
      </section>

      {/* ─── ٤) تَحتاج انتباهك — يَظهر فقط لو هناك ما يَستحقّ ─── */}
      {attention.length > 0 && (
        <section className="mlk-attn">
          <h2 className="mlk-h">تَحتاج انتباهك</h2>
          <ul className="mlk-attn-list">
            {attention.map((a, i) => (
              <li key={i}>
                <button type="button" className="mlk-attn-row" onClick={() => onTab?.(a.tab)}>
                  <span className="mlk-attn-count">{a.count}</span>
                  <span className="mlk-attn-label">{a.label}</span>
                  <span className="mlk-attn-go">←</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── ٥) النشاطُ الأخير ─── */}
      <section className="mlk-recent">
        <h2 className="mlk-h">النشاطُ الأخير</h2>
        {activity.length === 0 ? (
          <div className="mlk-recent-empty">لا نَشاطَ جديد.</div>
        ) : (
          <ul className="mlk-recent-list">
            {activity.map(e => (
              <li key={e.id} className="mlk-recent-row">
                <span className="mlk-recent-kind">{e.kind}</span>
                <span className="mlk-recent-name">{e.name}</span>
                <span className="mlk-recent-time">{relTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
