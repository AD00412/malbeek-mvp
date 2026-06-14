import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { safeExt } from '../lib/format'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import SignedImage from './SignedImage'
import { useAuth } from '../app/useAuth'

const MAX_BYTES = 5 * 1024 * 1024
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp']

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
  const [attachUrls, setAttachUrls] = useState({})    // {path: signedUrl} مُجمَّعٌ مسبقًا
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState(null)            // الصورة قبل الرفع (للمعاينة)
  const [previewUrl, setPreviewUrl] = useState('')  // object URL محلّيٌّ للمعاينة
  const [uploading, setUploading] = useState(false) // أثناء رفع المرفق فقط
  const fileRef = useRef(null)
  const previewRef = useRef('')                     // مرآةٌ للتنظيف عند التفكيك

  // نظافةٌ مضمونة: ألغِ آخر object URL حين يُفكَّك المكوّن (ولو بقي open=true).
  useEffect(() => { previewRef.current = previewUrl }, [previewUrl])
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])

  const loadMine = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('feedback')
      .select('id, kind, subject, body, reply, status, replied_at, created_at, attachment_url')
      .eq('profile_id', user.id).order('created_at', { ascending: false }).limit(50)
    const rows = data ?? []
    setMine(rows)
    // جلبٌ مجمَّعٌ لروابط المرفقات (يُلغي طلب signed URL لكلّ صفٍّ على حدة)
    const paths = rows.map((r) => r.attachment_url).filter(Boolean)
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from('feedback-attachments').createSignedUrls(paths, 60 * 60)
      const map = {}
      for (const s of signed ?? []) if (s.path && s.signedUrl) map[s.path] = s.signedUrl
      setAttachUrls(map)
    } else setAttachUrls({})
    setLoading(false)
  }, [user])

  useEffect(() => { if (open && view === 'mine') loadMine() }, [open, view, loadMine])
  useEffect(() => {
    if (!open) {
      setOk(''); setErr(''); setSubject(''); setBody(''); setKind('suggestion'); setView('new')
      setFile(null); setPreviewUrl((u) => { if (u) URL.revokeObjectURL(u); return '' })
    }
  }, [open])

  function pickFile() { fileRef.current?.click() }
  function clearFile() {
    setFile(null)
    setPreviewUrl((u) => { if (u) URL.revokeObjectURL(u); return '' })
    if (fileRef.current) fileRef.current.value = ''
  }
  function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!OK_TYPES.includes(f.type)) { setErr('الصيغة غير مدعومة. استخدم PNG / JPG / WebP.'); return }
    if (f.size > MAX_BYTES)        { setErr('حجم الصورة كبير (٥ ميغابايت كحدٍّ أقصى).'); return }
    setErr('')
    setFile(f)
    setPreviewUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(f) })
  }

  async function send() {
    if (busy) return
    if (!body.trim()) { setErr('اكتب نصّ الملاحظة.'); return }
    setErr(''); setOk(''); setBusy(true)
    try {
      // ١) ارفع المرفق أوّلًا (إن وُجد) — تحت مجلّد profile_id الخاصّ بك (RLS تحرس)
      let attachment_url = null
      if (file && user?.id) {
        setUploading(true)
        // مزجٌ بين الزمن ومُعرّفٍ عشوائيٍّ يمنع التصادم عند تكرار النقرة في الـ ms ذاتها
        const ext = safeExt(file)
        const rand = Math.random().toString(36).slice(2, 6)
        const path = `${user.id}/${Date.now()}-${rand}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('feedback-attachments')
          .upload(path, file, { upsert: false, cacheControl: '3600', contentType: file.type })
        setUploading(false)
        if (upErr) throw upErr
        attachment_url = path   // نخزّن المسار، الإدارة تجلب signed URL وقت العرض
      }

      // ٢) أدرج الملاحظة
      const { error } = await supabase.from('feedback').insert({
        profile_id: user.id,
        subscriber_id: subscriberId || null,
        audience,
        kind,
        subject: subject.trim() || null,
        body: body.trim(),
        attachment_url,
      })
      if (error) throw error
      setOk('وصلت ملاحظتك ✓ سنرجع لك بأقرب وقت.')
      setBody(''); setSubject(''); clearFile()
      if (view === 'mine') loadMine()
    } catch (e) {
      setErr(e?.message ? 'تعذّر الإرسال: ' + e.message : 'تعذّر الإرسال.')
    } finally {
      setBusy(false); setUploading(false)
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

          <div className="field">
            <label>لقطة شاشة أو صورة <span className="muted" style={{ fontSize: 12 }}>(اختياري)</span></label>
            <input
              ref={fileRef} type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={onFile}
            />
            {previewUrl ? (
              <div className="img-upload preview">
                <img src={previewUrl} alt="معاينة" />
                <div className="img-upload-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={pickFile} disabled={busy}>
                    <Icon name="refresh" size={14} /> استبدال
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearFile} disabled={busy} style={{ color: 'var(--danger)' }}>
                    <Icon name="trash" size={14} /> إزالة
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="img-upload dropzone" onClick={pickFile} disabled={busy}>
                <Icon name="download" size={22} style={{ transform: 'rotate(180deg)' }} />
                <strong>أرفِق لقطة شاشة للخطأ</strong>
                <span className="muted" style={{ fontSize: 12 }}>PNG/JPG/WebP · ٥ ميغابايت كحدٍّ أقصى · ترى الإدارة فقط</span>
              </button>
            )}
          </div>

          {ok && <div className="alert ok">{ok}</div>}
          {err && <div className="alert err">{err}</div>}
          <button className="btn btn-gold btn-block" onClick={send} disabled={busy}>
            {busy
              ? <><span className="spinner" /> {uploading ? 'جارٍ رفع الصورة…' : 'جارٍ الإرسال…'}</>
              : <><Icon name="message" size={16} /> إرسال</>}
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
              {f.attachment_url && (
                <SignedImage
                  bucket="feedback-attachments"
                  path={f.attachment_url}
                  presignedUrl={attachUrls[f.attachment_url]}
                />
              )}
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

