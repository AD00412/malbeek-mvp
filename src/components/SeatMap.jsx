import { useMemo } from 'react'
import Icon from './Icon'
import { buildSeats, isAllowed, allowedFor, policyLabel, DEFAULT_ROWS, DEFAULT_BACK } from '../lib/busLayout'
import { useUI } from '../lib/useUI'

const AREA_AR = { male: 'الرجال', female: 'النساء', family: 'العوائل' }

/**
 * مخطّط الباص التفاعلي — واقعيّ، الأبواب يمينًا والسائق/المساعد أعلى اليسار.
 *
 * @param {string} policy          سياسة المقاعد
 * @param {number} rows            عدد صفوف الأربع مقاعد
 * @param {number} back            عدد مقاعد الصفّ الخلفي
 * @param {Array}  passengers      المعتمرون الحاليّون (لإظهار المحجوز)
 * @param {string} selected        رقم المقعد المختار
 * @param {Function} onSelect
 * @param {object} forPassenger    { id?, gender, is_family }
 * @param {boolean} readOnly
 */
export default function SeatMap({
  policy = 'all_male', rows = DEFAULT_ROWS, back = DEFAULT_BACK,
  passengers = [], selected, onSelect, forPassenger, readOnly,
}) {
  const { toast } = useUI()
  const seats = useMemo(() => buildSeats(rows, back), [rows, back])
  const R = Math.max(1, Math.min(20, rows | 0))
  const B = Math.max(0, Math.min(6, back | 0))

  const taken = useMemo(() => {
    const m = new Map()
    for (const p of passengers) if (p.seat_no) m.set(String(p.seat_no), p)
    return m
  }, [passengers])

  const myGender = forPassenger?.gender
  const myFamily = !!forPassenger?.is_family

  function seatState(seat) {
    const key = String(seat.no)
    const holder = taken.get(key)
    const isMine = holder && forPassenger?.id && holder.id === forPassenger.id
    const a = allowedFor(seat, policy)
    const ok = isAllowed(seat, policy, myGender, myFamily)

    if (holder && !isMine) return { kind: 'taken', holder, a }
    if (selected != null && String(selected) === key) return { kind: 'selected', a }
    if (isMine) return { kind: 'selected', holder, a }
    if (!myGender && !myFamily) return { kind: 'available', a }   // لا تقييد قبل اختيار الجنس
    return ok ? { kind: 'available', a } : { kind: 'locked', a }
  }

  function pick(seat) {
    if (readOnly) return
    const s = seatState(seat)
    // اشرح سبب تعذّر الاختيار بدل صمتٍ على اللمس (لا يظهر title على الجوال).
    if (s.kind === 'taken') {
      const nm = s.holder?.full_name ? ` (${s.holder.full_name})` : ''
      toast(`المقعد ${seat.no} محجوزٌ${nm}`, { type: 'info' })
      return
    }
    if (s.kind === 'locked') {
      toast(s.a ? `المقعد ${seat.no} مخصّصٌ لمنطقة ${AREA_AR[s.a] || ''}` : `المقعد ${seat.no} غير متاحٍ لهذا الاختيار`, { type: 'info' })
      return
    }
    onSelect?.(String(seat.no))
  }

  const rowList = Array.from({ length: R })
  const backSeats = seats.filter((s) => s.kind === 'back')

  return (
    <div className="bus3d">
      <div className="bus3d-body">
        {/* هوائيّان عند المقدّمة */}
        <span className="bus-antenna left" aria-hidden="true" />
        <span className="bus-antenna right" aria-hidden="true" />

        {/* بابان على يمين الشاشة: دخولٌ أماميّ · خروجٌ أوسط (أسهمٌ توضيحيّة) */}
        <span className="bus-door bus-door-front" aria-hidden="true">
          <Icon name="arrowLeft" size={11} />
          <b>مدخل</b>
        </span>
        <span className="bus-door bus-door-mid" aria-hidden="true">
          <Icon name="arrowRight" size={11} />
          <b>مخرج</b>
        </span>

        {/* المقدّمة: زجاجٌ أماميٌّ مقوّس + كابينة السائق يسارًا */}
        <div className="bus3d-cab">
          <div className="cab-windshield" aria-hidden="true" />
          <div className="cab-driver">
            <span className="wheel" />
            <span className="cab-lbl">السائق</span>
          </div>
        </div>

        {/* صالة المقاعد */}
        <div className="bus3d-cabin">
          {rowList.map((_, row) => {
            const rowSeats = seats.filter((s) => s.row === row)
            // الترقيم يمين←يسار: النافذة اليمنى أوّلًا (الأصغر) ثمّ الممرّ
            const right = rowSeats.filter((s) => s.col <= 1).sort((a, b) => a.col - b.col)
            const left = rowSeats.filter((s) => s.col >= 3).sort((a, b) => a.col - b.col)
            return (
              <div className="cabin-row" key={row}>
                <div className="pair pair-right">
                  {right.map((s) => <SeatBtn key={s.no} seat={s} state={seatState(s)} onPick={pick} />)}
                </div>
                <div className="aisle-gap" aria-hidden="true" />
                <div className="pair pair-left">
                  {left.map((s) => <SeatBtn key={s.no} seat={s} state={seatState(s)} onPick={pick} />)}
                </div>
              </div>
            )
          })}

          {/* الصفّ الخلفي المتراصّ */}
          {B > 0 && (
            <div className="cabin-back" style={{ gridTemplateColumns: `repeat(${B}, 1fr)` }}>
              {backSeats.map((s) => <SeatBtn key={s.no} seat={s} state={seatState(s)} onPick={pick} />)}
            </div>
          )}
        </div>

        {/* الصادم الخلفيّ */}
        <div className="bus-rear" aria-hidden="true" />
      </div>

      <Legend policy={policy} />
    </div>
  )
}

const KIND_AR = { available: 'متاح', selected: 'مختار', taken: 'محجوز', locked: 'مقيّد' }

function SeatBtn({ seat, state, onPick }) {
  const cls = `seat3d seat-${state.kind} ${state.a ? 'a-' + state.a : ''}`
  const holder = state.holder
  const hasName = holder && (holder.full_name || '').trim()
  const firstName = hasName ? holder.full_name.trim().split(/\s+/)[0] : (holder ? '•' : '')
  const title = hasName ? `${holder.full_name} · مقعد ${seat.no}`
    : holder ? `محجوز · مقعد ${seat.no}` : `مقعد ${seat.no}`
  const blocked = state.kind === 'taken' || state.kind === 'locked'
  // لا نستخدم disabled كي تعمل اللمسة فتشرح سبب المنع عبر toast؛ نُعلِم الوصوليّة بـ aria.
  return (
    <button
      type="button"
      className={cls}
      onClick={() => onPick(seat)}
      title={title}
      aria-label={`مقعد ${seat.no} — ${KIND_AR[state.kind] || ''}${hasName ? ' · ' + holder.full_name : ''}`}
      aria-pressed={state.kind === 'selected'}
      aria-disabled={blocked || undefined}
    >
      <span className="s-head" />
      <span className="s-body">
        <span className="s-no">{seat.no}</span>
        {holder && <span className="s-nm">{firstName}</span>}
      </span>
    </button>
  )
}

function Legend({ policy }) {
  return (
    <div className="bus-legend">
      <div className="lg-policy">السياسة: <strong>{policyLabel(policy)}</strong></div>
      <div className="lg-row">
        <span className="lg-chip"><i className="dot avail" /> متاح</span>
        <span className="lg-chip"><i className="dot mine" /> مختار</span>
        <span className="lg-chip"><i className="dot taken" /> محجوز</span>
        <span className="lg-chip"><i className="dot locked" /> مقيّد</span>
      </div>
      <div className="lg-row">
        <span className="lg-chip"><i className="dot a-male" /> ذكور</span>
        <span className="lg-chip"><i className="dot a-female" /> إناث</span>
        <span className="lg-chip"><i className="dot a-family" /> عوائل</span>
      </div>
    </div>
  )
}
