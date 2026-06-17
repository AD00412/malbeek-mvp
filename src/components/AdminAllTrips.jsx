import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

const STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }
const STATUS_TAG   = { draft: 'muted', open: 'ok', closed: 'warn', done: 'info' }

function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: '2-digit' }) }
  catch { return '—' }
}

/**
 * كلّ الرحلات في المنصّة — للإدارة فقط (RLS يحرس).
 * فيها بحثٌ بالعنوان/الحملة + فلتر حالة + فرز.
 */
export default function AdminAllTrips() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [stFilter, setStFilter] = useState('all')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('trips')
        .select('id, title, route_from, route_to, depart_at, capacity, status, created_at, subscriber_id, subscribers:subscriber_id(org_name)')
        .order('depart_at', { ascending: false, nullsFirst: false })
        .limit(500)
      if (!alive) return
      setRows(data ?? [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const safe = q.trim().toLowerCase()
    return rows.filter((t) => {
      if (stFilter !== 'all' && t.status !== stFilter) return false
      if (!safe) return true
      const blob = `${t.title || ''} ${t.subscribers?.org_name || ''} ${t.route_from || ''} ${t.route_to || ''}`.toLowerCase()
      return blob.includes(safe)
    })
  }, [rows, q, stFilter])

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>كلّ الرحلات</h3><span className="sub">({rows.length})</span>
      </div>

      <div className="field search" style={{ marginBottom: 10 }}>
        <span className="ic"><Icon name="search" size={16} /></span>
        <input type="text" placeholder="ابحث بالعنوان أو اسم الحملة أو المسار…"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="bus-tabs" style={{ marginBottom: 12 }}>
        {[
          { k: 'all', l: 'الكل', n: rows.length },
          { k: 'open', l: 'مفتوحة', n: rows.filter((t) => t.status === 'open').length },
          { k: 'closed', l: 'مغلقة', n: rows.filter((t) => t.status === 'closed').length },
          { k: 'done', l: 'منتهية', n: rows.filter((t) => t.status === 'done').length },
          { k: 'draft', l: 'مسودة', n: rows.filter((t) => t.status === 'draft').length },
        ].map((x) => (
          <button key={x.k} className={`bus-tab ${stFilter === x.k ? 'active' : ''}`} onClick={() => setStFilter(x.k)}>
            {x.l} <span className="muted">({x.n})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList count={4} />
      ) : filtered.length === 0 ? (
        <div className="empty"><div className="em-ttl">لا رحلات</div><div>لا تطابق هذا البحث/الفلتر.</div></div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl tbl-cards">
            <thead><tr><th>الرحلة</th><th>الحملة</th><th>المسار</th><th>الذهاب</th><th>السعة</th><th>الحالة</th></tr></thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td data-label="الرحلة">{t.title || '—'}</td>
                  <td data-label="الحملة" style={{ color: 'var(--gd-300)' }}>{t.subscribers?.org_name || '—'}</td>
                  <td data-label="المسار">{(t.route_from || '—') + ' ← ' + (t.route_to || '—')}</td>
                  <td data-label="الذهاب">{fmtDate(t.depart_at)}</td>
                  <td data-label="السعة">{t.capacity || '—'}</td>
                  <td data-label="الحالة"><span className={`st ${STATUS_TAG[t.status] || 'muted'}`}>{STATUS_LABEL[t.status] || t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
