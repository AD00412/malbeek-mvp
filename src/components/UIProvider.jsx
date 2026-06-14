import { useState, useCallback, useRef } from 'react'
import { UIContext } from '../app/uiContext'
import BottomSheet from './BottomSheet'
import Icon from './Icon'

const TOAST_ICON = { success: 'check', error: 'bell', info: 'sparkle' }

/**
 * مزوِّدُ واجهة ملبّيك: تنبيهاتٌ (toast) على الهويّة الزمرّديّة-الذهبيّة
 * + نافذة تأكيدٍ موحَّدةٌ (confirm) بديلةٌ عن alert/window.confirm الخام.
 * يُلفّ حول التطبيق في main.jsx.
 */
export default function UIProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [confirmState, setConfirmState] = useState(null)   // { ...opts, resolve } | null
  const idRef = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((message, opts = {}) => {
    if (!message) return
    const id = ++idRef.current
    const type = opts.type || 'success'
    const duration = opts.duration ?? (type === 'error' ? 5000 : 3000)
    setToasts((list) => [...list, { id, message, type }])
    if (duration > 0) setTimeout(() => dismiss(id), duration)
  }, [dismiss])

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      setConfirmState({
        title: opts.title || 'تأكيد',
        message: opts.message || 'هل أنت متأكّد؟',
        confirmText: opts.confirmText || 'تأكيد',
        cancelText: opts.cancelText || 'إلغاء',
        danger: !!opts.danger,
        resolve,
      })
    })
  }, [])

  const settleConfirm = useCallback((value) => {
    setConfirmState((s) => { s?.resolve?.(value); return null })
  }, [])

  return (
    <UIContext.Provider value={{ toast, confirm }}>
      {children}

      <div className="toast-viewport" role="region" aria-live="polite" aria-label="تنبيهات">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role="status">
            <span className="toast-ic"><Icon name={TOAST_ICON[t.type] || 'sparkle'} size={16} /></span>
            <span className="toast-msg">{t.message}</span>
            <button type="button" className="toast-x" onClick={() => dismiss(t.id)} aria-label="إغلاق">×</button>
          </div>
        ))}
      </div>

      <BottomSheet
        open={!!confirmState}
        title={confirmState?.title}
        onClose={() => settleConfirm(false)}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => settleConfirm(false)}>
              {confirmState?.cancelText}
            </button>
            <button
              type="button"
              className={`btn ${confirmState?.danger ? 'btn-danger' : 'btn-gold'}`}
              onClick={() => settleConfirm(true)}
            >
              {confirmState?.confirmText}
            </button>
          </>
        }
      >
        <p className="confirm-msg">{confirmState?.message}</p>
      </BottomSheet>
    </UIContext.Provider>
  )
}
