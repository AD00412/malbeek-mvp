import { describe, it, expect } from 'vitest'
import { buildNotificationContent } from '../pushContent'

describe('buildNotificationContent', () => {
  it('يُفضّل عنوان/جسم القاعدة ويبني رابطًا عميقًا مع ref_trip', () => {
    const c = buildNotificationContent({ kind: 'new_booking', title: 'طلب جديد من فهد', body: 'رحلة مكة', ref_trip: 'abc' })
    expect(c.title).toBe('طلب جديد من فهد')
    expect(c.body).toBe('رحلة مكة')
    expect(c.url).toBe('/dashboard?go=ops&trip=abc')
  })

  it('يستعمل عنوان النوع الافتراضيّ عند غياب عنوان القاعدة', () => {
    const c = buildNotificationContent({ kind: 'trip_reminder' })
    expect(c.title).toBe('تذكيرٌ بموعد رحلتك')
    expect(c.url).toBe('/customer?go=tickets')
  })

  it('نوعٌ غير معروفٍ بلا عنوان → ملبّيك + الجذر', () => {
    const c = buildNotificationContent({ kind: 'xyz' })
    expect(c.title).toBe('ملبّيك')
    expect(c.url).toBe('/')
  })

  it('يُلحق trip بـ? عند غياب استعلامٍ سابق', () => {
    const c = buildNotificationContent({ kind: 'trip_reminder', ref_trip: 't9' })
    expect(c.url).toBe('/customer?go=tickets&trip=t9')
  })

  it('روابطُ الأدوار صحيحة', () => {
    expect(buildNotificationContent({ kind: 'new_feedback' }).url).toBe('/admin?go=feedback')
    expect(buildNotificationContent({ kind: 'upgrade_request' }).url).toBe('/admin?go=upgrades')
    expect(buildNotificationContent({ kind: 'feedback_reply' }).url).toBe('/customer?go=feedback')
  })

  it('لا تظهر كلمة «from» في العنوان/الجسم إطلاقًا', () => {
    for (const kind of ['new_booking', 'feedback_reply', 'trip_reminder', 'payment_pending', 'boarded']) {
      const c = buildNotificationContent({ kind })
      expect(/\bfrom\b/i.test(c.title)).toBe(false)
      expect(/\bfrom\b/i.test(c.body)).toBe(false)
    }
  })

  it('يعمل بأمانٍ مع صفٍّ فارغ', () => {
    const c = buildNotificationContent()
    expect(c.title).toBe('ملبّيك')
    expect(c.body).toBe('')
    expect(c.url).toBe('/')
  })
})
