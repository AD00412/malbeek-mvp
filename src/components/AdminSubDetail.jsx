import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'
import { useUI } from '../lib/useUI'
import { useAuth } from '../app/useAuth'
import { fmtDateTime, normalizePhone } from '../lib/format'
import { translateRpcError } from '../lib/rpcErrors'

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
  const [tripLimit, setTripLimit] = useState(1)
  const [suspendReason, setSuspendReason] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const { toast, confirm } = useUI()

  // دمجٌ: props.sub (إحصاءات من RPC) + fullSub (الحقول الجديدة)
  const subData = fullSub ? { ...sub, ...fullSub } : sub

  const refresh = useCallback(async () => {
    if (!sub?.id) return
    setLoading(true)
    // مَلاحظة: profiles يَتجنّبُ الطلبَ حين owner_id فارغ
    // (وإلّا يُعيد PostgREST 400 على eq(null)).
    const ownerPromise = sub.owner_id
      ? supabase.from('profiles').select('full_name, phone, id').eq('id', sub.owner_id).maybeSingle()
      : Promise.resolve({ data: null })
    const [{ data: ts }, { data: prof }, { data: alog }, { data: srow }] = await Promise.all([
      supabase.from('trips').select('id, title, status, depart_at, capacity').eq('subscriber_id', sub.id)
        .order('depart_at', { ascending: false, nullsFirst: false }).limit(20),
      ownerPromise,
      supabase.from('platform_audit_log').select('id, admin_name, admin_role, action, details, created_at')
        .eq('target_type', 'subscriber').eq('target_id', sub.id)
        .order('created_at', { ascending: false }).limit(20),
      supabase.from('subscribers').select('id, admin_notes, suspended_at, suspended_reason, trial_extended_until, trial_trip_limit, contact_phone, plan, created_at')
        .eq('id', sub.id).maybeSingle(),
    ])
    setTrips(ts ?? [])
    setOwner(prof || null)
    setAuditLog(alog ?? [])
    setFullSub(srow || null)
    setAdminNote(srow?.admin_notes || '')
    setTripLimit(srow?.trial_trip_limit || 1)
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
      toast(translateRpcError(error, 'تعذّر التنفيذ.'), { type: 'error' })
      return false
    }
    toast(successMsg, { type: 'success' })
    onChanged?.()
    await refresh()
    return true
  }

  // ── الإجراءات ──
  async function doSetPlan(nextPlan, reasonLabel) {
    if (nextPlan === 'paid') {
      // ترقيةٌ يدويّة — تَستعمل الـRPC الجديد الذي يُغلق الطلبات المُعلَّقة كذلك
      const ok = await confirm({
        title: 'ترقيةٌ يدويّةٌ لمدفوعة',
        message: `${sub.org_name}: استلام دفعةٍ خارج المنصّة؟ سيُرقّى فورًا.`,
        confirmText: 'رقّ يدويًّا', cancelText: 'إلغاء',
      })
      if (!ok) return
      await rpcAction('admin_upgrade_subscriber',
        { p_sub: sub.id, p_reason: reasonLabel },
        'رُقّي للباقة المدفوعة ✓'
      )
      return
    }
    const ok = await confirm({
      title: 'إرجاعٌ لباقةٍ تجريبيّة',
      message: `هل تَأكّدت من ${reasonLabel}؟`,
      confirmText: 'تَنفيذ', cancelText: 'إلغاء',
    })
    if (!ok) return
    await rpcAction('set_subscriber_plan',
      { p_sub: sub.id, p_plan: nextPlan, p_reason: reasonLabel },
      'أُعيدت لتجريبيّة ✓'
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

  async function doSetTripLimit() {
    if (tripLimit < 1 || tripLimit > 100) { toast('الحدّ بين ١ و١٠٠', { type: 'error' }); return }
    const success = await rpcAction('set_trial_trip_limit',
      { p_sub: sub.id, p_limit: tripLimit, p_reason: null },
      `حُدّد حدُّ الرحلات التجريبيّة بـ ${tripLimit} ✓`
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
      <div className="mlk-tab">
        {/* بطاقةُ المشترك */}
        <div className="mlk-card is-feature">
          <div className="mlk-list-meta" style={{ marginBottom: 6 }}>
            <span className={`mlk-pill ${sub.plan === 'paid' ? 'ok' : 'warn'}`}>
              {sub.plan === 'paid' ? 'باقة مدفوعة' : 'تجريبية'}
            </span>
            {isSuspended && <span className="mlk-pill danger">مُعلَّق</span>}
            {trialExtended && !isSuspended && <span className="mlk-pill em">تَجربةٌ مُمدَّدة</span>}
            {sub.plan !== 'paid' && subData.trial_trip_limit > 1 && (
              <span className="mlk-pill em">حدُّ الرحلات: {subData.trial_trip_limit}</span>
            )}
          </div>
          <div className="mlk-list-title" style={{ fontSize: 18 }}>{sub.org_name}</div>
          <button type="button" className="ltr"
                  onClick={() => copy(joinUrl, 'نُسخ رابط الحجز')}
                  style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                           background: 'transparent', border: 0, color: 'var(--em-500)',
                           fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
            /{sub.slug} <Icon name="copy" size={11} />
          </button>
        </div>

        {/* إنذاراتٌ تَفصيليّة */}
        {isSuspended && (
          <div className="alert err">
            <strong>سببُ التَّعليق:</strong> {subData.suspended_reason}
            <div style={{ fontSize: 11.5, marginTop: 4, opacity: .8 }}>منذ: {fmtDateTime(subData.suspended_at)}</div>
          </div>
        )}
        {trialExtended && !isSuspended && (
          <div className="mlk-card is-feature" style={{ fontSize: 13 }}>
            <strong>تَجربةٌ مُمدَّدة حتّى</strong> {fmtDateTime(subData.trial_extended_until)}
          </div>
        )}

        {/* ٤ KPIs */}
        <div className="mlk-kpis">
          <div className="mlk-kpi">
            <div className="mlk-kpi-num">{sub.trips_count || 0}</div>
            <div className="mlk-kpi-lb">رحلات</div>
          </div>
          <div className="mlk-kpi">
            <div className="mlk-kpi-num">{sub.pax_count || 0}</div>
            <div className="mlk-kpi-lb">معتمرون</div>
          </div>
          <div className="mlk-kpi">
            <div className="mlk-kpi-num">{sub.paid_count || 0}</div>
            <div className="mlk-kpi-lb">مدفوعون</div>
          </div>
          <div className="mlk-kpi">
            <div className="mlk-kpi-num">{Number(sub.collected || 0).toLocaleString('en-US')}</div>
            <div className="mlk-kpi-lb">﷼ المُحصَّل</div>
          </div>
        </div>

        {/* الإجراءات — Admin فقط */}
        {isAdmin && !actionPanel && (
          <section>
            <h2 className="mlk-h2">إجراءاتٌ على الحساب</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {sub.plan !== 'paid' ? (
                <button className="mlk-action primary" onClick={() => doSetPlan('paid', 'استلام دفعة الترقية')}>
                  ترقية لمدفوعة
                </button>
              ) : (
                <button className="mlk-action" onClick={() => doSetPlan('trial', 'إعادة لتجريبيّة')}>
                  إرجاع لتجريبيّة
                </button>
              )}
              <button className="mlk-action" onClick={() => setActionPanel('extend')}>تَمديد التَّجربة</button>
              {sub.plan !== 'paid' && (
                <button className="mlk-action" onClick={() => setActionPanel('triplimit')}>حدُّ الرحلات</button>
              )}
              {!isSuspended ? (
                <button className="mlk-action danger" onClick={() => setActionPanel('suspend')}>تَعليق الحساب</button>
              ) : (
                <button className="mlk-action primary" onClick={doRestore}>إعادة تَفعيل</button>
              )}
              <button className="mlk-action" onClick={() => setActionPanel('note')}>ملاحظةٌ إداريّة</button>
            </div>
          </section>
        )}

        {/* لوحةُ تَمديد التَّجربة */}
        {actionPanel === 'extend' && (
          <div className="mlk-card">
            <h2 className="mlk-h2">تَمديدُ التَّجربة</h2>
            <div className="form">
              <div className="field">
                <label>كم يومًا تُريد إضافتَها؟</label>
                <input type="number" min="1" max="365" value={extendDays}
                       onChange={(e) => setExtendDays(Number(e.target.value) || 0)} />
                <span className="hint">من اليوم — لا يُعدّل تاريخَ إنشاء التَّجربة</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="mlk-action primary" onClick={doExtendTrial} disabled={busy}>
                  {busy ? <span className="spinner" /> : 'تَمديد'}
                </button>
                <button className="mlk-action" onClick={() => setActionPanel(null)} disabled={busy}>إلغاء</button>
              </div>
            </div>
          </div>
        )}

        {actionPanel === 'triplimit' && (
          <div className="mlk-card">
            <h2 className="mlk-h2">حدُّ الرحلات التجريبيّة</h2>
            <div className="form">
              <div className="field">
                <label>كم رحلةً تُتاح للباقة التجريبيّة؟</label>
                <input type="number" min="1" max="100" value={tripLimit}
                       onChange={(e) => setTripLimit(Number(e.target.value) || 0)} />
                <span className="hint">الافتراضيّ ١. يُطبَّق على إنشاء الرحلات للمشترك على الباقة التجريبيّة فقط.</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="mlk-action primary" onClick={doSetTripLimit} disabled={busy}>
                  {busy ? <span className="spinner" /> : 'حفظ الحدّ'}
                </button>
                <button className="mlk-action" onClick={() => { setActionPanel(null); setTripLimit(subData.trial_trip_limit || 1) }} disabled={busy}>إلغاء</button>
              </div>
            </div>
          </div>
        )}

        {actionPanel === 'suspend' && (
          <div className="mlk-card">
            <h2 className="mlk-h2">تَعليقُ الحساب</h2>
            <div className="form">
              <div className="field">
                <label>السبب (يُعرض للمشترك)</label>
                <textarea rows={3} value={suspendReason}
                          onChange={(e) => setSuspendReason(e.target.value)}
                          placeholder="مثلًا: مخالفةٌ لشروط الخدمة — التواصل: hello@mulabeek.com" />
                <span className="hint">٥+ أحرف، لغةً واضحةً ومحترمة</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="mlk-action danger" onClick={doSuspend} disabled={busy}>
                  {busy ? <span className="spinner" /> : 'تَعليق'}
                </button>
                <button className="mlk-action" onClick={() => setActionPanel(null)} disabled={busy}>إلغاء</button>
              </div>
            </div>
          </div>
        )}

        {actionPanel === 'note' && (
          <div className="mlk-card">
            <h2 className="mlk-h2">ملاحظةٌ إداريّة</h2>
            <div className="form">
              <div className="field">
                <label>ملاحظةٌ خاصّةٌ بفريق ملبّيك</label>
                <textarea rows={4} value={adminNote}
                          onChange={(e) => setAdminNote(e.target.value)}
                          placeholder="لا يَراها المشترك — للإدارة والدعم فقط…" />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="mlk-action primary" onClick={doSaveNote} disabled={busy}>
                  {busy ? <span className="spinner" /> : 'حفظ'}
                </button>
                <button className="mlk-action"
                        onClick={() => { setActionPanel(null); setAdminNote(sub.admin_notes || '') }}
                        disabled={busy}>إلغاء</button>
              </div>
            </div>
          </div>
        )}

        {/* ملاحظةٌ إداريّةٌ ظاهرة */}
        {subData.admin_notes && actionPanel !== 'note' && (
          <section>
            <h2 className="mlk-h2">ملاحظةٌ إداريّة</h2>
            <div className="mlk-card is-feature" style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
              {subData.admin_notes}
            </div>
          </section>
        )}

        {/* صاحبُ الحملة */}
        <section>
          <h2 className="mlk-h2">صاحبُ الحملة</h2>
          <div className="mlk-card">
            <div className="mlk-list-title">{owner?.full_name || '—'}</div>
            {owner?.phone && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <a className="mlk-action" href={`tel:${owner.phone}`}>اتّصال</a>
                <a className="mlk-action" href={`https://wa.me/${String(owner.phone).replace(/\D/g, '')}`}
                   target="_blank" rel="noopener noreferrer">واتساب</a>
                <button className="mlk-action" onClick={() => copy(owner.phone, 'نُسخ الرقم')}>نَسخ</button>
                <span className="ltr" style={{ fontSize: 12, color: 'var(--cr-300)',
                                                flex: 1, textAlign: 'left' }}>{owner.phone}</span>
              </div>
            )}
            {sub.contact_phone && normalizePhone(sub.contact_phone) !== normalizePhone(owner?.phone || '') && (
              <div className="mlk-list-meta" style={{ marginTop: 6 }}>
                هاتف الحملة: <span className="ltr">{sub.contact_phone}</span>
              </div>
            )}
          </div>
        </section>

        {/* آخر الرحلات */}
        <section>
          <h2 className="mlk-h2">آخر الرحلات</h2>
          {loading ? <SkeletonList count={3} /> :
           trips.length === 0 ? <div className="mlk-empty">لا رحلات بعد</div> :
           <ul className="mlk-list">
             {trips.slice(0, 5).map((t) => (
               <li key={t.id} className="mlk-list-row">
                 <div className="mlk-list-body">
                   <div className="mlk-list-meta">
                     <span className="mlk-pill muted">{STATUS_LABEL[t.status] || t.status}</span>
                     {t.capacity && <span>سعة {t.capacity}</span>}
                     <span className="mlk-list-time" style={{ marginInlineStart: 'auto' }}>
                       {t.depart_at ? fmtDateTime(t.depart_at) : '—'}
                     </span>
                   </div>
                   <div className="mlk-list-title">{t.title || 'رحلة'}</div>
                 </div>
               </li>
             ))}
           </ul>}
          {trips.length > 5 && (
            <div className="mlk-list-meta" style={{ marginTop: 6 }}>+ {trips.length - 5} رحلةٍ أخرى</div>
          )}
        </section>

        {/* سجلّ النَّشاط على هذه الحملة */}
        <section>
          <h2 className="mlk-h2">سجلّ النَّشاط</h2>
          {loading ? <SkeletonList count={2} /> :
           auditLog.length === 0 ? <div className="mlk-empty">لا نَشاطَ مُسجّل</div> :
           <ul className="mlk-list">
             {auditLog.map((a) => (
               <li key={a.id} className="mlk-list-row">
                 <div className="mlk-list-body">
                   <div className="mlk-list-meta">
                     <span className="mlk-pill em">{labelAction(a.action)}</span>
                     <span>·</span>
                     <span>{a.admin_name || '—'}</span>
                     <span className="mlk-list-time" style={{ marginInlineStart: 'auto' }}>{fmtDateTime(a.created_at)}</span>
                   </div>
                   {a.details && Object.keys(a.details).length > 0 && (
                     <div className="mlk-list-meta">{formatDetails(a.details)}</div>
                   )}
                 </div>
               </li>
             ))}
           </ul>}
        </section>

        <div className="mlk-list-meta" style={{ marginTop: 8 }}>أُنشئت: {fmtDateTime(sub.created_at)}</div>
      </div>
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
    case 'set_trip_limit': return 'حدُّ الرحلات'
    default: return a
  }
}

function formatDetails(d) {
  if (d.from && d.to) return `${d.from} → ${d.to}`
  if (d.action === 'set_trip_limit' || (d.old != null && d.new != null)) return `${d.old} → ${d.new} رحلة`
  if (d.days) return `${d.days} يومًا`
  if (d.reason) return d.reason
  return null
}
