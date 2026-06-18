import { useEffect, useState, useRef } from 'react'

/**
 * بوصلةٌ حيّةٌ تستجيب لحركة الجوّال وتشير إلى **قبلة المسجد الحرام** من
 * موقع المستخدم. تستخدم DeviceOrientationEvent + Geolocation API.
 *
 * تجربة المستخدم:
 *  - iOS 13+ يتطلّب نقرة تأذنُ للوصول للحركة (requestPermission).
 *  - Android/الإصدارات القديمة: تعمل تلقائيًّا.
 *  - في غياب الاستشعار (سطح المكتب)، تعرض الإبرة ساكنةً ورسالةً واضحة.
 */
export default function QiblaCompass() {
  const [heading, setHeading] = useState(null)   // اتجاهُ الجوّال (0-360°)
  const [qiblaDeg, setQiblaDeg] = useState(null) // الزاوية المطلوبة للقبلة من الشمال
  const [stage, setStage] = useState('idle')     // idle | asking | active | denied | unsupported
  const [error, setError] = useState('')
  const lastUpdate = useRef(0)

  // ١) إحداثيّاتُ الكعبة المشرّفة
  const KAABA_LAT = 21.422487
  const KAABA_LON = 39.826206

  // حسابُ زاوية القبلة من موقع المستخدم — صيغة spherical
  function calcQiblaBearing(lat, lon) {
    const toRad = (d) => (d * Math.PI) / 180
    const toDeg = (r) => (r * 180) / Math.PI
    const φ1 = toRad(lat)
    const φ2 = toRad(KAABA_LAT)
    const Δλ = toRad(KAABA_LON - lon)
    const y = Math.sin(Δλ) * Math.cos(φ2)
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
    return (toDeg(Math.atan2(y, x)) + 360) % 360
  }

  // ٢) معالجُ بياناتِ التوجّه — يدعم iOS (webkitCompassHeading) وAndroid (alpha)
  function onOrientation(e) {
    const now = performance.now()
    if (now - lastUpdate.current < 50) return   // ٢٠ تحديثًا/ث كحدٍّ أقصى
    lastUpdate.current = now

    let h = null
    if (typeof e.webkitCompassHeading === 'number') {
      h = e.webkitCompassHeading
    } else if (typeof e.alpha === 'number') {
      // alpha من Android: 0° عند الشمال، يدور عكس عقارب الساعة.
      // نعكسها لتطابق منطق الـ heading القياسيّ (0° شمال، يدور مع عقارب الساعة).
      h = 360 - e.alpha
    }
    if (h !== null) setHeading(((h % 360) + 360) % 360)
  }

  // ٣) التهيئة — طلبُ الموقع + الاستماع للحركة
  async function activate() {
    setStage('asking'); setError('')
    try {
      // الموقع — لحساب زاوية القبلة
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('no-geo'))
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000,
        })
      })
      setQiblaDeg(calcQiblaBearing(pos.coords.latitude, pos.coords.longitude))
    } catch (e) {
      // بدون موقع — نعرض اتجاهًا تقريبيًّا (افتراضيًّا للسعوديّة الوسطى)
      setQiblaDeg(calcQiblaBearing(24.7136, 46.6753))  // الرياض كبديل
    }

    // إذنُ الحركة (iOS 13+)
    const DOE = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission()
        if (result !== 'granted') { setStage('denied'); return }
      } catch {
        setStage('denied'); return
      }
    }

    // الاستماع للأحداث
    const evtName = 'ondeviceorientationabsolute' in window
      ? 'deviceorientationabsolute'
      : 'deviceorientation'
    window.addEventListener(evtName, onOrientation, true)
    setStage('active')
  }

  // ٤) كشفٌ مسبقٌ — إن لم تدعم البيئة التوجّه، نعرض حالة unsupported
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof DeviceOrientationEvent === 'undefined' && !('ondeviceorientation' in window)) {
      setStage('unsupported')
    }
    return () => {
      window.removeEventListener('deviceorientation', onOrientation, true)
      window.removeEventListener('deviceorientationabsolute', onOrientation, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ٥) الفرقُ بين توجّه الجوّال وزاوية القبلة — كم درجةً يحتاج المستخدم أن يدور
  const delta = (heading !== null && qiblaDeg !== null)
    ? ((qiblaDeg - heading + 540) % 360) - 180   // -180 إلى +180
    : null
  const aligned = delta !== null && Math.abs(delta) < 5
  const dirText = delta === null ? null
    : aligned ? 'محاذٍ للقبلة'
    : delta > 0 ? `لُف ${Math.round(delta)}° يمينًا`
    : `لُف ${Math.round(-delta)}° يسارًا`

  return (
    <div className={`qibla ${aligned ? 'aligned' : ''}`}>
      <div className="qibla-shell">
        {/* قرصُ البوصلة — يدور عكس الـ heading فتثبت العلامات على الشمال الحقيقيّ */}
        <div
          className="qibla-dial"
          style={{ transform: heading !== null ? `rotate(${-heading}deg)` : 'none' }}
        >
          {/* علاماتُ الجهات الأربع */}
          <span className="qibla-mark n" aria-hidden="true">ش</span>
          <span className="qibla-mark e" aria-hidden="true">ش</span>
          <span className="qibla-mark s" aria-hidden="true">ج</span>
          <span className="qibla-mark w" aria-hidden="true">غ</span>

          {/* تدرّجات ٣٦٠° (أربعةٌ كلّ ٩٠°) */}
          {[...Array(36)].map((_, i) => (
            <span
              key={i}
              className={`qibla-tick ${i % 9 === 0 ? 'big' : ''}`}
              style={{ transform: `rotate(${i * 10}deg) translateY(-46%)` }}
            />
          ))}

          {/* رمزُ الكعبة بزاوية القبلة على القرص */}
          {qiblaDeg !== null && (
            <span className="qibla-kaaba" style={{ transform: `rotate(${qiblaDeg}deg) translateY(-42%) rotate(${-qiblaDeg}deg)` }}>
              <span className="qibla-kaaba-box" />
            </span>
          )}
        </div>

        {/* الإبرة الثابتة في المنتصف — تشير دائمًا للأعلى */}
        <div className="qibla-needle" aria-hidden="true">
          <span className="qibla-needle-top" />
          <span className="qibla-needle-bottom" />
          <span className="qibla-pin" />
        </div>
      </div>

      {/* الحالة + التعليمات */}
      <div className="qibla-state">
        {stage === 'idle' && (
          <button type="button" className="btn btn-em btn-sm qibla-cta" onClick={activate}>
            ابدأ البوصلة
          </button>
        )}
        {stage === 'asking' && (
          <span className="qibla-hint"><span className="spinner" /> جاري التحضير…</span>
        )}
        {stage === 'denied' && (
          <span className="qibla-hint warn">
            تعذّر الإذن — فعّل «الحركة والاتجاه» من إعدادات Safari ثمّ اضغط مرّةً أخرى.
            <button type="button" className="btn btn-ghost btn-sm" onClick={activate} style={{ marginTop: 8 }}>إعادة المحاولة</button>
          </span>
        )}
        {stage === 'unsupported' && (
          <span className="qibla-hint">بوصلتك تحتاج جوّالًا — افتح ملبّيك على هاتفك للتجربة الكاملة.</span>
        )}
        {stage === 'active' && dirText && (
          <span className={`qibla-hint ${aligned ? 'ok' : ''}`}>{dirText}</span>
        )}
      </div>
    </div>
  )
}
