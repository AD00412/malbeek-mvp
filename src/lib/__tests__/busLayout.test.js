import { describe, it, expect } from 'vitest'
import { seatCount, buildSeats, allowedFor, isAllowed, DEFAULT_ROWS, DEFAULT_BACK, policyLabel } from '../busLayout'
import { totalCapacity, busName } from '../buses'

describe('seatCount', () => {
  it('يحسب المقاعد (صفوف×٤ + خلفيّ)', () => {
    expect(seatCount(11, 5)).toBe(49)
    expect(seatCount()).toBe(seatCount(DEFAULT_ROWS, DEFAULT_BACK))
    expect(seatCount(10, 4)).toBe(44)
    expect(seatCount(1, 0)).toBe(4)
  })
})

describe('buildSeats', () => {
  it('عددُ المقاعد يطابق seatCount', () => {
    expect(buildSeats(2, 0)).toHaveLength(8)
    expect(buildSeats(11, 5)).toHaveLength(49)
  })
  it('الترقيمُ متسلسلٌ من ١', () => {
    const seats = buildSeats(2, 1)
    const nums = seats.map((s) => s.no).sort((a, b) => a - b)
    expect(nums[0]).toBe(1)
    expect(nums[nums.length - 1]).toBe(seats.length)
  })
  it('يحدّ الصفوف ضمن نطاقٍ آمن', () => {
    expect(buildSeats(999, 999).length).toBeLessThanOrEqual(20 * 4 + 6)
  })
})

describe('allowedFor / isAllowed', () => {
  const frontSeat = { kind: 'window', side: 'right', row: 0, rows: 11 }
  const leftSeat = { kind: 'aisle', side: 'left', row: 0, rows: 11 }
  const backSeat = { kind: 'back', rows: 11 }

  it('ذكور/إناث فقط', () => {
    expect(allowedFor(frontSeat, 'all_male')).toBe('male')
    expect(allowedFor(frontSeat, 'all_female')).toBe('female')
    expect(isAllowed(frontSeat, 'all_male', 'male', false)).toBe(true)
    expect(isAllowed(frontSeat, 'all_male', 'female', false)).toBe(false)
  })

  it('تقسيمٌ يمين/يسار', () => {
    expect(allowedFor(frontSeat, 'mixed_split_lr')).toBe('male')
    expect(allowedFor(leftSeat, 'mixed_split_lr')).toBe('female')
  })

  it('منطقةُ العوائل خلفًا — للعائلات فقط', () => {
    expect(allowedFor(backSeat, 'families_back')).toBe('family')
    expect(isAllowed(backSeat, 'families_back', 'female', true)).toBe(true)   // عائلة
    expect(isAllowed(backSeat, 'families_back', 'male', false)).toBe(false)   // فردٌ غير عائلة
  })

  it('policyLabel يعيد تسميةً عربيّة', () => {
    expect(typeof policyLabel('all_male')).toBe('string')
    expect(policyLabel('unknown')).toBe(policyLabel('all_male')) // الافتراضيّ
  })
})

describe('totalCapacity / busName (buses)', () => {
  it('totalCapacity يجمع باصاتٍ مع الافتراضات', () => {
    expect(totalCapacity([])).toBe(0)
    expect(totalCapacity([{ bus_rows: 11, bus_back_row: 5 }, { bus_rows: 10, bus_back_row: 4 }])).toBe(93)
    expect(totalCapacity([{}])).toBe(seatCount(DEFAULT_ROWS, DEFAULT_BACK))
  })
  it('busName يعطي اسمًا أو بديلًا', () => {
    expect(busName({ label: 'باص ١' })).toBe('باص ١')
    expect(busName({ bus_number: 3 })).toBe('باص 3')
    expect(busName(null)).toBe('')
  })
})
