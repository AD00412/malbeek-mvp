import { describe, it, expect } from 'vitest'
import { scorePassword } from '../passwordStrength'

describe('scorePassword', () => {
  it('الفارغة ضعيفةٌ وغير مقبولة', () => {
    const r = scorePassword('')
    expect(r.score).toBe(0)
    expect(r.ok).toBe(false)
  })

  it('الكلمات الشائعة مرفوضةٌ فورًا', () => {
    expect(scorePassword('password').ok).toBe(false)
    expect(scorePassword('password').score).toBe(0)
    expect(scorePassword('123456').ok).toBe(false)
    expect(scorePassword('mulabeek').ok).toBe(false)
  })

  it('القصيرة (أقل من ٨) غير مقبولة', () => {
    expect(scorePassword('Ab1xy').ok).toBe(false)
  })

  it('كلمةٌ بثلاث فئاتٍ وطولٍ كافٍ مقبولة', () => {
    const r = scorePassword('Xy7nmkqp') // ٨ أحرف: كبير+صغير+رقم، بلا تسلسل/تكرار
    expect(r.ok).toBe(true)
    expect(r.score).toBeGreaterThanOrEqual(2)
  })

  it('كلمةٌ قويّةٌ جدًّا (٤ فئات + طويلة)', () => {
    const r = scorePassword('Malbeek#Secure9')
    expect(r.score).toBe(4)
    expect(r.ok).toBe(true)
  })

  it('التكرار/التسلسل يخفض القوّة', () => {
    expect(scorePassword('aaaaaaaa').ok).toBe(false)
    expect(scorePassword('abcd1234').score).toBeLessThanOrEqual(2)
  })

  it('يُرجع تسميةً واقتراحاتٍ دائمًا', () => {
    const r = scorePassword('weak')
    expect(typeof r.label).toBe('string')
    expect(Array.isArray(r.suggestions)).toBe(true)
  })
})
