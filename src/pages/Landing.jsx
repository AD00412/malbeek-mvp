import { useState, useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../app/useAuth'
import { homeForRole, ScreenLoader } from '../app/RequireAuth'
import CompassMark from '../components/CompassMark'
import ThemeToggle from '../components/ThemeToggle'
import Icon from '../components/Icon'
import PublicMessageModal from '../components/PublicMessageModal'
import QiblaCompass from '../components/QiblaCompass'
import InstallCard from '../components/InstallCard'

/* ============================================================
   ملبّيك — صفحةُ الترحيب
   هويّةٌ هادئةٌ + لغةٌ تسويقيّةٌ متّسقةٌ + كلّ زرٍّ يعمل.
   ============================================================ */

// === أرقامٌ ووصلاتٌ رسميّةٌ — حدّثها بقيمك الحقيقيّة عند الإطلاق ===
const CONTACT = {
  email: 'hello@mulabeek.com',
  whatsapp: '966533579835',           // رقم واتسآب للأعمال (بدون + أو ٠٠)
  twitter: 'https://x.com/mulabeek',  // X (تويتر سابقًا)
  instagram: 'https://instagram.com/mulabeek',
  linkedin: 'https://www.linkedin.com/company/mulabeek',
  // وثيقةُ العمل الحرّ — منصّةُ العمل الحرّ السعوديّة (وزارة الموارد البشريّة).
  // الرابطُ الرسميُّ يشترط دخولَ «نفاذ» — لذا نعرض البياناتِ مسبقًا في مودال
  // الـ Landing، ونُتيح زرَّ التحقّق الرسميّ كخيارٍ ثانويٍّ للزائر المتشكِّك.
  freelanceDocNumber: 'FL-879416950',
  freelanceVerifyUrl: 'https://freelance.sa/certificate-validation',
}

// بياناتُ الوثيقة الرسميّة كما تظهر في freelance.sa — تُعرض في الـ Modal للزائر
// مباشرةً لتفادي حاجز «نفاذ» دون التضحية بالشفافيّة.
const FREELANCE_DOC = {
  status: 'سارية',
  authority: 'وزارة الموارد البشريّة والتنمية الاجتماعيّة',
  category: 'الخدمات التخصصيّة',
  number: 'FL-879416950',
  holder: 'أحمد خالد علي طويس مغفوري',
  profession: 'برمجة وتطوير المواقع الإلكترونيّة',
  issuedAt: '٢ يونيو ٢٠٢٦',
}

function Feature({ icon, title, body }) {
  return (
    <article className="lp-feat">
      <span className="lp-feat-ic"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  )
}

function Step({ n, title, body }) {
  return (
    <article className="lp-step">
      <span className="lp-step-n">{n}</span>
      <div>
        <h4>{title}</h4>
        <p>{body}</p>
      </div>
    </article>
  )
}

function FaqItem({ q, a }) {
  return (
    <details className="lp-faq-item">
      <summary>
        <span>{q}</span>
        <span className="lp-faq-ic" aria-hidden="true">+</span>
      </summary>
      <p>{a}</p>
    </details>
  )
}

// أيقوناتٌ بسيطةٌ لوسائل التواصل — مدمجةٌ هنا لأنّها خاصّةٌ بالـ Landing.
function SocialIcon({ name }) {
  if (name === 'x') return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  )
  if (name === 'instagram') return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5"/>
      <circle cx="12" cy="12" r="4"/>
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor"/>
    </svg>
  )
  if (name === 'linkedin') return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM10 9h3.8v1.7h.06c.53-1 1.83-2.06 3.77-2.06 4.03 0 4.77 2.66 4.77 6.11V21h-4v-5.32c0-1.27-.02-2.9-1.77-2.9-1.77 0-2.04 1.38-2.04 2.8V21h-4z"/>
    </svg>
  )
  return null
}

export default function Landing() {
  const { session, role, loading } = useAuth()
  const [showDoc, setShowDoc] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msgMode, setMsgMode] = useState(null)   // 'contact' | 'feedback' | null

  async function copyDocNumber() {
    try {
      await navigator.clipboard.writeText(FREELANCE_DOC.number)
    } catch (_) {
      // فشلَ الـ Clipboard API على بعض المتصفّحات/البيئات — fallback يدويّ
      const ta = document.createElement('textarea')
      ta.value = FREELANCE_DOC.number
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch (_) {}
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // إغلاقُ المودال بمفتاح Escape + قفلُ تمرير الصفحة خلفه.
  useEffect(() => {
    if (!showDoc) return
    const onKey = (e) => { if (e.key === 'Escape') setShowDoc(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [showDoc])

  if (loading) return <ScreenLoader />
  if (session) return <Navigate to={homeForRole(role)} replace />

  return (
    <div className="lp">
      {/* ===== Topbar ===== */}
      <header className="lp-top">
        <Link to="/" className="lp-brand">
          <CompassMark size={36} />
          <span className="lp-brand-lockup">
            <strong>ملبّيك</strong>
            <em>mulabeek.com</em>
          </span>
        </Link>
        <nav className="lp-top-nav">
          <a href="#features">المميّزات</a>
          <a href="#qibla">القبلة</a>
          <a href="#how">كيف تبدأ</a>
          <a href="#install">تثبيت</a>
          <a href="#faq">الأسئلة</a>
          <ThemeToggle />
          <Link to="/login" className="btn btn-ghost btn-sm">تسجيل دخول</Link>
        </nav>
      </header>

      {/* ===== Hero ===== */}
      <section className="lp-hero">
        <div className="lp-hero-mark"><CompassMark size={92} /></div>
        <span className="lp-tag">منصّةُ إدارة حملات العُمرة</span>
        <h1>كلُّ رحلتك<br/>في تطبيقٍ واحد</h1>
        <p>أدِر حملتك من التسجيل إلى التذكرة بسلاسةٍ تليق برحلةٍ روحانيّة — تسجيلُ المعتمرين، توزيعُ المقاعد، إصدارُ الكشوف، ومسحُ الباركود</p>
        <div className="lp-cta-row">
          <Link to="/signup" className="btn btn-em lp-cta">
            <Icon name="sparkle" size={17} /> ابدأ تجربتك المجانيّة
          </Link>
          <Link to="/login" className="btn btn-ghost lp-cta-alt">تسجيل دخول</Link>
        </div>
        <div className="lp-hero-meta">
          <span><Icon name="check" size={14} /> بدون بطاقةٍ ائتمانيّة</span>
          <span><Icon name="check" size={14} /> رحلةٌ كاملةٌ مجانيّة</span>
          <span><Icon name="check" size={14} /> عربيٌّ من الجذور</span>
        </div>
      </section>

      {/* ===== بوصلةُ القبلة — قسمٌ مستقلٌّ بحقّه ===== */}
      <section className="lp-section-qibla lp-section-alt" id="qibla">
        <span className="qibla-section-tag">هديّةٌ روحانيّةٌ في الموقع</span>
        <h2 className="qibla-section-title">بوصلةُ القبلة — حيّةٌ على جوّالك</h2>
        <p className="qibla-section-desc">من حسّاسات جوّالك مباشرةً — اتجاهٌ بدرجاتٍ دقيقةٍ، مسافةٌ فعليّةٌ إلى الكعبة، وإحداثيّاتٌ من موقعك. لا حاجة لتطبيقٍ منفصل</p>
        <QiblaCompass />
      </section>

      {/* ===== Features ===== */}
      <section id="features" className="lp-section">
        <span className="lp-sec-tag">ما تحصل عليه</span>
        <h2>أدواتٌ تشغيليّةٌ متكاملةٌ بلا ضوضاء</h2>
        <div className="lp-feats">
          <Feature icon="customers" title="إدارةُ المعتمرين"
            body="استيرادٌ جماعيٌّ من ملفّ، تعديلٌ سريعٌ، وبحثٌ فوريٌّ بالاسم أو الهويّة أو الجوال" />
          <Feature icon="seat" title="خريطةُ المقاعد"
            body="باصٌ ثلاثيُّ الأبعاد، اختيارٌ ذاتيٌّ للمعتمر، وسياسةُ جلوسٍ مرنةٌ تحترم الخصوصيّة" />
          <Feature icon="manifest" title="الكشفُ الرسميُّ"
            body="ملفُّ PDF بشعارك وختمك — جاهزٌ للطباعة والتسليم للجهات الرسميّة" />
          <Feature icon="qr" title="باركودٌ ومسحٌ حيٌّ"
            body="تذكرةُ صعودٍ لكلّ معتمرٍ مع QR ومسحٌ بالكاميرا — لا انتظار في طوابير" />
          <Feature icon="payments" title="إدارةُ الدفع"
            body="ربطٌ بمتجر زِد أو سلّة، أو إثباتُ تحويلٍ يدويٌّ — حسب طريقة عملك" />
          <Feature icon="customers" title="فِرَقُ العمل"
            body="ادعُ مشرفين وموظّفين بصلاحيّاتٍ منضبطةٍ — كلٌّ يرى ما يخصّه فقط" />
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section id="how" className="lp-section lp-section-alt">
        <span className="lp-sec-tag">ثلاثُ خطواتٍ للبدء</span>
        <h2>من التسجيل إلى أوّل تذكرةٍ في دقائق</h2>
        <div className="lp-steps">
          <Step n="١" title="أنشئ حسابك"
            body="بضعُ ثوانٍ — بريدٌ وكلمةُ مرور، بلا أوراقَ ولا مكالمات" />
          <Step n="٢" title="جهّز حملتك"
            body="ارفع شعارك، أنشئ الرحلة، واضبط الباص — كلُّ ذلك في دقائق" />
          <Step n="٣" title="شارك الرابط"
            body="رابطٌ قصيرٌ مخصَّصٌ لحملتك — يحجز المعتمر ويصله الباركود فورًا" />
        </div>
      </section>

      {/* ===== Trust ===== */}
      <section className="lp-section">
        <div className="lp-trust">
          <div>
            <span className="lp-sec-tag">آمنةٌ بحكم البناء</span>
            <h2>بياناتُ كلّ حملةٍ معزولةٌ على مستوى القاعدة</h2>
            <p className="lp-lede">
              لا حملةَ ترى بيانات حملةٍ أخرى — Row-Level Security مفعَّلٌ على كلّ جدول.
              تشفيرٌ كاملٌ للنقل، نسخٌ احتياطيٌّ يوميٌّ، وكلمةُ مرورٍ مشفَّرةٌ لا نراها أبدًا
            </p>
            <ul className="lp-checks">
              <li><Icon name="check" size={15} /> عزلٌ بيانيٌّ بـ Postgres RLS مفروضٌ على مستوى قاعدة البيانات</li>
              <li><Icon name="check" size={15} /> HTTPS صارمٌ — كلُّ اتّصالٍ مشفَّرٌ بـ TLS 1.3</li>
              <li><Icon name="check" size={15} /> كلماتُ المرور مفوَّضةٌ لـ Supabase Auth — لا تخزينَ محليٌّ</li>
              <li><Icon name="check" size={15} /> صلاحيّاتُ الإدارة مفصولةٌ — تُمنح من القاعدة لا عبر التسجيل</li>
            </ul>
          </div>
          <aside className="lp-trust-card">
            <CompassMark size={80} />
            <div>
              <strong>الباقةُ التجريبيّة</strong>
              <p>رحلةٌ كاملةٌ بكلّ المميّزات — اختبر منصّتك مع معتمرين حقيقيّين قبل أن تقرّر</p>
              <Link to="/signup" className="btn btn-em btn-block">
                ابدأ التجربة الآن
              </Link>
            </div>
          </aside>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="lp-section lp-section-alt">
        <span className="lp-sec-tag">الأسئلة الشائعة</span>
        <h2>إجاباتٌ مباشرةٌ — قبل أن تسأل</h2>
        <div className="lp-faq">
          <FaqItem
            q="هل التجربة مجانيّةٌ فعلًا؟ هل أحتاج بطاقةً ائتمانيّةً؟"
            a="نعم، التجربة مجانيّةٌ بالكامل — رحلةٌ واحدةٌ بكلّ المميّزات بلا بطاقةٍ ائتمانيّةٍ ولا التزامٍ بالاشتراك بعدها" />
          <FaqItem
            q="هل يرى مشتركٌ آخر بيانات معتمري حملتي؟"
            a="لا — عزلُ البيانات مفروضٌ على مستوى قاعدة البيانات بـ Row-Level Security. حتّى عبر الـ API لا يستطيع أحدٌ تجاوزَ هذا الحدّ" />
          <FaqItem
            q="كيف يحجز المعتمر مقعدَه؟"
            a="تشارك رابطًا قصيرًا مخصَّصًا لحملتك — يفتحه المعتمر، يُسجِّل بياناته مرّةً واحدةً، يختار مقعده من خريطة الباص، ويصله الباركود فورًا" />
          <FaqItem
            q="هل يمكنني إضافة موظّفين ومشرفين؟"
            a="نعم — تستطيع دعوةَ مشرفين يديرون الرحلات، وموظّفين يمسحون التذاكر ويُسكّنون، وكلُّ دورٍ بصلاحيّاتٍ منضبطةٍ ولا يرى ما لا يخصّه" />
          <FaqItem
            q="هل الكشف يحمل علامة ملبّيك؟"
            a="لا — الكشفُ الرسميُّ يصدر بشعار حملتك واسمها فقط، جاهزٌ للطباعة والتسليم للجهات الرسميّة" />
          <FaqItem
            q="ما الذي يحدث بعد انتهاء تجربتي؟"
            a="نتواصل معك لاختيار باقةٍ تناسب حجم حملتك — لا يُحذف شيءٌ من بياناتك، تكمل من حيث توقّفت" />
        </div>
      </section>

      {/* ===== تثبيت كتطبيقٍ على الجوّال ===== */}
      <section className="lp-section">
        <InstallCard />
      </section>

      {/* ===== Footer ===== */}
      <footer className="lp-footer">
        <div className="lp-foot-cols">
          <div>
            <div className="lp-brand">
              <CompassMark size={32} />
              <span className="lp-brand-lockup">
                <strong>ملبّيك</strong>
                <em>mulabeek.com</em>
              </span>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 10, maxWidth: 320, lineHeight: 1.85, direction: 'rtl', unicodeBidi: 'embed' }}>
              منصّةٌ روحانيّةٌ هادئةٌ لإدارة حملات العُمرة، صُمِّمت بحبٍّ في المملكة العربيّة السعوديّة.
            </p>
            <div className="lp-social">
              <a href={CONTACT.twitter} target="_blank" rel="noopener noreferrer" aria-label="X (تويتر)">
                <SocialIcon name="x" />
              </a>
              <a href={CONTACT.instagram} target="_blank" rel="noopener noreferrer" aria-label="إنستغرام">
                <SocialIcon name="instagram" />
              </a>
              <a href={CONTACT.linkedin} target="_blank" rel="noopener noreferrer" aria-label="لينكدإن">
                <SocialIcon name="linkedin" />
              </a>
              <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener noreferrer" aria-label="واتسآب">
                <Icon name="whatsapp" size={18} />
              </a>
              <a href={`mailto:${CONTACT.email}`} aria-label="بريد إلكترونيّ">
                <Icon name="mail" size={18} />
              </a>
            </div>
          </div>
          <div>
            <h5>المنصّة</h5>
            <a href="#features">المميّزات</a>
            <a href="#how">كيف تبدأ</a>
            <Link to="/login">تسجيل دخول</Link>
            <Link to="/signup">إنشاء حساب</Link>
          </div>
          <div>
            <h5>الدعم</h5>
            <button type="button" className="lp-footer-link" onClick={() => setMsgMode('contact')}>تواصل معنا</button>
            <button type="button" className="lp-footer-link" onClick={() => setMsgMode('feedback')}>أرسل ملاحظة</button>
            <a href="#faq">الأسئلة الشائعة</a>
          </div>
          <div>
            <h5>قانونيٌّ</h5>
            <Link to="/terms">الشروط والأحكام</Link>
            <Link to="/privacy">سياسةُ الخصوصيّة</Link>
            <Link to="/terms">شروطُ الاستخدام</Link>
          </div>
        </div>

        {/* ===== شريطُ التوثيق — موثوقيّةٌ رسميّةٌ ===== */}
        <div className="lp-verify">
          <button
            type="button"
            className="lp-verify-card"
            onClick={() => setShowDoc(true)}
            title="عرضُ بيانات وثيقة العمل الحرّ"
          >
            <span className="lp-verify-ic"><Icon name="check" size={18} /></span>
            <span className="lp-verify-body">
              <span className="lp-verify-lbl">موثَّقةٌ في منصّة العمل الحرّ السعوديّة</span>
              <span className="lp-verify-no">رقم الوثيقة: <b className="ltr">{CONTACT.freelanceDocNumber}</b></span>
            </span>
            <Icon name="external" size={14} />
          </button>
        </div>

        <div className="lp-foot-line">
          <span>© ملبّيك · جميعُ الحقوق محفوظة</span>
          <span className="muted" style={{ fontSize: 12 }}>v1.0 · جاهزةٌ للتجربة الأولى</span>
        </div>
      </footer>

      {/* ===== مودال نموذج التواصل / الملاحظات ===== */}
      <PublicMessageModal
        open={!!msgMode}
        mode={msgMode || 'contact'}
        onClose={() => setMsgMode(null)}
      />

      {/* ===== مودال بيانات وثيقة العمل الحرّ ===== */}
      {showDoc && (
        <div
          className="doc-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="doc-modal-title"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDoc(false) }}
        >
          <div className="doc-modal">
            <div className="doc-modal-head">
              <div className="doc-modal-badge">
                <Icon name="check" size={20} />
              </div>
              <div>
                <h3 id="doc-modal-title">وثيقةُ العمل الحرّ</h3>
                <span className="doc-modal-sub">منصّة العمل الحرّ السعوديّة</span>
              </div>
              <button
                type="button"
                className="doc-modal-close"
                onClick={() => setShowDoc(false)}
                aria-label="إغلاق"
              >×</button>
            </div>

            <div className="doc-status">
              <span className="doc-status-dot" aria-hidden="true" />
              {FREELANCE_DOC.status}
            </div>

            <dl className="doc-fields">
              <div className="doc-row">
                <dt>الجهة الإشرافيّة</dt>
                <dd>{FREELANCE_DOC.authority}</dd>
              </div>
              <div className="doc-row">
                <dt>الفئة</dt>
                <dd>{FREELANCE_DOC.category}</dd>
              </div>
              <div className="doc-row">
                <dt>رقم الوثيقة</dt>
                <dd className="doc-copy">
                  <b className="ltr">{FREELANCE_DOC.number}</b>
                  <button
                    type="button"
                    className="doc-copy-btn"
                    onClick={copyDocNumber}
                    aria-label={copied ? 'تمّ النسخ' : 'انسخ رقم الوثيقة'}
                    title={copied ? 'تمّ النسخ' : 'انسخ رقم الوثيقة'}
                  >
                    {copied
                      ? <><Icon name="check" size={14} /> تمّ النسخ</>
                      : <><Icon name="copy" size={14} /> نسخ</>}
                  </button>
                </dd>
              </div>
              <div className="doc-row">
                <dt>الاسم</dt>
                <dd>{FREELANCE_DOC.holder}</dd>
              </div>
              <div className="doc-row">
                <dt>المهنة</dt>
                <dd>{FREELANCE_DOC.profession}</dd>
              </div>
              <div className="doc-row">
                <dt>تاريخ الإصدار</dt>
                <dd>{FREELANCE_DOC.issuedAt}</dd>
              </div>
            </dl>

            <p className="doc-note">
              للتحقّق الرسميّ: انسخ رقم الوثيقة بزرّ «نسخ»، ثمّ اضغط «تحقّق رسميًّا» — تفتح صفحةُ التحقّق في منصّة العمل الحرّ، الصق الرقم في خانة الاستعلام واضغط بحث.
            </p>

            <div className="doc-actions">
              <a
                href={CONTACT.freelanceVerifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-em btn-block"
              >
                <Icon name="external" size={15} /> تحقّق رسميًّا في freelance.sa
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => setShowDoc(false)}
              >إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
