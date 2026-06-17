import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'

const STATUS_AR = { registered: 'مسجّل', paid: 'مدفوع', boarded: 'صعد الحافلة', checked_in: 'استلم الغرفة' }

/**
 * مسحٌ حيٌّ بالكاميرا لتحضير الصعود/التسكين — يعتمد على واجهة المتصفّح
 * الأصلية BarcodeDetector (بلا أي مكتبةٍ خارجية). عند عدم الدعم أو تعذّر
 * الكاميرا، يُتاح الإدخال اليدوي لرمز التذكرة.
 *
 * @param {object} trip
 * @param {string} mode    'board' | 'checkin'
 * @param {Function} onClose
 * @param {Function} onUpdated
 */
export default function Scanner({ trip, mode = 'board', onClose, onUpdated }) {
  const videoRef = useRef(null)
  const lastScanRef = useRef({ code: '', at: 0 })
  const busyRef = useRef(false)            // تزامنٌ بلا إعادة بناء handleCode

  const [camError, setCamError] = useState('')
  const [starting, setStarting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [manual, setManual] = useState('')

  const targetStatus = mode === 'checkin' ? 'checked_in' : 'boarded'
  const targetLabel = mode === 'checkin' ? 'استلام الغرفة' : 'صعود الحافلة'

  const handleCode = useCallback(async (rawCode) => {
    const code = (rawCode || '').trim()
    if (!code || busyRef.current) return
    const now = Date.now()
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < 3000) return

    // نقبل فقط رمز تذكرةٍ (TKT-) أو UUID صالحًا — يمنع خطأ نوعٍ عند مسح باركودٍ عشوائي
    const isTicket = code.startsWith('TKT-')
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)
    if (!isTicket && !isUuid) { setResult({ ok: false, msg: 'هذا ليس باركود تذكرةٍ صالح.' }); return }

    busyRef.current = true; setBusy(true)
    try {
      let q = supabase.from('passengers')
        .select('id, full_name, seat_no, boarding_point, status, trip_id, ticket_code, national_id')
      q = isTicket ? q.eq('ticket_code', code) : q.eq('id', code)
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

      lastScanRef.current = { code, at: Date.now() }   // ثبّت الكبح بعد النجاح فقط
      if (navigator.vibrate) navigator.vibrate(120)
      setResult({ ok: true, msg: `تم تسجيل ${targetLabel}`, passenger: { ...data, ...patch } })
      onUpdated?.()
    } catch (e) {
      setResult({ ok: false, msg: e?.message ? 'تعذّر التحديث: ' + e.message : 'تعذّر قراءة التذكرة.' })
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }, [mode, targetStatus, targetLabel, trip, onUpdated])

  // مرجعٌ حيٌّ لأحدث handleCode — يبقي effect الكاميرا مستقرًّا (deps فارغة)
  // فلا تُعاد تهيئة الكاميرا مع كلّ مسحٍ ناجح.
  const handlerRef = useRef(handleCode)
  useEffect(() => { handlerRef.current = handleCode }, [handleCode])

  /* تشغيل الكاميرا + كشف الباركود عبر BarcodeDetector الأصلية (مرّةً واحدة) */
  useEffect(() => {
    let stopped = false
    let stream = null
    let timer = null

    if (!('BarcodeDetector' in window)) {
      setCamError('المسح المباشر غير مدعومٍ في هذا المتصفّح — استخدم الإدخال اليدوي بالأسفل (يعمل على Chrome/Android).')
      return
    }

    ;(async () => {
      try {
        // بعض المتصفّحات تعرّف BarcodeDetector دون دعم qr_code — تحقّق قبل البدء
        try {
          const fmts = await window.BarcodeDetector.getSupportedFormats?.()
          if (fmts && !fmts.includes('qr_code')) {
            setCamError('المسح المباشر لا يدعم رمز QR في هذا المتصفّح — استخدم الإدخال اليدوي بالأسفل.')
            return
          }
        } catch (_) { /* لا getSupportedFormats — نُكمل ونعتمد على catch أدناه */ }
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
        if (stopped || !videoRef.current) { stream.getTracks().forEach((t) => t.stop()); stream = null; return }
        const v = videoRef.current
        v.srcObject = stream
        await v.play().catch(() => {})
        if (!stopped) setStarting(false)

        timer = setInterval(async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes && codes.length) handlerRef.current(codes[0].rawValue)
          } catch (_) { /* تجاهل إطارًا فاشلًا */ }
        }, 280)
      } catch (e) {
        const m = String(e?.name || e?.message || e).toLowerCase()
        if (m.includes('notallowed') || m.includes('permission') || m.includes('denied')) {
          setCamError('تعذّر الوصول للكاميرا — اسمح بالإذن أو استخدم الإدخال اليدوي بالأسفل.')
        } else if (m.includes('notfound') || m.includes('no camera') || m.includes('devicesnotfound')) {
          setCamError('لا توجد كاميرا متاحة — استخدم الإدخال اليدوي بالأسفل.')
        } else if (m.includes('secure') || m.includes('https')) {
          setCamError('الكاميرا تتطلّب اتصالًا آمنًا (HTTPS أو localhost) — استخدم الإدخال اليدوي.')
        } else {
          setCamError('تعذّر تشغيل الكاميرا — استخدم الإدخال اليدوي بالأسفل.')
        }
      }
    })()

    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      try { stream?.getTracks().forEach((t) => t.stop()) } catch (_) {}
    }
  }, [])

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
            {starting ? (
              <div className="scanner-hint" role="status"><span className="spinner" /> جارٍ تشغيل الكاميرا…</div>
            ) : (
              <div className="scanner-hint">وجّه الكاميرا نحو باركود التذكرة</div>
            )}
          </>
        )}
      </div>

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

      {result && (
        <div className={`scan-result ${result.ok ? 'ok' : 'err'}`} role="status" aria-live="polite">
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
