import { useEffect, useState } from 'react'

/**
 * useStickyState — كأنّه useState، لكنّه يحفظ في localStorage تلقائيًّا.
 * يبقي الفلاتر/البحث/التبويب النشط بين الجلسات بالكامل — حتى بعد إغلاق
 * المتصفّح ثمّ فتحه (لا يضيع شيء).
 *
 * بادئةٌ موحَّدةٌ ‎malbeek:‎ لتفادي الاصطدام مع مفاتيحَ أخرى محتمَلة.
 * يفشل بصمتٍ آمنٍ في الـ SSR والوضع الخاصّ (Private Browsing).
 *
 * @param {string} key   مفتاحٌ فريدٌ للحالة (يُفضّل أن يضمّ معرّفًا إن وُجد).
 * @param {*}      init  القيمة الابتدائيّة لو لا يوجد محفوظ.
 */
const PREFIX = 'malbeek:'

export default function useStickyState(key, init) {
  const k = PREFIX + key
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(k)
      if (raw == null) return init
      return JSON.parse(raw)
    } catch (_) { return init }
  })
  useEffect(() => {
    try { localStorage.setItem(k, JSON.stringify(v)) } catch (_) {}
  }, [k, v])
  return [v, setV]
}
