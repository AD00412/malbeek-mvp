import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'
import SignedImage from './SignedImage'
import { SkeletonList } from './Skeleton'

const KIND_AR = { suggestion: 'اقتراح', problem: 'مشكلة', question: 'سؤال', feature: 'ميزة' }
const STATUS_AR = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تمّت' }
const STATUS_CLS = { open: 'warn', in_progress: 'info', resolved: 'ok' }

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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk]   = useState('')   // ★ B4 — رسالةُ نجاحٍ بعد تَغيير حالة

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    let q = supabase.from('feedback')
      .select('id, audience, kind, subject, body, reply, status, replied_at, created_at, profile_id, subscriber_id, attachment_url, profiles:profile_id(full_name), subscribers:subscriber_id(org_name)')
      .order('created_at', { ascending: false }).limit(200)
    if (filter !== 'all') q = q.eq('status', filter)
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
      setEditing(null); setReply('')
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
    await patch(row.id, { reply: reply.trim(), status: 'resolved', replied_at: new Date().toISOString() }, 'أُرسل الردُّ ✓')
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>صندوق التغذية الراجعة</h3>
        <span className="sub">({rows.length})</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
          تحديث
        </button>
      </div>

      <div className="chips" style={{ marginTop: 0, marginBottom: 8 }}>
        {[{ k: 'open', t: 'مفتوحة' }, { k: 'in_progress', t: 'قيد المعالجة' }, { k: 'resolved', t: 'تمّت' }, { k: 'all', t: 'الكل' }]
          .map((c) => <button key={c.k} className={`chip ${filter === c.k ? 'active' : ''}`} onClick={() => setFilter(c.k)}>{c.t}</button>)}
      </div>

      {err && <div className="alert err" style={{ marginBottom: 10 }}>{err}</div>}
      {ok  && <div className="alert ok"  style={{ marginBottom: 10 }}>{ok}</div>}

      {loading ? (
        <SkeletonList count={4} />
      ) : rows.length === 0 ? (
        <div className="empty"><div className="em-ttl">لا توجد ملاحظاتٌ في هذه التصفية</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((f) => (
            <div key={f.id} className="trip-card" style={{ padding: 14 }}>
              <div className="tags">
                <span className="tag gold">{KIND_AR[f.kind] || f.kind}</span>
                <span className={`tag ${STATUS_CLS[f.status] || 'muted'}`}>{STATUS_AR[f.status] || f.status}</span>
                <span className="tag info">{f.audience === 'subscriber' ? 'مشترك' : 'عميل'}</span>
                <span className="tag muted">{fmt(f.created_at)}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: 'var(--cr-300)' }}>
                {f.profiles?.full_name || 'مستخدم'}{f.subscribers?.org_name ? ` · ${f.subscribers.org_name}` : ''}
              </div>
              {f.subject && <div style={{ fontWeight: 700, color: 'var(--cr-50)', marginTop: 6 }}>{f.subject}</div>}
              <div className="muted" style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{f.body}</div>
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
                <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: 'rgba(43,182,140,.1)', border: '1px solid rgba(43,182,140,.3)' }}>
                  <div style={{ fontSize: 12, color: 'var(--ok-ink)', fontWeight: 700, marginBottom: 4 }}>ردّك · {fmt(f.replied_at)}</div>
                  <div style={{ fontSize: 13.5, color: 'var(--cr-100)', whiteSpace: 'pre-wrap' }}>{f.reply}</div>
                </div>
              )}

              {editing === f.id ? (
                <div className="form" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>الردّ</label>
                    <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="اكتب ردًّا واضحًا ومحترمًا…" />
                  </div>
                  <div className="actions-row">
                    <button className="btn btn-em btn-sm" onClick={() => sendReply(f)} disabled={busy}>
                      {busy ? <span className="spinner" /> : <><Icon name="check" size={15} /> إرسال الردّ</>}
                    </button>
                    <button className="icon-btn" onClick={() => { setEditing(null); setReply('') }} disabled={busy}>إلغاء</button>
                  </div>
                </div>
              ) : (
                <div className="actions-row" style={{ marginTop: 10 }}>
                  {f.status !== 'resolved' && (
                    <button className="icon-btn" onClick={() => { setEditing(f.id); setReply(f.reply || '') }}>
                      <Icon name="message" size={15} /> ردّ
                    </button>
                  )}
                  {f.status === 'open' && (
                    <button className="icon-btn" onClick={() => patch(f.id, { status: 'in_progress' }, 'قيد المعالجة ✓')} disabled={busy}>قيد المعالجة</button>
                  )}
                  {/* ★ C6 — زرّ «إغلاق» الأبرز يَحصل على btn-em */}
                  {f.status !== 'resolved' && (
                    <button className="btn btn-em btn-sm" onClick={() => patch(f.id, { status: 'resolved', replied_at: new Date().toISOString() }, 'أُغلقت ✓')} disabled={busy}>
                      <Icon name="check" size={15} /> إغلاق
                    </button>
                  )}
                  {f.status === 'resolved' && (
                    <button className="icon-btn" onClick={() => patch(f.id, { status: 'open' }, 'أُعيد فتحُها')} disabled={busy}>إعادة فتح</button>
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

