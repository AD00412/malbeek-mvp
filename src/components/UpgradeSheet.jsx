import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../app/useAuth'
import BottomSheet from './BottomSheet'
import { fmtDateTime } from '../lib/format'
import { translateRpcError } from '../lib/rpcErrors'

const STATUS_LABEL = {
  pending_proof: 'بانتظار رفع إثبات الدفع',
  submitted:     'بانتظار مراجعة الإدارة',
  approved:      'موافق — رقيت',
  rejected:      'مرفوض',
}

const ACCEPT = 'application/pdf,image/jpeg,image/jpg,image/png'
const MAX_BYTES = 5 * 1024 * 1024

/**
 * ورقة طلب الترقية للمشترك:
 *  ١) شرح الباقة (٩٩ ﷼/شهر)
 *  ٢) تعليمات التحويل البنكي
 *  ٣) رفع إثبات الدفع + مرجع التحويل + ملاحظات
 *  ٤) عرض حالة الطلب لو وجد
 */
export default function UpgradeSheet({ open, onClose, onUpgraded }) {
  const { user } = useAuth()
  const [request, setRequest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [file, setFile] = useState(null)
  const [bankRef, setBankRef] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  const load = async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc('my_upgrade_request')
    if (!error && data && data.length > 0) setRequest(data[0])
    else setRequest(null)
    setLoading(false)
  }
  useEffect(() => { if (open) load() }, [open])

  async function startRequest() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('request_plan_upgrade')
    setBusy(false)
    if (error) return setErr(translateRpcError(error, 'تعذر إنشاء الطلب.'))
    await load()
  }

  async function submitProof(e) {
    e.preventDefault()
    if (!file) return setErr('أرفق إثبات الدفع.')
    if (file.size > MAX_BYTES) return setErr('حجم الملف يتجاوز ٥ ميجا.')
    if (!ACCEPT.split(',').includes(file.type)) return setErr('نوع ملف غير مدعوم (PDF/JPG/PNG).')

    setBusy(true); setErr('')
    try {
      // رفع الإثبات إلى bucket
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
      const path = `${user.id}/proof-${Date.now()}.${ext}`
      const up = await supabase.storage.from('plan-upgrade-proofs')
        .upload(path, file, { upsert: false, contentType: file.type })
      if (up.error) throw up.error

      // ربط الإثبات بالطلب
      const { error } = await supabase.rpc('submit_plan_upgrade', {
        p_req: request.id,
        p_proof_url: path,
        p_bank_ref: bankRef.trim() || null,
        p_notes: notes.trim() || null,
      })
      if (error) throw error
      // إيميل استلام تلقائي — best-effort
      try {
        await supabase.functions.invoke('send-upgrade-received', { body: { request_id: request.id } })
      } catch { /* لا يكسر التدفق لو الإيميل فشل */ }
      await load()
    } catch (e2) {
      setErr(translateRpcError(e2, 'تعذر إرسال الإثبات.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="ترقية إلى الباقة المدفوعة">
      <div className="mlk-tab">
        {/* ملخص الباقة */}
        <div className="mlk-card is-feature">
          <div className="mlk-list-meta">
            <span className="mlk-pill em">باقة ملبّيك</span>
            <span style={{ marginInlineStart: 'auto', fontFamily: 'var(--font-display)',
                           fontSize: 22, fontWeight: 800, color: 'var(--em-500)' }}>
              ٩٩ ﷼<span style={{ fontSize: 12, color: 'var(--cr-300)' }}>/شهر</span>
            </span>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', fontSize: 13.5,
                       color: 'var(--cr-100)', lineHeight: 2 }}>
            <li>✓ رحلات غير محدودة</li>
            <li>✓ بحث كامل لمعتمرين</li>
            <li>✓ تقارير PDF و Word</li>
            <li>✓ دعم ذو أولوية</li>
          </ul>
        </div>

        {loading ? (
          <div className="mlk-empty">جار التحميل…</div>
        ) : !request ? (
          <>
            <section>
              <h2 className="mlk-h2">تعليمات التحويل</h2>
              <div className="mlk-card">
                <div style={{ fontSize: 13, lineHeight: 2, color: 'var(--cr-100)' }}>
                  حول المبلغ على هذا الحساب:
                  <div style={{ marginTop: 10, padding: 12, background: 'var(--surface-2)',
                                borderRadius: 8, fontFamily: 'monospace', fontSize: 13 }}>
                    <div className="ltr">SA00 0000 0000 0000 0000 0000</div>
                    <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--cr-300)' }}>
                      البنك: الأهلي · باسم: ملبّيك للتقنية
                    </div>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--cr-300)' }}>
                    أو تواصل مع <a href="mailto:hello@mulabeek.com" style={{ color: 'var(--em-500)' }}>hello@mulabeek.com</a> للحصول على رابط دفع.
                  </div>
                </div>
              </div>
            </section>
            {err && <div className="alert err">{err}</div>}
            <button className="mlk-action primary" onClick={startRequest} disabled={busy}
                    style={{ fontSize: 14, padding: '12px 18px' }}>
              {busy ? <span className="spinner" /> : 'بدء طلب الترقية'}
            </button>
          </>
        ) : request.status === 'pending_proof' ? (
          <>
            <div className="mlk-card">
              <div className="mlk-list-meta">
                <span className="mlk-pill warn">{STATUS_LABEL[request.status]}</span>
              </div>
              <p style={{ marginTop: 8, fontSize: 13.5, color: 'var(--cr-100)', lineHeight: 1.7 }}>
                بعدما تحول المبلغ، ارفع صورة/PDF إثبات الحوالة هنا:
              </p>
            </div>
            <form onSubmit={submitProof} className="form">
              <div className="field">
                <label>صورة/PDF إثبات الدفع <span style={{ color: 'var(--danger-ink)' }}>*</span></label>
                <input ref={fileRef} type="file" accept={ACCEPT}
                       onChange={e => setFile(e.target.files?.[0] || null)} required />
                {file && (
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                    {file.name} ({(file.size/1024).toFixed(0)} KB)
                  </div>
                )}
              </div>
              <div className="field ltr">
                <label>مرجع التحويل <span className="muted">(اختياري)</span></label>
                <input value={bankRef} onChange={e => setBankRef(e.target.value)} placeholder="TRX-XXXXXX" />
              </div>
              <div className="field">
                <label>ملاحظات للإدارة <span className="muted">(اختياري)</span></label>
                <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              {err && <div className="alert err">{err}</div>}
              <button className="mlk-action primary" type="submit" disabled={busy}
                      style={{ fontSize: 14, padding: '12px 18px' }}>
                {busy ? <span className="spinner" /> : 'إرسال الإثبات للمراجعة'}
              </button>
            </form>
          </>
        ) : request.status === 'submitted' ? (
          <div className="mlk-card is-feature">
            <div className="mlk-list-meta">
              <span className="mlk-pill info">{STATUS_LABEL[request.status]}</span>
            </div>
            <p style={{ marginTop: 8, fontSize: 13.5, color: 'var(--cr-100)', lineHeight: 1.7 }}>
              استلمنا إثبات دفعك. الإدارة تراجعه الآن، وستصلك رسالة بنتيجة المراجعة.
            </p>
            <div className="mlk-list-meta" style={{ marginTop: 6 }}>
              رفع: {fmtDateTime(request.submitted_at)}
            </div>
          </div>
        ) : request.status === 'approved' ? (
          <div className="mlk-card is-feature">
            <div className="mlk-list-meta">
              <span className="mlk-pill ok">{STATUS_LABEL[request.status]}</span>
            </div>
            <p style={{ marginTop: 8, fontSize: 13.5, color: 'var(--cr-100)', lineHeight: 1.7 }}>
              🎉 مبروك! رقيت حملتك إلى الباقة المدفوعة. كل الميزات مفعلة.
            </p>
            <button className="mlk-action primary" onClick={() => { onUpgraded?.(); onClose() }}
                    style={{ marginTop: 10 }}>
              ابدأ الاستخدام
            </button>
          </div>
        ) : (
          <div className="mlk-card">
            <div className="mlk-list-meta">
              <span className="mlk-pill danger">{STATUS_LABEL[request.status] || request.status}</span>
            </div>
            {request.reject_reason && (
              <div className="alert err" style={{ marginTop: 8 }}>
                {request.reject_reason}
              </div>
            )}
            <button className="mlk-action" onClick={startRequest} disabled={busy} style={{ marginTop: 10 }}>
              {busy ? <span className="spinner" /> : 'بدء طلب جديد'}
            </button>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
