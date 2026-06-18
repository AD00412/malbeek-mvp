import { useId } from 'react'

/**
 * علامة ملبّيك — M·٢ الطواف.
 * حرفُ M يطوف حول كعبةٍ ذهبيّةٍ بالحزام والباب.
 * • الساق الأيسر: الانطلاق (مستقيم).
 * • الساق الأيمن: يلتفّ كحركة طواف.
 * • الكعبة: مربّعٌ ذهبيٌّ ‎#fbbf24‎ بحزامٍ ‎#1a0f00‎ وبابٍ ‎#1a0f00‎.
 * • الإطار: تدرّجٌ زمرّديٌّ ‎em-400→em-600→em-800‎ + لمعةٌ علويّةٌ ناعمة.
 *
 * v2.0: اعتُمدت الهويّة الجديدة من دليل ‎mulabeekbrandguide.html‎.
 *       اسمُ المكوّنِ ‎CompassMark‎ بقي للتوافق العكسيّ — كلّ المكوّنات
 *       تستوردُه بالاسم نفسه فلا يلزم تعديلها.
 *
 * @param {number} size الحجم بالبكسل (افتراضي 40). نصف القطر يُحسب نسبيًّا (٢٨٪).
 * @param {string} className إضافات CSS.
 */
export default function CompassMark({ size = 40, className = '', variant }) {
  // المتغيّرات السابقة (full/gold/dark) لم تَعُد ذاتَ أثر — العلامةُ موحّدةٌ.
  // نُبقي البرامتر للتوافق لكن لا نستخدمه.
  void variant
  const reactId = useId().replace(/:/g, '')
  const id = `mk-${reactId}`
  // نصف القطر النسبيّ من دليل الهويّة: 104→30، 72→21، 56→16، 40→11، 32→9، 20→6.
  const radius = Math.max(4, Math.round(size * 0.28))
  // الظلّ يتدرّج مع الحجم — يختفي على الـ favicon (≤20px).
  const hasShadow = size >= 28
  return (
    <span className={`mk ${className}`}
      aria-hidden="true"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: radius,
        background: 'linear-gradient(140deg,#34d399,#059669 55%,#065f46)',
        boxShadow: hasShadow
          ? '0 10px 26px rgba(16,185,129,.32), inset 0 1px 1px rgba(255,255,255,.25)'
          : 'inset 0 1px 1px rgba(255,255,255,.20)',
        position: 'relative', overflow: 'hidden',
        flex: 'none',
      }}>
      <svg viewBox="0 0 64 64" fill="none" width="62%" height="62%" style={{ position: 'relative', zIndex: 1 }}>
        <defs>
          {/* اللمعة العلويّة — أنعمُ من ‎::after‎ المعتمد على ‎inset‎ */}
          <linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0.65" y2="1">
            <stop offset="0" stopColor="rgba(255,255,255,.22)" />
            <stop offset=".45" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        {/* الساق الأيسر: مستقيم (الانطلاق) */}
        <path d="M14 50 V30 A8 8 0 0 1 30 30 V50" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" />
        {/* الساق الأيمن: يلتفّ طوافًا */}
        <path d="M30 50 V34 A11 11 0 1 1 41 45" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" />
        {/* الكعبة الذهبيّة */}
        <rect x="35" y="27.5" width="12" height="12" rx="1.3" fill="#fbbf24" />
        {/* حزام الكسوة */}
        <line x1="35" y1="31.5" x2="47" y2="31.5" stroke="#1a0f00" strokeWidth="1.5" />
        {/* الباب */}
        <rect x="39.5" y="33" width="3" height="6.5" rx="0.4" fill="#1a0f00" />
      </svg>
      {/* لمعةٌ علويّةٌ بقطعة DIV بسيطةٍ — لتفادي double-svg */}
      <span style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'linear-gradient(160deg,rgba(255,255,255,.22),transparent 45%)',
      }} />
    </span>
  )
}
