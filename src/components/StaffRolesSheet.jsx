import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { translateRpcError } from '../lib/rpcErrors'
import { useUI } from '../lib/useUI'
import Icon from './Icon'

/**
 * واجهةُ «الرتب والصلاحيات» لإدارة ملبّيك (حصريّةٌ لمن يملك staff.manage = المالك).
 * تعرض أعضاء المنصّة (أدمن/دعم)، رتبةَ كلٍّ، وصلاحياتِه القابلةَ للتبديل.
 * تعتمد على RPCs: list_staff_permissions / set_staff_rank / grant_staff_permission /
 * revoke_staff_permission. (الأدمن صلاحياته كاملةٌ ضمنًا — غير قابلةٍ للتعديل.)
 */

// المفاتيح بترتيب العرض + تسمياتها العربية. staff.manage حصريّةٌ للمالك (غير قابلة للمنح).
const PERMS = [
  { key: 'subscribers.view',    label: 'عرض المشتركين' },
  { key: 'subscribers.manage',  label: 'إدارة المشتركين' },
  { key: 'subscribers.suspend', label: 'إيقاف/استعادة مشترك' },
  { key: 'billing.manage',      label: 'الترقيات والمالية' },
  { key: 'feedback.handle',     label: 'الشكاوى والرسائل' },
  { key: 'marketing.manage',    label: 'التسويق' },
  { key: 'pii.view',            label: 'بيانات المعتمرين (PII)' },
  { key: 'audit.view',          label: 'سجلّات التدقيق' },
]

const RANKS = [
  { key: '',            label: 'بلا رتبة (صلاحيات يدويّة)' },
  { key: 'ops_manager', label: 'مدير عمليّات' },
  { key: 'finance',     label: 'مالية' },
  { key: 'support_l1',  label: 'دعم — مستوى ١' },
  { key: 'marketing',   label: 'تسويق' },
]

export default function StaffRolesSheet() {
  const { toast, confirm } = useUI()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('list_staff_permissions')
    if (error) toast(translateRpcError(error, 'تعذّر تحميل الفريق.'), { type: 'error' })
    setRows(data || [])
    setLoading(false)
  }, [toast])

  useEffect(() => { load() }, [load])

  async function togglePerm(member, key, has) {
    setBusyId(member.profile_id + key)
    const fn = has ? 'revoke_staff_permission' : 'grant_staff_permission'
    const { error } = await supabase.rpc(fn, { p_profile: member.profile_id, p_key: key })
    setBusyId('')
    if (error) { toast(translateRpcError(error, 'تعذّر تحديث الصلاحية.'), { type: 'error' }); return }
    await load()
  }

  async function changeRank(member, rank) {
    if (!rank) return
    const ok = await confirm({
      title: 'تطبيق رتبة',
      message: `سيُستبدَل صلاحياتُ «${member.full_name || '—'}» بقالب الرتبة المختارة. متابعة؟`,
      confirmText: 'تطبيق',
    })
    if (!ok) { await load(); return }
    setBusyId(member.profile_id + ':rank')
    const { error } = await supabase.rpc('set_staff_rank', { p_profile: member.profile_id, p_rank: rank })
    setBusyId('')
    if (error) { toast(translateRpcError(error, 'تعذّر تطبيق الرتبة.'), { type: 'error' }); return }
    toast('طُبِّقت الرتبة ✓', { type: 'success' })
    await load()
  }

  if (loading) return <div className="muted" style={{ padding: 14 }}>جارٍ التحميل…</div>
  if (rows.length === 0) {
    return <div className="muted" style={{ padding: 14 }}>لا أعضاءَ في فريق المنصّة بعد.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        امنح كلَّ عضوٍ صلاحياتِه بدقّة، أو طبّق رتبةً جاهزة. المالك (أدمن) صلاحياتُه كاملةٌ دائمًا.
      </p>
      {rows.map((m) => {
        const isOwner = m.role === 'admin'
        const perms = new Set(m.permissions || [])
        return (
          <div key={m.profile_id} className="mlk-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Icon name="user" size={16} />
              {/* المالك/الأدمن يُعرَض بهويّة المنصّة لا باسمٍ شخصيّ. الموظّفون الفعليّون بأسمائهم الوظيفيّة. */}
              <strong>{isOwner ? 'إدارة ملبّيك' : (m.full_name || '—')}</strong>
              <span className={`badge ${isOwner ? 'ok' : 'info'}`}>{isOwner ? 'مالك' : 'دعم'}</span>
              {!isOwner && m.platform_rank && (
                <span className="badge">{RANKS.find(r => r.key === m.platform_rank)?.label || m.platform_rank}</span>
              )}
            </div>

            {isOwner ? (
              <div className="muted" style={{ fontSize: 13 }}>
                <Icon name="check" size={14} /> كلُّ الصلاحيات (بما فيها إدارة الفريق) — غير قابلةٍ للتعديل.
              </div>
            ) : (
              <>
                <label className="field" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="muted" style={{ fontSize: 12 }}>رتبةٌ جاهزة (تستبدل الصلاحيات):</span>
                  <select
                    value={m.platform_rank || ''}
                    disabled={busyId === m.profile_id + ':rank'}
                    onChange={(e) => changeRank(m, e.target.value)}
                  >
                    {RANKS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </label>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {PERMS.map(p => {
                    const has = perms.has(p.key)
                    const busy = busyId === m.profile_id + p.key
                    return (
                      <button
                        key={p.key}
                        type="button"
                        className="chip"
                        disabled={busy}
                        onClick={() => togglePerm(m, p.key, has)}
                        title={has ? 'اضغط للسحب' : 'اضغط للمنح'}
                        style={has ? { background: 'rgba(16,185,129,.15)', borderColor: 'var(--em-600)', color: 'var(--em-500)', fontWeight: 700 } : { opacity: .75 }}
                      >
                        {has ? <Icon name="check" size={13} /> : null} {p.label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
