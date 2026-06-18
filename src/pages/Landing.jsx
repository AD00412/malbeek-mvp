import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../app/useAuth'
import { homeForRole, ScreenLoader } from '../app/RequireAuth'
import CompassMark from '../components/CompassMark'
import Icon from '../components/Icon'

/* ============================================================
   ملبّيك — Landing
   صفحةُ الزائر غير المسجّل: تقديمٌ روحيٌّ هادئٌ، ميزاتٌ، ودعوةٌ صريحةٌ
   للتسجيل المجانيّ. هويّةُ ملبّيك المعتمَدة (زمرّديّ + ذهبيّ)، عربيٌّ
   RTL، متجاوبٌ من الموبايل إلى سطح المكتب.
   ============================================================ */

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

export default function Landing() {
  const { session, role, loading } = useAuth()

  // المسجَّلون يُوجَّهون مباشرةً إلى لوحاتهم — لا يرون صفحة الترحيب.
  if (loading) return <ScreenLoader />
  if (session) return <Navigate to={homeForRole(role)} replace />

  return (
    <div className="lp">
      {/* ===== Topbar ===== */}
      <header className="lp-top">
        <div className="lp-brand">
          <CompassMark size={36} />
          <span className="lp-brand-lockup">
            <strong>ملبّيك</strong>
            <em>mulabeek.com</em>
          </span>
        </div>
        <nav className="lp-top-nav">
          <a href="#features">المميّزات</a>
          <a href="#how">كيف تبدأ</a>
          <a href="#faq">الأسئلة</a>
          <Link to="/login" className="btn btn-ghost btn-sm">دخول</Link>
        </nav>
      </header>

      {/* ===== Hero ===== */}
      <section className="lp-hero">
        <div className="lp-hero-mark"><CompassMark size={92} /></div>
        <span className="lp-tag">منصّةُ إدارةِ حملات العُمرة</span>
        <h1>كلُّ رحلتك في مكانٍ واحد.</h1>
        <p>سجِّل المعتمرين، اختر مقاعدَهم، أصدِر الكشوف، وامسح التذاكر —
          بأناقةٍ هادئةٍ تليق برحلةٍ روحانيّة.</p>
        <div className="lp-cta-row">
          <Link to="/signup" className="btn btn-gold lp-cta">
            <Icon name="sparkle" size={17} /> ابدأ تجربتك المجانيّة
          </Link>
          <Link to="/login" className="btn btn-ghost lp-cta-alt">دخولٌ بحسابي</Link>
        </div>
        <div className="lp-hero-meta">
          <span><Icon name="check" size={14} /> بدون بطاقةٍ ائتمانيّة</span>
          <span><Icon name="check" size={14} /> تجربةٌ لرحلةٍ كاملة</span>
          <span><Icon name="check" size={14} /> عربيٌّ كاملًا</span>
        </div>
      </section>

      {/* ===== Features ===== */}
      <section id="features" className="lp-section">
        <span className="lp-sec-tag">ما تحصل عليه</span>
        <h2>أدواتٌ تشغيليّةٌ كاملةٌ — بلا ضوضاءٍ.</h2>
        <div className="lp-feats">
          <Feature icon="customers" title="إدارة المعتمرين"
            body="استيرادٌ من ملفّ، تعديلٌ سريع، بحثٌ فوريٌّ بالاسم أو الهويّة أو الجوال." />
          <Feature icon="seat" title="خريطة المقاعد"
            body="باصٌ ثلاثيّ الأبعاد، اختيارٌ ذاتيٌّ للمعتمر، سياسة جلوسٍ مرنة." />
          <Feature icon="manifest" title="الكشف الرسميّ"
            body="PDF بشعارِك وختمك — جاهزٌ للطباعة، بلا علامة ملبّيك." />
          <Feature icon="qr" title="باركودٌ ومسحٌ حيٌّ"
            body="تذكرةٌ لكلّ معتمرٍ مع QR — مسحٌ بالكاميرا للصعود والتسكين." />
          <Feature icon="payments" title="إدارة الدفع"
            body="ربطٌ بمتجر زِد أو سلّة، أو إثباتٌ مرفقٌ يدويًّا — كلٌّ بحسب حملته." />
          <Feature icon="customers" title="فِرَقُ العمل"
            body="ادعُ مشرفين وموظّفين بصلاحيّاتٍ منضبطة. كلٌّ يرى ما يخصّه." />
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section id="how" className="lp-section lp-section-alt">
        <span className="lp-sec-tag">٣ خطواتٍ للبدء</span>
        <h2>من التسجيل إلى أوّل تذكرة.</h2>
        <div className="lp-steps">
          <Step n="١" title="أنشئ حسابك"
            body="بضع ثوانٍ. بريدٌ وكلمة مرور — لا أوراقَ، لا مكالماتٍ." />
          <Step n="٢" title="جهّز حملتك"
            body="رفعُ شعارك، إنشاء الرحلة، وضبط الباص. كلّ ذلك خلال دقائق." />
          <Step n="٣" title="شارك الرابط"
            body="رابطٌ مختصرٌ مخصَّصٌ لحملتك — يدخل المعتمر، يحجز، ويحصل على تذكرته." />
        </div>
      </section>

      {/* ===== Trust ===== */}
      <section className="lp-section">
        <div className="lp-trust">
          <div>
            <span className="lp-sec-tag">آمنٌ بحكم البناء</span>
            <h2>بياناتُ كلّ حملةٍ معزولةٌ على مستوى القاعدة.</h2>
            <p className="lp-lede">
              لا حملةَ ترى بيانات حملةٍ أخرى — Row-Level Security مفعَّلٌ على كلّ جدول.
              التشفيرُ الكاملُ للنقل، نسخٌ احتياطيٌّ يوميٌّ، ومتطلّباتُ تأكيدٍ ثنائيّ
              التحقّق للإدارة.
            </p>
            <ul className="lp-checks">
              <li><Icon name="check" size={15} /> عزلٌ بيانيٌّ بـ Postgres RLS — مفروضٌ على مستوى الـ DB</li>
              <li><Icon name="check" size={15} /> HTTPS صارمٌ، الاتّصال بالقاعدة مشفَّر</li>
              <li><Icon name="check" size={15} /> لا تخزينَ كلمات مرورٍ — مفوَّضٌ لـ Supabase Auth</li>
              <li><Icon name="check" size={15} /> الإدارة مفصولةٌ — تُمنح من القاعدة فقط، لا عبر التسجيل</li>
            </ul>
          </div>
          <aside className="lp-trust-card">
            <CompassMark size={80} variant="gold" />
            <div>
              <strong>الباقة التجريبيّة</strong>
              <p>رحلةٌ واحدةٌ كاملةٌ بكلّ المميّزات — اختبر منصّتك مع معتمرين حقيقيّين قبل أن تقرّر.</p>
              <Link to="/signup" className="btn btn-gold btn-block">
                ابدأ التجربة الآن
              </Link>
            </div>
          </aside>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="lp-section lp-section-alt">
        <span className="lp-sec-tag">الأسئلة الشائعة</span>
        <h2>إجاباتٌ مباشرةٌ — قبل أن تسأل.</h2>
        <div className="lp-faq">
          <FaqItem
            q="هل تجربتي مجانيّةٌ فعلًا؟ هل تحتاج بطاقةً ائتمانيّةً؟"
            a="نعم، التجربة مجانيّةٌ تمامًا — رحلةٌ واحدةٌ كاملةٌ بكلّ المميّزات. لا بطاقةَ ائتمانيّةٍ ولا التزامَ بالاشتراك بعد التجربة." />
          <FaqItem
            q="هل يرى مشتركٌ آخر بيانات معتمري حملتي؟"
            a="لا. عزل البيانات مفروضٌ على مستوى قاعدة البيانات بـ Row-Level Security — كلّ حملةٍ ترى بيانات معتمريها فقط، حتّى عبر الـ API لا يمكن لأحدٍ تجاوز هذا الحدّ." />
          <FaqItem
            q="كيف يحجز المعتمر مقعدَه؟"
            a="تشارك رابطًا قصيرًا مخصَّصًا لحملتك. يفتحه المعتمر، يُسجِّل بياناته مرّةً واحدةً، يختار مقعده من خريطة الباص، ويصله الباركود فورًا." />
          <FaqItem
            q="هل يمكنني إضافة موظّفين ومشرفين؟"
            a="نعم — تستطيع دعوة مشرفين (يديرون الرحلات) وموظّفين (يمسحون التذاكر ويُسكّنون). كلّ دورٍ بصلاحيّاتٍ منضبطةٍ، ولا يرى ما لا يخصّه." />
          <FaqItem
            q="هل الكشف يحمل علامة ملبّيك؟"
            a="لا. الكشف الرسميّ يصدر بشعار حملتك واسمها فقط — جاهزٌ للطباعة وتسليمه للجهات الرسميّة." />
          <FaqItem
            q="ما الذي يحدث بعد انتهاء تجربتي؟"
            a="نتواصل معك لاختيار باقةٍ تناسب حجم حملتك. لا يُحذف شيءٌ من بياناتك — تكمل من حيث توقّفت." />
        </div>
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
            <p className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 320 }}>
              منصّةٌ روحانيّةٌ هادئةٌ لإدارة حملات العمرة — صُمّمت بحبٍّ في السعوديّة.
            </p>
          </div>
          <div>
            <h5>المنصّة</h5>
            <a href="#features">المميّزات</a>
            <a href="#how">كيف تبدأ</a>
            <Link to="/login">دخول</Link>
            <Link to="/signup">إنشاء حساب</Link>
          </div>
          <div>
            <h5>عن ملبّيك</h5>
            <a href="mailto:hello@mulabeek.com">تواصل</a>
            <a href="#faq">الأسئلة الشائعة</a>
          </div>
        </div>
        <div className="lp-foot-line">
          <span>© ملبّيك — جميع الحقوق محفوظة.</span>
          <span className="muted" style={{ fontSize: 12 }}>v1.0 · جاهزةٌ للتجربة الأولى</span>
        </div>
      </footer>
    </div>
  )
}
