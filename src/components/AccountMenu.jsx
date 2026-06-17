import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../app/useAuth'
import Icon from './Icon'
import { useUI } from '../lib/useUI'

const ROLE_LABEL = { admin: 'الإدارة', subscriber: 'صاحب الحملة', customer: 'المعتمر' }

function initials(name, email) {
  const n = (name || '').trim()
  if (n) return n[0]
  const e = (email || '').trim()
  return e ? e[0].toUpperCase() : '؟'
}

/**
 * زرّ الحساب + قائمةٌ منسدلةٌ صغيرة (Popover) تظهر تحت الأڤتار مباشرةً.
 *
 * استبدال متعمَّد لـ BottomSheet — على iOS Safari، يتفاعل flex+RTL أحيانًا بشكلٍ غريبٍ
 * فيتسبّب في ظهور الورقة في أعلى الشاشة بدل أسفلها. القائمة المنسدلة هنا تتموضع
 * بـ position:absolute داخل الرأس الثابت — مضمونةٌ على كلّ المتصفّحات.
 */
export default function AccountMenu() {
  const { profile, user, role, signOut } = useAuth()
  const { confirm, toast } = useUI()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)

  const name = profile?.full_name || 'حسابي'
  const email = user?.email || ''
  const av = initials(profile?.full_name, email)

  // أغلق القائمة بنقرةٍ خارجها، أو بـ Escape
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function doSignOut() {
    if (busy) return
    setOpen(false)
    const ok = await confirm({
      title: 'تسجيل الخروج',
      message: 'هل أنت متأكّدٌ من تسجيل الخروج؟ ستحتاج إلى الدخول مرّةً أخرى.',
      confirmText: 'تسجيل الخروج',
    })
    if (!ok) return
    setBusy(true)
    try { await signOut() }
    catch (e) { toast('تعذّر تسجيل الخروج — حاول مجدّدًا.', { type: 'error' }); setBusy(false) }
  }

  async function copyEmail() {
    if (!email) return
    try { await navigator.clipboard.writeText(email); toast('نُسخ البريد ✓', { type: 'success' }) }
    catch { toast(email, { type: 'info' }) }
  }

  return (
    <div className="acct-wrap" ref={wrapRef}>
      <button type="button" className="acct-btn" onClick={() => setOpen((v) => !v)}
        aria-label="حسابي" aria-haspopup="menu" aria-expanded={open}>
        <span className="acct-av">{av}</span>
      </button>

      {open && (
        <div className="acct-pop" role="menu">
          <div className="acct-pop-card">
            <div className="acct-pop-av">{av}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="acct-pop-nm">{name}</div>
              {email && (
                <button className="acct-pop-em ltr" onClick={copyEmail} title="نسخ البريد">
                  {email} <Icon name="copy" size={11} />
                </button>
              )}
              <span className="acct-pop-role">{ROLE_LABEL[role] || 'مستخدم'}</span>
            </div>
          </div>

          <div className="acct-pop-divider" />

          <button className="acct-pop-item" role="menuitem" disabled>
            <Icon name="settings" size={16} />
            <span>الإعدادات</span>
            <span className="acct-pop-soon">قريبًا</span>
          </button>

          <button className="acct-pop-item danger" role="menuitem" onClick={doSignOut} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="logout" size={16} /><span>تسجيل الخروج</span></>}
          </button>
        </div>
      )}
    </div>
  )
}
