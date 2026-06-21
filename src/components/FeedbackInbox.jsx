import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import SignedImage from './SignedImage'
import { SkeletonList } from './Skeleton'

const KIND_AR = { suggestion: 'اقتراح', problem: 'مشكلة', question: 'سؤال', feature: 'ميزة' }
const STATUS_AR = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تمّت' }
const STATUS_TONE = { open: 'warn', in_progress: 'info', resolved: 'ok' }
const PRIORITY_AR = { low: 'منخفضة', normal: 'عاديّة', high: 'عالية', urgent: 'عاجلة' }
const PRIORITY_TONE = { low: 'muted', normal: 'muted', high: 'warn', urgent: 'danger' }
const SLA_DAYS = 3   // تذكرةٌ غير محلولةٍ أقدمُ من ٣ أيّامٍ → متأخّرة

// عمرُ التذكرة بالأيّام (لمؤشّر SLA)
function ageDays(iso) {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function fmt(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: '2-digit' }) }
  catch { return '—' }
}

/** صندوق وارد التغذية الراجعة لإدارة ملبّيك. */
export default function FeedbackInbox() {
  const [rows, setRows] = useState([])
  const [attachUrls, setAttachUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('open')   // 'all' | 'open' | 'in_progress' | 'resolved'
  const [editing, setEditing] = useState(null)
  const [reply, setReply] = useState('')
  const [internalNote, setInternalNote] = useState('')   // resolution_internal — للفريق فقط
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk]   = useState('')   // ★ B4 — رسالةُ نجاحٍ بعد تَغيير حالة

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    let q = supabase.from('feedback')
      .select('id, audience, kind, subject, body, reply, status, priority, escalated_at, resolved_at, resolution_internal, replied_at, created_at, profile_id, subscriber_id, attachment_url, profiles:profile_id(full_name), subscribers:subscriber_id(org_name)')
      .order('created_at', { ascending: false }).limit(200)
    if (filter === 'escalated') q = q.not('escalated_at', 'is', null)
    else if (filter !== 'all') q = q.eq('status', filter)
    const { data, error } = await q
    if (error) {                                       // ★ A4 — معالجةُ الخطأ
      setErr('تعذّر التحميل: ' + error.message)
      setLoading(false)
      return
    }
    const all = data ?? []
    setRows(all)
    const paths = all.map((r) => r.attachment_url).filter(Boolean)
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from('feedback-attachments').createSignedUrls(paths, 60 * 60)
      const map = {}
      for (const s of signed ?? []) if (s.path && s.signedUrl) map[s.path] = s.signedUrl
      setAttachUrls(map)
    } else setAttachUrls({})
    setLoading(false)
  }, [filter])
  useEffect(() => { load() }, [load])

  async function patch(id, updates, successMsg) {
    setBusy(true); setErr(''); setOk('')
    try {
      const { error } = await supabase.from('feedback').update(updates).eq('id', id)
      if (error) throw error
      await load()
      setEditing(null); setReply(''); setInternalNote('')
      if (successMsg) {
        setOk(successMsg)
        setTimeout(() => setOk(''), 3000)
      }
    } catch (e) {
      setErr(e?.message ? 'تعذّر الحفظ: ' + e.message : 'تعذّر الحفظ.')
    } finally { setBusy(false) }
  }

  async function sendReply(row) {
    if (!reply.trim()) { setErr('اكتب الردّ.'); return }
    const now = new Date().toISOString()
    // ملاحظةُ الفريق الداخليّة (اختياريّة) تُحفظ منفصلةً عن الردّ — لا يراها المُبلِّغ.
    await patch(row.id, {
      reply: reply.trim(), status: 'resolved', replied_at: now, resolved_at: now,
      resolution_internal: internalNote.trim() || null,
    }, 'أُرسل الردُّ ✓')
  }

  async function escalate(row) {
    await patch(row.id, {
      escalated_at: new Date().toISOString(), priority: 'urgent',
      status: row.status === 'open' ? 'in_progress' : row.status,
    }, 'صُعّدت التذكرة (عاجلة) ✓')
  }

  async function deescalate(row) {
    await patch(row.id, { escalated_at: null, priority: 'normal' }, 'خُفّض التصعيد')
  }

  return (
    <div className="mlk-tab">
      <header className="mlk-tab-head">
        <h1 className="mlk-tab-title">التغذية الراجعة</h1>
        <span className="mlk-tab-count">{rows.length} ملاحظة</span>
        <button className="mlk-action" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={13} />}
          تحديث
        </button>
      </header>

      <div className="mlk-filter">
        {[{ k: 'open', t: 'مفتوحة' }, { k: 'in_progress', t: 'قيد المعالجة' }, { k: 'escalated', t: 'مُصعّدة' }, { k: 'resolved', t: 'تمّت' }, { k: 'all', t: 'الكل' }]
          .map((c) => (
            <button key={c.k} className={`mlk-fchip ${filter === c.k ? 'active' : ''}`}
                    onClick={() => setFilter(c.k)}>{c.t}</button>
          ))}
      </div>

      {err && <div className="alert err">{err}</div>}
      {ok  && <div className="alert ok">{ok}</div>}

      {loading ? <SkeletonList count={4} /> :
       rows.length === 0 ? <div className="mlk-empty">لا توجد ملاحظاتٌ في هذه التصفية</div> :
       <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
         {rows.map((f) => (
           <article key={f.id} className="mlk-card">
             <div className="mlk-list-meta" style={{ marginBottom: 6 }}>
               <span className="mlk-pill em">{KIND_AR[f.kind] || f.kind}</span>
               <span className={`mlk-pill ${STATUS_TONE[f.status] || 'muted'}`}>{STATUS_AR[f.status] || f.status}</span>
               {f.escalated_at && <span className="mlk-pill danger">مُصعّدة</span>}
               {!f.escalated_at && (f.priority === 'high' || f.priority === 'urgent') && (
                 <span className={`mlk-pill ${PRIORITY_TONE[f.priority]}`}>{PRIORITY_AR[f.priority]}</span>
               )}
               {f.status !== 'resolved' && ageDays(f.created_at) >= SLA_DAYS && (
                 <span className="mlk-pill warn">متأخّرة · {ageDays(f.created_at)} يوم</span>
               )}
               <span className="mlk-pill info">{f.audience === 'subscriber' ? 'مشترك' : 'عميل'}</span>
               <span style={{ marginInlineStart: 'auto', fontSize: 11.5, color: 'var(--cr-300)' }}>{fmt(f.created_at)}</span>
             </div>
             <div style={{ fontSize: 13, color: 'var(--cr-100)', marginBottom: 4 }}>
               {f.profiles?.full_name || 'مستخدم'}{f.subscribers?.org_name ? ` · ${f.subscribers.org_name}` : ''}
             </div>
             {f.subject && <div className="mlk-list-title" style={{ marginTop: 6 }}>{f.subject}</div>}
             <div style={{ fontSize: 13.5, color: 'var(--cr-200)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{f.body}</div>
             {f.attachment_url && (
               <SignedImage
                 bucket="feedback-attachments"
                 path={f.attachment_url}
                 presignedUrl={attachUrls[f.attachment_url]}
                 maxHeight={260}
                 showOpenFull
               />
             )}

             {f.reply && (
               <div className="mlk-card is-feature" style={{ marginTop: 10 }}>
                 <div className="mlk-list-meta">ردّك · {fmt(f.replied_at)}</div>
                 <div style={{ fontSize: 13.5, color: 'var(--cr-100)', whiteSpace: 'pre-wrap', marginTop: 4 }}>{f.reply}</div>
               </div>
             )}

             {f.resolution_internal && (
               <div className="mlk-card" style={{ marginTop: 8, borderInlineStart: '3px solid var(--warn-ink, #c98e2e)' }}>
                 <div className="mlk-list-meta">🔒 ملاحظةٌ داخليّة <span className="muted">(لا يراها المُبلِّغ)</span></div>
                 <div style={{ fontSize: 13, color: 'var(--cr-200)', whiteSpace: 'pre-wrap', marginTop: 4 }}>{f.resolution_internal}</div>
               </div>
             )}

             {f.status === 'resolved' && f.resolved_at && (
               <div className="mlk-list-meta" style={{ marginTop: 8, color: 'var(--ok-ink, var(--em-500))' }}>
                 <Icon name="check" size={13} /> حُلّت في {fmt(f.resolved_at)}
               </div>
             )}

             {editing === f.id ? (
               <div className="form" style={{ marginTop: 10 }}>
                 <div className="field">
                   <label>الردّ <span className="muted" style={{ fontSize: 11.5 }}>(يراه المُبلِّغ)</span></label>
                   <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="اكتب ردًّا واضحًا ومحترمًا…" />
                 </div>
                 <div className="field">
                   <label>ملاحظةٌ داخليّة <span className="muted" style={{ fontSize: 11.5 }}>(اختياريّة — للفريق فقط، لا يراها المُبلِّغ)</span></label>
                   <textarea rows={2} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="سياقٌ داخليٌّ لكيفيّة المعالجة…" />
                 </div>
                 <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                   <button className="mlk-action primary" onClick={() => sendReply(f)} disabled={busy}>
                     {busy ? <span className="spinner" /> : 'إرسال الردّ'}
                   </button>
                   <button className="mlk-action" onClick={() => { setEditing(null); setReply(''); setInternalNote('') }} disabled={busy}>إلغاء</button>
                 </div>
               </div>
             ) : (
               <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                 {f.status !== 'resolved' && (
                   <button className="mlk-action" onClick={() => { setEditing(f.id); setReply(f.reply || ''); setInternalNote(f.resolution_internal || '') }}>
                     ردّ
                   </button>
                 )}
                 {f.status === 'open' && (
                   <button className="mlk-action" onClick={() => patch(f.id, { status: 'in_progress' }, 'قيد المعالجة ✓')} disabled={busy}>قيد المعالجة</button>
                 )}
                 {f.status !== 'resolved' && !f.escalated_at && (
                   <button className="mlk-action danger" onClick={() => escalate(f)} disabled={busy}>تصعيد</button>
                 )}
                 {f.escalated_at && f.status !== 'resolved' && (
                   <button className="mlk-action" onClick={() => deescalate(f)} disabled={busy}>خفض التصعيد</button>
                 )}
                 {f.status !== 'resolved' && (
                   <button className="mlk-action primary" onClick={() => { const n = new Date().toISOString(); patch(f.id, { status: 'resolved', replied_at: n, resolved_at: n }, 'أُغلقت ✓') }} disabled={busy}>إغلاق</button>
                 )}
                 {f.status === 'resolved' && (
                   <button className="mlk-action" onClick={() => patch(f.id, { status: 'open', resolved_at: null }, 'أُعيد فتحُها')} disabled={busy}>إعادة فتح</button>
                 )}
               </div>
             )}
           </article>
         ))}
       </div>}
    </div>
  )
}

