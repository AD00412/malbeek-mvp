import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../app/useAuth'
import CompassMark from '../components/CompassMark'
import Icon from '../components/Icon'
import DebugPanel from '../components/DebugPanel'
import NotificationsBell from '../components/NotificationsBell'
import SideDrawer from '../components/SideDrawer'
import ThemeToggle from '../components/ThemeToggle'

const ROLE_LABEL = { admin: 'الإدارة', subscriber: 'المشترك', customer: 'العميل' }

function initials(name) {
  const n = (name || '').trim()
  return n ? n[0] : '؟'
}

/** شارة حالة الاتصال — تستمع لأحداث المتصفح */
function ConnectionPill() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return (
    <span className={`status-pill ${online ? '' : 'offline'}`}>
      <span className="ring" />
      {online ? 'متصل' : 'غير متصل'}
    </span>
  )
}

/**
 * هيكل اللوحة الموحد — موبايل أولا.
 * على الجوال: رأس + محتوى + شريط سفلي للتنقل (يأخذ `tabs`).
 * على سطح المكتب: شريط جانبي يستخدم نفس `tabs`.
 *
 * نمط موحد للأيقونات في الرأس (Popover): الإشعارات + الحساب
 * — لا BottomSheet للقوائم العلوية (تجنب مشكلات flex+RTL على iOS).
 *
 * @param {string}    title
 * @param {string}    subtitle
 * @param {Array}     tabs    [{ key, label, icon, badge, disabled, fab }]
 * @param {string}    active
 * @param {Function}  onTab
 * @param {ReactNode} actions   أزرار يسار الرأس (سطح المكتب)
 * @param {Function}  onNotifNavigate  معالج التنقل من إشعار
 */
export default function AppShell({ title, subtitle, tabs = [], active, onTab, actions, children, onNotifNavigate, planLabel, planUsage }) {
  const { profile, role } = useAuth()
  // سجلُّ التشخيص حصريٌّ للأدمن — يمنع تسريب تفاصيل تقنيّة (POST/GET/أخطاء)
  // للمشترك أو المعتمر. لا يُركَّب ولا يُفتَح لغير الأدمن إطلاقًا.
  const isAdmin = role === 'admin'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [debugOpen, setDebugOpen]   = useState(false)
  // ٣ نقرات على شعار «ملبّيك» خلال ثانيتين → لوحة التشخيص (للأدمن فقط)
  const tapsRef = useRef([])
  const triggerDebug = () => {
    if (!isAdmin) return
    const now = Date.now()
    tapsRef.current = [...tapsRef.current.filter((t) => now - t < 1500), now]
    if (tapsRef.current.length >= 3) {
      tapsRef.current = []
      setDebugOpen(true)
    }
  }

  // طرق فتح إضافية مضمونة:
  //   ١) #debug في الرابط (مثال: mulabeek.com/#debug)
  //   ٢) اختصار لوحة المفاتيح: Ctrl/Cmd + Shift + D
  useEffect(() => {
    if (!isAdmin) return undefined   // لا فتحَ بالهاش/الاختصار لغير الأدمن
    const checkHash = () => { if (location.hash === '#debug') setDebugOpen(true) }
    checkHash()
    window.addEventListener('hashchange', checkHash)
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault(); setDebugOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('hashchange', checkHash)
      document.removeEventListener('keydown', onKey)
    }
  }, [isAdmin])

  const navTabs = tabs.filter((t) => t.label) // عناصر التنقل (تستثني الفواصل)
  const bottomTabs = navTabs.slice(0, 5)      // الشريط السفلي يأخذ ٥ عناصر فقط
  // ★ تمركز زر الإجراء (FAB) في وسط الشريط دائما (الفهرس ٢ من ٥) مهما كان ترتيبه.
  const _fabIdx = bottomTabs.findIndex((t) => t.fab)
  if (_fabIdx > -1 && bottomTabs.length === 5 && _fabIdx !== 2) {
    const [_fab] = bottomTabs.splice(_fabIdx, 1)
    bottomTabs.splice(2, 0, _fab)
  }

  return (
    <div className="shell">
      {/* ---------- الشريط الجانبي (سطح المكتب) ---------- */}
      <aside className="sidebar">
        <div className="brand" onClick={triggerDebug} style={{ cursor: 'default', userSelect: 'none' }}>
          <CompassMark size={36} />
          <div>
            <div className="nm">ملبّيك</div>
            <span className="role-chip">{ROLE_LABEL[role] || 'مستخدم'}</span>
          </div>
        </div>

        <nav className="nav">
          {tabs.map((item, i) =>
            !item.label ? (
              <div className="nav-sec" key={'sec-' + i}>{item.section}</div>
            ) : (
              <button
                key={item.key}
                type="button"
                className={`nav-item ${active === item.key ? 'active' : ''}`}
                onClick={() => !item.disabled && onTab?.(item.key)}
                disabled={item.disabled}
                aria-current={active === item.key ? 'page' : undefined}
                style={item.disabled ? { opacity: .5, cursor: 'not-allowed' } : undefined}
              >
                <span className="ic"><Icon name={item.icon} size={20} /></span>
                {item.label}
                {item.badge != null && <span className="badge">{item.badge}</span>}
              </button>
            )
          )}
        </nav>

        <div className="foot">
          <div className="user-box">
            <div className="av">{initials(profile?.full_name)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="nm">{profile?.full_name || 'حسابي'}</div>
              <div className="ml">{ROLE_LABEL[role] || ''}</div>
            </div>
          </div>
          <div className="muted" style={{ marginTop: 8, fontSize: 11, textAlign: 'center' }}>
            تسجيل الخروج من رمز الحساب في الأعلى ↑
          </div>
        </div>
      </aside>

      {/* ---------- المنطقة الرئيسة ---------- */}
      <div className="main" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header className="topbar">
          <button type="button" className="icon-bubble tb-menu" aria-label="القائمة"
            onClick={() => setDrawerOpen(true)}>
            <Icon name="menu" size={18} />
          </button>
          <div className="tb-titles" onClick={triggerDebug} style={{ cursor: 'default', userSelect: 'none' }}>
            <div className="pg-title">{title}</div>
            {subtitle && <div className="pg-sub">{subtitle}</div>}
          </div>
          <span style={{ flex: 1 }} />
          <span className="hide-mobile"><ConnectionPill /></span>
          <ThemeToggle />
          <NotificationsBell onNavigate={onNotifNavigate} />
          {actions}
        </header>

        <main className="content">{children}</main>
      </div>

      {/* ---------- الدرج الجانبي (☰ على الجوال) ---------- */}
      <SideDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}
        tabs={tabs} active={active} onTab={onTab}
        planLabel={planLabel} planUsage={planUsage} />

      {/* ---------- الشريط السفلي (الجوال) ---------- */}
      <nav className="tabbar" aria-label="تنقل سفلي">
        {bottomTabs.map((t) => (
          t.fab ? (
            <div key={t.key} className="tab-cta-wrap">
              <button
                type="button"
                className="tab-cta"
                onClick={() => !t.disabled && onTab?.(t.key)}
                aria-label={t.label}
              >
                <Icon name={t.icon} size={24} />
              </button>
              <span className="lb">{t.label}</span>
            </div>
          ) : (
            <button
              key={t.key}
              type="button"
              className={`tab ${active === t.key ? 'active' : ''}`}
              onClick={() => !t.disabled && onTab?.(t.key)}
              disabled={t.disabled}
              aria-current={active === t.key ? 'page' : undefined}
              style={t.disabled ? { opacity: .45 } : undefined}
            >
              <span className="tb-ic"><Icon name={t.icon} size={20} /></span>
              {t.label}
            </button>
          )
        ))}
      </nav>

      {/* لوحة التشخيص — تفتح بـ٣ نقرات على شعار «ملبّيك» */}
      {isAdmin && <DebugPanel open={debugOpen} onClose={() => setDebugOpen(false)} />}
    </div>
  )
}
