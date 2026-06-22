import { describe, it, expect } from 'vitest'
import { tripLifecycle } from './tripLifecycle.js'

const HOUR = 3600000
const DAY = 86400000

describe('tripLifecycle', () => {
  it('رحلةٌ مفتوحةٌ مستقبليّة: قابلةٌ للحجز ومتاحة', () => {
    const r = tripLifecycle({ status: 'open', depart_at: new Date(Date.now() + 10 * DAY) })
    expect(r.bookable).toBe(true)
    expect(r.phase).toBe('upcoming')
    expect(r.label).toBe('متاحة')
    expect(r.reason).toBe('')
  })

  it('رحلةٌ انطلقت: غير قابلةٍ للحجز', () => {
    const r = tripLifecycle({ status: 'open', depart_at: new Date(Date.now() - HOUR) })
    expect(r.departed).toBe(true)
    expect(r.bookable).toBe(false)
    expect(r.phase).toBe('departed')
    expect(r.reason).toContain('انطلقت')
  })

  it('رحلةٌ مغلقة: غير قابلةٍ للحجز', () => {
    const r = tripLifecycle({ status: 'closed', depart_at: new Date(Date.now() + 5 * DAY) })
    expect(r.bookable).toBe(false)
    expect(r.phase).toBe('closed')
    expect(r.cls).toBe('warn')
  })

  it('مسودّة: لم تُفتح بعد', () => {
    const r = tripLifecycle({ status: 'draft', depart_at: new Date(Date.now() + 5 * DAY) })
    expect(r.bookable).toBe(false)
    expect(r.phase).toBe('draft')
  })

  it('done أو منقضية: منتهية', () => {
    const r = tripLifecycle({ status: 'done', depart_at: new Date(Date.now() - 30 * DAY) })
    expect(r.phase).toBe('returned')
    expect(r.label).toBe('منتهية')
  })

  it('soon=true عندما يقترب الانطلاق خلال أقل من 48 ساعة', () => {
    const r = tripLifecycle({ status: 'open', depart_at: new Date(Date.now() + 5 * HOUR) })
    expect(r.soon).toBe(true)
    expect(r.bookable).toBe(true)
  })

  it('الافتراضي open عند غياب الحالة', () => {
    const r = tripLifecycle({ depart_at: new Date(Date.now() + 5 * DAY) })
    expect(r.phase).toBe('upcoming')
    expect(r.bookable).toBe(true)
  })
})
