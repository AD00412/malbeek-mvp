// تحليل نص جدولي (CSV/TSV) — للصق من Excel أو ملف CSV في تدفق الاستيراد.
// (المنصة لا تصدر CSV — التصدير PDF و DOCX. هذا الملف للاستيراد فقط.)

/**
 * يكتشف الفاصل تلقائيا (Tab من Excel أو فاصلة)، ويتعامل مع الحقول المقتبسة.
 */
export function parseTextTable(text, delimiter) {
  const delim = delimiter || (text.includes('\t') ? '\t' : ',')
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') { inQ = true }
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* تجاهل */ }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => (c ?? '').trim() !== ''))
}
