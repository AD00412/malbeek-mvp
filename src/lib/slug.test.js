import { describe, it, expect } from 'vitest'
import { slugify, isReservedSlug, isValidSlug, suggestSlug } from './slug.js'

describe('slugify', () => {
  it('يستخدم القاموس للكلمات الشائعة', () => {
    expect(slugify('حملة محمد')).toBe('hamla-mohammed')
  })
  it('يُسقط أداة التعريف «ال» عبر القاموس', () => {
    expect(slugify('الحملة')).toBe('hamla')
  })
  it('يبقي اللاتينية والأرقام ويصغّرها', () => {
    expect(slugify('Hamla 2025')).toBe('hamla-2025')
  })
  it('يطوي الفواصل والشُّرَط', () => {
    expect(slugify('حملة - محمد')).toBe('hamla-mohammed')
  })
  it('يُرجع فراغًا للمدخل الفارغ', () => {
    expect(slugify('')).toBe('')
    expect(slugify(null)).toBe('')
  })
  it('يحدّ الطول بأربعين محرفًا', () => {
    expect(slugify('a'.repeat(60)).length).toBeLessThanOrEqual(40)
  })
})

describe('isReservedSlug', () => {
  it('يكشف المسارات المحجوزة', () => {
    expect(isReservedSlug('admin')).toBe(true)
    expect(isReservedSlug('LOGIN')).toBe(true)
    expect(isReservedSlug('malbeek')).toBe(true)
  })
  it('يسمح بغير المحجوز', () => {
    expect(isReservedSlug('hamla-mohammed')).toBe(false)
  })
})

describe('isValidSlug', () => {
  it('يقبل slug صحيحًا', () => {
    expect(isValidSlug('hamla-mohammed')).toBe(true)
  })
  it('يرفض القصير جدًّا', () => {
    expect(isValidSlug('abc')).toBe(false)
  })
  it('يرفض البدء/الانتهاء بشرطة', () => {
    expect(isValidSlug('-hamla')).toBe(false)
    expect(isValidSlug('hamla-')).toBe(false)
  })
  it('يرفض المحرف غير المسموح', () => {
    expect(isValidSlug('Hamla')).toBe(false)
    expect(isValidSlug('ham la')).toBe(false)
  })
  it('يرفض المحجوز والقيم غير النصّية', () => {
    expect(isValidSlug('admin')).toBe(false)
    expect(isValidSlug(123)).toBe(false)
    expect(isValidSlug(null)).toBe(false)
  })
})

describe('suggestSlug', () => {
  it('يقترح من اسم الحملة', () => {
    expect(suggestSlug('حملة محمد')).toBe('hamla-mohammed')
  })
  it('يستعمل البديل الآمن عند نتيجةٍ قصيرة/محجوزة/فارغة', () => {
    expect(suggestSlug('')).toBe('hamla')
    expect(suggestSlug('admin')).toBe('hamla')
  })
})
