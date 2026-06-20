import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import BottomSheet from './BottomSheet'
import Icon from './Icon'
import { SkeletonList } from './Skeleton'
import { useUI } from '../lib/useUI'
import { fmtDateTime, normalizePhone } from '../lib/format'

const STATUS_LABEL = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', done: 'منتهية' }

/**
 * تفاصيل حملةٍ كاملةٌ للإدارة — صاحب الحملة، الباقة، آخر الرحلات، عدّاد المعتمرين،
 * إجراءاتٌ سريعةٌ (ترقية/إرجاع، فتح الرابط العام، نسخ بيانات التواصل).
 */
export default function AdminSubDetail({ open, sub, onClose, onChanged }) {
  const [trips, setTrips] = useState([])
  const [owner, setOwner] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const { toast } = useUI()

  // ★ A5 — التبعيّةُ على sub?.id بدل الكائن sub (لا re-fetch زائدٌ، لا سباق)
  useEffect(() => {
    if (!open || !sub?.id) return
    let alive = true
    setLoading(true)
    ;(async () => {
      const [{ data: ts }, { data: prof }] = await Promise.all([
        supabase.from('trips').select('id, title, status, depart_at, capacity').eq('subscriber_id', sub.id)
          .order('depart_at', { ascending: false, nullsFirst: false }).limit(20),
        supabase.from('profiles').select('full_name, phone, id').eq('id', sub.owner_id).maybeSingle(),
      ])
      if (!alive) return
      setTrips(ts ?? [])
      setOwner(prof || null)
      setLoading(false)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sub?.id])

  if (!sub) return null

  async function togglePlan() {
    if (busy) return
    setBusy(true)
    const next = sub.plan === 'paid' ? 'trial' : 'paid'
    const { error } = await supabase.from('subscribers').update({ plan: next }).eq('id', sub.id)
    setBusy(false)
    if (error) toast('تعذّر التغيير: ' + error.message, { type: 'error' })
    else { toast(next === 'paid' ? 'تمت الترقية لباقةٍ مدفوعة' : 'أُعيدت لتجريبية', { type: 'success' }); onChanged?.() }
  }

  async function copy(v, label) {
    if (!v) return
    try { await navigator.clipboard.writeText(v); toast(label + ' ✓', { type: 'success' }) }
    catch { toast(v, { type: 'info' }) }
  }

  const joinUrl = `${window.location.origin}/${sub.slug}`

  return (
    <BottomSheet open={open} onClose={onClose} title={sub.org_name || 'تفاصيل الحملة'}>
      {/* بطاقة الباقة + معرّف الحملة */}
      <div className="acct-card" style={{ marginBottom: 12 }}>
        {/* ★ C3 — أيقوناتٌ بدل glyphs (sparkle للمدفوع، trial chip للباقة التجريبيّة) */}
        <div className="acct-card-av" style={{ background: sub.plan === 'paid'
          ? 'linear-gradient(135deg,var(--gd-300),rgba(196,154,69,.55))'
          : 'linear-gradient(135deg,rgba(58,160,179,.6),rgba(58,160,179,.25))',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={sub.plan === 'paid' ? 'sparkle' : 'building'} size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="acct-card-nm">{sub.org_name}</div>
          <button className="acct-card-em ltr link-chip-btn" onClick={() => copy(joinUrl, 'نُسخ رابط الحجز')} title="نسخ رابط الحجز">
            /{sub.slug} <Icon name="copy" size={11} />
          </button>
          <span className="acct-role" style={{ background: sub.plan === 'paid'
            ? 'var(--grad-gold)' : 'rgba(58,160,179,.18)', color: sub.plan === 'paid' ? 'var(--em-950)' : 'var(--info-ink)' }}>
            {sub.plan === 'paid' ? 'باقة مدفوعة' : 'تجريبية'}
          </span>
        </div>
      </div>

      {/* الإحصاءات السريعة — ★ C7: المحصّل في صفٍّ مستقلٍّ لتفادي الـoverflow على أرقامٍ كبيرة */}
      <div className="stats">
        <div className="stat info"><div className="top"><span className="ic"><Icon name="trips" size={14} /></span>الرحلات</div><div className="v">{sub.trips_count || 0}</div></div>
        <div className="stat warn"><div className="top"><span className="ic"><Icon name="customers" size={14} /></span>المعتمرون</div><div className="v">{sub.pax_count || 0}</div></div>
        <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={14} /></span>المدفوعون</div><div className="v">{sub.paid_count || 0}</div></div>
      </div>
      <div className="stats" style={{ marginTop: 10 }}>
        <div className="stat ok"><div className="top"><span className="ic"><Icon name="payments" size={14} /></span>إجمالي المحصّل</div><div className="v" style={{ fontSize: 22 }}>{Number(sub.collected || 0).toLocaleString('en-US')} <span style={{ fontSize: 13, color: 'var(--cr-300)' }}>﷼</span></div></div>
      </div>

      {/* صاحب الحملة وبيانات التواصل */}
      <div className="sec-label" style={{ marginTop: 14 }}>صاحب الحملة</div>
      <div className="trip-card" style={{ padding: 12, marginTop: 4 }}>
        <div style={{ fontWeight: 700, color: 'var(--cr-50)' }}>{owner?.full_name || '—'}</div>
        {owner?.phone && (
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* ★ B6 — أيقونة الهاتف الصحيحة (كانت bell خطأً) */}
            <a className="btn btn-ghost btn-sm" href={`tel:${owner.phone}`} title="اتّصال"><Icon name="phone" size={14} /> اتّصال</a>
            <a className="btn btn-ghost btn-sm" href={`https://wa.me/${String(owner.phone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><Icon name="message" size={14} /> واتساب</a>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(owner.phone, 'نُسخ الرقم')}><Icon name="copy" size={14} /></button>
            <span className="ltr muted" style={{ fontSize: 12, flex: 1, textAlign: 'left' }}>{owner.phone}</span>
          </div>
        )}
        {/* ★ A6 — مقارنةٌ بعد التطبيع (لا تَظهر «هاتف الحملة» لو يساوي صاحبَ الحملة بأشكالٍ مختلفة) */}
        {sub.contact_phone && normalizePhone(sub.contact_phone) !== normalizePhone(owner?.phone || '') && (
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>هاتف الحملة: <span className="ltr">{sub.contact_phone}</span></div>
        )}
      </div>

      {/* آخر الرحلات */}
      <div className="sec-label" style={{ marginTop: 14 }}>آخر الرحلات</div>
      {loading ? (
        <SkeletonList count={3} />
      ) : trips.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, padding: 10 }}>لا رحلات بعد.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {trips.map((t) => (
            <div key={t.id} className="trip-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pax-name">{t.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t.depart_at ? new Date(t.depart_at).toLocaleDateString('ar-SA') : 'بلا تاريخ'} · سعة {t.capacity || '—'}
                </div>
              </div>
              <span className="st muted" style={{ fontSize: 11 }}>{STATUS_LABEL[t.status] || t.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* إجراءاتٌ سريعة */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className={`btn ${sub.plan === 'paid' ? 'btn-ghost' : 'btn-gold'}`} style={{ flex: 1 }} onClick={togglePlan} disabled={busy}>
          {busy ? <span className="spinner" /> : (sub.plan === 'paid' ? 'إرجاع لتجريبية' : 'ترقية لمدفوعة')}
        </button>
        <a className="btn btn-ghost" style={{ flex: 1 }} href={joinUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={14} /> فتح صفحة الحجز
        </a>
      </div>

      <div className="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 10 }}>
        أُنشئت {fmtDateTime(sub.created_at) || '—'}
      </div>
    </BottomSheet>
  )
}
