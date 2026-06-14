import { createContext } from 'react'

/**
 * سياقُ واجهةٍ موحَّد للتنبيهات (toast) ونوافذ التأكيد (confirm).
 * القيمة: { toast(msg, opts), confirm(opts) -> Promise<boolean> }.
 * مفصولٌ في ملفٍّ مستقلٍّ كي لا يكسر Fast Refresh.
 */
export const UIContext = createContext(null)
