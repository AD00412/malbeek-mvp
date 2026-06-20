import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'

const KIND_AR = {
  contact: 'تواصل', suggestion: 'اقتراح', problem: 'مشكلة',
  question: 'سؤال', feature: 'ميزة',
}
const STATUS_AR = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تمّت', spam: 'سبام' }
const STATUS_TONE = { open: 'warn', in_progress: 'info', resolved: 'ok', spam: 'muted' }

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
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">الرسائل العامّة</h1>
        <span className="mlk-tab-count">{rows.length} رسالة</span>
        <button className="mlk-action" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />}
          تحديث
        </button>
      </header>

      <div className="mlk-filter">
        {[
          { k: 'open',        t: 'مفتوحة' },
          { k: 'in_progress', t: 'قيد المعالجة' },
          { k: 'resolved',    t: 'تمّت' },
          { k: 'spam',        t: 'سبام' },
          { k: 'all',         t: 'الكل' },
        ].map((c) => (
          <button key={c.k} className={`mlk-fchip ${filter === c.k ? 'active' : ''}`}
                  onClick={() => setFilter(c.k)}>{c.t}</button>
        ))}
      </div>

      {err && <div className="alert err">{err}</div>}
      {ok  && <div className="alert ok">{ok}</div>}

      {loading ? <SkeletonList count={4} /> :
       rows.length === 0 ? <div className="mlk-empty">لا توجد رسائلُ في هذه التصفية</div> :
       <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
         {rows.map((m) => (
           <article key={m.id} className="mlk-card">
             <div className="mlk-list-meta" style={{ marginBottom: 6 }}>
               <span className="mlk-pill em">{KIND_AR[m.kind] || m.kind}</span>
               <span className={`mlk-pill ${STATUS_TONE[m.status] || 'muted'}`}>{STATUS_AR[m.status] || m.status}</span>
               <span style={{ marginInlineStart: 'auto', fontSize: 11.5, color: 'var(--cr-300)' }}>{fmt(m.created_at)}</span>
             </div>
             <div style={{ fontSize: 13, color: 'var(--cr-100)', marginBottom: 4 }}>
               <strong>{m.name}</strong> · <a href={`mailto:${m.email}`} dir="ltr" style={{ color: 'var(--em-500)' }}>{m.email}</a>
             </div>
             {m.subject && <div className="mlk-list-title" style={{ marginTop: 6 }}>{m.subject}</div>}
             <div style={{ fontSize: 13.5, color: 'var(--cr-200)', whiteSpace: 'pre-wrap', marginTop: 4, lineHeight: 1.7 }}>{m.body}</div>

             {Array.isArray(m.attachments) && m.attachments.length > 0 && (
               <PublicAttachmentLinks paths={m.attachments} />
             )}

             {m.reply && (
               <div className="mlk-card is-feature" style={{ marginTop: 10 }}>
                 <div className="mlk-list-meta">ردُّ ملبّيك · {fmt(m.replied_at)}</div>
                 <div style={{ fontSize: 13.5, color: 'var(--cr-100)', whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.reply}</div>
               </div>
             )}

             {editing === m.id ? (
               <div className="form" style={{ marginTop: 10 }}>
                 <div className="field">
                   <label>الردّ المنسَّق (سيُرسَل لـ {m.email})</label>
                   <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)}
                             placeholder="اكتب ردًّا واضحًا…" />
                   <span className="hint">{reply.length}/8000</span>
                 </div>
                 <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                   <button className="mlk-action primary" onClick={() => sendReply(m)} disabled={busy}>
                     {busy ? <><span className="spinner" /> إرسال…</> : 'إرسال الردّ'}
                   </button>
                   <button className="mlk-action" onClick={() => { setEditing(null); setReply('') }} disabled={busy}>إلغاء</button>
                 </div>
               </div>
             ) : (
               <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                 {m.status !== 'resolved' && m.status !== 'spam' && (
                   <button className="mlk-action" onClick={() => { setEditing(m.id); setReply(m.reply || '') }}>
                     ردّ منسَّق
                   </button>
                 )}
                 {m.status === 'open' && (
                   <button className="mlk-action" onClick={() => patch(m.id, { status: 'in_progress' })} disabled={busy}>قيد المعالجة</button>
                 )}
                 {m.status !== 'resolved' && m.status !== 'spam' && (
                   <button className="mlk-action primary" onClick={() => patch(m.id, { status: 'resolved', replied_at: new Date().toISOString() })} disabled={busy}>إغلاق</button>
                 )}
                 {m.status !== 'spam' && (
                   <button className="mlk-action" onClick={() => patch(m.id, { status: 'spam' })} disabled={busy}>سبام</button>
                 )}
                 {m.status === 'spam' && (
                   <button className="mlk-action" onClick={() => patch(m.id, { status: 'open' })} disabled={busy}>إعادة فتح</button>
                 )}
               </div>
             )}
           </article>
         ))}
       </div>}
    </div>
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
