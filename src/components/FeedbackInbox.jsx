import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import Icon from './Icon'

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
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('open')   // 'all' | 'open' | 'in_progress' | 'resolved'
  const [editing, setEditing] = useState(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('feedback')
      .select('id, audience, kind, subject, body, reply, status, replied_at, created_at, profile_id, subscriber_id, attachment_url, profiles:profile_id(full_name), subscribers:subscriber_id(org_name)')
      .order('created_at', { ascending: false }).limit(200)
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setRows(data ?? []); setLoading(false)
  }, [filter])
  useEffect(() => { load() }, [load])

  async function patch(id, updates) {
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.from('feedback').update(updates).eq('id', id)
      if (error) throw error
      await load()
      setEditing(null); setReply('')
    } catch (e) {
      setErr(e?.message ? 'تعذّر الحفظ: ' + e.message : 'تعذّر الحفظ.')
    } finally { setBusy(false) }
  }

  async function sendReply(row) {
    if (!reply.trim()) { setErr('اكتب الردّ.'); return }
    await patch(row.id, { reply: reply.trim(), status: 'resolved', replied_at: new Date().toISOString() })
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>صندوق التغذية الراجعة</h3>
        <span className="sub">({rows.length})</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={load} disabled={loading}><Icon name="refresh" size={15} /> تحديث</button>
      </div>

      <div className="chips" style={{ marginTop: 0, marginBottom: 8 }}>
        {[{ k: 'open', t: 'مفتوحة' }, { k: 'in_progress', t: 'قيد المعالجة' }, { k: 'resolved', t: 'تمّت' }, { k: 'all', t: 'الكل' }]
          .map((c) => <button key={c.k} className={`chip ${filter === c.k ? 'active' : ''}`} onClick={() => setFilter(c.k)}>{c.t}</button>)}
      </div>

      {err && <div className="alert err" style={{ marginBottom: 10 }}>{err}</div>}

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
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
              {f.attachment_url && <AdminAttachment path={f.attachment_url} />}

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
                    <button className="btn btn-gold btn-sm" onClick={() => sendReply(f)} disabled={busy}>
                      {busy ? <span className="spinner" /> : <><Icon name="check" size={15} /> إرسال الردّ</>}
                    </button>
                    <button className="icon-btn" onClick={() => { setEditing(null); setReply('') }}>إلغاء</button>
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
                    <button className="icon-btn" onClick={() => patch(f.id, { status: 'in_progress' })} disabled={busy}>قيد المعالجة</button>
                  )}
                  {f.status !== 'resolved' && (
                    <button className="icon-btn" onClick={() => patch(f.id, { status: 'resolved', replied_at: new Date().toISOString() })} disabled={busy}>
                      <Icon name="check" size={15} /> إغلاق
                    </button>
                  )}
                  {f.status === 'resolved' && (
                    <button className="icon-btn" onClick={() => patch(f.id, { status: 'open' })} disabled={busy}>إعادة فتح</button>
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

/** عرض مرفق الملاحظة للإدارة عبر signed URL (الـ bucket خاص). */
function AdminAttachment({ path }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.storage
        .from('feedback-attachments')
        .createSignedUrl(path, 60 * 60)
      if (alive && data?.signedUrl) setUrl(data.signedUrl)
    })()
    return () => { alive = false }
  }, [path])
  if (!url) return (
    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}><Icon name="external" size={12} /> جارٍ تحميل المرفق…</div>
  )
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 8 }}>
      <img src={url} alt="مرفق" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 10, border: '1px solid var(--line)' }} />
      <div style={{ fontSize: 11, color: 'var(--gd-300)', marginTop: 4 }}>
        <Icon name="external" size={11} /> فتح بحجمٍ كامل
      </div>
    </a>
  )
}
