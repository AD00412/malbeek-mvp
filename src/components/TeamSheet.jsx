import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { translateRpcError } from '../lib/rpcErrors'
import { isValidEmail } from '../lib/format'
import { useUI } from '../lib/useUI'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

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
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('staff')
  const [busy, setBusy] = useState(false)
  const [acting, setActing] = useState(false)   // يحرس أزرار الصفوف من النقر المزدوج

  const load = useCallback(async () => {
    if (!subscriberId) return
    setLoading(true)
    const [{ data: mem }, { data: inv }] = await Promise.all([
      supabase.rpc('list_team_members', { p_sub: subscriberId }),
      supabase.rpc('list_pending_invites', { p_sub: subscriberId }),
    ])
    setRows(mem ?? [])
    setInvites(inv ?? [])
    setLoading(false)
  }, [subscriberId])

  useEffect(() => { if (open) load() }, [open, load])

  async function inviteMember() {
    if (busy) return
    if (!isValidEmail(email.trim())) { toast('أدخل بريدًا إلكترونيًّا صحيحًا.', { type: 'error' }); return }
    setBusy(true)
    const { error } = await supabase.rpc('invite_member', { p_sub: subscriberId, p_email: email.trim(), p_role: role })
    setBusy(false)
    if (error) toast(translateRpcError(error, 'تعذّرت الدعوة.'), { type: 'error' })
    else { toast('تمت الدعوة ✓ انسخ رابطها أدناه وأرسله للموظّف', { type: 'success' }); setEmail(''); load() }
  }

  async function revokeInvite(id) {
    if (acting) return
    setActing(true)
    const { error } = await supabase.from('subscriber_invites').delete().eq('id', id)
    setActing(false)
    if (error) toast(translateRpcError(error, 'تعذّر الإلغاء.'), { type: 'error' })
    else { toast('أُلغيت الدعوة', { type: 'info' }); load() }
  }

  async function copyInviteLink(id) {
    const link = `${window.location.origin}/join-team/${id}`
    try { await navigator.clipboard.writeText(link); toast('نُسخ رابط الدعوة ✓ أرسله للموظّف عبر البريد/واتساب', { type: 'success' }) }
    catch { toast(link, { type: 'info' }) }
  }

  async function removeMember(m) {
    if (acting) return
    const ok = await confirm({ title: 'إزالة عضو', message: `إزالة «${m.full_name || 'العضو'}» من فريق الحملة؟ سيفقد الوصول فورًا.`, confirmText: 'إزالة', danger: true })
    if (!ok) return
    setActing(true)
    const { error } = await supabase.rpc('remove_team_member', { p_sub: subscriberId, p_profile: m.profile_id })
    setActing(false)
    if (error) toast(translateRpcError(error, 'تعذّرت الإزالة.'), { type: 'error' })
    else { toast('أُزيل العضو', { type: 'info' }); load() }
  }

  async function changeRole(m, newRole) {
    if (acting) return
    setActing(true)
    const { error } = await supabase.rpc('set_member_role', { p_sub: subscriberId, p_profile: m.profile_id, p_role: newRole })
    setActing(false)
    if (error) toast(translateRpcError(error, 'تعذّر تغيير الدور.'), { type: 'error' })
    else { toast('حُدّث الدور', { type: 'success' }); load() }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="الفريق والصلاحيّات">
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        ادعُ مشرفين/موظّفين لمساعدتك في إدارة الحملة. يصلون لكلّ العمليّات (الرحلات، المعتمرون، التسكين، الكشوفات) —
        لكنّ إدارة الفريق والباقة تبقى لك وحدك. تظهر الدعوة للعضو ليقبلها بنفسه (بلا تحويلٍ تلقائيّ).
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
          <button className="btn btn-gold" style={{ alignSelf: 'flex-end', height: 46 }} onClick={inviteMember} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="message" size={16} /> دعوة</>}
          </button>
        </div>
      </div>

      {invites.length > 0 && (
        <>
          <div className="sec-label" style={{ marginTop: 12 }}>دعواتٌ معلّقة ({invites.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {invites.map((iv) => (
              <div key={iv.invite_id} className="trip-card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ltr" style={{ fontSize: 13, color: 'var(--cr-50)', textAlign: 'right' }}>{iv.email}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{ROLE_AR[iv.role] || iv.role} · بانتظار القبول</div>
                </div>
                <button className="icon-btn" onClick={() => copyInviteLink(iv.invite_id)} aria-label="نسخ رابط الدعوة"><Icon name="copy" size={15} /> رابط</button>
                <button className="icon-btn danger" onClick={() => revokeInvite(iv.invite_id)} disabled={acting} aria-label="إلغاء الدعوة"><Icon name="trash" size={15} /></button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sec-label" style={{ marginTop: 14 }}>الأعضاء {rows.length > 0 && `(${rows.length})`}</div>
      {loading ? (
        <SkeletonList count={3} />
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
                  <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} disabled={acting} style={{ width: 'auto', padding: '6px 10px' }}>
                    <option value="staff">موظّف</option>
                    <option value="manager">مشرف</option>
                  </select>
                  <button className="icon-btn danger" onClick={() => removeMember(m)} disabled={acting} aria-label="إزالة"><Icon name="trash" size={15} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
