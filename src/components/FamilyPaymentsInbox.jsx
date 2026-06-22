import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { translateRpcError } from '../lib/rpcErrors'
import { useUI } from '../lib/useUI'
import Icon from './Icon'
import SignedImage from './SignedImage'

/**
 * واجهة تحقق صاحب الحملة من دفعات العائلات الجماعية.
 * رأس العائلة يدفع عن أقاربه (متجر زد/سلة أو بنك) ويرفق رقم الطلب +
 * الإيصال الجماعي؛ هنا يراجعها صاحب الحملة فيؤكد دفع المجموعة كاملة.
 *
 * يعتمد على RPCs: list_family_payments / verify_family_payment.
 * لا حركة أموال — تأكيد يدوي لإيصال مستلم.
 *
 * @param {object}  sub          { id, ... }
 * @param {object} [trip]        لو مرر، يقصر القائمة على رحلة واحدة
 * @param {Function} onChanged   تستدعى بعد تأكيد ناجح (لتحديث الأب)
 */
export default function FamilyPaymentsInbox({ sub, trip, onChanged }) {
  const { toast, confirm } = useUI()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    if (!sub?.id) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('list_family_payments', {
      p_sub: sub.id, p_trip: trip?.id ?? null,
    })
    if (error) toast(translateRpcError(error, 'تعذر تحميل دفعات العائلات.'), { type: 'error' })
    setRows(data || [])
    setLoading(false)
  }, [sub?.id, trip?.id, toast])

  useEffect(() => { load() }, [load])

  async function verify(r) {
    const pending = Number(r.member_count) - Number(r.paid_count)
    const ok = await confirm({
      title: 'تأكيد دفع العائلة',
      message: `سيؤكد دفع ${pending} من أفراد عائلة «${r.head_name || '—'}» دفعة واحدة. تأكدت من الإيصال؟`,
      confirmText: 'نعم، أكد الدفع',
    })
    if (!ok) return
    setBusyId(r.family_group_id)
    const { data, error } = await supabase.rpc('verify_family_payment', {
      p_group: r.family_group_id, p_trip: r.trip_id,
    })
    setBusyId('')
    if (error) { toast(translateRpcError(error, 'تعذر تأكيد الدفع.'), { type: 'error' }); return }
    toast(`أكد دفع ${data ?? 0} فردا ✓`, { type: 'success' })
    await load()
    onChanged?.()
  }

  if (loading) return <div className="muted" style={{ padding: '12px' }}>جار التحميل…</div>
  if (rows.length === 0) {
    return <div className="muted" style={{ padding: '12px' }}>لا دفعات عائلات بعد.</div>
  }

  return (
    <div className="fam-pay-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r) => {
        const total = Number(r.member_count)
        const paid = Number(r.paid_count)
        const pending = total - paid
        const done = pending <= 0
        return (
          <div key={`${r.family_group_id}:${r.trip_id}`} className="mlk-card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  <Icon name="user" size={16} /> عائلة {r.head_name || '—'}
                </div>
                {!trip && <div className="muted" style={{ fontSize: '0.85em' }}>{r.trip_title}</div>}
              </div>
              <span className={`badge ${done ? 'ok' : 'warn'}`}>
                {done ? 'مؤكد' : `معلق · ${pending}/${total}`}
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: '0.9em' }}>
              <div>عدد الأفراد: <b>{total}</b></div>
              <div>المؤكد: <b>{paid}</b></div>
              <div>رقم طلب المتجر: <b dir="ltr">{r.order_no || '—'}</b></div>
            </div>

            {r.receipt_url ? (
              <div style={{ marginTop: 8 }}>
                <div className="muted" style={{ fontSize: '0.85em', marginBottom: 4 }}>الإيصال الجماعي:</div>
                <SignedImage bucket="payment-proofs" path={r.receipt_url} maxHeight={180} showOpenFull />
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 8, fontSize: '0.85em' }}>لا إيصال مرفق بعد.</div>
            )}

            {!done && (
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn btn-em btn-sm"
                  disabled={busyId === r.family_group_id}
                  onClick={() => verify(r)}
                >
                  <Icon name="check" size={16} /> تحقق وأكد دفع العائلة ({pending})
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
