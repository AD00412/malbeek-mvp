import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import BottomSheet from './BottomSheet'
import { useUI } from '../lib/useUI'
import { fmtDateTime } from '../lib/format'

const STATUS_AR = { registered: 'مسجل', paid: 'مدفوع', boarded: 'صعد', checked_in: 'استلم الغرفة' }
const STATUS_TONE = { registered: 'muted', paid: 'ok', boarded: 'info', checked_in: 'warn' }

/**
 * بحث عبر المنصة كلها — للإدارة فقط (RLS يمنح الأدمن قراءة كل المعتمرين).
 * يظهر اسم الحملة لكل معتمر، والنقر يفتح ورقة تفاصيل كاملة.
 */
export default function AdminPilgrimSearch() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [detail, setDetail] = useState(null)
  const { toast } = useUI()

  useEffect(() => {
    const safe = q.replace(/[,()%*:]/g, '').trim()
    if (safe.length < 2) { setRows([]); setSearched(false); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('passengers')
        .select('id, full_name, national_id, phone, seat_no, status, trip_id, subscriber_id, gender, paid_at, created_at, trips:trip_id(title, route_from, route_to, depart_at), subscribers:subscriber_id(org_name, slug)')
        .or(`full_name.ilike.%${safe}%,national_id.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .order('created_at', { ascending: false })
        .limit(60)
      if (!alive) return
      setRows(data ?? [])
      setSearched(true)
      setLoading(false)
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  const safeQ = q.replace(/[,()%*:]/g, '').trim()

  async function copyText(v, label) {
    if (!v) return
    try { await navigator.clipboard.writeText(v); toast(label + ' ✓', { type: 'success' }) }
    catch { toast(v, { type: 'info' }) }
  }

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">بحث المعتمرين</h1>
        {rows.length > 0 && <span className="mlk-tab-count">{rows.length} نتيجة</span>}
      </header>

      <div className="field search" style={{ margin: 0 }}>
        <span className="ic"><Icon name="search" size={17} /></span>
        <input type="search" autoComplete="off" autoCorrect="off" spellCheck="false"
               placeholder="الاسم / رقم الهوية / الجوال — في كل الحملات"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? <div className="mlk-empty">جار البحث…</div> :
       safeQ.length < 2 ? <div className="mlk-empty">اكتب حرفين على الأقل — يبحث في كل المعتمرين عبر كل الحملات</div> :
       rows.length === 0 && searched ? <div className="mlk-empty">لا معتمر يطابق بحثك في أي حملة</div> :
       <ul className="mlk-list">
         {rows.map((p) => (
           <li key={p.id}>
             <button type="button" className="mlk-list-row is-button" onClick={() => setDetail(p)}>
               <div className="mlk-list-body">
                 <div className="mlk-list-meta">
                   <span className={`mlk-pill ${STATUS_TONE[p.status] || 'muted'}`}>{STATUS_AR[p.status] || p.status}</span>
                   {p.seat_no && <span className="mlk-pill muted">مقعد {p.seat_no}</span>}
                   <span style={{ marginInlineStart: 'auto', color: 'var(--em-500)', fontWeight: 600, fontSize: 12 }}>
                     {p.subscribers?.org_name || 'حملة'}
                   </span>
                 </div>
                 <div className="mlk-list-title">{p.full_name || '—'}</div>
                 <div className="mlk-list-meta">
                   <span className="ltr">{p.national_id || '—'}</span>
                   <span>·</span>
                   <span className="ltr">{p.phone || '—'}</span>
                   <span>·</span>
                   <span>{p.trips?.title || 'رحلة'}</span>
                 </div>
               </div>
               <span className="mlk-list-time">←</span>
             </button>
           </li>
         ))}
       </ul>}

      {/* ورقة تفاصيل المعتمر */}
      <BottomSheet open={!!detail} onClose={() => setDetail(null)} title={detail?.full_name || 'معتمر'}>
        {detail && (
          <div className="mlk-tab">
            <div className="mlk-card is-feature">
              <div className="mlk-list-meta" style={{ marginBottom: 6 }}>
                <span className={`mlk-pill ${STATUS_TONE[detail.status] || 'muted'}`}>{STATUS_AR[detail.status] || detail.status}</span>
                {detail.seat_no && <span className="mlk-pill muted">مقعد {detail.seat_no}</span>}
                {detail.gender && <span className="mlk-pill muted">{detail.gender === 'male' ? 'ذكر' : 'أنثى'}</span>}
              </div>
              <div className="mlk-list-title" style={{ fontSize: 18 }}>{detail.full_name || '—'}</div>
              {detail.national_id && (
                <button type="button" className="mlk-list-meta ltr"
                        onClick={() => copyText(detail.national_id, 'نسخت الهوية')}
                        style={{ background: 'transparent', border: 0, color: 'var(--cr-300)', cursor: 'pointer', padding: 0 }}>
                  هوية: {detail.national_id} <Icon name="copy" size={11} />
                </button>
              )}
              {detail.phone && (
                <div className="mlk-list-meta" style={{ marginTop: 6 }}>
                  <a href={`tel:${detail.phone}`} className="ltr" style={{ color: 'var(--em-500)' }}>{detail.phone}</a>
                  <a href={`https://wa.me/${String(detail.phone).replace(/\D/g, '')}`}
                     target="_blank" rel="noopener"
                     style={{ color: 'var(--em-500)' }}>· واتساب</a>
                  <button type="button" onClick={() => copyText(detail.phone, 'نسخ الرقم')}
                          style={{ background: 'transparent', border: 0, color: 'var(--cr-300)', cursor: 'pointer' }}>
                    <Icon name="copy" size={11} />
                  </button>
                </div>
              )}
            </div>

            <section>
              <h2 className="mlk-h2">الحملة</h2>
              <div className="mlk-card">
                <div className="mlk-list-title">{detail.subscribers?.org_name || '—'}</div>
                {detail.subscribers?.slug && (
                  <code className="ltr" style={{ fontSize: 11, color: 'var(--cr-300)' }}>/{detail.subscribers.slug}</code>
                )}
              </div>
            </section>

            <section>
              <h2 className="mlk-h2">الرحلة</h2>
              <div className="mlk-card">
                <div className="mlk-list-title">{detail.trips?.title || '—'}</div>
                {detail.trips?.route_from && (
                  <div className="mlk-list-meta">
                    {detail.trips.route_from} ← {detail.trips.route_to}
                  </div>
                )}
                {detail.trips?.depart_at && (
                  <div className="mlk-list-meta">انطلاق: {fmtDateTime(detail.trips.depart_at)}</div>
                )}
              </div>
            </section>

            <section>
              <h2 className="mlk-h2">الزمن</h2>
              <ul className="mlk-list">
                {detail.created_at && (
                  <li className="mlk-list-row">
                    <span className="mlk-list-body"><span className="mlk-list-meta">سجل</span></span>
                    <span className="mlk-list-time">{fmtDateTime(detail.created_at)}</span>
                  </li>
                )}
                {detail.paid_at && (
                  <li className="mlk-list-row">
                    <span className="mlk-list-body"><span className="mlk-list-meta">دفع</span></span>
                    <span className="mlk-list-time">{fmtDateTime(detail.paid_at)}</span>
                  </li>
                )}
              </ul>
            </section>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
