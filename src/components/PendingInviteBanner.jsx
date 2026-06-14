import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import { translateRpcError } from '../lib/rpcErrors'
import { useUI } from '../lib/useUI'
import Icon from './Icon'

const ROLE_AR = { manager: 'مشرف', staff: 'موظّف' }

/**
 * لافتةٌ تظهر للمستخدم إن وُجدت دعوةُ انضمامٍ لفريق حملةٍ على بريده.
 * القبول هنا فقط هو ما يحوّل الحساب لعضوٍ (موافقةٌ صريحة).
 */
export default function PendingInviteBanner() {
  const { user, refreshProfile } = useAuth()
  const { toast } = useUI()
  const navigate = useNavigate()
  const [invites, setInvites] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    let alive = true
    ;(async () => {
      const { data } = await supabase.rpc('my_pending_invites')
      if (alive) setInvites(data ?? [])
    })()
    return () => { alive = false }
  }, [user?.id])

  if (!invites.length) return null

  async function accept(iv) {
    if (busy) return
    setBusy(true)
    const { error } = await supabase.rpc('accept_invite', { p_invite: iv.invite_id })
    setBusy(false)
    if (error) { toast(translateRpcError(error, 'تعذّر قبول الدعوة.'), { type: 'error' }); return }
    toast(`انضممتَ إلى فريق «${iv.org_name}» ✓`, { type: 'success' })
    await refreshProfile?.()
    navigate('/dashboard', { replace: true })
  }

  return (
    <section className="panel" style={{ borderColor: 'rgba(196,154,69,.4)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {invites.map((iv) => (
        <div key={iv.invite_id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="ic-badge"><Icon name="customers" size={18} /></span>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 700, color: 'var(--cr-50)' }}>دعوةٌ للانضمام لفريق «{iv.org_name}»</div>
            <div className="muted" style={{ fontSize: 13 }}>بدور {ROLE_AR[iv.role] || 'عضو'} — ستدير الحملة مع صاحبها.</div>
          </div>
          <button className="btn btn-gold btn-sm" onClick={() => accept(iv)} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="check" size={15} /> قبول الانضمام</>}
          </button>
        </div>
      ))}
    </section>
  )
}
