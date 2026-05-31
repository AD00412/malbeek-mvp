import { useMemo } from 'react'

let _seq = 0

function point(r, a) {
  const rad = (a * Math.PI) / 180
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)]
}

function buildCompassSVG(variant) {
  const id = 'mk' + _seq++
  const rLong = 84, rShort = 50, rValley = 24
  let gA, gB, eA, eB, ring, outline, coreFill, coreRing, dot, glow
  if (variant === 'gold') {
    gA = '#F6E3B0'; gB = '#C49A45'; eA = '#D8B25E'; eB = '#8A6A1F'
    ring = '#8A6A1F'; outline = '#F6E3B0'; coreFill = '#8A6A1F'; coreRing = '#F6E3B0'; dot = '#FBF7EE'; glow = '#E2C277'
  } else if (variant === 'dark') {
    gA = '#0B5C43'; gB = '#063D2C'; eA = '#128A66'; eB = '#04261C'
    ring = '#0B5C43'; outline = '#0B5C43'; coreFill = '#04261C'; coreRing = '#0B5C43'; dot = '#128A66'; glow = '#0B5C43'
  } else {
    gA = '#F6E3B0'; gB = '#C49A45'; eA = '#2BB68C'; eB = '#063D2C'
    ring = '#C49A45'; outline = '#E2C277'; coreFill = '#063D2C'; coreRing = '#E2C277'; dot = '#F6E3B0'; glow = '#E2C277'
  }

  let facets = '', outlinePts = []
  for (let i = 0; i < 8; i++) {
    const ta = -90 + i * 45
    const card = i % 2 === 0
    const rt = card ? rLong : rShort
    const T = point(rt, ta), VL = point(rValley, ta - 22.5), VR = point(rValley, ta + 22.5)
    facets += `<polygon points="100,100 ${T[0].toFixed(2)},${T[1].toFixed(2)} ${VR[0].toFixed(2)},${VR[1].toFixed(2)}" fill="url(#${id}-g)"/>`
    facets += `<polygon points="100,100 ${T[0].toFixed(2)},${T[1].toFixed(2)} ${VL[0].toFixed(2)},${VL[1].toFixed(2)}" fill="url(#${id}-e)"/>`
    outlinePts.push(T, VR)
  }
  const op = 'M' + outlinePts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L') + ' Z'

  let ticks = ''
  for (let i = 0; i < 8; i++) {
    const a = -90 + i * 45, card = i % 2 === 0
    const A = point(95, a), B = point(card ? 86 : 89, a)
    ticks += `<line x1="${A[0].toFixed(2)}" y1="${A[1].toFixed(2)}" x2="${B[0].toFixed(2)}" y2="${B[1].toFixed(2)}" stroke="${ring}" stroke-width="${card ? 2 : 1.2}" stroke-linecap="round" opacity=".85"/>`
  }

  const sp = 8
  const spark = `M100,${100 - sp} L${100 + sp * 0.32},${100 - sp * 0.32} L${100 + sp},100 L${100 + sp * 0.32},${100 + sp * 0.32} L100,${100 + sp} L${100 - sp * 0.32},${100 + sp * 0.32} L${100 - sp},100 L${100 - sp * 0.32},${100 - sp * 0.32} Z`

  return `<svg viewBox="0 0 200 200" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs>
    <linearGradient id="${id}-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${gA}"/><stop offset="1" stop-color="${gB}"/></linearGradient>
    <linearGradient id="${id}-e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${eA}"/><stop offset="1" stop-color="${eB}"/></linearGradient>
    <filter id="${id}-f" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="2.4" flood-color="${glow}" flood-opacity="0.55"/></filter></defs>
    <circle cx="100" cy="100" r="95" fill="none" stroke="${ring}" stroke-width="1" opacity=".5"/>
    <circle cx="100" cy="100" r="90" fill="none" stroke="${ring}" stroke-width="1.6" opacity=".3"/>${ticks}
    <g filter="url(#${id}-f)">${facets}<path d="${op}" fill="none" stroke="${outline}" stroke-width="1" stroke-linejoin="round" opacity=".9"/>
    <circle cx="100" cy="100" r="14" fill="${coreFill}" stroke="${coreRing}" stroke-width="1.6"/><path d="${spark}" fill="${coreRing}" opacity=".95"/><circle cx="100" cy="100" r="2.6" fill="${dot}"/></g></svg>`
}

/**
 * شعار ملبّيك — نجمة البوصلة الثمانية
 * @param {number} size   الحجم بالبكسل (افتراضي 40)
 * @param {'full'|'gold'|'dark'} variant
 */
export default function CompassMark({ size = 40, variant = 'full', className = '' }) {
  const svg = useMemo(() => buildCompassSVG(variant), [variant])
  return (
    <span
      className={className}
      style={{ display: 'inline-block', width: size, height: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
