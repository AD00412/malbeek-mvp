import { useEffect, useState } from 'react'

/**
 * useStickyState — كأنه useState، لكنه يحفظ في localStorage تلقائيا.
 * يبقي الفلاتر/البحث/التبويب النشط بين الجلسات بالكامل — حتى بعد إغلاق
 * المتصفح ثم فتحه (لا يضيع شيء).
 *
 * بادئة موحدة ‎malbeek:<host>:‎ — يفصل بين البيئات (production/staging/local)
 * حتى لا تتسرب ذاكرة بيئة إلى أخرى لو سلمت localStorage مع نطاق مشترك.
 * يفشل بصمت آمن في الـ SSR والوضع الخاص (Private Browsing).
 *
 * @param {string} key   مفتاح فريد للحالة (يفضل أن يضم معرفا إن وجد).
 * @param {*}      init  القيمة الابتدائية لو لا يوجد محفوظ.
 */
function buildKey(key) {
  const host = (typeof window !== 'undefined' && window.location?.hostname) || 'local'
  return `malbeek:${host}:${key}`
}

export default function useStickyState(key, init) {
  const k = buildKey(key)
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
