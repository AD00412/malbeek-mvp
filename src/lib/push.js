// إدارةُ Web Push لملبّيك: تسجيل service worker، الاشتراك (VAPID)، وإظهارُ
// إشعارٍ أماميٍّ نظيفٍ عبر الـSW (عنوان + جسم + رابطٌ عميق، بلا «from»).
import { supabase } from './supabaseClient'

// المفتاح العامّ VAPID — عامٌّ بالتصميم (يُشحن في bundle العميل بأمان). يُمكن
// تجاوزه بمتغيّر بيئة. وجودُه يُتيح حفظَ اشتراكِ Push في القاعدة عند تفعيل المستخدم.
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BJ6olqCTO4uHziNCi5GZL-i0mQKk7NwWt831P9KlykRz5cTuuRYY6Khd_-_iaE9r3nocBP1WMmhLPIpvCTDaaWc'

export function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window
}

// يسجّل الـSW مرّةً واحدةً (يعيد التسجيل القائم إن وُجد).
let _regPromise = null
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  if (!_regPromise) {
    _regPromise = navigator.serviceWorker.register('/sw.js')
      .catch(() => null)
  }
  return _regPromise
}

// إشعارٌ أماميٌّ عبر الـSW — تحكّمٌ كاملٌ بالعنوان/الجسم + رابطٌ عميقٌ عند الضغط.
export async function showLocalNotification({ title, body, url, tag }) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false
    const reg = await registerServiceWorker()
    if (reg && reg.showNotification) {
      await reg.showNotification(title || 'ملبّيك', {
        body: body || '', icon: '/icon.svg?v=2', badge: '/icon.svg?v=2',
        tag: tag || 'mlk', renotify: true, dir: 'rtl', lang: 'ar',
        data: { url: url || '/' },
      })
      return true
    }
  } catch (e) { /* الإشعار تجميليّ — لا يُعطّل شيئًا */ }
  return false
}

function urlB64ToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/**
 * يطلب الإذن ويشترك في الـPush ويحفظ الاشتراك في القاعدة.
 * يتطلّب VITE_VAPID_PUBLIC_KEY (نقطةُ التفعيل) — بدونه يُسجّل الـSW فقط.
 * @returns {{ok:boolean, reason?:string}}
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: 'denied' }
  const reg = await registerServiceWorker()
  if (!reg) return { ok: false, reason: 'no-sw' }
  if (!VAPID_PUBLIC) return { ok: true, reason: 'foreground-only' } // SW جاهز؛ الدفع الخلفيّ ينتظر VAPID
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(VAPID_PUBLIC),
    })
    const json = sub.toJSON()
    await supabase.from('push_subscriptions').upsert({
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    }, { onConflict: 'endpoint' })
    return { ok: true, reason: 'subscribed' }
  } catch (e) {
    return { ok: false, reason: 'subscribe-failed' }
  }
}
