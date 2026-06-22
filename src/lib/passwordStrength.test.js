import { describe, it, expect } from 'vitest'
import { scorePassword } from './passwordStrength.js'

describe('scorePassword', () => {
  it('يرفض الفراغ', () => {
    const r = scorePassword('')
    expect(r.score).toBe(0)
    expect(r.ok).toBe(false)
    expect(r.label).toBe('فارغة')
  })

  it('يكشف الكلمات الشائعة (بلا حساسيةٍ لحالة الأحرف)', () => {
    const r = scorePassword('PassWord')
    expect(r.score).toBe(0)
    expect(r.ok).toBe(false)
    expect(r.label).toContain('شائعة')
  })

  it('يخفض النقاط للأنماط المتسلسلة', () => {
    expect(scorePassword('abcd1234').score).toBeLessThanOrEqual(2)
  })

  it('يخفض النقاط للتكرار المحض', () => {
    expect(scorePassword('aaaaaaaa').score).toBeLessThanOrEqual(1)
  })

  it('يقبل كلمةً قويّة طويلة متنوّعة', () => {
    const r = scorePassword('Tr0ub#Kx9wQ')
    expect(r.ok).toBe(true)
    expect(r.score).toBeGreaterThanOrEqual(2)
  })

  it('يمنح أعلى نقاطٍ لأربع فئاتٍ وطولٍ كبير', () => {
    const r = scorePassword('Xy7$mNp2!qLz')
    expect(r.score).toBe(4)
    expect(r.label).toBe('قويّة جدًّا')
  })

  it('ok=false عندما يقصُر الطول رغم التنوّع', () => {
    const r = scorePassword('Xy7$mN') // 6 محارف فقط
    expect(r.ok).toBe(false)
  })

  it('يحدّ الاقتراحات باثنين كحدٍّ أقصى', () => {
    const r = scorePassword('ab')
    expect(r.suggestions.length).toBeLessThanOrEqual(2)
  })
})
