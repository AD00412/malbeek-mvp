import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useUI } from '../lib/useUI'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'
import { fmtDateTime } from '../lib/format'
import { translateRpcError } from '../lib/rpcErrors'
import { FEATURES } from '../lib/featureFlags'

const STATUS_LABEL = {
  draft: 'مسودة', queued: 'جاهزة', sending: 'يرسل…',
  sent: 'أرسلت', failed: 'فشل', cancelled: 'ملغاة',
}
const STATUS_TONE = {
  draft: 'muted', queued: 'info', sending: 'info',
  sent: 'ok', failed: 'danger', cancelled: 'muted',
}

const TARGET_LABEL = {
  all_customers: 'كل المعتمرين',
  customers_of_trip: 'معتمرو رحلة محددة',
  post_umrah: 'معتمرو الرحلات المنتهية',
  specific_emails: 'إيميلات يدوية',
}

/**
 * حملات التسويق الجماعي — لصاحب الحملة فقط.
 * - مؤلف مبسط (موضوع + نص + مستهدفون)
 * - عداد متلقين قبل الإرسال
 * - قائمة حملات سابقة بالحالات والعدادات
 */
export default function MarketingBroadcasts({ subscriberId, trips = [] }) {
  const { toast, confirm } = useUI()
  const [tab, setTab] = useState('compose') // compose | history
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // composer
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [target, setTarget] = useState('all_customers')
  const [tripId, setTripId] = useState('')
  const [extraEmails, setExtraEmails] = useState('')
  const [audience, setAudience] = useState(0)
  const [sending, setSending] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const loadHistory = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc('list_my_broadcasts', { p_limit: 30 })
    if (error) setErr('تعذر تحميل التاريخ: ' + (error.message || ''))
    else setHistory(data ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { loadHistory() }, [loadHistory])

  // عداد الجمهور (تحديث تلقائي عند تغيير الفلتر)
  useEffect(() => {
    let active = true
    ;(async () => {
      if (target === 'specific_emails') {
        const emails = extraEmails.split(/[\n,;\s]+/).map(s => s.trim())
          .filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
        if (active) setAudience(emails.length)
        return
      }
      const { data } = await supabase.rpc('count_marketing_audience', {
        p_target: target,
        p_trip_id: target === 'customers_of_trip' ? (tripId || null) : null,
      })
      if (active) setAudience(typeof data === 'number' ? data : 0)
    })()
    return () => { active = false }
  }, [target, tripId, extraEmails])

  // ★★ الإرسال الفعلي موقوف عمدا (حد صارم من الإدارة): لا استدعاء لـ
  //    send-marketing-broadcast. هذا الإجراء يجهز الحملة ويحفظها «جاهزة»
  //    مع قائمة المتلقين فقط — لا تغادر أي رسالة النظام. تفعيل الإرسال
  //    يحتاج إذن إدارة ملبّيك + ربط مزود واتساب/بريد.
  async function handleSaveReady() {
    setErr('')
    if (subject.trim().length < 3) return setErr('الموضوع قصير جدا.')
    if (body.trim().length < 10) return setErr('النص قصير جدا.')
    if (target === 'customers_of_trip' && !tripId) return setErr('اختر رحلة.')
    if (target === 'specific_emails' && audience === 0) return setErr('لا إيميلات صحيحة.')
    if (audience === 0) return setErr('لا يوجد جمهور بهذه الفلترة.')

    const ok = await confirm({
      title: 'حفظ الحملة',
      message: `ستحفظ الحملة وتجهز قائمة ${audience} متلق، جاهزةً للإرسال.`,
      confirmText: 'احفظ كحملة جاهزة', cancelText: 'إلغاء',
    })
    if (!ok) return

    setSending(true)
    try {
      const emailsArr = target === 'specific_emails'
        ? extraEmails.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)
        : []
      const { error } = await supabase.rpc('create_marketing_broadcast', {
        p_subject: subject.trim(),
        p_body: body.trim(),
        p_target: target,
        p_trip_id: target === 'customers_of_trip' ? tripId : null,
        p_extra_emails: emailsArr,
      })
      if (error) throw error
      // لا إرسال — الحملة محفوظة جاهزة فقط.
      toast('حفظت الحملة وجهز متلقوها ✓', { type: 'success' })
      setSubject(''); setBody(''); setExtraEmails('')
      setTab('history')
      loadHistory()
    } catch (e) {
      setErr(translateRpcError(e, 'تعذر حفظ الحملة.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">حملات التسويق</h1>
      </header>

      <div className="mlk-filter">
        <button className={`mlk-fchip ${tab === 'compose' ? 'active' : ''}`} onClick={() => setTab('compose')}>
          إنشاء حملة
        </button>
        <button className={`mlk-fchip ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          السابقة{history.length > 0 ? ` (${history.length})` : ''}
        </button>
      </div>

      {tab === 'compose' && (
        <>
          {/* المؤلف */}
          <div className="mlk-card">
            <h2 className="mlk-h2">الرسالة</h2>
            <div className="form">
              <div className="field">
                <label>الموضوع</label>
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                       placeholder="مثلا: رحلات رمضان الجديدة — احجز مبكرا" maxLength={150} />
              </div>
              <div className="field">
                <label>نص الرسالة <span className="muted">(يرى للمعتمر باسمه)</span></label>
                <textarea rows={6} value={body} onChange={e => setBody(e.target.value)}
                          placeholder="السلام عليكم،&#10;فتحت حجوزات رحلات رمضان…" maxLength={5000} />
                <span className="hint">{body.length}/5000 — يمكن استعمال أسطر متعددة</span>
              </div>
            </div>
          </div>

          {/* الجمهور */}
          <div className="mlk-card is-feature">
            <h2 className="mlk-h2">الجمهور</h2>
            <div className="form">
              <div className="field">
                <label>الفئة</label>
                <select value={target} onChange={e => setTarget(e.target.value)}>
                  <option value="all_customers">كل المعتمرين السابقين</option>
                  <option value="customers_of_trip">معتمرو رحلة محددة</option>
                  <option value="post_umrah">معتمرو الرحلات المنتهية (عروض ما بعد العمرة)</option>
                  <option value="specific_emails">إيميلات يدوية (إضافية)</option>
                </select>
                {target === 'post_umrah' && (
                  <span className="hint">يرسل لمن أتم عمرته (رحلات منتهية) — مثالي لعروض المتابعة والرحلة القادمة.</span>
                )}
              </div>
              {target === 'customers_of_trip' && (
                <div className="field">
                  <label>الرحلة</label>
                  <select value={tripId} onChange={e => setTripId(e.target.value)}>
                    <option value="">— اختر —</option>
                    {trips.map(t => <option key={t.id} value={t.id}>{t.title || 'رحلة'}</option>)}
                  </select>
                </div>
              )}
              {target === 'specific_emails' && (
                <div className="field ltr">
                  <label>إيميلات (سطر لكل واحد، أو فاصلة)</label>
                  <textarea rows={4} value={extraEmails} onChange={e => setExtraEmails(e.target.value)}
                            placeholder="customer1@example.com&#10;customer2@example.com" />
                </div>
              )}
              <div className="alert" style={{ background: 'var(--surface-2)', color: 'var(--cr-100)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="customers" size={16} />
                <span>سيستلم <strong style={{ color: 'var(--em-500)' }}>{audience}</strong> {audience === 1 ? 'متلقي' : 'متلقيا'}</span>
              </div>
              {audience === 0 && (
                <p className="hint" style={{ color: 'var(--cr-300)' }}>
                  {target === 'specific_emails'
                    ? 'أدخل إيميلات صحيحة (سطر لكل واحد).'
                    : 'لا معتمرين بإيميل وموافقة تسويقية في هذه الفئة. أضف إيميلات معتمريك، أو شاركهم رابط الحجز ليسجلوا بأنفسهم بإيميلاتهم.'}
                </p>
              )}
            </div>
          </div>

          {err && <div className="alert err">{err}</div>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="mlk-action primary" onClick={handleSaveReady} disabled={sending || audience === 0}
                    style={{ fontSize: 14, padding: '12px 18px' }}>
              {sending ? <><span className="spinner" /> جار الحفظ…</> : `حفظ كحملة جاهزة (${audience})`}
            </button>
            <button className="mlk-action" onClick={() => setShowPreview(s => !s)}>
              {showPreview ? 'إخفاء المعاينة' : 'معاينة'}
            </button>
            {/* زرّ الإرسال الفعليّ يظهر فقط حين يُربَط مزوّد الرسائل (FEATURES.marketingSend) */}
            {FEATURES.marketingSend && (
              <button className="mlk-action primary" onClick={handleSaveReady}
                      style={{ fontSize: 14, padding: '12px 18px' }}>
                إرسال فعلي
              </button>
            )}
          </div>

          {showPreview && (
            <div className="mlk-card">
              <h2 className="mlk-h2">معاينة (كما يراها المعتمر)</h2>
              <div style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 10,
                            fontSize: 13.5, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
                <strong>{subject || '(الموضوع)'}</strong>
                {'\n\n'}
                مرحبا [اسم المعتمر]،{'\n\n'}{body || '(نص الرسالة)'}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        loading ? <SkeletonList count={3} /> :
        history.length === 0 ? <div className="mlk-empty">لا حملات بعد — ابدأ بإنشاء أولاها</div> :
        <ul className="mlk-list">
          {history.map(b => (
            <li key={b.id} className="mlk-list-row">
              <div className="mlk-list-body">
                <div className="mlk-list-meta">
                  <span className={`mlk-pill ${STATUS_TONE[b.status]}`}>{STATUS_LABEL[b.status]}</span>
                  <span className="mlk-pill muted">{TARGET_LABEL[b.target_filter] || b.target_filter}</span>
                  <span className="mlk-list-time" style={{ marginInlineStart: 'auto' }}>{fmtDateTime(b.created_at)}</span>
                </div>
                <div className="mlk-list-title">{b.subject}</div>
                <div className="mlk-list-meta">
                  <span>{b.sent_count}/{b.recipient_count} أرسلت</span>
                  {b.failed_count > 0 && <span style={{ color: 'var(--danger-ink)' }}>· {b.failed_count} فشل</span>}
                </div>
                {b.error_detail && (
                  <div className="mlk-list-meta" style={{ color: 'var(--danger-ink)' }}>{b.error_detail}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
