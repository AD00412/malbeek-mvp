import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

const KIND_AR = {
  contact: 'تواصل', suggestion: 'اقتراح', problem: 'مشكلة',
  question: 'سؤال', feature: 'ميزة',
}
const STATUS_AR = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تمّت', spam: 'سبام' }
const STATUS_CLS = { open: 'warn', in_progress: 'info', resolved: 'ok', spam: 'muted' }

function fmt(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: '2-digit' }) }
  catch { return '—' }
}

/**
 * صندوقُ واردِ الرسائل العامّة (من نموذج التواصل في صفحة الهبوط).
 * يَعرض كلَّ رسائل public_messages للأدمن، مع إمكان الردِّ بقالبِ
 * منسَّقٍ عبر Edge Function reply-public-message.
 */
export default function PublicMessagesInbox() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('open')   // 'all' | 'open' | 'in_progress' | 'resolved' | 'spam'
  const [editing, setEditing] = useState(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    let q = supabase.from('public_messages')
      .select('id, mode, kind, name, email, subject, body, reply, status, replied_at, created_at, attachments')
      .order('created_at', { ascending: false }).limit(200)
    if (filter !== 'all') q = q.eq('status', filter)
    const { data, error } = await q
    if (error) setErr('تعذّر التحميل: ' + error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [filter])
  useEffect(() => { load() }, [load])

  async function patch(id, updates) {
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('public_messages').update(updates).eq('id', id)
      if (error) throw error
      await load()
    } catch (e) {
      setErr(e?.message ? 'تعذّر الحفظ: ' + e.message : 'تعذّر الحفظ.')
    } finally { setBusy(false) }
  }

  /** يَستدعي Edge function ليُرسل ردًّا منسَّقًا + يُحدّث الـ DB */
  async function sendReply(row) {
    const text = reply.trim()
    if (text.length < 5) { setErr('اكتب ردًّا ٥ أحرفٍ فأكثر.'); return }
    setBusy(true); setErr(''); setOk('')
    try {
      const { data, error } = await supabase.functions.invoke('reply-public-message', {
        body: { message_id: row.id, reply: text },
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'unknown')
      setOk(`أُرسل الردُّ إلى ${data.sent_to} ✓`)
      setEditing(null); setReply('')
      await load()
    } catch (e) {
      setErr(e?.message ? 'تعذّر الإرسال: ' + e.message : 'تعذّر إرسال الردّ.')
    } finally {
      setBusy(false)
      setTimeout(() => setOk(''), 4000)
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>صندوق الرسائل العامّة</h3>
        <span className="sub">({rows.length})</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
          تحديث
        </button>
      </div>

      {/* ★ C1 — نَفسُ ترتيب الفلاتر في FeedbackInbox + spam في النهاية قبل الكلّ */}
      <div className="chips" style={{ marginTop: 0, marginBottom: 8 }}>
        {[
          { k: 'open',        t: 'مفتوحة' },
          { k: 'in_progress', t: 'قيد المعالجة' },
          { k: 'resolved',    t: 'تمّت' },
          { k: 'spam',        t: 'سبام' },
          { k: 'all',         t: 'الكل' },
        ].map((c) => (
          <button key={c.k} className={`chip ${filter === c.k ? 'active' : ''}`} onClick={() => setFilter(c.k)}>{c.t}</button>
        ))}
      </div>

      {err && <div className="alert err" style={{ marginBottom: 10 }}>{err}</div>}
      {ok  && <div className="alert ok"  style={{ marginBottom: 10 }}>{ok}</div>}

      {loading ? (
        <SkeletonList count={4} />
      ) : rows.length === 0 ? (
        <div className="empty"><div className="em-ttl">لا توجد رسائلُ في هذه التصفية</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((m) => (
            <div key={m.id} className="trip-card" style={{ padding: 14 }}>
              <div className="tags">
                <span className="tag gold">{KIND_AR[m.kind] || m.kind}</span>
                <span className={`tag ${STATUS_CLS[m.status] || 'muted'}`}>{STATUS_AR[m.status] || m.status}</span>
                <span className="tag muted">{fmt(m.created_at)}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: 'var(--cr-300)' }}>
                <strong style={{ color: 'var(--cr-100)' }}>{m.name}</strong>
                <span> · </span>
                <a href={`mailto:${encodeURIComponent(m.email)}`}
                   style={{ color: 'var(--em-300)', textDecoration: 'none' }}
                   dir="ltr">{m.email}</a>
              </div>
              {m.subject && <div style={{ fontWeight: 700, color: 'var(--cr-50)', marginTop: 6 }}>{m.subject}</div>}
              <div className="muted" style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.body}</div>
              {/* ★ B5 — مرفقاتٌ كروابطَ موقَّعةٍ قابلةٍ للفتح (٧ أيّامٍ) */}
              {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                <PublicAttachmentLinks paths={m.attachments} />
              )}

              {m.reply && (
                <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: 'rgba(43,182,140,.1)', border: '1px solid rgba(43,182,140,.3)' }}>
                  <div style={{ fontSize: 12, color: 'var(--ok-ink)', fontWeight: 700, marginBottom: 4 }}>ردُّ ملبّيك · {fmt(m.replied_at)}</div>
                  <div style={{ fontSize: 13.5, color: 'var(--cr-100)', whiteSpace: 'pre-wrap' }}>{m.reply}</div>
                </div>
              )}

              {editing === m.id ? (
                <div className="form" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>الردّ المنسَّق (سيُرسَل لـ {m.email})</label>
                    <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)}
                              placeholder="اكتب ردًّا واضحًا — سيُرسل في قالبِ ملبّيك المنسَّق…" />
                    <span className="hint">{reply.length}/8000</span>
                  </div>
                  <div className="actions-row">
                    <button className="btn btn-em btn-sm" onClick={() => sendReply(m)} disabled={busy}>
                      {busy ? <><span className="spinner" /> جارٍ الإرسال…</> : <><Icon name="check" size={15} /> إرسال الردّ</>}
                    </button>
                    <button className="icon-btn" onClick={() => { setEditing(null); setReply('') }} disabled={busy}>إلغاء</button>
                  </div>
                </div>
              ) : (
                <div className="actions-row" style={{ marginTop: 10 }}>
                  {m.status !== 'resolved' && m.status !== 'spam' && (
                    <button className="icon-btn" onClick={() => { setEditing(m.id); setReply(m.reply || '') }}>
                      <Icon name="message" size={15} /> ردّ منسَّق
                    </button>
                  )}
                  {m.status === 'open' && (
                    <button className="icon-btn" onClick={() => patch(m.id, { status: 'in_progress' })} disabled={busy}>قيد المعالجة</button>
                  )}
                  {/* ★ C6 — زرّ «إغلاق» الأبرز يَحصل على btn-em */}
                  {m.status !== 'resolved' && m.status !== 'spam' && (
                    <button className="btn btn-em btn-sm" onClick={() => patch(m.id, { status: 'resolved', replied_at: new Date().toISOString() })} disabled={busy}>
                      <Icon name="check" size={15} /> إغلاق
                    </button>
                  )}
                  {m.status !== 'spam' && (
                    <button className="icon-btn" onClick={() => patch(m.id, { status: 'spam' })} disabled={busy}>سبام</button>
                  )}
                  {m.status === 'spam' && (
                    <button className="icon-btn" onClick={() => patch(m.id, { status: 'open' })} disabled={busy}>إعادة فتح</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** يَكسر مرفقات الرسائل العامّة إلى روابطَ موقّعة (٧ أيّامٍ). */
function PublicAttachmentLinks({ paths }) {
  const [urls, setUrls] = useState({})
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!Array.isArray(paths) || paths.length === 0) return
      const { data } = await supabase.storage
        .from('public-attachments').createSignedUrls(paths, 60 * 60 * 24 * 7)
      if (cancelled) return
      const map = {}
      for (const s of data ?? []) if (s.path && s.signedUrl) map[s.path] = s.signedUrl
      setUrls(map)
    })()
    return () => { cancelled = true }
  }, [paths])

  return (
    <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-3)', borderRadius: 8, border: '1px solid var(--cr-800)' }}>
      <div style={{ fontSize: 12, color: 'var(--cr-300)', marginBottom: 6 }}>📎 المرفقات ({paths.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {paths.map((p, i) => {
          const url = urls[p]
          const filename = (p.split('/').pop() || `مرفق ${i + 1}`).replace(/^\d{10,}-[a-z0-9]+-/i, '')
          return url ? (
            <a key={p} href={url} target="_blank" rel="noreferrer"
               style={{ fontSize: 13, color: 'var(--em-300)', textDecoration: 'none', wordBreak: 'break-all' }}>
              ↓ {filename}
            </a>
          ) : (
            <span key={p} style={{ fontSize: 13, color: 'var(--cr-400)' }}>{filename}</span>
          )
        })}
      </div>
    </div>
  )
}
