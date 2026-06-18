import { useState } from 'react'
import Icon from './Icon'

/**
 * بطاقةٌ تشرح كيفيّة تثبيت ملبّيك كتطبيقٍ على الجوّال (PWA install).
 * تبويبان: iPhone/iPad و Android — كلٌّ بخطواتٍ مرقّمةٍ بأيقوناتٍ توضيحيّة.
 */
export default function InstallCard() {
  const [platform, setPlatform] = useState('ios')   // 'ios' | 'android'

  return (
    <section className="install-card" id="install">
      <div className="install-head">
        <span className="install-tag">تثبيتٌ بدون متجر</span>
        <h2>ثبّت ملبّيك على شاشتك الرئيسيّة</h2>
        <p>استخدمه كأيّ تطبيقٍ — رمزٌ على شاشتك، فتحٌ بضغطةٍ، شاشةٌ كاملةٌ بلا شريط متصفّحٍ</p>
      </div>

      <div className="install-switch" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={platform === 'ios'}
          className={platform === 'ios' ? 'active' : ''}
          onClick={() => setPlatform('ios')}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" style={{ marginInlineEnd: 6 }}>
            <path d="M17.05 13.05c.02 2.28 1.99 3.04 2.01 3.05-.02.05-.31 1.07-1.03 2.12-.62.91-1.27 1.81-2.29 1.83-1 .02-1.32-.59-2.46-.59-1.14 0-1.5.57-2.45.61-.99.04-1.74-.98-2.37-1.89-1.29-1.86-2.27-5.27-.95-7.57.66-1.14 1.83-1.86 3.11-1.88.97-.02 1.88.65 2.47.65.59 0 1.7-.81 2.86-.69.49.02 1.86.2 2.74 1.49-.07.04-1.64.96-1.62 2.87zM15.41 6.36c.55-.66.92-1.59.82-2.51-.79.03-1.74.53-2.31 1.19-.51.58-.95 1.52-.83 2.42.88.07 1.78-.45 2.32-1.1z"/>
          </svg>
          iPhone / iPad
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={platform === 'android'}
          className={platform === 'android' ? 'active' : ''}
          onClick={() => setPlatform('android')}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" style={{ marginInlineEnd: 6 }}>
            <path d="M7.1 4.5l-1-1.7c-.1-.2-.1-.4.1-.5.2-.1.4-.1.5.1l1 1.7c.9-.3 1.8-.5 2.8-.5 1 0 1.9.2 2.8.5l1-1.7c.1-.2.3-.2.5-.1.2.1.2.3.1.5l-1 1.7c1.8 1.1 3 2.9 3.1 5H4c.1-2.1 1.3-3.9 3.1-5zM8.6 7c0-.3-.3-.6-.6-.6s-.6.3-.6.6.3.6.6.6.6-.3.6-.6zm8 0c0-.3-.3-.6-.6-.6s-.6.3-.6.6.3.6.6.6.6-.3.6-.6zM4 10h16v8c0 .8-.7 1.5-1.5 1.5H17v3c0 .6-.4 1-1 1s-1-.4-1-1v-3H9v3c0 .6-.4 1-1 1s-1-.4-1-1v-3H5.5C4.7 19.5 4 18.8 4 18v-8zm-2 0c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1s-1-.4-1-1v-6c0-.6.4-1 1-1zm20 0c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1s-1-.4-1-1v-6c0-.6.4-1 1-1z"/>
          </svg>
          Android
        </button>
      </div>

      <ol className="install-steps">
        {platform === 'ios' ? (
          <>
            <li>
              <span className="install-num">١</span>
              <div className="install-step-body">
                <div className="install-step-title">افتح في Safari</div>
                <div className="install-step-desc">من iPhone أو iPad، استخدم Safari لا Chrome — التثبيت مدعومٌ في Safari فقط على iOS</div>
              </div>
              <span className="install-step-ic"><Icon name="external" size={18} /></span>
            </li>
            <li>
              <span className="install-num">٢</span>
              <div className="install-step-body">
                <div className="install-step-title">اضغط زرّ المشاركة</div>
                <div className="install-step-desc">المربّعُ مع سهمٍ صاعدٍ في شريط Safari السفليّ</div>
              </div>
              <span className="install-step-ic">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4M8 8l4-4 4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>
                </svg>
              </span>
            </li>
            <li>
              <span className="install-num">٣</span>
              <div className="install-step-body">
                <div className="install-step-title">اختر «إضافة إلى الشاشة الرئيسيّة»</div>
                <div className="install-step-desc">Add to Home Screen — أيقونةُ + المربّعة</div>
              </div>
              <span className="install-step-ic"><Icon name="plus" size={18} /></span>
            </li>
            <li>
              <span className="install-num">٤</span>
              <div className="install-step-body">
                <div className="install-step-title">اضغط «إضافة»</div>
                <div className="install-step-desc">يظهر رمزُ ملبّيك على شاشتك الرئيسيّة — افتحه كأيّ تطبيق</div>
              </div>
              <span className="install-step-ic ok"><Icon name="check" size={18} /></span>
            </li>
          </>
        ) : (
          <>
            <li>
              <span className="install-num">١</span>
              <div className="install-step-body">
                <div className="install-step-title">افتح في Chrome</div>
                <div className="install-step-desc">من جوّالك Android، فضّل Chrome أو Edge — متصفّحات تدعم تثبيت التطبيقات</div>
              </div>
              <span className="install-step-ic"><Icon name="external" size={18} /></span>
            </li>
            <li>
              <span className="install-num">٢</span>
              <div className="install-step-body">
                <div className="install-step-title">افتح القائمة (⋮)</div>
                <div className="install-step-desc">النقاط الثلاث العموديّة في أعلى يمين Chrome</div>
              </div>
              <span className="install-step-ic">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                </svg>
              </span>
            </li>
            <li>
              <span className="install-num">٣</span>
              <div className="install-step-body">
                <div className="install-step-title">اختر «تثبيت التطبيق»</div>
                <div className="install-step-desc">Install app — أو «إضافة إلى الشاشة الرئيسيّة»</div>
              </div>
              <span className="install-step-ic"><Icon name="download" size={18} /></span>
            </li>
            <li>
              <span className="install-num">٤</span>
              <div className="install-step-body">
                <div className="install-step-title">تأكيد التثبيت</div>
                <div className="install-step-desc">رمزُ ملبّيك ينضمّ لتطبيقاتك — يفتح بشاشةٍ كاملةٍ بلا شريطٍ</div>
              </div>
              <span className="install-step-ic ok"><Icon name="check" size={18} /></span>
            </li>
          </>
        )}
      </ol>

      <div className="install-foot">
        بعد التثبيت يفتح ملبّيك بشاشةٍ كاملةٍ — بلا شريطِ متصفّحٍ — كأيّ تطبيقٍ أصليٍّ
      </div>
    </section>
  )
}
