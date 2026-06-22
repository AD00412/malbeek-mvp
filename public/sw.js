/* eslint-disable no-undef */
// Service Worker لملبّيك — إشعارات Web Push (تعمل والتطبيق مقفول/طافٍ).
// عنوانٌ + جسمٌ نظيفان بلا أي «from»؛ والضغط يفتح الشاشة المعنيّة (deep-link).

self.addEventListener('install', (event) => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

// استقبالُ دفعةٍ من الخادم (Push API) — حتى والتطبيق مغلق.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  const title = (data.title && String(data.title)) || 'ملبّيك'
  const options = {
    body: data.body ? String(data.body) : '',
    icon: '/icon.svg?v=2',
    badge: '/icon.svg?v=2',
    tag: data.tag || 'mlk',
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// الضغطُ على الإشعار → افتح/ركّز الشاشة المعنيّة مباشرةً (deep-link).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      // نافذةٌ مفتوحةٌ للتطبيق → وجّهها وركّز عليها
      try { if ('focus' in c) { if (c.navigate) await c.navigate(target); return c.focus() } } catch (e) { /* */ }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target)
  })())
})
