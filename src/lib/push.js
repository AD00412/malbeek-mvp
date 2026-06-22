// إدارةُ Web Push لملبّيك: تسجيل service worker، الاشتراك (VAPID)، وإظهارُ
// إشعارٍ أماميٍّ نظيفٍ عبر الـSW (عنوان + جسم + رابطٌ عميق، بلا «from»).
import { supabase } from './supabaseClient'

// المفتاح العامّ VAPID — عامٌّ بالتصميم (يُشحن في bundle العميل بأمان). يُمكن
// تجاوزه بمتغيّر بيئة. وجودُه يُتيح حفظَ اشتراكِ Push في القاعدة عند تفعيل المستخدم.
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BJ6olqCTO4uHziNCi5GZL-i0mQKk7NwWt831P9KlykRz5cTuuRYY6Khd_-_iaE9r3nocBP1WMmhLPIpvCTDaaWc'

export function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
    typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window
}

// iOS (يشمل iPadOS الذي يتنكّر كـMac)
export function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
// هل التطبيق مثبّتٌ كـPWA (شرطٌ لازمٌ للـPush على iOS)؟
export function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator.standalone === true
}

// يسجّل الـSW مرّةً واحدةً (يعيد التسجيل القائم إن وُجد).
let _regPromise = null
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  if (!_regPromise) _regPromise = navigator.serviceWorker.register('/sw.js').catch(() => null)
  return _regPromise
}

// إشعارٌ أماميٌّ عبر الـSW — تحكّمٌ كاملٌ بالعنوان/الجسم + رابطٌ عميقٌ عند الضغط.
export async function showLocalNotification({ title, body, url, tag }) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false
    await registerServiceWorker()
    const reg = await navigator.serviceWorker.ready
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
 * يطلب الإذن ويشترك في الـPush ويحفظ الاشتراك (بمعلومات الجهاز) في القاعدة.
 * يعالج كلَّ مسارات الفشل صراحةً (لا فشلٌ صامت).
 * @returns {{ok:boolean, reason:string, detail?:string}}
 *  reason: subscribed | already | unsupported | ios-needs-install | denied |
 *          dismissed | sw-failed | subscribe-failed | save-failed
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  // ★ iOS: الـPush يعمل فقط إذا كان التطبيق مثبّتًا على الشاشة الرئيسية (PWA).
  if (isIOS() && !isStandalone()) return { ok: false, reason: 'ios-needs-install' }

  let perm = Notification.permission
  if (perm === 'default') perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' }

  // ★ ننتظر تفعيلَ الـSW (register يَحُلّ قبل أن يصبح active؛ subscribe يحتاجه active).
  await registerServiceWorker()
  let reg
  try { reg = await navigator.serviceWorker.ready } catch { return { ok: false, reason: 'sw-failed' } }
  if (!reg || !reg.pushManager) return { ok: false, reason: 'sw-failed' }

  let sub
  try {
    sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(VAPID_PUBLIC),
      })
    }
  } catch (e) {
    return { ok: false, reason: 'subscribe-failed', detail: String(e?.message || e) }
  }

  try {
    const json = sub.toJSON()
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: session?.user?.id,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      user_agent: (navigator.userAgent || '').slice(0, 200),
      last_used_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })
    if (error) return { ok: false, reason: 'save-failed', detail: error.message }
    return { ok: true, reason: 'subscribed' }
  } catch (e) {
    return { ok: false, reason: 'save-failed', detail: String(e?.message || e) }
  }
}

// قائمةُ أجهزة المستخدم المشتركة (لواجهة «الأجهزة المفعّلة»).
export async function listMyPushDevices() {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, user_agent, created_at, last_used_at')
    .order('created_at', { ascending: false })
  if (error) return []
  return data || []
}

// إزالةُ جهازٍ من السجلّ (+ إلغاء الاشتراك المحليّ إن كان هذا الجهاز نفسه).
export async function removePushDevice(id, endpoint) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('id', id)
  try {
    const reg = await navigator.serviceWorker?.ready
    const sub = await reg?.pushManager?.getSubscription()
    if (sub && endpoint && sub.endpoint === endpoint) await sub.unsubscribe()
  } catch { /* تجاهل */ }
  return !error
}

// تسميةٌ مختصرةٌ للجهاز من الـuser agent.
export function deviceLabel(ua = '') {
  const s = String(ua)
  let os = /iPhone|iPad|iPod/.test(s) ? 'iPhone/iPad' : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows' : /Mac/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'جهاز'
  let br = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox'
    : /Safari\//.test(s) ? 'Safari' : ''
  return br ? `${os} · ${br}` : os
}
