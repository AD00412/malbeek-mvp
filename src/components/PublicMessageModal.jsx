import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { withTimeout } from '../lib/format'
import Icon from './Icon'

/* ============================================================
   نموذج عام موحد — تواصل + ملاحظات (للزوار غير المسجلين)
   - mode="contact": اسم/بريد/موضوع/رسالة + مرفقات
   - mode="feedback": اسم/بريد/نوع/تفاصيل + مرفقات (نوع = اقتراح/مشكلة/...)
   - يرسل إلى جدول public.public_messages عبر RPC ‎submit_public_message‎
     فلا حاجة للـ session ولا للـ RLS المعقدة
   - المرفقات ترفع لـ bucket ‎public-attachments‎ تحت مسار مجهول
   ============================================================ */

const MAX_BYTES = 5 * 1024 * 1024
const MAX_FILES = 3
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']

const FEEDBACK_KINDS = [
  { v: 'suggestion', t: 'اقتراح' },
  { v: 'problem',    t: 'مشكلة' },
  { v: 'question',   t: 'سؤال' },
  { v: 'feature',    t: 'ميزة جديدة' },
]

function isValidEmail(s = '') { return /^\S+@\S+\.\S+$/.test(String(s).trim()) }

export default function PublicMessageModal({ open, mode = 'contact', onClose }) {
  const isContact = mode === 'contact'

  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [subject, setSubject] = useState('')
  const [kind, setKind]       = useState('suggestion')
  const [body, setBody]       = useState('')
  const [files, setFiles]     = useState([])     // [{ file, previewUrl, type }]
  const [busy, setBusy]       = useState(false)
  const [stage, setStage]     = useState('form') // 'form' | 'success'
  const [err, setErr]         = useState('')
  const fileInput             = useRef(null)
  const dropRef               = useRef(null)

  // إغلاق بـ Escape + قفل تمرير الصفحة + تنظيف معاينات الملفات
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, busy, onClose])

  // عند الإغلاق: مسح الحالة وroot URLs للمعاينة (تجنب تسرب الذاكرة)
  useEffect(() => {
    if (!open) {
      files.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl) })
      setName(''); setEmail(''); setSubject(''); setKind('suggestion'); setBody('')
      setFiles([]); setErr(''); setStage('form'); setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const addFiles = useCallback((list) => {
    setErr('')
    const incoming = Array.from(list || [])
    if (!incoming.length) return
    const slots = MAX_FILES - files.length
    if (slots <= 0) { setErr(`الحد الأقصى ${MAX_FILES} مرفقات.`); return }
    const accepted = []
    for (const f of incoming.slice(0, slots)) {
      if (!OK_TYPES.includes(f.type)) { setErr('الصيغ المسموحة: PNG · JPG · WebP · PDF'); continue }
      if (f.size > MAX_BYTES) { setErr(`«${f.name}» أكبر من ٥ ميغابايت.`); continue }
      const previewUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : ''
      // مفتاحٌ ثابتٌ للقائمة (name+size+lastModified) — يمنع ربط المعاينات خطأً
      // عند حذف ملفٍّ وسطيّ (بدل key=index).
      accepted.push({ file: f, previewUrl, type: f.type, _key: `${f.name}-${f.size}-${f.lastModified}` })
    }
    if (accepted.length) setFiles((prev) => [...prev, ...accepted])
  }, [files])

  function removeFile(i) {
    setFiles((prev) => {
      const next = [...prev]
      const [removed] = next.splice(i, 1)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return next
    })
  }

  // Drag-and-drop
  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const prevent = (e) => { e.preventDefault(); e.stopPropagation() }
    const onDragOver = (e) => { prevent(e); el.classList.add('dragging') }
    const onDragLeave = (e) => { prevent(e); el.classList.remove('dragging') }
    const onDrop = (e) => {
      prevent(e)
      el.classList.remove('dragging')
      addFiles(e.dataTransfer?.files)
    }
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
    }
  }, [addFiles])

  async function submit(e) {
    e?.preventDefault?.()
    if (busy) return
    setErr('')

    // تحقق يدوي — تجربة أنظف من رسائل المتصفح الأصلية
    if (!name.trim() || name.trim().length < 2) { setErr('اكتب اسمك (حرفان فأكثر).'); return }
    if (!isValidEmail(email))                   { setErr('بريد إلكتروني غير صحيح.'); return }
    if (!body.trim() || body.trim().length < 10){ setErr('اكتب رسالتك (١٠ أحرف على الأقل).'); return }

    setBusy(true)
    try {
      // ١) رفع المرفقات (إن وجدت) إلى المجلد العام
      // الامتدادات المسموحة فقط — تطابق MIME types المقبولة وتمنع رفع
      // ملفات بامتدادات خطرة (html/exe/php...) حتى لو spoofed.
      const SAFE_EXT_FOR_MIME = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'application/pdf': 'pdf',
      }
      const uploaded = []
      for (const f of files) {
        const rand = Math.random().toString(36).slice(2, 8)
        // نشتق الامتداد من MIME (لا من اسم الملف) — لا spoofing ممكن
        const ext = SAFE_EXT_FOR_MIME[f.file.type] || 'bin'
        // نبقي اسم الملف الأصلي ضمن المسار — لتظهر في البريد بشكل مفهوم.
        // نحتفظ بالأحرف العربية واللاتينية والأرقام والشرطات فقط، ونحد الطول.
        const baseName = (f.file.name.replace(/\.[^.]+$/, '') || 'file')
          .replace(/[^\w؀-ۿݐ-ݿ-]+/g, '_')
          .slice(0, 50)
        const path = `public/${Date.now()}-${rand}-${baseName}.${ext}`
        const { error: upErr } = await withTimeout(
          supabase.storage
            .from('public-attachments')
            .upload(path, f.file, { upsert: false, contentType: f.file.type, cacheControl: '3600' }),
          30000,
          'تعذر رفع المرفق — استغرق وقتا طويلا. أعد المحاولة أو أرسل دون مرفقات.'
        )
        if (upErr) throw upErr
        uploaded.push(path)
      }

      // ٢) استدعاء RPC submit_public_message (يلتف على RLS بصلاحية controlled)
      const { error } = await withTimeout(
        supabase.rpc('submit_public_message', {
          p_mode:    mode,
          p_name:    name.trim(),
          p_email:   email.trim().toLowerCase(),
          p_subject: isContact ? subject.trim() || null : null,
          p_kind:    !isContact ? kind : null,
          p_body:    body.trim(),
          p_attachments: uploaded,
        }),
        15000,
        'تعذر الإرسال — تحقق من اتصالك وأعد المحاولة.'
      )
      if (error) throw error

      setStage('success')
    } catch (e2) {
      // رسالة مفيدة بدل التفاصيل التقنية
      const msg = String(e2?.message || '')
      if (msg.includes('Bucket not found')) setErr('خدمة المرفقات غير مهيأة بعد. أرسل رسالتك دون مرفقات، أو راسلنا على hello@mulabeek.com مباشرة.')
      else if (msg.includes('function') && msg.includes('does not exist')) setErr('خدمة النموذج غير مهيأة بعد. راسلنا على hello@mulabeek.com مباشرة.')
      else setErr('تعذر الإرسال. حاول مرة أخرى — أو راسلنا على hello@mulabeek.com.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="doc-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="doc-modal pmsg-modal">
        {stage === 'success' ? (
          <div className="pmsg-success">
            <div className="pmsg-success-ic"><Icon name="check" size={28} /></div>
            <h3>وصلت رسالتك ✓</h3>
            <p>نقرأ كل رسالة بأنفسنا — سنرد عليك على بريدك <b className="ltr">{email}</b> خلال يومي عمل.</p>
            <button type="button" className="btn btn-em btn-block" onClick={onClose}>تمام</button>
          </div>
        ) : (
          <>
            <div className="doc-modal-head">
              <div className="doc-modal-badge">
                <Icon name={isContact ? 'mail' : 'message'} size={20} />
              </div>
              <div>
                <h3>{isContact ? 'تواصل معنا' : 'أرسل ملاحظة'}</h3>
                <span className="doc-modal-sub">{isContact ? 'سؤال، عرض شراكة، أو أي شيء يخطر ببالك' : 'بلاغ، اقتراح، أو ميزة تود رؤيتها'}</span>
              </div>
              <button
                type="button"
                className="doc-modal-close"
                onClick={onClose}
                disabled={busy}
                aria-label="إغلاق"
              >×</button>
            </div>

            <form onSubmit={submit} className="pmsg-form" noValidate>
              <div className="pmsg-row">
                <div className="field with-ic">
                  <label>الاسم <span className="req">*</span></label>
                  <span className="f-ic"><Icon name="user" size={16} /></span>
                  <input
                    type="text"
                    placeholder="اسمك الكامل"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                    autoFocus
                  />
                </div>
                <div className="field with-ic ltr">
                  <label>البريد <span className="req">*</span></label>
                  <span className="f-ic"><Icon name="mail" size={16} /></span>
                  <input
                    type="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>

              {isContact ? (
                <div className="field">
                  <label>الموضوع <span className="muted" style={{ fontSize: 12 }}>(اختياري)</span></label>
                  <input
                    type="text"
                    placeholder="مثلا: استفسار عن الباقات"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    disabled={busy}
                  />
                </div>
              ) : (
                <div className="field">
                  <label>نوع الملاحظة <span className="req">*</span></label>
                  <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
                    {FEEDBACK_KINDS.map((k) => <option key={k.v} value={k.v}>{k.t}</option>)}
                  </select>
                </div>
              )}

              <div className="field">
                <label>الرسالة <span className="req">*</span></label>
                <textarea
                  rows={5}
                  placeholder={isContact ? 'اكتب لنا بصراحة ما تحتاج — كل رسالة تصلنا نقرؤها' : 'صف الموقف بأكبر تفصيل ممكن — اللحظة، الخطوة، النتيجة المتوقعة'}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={busy}
                />
                <span className="hint" style={{ marginTop: 4 }}>
                  {body.length > 0 ? `${body.length} حرفا` : '١٠ أحرف على الأقل'}
                </span>
              </div>

              {/* منطقة المرفقات */}
              <div className="field">
                <label>مرفقات <span className="muted" style={{ fontSize: 12 }}>(اختياري · حدى ٣ ملفات)</span></label>
                <div ref={dropRef} className="pmsg-drop">
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => { addFiles(e.target.files); if (fileInput.current) fileInput.current.value = '' }}
                  />
                  <button
                    type="button"
                    className="pmsg-drop-trigger"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy || files.length >= MAX_FILES}
                  >
                    <Icon name="download" size={18} style={{ transform: 'rotate(180deg)' }} />
                    <strong>أضف ملفا أو اسحبه هنا</strong>
                    <span className="muted">PNG · JPG · WebP · PDF — حتى ٥ ميغا</span>
                  </button>

                  {files.length > 0 && (
                    <ul className="pmsg-files">
                      {files.map((f, i) => (
                        <li key={f._key || i}>
                          {f.previewUrl
                            ? <img src={f.previewUrl} alt="" className="pmsg-file-thumb" />
                            : <span className="pmsg-file-thumb pdf"><Icon name="manifest" size={18} /></span>}
                          <span className="pmsg-file-name">{f.file.name}</span>
                          <span className="pmsg-file-sz">{(f.file.size / 1024).toFixed(0)} ك.ب</span>
                          <button
                            type="button"
                            className="pmsg-file-x"
                            onClick={() => removeFile(i)}
                            aria-label="إزالة الملف"
                            disabled={busy}
                          >×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {err && <div className="alert err">{err}</div>}

              <div className="pmsg-actions" style={{ marginTop: 8 }}>
                <button type="submit" className="btn btn-em" disabled={busy} style={{ flex: 1 }}>
                  {busy
                    ? <><span className="spinner" /> جار الإرسال…</>
                    : <><Icon name="check" size={15} /> {isContact ? 'إرسال' : 'إرسال الملاحظة'}</>}
                </button>
                <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
