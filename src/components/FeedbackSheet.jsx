import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { useAuth } from '../app/useAuth'

const KINDS = [
  { v: 'suggestion', t: 'اقتراح' },
  { v: 'problem',    t: 'مشكلة' },
  { v: 'question',   t: 'سؤال' },
  { v: 'feature',    t: 'ميزة جديدة' },
]
const STATUS_AR = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تمّت' }
const STATUS_CLS = { open: 'warn', in_progress: 'info', resolved: 'ok' }

function fmt(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: '2-digit' }) }
  catch { return '—' }
}

/**
 * ورقةٌ سفليّةٌ لإرسال تغذيةٍ راجعة + قائمة ملاحظاتي السابقة وردود الإدارة.
 * @param {string} audience 'subscriber' | 'customer'
 */
export default function FeedbackSheet({ open, audience, onClose }) {
  const { user, subscriberId } = useAuth()
  const [view, setView] = useState('new')          // 'new' | 'mine'
  const [kind, setKind] = useState('suggestion')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState('')
  const [err, setErr] = useState('')
  const [mine, setMine] = useState([])
  const [loading, setLoading] = useState(false)

  const loadMine = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('feedback')
      .select('id, kind, subject, body, reply, status, replied_at, created_at')
      .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(50)
    setMine(data ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => { if (open && view === 'mine') loadMine() }, [open, view, loadMine])
  useEffect(() => { if (!open) { setOk(''); setErr(''); setSubject(''); setBody(''); setKind('suggestion'); setView('new') } }, [open])

  async function send() {
    if (busy) return
    if (!body.trim()) { setErr('اكتب نصّ الملاحظة.'); return }
    setErr(''); setOk(''); setBusy(true)
    try {
      const { error } = await supabase.from('feedback').insert({
        profile_id: user.id,
        subscriber_id: subscriberId || null,
        audience,
        kind,
        subject: subject.trim() || null,
        body: body.trim(),
      })
      if (error) throw error
      setOk('وصلت ملاحظتك ✓ سنرجع لك بأقرب وقت.')
      setBody(''); setSubject('')
      if (view === 'mine') loadMine()
    } catch (e) {
      setErr(e?.message ? 'تعذّر الإرسال: ' + e.message : 'تعذّر الإرسال.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="تواصل مع إدارة ملبّيك">
      <div className="chips" style={{ marginTop: -4 }}>
        <button type="button" className={`chip ${view === 'new' ? 'active' : ''}`} onClick={() => setView('new')}>إرسال ملاحظة</button>
        <button type="button" className={`chip ${view === 'mine' ? 'active' : ''}`} onClick={() => setView('mine')}>
          ملاحظاتي {mine.length > 0 && `(${mine.length})`}
        </button>
      </div>

      {view === 'new' ? (
        <div className="form" style={{ marginTop: 14 }}>
          <div className="grid-2">
            <div className="field">
              <label>النوع</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => <option key={k.v} value={k.v}>{k.t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>عنوان (اختياري)</label>
              <input type="text" placeholder="مثال: تحسين شاشة المعتمرين" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>التفاصيل <span className="req">*</span></label>
            <textarea rows={5} placeholder="اكتب لنا بصراحة — كل ملاحظةٍ تساعدنا على تحسين تجربتك." value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          {ok && <div className="alert ok">{ok}</div>}
          {err && <div className="alert err">{err}</div>}
          <button className="btn btn-gold btn-block" onClick={send} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="message" size={16} /> إرسال</>}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading ? (
            <div className="empty">جارٍ التحميل…</div>
          ) : mine.length === 0 ? (
            <div className="empty">
              <div className="em-ttl">لم ترسل ملاحظاتٍ بعد</div>
              <div>كلّ ملاحظةٍ ترسلها تصل لإدارة ملبّيك فورًا.</div>
            </div>
          ) : mine.map((f) => (
            <div key={f.id} className="trip-card" style={{ padding: 14 }}>
              <div className="tags">
                <span className="tag gold">{KINDS.find((k) => k.v === f.kind)?.t || f.kind}</span>
                <span className={`tag ${STATUS_CLS[f.status] || 'muted'}`}>{STATUS_AR[f.status] || f.status}</span>
                <span className="tag muted">{fmt(f.created_at)}</span>
              </div>
              {f.subject && <div style={{ fontWeight: 700, color: 'var(--cr-50)', marginTop: 6 }}>{f.subject}</div>}
              <div className="muted" style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{f.body}</div>
              {f.reply && (
                <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: 'rgba(43,182,140,.1)', border: '1px solid rgba(43,182,140,.3)' }}>
                  <div style={{ fontSize: 12, color: 'var(--ok-ink)', fontWeight: 700, marginBottom: 4 }}>ردّ إدارة ملبّيك · {fmt(f.replied_at)}</div>
                  <div style={{ fontSize: 13.5, color: 'var(--cr-100)', whiteSpace: 'pre-wrap' }}>{f.reply}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
