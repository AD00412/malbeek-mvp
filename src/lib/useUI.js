import { useContext } from 'react'
import { UIContext } from '../app/uiContext'

/**
 * خطاف للوصول إلى تنبيهات ونوافذ تأكيد ملبّيك.
 * @returns {{ toast: (msg: string, opts?: {type?: 'success'|'error'|'info', duration?: number}) => void,
 *            confirm: (opts: {title?: string, message?: string, confirmText?: string, cancelText?: string, danger?: boolean}) => Promise<boolean> }}
 */
export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) {
    // احتياط آمن لو استخدم خارج المزود (لا ينبغي) — لا يكسر التطبيق.
    return {
      toast: (m) => { try { console.warn('[toast]', m) } catch { /* noop */ } },
      confirm: ({ message } = {}) => Promise.resolve(window.confirm(message || 'تأكيد؟')),
    }
  }
  return ctx
}
