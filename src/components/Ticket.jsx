import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import CompassMark from './CompassMark'
import Icon from './Icon'

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
 * QR يحمل ticket_code ليُمسح عند الصعود.
 *
 * @param {object} passenger
 * @param {object} trip
 * @param {object} sub
 * @param {Function} onClose
 */
export default function Ticket({ passenger, trip, sub, onClose }) {
  const canvasRef = useRef(null)
  const [dataUrl, setDataUrl] = useState('')
  const code = passenger?.ticket_code || passenger?.id || ''

  useEffect(() => {
    if (!code) return
    QRCode.toCanvas(canvasRef.current, code, { width: 200, margin: 1,
      color: { dark: '#063d2c', light: '#ffffff' } }, () => {})
    QRCode.toDataURL(code, { width: 520, margin: 2, color: { dark: '#063d2c', light: '#ffffff' } })
      .then(setDataUrl).catch(() => {})
  }, [code])

  function downloadPng() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `tذكرة-${(passenger?.full_name || 'معتمر').replace(/\s+/g, '_')}.png`
    a.click()
  }

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <Icon name="arrowRight" size={16} /> رجوع
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={downloadPng} disabled={!dataUrl}>
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
            <span className={`st ${passenger?.status === 'boarded' || passenger?.status === 'checked_in' ? 'ok' : 'muted'}`}>
              {STATUS_AR[passenger?.status] || 'مسجّل'}
            </span>
          </div>

          <div className="tk-name">{passenger?.full_name || '—'}</div>

          <div className="tk-grid">
            <div><span className="k">الرحلة</span><span className="v">{trip?.title || '—'}</span></div>
            <div><span className="k">المسار</span><span className="v">{(trip?.route_from || '—') + ' ← ' + (trip?.route_to || '—')}</span></div>
            <div><span className="k">تاريخ الذهاب</span><span className="v">{fmt(trip?.depart_at)}</span></div>
            <div><span className="k">المقعد</span><span className="v big">{passenger?.seat_no || '—'}</span></div>
            <div><span className="k">مكان الركوب</span><span className="v">{passenger?.boarding_point || trip?.boarding_point || '—'}</span></div>
            <div><span className="k">الباص</span><span className="v">{trip?.bus_label || '—'}</span></div>
          </div>

          <div className="tk-qr">
            <canvas ref={canvasRef} />
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
