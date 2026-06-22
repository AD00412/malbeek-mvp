import { describe, it, expect } from 'vitest'
import { slugify, isValidSlug, isReservedSlug, suggestSlug } from '../slug'

describe('slugify', () => {
  it('يبقي اللاتينيّة ويصغّرها ويربطها بشرطة', () => {
    expect(slugify('Al Madinah Travel')).toBe('al-madinah-travel')
  })
  it('فارغٌ لمدخلٍ خالٍ', () => {
    expect(slugify('')).toBe('')
    expect(slugify(null)).toBe('')
  })
  it('النتيجةُ أحرفٌ صغيرةٌ/أرقامٌ/شرطةٌ فقط وبطولٍ ≤ ٤٠', () => {
    const s = slugify('شركة مكة للعمرة 2026')
    expect(s).toMatch(/^[a-z0-9-]*$/)
    expect(s.length).toBeLessThanOrEqual(40)
  })
  it('لا يبدأ/ينتهي بشرطة', () => {
    const s = slugify('-- مكة --')
    expect(s.startsWith('-')).toBe(false)
    expect(s.endsWith('-')).toBe(false)
  })
})

describe('isValidSlug', () => {
  it('يقبل الصالح', () => {
    expect(isValidSlug('hamla-makkah')).toBe(true)
    expect(isValidSlug('abcd')).toBe(true)
  })
  it('يرفض القصير/الكبير/المبدوء بشرطة', () => {
    expect(isValidSlug('ab')).toBe(false)
    expect(isValidSlug('Abc')).toBe(false)
    expect(isValidSlug('-abc')).toBe(false)
    expect(isValidSlug(123)).toBe(false)
  })
  it('يرفض المحجوز', () => {
    expect(isValidSlug('admin')).toBe(false)
    expect(isValidSlug('login')).toBe(false)
  })
})

describe('isReservedSlug', () => {
  it('غير حسّاسٍ لحالة الأحرف', () => {
    expect(isReservedSlug('Admin')).toBe(true)
    expect(isReservedSlug('DASHBOARD')).toBe(true)
    expect(isReservedSlug('hamla')).toBe(false)
  })
})

describe('suggestSlug', () => {
  it('يعيد بديلًا آمنًا للفارغ/المحجوز/القصير', () => {
    expect(suggestSlug('')).toBe('hamla')
    expect(suggestSlug('admin')).toBe('hamla')
    expect(suggestSlug('ab')).toBe('hamla')
  })
  it('يعيد slug صالحًا لاسمٍ لاتينيّ', () => {
    expect(suggestSlug('Makkah Travel')).toBe('makkah-travel')
  })
})
