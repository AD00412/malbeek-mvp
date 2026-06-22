import { useEffect, useState, useRef } from 'react'

/**
 * بوصلةُ القبلة الحيّة — بمستوى تطبيق iOS الأصليّ.
 * تعرض:
 *  - اتجاه الجوّال بالدرجات مع الجهة (شمال/جنوب/شرق/غرب)
 *  - زاوية القبلة مع رمز الكعبة المتحرّك
 *  - إحداثيّات المستخدم (مع اسم الموقع التقريبيّ)
 *  - المسافة الفعليّة إلى المسجد الحرام
 *  - توهّج ذهبيّ + اهتزاز خفيف عند المحاذاة (±٥°)
 */
export default function QiblaCompass() {
  const [heading, setHeading] = useState(null)
  const [coords, setCoords] = useState(null)     // { lat, lon, accuracy }
  const [qiblaDeg, setQiblaDeg] = useState(null)
  const [distance, setDistance] = useState(null) // كم إلى الكعبة
  const [stage, setStage] = useState('idle')
  const lastUpdate = useRef(0)
  const lastHaptic = useRef(0)

  const KAABA_LAT = 21.422487
  const KAABA_LON = 39.826206

  function calcQiblaBearing(lat, lon) {
    const toRad = (d) => (d * Math.PI) / 180
    const toDeg = (r) => (r * 180) / Math.PI
    const φ1 = toRad(lat), φ2 = toRad(KAABA_LAT)
    const Δλ = toRad(KAABA_LON - lon)
    const y = Math.sin(Δλ) * Math.cos(φ2)
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
    return (toDeg(Math.atan2(y, x)) + 360) % 360
  }

  // Haversine — المسافة الفعليّة بين نقطتين على الكرة الأرضيّة
  function calcDistance(lat, lon) {
    const R = 6371   // نصف قطر الأرض بالكيلومتر
    const toRad = (d) => (d * Math.PI) / 180
    const dLat = toRad(KAABA_LAT - lat)
    const dLon = toRad(KAABA_LON - lon)
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat)) * Math.cos(toRad(KAABA_LAT)) * Math.sin(dLon / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  function onOrientation(e) {
    const now = performance.now()
    if (now - lastUpdate.current < 50) return
    lastUpdate.current = now
    let h = null
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading
    else if (typeof e.alpha === 'number') h = 360 - e.alpha
    if (h !== null) setHeading(((h % 360) + 360) % 360)
  }

  async function activate() {
    setStage('asking')
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('no-geo'))
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000,
        })
      })
      const { latitude, longitude, accuracy } = pos.coords
      setCoords({ lat: latitude, lon: longitude, accuracy })
      setQiblaDeg(calcQiblaBearing(latitude, longitude))
      setDistance(calcDistance(latitude, longitude))
    } catch {
      // فولباك: الرياض كمركزٍ افتراضيٍّ للسعوديّة
      setCoords({ lat: 24.7136, lon: 46.6753, accuracy: null })
      setQiblaDeg(calcQiblaBearing(24.7136, 46.6753))
      setDistance(calcDistance(24.7136, 46.6753))
    }

    const DOE = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission()
        if (result !== 'granted') { setStage('denied'); return }
      } catch { setStage('denied'); return }
    }

    const evtName = 'ondeviceorientationabsolute' in window
      ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(evtName, onOrientation, true)
    setStage('active')
  }

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

  // اهتزازٌ خفيفٌ عند المحاذاة (vibration API)
  useEffect(() => {
    if (heading === null || qiblaDeg === null) return
    const delta = Math.abs(((qiblaDeg - heading + 540) % 360) - 180)
    if (delta < 5 && performance.now() - lastHaptic.current > 1500) {
      lastHaptic.current = performance.now()
      if (navigator.vibrate) navigator.vibrate(40)
    }
  }, [heading, qiblaDeg])

  const delta = (heading !== null && qiblaDeg !== null)
    ? ((qiblaDeg - heading + 540) % 360) - 180
    : null
  const aligned = delta !== null && Math.abs(delta) < 5

  // اسمُ الاتّجاه العربيُّ من درجة الجوّال
  function cardinalAr(deg) {
    if (deg === null) return ''
    const dirs = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب']
    return dirs[Math.round(deg / 45) % 8]
  }

  // إحداثيّاتٌ بصيغة DMS مثل تطبيق iOS الأصليّ
  function formatDMS(d, isLat) {
    const dir = isLat ? (d >= 0 ? 'ش' : 'ج') : (d >= 0 ? 'شرق' : 'غرب')
    const abs = Math.abs(d)
    const deg = Math.floor(abs)
    const min = Math.floor((abs - deg) * 60)
    const sec = Math.round(((abs - deg) * 60 - min) * 60)
    return `${deg}°${min}'${sec}" ${dir}`
  }

  const SIZE = 240, VB = 200, CX = 100, CY = 100, RADIUS = 88

  return (
    <div className={`qibla ${aligned ? 'aligned' : ''}`}>

      {/* رقمُ الاتجاه فوق القرص — كبيرٌ وواضحٌ مثل iOS */}
      {heading !== null && (
        <div className="qibla-readout">
          <span className="qibla-deg">{Math.round(heading)}°</span>
          <span className="qibla-dir">{cardinalAr(heading)}</span>
        </div>
      )}

      <div className="qibla-shell" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%" style={{ display: 'block' }}>
          <defs>
            <linearGradient id="qb-needle" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#047857" />
            </linearGradient>
            <linearGradient id="qb-kaaba" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
            <radialGradient id="qb-pin" cx="0.35" cy="0.3">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="40%" stopColor="#a7f3d0" />
              <stop offset="100%" stopColor="#059669" />
            </radialGradient>
          </defs>

          {/* القرصُ الدوّار */}
          <g transform={heading !== null ? `rotate(${-heading} ${CX} ${CY})` : ''}
             style={{ transition: 'transform .15s cubic-bezier(.4,1.4,.6,1)' }}>
            {/* تدرّجاتُ ٣٦٠° — كلّ ١٠° (٣٦ تدرّجًا) */}
            {[...Array(72)].map((_, i) => {
              const angle = i * 5
              const isMajor = i % 6 === 0    // كلّ ٣٠° (١٢ تدرّجًا كبيرًا)
              const isMid = i % 2 === 0       // كلّ ١٠°
              const inner = RADIUS - (isMajor ? 12 : isMid ? 7 : 4)
              const outer = RADIUS - 1
              const a = (angle - 90) * Math.PI / 180
              return (
                <line key={i}
                  x1={CX + Math.cos(a) * inner} y1={CY + Math.sin(a) * inner}
                  x2={CX + Math.cos(a) * outer} y2={CY + Math.sin(a) * outer}
                  stroke={isMajor ? 'rgba(255,255,255,.55)' : isMid ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.10)'}
                  strokeWidth={isMajor ? 2 : 1} />
              )
            })}
            {/* أرقامُ الدرجات الرئيسيّة (٣٠/٦٠/...) */}
            {[30, 60, 120, 150, 210, 240, 300, 330].map((angle) => {
              const a = (angle - 90) * Math.PI / 180
              const r = RADIUS - 22
              return (
                <text key={angle}
                  x={CX + Math.cos(a) * r}
                  y={CY + Math.sin(a) * r + 3}
                  textAnchor="middle" fontFamily="system-ui" fontWeight="500"
                  fontSize="9" fill="rgba(255,255,255,.45)">{angle}</text>
              )
            })}
            {/* علاماتُ الجهات الأربع — بأحجامٍ مختلفةٍ كتطبيق iOS */}
            <text x={CX} y="20" textAnchor="middle" fontFamily="serif" fontWeight="900"
                  fontSize="16" fill="#ef4444">ش</text>
            <text x={CX} y={VB - 7} textAnchor="middle" fontFamily="serif" fontWeight="900"
                  fontSize="14" fill="rgba(255,255,255,.85)">ج</text>
            <text x={VB - 10} y={CY + 5} textAnchor="middle" fontFamily="serif" fontWeight="900"
                  fontSize="14" fill="rgba(255,255,255,.85)">ش</text>
            <text x="10" y={CY + 5} textAnchor="middle" fontFamily="serif" fontWeight="900"
                  fontSize="14" fill="rgba(255,255,255,.85)">غ</text>

            {/* رمزُ الكعبة */}
            {qiblaDeg !== null && (() => {
              const a = (qiblaDeg - 90) * Math.PI / 180
              const r = RADIUS - 30
              return (
                <g transform={`translate(${CX + Math.cos(a) * r} ${CY + Math.sin(a) * r})`}
                   style={{ transition: 'transform .25s' }}>
                  <circle r="14" fill="rgba(0,0,0,.4)" />
                  <rect x="-9" y="-9" width="18" height="18" rx="2.5"
                    fill="url(#qb-kaaba)" stroke="#1a0f00" strokeWidth="1.3" />
                  <line x1="-9" y1="-4.5" x2="9" y2="-4.5" stroke="#1a0f00" strokeWidth="1.3" />
                  <rect x="-1.8" y="-0.5" width="3.6" height="6" rx="0.5" fill="#1a0f00" />
                </g>
              )
            })()}
          </g>

          {/* إبرةُ الاتجاه الثابتة — تُشير لأعلى دائمًا */}
          <g filter={aligned ? 'drop-shadow(0 0 9px rgba(52,211,153,.85))' : 'drop-shadow(0 2px 4px rgba(16,185,129,.5))'}>
            <polygon points={`${CX},20 ${CX - 8},${CY - 6} ${CX + 8},${CY - 6}`}
              fill={aligned ? '#fbbf24' : 'url(#qb-needle)'}
              style={{ transition: 'fill .25s' }} />
            <polygon points={`${CX},${VB - 20} ${CX - 6},${CY + 6} ${CX + 6},${CY + 6}`}
              fill="rgba(241,245,243,.4)" />
          </g>

          {/* المسمار المركزيّ */}
          <circle cx={CX} cy={CY} r="8" fill="url(#qb-pin)" stroke="rgba(255,255,255,.4)" strokeWidth="1.5" />
        </svg>
      </div>

      {/* بياناتٌ تحت القرص — مثل iOS Native Compass */}
      {stage === 'active' && coords && (
        <div className="qibla-info">
          {distance !== null && (
            <div className="qibla-info-row">
              <span className="qibla-info-lbl">المسافة إلى الكعبة</span>
              <span className="qibla-info-val">{distance < 10 ? distance.toFixed(1) : Math.round(distance).toLocaleString('ar-SA')} كم</span>
            </div>
          )}
          {qiblaDeg !== null && (
            <div className="qibla-info-row">
              <span className="qibla-info-lbl">اتّجاه القبلة</span>
              <span className="qibla-info-val">{Math.round(qiblaDeg)}° · {cardinalAr(qiblaDeg)}</span>
            </div>
          )}
          {coords.lat && (
            <div className="qibla-coords">
              <span className="ltr">{formatDMS(coords.lat, true)}</span>
              <span className="ltr">{formatDMS(coords.lon, false)}</span>
            </div>
          )}
        </div>
      )}

      {/* الحالات */}
      <div className="qibla-state">
        {stage === 'idle' && (
          <button type="button" className="btn btn-em qibla-cta" onClick={activate}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: 7 }}>
              <circle cx="12" cy="12" r="9"/>
              <polygon points="16 8 14 14 8 16 10 10"/>
            </svg>
            ابدأ البوصلة
          </button>
        )}
        {stage === 'asking' && (
          <span className="qibla-hint"><span className="spinner" /> جاري التحضير…</span>
        )}
        {stage === 'denied' && (
          <div className="qibla-denied">
            <strong>الإذن مطلوبٌ لتعمل البوصلة</strong>
            <span>على iPhone افتح Safari ← الإعدادات ← أعد تفعيل «الموقع» و«الحركة والاتجاه»</span>
            <button type="button" className="btn btn-em btn-sm" onClick={activate}>إعادة المحاولة</button>
          </div>
        )}
        {stage === 'unsupported' && (
          <span className="qibla-hint">افتح ملبّيك على جوّالك للتجربة الكاملة</span>
        )}
        {stage === 'active' && delta !== null && (
          <div className={`qibla-guide ${aligned ? 'ok' : ''}`}>
            {aligned ? (
              <><span className="qibla-tick-ic">✓</span> محاذٍ للقبلة</>
            ) : delta > 0 ? (
              <>لُف {Math.round(delta)}° يمينًا <span aria-hidden="true">←</span></>
            ) : (
              <><span aria-hidden="true">→</span> لُف {Math.round(-delta)}° يسارًا</>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
