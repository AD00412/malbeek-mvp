import { useEffect, useState } from 'react'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

/**
 * نافذة "ما القادم؟" — تُفتح تلقائيًّا مرّةً واحدةً لكل إصدار،
 * وتعرض الميزات الجديدة والميزات التالية في خارطة الطريق.
 *
 * لإطلاق نسخةٍ جديدةٍ، غيّر RELEASE فقط — يُفتح للمستخدم مرّةً واحدة.
 */
const RELEASE = '2026-06-barcode-tickets'

const SHIPPED = [
  { ic: 'barcode', t: 'تذكرة الصعود بالباركود', d: 'تذكرةٌ أنيقةٌ لكل معتمر برمز QR، تُحفظ كصورةٍ أو تُطبع.' },
  { ic: 'qr', t: 'المسح الحي بالكاميرا', d: 'امسح تذكرة الصعود أو التسكين فيتحدّث حضور المعتمر فورًا.' },
  { ic: 'manifest', t: 'الكشف الرسمي للباص', d: '٩ أعمدة بترويسة المؤسسة والطاقم، ختمٌ إلكترونيٌّ أو يدوي، وطباعة/PDF.' },
  { ic: 'customers', t: 'إدارة المعتمرين والمقاعد', d: 'إضافة المعتمرين لكل رحلة مع المقعد ومكان الركوب والحالة.' },
]

const NEXT = [
  { ic: 'share', t: 'تدفّق حجز العميل', d: 'العميل يملأ بياناته ويختار مقعده عبر الرابط مباشرةً.', tag: 'التالي' },
  { ic: 'payments', t: 'الدفع وإثبات الحجز', d: 'ربطٌ مع متجرٍ خارجي ثم العودة لإرفاق الإيصال.', tag: 'قريبًا' },
  { ic: 'badge', t: 'حفظ التذكرة في محفظة الجوال', d: 'إضافة التذكرة إلى Apple/Google Wallet.', tag: 'لاحق' },
  { ic: 'message', t: 'عروضٌ جماعية', d: 'إرسال عروضٍ للمعتمرين عبر واتساب/الإيميل من اللوحة.', tag: 'لاحق' },
]

export default function Roadmap() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      const seen = localStorage.getItem('malbeek.roadmap.seen')
      if (seen !== RELEASE) setOpen(true)
    } catch (_) {}
  }, [])

  function close() {
    setOpen(false)
    try { localStorage.setItem('malbeek.roadmap.seen', RELEASE) } catch (_) {}
  }

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title="ما الجديد في ملبّيك؟"
      actions={<button className="btn btn-gold btn-block" onClick={close}>فهمت، لنبدأ</button>}
    >
      <p className="muted" style={{ fontSize: 14, marginTop: -8, marginBottom: 14 }}>
        دفعةُ تحديثاتٍ جديدةٌ لتحسين السرعة والتجربة على الجوال. وهذه خارطة القادم بعدها.
      </p>

      <div className="hero" style={{ marginTop: 0 }}>
        <span className="tag">✦ الجديد الآن</span>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {SHIPPED.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 10, background: 'rgba(43,182,140,.14)', color: 'var(--ok-ink)', display: 'grid', placeItems: 'center' }}>
                <Icon name={it.ic} size={17} />
              </span>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--cr-50)', fontSize: 14 }}>{it.t}</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{it.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <h3 style={{ margin: '18px 0 10px', fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--cr-50)' }}>القادم في الطريق</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {NEXT.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface-3)' }}>
            <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 10, background: 'rgba(196,154,69,.12)', color: 'var(--gd-300)', display: 'grid', placeItems: 'center' }}>
              <Icon name={it.ic} size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, color: 'var(--cr-50)', fontSize: 14 }}>{it.t}</span>
                <span className="tag gold" style={{ fontSize: 10, padding: '2px 8px' }}>{it.tag}</span>
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{it.d}</div>
            </div>
          </div>
        ))}
      </div>
    </BottomSheet>
  )
}
