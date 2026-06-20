import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'
import { useUI } from '../lib/useUI'
import { useAuth } from '../app/useAuth'
import { fmtDateTime, isValidEmail } from '../lib/format'

const ROLE_LABEL = { admin: 'أدمن', support: 'دعم' }
const ROLE_HINT = {
  admin: 'صلاحيّةٌ كاملةٌ — كلُّ إجراءٍ متاحٌ',
  support: 'قراءةٌ فقط + الردُّ على الرسائل',
}

/**
 * إدارةُ فريق ملبّيك (admin + support).
 * - admin يَستطيع إضافةَ وحذف الفريق وتَغيير الأدوار
 * - support يَرى القائمةَ فقط
 */
export default function TeamManagement() {
  const { profile, role } = useAuth()
  const isAdmin = role === 'admin'
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('support')
  const { confirm } = useUI()

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc('platform_list_staff')
    if (error) setErr('تعذّر التحميل: ' + error.message)
    else setStaff(data ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function addMember() {
    if (!isValidEmail(addEmail)) { setErr('بريدٌ غير صحيح'); return }
    setBusy(true); setErr(''); setOk('')
    const { error } = await supabase.rpc('platform_grant_role', {
      p_email: addEmail.trim().toLowerCase(),
      p_role: addRole,
    })
    setBusy(false)
    if (error) {
      const msg = error.message || ''
      if (msg.includes('user-not-found')) {
        setErr('لم يُعثر على هذا البريد. يَجب أن يُنشئ الشخصُ حسابًا على mulabeek.com أوّلًا.')
      } else if (msg.includes('admin-only')) {
        setErr('فقط الأدمن يُضيف فريقًا.')
      } else {
        setErr('تعذّر الإضافة: ' + msg)
      }
      return
    }
    setOk(`أُضيف ${addEmail} كـ${ROLE_LABEL[addRole]} ✓`)
    setAddEmail('')
    setTimeout(() => setOk(''), 3500)
    load()
  }

  async function changeRole(s, newRole) {
    if (s.role === newRole) return
    const ok = await confirm({
      title: 'تَغيير دور',
      message: `تَغيير دور ${s.full_name || s.email} من ${ROLE_LABEL[s.role]} إلى ${ROLE_LABEL[newRole]}؟`,
      confirmText: 'تَغيير', cancelText: 'إلغاء',
    })
    if (!ok) return
    setBusy(true)
    const { error } = await supabase.rpc('platform_grant_role', {
      p_email: s.email,
      p_role: newRole,
    })
    setBusy(false)
    if (error) setErr('تعذّر التَّغيير: ' + error.message)
    else load()
  }

  async function removeMember(s) {
    if (s.profile_id === profile?.id) {
      setErr('لا يَجوز نَزعُ صلاحيّاتِك بنفسك — اطلب من أدمنٍ آخرَ ذلك.')
      return
    }
    const ok = await confirm({
      title: 'نَزعُ صلاحيّاتٍ',
      message: `إزالةُ ${s.full_name || s.email} من فريق ملبّيك؟ سيَعود مستخدمًا عاديًّا.`,
      confirmText: 'نَزع', cancelText: 'إلغاء', danger: true,
    })
    if (!ok) return
    setBusy(true)
    const { error } = await supabase.rpc('platform_revoke_role', { p_profile: s.profile_id })
    setBusy(false)
    if (error) setErr('تعذّر النَّزع: ' + error.message)
    else load()
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>فريق ملبّيك</h3>
        <span className="sub">({staff.length})</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
          تحديث
        </button>
      </div>

      {err && <div className="alert err" style={{ marginBottom: 10 }}>{err}</div>}
      {ok  && <div className="alert ok"  style={{ marginBottom: 10 }}>{ok}</div>}

      {/* إضافة عضوٍ جديد — Admin فقط */}
      {isAdmin && (
        <div className="form" style={{ marginBottom: 14, padding: 14, background: 'var(--bg-2)', borderRadius: 12 }}>
          <div className="sec-label" style={{ marginTop: 0 }}>إضافةُ عضوٍ جديد</div>
          <div className="grid-2">
            <div className="field ltr">
              <label>البريد</label>
              <input type="email" placeholder="staff@example.com"
                     value={addEmail} onChange={(e) => setAddEmail(e.target.value)} />
            </div>
            <div className="field">
              <label>الدور</label>
              <select value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                <option value="support">دعم — قراءةٌ + ردُّ الرسائل</option>
                <option value="admin">أدمن — صلاحيّةٌ كاملة</option>
              </select>
            </div>
          </div>
          <div className="actions-row">
            <button className="btn btn-em btn-sm" onClick={addMember} disabled={busy || !addEmail}>
              {busy ? <span className="spinner" /> : <><Icon name="plus" size={14} /> إضافة</>}
            </button>
          </div>
          <span className="hint" style={{ marginTop: 8, display: 'block' }}>
            يَجب أن يُنشئَ الشخصُ حسابًا على <strong>mulabeek.com</strong> أوّلًا، ثمّ نَمنحه الصلاحيّةَ هنا.
          </span>
        </div>
      )}

      {loading ? (
        <SkeletonList count={3} />
      ) : staff.length === 0 ? (
        <div className="empty"><div className="em-ttl">لا يَوجد فريقٌ بعد</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {staff.map((s) => {
            const isMe = s.profile_id === profile?.id
            return (
              <div key={s.profile_id} className="trip-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%',
                    background: s.role === 'admin' ? 'var(--grad-gold)' : 'rgba(58,160,179,.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: s.role === 'admin' ? 'var(--em-950)' : 'var(--info-ink)', fontWeight: 800 }}>
                    {(s.full_name || s.email || '?').charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--cr-50)' }}>
                      {s.full_name || '—'}
                      {isMe && <span className="tag muted" style={{ fontSize: 9, marginInlineStart: 6 }}>أنت</span>}
                    </div>
                    <div className="muted ltr" style={{ fontSize: 12 }}>{s.email}</div>
                  </div>
                  <span className={`tag ${s.role === 'admin' ? 'gold' : 'info'}`}>{ROLE_LABEL[s.role]}</span>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{ROLE_HINT[s.role]}</div>

                {isAdmin && !isMe && (
                  <div className="actions-row" style={{ marginTop: 10 }}>
                    {s.role !== 'admin' && (
                      <button className="icon-btn" onClick={() => changeRole(s, 'admin')} disabled={busy}>
                        <Icon name="sparkle" size={14} /> ترقية لأدمن
                      </button>
                    )}
                    {s.role !== 'support' && (
                      <button className="icon-btn" onClick={() => changeRole(s, 'support')} disabled={busy}>
                        إنزالٌ لدعم
                      </button>
                    )}
                    <button className="icon-btn" onClick={() => removeMember(s)} disabled={busy}
                            style={{ color: 'var(--danger-ink)' }}>
                      <Icon name="trash" size={14} /> نَزع
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
