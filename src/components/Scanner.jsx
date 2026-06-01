import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'

const STATUS_AR = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد الحافلة', checked_in: 'استلم الغرفة' }

/**
 * مسحٌ حيٌّ بالكاميرا لتحضير الصعود/التسكين.
 * يقرأ ticket_code من الباركود، يجلب المعتمر ضمن هذه الرحلة (RLS يعزل)،
 * ويتيح تحديث حالته (صعد الحافلة / استلم الغرفة).
 *
 * @param {object} trip    الرحلة الحالية (للتقييد البصري)
 * @param {string} mode    'board' | 'checkin'
 * @param {Function} onClose
 * @param {Function} onUpdated  يُستدعى بعد تحديث ناجح لإعادة تحميل القائمة
 */
export default function Scanner({ trip, mode = 'board', onClose, onUpdated }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const readerRef = useRef(null)
  const lastScanRef = useRef({ code: '', at: 0 })

  const [camError, setCamError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // { ok, passenger?, msg }
  const [manual, setManual] = useState('')

  const targetStatus = mode === 'checkin' ? 'checked_in' : 'boarded'
  const targetLabel = mode === 'checkin' ? 'استلام الغرفة' : 'صعود الحافلة'

  /* معالجة رمزٍ ممسوح/مُدخل */
  const handleCode = useCallback(async (rawCode) => {
    const code = (rawCode || '').trim()
    if (!code || busy) return
    // كبح التكرار: نفس الرمز خلال ٣ ثوانٍ يُتجاهل
    const now = Date.now()
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < 3000) return
    lastScanRef.current = { code, at: now }

    setBusy(true)
    try {
      let q = supabase.from('passengers')
        .select('id, full_name, seat_no, boarding_point, status, trip_id, ticket_code, national_id')
      // يقبل رمز التذكرة أو معرّف الصف
      q = code.startsWith('TKT-') ? q.eq('ticket_code', code) : q.eq('id', code)
      const { data, error } = await q.maybeSingle()
      if (error) throw error
      if (!data) { setResult({ ok: false, msg: 'تذكرة غير معروفة أو لا تخصّ حملتك.' }); return }
      if (trip?.id && data.trip_id !== trip.id) {
        setResult({ ok: false, msg: `هذه التذكرة لرحلةٍ أخرى — ${data.full_name}.`, passenger: data })
        return
      }

      const patch = { status: targetStatus }
      if (mode === 'checkin') patch.checked_in_at = new Date().toISOString()
      else patch.boarded_at = new Date().toISOString()

      const { error: upErr } = await supabase.from('passengers').update(patch).eq('id', data.id)
      if (upErr) throw upErr

      if (navigator.vibrate) navigator.vibrate(120)
      setResult({ ok: true, msg: `تم تسجيل ${targetLabel}`, passenger: { ...data, ...patch } })
      onUpdated?.()
    } catch (e) {
      setResult({ ok: false, msg: e?.message ? 'تعذّر التحديث: ' + e.message : 'تعذّر قراءة التذكرة.' })
    } finally {
      setBusy(false)
    }
  }, [busy, mode, targetStatus, targetLabel, trip, onUpdated])

  /* تشغيل الكاميرا */
  useEffect(() => {
    let cancelled = false
    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader
    ;(async () => {
      try {
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (res) => {
          if (res) handleCode(res.getText())
        })
        if (cancelled) controls.stop()
        else controlsRef.current = controls
      } catch (e) {
        const m = String(e?.message || e).toLowerCase()
        if (m.includes('permission') || m.includes('denied') || m.includes('notallowed')) {
          setCamError('تعذّر الوصول للكاميرا — اسمح بالإذن أو استخدم الإدخال اليدوي بالأسفل.')
        } else if (m.includes('notfound') || m.includes('no camera') || m.includes('requested device')) {
          setCamError('لا توجد كاميرا متاحة — استخدم الإدخال اليدوي بالأسفل.')
        } else {
          setCamError('تعذّر تشغيل الكاميرا — استخدم الإدخال اليدوي بالأسفل.')
        }
      }
    })()
    return () => {
      cancelled = true
      try { controlsRef.current?.stop() } catch (_) {}
    }
  }, [handleCode])

  return (
    <div className="scanner-overlay">
      <div className="scanner-head">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <Icon name="arrowRight" size={16} /> إغلاق
        </button>
        <div className="sc-title">{targetLabel} — مسح حي</div>
        <span style={{ width: 60 }} />
      </div>

      <div className="scanner-stage">
        {camError ? (
          <div className="scanner-fallback">
            <Icon name="qr" size={48} />
            <p>{camError}</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="scanner-video" muted playsInline />
            <div className="scanner-frame"><span /><span /><span /><span /></div>
            <div className="scanner-hint">وجّه الكاميرا نحو باركود التذكرة</div>
          </>
        )}
      </div>

      {/* إدخال يدوي احتياطي */}
      <div className="scanner-manual">
        <div className="field ltr" style={{ flex: 1 }}>
          <input
            type="text"
            placeholder="أو أدخل رمز التذكرة يدويًّا: TKT-XXXX"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { handleCode(manual); setManual('') } }}
          />
        </div>
        <button className="btn btn-ghost" onClick={() => { handleCode(manual); setManual('') }} disabled={busy || !manual.trim()}>
          تحقّق
        </button>
      </div>

      {/* نتيجة آخر مسح */}
      {result && (
        <div className={`scan-result ${result.ok ? 'ok' : 'err'}`}>
          <Icon name={result.ok ? 'check' : 'bell'} size={20} />
          <div>
            <div className="sr-msg">{result.msg}</div>
            {result.passenger && (
              <div className="sr-pax">
                {result.passenger.full_name}
                {result.passenger.seat_no ? ` · مقعد ${result.passenger.seat_no}` : ''}
                {` · ${STATUS_AR[result.passenger.status] || ''}`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
