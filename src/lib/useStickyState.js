import { useEffect, useState } from 'react'

/**
 * useStickyState — كأنّه useState، لكنّه يحفظ في sessionStorage تلقائيًّا.
 * يبقي الفلاتر/البحث/التبويب النشط بين الزيارات داخل الجلسة الواحدة،
 * بلا تشويش الـ URL ولا تعقيدٍ في الـ Router.
 *
 * يستخدم sessionStorage (لا localStorage) — تنظيفٌ تلقائيٌّ عند إغلاق التبويب.
 * يفشل بصمتٍ آمنٍ في الـ SSR وفي الوضع الخاصّ (Private Browsing).
 *
 * @param {string} key   مفتاحٌ فريدٌ للحالة (يفضّل أن يضمّ معرّفًا إن وُجد).
 * @param {*}      init  القيمة الابتدائيّة لو لا يوجد محفوظ.
 */
export default function useStickyState(key, init) {
  const [v, setV] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw == null) return init
      return JSON.parse(raw)
    } catch (_) { return init }
  })
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(v)) } catch (_) {}
  }, [key, v])
  return [v, setV]
}
