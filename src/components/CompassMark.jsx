import { useMemo, useId } from 'react'

function point(r, a) {
  const rad = (a * Math.PI) / 180
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)]
}

// ألوانُ كلّ متغيّرٍ في كتلةٍ واحدةٍ — يسهل تعديلها لاحقًا.
const VARIANTS = {
  gold: { gA:'#F6E3B0', gB:'#C49A45', eA:'#D8B25E', eB:'#8A6A1F',
          ring:'#8A6A1F', outline:'#F6E3B0', coreFill:'#8A6A1F', coreRing:'#F6E3B0', dot:'#FBF7EE', glow:'#E2C277' },
  dark: { gA:'#0B5C43', gB:'#063D2C', eA:'#128A66', eB:'#04261C',
          ring:'#0B5C43', outline:'#0B5C43', coreFill:'#04261C', coreRing:'#0B5C43', dot:'#128A66', glow:'#0B5C43' },
  full: { gA:'#F6E3B0', gB:'#C49A45', eA:'#2BB68C', eB:'#063D2C',
          ring:'#C49A45', outline:'#E2C277', coreFill:'#063D2C', coreRing:'#E2C277', dot:'#F6E3B0', glow:'#E2C277' },
}

function buildShapes() {
  const rLong = 84, rShort = 50, rValley = 24
  const facets = [], outlinePts = [], ticks = []
  for (let i = 0; i < 8; i++) {
    const ta = -90 + i * 45
    const card = i % 2 === 0
    const rt = card ? rLong : rShort
    const T = point(rt, ta), VL = point(rValley, ta - 22.5), VR = point(rValley, ta + 22.5)
    facets.push({ pts: `100,100 ${T[0].toFixed(2)},${T[1].toFixed(2)} ${VR[0].toFixed(2)},${VR[1].toFixed(2)}`, side: 'g' })
    facets.push({ pts: `100,100 ${T[0].toFixed(2)},${T[1].toFixed(2)} ${VL[0].toFixed(2)},${VL[1].toFixed(2)}`, side: 'e' })
    outlinePts.push(T, VR)
    const A = point(95, ta), B = point(card ? 86 : 89, ta)
    ticks.push({ x1: A[0].toFixed(2), y1: A[1].toFixed(2), x2: B[0].toFixed(2), y2: B[1].toFixed(2), wide: card })
  }
  const outlinePath = 'M' + outlinePts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L') + ' Z'
  const sp = 8
  const sparkPath = `M100,${100 - sp} L${100 + sp * 0.32},${100 - sp * 0.32} L${100 + sp},100 L${100 + sp * 0.32},${100 + sp * 0.32} L100,${100 + sp} L${100 - sp * 0.32},${100 + sp * 0.32} L${100 - sp},100 L${100 - sp * 0.32},${100 - sp * 0.32} Z`
  return { facets, ticks, outlinePath, sparkPath }
}

/**
 * شعار ملبّيك — نجمة البوصلة الثمانية. JSX خالصٌ بلا dangerouslySetInnerHTML
 * (دفاعٌ بالعمق ضدّ أيّ مخاطرَ مستقبليّة عند توسعة المكوّن لاحقًا).
 *
 * @param {number} size   الحجم بالبكسل (افتراضي 40)
 * @param {'full'|'gold'|'dark'} variant
 */
export default function CompassMark({ size = 40, variant = 'full', className = '' }) {
  const reactId = useId().replace(/:/g, '')
  const id = `mk-${reactId}`
  const C = VARIANTS[variant] || VARIANTS.full
  const { facets, ticks, outlinePath, sparkPath } = useMemo(buildShapes, [])
  return (
    <span className={className} style={{ display: 'inline-block', width: size, height: size, lineHeight: 0 }}>
      <svg viewBox="0 0 200 200" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={C.gA} /><stop offset="1" stopColor={C.gB} />
          </linearGradient>
          <linearGradient id={`${id}-e`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={C.eA} /><stop offset="1" stopColor={C.eB} />
          </linearGradient>
          <filter id={`${id}-f`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.4" floodColor={C.glow} floodOpacity="0.55" />
          </filter>
        </defs>
        <circle cx="100" cy="100" r="95" fill="none" stroke={C.ring} strokeWidth="1" opacity=".5" />
        <circle cx="100" cy="100" r="90" fill="none" stroke={C.ring} strokeWidth="1.6" opacity=".3" />
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke={C.ring} strokeWidth={t.wide ? 2 : 1.2} strokeLinecap="round" opacity=".85" />
        ))}
        <g filter={`url(#${id}-f)`}>
          {facets.map((f, i) => (
            <polygon key={i} points={f.pts} fill={`url(#${id}-${f.side})`} />
          ))}
          <path d={outlinePath} fill="none" stroke={C.outline} strokeWidth="1" strokeLinejoin="round" opacity=".9" />
          <circle cx="100" cy="100" r="14" fill={C.coreFill} stroke={C.coreRing} strokeWidth="1.6" />
          <path d={sparkPath} fill={C.coreRing} opacity=".95" />
          <circle cx="100" cy="100" r="2.6" fill={C.dot} />
        </g>
      </svg>
    </span>
  )
}
