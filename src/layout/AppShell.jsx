import { useState } from 'react'
import { useAuth } from '../app/useAuth'
import CompassMark from '../components/CompassMark'
import Icon from '../components/Icon'

/* تسمية الدور بالعربية */
const ROLE_LABEL = { admin: 'الإدارة', subscriber: 'المشترك', customer: 'العميل' }

/* أوّل حرفٍ للأفاتار */
function initials(name) {
  const n = (name || '').trim()
  return n ? n[0] : '؟'
}

/**
 * هيكل اللوحة الموحّد: شريطٌ جانبيٌّ (تنقّل حسب الدور) + رأسٌ + محتوى.
 *
 * @param {string}   title    عنوان الصفحة في الرأس
 * @param {string}   subtitle وصفٌ صغيرٌ تحت العنوان
 * @param {Array}    nav      عناصر التنقّل [{ key, label, icon, badge }]
 * @param {string}   active   مفتاح العنصر النشط
 * @param {Function} onNav    عند اختيار عنصر (key) => void
 * @param {ReactNode} actions أزرارٌ في يسار الرأس (اختياري)
 */
export default function AppShell({ title, subtitle, nav = [], active, onNav, actions, children }) {
  const { profile, role, signOut } = useAuth()
  const [open, setOpen] = useState(false)

  const go = (key) => { onNav?.(key); setOpen(false) }

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <CompassMark size={36} />
          <div>
            <div className="nm">ملبّيك</div>
            <span className="role-chip">{ROLE_LABEL[role] || 'مستخدم'}</span>
          </div>
        </div>

        <nav className="nav">
          {nav.map((item) =>
            item.section ? (
              <div className="nav-sec" key={'sec-' + item.section}>{item.section}</div>
            ) : (
              <div
                key={item.key}
                className={`nav-item ${active === item.key ? 'active' : ''} ${item.disabled ? 'dim' : ''}`}
                onClick={() => !item.disabled && go(item.key)}
                style={item.disabled ? { cursor: 'not-allowed', opacity: .5 } : undefined}
                role="button"
                tabIndex={0}
              >
                <span className="ic"><Icon name={item.icon} size={20} /></span>
                {item.label}
                {item.badge != null && <span className="badge">{item.badge}</span>}
              </div>
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

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="القائمة">
            <Icon name="menu" size={18} />
          </button>
          <div>
            <div className="pg-title">{title}</div>
            {subtitle && <div className="pg-sub">{subtitle}</div>}
          </div>
          <span className="sp-grow" />
          {actions}
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  )
}
