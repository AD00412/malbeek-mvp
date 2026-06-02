// تصدير CSV — اقتباسٌ آمنٌ + BOM ليعرض Excel العربية بصحّة.

/**
 * يبني نصّ CSV من صفوفٍ وأعمدة.
 * @param {Array<object>} rows
 * @param {Array<{label:string, value:(row)=>any}>} columns
 */
export function toCSV(rows, columns) {
  const esc = (v) => {
    let s = v == null ? '' : String(v)
    // تحييد حقن الصيغ (CSV injection): خليّةٌ تبدأ بـ = + - @ قد تُنفَّذ في Excel/Sheets
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const header = columns.map((c) => esc(c.label)).join(',')
  const body = (rows ?? [])
    .map((r) => columns.map((c) => esc(c.value(r))).join(','))
    .join('\r\n')
  return header + '\r\n' + body
}

/** ينزّل نصَّ CSV كملفٍّ (مع BOM لـ UTF-8) */
export function downloadCSV(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** تنسيق تاريخ/وقت مختصر للتصدير (ميلادي) */
export function csvDate(v) {
  if (!v) return ''
  try {
    const d = new Date(v)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch { return '' }
}
