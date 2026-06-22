import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { parseTextTable } from '../lib/textTable'
import { toLatinDigits, normalizePhone, cleanName, isValidNationalId, isValidSaPhone } from '../lib/format'
import { busName } from '../lib/buses'
import { translateRpcError } from '../lib/rpcErrors'

/**
 * استيراد جماعي للمعتمرين من نص ملصوق (CSV أو منسوخ من Excel) لرحلة معينة.
 * ترتيب الأعمدة: الاسم · الهوية · الجوال · الجنسية · الجنس · مكان الركوب.
 * يتحقق ويعاين قبل الإدراج؛ المقاعد تترك فارغة لتوزع لاحقا.
 */
export default function ImportPassengers({ open, tripId, subscriberId, buses = [], defaultBoarding, onClose, onDone }) {
  const [text, setText] = useState('')
  const [skipHeader, setSkipHeader] = useState(false)
  const [busId, setBusId] = useState(buses[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const multiBus = buses.length > 1

  // إن وصلت الباصات بعد فتح المودال (تحميل غير متزامن) ولم يختر باص بعد،
  // ثبت الافتراضي على الأول كي لا يسقط bus_id صامتا عند تعدد الباصات.
  useEffect(() => {
    if (!busId && buses.length) setBusId(buses[0].id)
  }, [buses, busId])

  const parsed = useMemo(() => {
    if (!text.trim()) return []
    let rows = parseTextTable(text)
    if (skipHeader && rows.length) rows = rows.slice(1)
    return rows.map((r, i) => {
      const [name = '', nid = '', phone = '', nat = '', gen = '', board = ''] = r
      const full = cleanName(name)
      const national = toLatinDigits(nid).trim()
      const ph = phone.trim()
      const g = /أنث|female|f/i.test(gen) ? 'female' : 'male'
      const errors = []
      if (!full) errors.push('الاسم مطلوب')
      if (national && !isValidNationalId(national)) errors.push('هوية غير صحيحة')
      if (ph && !isValidSaPhone(ph)) errors.push('جوال غير صحيح')
      return {
        i,
        full_name: full,
        national_id: national || null,
        phone: ph ? normalizePhone(ph) : null,
        nationality: nat.trim() || null,
        gender: g,
        boarding_point: board.trim() || defaultBoarding || null,
        errors,
      }
    })
  }, [text, skipHeader, defaultBoarding])

  const valid = parsed.filter((p) => p.errors.length === 0)
  const invalid = parsed.length - valid.length

  async function doImport() {
    if (busy || valid.length === 0) return
    setBusy(true); setErr('')
    try {
      const payload = valid.map((p) => ({
        trip_id: tripId,
        subscriber_id: subscriberId,
        full_name: p.full_name,
        national_id: p.national_id,
        phone: p.phone,
        nationality: p.nationality,
        gender: p.gender,
        boarding_point: p.boarding_point,
        status: 'registered',
        ...(multiBus && busId ? { bus_id: busId } : {}),
      }))
      const { error } = await supabase.from('passengers').insert(payload)
      if (error) throw error
      onDone?.(valid.length)
    } catch (e) {
      setErr(translateRpcError(e, 'تعذر الاستيراد.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title="استيراد معتمرين"
      actions={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
          <button className="btn btn-gold" onClick={doImport} disabled={busy || valid.length === 0}>
            {busy ? <span className="spinner" /> : <><Icon name="download" size={16} /> استيراد {valid.length || ''}</>}
          </button>
        </>
      }
    >
      <div className="form" style={{ marginTop: 0 }}>
        <div className="alert info" style={{ fontSize: 12.5 }}>
          الصق القائمة (من Excel أو ملف CSV). ترتيب الأعمدة:
          <strong> الاسم · الهوية · الجوال · الجنسية · الجنس · مكان الركوب</strong>. الاسم وحده مطلوب.
        </div>

        <div className="field">
          <label>الصق البيانات هنا</label>
          <textarea
            style={{ minHeight: 140, fontFamily: 'var(--font-text)', direction: 'ltr', textAlign: 'right' }}
            placeholder={'الاسم الرباعي,1012345678,0501234567,سعودي,ذكر,المحطة المركزية\nالاسم الرباعي,2098765432,0559876543,سعودي,أنثى'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--cr-200)', cursor: 'pointer' }}>
          <input type="checkbox" checked={skipHeader} onChange={(e) => setSkipHeader(e.target.checked)} />
          السطر الأول عناوين (تخطيه)
        </label>

        {multiBus && (
          <>
            <div className="sec-label">الباص</div>
            <div className="bus-tabs">
              {buses.map((b) => (
                <button key={b.id} type="button" className={`bus-tab ${b.id === busId ? 'active' : ''}`} onClick={() => setBusId(b.id)}>
                  <Icon name="bus" size={15} /> {busName(b)}
                </button>
              ))}
            </div>
          </>
        )}

        {parsed.length > 0 && (
          <>
            <div className="sec-label">
              معاينة — <span style={{ color: 'var(--ok-ink)' }}>{valid.length} صالح</span>
              {invalid > 0 && <span style={{ color: 'var(--danger)' }}> · {invalid} بها أخطاء</span>}
            </div>
            <div className="tbl-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
              <table className="tbl tbl-cards">
                <thead><tr><th>#</th><th>الاسم</th><th>الهوية</th><th>الجوال</th><th>الجنس</th><th>الحالة</th></tr></thead>
                <tbody>
                  {parsed.map((p) => (
                    <tr key={p.i} style={p.errors.length ? { background: 'rgba(224,88,75,.08)' } : undefined}>
                      <td data-label="#">{p.i + 1}</td>
                      <td data-label="الاسم" className="mf-name" style={{ textAlign: 'right' }}>{p.full_name || '—'}</td>
                      <td data-label="الهوية" className="ltr">{p.national_id || '—'}</td>
                      <td data-label="الجوال" className="ltr">{p.phone || '—'}</td>
                      <td data-label="الجنس">{p.gender === 'female' ? 'أنثى' : 'ذكر'}</td>
                      <td data-label="الحالة">{p.errors.length
                        ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{p.errors.join('، ')}</span>
                        : <span className="tag ok"><Icon name="check" size={13} /></span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {err && <div className="alert err">{err}</div>}
      </div>
    </BottomSheet>
  )
}
