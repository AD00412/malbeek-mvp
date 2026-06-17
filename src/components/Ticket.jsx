import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { busName } from '../lib/buses'
import { elementToPngBlob } from '../lib/pdf'
import { downloadICS } from '../lib/ics'
import { useUI } from '../lib/useUI'
import StatusTimeline from './StatusTimeline'

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
  const { toast } = useUI()
  const ticketRef = useRef(null)
  const [qrUrl, setQrUrl] = useState('')
  const [qrFailed, setQrFailed] = useState(false)
  const [busy, setBusy] = useState('')   // '' | 'save' | 'share'
  const canShare = typeof navigator !== 'undefined' && !!navigator.share
  const code = passenger?.ticket_code || passenger?.id || ''
  const fileBase = `تذكرة-${(passenger?.full_name || 'معتمر').replace(/\s+/g, '_')}`
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

  // يلتقط بطاقة التذكرة كاملةً (لا الباركود وحده) صورةً عالية الدقّة.
  async function captureBlob() {
    if (!ticketRef.current) throw new Error('no_ticket')
    return await elementToPngBlob(ticketRef.current, { backgroundColor: '#ffffff', scale: 2.5 })
  }

  // حفظ التذكرة كاملةً كصورة (تذهب لمعرض الصور/الملفّات).
  async function saveImage() {
    if (busy) return
    setBusy('save')
    try {
      const blob = await captureBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fileBase + '.png'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast('تم حفظ التذكرة كصورة ✓', { type: 'success' })
    } catch (e) {
      // تدهورٌ لطيف: نزّل الباركود على الأقلّ إن تعذّر التقاط البطاقة
      if (qrUrl) { const a = document.createElement('a'); a.href = qrUrl; a.download = fileBase + '.png'; a.click() }
      else toast('تعذّر حفظ الصورة — جرّب «طباعة» أو لقطة شاشة.', { type: 'error' })
    } finally { setBusy('') }
  }

  // مشا_ركة عبر قائمة الجوال: حفظ بالصور/الملفّات/تطبيقات المحفظة الرقميّة.
  async function shareTicket() {
    if (busy) return
    setBusy('share')
    try {
      const blob = await captureBlob()
      const file = new File([blob], fileBase + '.png', { type: 'image/png' })
      const data = { files: [file], title: 'تذكرة العمرة', text: `تذكرتي في «${trip?.title || 'رحلة عمرة'}» — ${sub?.org_name || 'الحملة'}` }
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share(data)
      } else if (navigator.share) {
        await navigator.share({ title: data.title, text: data.text })
      } else {
        await saveImage(); return
      }
    } catch (e) {
      if (e?.name !== 'AbortError') toast('تعذّرت المشاركة — استخدم «حفظ كصورة».', { type: 'error' })
    } finally { setBusy('') }
  }

  // إضافة موعد الرحلة إلى تقويم الجوال.
  function addToCalendar() {
    const ok = downloadICS({
      uid: code,
      start: trip?.depart_at,
      durationMin: 180,
      title: `رحلة عمرة — ${trip?.title || ''}`.trim(),
      location: passenger?.boarding_point || trip?.boarding_point || trip?.route_from || '',
      description: `مقعد ${passenger?.seat_no || '—'} · ${busLabel} · ${sub?.org_name || 'الحملة'} · رمز التذكرة ${code}`,
    }, fileBase)
    if (ok) toast('أُضيف موعد الرحلة — افتحه في التقويم', { type: 'success' })
    else toast('تعذّرت إضافة الموعد (تاريخ الرحلة غير محدّد).', { type: 'info' })
  }

  const boarded = passenger?.status === 'boarded' || passenger?.status === 'checked_in'

  return (
    <div className="manifest-overlay">
      <div className="manifest-toolbar no-print" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <Icon name="arrowRight" size={16} /> رجوع
        </button>
        <span style={{ flex: 1 }} />
        {canShare && (
          <button className="btn btn-gold btn-sm" onClick={shareTicket} disabled={!!busy}>
            {busy === 'share' ? <span className="spinner" /> : <><Icon name="share" size={16} /> مشاركة / حفظ</>}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={saveImage} disabled={!!busy}>
          {busy === 'save' ? <span className="spinner" /> : <><Icon name="download" size={16} /> حفظ كصورة</>}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={addToCalendar}>
          <Icon name="calendar" size={16} /> تقويم
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
          <Icon name="manifest" size={16} /> طباعة
        </button>
      </div>

      <div className="manifest-scroll">
        <div className="ticket" dir="rtl" ref={ticketRef}>
          <div className="ticket-top">
            <div className="tk-brand">
              {sub?.logo_url
                ? <img className="tk-logo" src={sub.logo_url} alt={sub?.org_name || 'الحملة'} crossOrigin="anonymous" />
                : null}
              <div>
                <div className="tk-org">{sub?.org_name || 'الحملة'}</div>
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

          <div style={{ margin: '4px 4px 2px' }}>
            <StatusTimeline status={passenger?.status} light />
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
