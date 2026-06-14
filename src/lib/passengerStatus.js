// حالات المعتمر — مفصولةٌ عن مكوّن النموذج كي لا يكسر Fast Refresh
// (تصدير غير مكوِّنٍ من ملفِّ مكوِّن يُعطِّل التحديث السريع).
export const PASSENGER_STATUS = [
  { v: 'registered', t: 'مسجّل' },
  { v: 'paid',       t: 'مدفوع' },
  { v: 'boarded',    t: 'صعد الحافلة' },
  { v: 'checked_in', t: 'استلم الغرفة' },
]
