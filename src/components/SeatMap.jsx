import { useMemo } from 'react'
import Icon from './Icon'
import { buildSeats, allowedFor, policyLabel } from '../lib/busLayout'

/**
 * مخطّط الباص التفاعلي — ٤٩ مقعدًا.
 *
 * @param {string} policy            سياسة المقاعد ('all_male' | …)
 * @param {Array}  passengers        قائمة المعتمرين الحاليين (لإظهار المحجوز)
 * @param {string} selected          رقم المقعد المختار حاليًّا (نصّيًّا)
 * @param {Function} onSelect        (seatNo:string) => void
 * @param {object} forPassenger      { id?, gender, is_family } — لتقييد ما يمكنه اختياره
 * @param {boolean} readOnly         عرضٌ فقط بلا اختيار (للخريطة العامّة)
 * @param {boolean} compact          مدمج (للنوافذ الصغيرة)
 */
export default function SeatMap({ policy = 'all_male', passengers = [], selected, onSelect, forPassenger, readOnly, compact }) {
  const seats = useMemo(() => buildSeats(), [])

  /* خريطة: رقم المقعد ← المعتمر الذي يحجزه */
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
    const allowed = a === 'any' || a === 'family' || a === myGender || (myFamily && a !== 'female' && a !== 'male' ? true : myFamily && a === 'female' ? true : myFamily && a === 'male' ? true : false) || myFamily
    // simplified: family can sit in family-or-any zones; gender-restricted zones blocked unless matches.
    const familyOk = myFamily && (a === 'family' || a === 'any')
    const ok = a === 'any' || a === 'family' || a === myGender || familyOk

    if (holder && !isMine) return { kind: 'taken', holder, a }
    if (selected != null && String(selected) === key) return { kind: 'selected', a }
    if (isMine) return { kind: 'selected', holder, a }
    if (!myGender && !myFamily) return { kind: 'available', a }   // لا تقييد قبل اختيار الجنس
    return ok ? { kind: 'available', a } : { kind: 'locked', a }
  }

  function pick(seat) {
    if (readOnly) return
    const s = seatState(seat)
    if (s.kind === 'taken' || s.kind === 'locked') return
    onSelect?.(String(seat.no))
  }

  return (
    <div className={`bus-wrap ${compact ? 'compact' : ''}`}>
      <div className="bus-frame">
        {/* مقدّمة الباص: السائق والمساعد + باب الدخول */}
        <div className="bus-front">
          <div className="bus-driver" title="مقعد السائق">
            <Icon name="settings" size={14} />
          </div>
          <div className="bus-assist" title="مساعد السائق">
            <Icon name="customers" size={14} />
          </div>
          <div className="bus-entry"><Icon name="arrowRight" size={14} /> دخول</div>
        </div>

        {/* صفوف المقاعد ١-٤٤ */}
        <div className="bus-rows">
          {Array.from({ length: 11 }).map((_, row) => {
            const rowSeats = seats.filter((s) => s.row === row).sort((a, b) => a.col - b.col)
            return (
              <div className="bus-row" key={row}>
                {[0, 1, 2, 3, 4].map((col) => {
                  if (col === 2) return <div className="bus-aisle" key={col} />
                  const seat = rowSeats.find((s) => s.col === col)
                  if (!seat) return <div key={col} />
                  return <SeatBtn key={col} seat={seat} state={seatState(seat)} onPick={pick} />
                })}
              </div>
            )
          })}
        </div>

        {/* مخرج جانبي عند الصفّ الخامس */}
        <div className="bus-exit" aria-hidden="true">
          <span>مخرج</span><Icon name="arrowRight" size={13} />
        </div>

        {/* الصفّ الخلفي ٤٥-٤٩ */}
        <div className="bus-back">
          {[0, 1, 2, 3, 4].map((col) => {
            const seat = seats.find((s) => s.row === 11 && s.col === col)
            return <SeatBtn key={col} seat={seat} state={seatState(seat)} onPick={pick} />
          })}
        </div>
      </div>

      <Legend policy={policy} />
    </div>
  )
}

function SeatBtn({ seat, state, onPick }) {
  const allowance = state.a   // male/female/family/any
  const cls = `seat seat-${state.kind} ${allowance ? 'a-' + allowance : ''}`
  const holder = state.holder
  const label = holder
    ? (holder.full_name || '').trim().split(/\s+/)[0] || '·'
    : String(seat.no)
  return (
    <button
      type="button"
      className={cls}
      onClick={() => onPick(seat)}
      title={holder ? `${holder.full_name} · مقعد ${seat.no}` : `مقعد ${seat.no}`}
      disabled={state.kind === 'taken' || state.kind === 'locked'}
    >
      <span className="s-no">{seat.no}</span>
      {holder && <span className="s-nm">{label}</span>}
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
