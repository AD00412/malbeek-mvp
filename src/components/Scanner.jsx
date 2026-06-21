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

      // ★ مرحلتان متسلسلتان (صعود → تسكين) برمزٍ واحد:
      //   التسكين يتطلّب صعودًا سابقًا، ومنعُ التكرار والتخطّي.
      if (mode === 'checkin' && data.status !== 'boarded' && data.status !== 'checked_in') {
        setResult({ ok: false, msg: `لم يُسجَّل صعودُه بعد — امسح «صعود الحافلة» أوّلًا · ${data.full_name}`, passenger: data })
        return
      }
      // مُسجَّلٌ مسبقًا في نفس المرحلة → تأكيدٌ لطيفٌ بلا تحديثٍ مكرّر
      if (data.status === targetStatus) {
        lastScanRef.current = { code, at: Date.now() }
        setResult({ ok: true, msg: `${targetLabel}: مُسجَّلٌ مسبقًا · ${data.full_name}`, passenger: data })
        return
      }
      // في وضع الصعود: مَن سُكّن فقد صعد قطعًا — لا تُرجِعه للخلف
      if (mode === 'board' && data.status === 'checked_in') {
        lastScanRef.current = { code, at: Date.now() }
        setResult({ ok: true, msg: `سبق صعودُه وتسكينُه · ${data.full_name}`, passenger: data })
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

  /* تشغيل الكاميرا + كشف QR — يحاول BarcodeDetector الأصليّ أوّلًا (الأسرع على Chrome/Android)،
     ويتحوّل إلى jsQR + Canvas على iPhone Safari (يحلّ غياب BarcodeDetector).

     ★ إيقافٌ كاملٌ عند background ثمّ استئنافٌ تلقائيٌّ عند العودة:
       يحمي iOS من تجمّدٍ سببُه استمرارُ تيار الكاميرا بعد التعليق،
       ويُخفّض استهلاكَ البطاريّة عندَ التبديلِ السريعِ بين التطبيقات. */
  useEffect(() => {
    let stopped = false
    let stream = null
    let rafId = 0
    let timer = null
    let visListener = null

    function stopAll() {
      if (timer) { clearInterval(timer); timer = null }
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
      try { stream?.getTracks().forEach((t) => t.stop()) } catch (_) {}
      stream = null
      try { if (videoRef.current) videoRef.current.srcObject = null } catch (_) {}
    }

    async function startCamera() {
      if (stopped || stream) return
      try {
        // اطلب الكاميرا الخلفيّة (environment) — مهمٌّ على الجوال.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (stopped || !videoRef.current) { stream.getTracks().forEach((t) => t.stop()); stream = null; return }
        const v = videoRef.current
        v.srcObject = stream
        // iOS Safari: playsInline (مضبوطٌ في JSX) + tap → play.
        await v.play().catch(() => {})
        if (!stopped) setStarting(false)

        // الطريق ١: BarcodeDetector الأصليّ (Chrome/Edge/Android — سريعٌ ودقيق).
        let useNative = false
        if ('BarcodeDetector' in window) {
          try {
            const fmts = await window.BarcodeDetector.getSupportedFormats?.()
            if (!fmts || fmts.includes('qr_code')) useNative = true
          } catch (_) { useNative = true }
        }

        if (useNative) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
          timer = setInterval(async () => {
            if (stopped || document.visibilityState !== 'visible' || !videoRef.current) return
            try {
              const codes = await detector.detect(videoRef.current)
              if (codes && codes.length) handlerRef.current(codes[0].rawValue)
            } catch (_) { /* تجاهل إطارًا فاشلًا */ }
          }, 280)
          return
        }

        // الطريق ٢ (iPhone Safari + احتياط): jsQR على canvas مخفيّة.
        const { default: jsQR } = await import('jsqr')
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const SCAN_W = 480
        let lastTick = 0
        const TICK_MS = 250

        function tick(ts) {
          if (stopped) return
          rafId = requestAnimationFrame(tick)
          // وفّر الموارد عند backgrounding — لا حاجة لمسحٍ لإطارٍ غير مرئيّ
          if (document.visibilityState !== 'visible') return
          if (!videoRef.current || videoRef.current.readyState !== 4) return
          if (ts - lastTick < TICK_MS) return
          lastTick = ts
          const vw = videoRef.current.videoWidth
          const vh = videoRef.current.videoHeight
          if (!vw || !vh) return
          const ratio = SCAN_W / vw
          canvas.width = SCAN_W
          canvas.height = Math.max(120, Math.round(vh * ratio))
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (code && code.data) handlerRef.current(code.data)
        }
        rafId = requestAnimationFrame(tick)
      } catch (e) {
        const m = String(e?.name || e?.message || e).toLowerCase()
        if (m.includes('notallowed') || m.includes('permission') || m.includes('denied')) {
          setCamError('تعذّر الوصول للكاميرا — اسمح بالإذن من إعدادات المتصفّح ثمّ أعد المحاولة، أو استخدم الإدخال اليدويّ بالأسفل.')
        } else if (m.includes('notfound') || m.includes('no camera') || m.includes('devicesnotfound')) {
          setCamError('لا توجد كاميرا متاحة — استخدم الإدخال اليدويّ بالأسفل.')
        } else if (m.includes('secure') || m.includes('https')) {
          setCamError('الكاميرا تتطلّب اتصالًا آمنًا (HTTPS) — استخدم الإدخال اليدويّ.')
        } else {
          setCamError('تعذّر تشغيل الكاميرا — استخدم الإدخال اليدويّ بالأسفل.')
        }
      }
    }

    // إيقاف/استئنافٌ تلقائيٌّ مع تبديل الرؤية (يمنع التجمّد على iOS)
    visListener = () => {
      if (stopped) return
      if (document.visibilityState === 'visible') {
        if (!stream) { setStarting(true); startCamera() }
      } else {
        stopAll()
      }
    }
    document.addEventListener('visibilitychange', visListener)

    startCamera()

    return () => {
      stopped = true
      if (visListener) document.removeEventListener('visibilitychange', visListener)
      stopAll()
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
            <Icon name="qr" size={52} />
            <h3 className="sc-fb-title">تعذّر تشغيل الكاميرا</h3>
            <p className="sc-fb-msg">{camError}</p>
            <div className="sc-fb-howto" style={{ marginTop: 4 }}>
              <div className="sc-fb-row"><span className="sc-fb-num">١</span><span>اسمح للموقع بالوصول للكاميرا من إعدادات المتصفّح</span></div>
              <div className="sc-fb-row"><span className="sc-fb-num">٢</span><span>أو ألصق رمز التذكرة <code>TKT-XXXX</code> في الحقل بالأسفل ↓</span></div>
            </div>
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
