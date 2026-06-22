import { useEffect, useRef } from 'react'
import { useAuth } from '../app/useAuth'
import { useUI } from '../lib/useUI'
import Icon from './Icon'
import CompassMark from './CompassMark'

const ROLE_LABEL = { admin: 'الإدارة', subscriber: 'مشترك ملبّيك', customer: 'معتمر' }

function initials(name, email) {
  const n = (name || '').trim()
  if (n) return n[0]
  return (email || '').trim()[0]?.toUpperCase() || '؟'
}

/**
 * درج جانبي ينزلق من جهة البدء (RTL: من اليمين، LTR: من اليسار).
 * يفتح بضغطة ☰ في الرأس، يغلق بنقرة خارجه/Escape/زر ×.
 * المحتوى: بطاقة مستخدم + قائمة تنقل كاملة + استهلاك الباقة + خروج.
 *
 * @param {boolean}  open
 * @param {Function} onClose
 * @param {Array}    tabs          نفس بنية AppShell: {key,label,icon,badge,disabled,fab,section}
 * @param {string}   active
 * @param {Function} onTab         (key) => void
 * @param {string}   planLabel     سطر تحت الاسم (مثلا: "باقة ملبّيك" أو "تجريبية")
 * @param {object}   planUsage     { used, limit } لإظهار شريط الباقة (للمشترك)
 */
export default function SideDrawer({ open, onClose, tabs = [], active, onTab, planLabel, planUsage }) {
  const { profile, user, role, signOut } = useAuth()
  const { confirm } = useUI()
  const cardRef = useRef(null)

  // قفل التمرير + Escape + استرداد التركيز
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    setTimeout(() => cardRef.current?.focus?.(), 0)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  async function doSignOut() {
    onClose?.()
    const ok = await confirm({
      title: 'تسجيل الخروج',
      message: 'هل أنت متأكد؟ ستحتاج إلى الدخول مرة أخرى.',
      confirmText: 'تسجيل الخروج',
    })
    if (ok) await signOut()
  }

  const name = profile?.full_name || 'حسابي'
  const email = user?.email || ''
  const av = initials(profile?.full_name, email)

  // فلتر العناصر للعرض في الدرج (نظهر كل شيء، حتى ما لا يدخل tabbar السفلي)
  const items = tabs.filter((t) => t.label)
  const usagePct = planUsage && planUsage.limit > 0 ? Math.min(100, Math.round((planUsage.used / planUsage.limit) * 100)) : null

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer-card"
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="قائمة التنقل"
        tabIndex={-1}
      >
        <header className="drawer-head">
          <div className="drawer-user">
            <div className="drawer-av">{av}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="drawer-nm">{name}</div>
              <div className="drawer-sub">{planLabel || ROLE_LABEL[role] || ''}</div>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="إغلاق">×</button>
        </header>

        {/* قائمة التنقل — تمر على tabs بترتيبها (مع الفواصل/الأقسام) */}
        <nav className="drawer-nav" aria-label="تنقل رئيسي">
          {tabs.map((it, i) => {
            if (!it.label) return <div key={'s' + i} className="drawer-sec">{it.section}</div>
            return (
              <button
                key={it.key}
                type="button"
                className={`drawer-item ${active === it.key ? 'active' : ''}`}
                onClick={() => { if (!it.disabled) { onTab?.(it.key); onClose?.() } }}
                disabled={it.disabled}
              >
                <span className="drawer-ic"><Icon name={it.icon} size={18} /></span>
                <span className="drawer-lb">{it.label}</span>
                {it.badge != null && <span className="drawer-badge">{it.badge}</span>}
              </button>
            )
          })}
        </nav>

        {/* استهلاك الباقة (يظهر فقط إن مرر المضيف planUsage) */}
        {usagePct != null && (
          <div className="drawer-plan">
            <div className="drawer-plan-row">
              <span style={{ flex: 1, color: 'var(--cr-100)', fontSize: 13, fontWeight: 600 }}>استهلاك الباقة</span>
              <span style={{ fontFamily: 'var(--font-display)', color: usagePct >= 100 ? 'var(--danger-ink)' : 'var(--gd-300)', fontWeight: 700 }}>
                {planUsage.used}/{planUsage.limit}
              </span>
            </div>
            <div className={`drawer-plan-bar ${usagePct >= 100 ? 'full' : ''}`}><span style={{ width: usagePct + '%' }} /></div>
            {usagePct >= 100 && (
              <div className="drawer-plan-hint">
                وصلت سقف الباقة التجريبية — اطلب ترقية للوصول لحملات غير محدودة.
              </div>
            )}
          </div>
        )}

        <button className="drawer-logout" onClick={doSignOut}>
          <Icon name="logout" size={16} /> <span>تسجيل الخروج</span>
        </button>

        {email && (
          <div className="drawer-foot ltr">
            <CompassMark size={14} /> <span style={{ fontSize: 11, color: 'var(--cr-300)', marginInlineStart: 6 }}>{email}</span>
          </div>
        )}
      </aside>
    </div>
  )
}
