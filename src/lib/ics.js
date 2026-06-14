// توليد حدث تقويم (.ics) لموعد رحلة العمرة — ليضيفه المعتمر إلى تقويم جواله.
// لا يعتمد على أيّ مكتبةٍ خارجيّة؛ نصٌّ قياسيٌّ متوافقٌ مع iOS/Android/Outlook.

function pad(n) { return String(n).padStart(2, '0') }

/** ISO/Date → صيغة UTC المطلوبة في ICS: YYYYMMDDTHHMMSSZ */
function toICSDate(v) {
  const d = v ? new Date(v) : new Date()
  if (isNaN(d.getTime())) return ''
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  )
}

/** يهرّب الفواصل/الأسطر حسب RFC 5545 */
function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/**
 * يبني نصّ ملفّ .ics لحدثٍ واحد.
 * @param {{uid?:string, start:string|Date, durationMin?:number, title:string, location?:string, description?:string}} ev
 */
export function buildICS(ev) {
  const start = toICSDate(ev.start)
  if (!start) return ''
  const endDate = ev.start ? new Date(new Date(ev.start).getTime() + (ev.durationMin || 120) * 60000) : null
  const end = endDate ? toICSDate(endDate) : ''
  const uid = (ev.uid || ('malbeek-' + Date.now())) + '@malbeek'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Malbeek//Trip//AR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + toICSDate(new Date()),
    'DTSTART:' + start,
    end ? 'DTEND:' + end : '',
    'SUMMARY:' + esc(ev.title),
    ev.location ? 'LOCATION:' + esc(ev.location) : '',
    ev.description ? 'DESCRIPTION:' + esc(ev.description) : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT3H',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + esc(ev.title),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  return lines.join('\r\n')
}

/** ينزّل حدث التقويم كملفّ .ics (يفتحه الجوال في تطبيق التقويم). */
export function downloadICS(ev, filename = 'رحلة') {
  const ics = buildICS(ev)
  if (!ics) return false
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.ics') ? filename : filename + '.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return true
}
