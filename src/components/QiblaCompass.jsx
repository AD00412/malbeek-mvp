import { useEffect, useState, useRef } from 'react'

/**
 * بوصلةٌ حيّةٌ تستجيب لحركة الجوّال وتشير إلى **قبلة المسجد الحرام**.
 * - تستخدم DeviceOrientationEvent (يتطلّب إذنًا على iOS 13+)
 * - تحسب الزاوية من موقع المستخدم (Geolocation) بصيغة spherical bearing
 * - تعرض إبرةً + رمزَ كعبةٍ ذهبيًّا في موقع القبلة على القرص
 */
export default function QiblaCompass() {
  const [heading, setHeading] = useState(null)
  const [qiblaDeg, setQiblaDeg] = useState(null)
  const [stage, setStage] = useState('idle')   // idle | asking | active | denied | unsupported
  const lastUpdate = useRef(0)

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
          enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000,
        })
      })
      setQiblaDeg(calcQiblaBearing(pos.coords.latitude, pos.coords.longitude))
    } catch {
      setQiblaDeg(calcQiblaBearing(24.7136, 46.6753))  // الرياض كبديلٍ افتراضيّ
    }

    const DOE = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission()
        if (result !== 'granted') { setStage('denied'); return }
      } catch {
        setStage('denied'); return
      }
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

  const delta = (heading !== null && qiblaDeg !== null)
    ? ((qiblaDeg - heading + 540) % 360) - 180
    : null
  const aligned = delta !== null && Math.abs(delta) < 5
  const dirText = delta === null ? null
    : aligned ? '✓ محاذٍ للقبلة'
    : delta > 0 ? `لُف ${Math.round(delta)}° يمينًا ←`
    : `→ لُف ${Math.round(-delta)}° يسارًا`

  // SVG viewBox 0..200 — موحَّدٌ للقرص والإبرة والكعبة
  const SIZE = 220
  const VB = 200
  const CX = VB / 2, CY = VB / 2
  const RADIUS = 90

  return (
    <div className={`qibla ${aligned ? 'aligned' : ''}`}>
      <div className="qibla-shell" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${VB} ${VB}`} width="100%" height="100%" style={{ display: 'block' }}>
          <defs>
            {/* تدرّجُ الإبرة الزمرّديّ */}
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

          {/* القرصُ الدوّار — يدور عكس heading فتثبت العلامات على الشمال */}
          <g transform={heading !== null ? `rotate(${-heading} ${CX} ${CY})` : ''} style={{ transition: 'transform .2s cubic-bezier(.4,1.4,.6,1)' }}>
            {/* تدرّجاتُ ٣٦٠° */}
            {[...Array(36)].map((_, i) => {
              const angle = i * 10
              const isBig = i % 9 === 0
              const inner = RADIUS - (isBig ? 10 : 7)
              const outer = RADIUS - 1
              const a = (angle - 90) * Math.PI / 180
              const x1 = CX + Math.cos(a) * inner
              const y1 = CY + Math.sin(a) * inner
              const x2 = CX + Math.cos(a) * outer
              const y2 = CY + Math.sin(a) * outer
              return (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isBig ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.18)'}
                  strokeWidth={isBig ? 2 : 1} />
              )
            })}
            {/* علاماتُ الجهات الأربع: ش ، ش (شرق) ، ج ، غ */}
            <text x={CX} y="22" textAnchor="middle" fontFamily="serif" fontWeight="900" fontSize="12" fill="rgba(255,255,255,.85)">ش</text>
            <text x={CX} y={VB - 12} textAnchor="middle" fontFamily="serif" fontWeight="900" fontSize="12" fill="#10b981">ج</text>
            <text x={VB - 12} y={CY + 4} textAnchor="middle" fontFamily="serif" fontWeight="900" fontSize="12" fill="rgba(255,255,255,.7)">ش</text>
            <text x="12" y={CY + 4} textAnchor="middle" fontFamily="serif" fontWeight="900" fontSize="12" fill="rgba(255,255,255,.7)">غ</text>

            {/* رمزُ الكعبة بزاوية القبلة — يتموضع على حافّة القرص */}
            {qiblaDeg !== null && (() => {
              const a = (qiblaDeg - 90) * Math.PI / 180
              const kx = CX + Math.cos(a) * (RADIUS - 18)
              const ky = CY + Math.sin(a) * (RADIUS - 18)
              return (
                <g transform={`translate(${kx} ${ky})`} style={{ transition: 'transform .25s' }}>
                  <rect x="-10" y="-10" width="20" height="20" rx="2.5" fill="url(#qb-kaaba)" stroke="#1a0f00" strokeWidth="1.5" />
                  <line x1="-10" y1="-5" x2="10" y2="-5" stroke="#1a0f00" strokeWidth="1.5" />
                  <rect x="-2" y="-1" width="4" height="7" rx="0.5" fill="#1a0f00" />
                </g>
              )
            })()}
          </g>

          {/* الإبرةُ الثابتة في المنتصف — تشير دائمًا للأعلى (اتجاه الجوّال) */}
          <g style={{ transition: 'filter .3s' }} filter={aligned ? 'drop-shadow(0 2px 10px rgba(251,191,36,.7))' : 'drop-shadow(0 2px 6px rgba(16,185,129,.6))'}>
            {/* النصف العلويّ — مدبَّبٌ أخضر */}
            <polygon points={`${CX},20 ${CX - 9},${CY - 8} ${CX + 9},${CY - 8}`}
              fill={aligned ? '#fbbf24' : 'url(#qb-needle)'} />
            {/* النصف السفليّ — رماديٌّ شفّاف */}
            <polygon points={`${CX},${VB - 20} ${CX - 7},${CY + 8} ${CX + 7},${CY + 8}`}
              fill="rgba(241,245,243,.55)" />
          </g>

          {/* المسمار في المنتصف */}
          <circle cx={CX} cy={CY} r="9" fill="url(#qb-pin)" stroke="rgba(255,255,255,.4)" strokeWidth="2" />
        </svg>
      </div>

      <div className="qibla-state">
        {stage === 'idle' && (
          <button type="button" className="btn btn-em btn-sm qibla-cta" onClick={activate}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: 6 }}>
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
            <strong>تعذّر الإذن</strong>
            <span>لتفعيل البوصلة على iOS Safari:</span>
            <ol>
              <li>إعدادات Safari ← خصوصيّة والأمن ← فعّل «الحركة والاتجاه»</li>
              <li>أو من Safari → ⓘ → «الموقع» = اسمح</li>
              <li>ارجع وارفع الصفحة (سحبٌ للأسفل)</li>
            </ol>
            <button type="button" className="btn btn-em btn-sm" onClick={activate}>إعادة المحاولة</button>
          </div>
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
