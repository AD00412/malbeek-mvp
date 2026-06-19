/* ============================================================
 *  debugLog — كشّافُ الأعطال الصامتة
 * ============================================================
 *  ما يَلتقط (بلا تَدخّلٍ في حركةِ المرور):
 *    - Long Tasks (> 50ms على thread الرئيسيّ) — يَكشف التجمّد
 *    - استعلامات Supabase: ابتدأ، انتهى، مدّة، حالة
 *    - window.onerror و unhandledrejection
 *    - أحداثُ التنقّل والإيقاظ
 *
 *  ring buffer ٢٠٠ حدثٍ مَحفوظٍ في sessionStorage فيَنجو من reload.
 *  ثلاثُ نقراتٍ على شعار «ملبّيك» في الرأس → تُفتح لوحةٌ تَعرضها.
 *  زرُّ تصديرٍ يَنسخ النصَّ للحافظة لمشاركته.
 *
 *  لا يَعترض fetch ولا يَلفُّ Promises — يَستمع فقط.
 * ============================================================ */

const STORAGE_KEY = 'malbeek.debug.log'
const MAX_EVENTS = 200
const LONG_TASK_THRESHOLD = 80   // ms — أعلى قليلًا من ٥٠ ليُلتقط فقط الواضح

let buffer = []
let listeners = new Set()
let installed = false

function load() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) buffer = JSON.parse(raw)
  } catch { /* ignore */ }
}

function persist() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-MAX_EVENTS))) }
  catch { /* sessionStorage ممتلئٌ — تجاهل */ }
}

function emit() {
  for (const l of listeners) {
    try { l(buffer) } catch { /* ignore */ }
  }
}

export function logEvent(category, msg, data) {
  const ev = {
    t: Date.now(),
    iso: new Date().toISOString().slice(11, 23),  // HH:MM:SS.mmm
    category,
    msg: String(msg ?? '').slice(0, 300),
  }
  if (data !== undefined) {
    try { ev.data = JSON.parse(JSON.stringify(data, (k, v) => v instanceof Error ? String(v) : v)) }
    catch { ev.data = String(data).slice(0, 300) }
  }
  buffer.push(ev)
  if (buffer.length > MAX_EVENTS) buffer = buffer.slice(-MAX_EVENTS)
  persist()
  emit()
}

export function getEvents() { return buffer.slice() }
export function clearEvents() { buffer = []; persist(); emit() }
export function subscribe(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** يُلخّص آخر ٥ ثوانٍ — مفيدٌ بعد التجمّد لمشاركته بنقرةٍ. */
export function exportText() {
  const lines = buffer.map((ev) => {
    const base = `[${ev.iso}] ${ev.category.padEnd(8)} ${ev.msg}`
    return ev.data !== undefined ? `${base}  ${JSON.stringify(ev.data)}` : base
  })
  return [
    'ملبّيك — سجلّ التشخيص',
    `الوقت: ${new Date().toISOString()}`,
    `الصفحة: ${typeof location !== 'undefined' ? location.href : '?'}`,
    `المتصفّح: ${typeof navigator !== 'undefined' ? navigator.userAgent : '?'}`,
    '─'.repeat(60),
    ...lines,
  ].join('\n')
}

/** تثبيتُ مُستمعِي النظام — يُستدعى مرّةً من main.jsx. */
export function installDebug() {
  if (typeof window === 'undefined' || installed) return
  installed = true
  load()

  // ١) أخطاءٌ غيرُ مُلتقَطة (synchronous)
  window.addEventListener('error', (e) => {
    logEvent('ERROR', e?.message || 'unknown error', {
      file: e?.filename, line: e?.lineno, col: e?.colno,
    })
  })

  // ٢) Promise rejections غيرُ مُلتقَطة (Supabase queries مهجورة، إلخ)
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason
    logEvent('REJECT', r?.message || String(r) || 'unknown rejection', r?.stack ? { stack: String(r.stack).slice(0, 400) } : undefined)
  })

  // ٣) Long Tasks — يَكشف ما يَحجز thread الرئيسيّ ويَظهر كتجمّد
  try {
    if ('PerformanceObserver' in window) {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= LONG_TASK_THRESHOLD) {
            logEvent('FREEZE', `Long task ${Math.round(entry.duration)}ms`, {
              startTime: Math.round(entry.startTime),
              attribution: entry.attribution?.[0]?.name || '?',
            })
          }
        }
      })
      obs.observe({ entryTypes: ['longtask'] })
    }
  } catch { /* غير مدعومٍ في Safari — تَجاوز */ }

  // ٤) أحداثُ الـvisibility (للارتباط مع التجمّد بعد العودة)
  document.addEventListener('visibilitychange', () => {
    logEvent('VIS', document.visibilityState)
  })

  // ٥) أحداثُ navigation داخل التطبيق (التبويبات)
  window.addEventListener('hashchange', () => logEvent('NAV', `hash: ${location.hash}`))
  window.addEventListener('popstate', () => logEvent('NAV', `pop: ${location.pathname}`))

  logEvent('INIT', 'debug installed')

  // اجعله متاحًا في console للمستخدمين المتقدّمين
  window.__malbeekDebug = { getEvents, clearEvents, exportText, logEvent }
}

/** يَلفّ وعدًا (مثلًا supabase.from(...)) لتسجيل البدء/النهاية/المدّة. */
export async function trace(label, asyncFn) {
  const start = performance.now()
  logEvent('START', label)
  try {
    const result = await asyncFn()
    const ms = Math.round(performance.now() - start)
    const err = result?.error
    if (err) {
      // مهلةُ supabaseClient انتهت → AbortError. عَلِّمه TIMEOUT في السجلّ.
      const isTimeout = err.message?.includes?.('aborted') || err.message?.includes?.('timeout') || err.name === 'AbortError'
      logEvent(isTimeout ? 'TIMEOUT' : 'SB-ERR', `${label} (${ms}ms)`, { code: err.code, message: err.message })
    } else {
      logEvent('END', `${label} (${ms}ms)`)
    }
    return result
  } catch (e) {
    const ms = Math.round(performance.now() - start)
    const isTimeout = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message))
    logEvent(isTimeout ? 'TIMEOUT' : 'THROW', `${label} (${ms}ms)`, { message: e?.message })
    throw e
  }
}
