import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { translateRpcError } from '../lib/rpcErrors'
import { isValidEmail } from '../lib/format'
import { useUI } from '../lib/useUI'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

const ROLE_AR = { owner: 'المالك', manager: 'مشرف', staff: 'موظّف' }

/**
 * إدارة فريق الحملة وصلاحيّاته — للمالك فقط.
 * يضيف أعضاءً بالبريد (لحساباتٍ قائمة)، يغيّر أدوارهم، ويزيلهم.
 * @param {boolean} open
 * @param {string}  subscriberId
 * @param {Function} onClose
 */
export default function TeamSheet({ open, subscriberId, onClose }) {
  const { toast, confirm } = useUI()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('staff')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!subscriberId) return
    setLoading(true)
    const { data } = await supabase.rpc('list_team_members', { p_sub: subscriberId })
    setRows(data ?? [])
    setLoading(false)
  }, [subscriberId])

  useEffect(() => { if (open) load() }, [open, load])

  async function addMember() {
    if (busy) return
    if (!isValidEmail(email.trim())) { toast('أدخل بريدًا إلكترونيًّا صحيحًا.', { type: 'error' }); return }
    setBusy(true)
    const { error } = await supabase.rpc('add_team_member', { p_sub: subscriberId, p_email: email.trim(), p_role: role })
    setBusy(false)
    if (error) toast(translateRpcError(error, 'تعذّرت إضافة العضو.'), { type: 'error' })
    else { toast('أُضيف العضو للفريق ✓', { type: 'success' }); setEmail(''); load() }
  }

  async function removeMember(m) {
    const ok = await confirm({ title: 'إزالة عضو', message: `إزالة «${m.full_name || 'العضو'}» من فريق الحملة؟ سيفقد الوصول فورًا.`, confirmText: 'إزالة', danger: true })
    if (!ok) return
    const { error } = await supabase.rpc('remove_team_member', { p_sub: subscriberId, p_profile: m.profile_id })
    if (error) toast(translateRpcError(error, 'تعذّرت الإزالة.'), { type: 'error' })
    else { toast('أُزيل العضو', { type: 'info' }); load() }
  }

  async function changeRole(m, newRole) {
    const { error } = await supabase.rpc('set_member_role', { p_sub: subscriberId, p_profile: m.profile_id, p_role: newRole })
    if (error) toast(translateRpcError(error, 'تعذّر تغيير الدور.'), { type: 'error' })
    else { toast('حُدّث الدور', { type: 'success' }); load() }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="الفريق والصلاحيّات">
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        أضِف مشرفين/موظّفين لمساعدتك في إدارة الحملة. يصلون لكلّ العمليّات (الرحلات، المعتمرون، التسكين، الكشوفات) —
        لكنّ إدارة الفريق والباقة تبقى لك وحدك.
      </p>

      <div className="form" style={{ marginTop: 8 }}>
        <div className="field ltr">
          <label>بريد العضو (لحسابٍ مسجّلٍ في ملبّيك)</label>
          <input type="email" inputMode="email" placeholder="member@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>الدور</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="staff">موظّف</option>
              <option value="manager">مشرف</option>
            </select>
          </div>
          <button className="btn btn-gold" style={{ alignSelf: 'flex-end', height: 46 }} onClick={addMember} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="plus" size={16} /> إضافة</>}
          </button>
        </div>
      </div>

      <div className="sec-label" style={{ marginTop: 14 }}>الأعضاء {rows.length > 0 && `(${rows.length})`}</div>
      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((m) => (
            <div key={m.profile_id} className="trip-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--cr-50)' }}>{m.full_name || 'عضو'}</div>
                <div className="muted" style={{ fontSize: 12 }}>{ROLE_AR[m.role] || m.role}{m.is_owner ? ' · صاحب الحملة' : ''}</div>
              </div>
              {!m.is_owner && (
                <>
                  <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} style={{ width: 'auto', padding: '6px 10px' }}>
                    <option value="staff">موظّف</option>
                    <option value="manager">مشرف</option>
                  </select>
                  <button className="icon-btn danger" onClick={() => removeMember(m)} aria-label="إزالة"><Icon name="trash" size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
