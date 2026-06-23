import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useUI } from '../lib/useUI'
import { translateRpcError } from '../lib/rpcErrors'
import { SkeletonList } from './Skeleton'
import { fmtDateTime } from '../lib/format'
import Icon from './Icon'
import { FEATURES } from '../lib/featureFlags'

/**
 * تسويق المنصة — لإدارة ملبّيك (الأدمن فقط).
 * قناتان: ملبّيك → المشتركون (إعلانات/تحديثات) · ملبّيك → المعتمرون (عبر كل
 * الحملات، باحترام الموافقة التسويقية). تجهيز وحفظ الحملة «جاهزة» فقط (لا
 * transmission) — زرّ الإرسال الفعليّ مخفيٌّ خلف FEATURES.marketingSend حتى
 * يُربَط مزوّد الرسائل. القناة الثالثة (صاحب الحملة → معتمريه) في لوحة كل مشترك.
 */
const AUD = {
  subscribers: { label: 'المشتركون (أصحاب الحملات)', hint: 'إعلانات وتحديثات وعروض لأصحاب الحملات.' },
  pilgrims:    { label: 'المعتمرون (كل الحملات)',    hint: 'يرسل لمن وافق على التسويق فقط — عبر كل الحملات.' },
}
const STATUS_LABEL = { draft: 'جاهزة', sent: 'أرسلت', failed: 'فشل' }

export default function AdminMarketing() {
  const { toast, confirm } = useUI()
  const [tab, setTab] = useState('compose')
  const [audience, setAudience] = useState('subscribers')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [history, setHistory] = useState([])
  const [loadingHist, setLoadingHist] = useState(true)

  const loadHistory = useCallback(async () => {
    setLoadingHist(true)
    const { data } = await supabase.rpc('list_platform_broadcasts')
    setHistory(data || []); setLoadingHist(false)
  }, [])
  useEffect(() => { loadHistory() }, [loadHistory])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase.rpc('count_platform_audience', { p_audience: audience })
      if (active) setCount(typeof data === 'number' ? data : 0)
    })()
    return () => { active = false }
  }, [audience])

  async function handleSaveReady() {
    setErr('')
    if (subject.trim().length < 3) return setErr('الموضوع قصير جدا.')
    if (body.trim().length < 10) return setErr('النص قصير جدا.')
    if (count === 0) return setErr('لا جمهور بهذه الفئة.')
    const ok = await confirm({
      title: 'حفظ حملة المنصة',
      message: `ستحفظ الحملة وتجهز قائمة ${count} متلق (${AUD[audience].label})، جاهزةً للإرسال.`,
      confirmText: 'احفظ كحملة جاهزة',
    })
    if (!ok) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('create_platform_broadcast', {
        p_audience: audience, p_subject: subject.trim(), p_body: body.trim(),
      })
      if (error) throw error
      // لا إرسال — محفوظة جاهزة فقط.
      toast('حفظت حملة المنصة وجهز متلقوها ✓', { type: 'success' })
      setSubject(''); setBody(''); setTab('history'); loadHistory()
    } catch (e) {
      setErr(translateRpcError(e, 'تعذر حفظ الحملة.'))
    } finally { setBusy(false) }
  }

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head"><h1 className="mlk-tab-title">تسويق المنصة</h1></header>

      <div className="mlk-filter">
        <button className={`mlk-fchip ${tab === 'compose' ? 'active' : ''}`} onClick={() => setTab('compose')}>إنشاء حملة</button>
        <button className={`mlk-fchip ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          السابقة{history.length > 0 ? ` (${history.length})` : ''}
        </button>
      </div>

      {tab === 'compose' && (
        <>
          <div className="mlk-card is-feature">
            <h2 className="mlk-h2">الجمهور المستهدف</h2>
            <div className="form">
              <div className="field">
                <label>الفئة</label>
                <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                  <option value="subscribers">{AUD.subscribers.label}</option>
                  <option value="pilgrims">{AUD.pilgrims.label}</option>
                </select>
                <span className="hint">{AUD[audience].hint}</span>
              </div>
              <div className="alert" style={{ background: 'var(--surface-2)', color: 'var(--cr-100)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="customers" size={16} />
                <span>سيستلم <strong style={{ color: 'var(--em-500)' }}>{count}</strong> {count === 1 ? 'متلق' : 'متلقيا'}</span>
              </div>
              {count === 0 && (
                <p className="hint" style={{ color: 'var(--cr-300)' }}>
                  {audience === 'subscribers'
                    ? 'لا مشتركين بإيميل مسجل بعد.'
                    : 'لا معتمرين بإيميل وموافقة تسويقية عبر الحملات بعد.'}
                </p>
              )}
            </div>
          </div>

          <div className="mlk-card">
            <h2 className="mlk-h2">الرسالة</h2>
            <div className="form">
              <div className="field">
                <label>الموضوع</label>
                <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} placeholder="مثلا: تحديث جديد في منصة ملبّيك" />
              </div>
              <div className="field">
                <label>نص الرسالة</label>
                <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder="السلام عليكم،" />
                <span className="hint">{body.length}/5000</span>
              </div>
            </div>
          </div>

          {err && <div className="alert err">{err}</div>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="mlk-action primary" onClick={handleSaveReady} disabled={busy || count === 0} style={{ fontSize: 14, padding: '12px 18px' }}>
              {busy ? <><span className="spinner" /> جار الحفظ…</> : `حفظ كحملة جاهزة (${count})`}
            </button>
            <button className="mlk-action" onClick={() => setShowPreview((s) => !s)}>{showPreview ? 'إخفاء المعاينة' : 'معاينة'}</button>
            {/* زرّ الإرسال الفعليّ يظهر فقط حين يُربَط مزوّد الرسائل (FEATURES.marketingSend) */}
            {FEATURES.marketingSend && (
              <button className="mlk-action primary" onClick={handleSaveReady} style={{ fontSize: 14, padding: '12px 18px' }}>
                إرسال فعلي
              </button>
            )}
          </div>

          {showPreview && (
            <div className="mlk-card">
              <h2 className="mlk-h2">معاينة</h2>
              <div style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 10, fontSize: 13.5, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
                <strong>{subject || '(الموضوع)'}</strong>{'\n\n'}{body || '(نص الرسالة)'}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        loadingHist ? <SkeletonList count={3} /> :
        history.length === 0 ? <div className="mlk-empty">لا حملات بعد — ابدأ بإنشاء أولاها</div> :
        <ul className="mlk-list">
          {history.map((b) => (
            <li key={b.id} className="mlk-list-row">
              <div className="mlk-list-body">
                <div className="mlk-list-meta">
                  <span className="mlk-pill muted">{STATUS_LABEL[b.status] || b.status}</span>
                  <span className="mlk-pill">{AUD[b.audience]?.label || b.audience}</span>
                  <span className="mlk-list-time" style={{ marginInlineStart: 'auto' }}>{fmtDateTime(b.created_at)}</span>
                </div>
                <div className="mlk-list-title">{b.subject}</div>
                <div className="mlk-list-meta"><span>{b.recipient_count} متلق مجهز</span></div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
