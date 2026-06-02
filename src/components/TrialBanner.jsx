import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import Icon from './Icon'

function daysLeft(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

/**
 * شريط الباقة التجريبية: عدّاد الأيام + طلب ترقيةٍ بضغطة (يصل لإدارة ملبّيك).
 * يختفي للباقة المدفوعة.
 */
export default function TrialBanner({ sub }) {
  const { user, subscriberId } = useAuth()
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!sub || sub.plan === 'paid') return null
  const left = daysLeft(sub.trial_ends_at)
  const expired = left != null && left <= 0

  async function requestUpgrade() {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('feedback').insert({
        profile_id: user.id,
        subscriber_id: subscriberId || sub.id,
        audience: 'subscriber',
        kind: 'feature',
        subject: 'طلب ترقية إلى باقة ملبّيك',
        body: `يطلب المشترك «${sub.org_name || ''}» الترقية إلى الباقة المدفوعة (٢٤٩ ﷼).`,
      })
      if (error) throw error
      setSent(true)
    } catch (e) {
      setErr(e?.message ? 'تعذّر الإرسال: ' + e.message : 'تعذّر إرسال الطلب.')
    } finally { setBusy(false) }
  }

  return (
    <div className={`trial-banner ${expired ? 'expired' : ''}`}>
      <span className="tb-ic"><Icon name="sparkle" size={20} /></span>
      <div className="tb-main">
        <div className="tb-title">
          {expired ? 'انتهت الباقة التجريبية' : `الباقة التجريبية — ${left} ${left === 1 ? 'يوم متبقٍّ' : 'يومًا متبقيًا'}`}
        </div>
        <div className="tb-sub">باقة ملبّيك: رحلاتٌ غير محدودة، كشوفٌ، وباركود — <strong>٢٤٩ ﷼</strong></div>
        {err && <div className="tb-sub" style={{ color: 'var(--danger-ink)' }}>{err}</div>}
      </div>
      {sent ? (
        <span className="tag ok"><Icon name="check" size={14} /> وصل طلبك</span>
      ) : (
        <button className="btn btn-gold btn-sm" onClick={requestUpgrade} disabled={busy}>
          {busy ? <span className="spinner" /> : 'ترقية الباقة'}
        </button>
      )}
    </div>
  )
}
