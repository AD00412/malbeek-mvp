import { useState } from 'react'
import Icon from './Icon'
import UpgradeSheet from './UpgradeSheet'

function daysLeft(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

/**
 * شريط الباقة التجريبية: عدّاد الأيام + زرّ الترقية يَفتح UpgradeSheet
 * (تَدفُّق دفعٍ كاملٌ بإثبات بنكيٍّ ومراجعةٍ إداريّة).
 * يَختفي للباقة المدفوعة.
 */
export default function TrialBanner({ sub, tripsCount = 0 }) {
  const [open, setOpen] = useState(false)

  if (!sub || sub.plan === 'paid') return null
  const left = daysLeft(sub.trial_ends_at)
  const expired = left != null && left <= 0
  const tripLimit = sub.trial_trip_limit ?? 1
  const atLimit = tripsCount >= tripLimit

  return (
    <>
      <div className={`trial-banner ${expired ? 'expired' : ''}`}>
        <span className="tb-ic"><Icon name="sparkle" size={20} /></span>
        <div className="tb-main">
          <div className="tb-title">
            {expired ? 'انتهت الباقة التجريبية' : `الباقة التجريبية — ${left} ${left === 1 ? 'يوم متبقٍّ' : 'يومًا متبقيًا'}`}
          </div>
          <div className="tb-sub">
            باقة ملبّيك: رحلاتٌ غير محدودة، كشوفٌ، وباركود — <strong>٩٩ ﷼/شهر</strong>
            <span style={{ display: 'block', marginTop: 3, color: atLimit ? 'var(--danger-ink)' : 'inherit', fontWeight: atLimit ? 700 : 400 }}>
              رحلاتُك التجريبيّة: {tripsCount} / {tripLimit}{atLimit ? ' — بلغتَ الحدّ، رقِّ لإضافة المزيد' : ''}
            </span>
          </div>
        </div>
        <button className="btn btn-gold btn-sm" onClick={() => setOpen(true)}>
          ترقية الباقة
        </button>
      </div>
      <UpgradeSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
