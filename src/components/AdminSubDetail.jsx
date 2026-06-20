import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'
import { useUI } from '../lib/useUI'
import { useAuth } from '../app/useAuth'
import { fmtDateTime, normalizePhone } from '../lib/format'

const STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }

/**
 * تفاصيل حملةٍ للإدارة — مَركزُ تحكّمٍ كاملٌ:
 *  - بيانات + إحصاءات + صاحب الحملة + آخر الرحلات
 *  - ٦ إجراءاتٍ حقيقيّة (ترقية/إرجاع، تَمديد تَجربة، تَعليق/تَفعيل، ملاحظات)
 *  - سجلّ نشاطٍ لكلّ ما فُعل في هذه الحملة
 *  - الدعم (support) يَرى لكن لا يُعدّل
 */
export default function AdminSubDetail({ open, sub, onClose, onChanged }) {
  const { profile, role } = useAuth()
  const isAdmin = role === 'admin'
  const [trips, setTrips] = useState([])
  const [owner, setOwner] = useState(null)
  const [auditLog, setAuditLog] = useState([])
  const [fullSub, setFullSub] = useState(null)         // ★ subscriber كاملٌ (مع الحقول الجديدة)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [actionPanel, setActionPanel] = useState(null)  // 'extend' | 'suspend' | 'note' | null
  const [extendDays, setExtendDays] = useState(30)
  const [suspendReason, setSuspendReason] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const { toast, confirm } = useUI()

  // دمجٌ: props.sub (إحصاءات من RPC) + fullSub (الحقول الجديدة)
  const subData = fullSub ? { ...sub, ...fullSub } : sub

  const refresh = useCallback(async () => {
    if (!sub?.id) return
    setLoading(true)
    const [{ data: ts }, { data: prof }, { data: alog }, { data: srow }] = await Promise.all([
      supabase.from('trips').select('id, title, status, depart_at, capacity').eq('subscriber_id', sub.id)
        .order('depart_at', { ascending: false, nullsFirst: false }).limit(20),
      supabase.from('profiles').select('full_name, phone, id').eq('id', sub.owner_id).maybeSingle(),
      supabase.from('platform_audit_log').select('id, admin_name, admin_role, action, details, created_at')
        .eq('target_type', 'subscriber').eq('target_id', sub.id)
        .order('created_at', { ascending: false }).limit(20),
      supabase.from('subscribers').select('id, admin_notes, suspended_at, suspended_reason, trial_extended_until, contact_phone, plan, created_at')
        .eq('id', sub.id).maybeSingle(),
    ])
    setTrips(ts ?? [])
    setOwner(prof || null)
    setAuditLog(alog ?? [])
    setFullSub(srow || null)
    setAdminNote(srow?.admin_notes || '')
    setLoading(false)
  }, [sub?.id, sub?.owner_id])

  useEffect(() => {
    if (open && sub?.id) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sub?.id])

  if (!sub) return null

  async function rpcAction(name, args, successMsg) {
    if (busy) return false
    setBusy(true)
    const { error } = await supabase.rpc(name, args)
    setBusy(false)
    if (error) {
      toast('تعذّر التنفيذ: ' + error.message, { type: 'error' })
      return false
    }
    toast(successMsg, { type: 'success' })
    onChanged?.()
    await refresh()
    return true
  }

  // ── الإجراءات الستّة ──
  async function doSetPlan(nextPlan, reasonLabel) {
    const ok = await confirm({
      title: nextPlan === 'paid' ? 'ترقية لباقةٍ مدفوعة' : 'إرجاعٌ لباقةٍ تجريبيّة',
      message: `هل تَأكّدت من ${reasonLabel}؟`,
      confirmText: 'تَنفيذ', cancelText: 'إلغاء',
    })
    if (!ok) return
    await rpcAction('set_subscriber_plan',
      { p_sub: sub.id, p_plan: nextPlan, p_reason: reasonLabel },
      nextPlan === 'paid' ? 'رُقّيت لباقةٍ مدفوعة ✓' : 'أُعيدت لتجريبيّة ✓'
    )
  }

  async function doExtendTrial() {
    if (extendDays <= 0 || extendDays > 365) { toast('عدد الأيّام بين ١ و٣٦٥', { type: 'error' }); return }
    const success = await rpcAction('extend_subscriber_trial',
      { p_sub: sub.id, p_days: extendDays, p_reason: null },
      `مُدِّدت التَّجربة ${extendDays} يومًا ✓`
    )
    if (success) setActionPanel(null)
  }

  async function doSuspend() {
    if (suspendReason.trim().length < 5) { toast('اكتب سببًا واضحًا (٥+ أحرف)', { type: 'error' }); return }
    const success = await rpcAction('suspend_subscriber',
      { p_sub: sub.id, p_reason: suspendReason },
      'تَمّ تَعليقُ الحساب ✓'
    )
    if (success) { setActionPanel(null); setSuspendReason('') }
  }

  async function doRestore() {
    const ok = await confirm({
      title: 'إعادة تَفعيل الحساب',
      message: `إعادةُ تَفعيل «${sub.org_name}»؟ سيَستطيع المشترك استخدامَ المنصّة فورًا.`,
      confirmText: 'إعادة تَفعيل', cancelText: 'إلغاء',
    })
    if (!ok) return
    await rpcAction('restore_subscriber', { p_sub: sub.id }, 'أُعيد تَفعيلُ الحساب ✓')
  }

  async function doSaveNote() {
    const success = await rpcAction('set_subscriber_admin_note',
      { p_sub: sub.id, p_note: adminNote },
      'حُفظت الملاحظة ✓'
    )
    if (success) setActionPanel(null)
  }

  async function copy(v, label) {
    if (!v) return
    try { await navigator.clipboard.writeText(v); toast(label + ' ✓', { type: 'success' }) }
    catch { toast(v, { type: 'info' }) }
  }

  const joinUrl = `${window.location.origin}/${subData.slug}`
  const isSuspended = !!subData.suspended_at
  const trialExtended = subData.trial_extended_until && new Date(subData.trial_extended_until) > new Date()

  return (
    <BottomSheet open={open} onClose={onClose} title={sub.org_name || 'تفاصيل الحملة'}>
      {/* بطاقة الباقة + معرّف الحملة */}
      <div className="acct-card" style={{ marginBottom: 12 }}>
        <div className="acct-card-av" style={{ background: sub.plan === 'paid'
          ? 'linear-gradient(135deg,var(--gd-300),rgba(196,154,69,.55))'
          : 'linear-gradient(135deg,rgba(58,160,179,.6),rgba(58,160,179,.25))',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={sub.plan === 'paid' ? 'sparkle' : 'building'} size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="acct-card-nm">{sub.org_name}</div>
          <button className="acct-card-em ltr link-chip-btn" onClick={() => copy(joinUrl, 'نُسخ رابط الحجز')} title="نسخ رابط الحجز">
            /{sub.slug} <Icon name="copy" size={11} />
          </button>
          <span className="acct-role" style={{ background: sub.plan === 'paid'
            ? 'var(--grad-gold)' : 'rgba(58,160,179,.18)', color: sub.plan === 'paid' ? 'var(--em-950)' : 'var(--info-ink)' }}>
            {sub.plan === 'paid' ? 'باقة مدفوعة' : 'تجريبية'}
          </span>
        </div>
      </div>

      {/* لافتةُ التَّعليق إن وُجدت */}
      {isSuspended && (
        <div className="alert err" style={{ marginBottom: 10 }}>
          <strong>الحساب مُعلَّق</strong>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>{subData.suspended_reason}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>منذ: {fmtDateTime(subData.suspended_at)}</div>
        </div>
      )}
      {trialExtended && !isSuspended && (
        <div className="alert" style={{ marginBottom: 10, background: 'rgba(43,182,140,.1)', border: '1px solid rgba(43,182,140,.3)', color: 'var(--ok-ink)', padding: 10, borderRadius: 8 }}>
          🎁 تَجربةٌ مُمدَّدة حتّى: <strong>{fmtDateTime(subData.trial_extended_until)}</strong>
        </div>
      )}

      {/* الإحصاءات السريعة */}
      <div className="stats">
        <div className="stat info"><div className="top"><span className="ic"><Icon name="trips" size={14} /></span>الرحلات</div><div className="v">{sub.trips_count || 0}</div></div>
        <div className="stat warn"><div className="top"><span className="ic"><Icon name="customers" size={14} /></span>المعتمرون</div><div className="v">{sub.pax_count || 0}</div></div>
        <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={14} /></span>المدفوعون</div><div className="v">{sub.paid_count || 0}</div></div>
      </div>
      <div className="stats" style={{ marginTop: 10 }}>
        <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={14} /></span>إجمالي المحصّل</div><div className="v" style={{ fontSize: 22 }}>{Number(sub.collected || 0).toLocaleString('en-US')} <span style={{ fontSize: 13, color: 'var(--cr-300)' }}>﷼</span></div></div>
      </div>

      {/* ★ مَركزُ الإجراءات — Admin فقط */}
      {isAdmin && (
        <>
          <div className="sec-label" style={{ marginTop: 14 }}>إجراءاتٌ على الحساب</div>
          <div className="action-grid">
            {sub.plan !== 'paid' ? (
              <button className="action-card primary" onClick={() => doSetPlan('paid', 'استلام دفعة الترقية')}>
                <Icon name="sparkle" size={18} />
                <span>ترقية لمدفوعة</span>
                <small>المشترك دفع — رقّ حسابه</small>
              </button>
            ) : (
              <button className="action-card" onClick={() => doSetPlan('trial', 'إعادة لتجريبيّة (انتهاءُ اشتراك)')}>
                <Icon name="building" size={18} />
                <span>إرجاع لتجريبيّة</span>
                <small>انتهت مدّةُ الباقة</small>
              </button>
            )}
            <button className="action-card" onClick={() => setActionPanel(actionPanel === 'extend' ? null : 'extend')}>
              <Icon name="calendar" size={18} />
              <span>تَمديد التَّجربة</span>
              <small>أيّامٌ إضافيّة كهَدية</small>
            </button>
            {!isSuspended ? (
              <button className="action-card danger" onClick={() => setActionPanel(actionPanel === 'suspend' ? null : 'suspend')}>
                <Icon name="bell" size={18} />
                <span>تَعليق الحساب</span>
                <small>إيقافٌ مع سبب</small>
              </button>
            ) : (
              <button className="action-card primary" onClick={doRestore}>
                <Icon name="check" size={18} />
                <span>إعادة تَفعيل</span>
                <small>رفعُ التَّعليق</small>
              </button>
            )}
            <button className="action-card" onClick={() => setActionPanel(actionPanel === 'note' ? null : 'note')}>
              <Icon name="edit" size={18} />
              <span>ملاحظةٌ إداريّة</span>
              <small>خاصّةٌ بفريق ملبّيك</small>
            </button>
          </div>

          {/* لوحةُ تَمديد التَّجربة */}
          {actionPanel === 'extend' && (
            <div className="form" style={{ marginTop: 10, padding: 12, background: 'var(--bg-2)', borderRadius: 12 }}>
              <div className="field">
                <label>كم يومًا تُريد إضافتَها؟</label>
                <input type="number" min="1" max="365" value={extendDays}
                       onChange={(e) => setExtendDays(Number(e.target.value) || 0)} />
                <span className="hint">من اليوم — لا يُعدّل تاريخَ إنشاء التَّجربة</span>
              </div>
              <div className="actions-row">
                <button className="btn btn-em btn-sm" onClick={doExtendTrial} disabled={busy}>
                  {busy ? <span className="spinner" /> : <><Icon name="check" size={14} /> تَمديد</>}
                </button>
                <button className="icon-btn" onClick={() => setActionPanel(null)} disabled={busy}>إلغاء</button>
              </div>
            </div>
          )}

          {/* لوحةُ التَّعليق */}
          {actionPanel === 'suspend' && (
            <div className="form" style={{ marginTop: 10, padding: 12, background: 'var(--bg-2)', borderRadius: 12 }}>
              <div className="field">
                <label>سببُ التَّعليق (يُعرض للمشترك)</label>
                <textarea rows={3} value={suspendReason}
                          onChange={(e) => setSuspendReason(e.target.value)}
                          placeholder="مثلًا: مخالفةٌ لشروط الخدمة — التواصل: hello@mulabeek.com" />
                <span className="hint">٥+ أحرف، لغةً واضحةً ومحترمة</span>
              </div>
              <div className="actions-row">
                <button className="btn btn-em btn-sm" onClick={doSuspend} disabled={busy} style={{ background: 'var(--danger)' }}>
                  {busy ? <span className="spinner" /> : <>تَعليق الحساب</>}
                </button>
                <button className="icon-btn" onClick={() => setActionPanel(null)} disabled={busy}>إلغاء</button>
              </div>
            </div>
          )}

          {/* لوحةُ الملاحظة الإداريّة */}
          {actionPanel === 'note' && (
            <div className="form" style={{ marginTop: 10, padding: 12, background: 'var(--bg-2)', borderRadius: 12 }}>
              <div className="field">
                <label>ملاحظةٌ خاصّةٌ بإدارة ملبّيك</label>
                <textarea rows={4} value={adminNote}
                          onChange={(e) => setAdminNote(e.target.value)}
                          placeholder="ملاحظاتٌ لا يَراها المشترك — مرئيّةٌ للإدارة والدعم فقط…" />
              </div>
              <div className="actions-row">
                <button className="btn btn-em btn-sm" onClick={doSaveNote} disabled={busy}>
                  {busy ? <span className="spinner" /> : <><Icon name="check" size={14} /> حفظ</>}
                </button>
                <button className="icon-btn" onClick={() => { setActionPanel(null); setAdminNote(sub.admin_notes || '') }} disabled={busy}>إلغاء</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ملاحظةٌ إداريّةٌ ظاهرة (لكلّ الدعم) */}
      {subData.admin_notes && actionPanel !== 'note' && (
        <>
          <div className="sec-label" style={{ marginTop: 14 }}>ملاحظةٌ إداريّة</div>
          <div style={{ padding: 12, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.25)', borderRadius: 12, fontSize: 13.5, whiteSpace: 'pre-wrap', color: 'var(--cr-100)' }}>
            {subData.admin_notes}
          </div>
        </>
      )}

      {/* صاحب الحملة */}
      <div className="sec-label" style={{ marginTop: 14 }}>صاحب الحملة</div>
      <div className="trip-card" style={{ padding: 12, marginTop: 4 }}>
        <div style={{ fontWeight: 700, color: 'var(--cr-50)' }}>{owner?.full_name || '—'}</div>
        {owner?.phone && (
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <a className="btn btn-ghost btn-sm" href={`tel:${owner.phone}`}><Icon name="phone" size={14} /> اتّصال</a>
            <a className="btn btn-ghost btn-sm" href={`https://wa.me/${String(owner.phone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><Icon name="message" size={14} /> واتساب</a>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(owner.phone, 'نُسخ الرقم')}><Icon name="copy" size={14} /></button>
            <span className="ltr muted" style={{ fontSize: 12, flex: 1, textAlign: 'left' }}>{owner.phone}</span>
          </div>
        )}
        {sub.contact_phone && normalizePhone(sub.contact_phone) !== normalizePhone(owner?.phone || '') && (
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>هاتف الحملة: <span className="ltr">{sub.contact_phone}</span></div>
        )}
      </div>

      {/* آخر الرحلات */}
      <div className="sec-label" style={{ marginTop: 14 }}>آخر الرحلات</div>
      {loading ? (
        <SkeletonList count={3} />
      ) : trips.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, padding: 10 }}>لا رحلات بعد.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {trips.slice(0, 5).map((t) => (
            <div key={t.id} className="trip-card" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="tag muted" style={{ fontSize: 10 }}>{STATUS_LABEL[t.status] || t.status}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--cr-50)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title || 'رحلة'}</div>
                <div className="muted" style={{ fontSize: 11 }}>{t.depart_at ? fmtDateTime(t.depart_at) : '—'} · سعة {t.capacity || 0}</div>
              </div>
            </div>
          ))}
          {trips.length > 5 && (
            <div className="muted" style={{ fontSize: 12, padding: 4 }}>+ {trips.length - 5} رحلةٍ أخرى</div>
          )}
        </div>
      )}

      {/* سجلّ النَّشاط الإداريّ على هذه الحملة */}
      <div className="sec-label" style={{ marginTop: 14 }}>سجلّ النَّشاط الإداريّ</div>
      {loading ? (
        <SkeletonList count={2} />
      ) : auditLog.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, padding: 10 }}>لا نَشاطَ مُسجّل.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {auditLog.map((a) => (
            <div key={a.id} className="trip-card" style={{ padding: 10, fontSize: 12.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <strong style={{ color: 'var(--cr-50)' }}>{labelAction(a.action)}</strong>
                <span className="muted" style={{ fontSize: 11 }}>{fmtDateTime(a.created_at)}</span>
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {a.admin_name || '—'} <span className="tag muted" style={{ fontSize: 9, marginInlineStart: 6 }}>{a.admin_role}</span>
              </div>
              {a.details && Object.keys(a.details).length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--cr-200)' }}>{formatDetails(a.details)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="muted" style={{ marginTop: 18, fontSize: 11 }}>أُنشئت: {fmtDateTime(sub.created_at)}</div>
    </BottomSheet>
  )
}

function labelAction(a) {
  switch (a) {
    case 'plan_change':  return 'تَغيير باقة'
    case 'extend_trial': return 'تَمديد تَجربة'
    case 'suspend':      return 'تَعليق الحساب'
    case 'restore':      return 'إعادة تَفعيل'
    case 'set_note':     return 'تَحديث ملاحظة'
    default: return a
  }
}

function formatDetails(d) {
  if (d.from && d.to) return `${d.from} → ${d.to}`
  if (d.days) return `${d.days} يومًا`
  if (d.reason) return d.reason
  return null
}
