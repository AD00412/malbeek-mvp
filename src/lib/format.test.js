import { describe, it, expect } from 'vitest'
import {
  toLatinDigits,
  normalizePhone,
  cleanName,
  isValidNationalId,
  isValidSaPhone,
  isValidEmail,
  toWaPhone,
  safeExt,
  fmtDateTime,
  waMeLink,
  pwStrength,
} from './format.js'

describe('toLatinDigits', () => {
  it('يحوّل الأرقام العربية-الهندية إلى لاتينية', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
  })
  it('يبقي اللاتينية كما هي ويتعامل مع القيم الفارغة', () => {
    expect(toLatinDigits('abc123')).toBe('abc123')
    expect(toLatinDigits()).toBe('')
    expect(toLatinDigits(null)).toBe('')
  })
})

describe('normalizePhone', () => {
  it('يطبّع صيغة +966', () => {
    expect(normalizePhone('+966512345678')).toBe('0512345678')
  })
  it('يطبّع صيغة 966 بلا +', () => {
    expect(normalizePhone('966512345678')).toBe('0512345678')
  })
  it('يضيف صفرًا لرقمٍ يبدأ بـ5', () => {
    expect(normalizePhone('512345678')).toBe('0512345678')
  })
  it('يبقي صيغة 05 كما هي ويزيل الرموز', () => {
    expect(normalizePhone('05 1234-5678')).toBe('0512345678')
  })
  it('يقبل الأرقام العربية', () => {
    expect(normalizePhone('٠٥١٢٣٤٥٦٧٨')).toBe('0512345678')
  })
})

describe('cleanName', () => {
  it('يقصّ الأطراف ويوحّد المسافات', () => {
    expect(cleanName('  محمد   بن   علي  ')).toBe('محمد بن علي')
  })
})

describe('isValidNationalId', () => {
  it('يقبل هويةً صحيحة (تبدأ بـ1 أو 2 وطولها 10)', () => {
    expect(isValidNationalId('1234567890')).toBe(true)
    expect(isValidNationalId('2234567890')).toBe(true)
  })
  it('يرفض ما لا يطابق', () => {
    expect(isValidNationalId('3234567890')).toBe(false)
    expect(isValidNationalId('123456789')).toBe(false)
    expect(isValidNationalId('')).toBe(false)
  })
})

describe('isValidSaPhone', () => {
  it('يقبل بعد التطبيع', () => {
    expect(isValidSaPhone('+966512345678')).toBe(true)
    expect(isValidSaPhone('0512345678')).toBe(true)
  })
  it('يرفض غير الصالح', () => {
    expect(isValidSaPhone('0412345678')).toBe(false)
    expect(isValidSaPhone('123')).toBe(false)
  })
})

describe('isValidEmail', () => {
  it('يقبل بريدًا صحيحًا', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
  })
  it('يرفض غير الصحيح', () => {
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('ab.co')).toBe(false)
    expect(isValidEmail('a b@c.co')).toBe(false)
  })
})

describe('toWaPhone', () => {
  it('يُنتج صيغة 9665XXXXXXXX', () => {
    expect(toWaPhone('0512345678')).toBe('966512345678')
  })
  it('يُرجع فراغًا لرقمٍ غير صالح', () => {
    expect(toWaPhone('123')).toBe('')
  })
})

describe('safeExt', () => {
  it('يستخرج الامتداد بحروفٍ صغيرة', () => {
    expect(safeExt({ name: 'photo.PNG' })).toBe('png')
  })
  it('يحدّه بأربعة محارف لاتينية/رقمية', () => {
    expect(safeExt({ name: 'a.jpeg2000' })).toBe('jpeg')
  })
  it('يستخدم البديل عند غياب الامتداد', () => {
    expect(safeExt({ name: 'noext' })).toBe('png')
    expect(safeExt(null, 'pdf')).toBe('pdf')
  })
})

describe('fmtDateTime', () => {
  it('ينسّق التاريخ بحشو الأصفار', () => {
    const d = new Date(2024, 0, 5, 9, 7) // 2024-01-05 09:07 محلي
    expect(fmtDateTime(d)).toBe('2024-01-05 09:07')
  })
  it('يُرجع فراغًا للقيمة الفارغة', () => {
    expect(fmtDateTime(null)).toBe('')
    expect(fmtDateTime('')).toBe('')
  })
})

describe('waMeLink', () => {
  it('يبني الرابط مع نصٍّ مُرمَّز', () => {
    expect(waMeLink('0512345678', 'مرحبا')).toBe(
      'https://wa.me/966512345678?text=' + encodeURIComponent('مرحبا'),
    )
  })
  it('بلا نصٍّ يبني الرابط فقط', () => {
    expect(waMeLink('0512345678')).toBe('https://wa.me/966512345678')
  })
})

describe('pwStrength', () => {
  it('يعطي 0 لكلمةٍ قصيرة', () => {
    expect(pwStrength('abc')).toBe(0)
  })
  it('يحدّه بـ3 للقويّة', () => {
    expect(pwStrength('Abcdef1!ghij')).toBe(3)
  })
})
