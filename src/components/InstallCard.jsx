import { useEffect, useState } from 'react'
import Icon from './Icon'

/**
 * بطاقة تثبيت ملبّيك كتطبيق (PWA).
 *
 * منطق ذكي:
 *  - Android/Desktop Chrome/Edge: يلتقط حدث ‎beforeinstallprompt‎ → زر
 *    واحد «ثبت الآن» يشغل المحاورة الأصلية بضغطة.
 *  - iOS Safari: لا يدعم التثبيت البرمجي — نعرض الخطوات اليدوية.
 *  - تطبيق مثبت بالفعل: يعرض رسالة «ملبّيك مثبت ✓».
 */
export default function InstallCard() {
  const [platform, setPlatform] = useState('ios')        // 'ios' | 'android'
  const [installEvent, setInstallEvent] = useState(null) // حدث beforeinstallprompt المحفوظ
  const [installed, setInstalled] = useState(false)
  const [installing, setInstalling] = useState(false)

  // ١) اكتشاف المنصة تلقائيا للتبويب الافتراضي + التحقق من حالة التثبيت
  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent || ''
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    setPlatform(isIOS ? 'ios' : 'android')

    // مثبت بالفعل؟ (PWA يفتح بـ standalone)
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true
    if (standalone) setInstalled(true)
  }, [])

  // ٢) التقاط حدث التثبيت لـ Android/Chrome
  useEffect(() => {
    function onBeforeInstall(e) {
      e.preventDefault()
      setInstallEvent(e)
    }
    function onInstalled() {
      setInstalled(true)
      setInstallEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // ٣) تشغيل التثبيت بضغطة (Android/Chrome فقط)
  async function quickInstall() {
    if (!installEvent || installing) return
    setInstalling(true)
    try {
      await installEvent.prompt()
      const choice = await installEvent.userChoice
      if (choice?.outcome === 'accepted') setInstalled(true)
    } catch (_) { /* المستخدم أغلق المحاورة — لا حاجة لمعالجة */ }
    setInstalling(false)
    setInstallEvent(null)
  }

  // ٤) إن كان مثبتا — حالة الاحتفال
  if (installed) {
    return (
      <section className="install-card install-installed" id="install">
        <div className="install-installed-ic"><Icon name="check" size={32} /></div>
        <h2>ملبّيك مثبت ✓</h2>
        <p>تطبيق ملبّيك على شاشتك الرئيسية، افتحه مباشرة من هناك بشاشة كاملة.</p>
      </section>
    )
  }

  const canQuickInstall = !!installEvent && platform === 'android'

  return (
    <section className="install-card" id="install">
      <div className="install-head">
        <span className="install-tag">تثبيت عبر المتصفح</span>
        <h2>ثبت ملبّيك على شاشتك الرئيسية</h2>
        <p>استخدمه كأي تطبيق، رمز على شاشتك، فتح بضغطة، شاشة كاملة بلا شريط متصفح</p>
      </div>

      {/* زر التثبيت بضغطة — لـ Android/Chrome فقط (iOS لا يدعمه) */}
      {canQuickInstall && (
        <div className="install-quick">
          <button type="button" className="btn btn-em install-quick-btn" onClick={quickInstall} disabled={installing}>
            {installing
              ? <><span className="spinner" /> جار التثبيت…</>
              : <><Icon name="download" size={17} /> ثبت الآن بضغطة</>}
          </button>
          <div className="install-quick-hint">يفتح Android محاورة التثبيت الرسمية مباشرة</div>
        </div>
      )}

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
            <path d="M17.6 9.48l1.84-3.18a.39.39 0 0 0-.14-.54.39.39 0 0 0-.54.14L16.92 9.1a11.43 11.43 0 0 0-9.84 0L5.24 5.9a.39.39 0 0 0-.54-.14.39.39 0 0 0-.14.54l1.84 3.18A10.81 10.81 0 0 0 1 18h22a10.81 10.81 0 0 0-5.4-8.52zM7 15.25A1.25 1.25 0 1 1 8.25 14 1.25 1.25 0 0 1 7 15.25zm10 0A1.25 1.25 0 1 1 18.25 14 1.25 1.25 0 0 1 17 15.25z"/>
          </svg>
          Android
        </button>
      </div>

      {/* خطوات يدوية — تظهر دائما (للـ iOS، أو لـ Android بدون beforeinstallprompt) */}
      <div className="install-steps-wrap">
        {platform === 'android' && canQuickInstall && (
          <div className="install-steps-note">أو يدويا، الخطوات التالية:</div>
        )}
        <ol className="install-steps">
          {platform === 'ios' ? (
            <>
              <li>
                <span className="install-num">١</span>
                <div className="install-step-body">
                  <div className="install-step-title">افتح في Safari</div>
                  <div className="install-step-desc">من iPhone أو iPad، فالتثبيت مدعوم في Safari فقط على iOS</div>
                </div>
                <span className="install-step-ic"><Icon name="external" size={18} /></span>
              </li>
              <li>
                <span className="install-num">٢</span>
                <div className="install-step-body">
                  <div className="install-step-title">اضغط زر المشاركة</div>
                  <div className="install-step-desc">المربع مع سهم صاعد في شريط Safari السفلي</div>
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
                  <div className="install-step-title">اختر «إضافة إلى الشاشة الرئيسية»</div>
                  <div className="install-step-desc">«Add to Home Screen» بأيقونة + المربعة</div>
                </div>
                <span className="install-step-ic"><Icon name="plus" size={18} /></span>
              </li>
              <li>
                <span className="install-num">٤</span>
                <div className="install-step-body">
                  <div className="install-step-title">اضغط «إضافة»</div>
                  <div className="install-step-desc">يظهر رمز ملبّيك على شاشتك الرئيسية، افتحه كأي تطبيق</div>
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
                  <div className="install-step-desc">Chrome أو Edge على Android يدعمان التثبيت</div>
                </div>
                <span className="install-step-ic"><Icon name="external" size={18} /></span>
              </li>
              <li>
                <span className="install-num">٢</span>
                <div className="install-step-body">
                  <div className="install-step-title">افتح القائمة (⋮)</div>
                  <div className="install-step-desc">النقاط الثلاث العمودية في أعلى يمين Chrome</div>
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
                  <div className="install-step-desc">«Install app» أو «إضافة إلى الشاشة الرئيسية»</div>
                </div>
                <span className="install-step-ic"><Icon name="download" size={18} /></span>
              </li>
              <li>
                <span className="install-num">٤</span>
                <div className="install-step-body">
                  <div className="install-step-title">تأكيد التثبيت</div>
                  <div className="install-step-desc">رمز ملبّيك ينضم لتطبيقاتك بشاشة كاملة</div>
                </div>
                <span className="install-step-ic ok"><Icon name="check" size={18} /></span>
              </li>
            </>
          )}
        </ol>
      </div>

      <div className="install-foot">
        بعد التثبيت يفتح ملبّيك بشاشة كاملة بلا شريط متصفح، كأي تطبيق أصلي
      </div>
    </section>
  )
}
