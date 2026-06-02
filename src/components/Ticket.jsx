import { useEffect, useState } from 'react'
import CompassMark from './CompassMark'
import Icon from './Icon'
import { busName } from '../lib/buses'

function fmt(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return '—' }
}
function fmtTime(v) {
  if (!v) return ''
  try { return new Date(v).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

const STATUS_AR = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد الحافلة', checked_in: 'استلم الغرفة' }

/**
 * تذكرة صعود المعتمر — بطاقةٌ بالباركود (QR) قابلةٌ للتنزيل والطباعة.
 * تُحمّل مكتبة qrcode ديناميكيًّا؛ إن غابت تعرض الرمز نصيًّا (تدهورٌ لطيف).
 */
export default function Ticket({ passenger, trip, sub, buses = [], onClose }) {
  const [qrUrl, setQrUrl] = useState('')
  const [qrFailed, setQrFailed] = useState(false)
  const code = passenger?.ticket_code || passenger?.id || ''
  // اسم باص المعتمر عند تعدّد الباصات؛ وإلّا اسم باص الرحلة (السلوك السابق)
  const ticketBus = buses.find((b) => b.id === passenger?.bus_id)
  const busLabel = (ticketBus && busName(ticketBus)) || trip?.bus_label || '—'

  useEffect(() => {
    if (!code) return
    let cancelled = false
    ;(async () => {
      try {
        const QR = (await import('qrcode')).default
        const url = await QR.toDataURL(code, { width: 520, margin: 2, color: { dark: '#063d2c', light: '#ffffff' } })
        if (!cancelled) setQrUrl(url)
      } catch (_) {
        if (!cancelled) setQrFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [code])

  function downloadPng() {
    if (!qrUrl) return
    const a = document.createElement('a')
    a.href = qrUrl
    a.download = `تذكرة-${(passenger?.full_name || 'معتمر').replace(/\s+/g, '_')}.png`
    a.click()
  }

  const boarded = passenger?.status === 'boarded' || passenger?.status === 'checked_in'

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <Icon name="arrowRight" size={16} /> رجوع
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={downloadPng} disabled={!qrUrl}>
          <Icon name="download" size={16} /> حفظ كصورة
        </button>
        <button className="btn btn-gold btn-sm" onClick={() => window.print()}>
          <Icon name="qr" size={16} /> طباعة
        </button>
      </div>

      <div className="manifest-scroll">
        <div className="ticket" dir="rtl">
          <div className="ticket-top">
            <div className="tk-brand">
              <CompassMark size={34} variant="gold" />
              <div>
                <div className="tk-org">{sub?.org_name || 'ملبّيك'}</div>
                <div className="tk-kind">تذكرة صعود · عُمرة</div>
              </div>
            </div>
            <span className={`st ${boarded ? 'ok' : 'muted'}`}>{STATUS_AR[passenger?.status] || 'مسجّل'}</span>
          </div>

          <div className="tk-name">{passenger?.full_name || '—'}</div>

          <div className="tk-grid">
            <div><span className="k">الرحلة</span><span className="v">{trip?.title || '—'}</span></div>
            <div><span className="k">المسار</span><span className="v">{(trip?.route_from || '—') + ' ← ' + (trip?.route_to || '—')}</span></div>
            <div><span className="k">تاريخ الذهاب</span><span className="v">{fmt(trip?.depart_at)}</span></div>
            <div><span className="k">المقعد</span><span className="v big">{passenger?.seat_no || '—'}</span></div>
            <div><span className="k">مكان الركوب</span><span className="v">{passenger?.boarding_point || trip?.boarding_point || '—'}</span></div>
            <div><span className="k">الباص</span><span className="v">{busLabel}</span></div>
          </div>

          <div className="tk-qr">
            {qrUrl ? (
              <img src={qrUrl} alt="باركود التذكرة" width={180} height={180} />
            ) : qrFailed ? (
              <div className="tk-qr-fallback">رمز التذكرة</div>
            ) : (
              <div className="tk-qr-fallback">…</div>
            )}
            <div className="tk-code">{code}</div>
          </div>

          <div className="tk-foot">
            {passenger?.boarded_at
              ? `تم الصعود ${fmt(passenger.boarded_at)} ${fmtTime(passenger.boarded_at)}`
              : 'يُرجى إظهار هذه التذكرة عند الصعود — تُمسح بالباركود.'}
          </div>
        </div>
      </div>
    </div>
  )
}
