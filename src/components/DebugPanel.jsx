import { useEffect, useState, useCallback } from 'react'
import { getEvents, clearEvents, exportText, subscribe } from '../lib/debugLog'

/**
 * لوحةُ تشخيصٍ للأعطال الصامتة. تُفتح من ٣ نقراتٍ على شعار «ملبّيك».
 * تَعرض آخرَ ٢٠٠ حدث: long tasks، استعلامات Supabase، أخطاء، تنقّل.
 */

const CATEGORY_COLOR = {
  ERROR:   '#ef4444',
  REJECT:  '#ef4444',
  FREEZE:  '#f59e0b',
  TIMEOUT: '#dc2626',
  'SB-ERR': '#fb923c',
  NETERR:  '#f97316',
  THROW:   '#ef4444',
  START:   '#94a3b8',
  END:     '#10b981',
  SB:      '#22d3ee',  // فيروزيٌّ — مكالمات Supabase التلقائيّة
  AUTH:    '#a78bfa',
  RT:      '#fb7185',  // وردي — Realtime
  WARMUP:  '#fbbf24',
  NET:     '#60a5fa',
  VIS:     '#60a5fa',
  NAV:     '#a78bfa',
  INIT:    '#10b981',
}

export default function DebugPanel({ open, onClose }) {
  const [events, setEvents] = useState(() => getEvents())
  const [filter, setFilter] = useState('all')   // all | errors | freezes | sb

  useEffect(() => {
    if (!open) return
    setEvents(getEvents())
    return subscribe(setEvents)
  }, [open])

  const onCopy = useCallback(async () => {
    const text = exportText()
    try { await navigator.clipboard.writeText(text) }
    catch {
      // fallback — حدّد textarea مؤقّتًا
      const ta = document.createElement('textarea')
      ta.value = text; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
  }, [])

  if (!open) return null

  const filtered = events.filter((e) => {
    if (filter === 'all') return true
    if (filter === 'errors')  return ['ERROR', 'REJECT', 'THROW', 'SB-ERR', 'TIMEOUT', 'NETERR'].includes(e.category)
    if (filter === 'freezes') return e.category === 'FREEZE'
    if (filter === 'sb')      return ['START', 'END', 'SB-ERR', 'SB', 'AUTH', 'RT', 'TIMEOUT', 'NETERR'].includes(e.category)
    return true
  })
  const errorCount  = events.filter((e) => ['ERROR','REJECT','THROW','SB-ERR','TIMEOUT','NETERR'].includes(e.category)).length
  const freezeCount = events.filter((e) => e.category === 'FREEZE').length

  return (
    <div className="debug-overlay" role="dialog" aria-modal="true">
      <div className="debug-card">
        <div className="debug-head">
          <strong>سجلّ التشخيص ({events.length})</strong>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: '#ef4444' }}>{errorCount} خطأ</span>
          <span style={{ fontSize: 12, color: '#f59e0b' }}>{freezeCount} تجمّد</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="إغلاق">×</button>
        </div>

        <div className="debug-tabs">
          {[
            { k: 'all',     t: 'الكل' },
            { k: 'errors',  t: 'أخطاء' },
            { k: 'freezes', t: 'تجمّد' },
            { k: 'sb',      t: 'Supabase' },
          ].map((t) => (
            <button key={t.k} type="button"
              className={`chip ${filter === t.k ? 'active' : ''}`}
              onClick={() => setFilter(t.k)}>
              {t.t}
            </button>
          ))}
        </div>

        <div className="debug-list">
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--cr-300)' }}>
              لا أحداث مطابقة
            </div>
          ) : filtered.slice().reverse().map((e, i) => (
            <div key={i} className="debug-row">
              <span className="debug-time">{e.iso}</span>
              <span className="debug-cat" style={{ color: CATEGORY_COLOR[e.category] || '#888' }}>
                {e.category}
              </span>
              <span className="debug-msg">{e.msg}</span>
              {e.data && <pre className="debug-data">{JSON.stringify(e.data, null, 0).slice(0, 200)}</pre>}
            </div>
          ))}
        </div>

        <div className="debug-actions">
          <button className="btn btn-em btn-sm" onClick={onCopy}>📋 نسخ كنصّ</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { clearEvents(); setEvents([]) }}>
            مسح
          </button>
        </div>
      </div>
    </div>
  )
}
