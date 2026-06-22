import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { translateRpcError } from '../lib/rpcErrors'
import { useUI } from '../lib/useUI'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import RatingStars from './RatingStars'

const COPY = {
  customer_to_subscriber: {
    title: 'قيم الحملة',
    lead: 'كيف كانت تجربتك مع الحملة في هذه الرحلة؟ تقييمك يساعد بقية المعتمرين.',
    placeholder: 'اكتب رأيك في التنظيم، والخدمة، والالتزام بالمواعيد… (اختياري)',
    saved: 'شكرا — سجل تقييمك ✓',
  },
  subscriber_to_customer: {
    title: 'تقييم المعتمر',
    lead: 'قيم التزام المعتمر وتعامله في هذه الرحلة. هذا التقييم خاص بحملتك — لا يراه المعتمر.',
    placeholder: 'ملاحظة داخلية: الالتزام بالمواعيد، التعاون، الدفع… (اختياري)',
    saved: 'حفظ تقييم المعتمر ✓',
  },
}

/**
 * ورقة التقاط تقييم باتجاه واحد (يصلح للطرفين).
 * @param {boolean}  open
 * @param {'customer_to_subscriber'|'subscriber_to_customer'} direction
 * @param {string}   subscriberId
 * @param {string}   tripId
 * @param {string}   profileId     حساب المعتمر (المقيم أو المقيم)
 * @param {string}  [passengerId]  سجل الراكب (للاتجاه subscriber_to_customer)
 * @param {string}  [contextName]  اسم الحملة أو المعتمر (يعرض كسياق)
 * @param {Function} onClose
 * @param {Function} [onSaved]
 */
export default function RatingSheet({ open, direction, subscriberId, tripId, profileId, passengerId, contextName, onClose, onSaved }) {
  const { toast } = useUI()
  const copy = COPY[direction] || COPY.customer_to_subscriber
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [existingId, setExistingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // حمل تقييما سابقا (إن وجد) للتعديل
  useEffect(() => {
    if (!open || !tripId || !profileId) return
    let cancel = false
    setLoading(true); setErr('')
    ;(async () => {
      const { data, error } = await supabase
        .from('ratings')
        .select('id, stars, comment')
        .eq('trip_id', tripId).eq('profile_id', profileId).eq('direction', direction)
        .maybeSingle()
      if (cancel) return
      if (error) { setErr(translateRpcError(error, 'تعذر تحميل التقييم.')) }
      else if (data) { setExistingId(data.id); setStars(data.stars || 0); setComment(data.comment || '') }
      else { setExistingId(null); setStars(0); setComment('') }
      setLoading(false)
    })()
    return () => { cancel = true }
  }, [open, tripId, profileId, direction])

  async function save() {
    if (busy) return
    if (!stars) { setErr('اختر عدد النجوم أولا.'); return }
    setErr(''); setBusy(true)
    const payload = {
      subscriber_id: subscriberId,
      trip_id: tripId,
      profile_id: profileId,
      passenger_id: passengerId || null,
      direction,
      stars,
      comment: comment.trim() || null,
    }
    try {
      let result
      if (existingId) {
        result = await supabase.from('ratings')
          .update({ stars: payload.stars, comment: payload.comment, passenger_id: payload.passenger_id })
          .eq('id', existingId)
      } else {
        result = await supabase.from('ratings').insert(payload)
      }
      if (result.error) {
        // سباق نادر: أدرج تقييم بالتوازي — أعد المحاولة كتحديث
        if (result.error.code === '23505') {
          const { data: ex } = await supabase.from('ratings').select('id')
            .eq('trip_id', tripId).eq('profile_id', profileId).eq('direction', direction).maybeSingle()
          if (ex?.id) await supabase.from('ratings').update({ stars: payload.stars, comment: payload.comment }).eq('id', ex.id)
        } else {
          throw result.error
        }
      }
      toast(copy.saved, { type: 'success' })
      onSaved?.({ stars, comment: payload.comment })
      onClose?.()
    } catch (e) {
      setErr(translateRpcError(e, 'تعذر حفظ التقييم — حاول مجددا.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={copy.title}
      actions={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
          <button className="btn btn-gold" onClick={save} disabled={busy || loading}>
            {busy ? <span className="spinner" /> : <><Icon name="check" size={16} /> {existingId ? 'تحديث التقييم' : 'إرسال التقييم'}</>}
          </button>
        </>
      }
    >
      <div className="form" style={{ marginTop: 0 }}>
        {contextName && (
          <div className="rating-context">
            <Icon name={direction === 'customer_to_subscriber' ? 'building' : 'user'} size={16} />
            <strong>{contextName}</strong>
          </div>
        )}
        <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{copy.lead}</p>

        {err && <div className="alert err" style={{ margin: '8px 0' }}>{err}</div>}

        <div className="rating-pick">
          <RatingStars value={stars} onChange={setStars} size={38} />
          <span className="rating-pick-label">{stars ? `${stars} من ٥` : 'لم تقيم بعد'}</span>
        </div>

        <div className="field">
          <label>تعليق <span className="muted" style={{ fontSize: 12 }}>(اختياري)</span></label>
          <textarea
            placeholder={copy.placeholder}
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </div>
    </BottomSheet>
  )
}
