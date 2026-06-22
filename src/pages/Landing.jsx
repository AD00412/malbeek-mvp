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
   ملبّيك — صفحة الترحيب
   هوية هادئة + لغة تسويقية متسقة + كل زر يعمل.
   ============================================================ */

// === أرقام ووصلات رسمية — حدثها بقيمك الحقيقية عند الإطلاق ===
const CONTACT = {
  email: 'hello@mulabeek.com',
  whatsapp: '966533579835',           // رقم واتسآب للأعمال (بدون + أو ٠٠)
  twitter: 'https://x.com/mulabeek',  // X (تويتر سابقا)
  instagram: 'https://instagram.com/mulabeek',
  linkedin: 'https://www.linkedin.com/company/mulabeek',
  // وثيقة العمل الحر — منصة العمل الحر السعودية (وزارة الموارد البشرية).
  // الرابط الرسمي يشترط دخول «نفاذ» — لذا نعرض البيانات مسبقا في مودال
  // الـ Landing، ونتيح زر التحقق الرسمي كخيار ثانوي للزائر المتشكك.
  freelanceDocNumber: 'FL-879416950',
  freelanceVerifyUrl: 'https://freelance.sa/certificate-validation',
}

// بيانات الوثيقة الرسمية كما تظهر في freelance.sa — تعرض في الـ Modal للزائر
// مباشرة لتفادي حاجز «نفاذ» دون التضحية بالشفافية.
const FREELANCE_DOC = {
  status: 'سارية',
  authority: 'وزارة الموارد البشرية والتنمية الاجتماعية',
  category: 'الخدمات التخصصية',
  number: 'FL-879416950',
  // الاسم الشخصي لحامل الوثيقة مقنع حفاظا على الخصوصية — تعرض الجهة
  // «إدارة ملبّيك» مع رقم الوثيقة الرسمي (FL-879416950) للمصداقية القانونية.
  holder: 'إدارة ملبّيك',
  profession: 'برمجة وتطوير المواقع الإلكترونية',
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

// أيقونات وسائل التواصل (X/Instagram/LinkedIn). مؤقتا غير مستخدمة في
// الفوتر حتى تتوفر الحسابات الرسمية، تعاد حينها مع روابط CONTACT.
// eslint-disable-next-line no-unused-vars
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
      // فشل الـ Clipboard API على بعض المتصفحات/البيئات — fallback يدوي
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

  // إغلاق المودال بمفتاح Escape + قفل تمرير الصفحة خلفه.
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
          <a href="#features">المميزات</a>
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
        <span className="lp-tag">منصة إدارة حملات العمرة</span>
        <h1>حملتك كاملة<br/>في مكان واحد</h1>
        <p>سجل المعتمرين، وزع المقاعد، اطبع الكشوف، وامسح التذاكر بالباركود — كل أدوات حملتك في مكان واحد وبسهولة.</p>
        <div className="lp-cta-row">
          <Link to="/signup" className="btn btn-em lp-cta">
            <Icon name="sparkle" size={17} /> ابدأ تجربتك المجانية
          </Link>
          <Link to="/login" className="btn btn-ghost lp-cta-alt">تسجيل دخول</Link>
        </div>
        <div className="lp-hero-meta">
          <span><Icon name="check" size={14} /> بدون بطاقة ائتمانية</span>
          <span><Icon name="check" size={14} /> رحلة كاملة مجانا</span>
          <span><Icon name="check" size={14} /> عربي بالكامل</span>
        </div>
      </section>

      {/* ===== بوصلة القبلة — قسم مستقل بحقه ===== */}
      <section className="lp-section-qibla lp-section-alt" id="qibla">
        <span className="qibla-section-tag">هدية للمعتمرين داخل المنصة</span>
        <h2 className="qibla-section-title">بوصلة القبلة، مباشرة على جوالك</h2>
        <p className="qibla-section-desc">تشتغل من حساسات جوالك مباشرة: اتجاه دقيق بالدرجات، ومسافة فعلية إلى الكعبة، وموقعك الحالي. هدية من ملبّيك لكل معتمر، وبدون تطبيق منفصل.</p>
        <QiblaCompass />
      </section>

      {/* ===== Features ===== */}
      <section id="features" className="lp-section">
        <span className="lp-sec-tag">المميزات</span>
        <h2>كل ما تحتاجه حملتك في منصة واحدة</h2>
        <div className="lp-feats">
          <Feature icon="customers" title="إدارة المعتمرين"
            body="استيراد جماعي من ملف، تعديل سريع، وبحث فوري بالاسم أو الهوية أو الجوال." />
          <Feature icon="seat" title="خريطة المقاعد"
            body="باص ثلاثي الأبعاد، اختيار ذاتي للمعتمر، وسياسة جلوس مرنة تحترم الخصوصية." />
          <Feature icon="manifest" title="الكشف الرسمي"
            body="ملف PDF بشعارك وختمك، جاهز للطباعة والتسليم للجهات الرسمية." />
          <Feature icon="qr" title="باركود ومسح مباشر"
            body="تذكرة صعود لكل معتمر بباركود، ومسح فوري بالكاميرا بلا طوابير." />
          <Feature icon="payments" title="إدارة الدفع"
            body="اربطها بمتجر زد أو سلة، أو أرفق إثبات التحويل يدويا حسب طريقتك." />
          <Feature icon="customers" title="فريق العمل"
            body="ادع مشرفين وموظفين بصلاحيات محددة، وكل واحد يرى ما يخصه فقط." />
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section id="how" className="lp-section lp-section-alt">
        <span className="lp-sec-tag">كيف تبدأ</span>
        <h2>من التسجيل إلى أول تذكرة في دقائق</h2>
        <div className="lp-steps">
          <Step n="١" title="أنشئ حسابك"
            body="بريد وكلمة مرور فقط، بلا أوراق ولا مكالمات ولا انتظار." />
          <Step n="٢" title="جهز حملتك"
            body="ارفع شعارك، أنشئ الرحلة، واضبط مقاعد الباص في دقائق." />
          <Step n="٣" title="شارك الرابط"
            body="رابط قصير مخصص لحملتك، يحجز المعتمر من خلاله ويوصله الباركود فورا." />
        </div>
      </section>

      {/* ===== Trust ===== */}
      <section className="lp-section">
        <div className="lp-trust">
          <div>
            <span className="lp-sec-tag">الأمان والخصوصية</span>
            <h2>بيانات كل حملة معزولة على مستوى القاعدة</h2>
            <p className="lp-lede">
              ما في حملة تشوف بيانات حملة ثانية. العزل مفروض على مستوى قاعدة البيانات،
              مع تشفير كامل للنقل، ونسخ احتياطي يومي، وكلمة مرور مشفرة لا نراها أبدا.
            </p>
            <ul className="lp-checks">
              <li><Icon name="check" size={15} /> عزل البيانات بـ Postgres RLS على مستوى القاعدة.</li>
              <li><Icon name="check" size={15} /> اتصال مشفر بالكامل عبر HTTPS و TLS 1.3.</li>
              <li><Icon name="check" size={15} /> كلمات المرور تدار عبر Supabase Auth، بلا تخزين محلي.</li>
              <li><Icon name="check" size={15} /> صلاحيات الإدارة مفصولة، تمنح من القاعدة لا عبر التسجيل.</li>
            </ul>
          </div>
          <aside className="lp-trust-card">
            <CompassMark size={80} />
            <div>
              <strong>الباقة التجريبية</strong>
              <p>رحلة كاملة بكل المميزات. جرب المنصة مع معتمرين حقيقيين قبل ما تقرر.</p>
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
        <h2>إجابات مباشرة قبل أن تسأل</h2>
        <div className="lp-faq">
          <FaqItem
            q="هل التجربة مجانية فعلا؟ وهل أحتاج بطاقة ائتمانية؟"
            a="نعم، التجربة مجانية بالكامل: رحلة واحدة بكل المميزات، بدون بطاقة ائتمانية وبدون أي التزام بالاشتراك بعدها." />
          <FaqItem
            q="هل يشوف مشترك ثاني بيانات معتمري حملتي؟"
            a="لا. عزل البيانات مفروض على مستوى قاعدة البيانات، وحتى عبر الـ API ما أحد يقدر يتجاوز هذا الحد." />
          <FaqItem
            q="كيف يحجز المعتمر مقعده؟"
            a="تشارك رابط قصير مخصص لحملتك، يفتحه المعتمر فيسجل بياناته مرة واحدة، يختار مقعده من خريطة الباص، ويوصله الباركود فورا." />
          <FaqItem
            q="أقدر أضيف موظفين ومشرفين؟"
            a="نعم. تقدر تدعو مشرفين يديرون الرحلات وموظفين يمسحون التذاكر ويسكنون، وكل دور بصلاحيات محددة ما يشوف إلا ما يخصه." />
          <FaqItem
            q="هل الكشف يحمل علامة ملبّيك؟"
            a="لا. الكشف الرسمي يصدر بشعار حملتك واسمها فقط، جاهز للطباعة والتسليم للجهات الرسمية." />
          <FaqItem
            q="وش يصير بعد ما تنتهي تجربتي؟"
            a="نتواصل معك لاختيار باقة تناسب حجم حملتك، وما ينحذف شي من بياناتك، فتكمل من حيث وقفت." />
        </div>
      </section>

      {/* ===== تثبيت كتطبيق على الجوال ===== */}
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
              منصة لإدارة حملات العمرة، صممت في المملكة العربية السعودية.
            </p>
            {/* قنوات التواصل الفعالة فقط (واتسآب + بريد). حسابات السوشيال
                (X/Instagram/LinkedIn) مؤقتا مخفية حتى تتوفر — أعدها من
                مكون SocialIcon + CONTACT حين تجهز. */}
            <div className="lp-social">
              <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener noreferrer" aria-label="واتسآب">
                <Icon name="whatsapp" size={18} />
              </a>
              <a href={`mailto:${CONTACT.email}`} aria-label="بريد إلكتروني">
                <Icon name="mail" size={18} />
              </a>
            </div>
          </div>
          <div>
            <h5>المنصة</h5>
            <a href="#features">المميزات</a>
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
            <h5>قانوني</h5>
            <Link to="/terms">الشروط والأحكام</Link>
            <Link to="/privacy">سياسة الخصوصية</Link>
            <Link to="/terms">شروط الاستخدام</Link>
          </div>
        </div>

        {/* ===== شريط التوثيق — موثوقية رسمية ===== */}
        <div className="lp-verify">
          <button
            type="button"
            className="lp-verify-card"
            onClick={() => setShowDoc(true)}
            title="عرض بيانات وثيقة العمل الحر"
          >
            <span className="lp-verify-ic"><Icon name="check" size={18} /></span>
            <span className="lp-verify-body">
              <span className="lp-verify-lbl">موثقة في منصة العمل الحر السعودية</span>
              <span className="lp-verify-no">رقم الوثيقة: <b className="ltr">{CONTACT.freelanceDocNumber}</b></span>
            </span>
            <Icon name="external" size={14} />
          </button>
        </div>

        <div className="lp-foot-line">
          <span>© ملبّيك · جميع الحقوق محفوظة</span>
          <span className="muted" style={{ fontSize: 12 }}>v1.0 · جاهزة للتجربة الأولى</span>
        </div>
      </footer>

      {/* ===== مودال نموذج التواصل / الملاحظات ===== */}
      <PublicMessageModal
        open={!!msgMode}
        mode={msgMode || 'contact'}
        onClose={() => setMsgMode(null)}
      />

      {/* ===== مودال بيانات وثيقة العمل الحر ===== */}
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
                <h3 id="doc-modal-title">وثيقة العمل الحر</h3>
                <span className="doc-modal-sub">منصة العمل الحر السعودية</span>
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
                <dt>الجهة الإشرافية</dt>
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
                    aria-label={copied ? 'تم النسخ' : 'انسخ رقم الوثيقة'}
                    title={copied ? 'تم النسخ' : 'انسخ رقم الوثيقة'}
                  >
                    {copied
                      ? <><Icon name="check" size={14} /> تم النسخ</>
                      : <><Icon name="copy" size={14} /> نسخ</>}
                  </button>
                </dd>
              </div>
              <div className="doc-row">
                <dt>الجهة</dt>
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
              للتحقق الرسمي: انسخ رقم الوثيقة بزر «نسخ»، ثم اضغط «تحقق رسميا» لتفتح صفحة التحقق في منصة العمل الحر، فالصق الرقم في خانة الاستعلام واضغط بحث.
            </p>

            <div className="doc-actions">
              <a
                href={CONTACT.freelanceVerifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-em btn-block"
              >
                <Icon name="external" size={15} /> تحقق رسميا في freelance.sa
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
