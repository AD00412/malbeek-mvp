import { describe, it, expect } from 'vitest'
import { buildNotificationContent } from '../pushContent'

describe('buildNotificationContent', () => {
  it('العنوان دائمًا «ملبّيك» والجسم يجمع العنوان+التفصيل (نموذج Zid)', () => {
    const c = buildNotificationContent({ kind: 'new_booking', title: 'طلب جديد من فهد', body: 'رحلة مكة', ref_trip: 'abc' })
    expect(c.title).toBe('ملبّيك')
    expect(c.body).toBe('طلب جديد من فهد — رحلة مكة')
    expect(c.url).toBe('/dashboard?go=ops&trip=abc')
  })

  it('لا يكرّر العنوان حين يحويه الجسم أصلًا', () => {
    const c = buildNotificationContent({ kind: 'trip_changed', title: 'تذكيرٌ برحلتك', body: 'تذكيرٌ برحلتك «مشاعر» — الذهاب غدًا' })
    expect(c.title).toBe('ملبّيك')
    expect(c.body).toBe('تذكيرٌ برحلتك «مشاعر» — الذهاب غدًا')
  })

  it('يستعمل عنوان النوع الافتراضيّ جسمًا عند غياب عنوان/جسم القاعدة', () => {
    const c = buildNotificationContent({ kind: 'trip_reminder' })
    expect(c.title).toBe('ملبّيك')
    expect(c.body).toBe('تذكيرٌ بموعد رحلتك')
    expect(c.url).toBe('/customer?go=tickets')
  })

  it('نوعٌ غير معروفٍ بلا محتوى → جسمٌ افتراضيٌّ غير فارغٍ + الجذر', () => {
    const c = buildNotificationContent({ kind: 'xyz' })
    expect(c.title).toBe('ملبّيك')
    expect(c.body.length).toBeGreaterThan(0)
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

  it('العنوان «ملبّيك» دائمًا، والجسم غير فارغٍ أبدًا، وبلا كلمة «from»', () => {
    for (const kind of ['new_booking', 'feedback_reply', 'trip_reminder', 'payment_pending', 'boarded', 'xyz']) {
      const c = buildNotificationContent({ kind })
      expect(c.title).toBe('ملبّيك')
      expect(c.body.length).toBeGreaterThan(0)        // جسمٌ فارغٌ يُظهر «from» على iOS
      expect(/\bfrom\b/i.test(c.title)).toBe(false)
      expect(/\bfrom\b/i.test(c.body)).toBe(false)
    }
  })

  it('يعمل بأمانٍ مع صفٍّ فارغ — جسمٌ افتراضيٌّ غير فارغ', () => {
    const c = buildNotificationContent()
    expect(c.title).toBe('ملبّيك')
    expect(c.body.length).toBeGreaterThan(0)
    expect(c.url).toBe('/')
  })
})
