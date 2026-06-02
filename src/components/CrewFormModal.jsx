import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

/**
 * تحرير بيانات الباص والطاقم (تظهر في ترويسة الكشف الرسمي) + بيانات المؤسسة.
 * يحفظ في جدولَي trips و subscribers.
 */
export default function CrewFormModal({ open, trip, sub, onClose, onSaved }) {
  // بيانات الرحلة/الباص
  const [busLabel, setBusLabel] = useState(trip?.bus_label ?? '')
  const [busPlate, setBusPlate] = useState(trip?.bus_plate ?? '')
  const [driverName, setDriverName] = useState(trip?.driver_name ?? '')
  const [driverPhone, setDriverPhone] = useState(trip?.driver_phone ?? '')
  const [assistantName, setAssistantName] = useState(trip?.assistant_name ?? '')
  const [assistantPhone, setAssistantPhone] = useState(trip?.assistant_phone ?? '')
  const [supName, setSupName] = useState(trip?.supervisor_name ?? '')
  const [supPhone, setSupPhone] = useState(trip?.supervisor_phone ?? '')
  // بيانات المؤسسة
  const [orgName, setOrgName] = useState(sub?.org_name ?? '')
  const [licenseNo, setLicenseNo] = useState(sub?.license_no ?? '')
  const [contactPhone, setContactPhone] = useState(sub?.contact_phone ?? '')
  const [stampText, setStampText] = useState(sub?.stamp_text ?? '')
  const [storeUrl, setStoreUrl] = useState(sub?.store_url ?? '')

  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    if (!trip?.id || !sub?.id) { setErr('تعذّر تحديد الرحلة أو المؤسسة. حدّث الصفحة.'); return }
    setErr(''); setBusy(true)
    try {
      const tripPayload = {
        bus_label: busLabel.trim() || null,
        bus_plate: busPlate.trim() || null,
        driver_name: driverName.trim() || null,
        driver_phone: driverPhone.trim() || null,
        assistant_name: assistantName.trim() || null,
        assistant_phone: assistantPhone.trim() || null,
        supervisor_name: supName.trim() || null,
        supervisor_phone: supPhone.trim() || null,
      }
      const r1 = await supabase.from('trips').update(tripPayload).eq('id', trip.id)
      if (r1.error) throw r1.error

      const orgPayload = {
        org_name: orgName.trim() || sub.org_name || 'حملتي',
        license_no: licenseNo.trim() || null,
        contact_phone: contactPhone.trim() || null,
        stamp_text: stampText.trim() || null,
        store_url: storeUrl.trim() || null,
      }
      const r2 = await supabase.from('subscribers').update(orgPayload).eq('id', sub.id)
      if (r2.error) throw r2.error

      onSaved?.()
    } catch (e) {
      setErr(e?.message ? 'تعذّر الحفظ: ' + e.message : 'تعذّر حفظ البيانات.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title="بيانات الباص والطاقم"
      actions={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
          <button className="btn btn-gold" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : <><Icon name="check" size={16} /> حفظ</>}
          </button>
        </>
      }
    >
      <div className="form" style={{ marginTop: 0 }}>
        <div className="sec-label">المؤسسة</div>
        <div className="field">
          <label>اسم المؤسسة / الحملة</label>
          <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field ltr">
            <label>رقم التصريح / الترخيص</label>
            <input type="text" placeholder="—" value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} />
          </div>
          <div className="field ltr">
            <label>جوال التواصل</label>
            <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>نص الختم الإلكتروني (اختياري)</label>
          <input type="text" placeholder="مثال: مؤسسة مشاعر الرحمن — معتمد" value={stampText} onChange={(e) => setStampText(e.target.value)} />
        </div>
        <div className="field ltr">
          <label>رابط متجر الدفع (سلة/زد — اختياري)</label>
          <input type="url" placeholder="https://your-store.salla.sa" value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} />
        </div>

        <div className="sec-label">الباص</div>
        <div className="grid-2">
          <div className="field">
            <label>رقم / اسم الباص</label>
            <input type="text" placeholder="باص ١" value={busLabel} onChange={(e) => setBusLabel(e.target.value)} />
          </div>
          <div className="field ltr">
            <label>لوحة الباص</label>
            <input type="text" placeholder="أ ب ج 1234" value={busPlate} onChange={(e) => setBusPlate(e.target.value)} />
          </div>
        </div>

        <div className="sec-label">السائق ومساعده</div>
        <div className="grid-2">
          <div className="field">
            <label>اسم السائق</label>
            <input type="text" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          </div>
          <div className="field ltr">
            <label>جوال السائق</label>
            <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>اسم مساعد السائق</label>
            <input type="text" value={assistantName} onChange={(e) => setAssistantName(e.target.value)} />
          </div>
          <div className="field ltr">
            <label>جوال المساعد</label>
            <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={assistantPhone} onChange={(e) => setAssistantPhone(e.target.value)} />
          </div>
        </div>

        <div className="sec-label">المشرف</div>
        <div className="grid-2">
          <div className="field">
            <label>اسم المشرف</label>
            <input type="text" value={supName} onChange={(e) => setSupName(e.target.value)} />
          </div>
          <div className="field ltr">
            <label>جوال المشرف</label>
            <input type="tel" inputMode="tel" placeholder="05xxxxxxxx" value={supPhone} onChange={(e) => setSupPhone(e.target.value)} />
          </div>
        </div>

        {err && <div className="alert err">{err}</div>}
      </div>
    </BottomSheet>
  )
}
