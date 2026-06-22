import { describe, it, expect } from 'vitest'
import {
  toLatinDigits, normalizePhone, cleanName, isValidNationalId, isValidSaPhone,
  isValidEmail, toWaPhone, safeExt, fmtDateTime, waMeLink, pwStrength, PW_LABEL,
} from '../format'

describe('toLatinDigits', () => {
  it('يحوّل الأرقام العربية', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
    expect(toLatinDigits('جوال ٠٥٠')).toBe('جوال 050')
    expect(toLatinDigits(null)).toBe('')
  })
})

describe('normalizePhone', () => {
  it('يطبّع كل الصيغ إلى 05XXXXXXXX', () => {
    expect(normalizePhone('+966501234567')).toBe('0501234567')
    expect(normalizePhone('966501234567')).toBe('0501234567')
    expect(normalizePhone('501234567')).toBe('0501234567')
    expect(normalizePhone('0501234567')).toBe('0501234567')
    expect(normalizePhone('٠٥٠١٢٣٤٥٦٧')).toBe('0501234567')
  })
})

describe('المُحقِّقات', () => {
  it('isValidSaPhone', () => {
    expect(isValidSaPhone('0501234567')).toBe(true)
    expect(isValidSaPhone('+966501234567')).toBe(true)
    expect(isValidSaPhone('0401234567')).toBe(false)
    expect(isValidSaPhone('12345')).toBe(false)
  })
  it('isValidNationalId (يبدأ ١ أو ٢، ١٠ أرقام)', () => {
    expect(isValidNationalId('1099887766')).toBe(true)
    expect(isValidNationalId('2099887766')).toBe(true)
    expect(isValidNationalId('3099887766')).toBe(false)
    expect(isValidNationalId('109988776')).toBe(false)
  })
  it('isValidEmail', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('x@y')).toBe(false)
    expect(isValidEmail('no-at.com')).toBe(false)
  })
})

describe('cleanName', () => {
  it('يقصّ ويوحّد المسافات', () => {
    expect(cleanName('  محمد   علي ')).toBe('محمد علي')
  })
})

describe('toWaPhone / waMeLink', () => {
  it('toWaPhone يرجع 9665.. أو فارغ', () => {
    expect(toWaPhone('0501234567')).toBe('966501234567')
    expect(toWaPhone('123')).toBe('')
  })
  it('waMeLink يبني رابطًا صحيحًا مع النص', () => {
    const link = waMeLink('0501234567', 'مرحبا')
    expect(link).toContain('https://wa.me/966501234567')
    expect(link).toContain('text=')
  })
})

describe('safeExt', () => {
  it('يستخرج الامتداد بأمان', () => {
    expect(safeExt({ name: 'photo.JPEG' })).toBe('jpeg')
    expect(safeExt({ name: 'doc.pdf' })).toBe('pdf')
    expect(safeExt({ name: 'noext' })).toBe('png')
    expect(safeExt(null)).toBe('png')
    expect(safeExt({ name: 'a.tar.gz' })).toBe('gz')
  })
})

describe('fmtDateTime', () => {
  it('فارغ لقيمةٍ خالية', () => {
    expect(fmtDateTime('')).toBe('')
    expect(fmtDateTime(null)).toBe('')
  })
  it('ينسّق التاريخ بالصيغة المتوقّعة', () => {
    expect(fmtDateTime('2026-06-22T10:05:00')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('pwStrength', () => {
  it('يتدرّج ٠..٣', () => {
    expect(pwStrength('')).toBe(0)
    expect(pwStrength('abcdef')).toBe(1)
    expect(pwStrength('Abcdefgh1!')).toBe(3)
    expect(pwStrength('Abcdefgh1!').valueOf()).toBeLessThanOrEqual(3)
  })
  it('PW_LABEL متوافق', () => {
    expect(PW_LABEL[3]).toBe('قوية')
    expect(PW_LABEL.length).toBe(4)
  })
})
