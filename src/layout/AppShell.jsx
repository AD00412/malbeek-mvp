import { useEffect, useState } from 'react'
import { useAuth } from '../app/useAuth'
import CompassMark from '../components/CompassMark'
import Icon from '../components/Icon'

const ROLE_LABEL = { admin: 'الإدارة', subscriber: 'المشترك', customer: 'العميل' }

function initials(name) {
  const n = (name || '').trim()
  return n ? n[0] : '؟'
}

/** شارة حالة الاتصال — تستمع لأحداث المتصفّح */
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
      {online ? 'متّصل' : 'غير متّصل'}
    </span>
  )
}

/**
 * هيكل اللوحة الموحّد — موبايل أوّلًا.
 * على الجوال: رأسٌ + محتوى + شريطٌ سفليٌّ للتنقّل (يأخذ `tabs`).
 * على سطح المكتب: شريطٌ جانبيٌّ يستخدم نفس `tabs`.
 *
 * @param {string}   title
 * @param {string}   subtitle
 * @param {Array}    tabs    [{ key, label, icon, badge, disabled, fab }]  fab=true يجعل العنصر FAB المركزي
 * @param {string}   active
 * @param {Function} onTab
 * @param {ReactNode} actions  أزرارٌ يسار الرأس (سطح المكتب)
 */
export default function AppShell({ title, subtitle, tabs = [], active, onTab, actions, children }) {
  const { profile, role, signOut } = useAuth()

  const navTabs = tabs.filter((t) => t.label) // عناصر التنقّل (تستثني الفواصل)
  const bottomTabs = navTabs.slice(0, 5)      // الشريط السفلي يأخذ ٥ عناصر فقط

  return (
    <div className="shell">
      {/* ---------- الشريط الجانبي (سطح المكتب) ---------- */}
      <aside className="sidebar">
        <div className="brand">
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
            <div>
              <div className="nm">{profile?.full_name || 'حسابي'}</div>
              <div className="ml">{ROLE_LABEL[role] || ''}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-block btn-sm" style={{ marginTop: 10 }} onClick={signOut}>
            <Icon name="logout" size={17} /> تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* ---------- المنطقة الرئيسة ---------- */}
      <div className="main" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header className="topbar">
          <div>
            <div className="pg-title">{title}</div>
            {subtitle && <div className="pg-sub">{subtitle}</div>}
          </div>
          <span style={{ flex: 1 }} />
          <ConnectionPill />
          <button type="button" className="icon-bubble" aria-label="الإشعارات">
            <Icon name="bell" size={18} />
          </button>
          {actions}
        </header>

        <main className="content">{children}</main>
      </div>

      {/* ---------- الشريط السفلي (الجوال) ---------- */}
      <nav className="tabbar" aria-label="تنقّل سفلي">
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
              style={t.disabled ? { opacity: .45 } : undefined}
            >
              <span className="tb-ic"><Icon name={t.icon} size={20} /></span>
              {t.label}
            </button>
          )
        ))}
      </nav>
    </div>
  )
}
