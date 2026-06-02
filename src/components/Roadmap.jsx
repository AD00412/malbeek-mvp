import { useEffect, useState } from 'react'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

/**
 * نافذة "ما القادم؟" — تُفتح تلقائيًّا مرّةً واحدةً لكل إصدار،
 * وتعرض الميزات الجديدة والميزات التالية في خارطة الطريق.
 *
 * لإطلاق نسخةٍ جديدةٍ، غيّر RELEASE فقط — يُفتح للمستخدم مرّةً واحدة.
 */
const RELEASE = '2026-06-customer-booking'

const SHIPPED = [
  { ic: 'seat', t: 'حجز العميل الذاتي', d: 'العميل يفتح حملته، يملأ بياناته، ويختار مقعده من الخريطة الحيّة (يرى المشغول بلا أسماء).' },
  { ic: 'barcode', t: 'تذاكري للعميل', d: 'بعد الحجز تظهر تذكرة الصعود بالباركود، قابلةٌ للحفظ والتعديل.' },
  { ic: 'payments', t: 'خطوة الدفع', d: 'المشترك يضع رابط متجره (سلة/زد)، والعميل يدفع ثم يُرفق مرجع العملية.' },
  { ic: 'message', t: 'عروضٌ جماعية', d: 'إرسال عرضٍ لمعتمري الرحلة عبر واتساب بضغطة، أو بريدٍ جاهز.' },
  { ic: 'sparkle', t: 'حدّ الباقة التجريبية', d: 'رحلةٌ واحدةٌ مجانًا، والترقية لباقة ملبّيك (٢٤٩ ﷼) لرحلاتٍ غير محدودة.' },
]

const NEXT = [
  { ic: 'badge', t: 'حفظ التذكرة في محفظة الجوال', d: 'إضافة التذكرة إلى Apple/Google Wallet (تتطلّب شهادات توقيع).', tag: 'لاحق' },
  { ic: 'chart', t: 'تحليلات الحملة', d: 'مؤشّرات الإشغال والإيرادات والحضور.', tag: 'لاحق' },
  { ic: 'building', t: 'تعدّد الباصات للرحلة', d: 'أكثر من باصٍ في الرحلة الواحدة مع توزيعٍ تلقائي.', tag: 'لاحق' },
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
