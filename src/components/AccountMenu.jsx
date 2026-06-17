import { useState } from 'react'
import { useAuth } from '../app/useAuth'
import BottomSheet from './BottomSheet'
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
 * زرّ الحساب — أيقونةٌ دائريّةٌ بالاسم الأوّل تظهر في رأس اللوحة (جوّال+سطح مكتب).
 * تفتح ورقةً سفليّةً تحوي بيانات المستخدم + تسجيل الخروج.
 * تحلّ مشكلة غياب «تسجيل خروج» من الجوّال (كان موجودًا في الشريط الجانبيّ فقط).
 */
export default function AccountMenu() {
  const { profile, user, role, signOut } = useAuth()
  const { confirm, toast } = useUI()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const name = profile?.full_name || 'حسابي'
  const email = user?.email || ''
  const av = initials(profile?.full_name, email)

  async function doSignOut() {
    if (busy) return
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
    <>
      <button type="button" className="acct-btn" onClick={() => setOpen(true)} aria-label="حسابي">
        <span className="acct-av">{av}</span>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="حسابي">
        <div className="acct-card">
          <div className="acct-card-av">{av}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="acct-card-nm">{name}</div>
            {email && (
              <button className="acct-card-em ltr" onClick={copyEmail} title="نسخ البريد">
                {email} <Icon name="copy" size={11} />
              </button>
            )}
            <span className="acct-role">{ROLE_LABEL[role] || 'مستخدم'}</span>
          </div>
        </div>

        <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setOpen(false)}>
          <Icon name="settings" size={16} /> الإعدادات (قريبًا)
        </button>

        <button className="btn btn-danger btn-block" style={{ marginTop: 8 }} onClick={doSignOut} disabled={busy}>
          {busy ? <span className="spinner" /> : <><Icon name="logout" size={16} /> تسجيل الخروج</>}
        </button>
      </BottomSheet>
    </>
  )
}
