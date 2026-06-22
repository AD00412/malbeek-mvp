import { describe, it, expect } from 'vitest'
import { PASSENGER_STATUS } from './passengerStatus.js'

describe('PASSENGER_STATUS', () => {
  it('يحتوي على الحالات الأربع بالترتيب', () => {
    expect(PASSENGER_STATUS.map((s) => s.v)).toEqual([
      'registered',
      'paid',
      'boarded',
      'checked_in',
    ])
  })

  it('لكلّ حالةٍ قيمةٌ ونصٌّ عربيّ', () => {
    for (const s of PASSENGER_STATUS) {
      expect(typeof s.v).toBe('string')
      expect(s.t.length).toBeGreaterThan(0)
    }
  })
})
