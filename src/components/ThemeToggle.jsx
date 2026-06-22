import { useEffect, useState } from 'react'
import Icon from './Icon'

const KEY = 'malbeek-theme'

function readSavedTheme() {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch (_) {}
  // مبدئيا: تفضيل النظام، وإلا الغامق (هوية ملبّيك).
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)')?.matches) return 'light'
  return 'dark'
}

function applyTheme(theme) {
  const html = document.documentElement
  if (theme === 'light') html.setAttribute('data-theme', 'light')
  else html.removeAttribute('data-theme')
}

/**
 * زر يبدل بين الوضع الفاتح والغامق — يحفظ في localStorage.
 * يطبق التبديل بإضافة data-theme="light" على <html>،
 * فيكفي الـ CSS لتلوين متسق بلا تعديل على المكونات.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    return readSavedTheme()
  })

  // طبق الوضع المحفوظ عند أول تحميل
  useEffect(() => { applyTheme(theme) }, [theme])

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    try { localStorage.setItem(KEY, next) } catch (_) {}
  }

  const isLight = theme === 'light'
  return (
    <button type="button" className="icon-bubble theme-toggle"
      onClick={toggle} aria-label={isLight ? 'وضع غامق' : 'وضع فاتح'}
      title={isLight ? 'تبديل إلى الوضع الغامق' : 'تبديل إلى الوضع الفاتح'}>
      <Icon name={isLight ? 'moon' : 'sun'} size={17} />
    </button>
  )
}
