import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { translateRpcError } from '../lib/rpcErrors'
import { useRealtime } from '../lib/useRealtime'
import { useUI } from '../lib/useUI'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

const STATUS_AR = { requested: 'بانتظار الاسترداد', refunded: 'تمّ الاسترداد', rejected: 'مرفوض' }
const STATUS_CLS = { requested: 'warn', refunded: 'ok', rejected: 'danger' }

function fmt(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: '2-digit' }) }
  catch { return '—' }
}

/**
 * طلبات استرداد رحلةٍ معيّنة — يعالجها صاحب الحملة بعد ردّ المبلغ عبر متجره.
 * @param {boolean} open
 * @param {string}  tripId
 * @param {Function} onClose
 */
export default function RefundsSheet({ open, tripId, onClose }) {
  const { toast, confirm } = useUI()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('requested')   // 'requested' | 'all'
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!tripId) return
    setLoading(true)
    let q = supabase.from('refunds')
      .select('id, passenger_name, national_id, amount, status, reason, refund_ref, requested_at, resolved_at')
      .eq('trip_id', tripId).order('requested_at', { ascending: false }).limit(200)
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }, [tripId, filter])

  useEffect(() => { if (open) load() }, [open, load])
  useRealtime('refunds', open && tripId ? [{ table: 'refunds', filter: `trip_id=eq.${tripId}` }] : [], load, 250, [open, tripId, load])

  async function resolve(row, status) {
    if (status === 'refunded') {
      const ok = await confirm({ title: 'تأكيد الاسترداد', message: `هل أتممتَ ردّ مبلغ ${row.amount ?? '—'} ﷼ لـ«${row.passenger_name || 'المعتمر'}» عبر متجرك؟`, confirmText: 'تمّ الاسترداد' })
      if (!ok) return
    }
    setBusyId(row.id)
    const { error } = await supabase.from('refunds').update({ status }).eq('id', row.id)
    setBusyId(null)
    if (error) toast(translateRpcError(error, 'تعذّر تحديث الطلب.'), { type: 'error' })
    else { toast(status === 'refunded' ? 'سُجّل الاسترداد ✓ وأُبلغ المعتمر' : 'حُدّث الطلب', { type: 'success' }); load() }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="طلبات الاسترداد">
      <div className="chips" style={{ marginTop: -4, marginBottom: 8 }}>
        {[{ k: 'requested', t: 'بانتظار المعالجة' }, { k: 'all', t: 'الكل' }].map((c) => (
          <button key={c.k} type="button" className={`chip ${filter === c.k ? 'active' : ''}`} onClick={() => setFilter(c.k)}>{c.t}</button>
        ))}
      </div>

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : rows.length === 0 ? (
        <div className="empty"><div className="em-ttl">لا طلبات استردادٍ في هذه التصفية</div>
          <div>تظهر هنا حين يُلغي معتمرٌ حجزًا مدفوعًا.</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.id} className="trip-card" style={{ padding: 14 }}>
              <div className="tags">
                <span className={`tag ${STATUS_CLS[r.status] || 'muted'}`}>{STATUS_AR[r.status] || r.status}</span>
                <span className="tag gold">{r.amount != null ? `${Number(r.amount).toLocaleString('en-US')} ﷼` : '—'}</span>
                <span className="tag muted">{fmt(r.requested_at)}</span>
              </div>
              <div style={{ fontWeight: 700, color: 'var(--cr-50)', marginTop: 6 }}>{r.passenger_name || 'معتمر'}</div>
              {r.national_id && <div className="muted ltr" style={{ fontSize: 12.5, textAlign: 'right' }}>{r.national_id}</div>}
              {r.reason && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>السبب: {r.reason}</div>}
              {r.status === 'requested' && (
                <div className="actions-row" style={{ marginTop: 10 }}>
                  <button className="btn btn-gold btn-sm" onClick={() => resolve(r, 'refunded')} disabled={busyId === r.id}>
                    {busyId === r.id ? <span className="spinner" /> : <><Icon name="check" size={15} /> تمّ الاسترداد</>}
                  </button>
                  <button className="icon-btn" onClick={() => resolve(r, 'rejected')} disabled={busyId === r.id}>رفض</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
