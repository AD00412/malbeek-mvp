import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { useUI } from '../lib/useUI'

const DEFAULT_SETTINGS = {
  columns: {
    national_id: true,
    nationality: true,
    phone: true,
    seat_no: true,
    boarding_point: true,
    status: true,
    notes: true,
  },
  show_summary: true,
  show_stamp: true,
  show_signature: true,
  signer_name: '',
}

function merge(saved) {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    columns: { ...DEFAULT_SETTINGS.columns, ...(saved?.columns || {}) },
  }
}

const COL_LABELS = {
  national_id: 'رقم الهوية / الإقامة',
  nationality: 'الجنسية',
  phone: 'رقم الجوال',
  seat_no: 'رقم المقعد',
  boarding_point: 'مكان الركوب',
  status: 'الحالة',
  notes: 'ملاحظات',
}

export default function ReportSettings({ sub, settings: initialSettings, onSave, onClose }) {
  const { toast } = useUI()
  const [s, setS] = useState(() => merge(initialSettings))
  const [saving, setSaving] = useState(false)

  function toggleCol(key) {
    setS((prev) => ({
      ...prev,
      columns: { ...prev.columns, [key]: !prev.columns[key] },
    }))
  }

  function setField(key, val) {
    setS((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (sub?.id) {
        const { error } = await supabase
          .from('subscribers')
          .update({ report_settings: s })
          .eq('id', sub.id)
        if (error) throw error
      }
      toast('تم حفظ الإعدادات', { type: 'success' })
      onSave(s)
    } catch (e) {
      console.error(e)
      toast('تعذر حفظ الإعدادات — ' + (e?.message || ''), { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open onClose={onClose} title="إعدادات الكشوفات والتقارير">
      <div className="rs-sheet" dir="rtl">

        <section className="rs-section">
          <div className="rs-section-title">الأعمدة المعروضة في الكشف</div>
          <div className="rs-cols-grid">
            {Object.entries(COL_LABELS).map(([key, label]) => (
              <label key={key} className="rs-toggle">
                <input
                  type="checkbox"
                  checked={s.columns[key] !== false}
                  onChange={() => toggleCol(key)}
                />
                <span className="rs-toggle-box" />
                <span className="rs-toggle-label">{label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="rs-section">
          <div className="rs-section-title">عناصر الكشف</div>
          {[
            { key: 'show_summary', label: 'شريط الملخص (الإجماليات)' },
            { key: 'show_stamp', label: 'الختم الإلكتروني' },
            { key: 'show_signature', label: 'سطر توقيع المسؤول' },
          ].map(({ key, label }) => (
            <label key={key} className="rs-toggle rs-toggle-row">
              <input
                type="checkbox"
                checked={s[key] !== false}
                onChange={() => setField(key, !s[key])}
              />
              <span className="rs-toggle-box" />
              <span className="rs-toggle-label">{label}</span>
            </label>
          ))}
          {s.show_signature !== false && (
            <div className="rs-field rs-signer-field">
              <label>اسم الموقّع</label>
              <input
                value={s.signer_name}
                onChange={(e) => setField('signer_name', e.target.value)}
                placeholder="اسم المسؤول للتوقيع"
              />
            </div>
          )}
          <p className="rs-hint">
            بيانات الناقل والسائقين واللوحة تُعدَّل من محرّر الرحلة — الكشف يقرأها تلقائياً.
          </p>
        </section>

        <div className="rs-actions">
          <button className="btn btn-em" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : <Icon name="manifest" size={16} />}
            حفظ الإعدادات
          </button>
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </BottomSheet>
  )
}
