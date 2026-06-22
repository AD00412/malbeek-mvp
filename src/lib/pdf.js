// تصدير PDF عبر html2canvas + jsPDF — يلتقط المظهر العربي كاملا (الخطوط، الاتجاه، الختم).
// المكتبتان تحملان كسولا عند أول تصدير ليبقى البندل الأولي خفيفا.

/** يرجع class jsPDF بصرف النظر عن شكل التصدير (default / named / namespace). */
async function loadJsPDF() {
  let mod
  try { mod = await import('jspdf') }
  catch (e) { throw new Error('install_missing:jspdf') }
  return mod.jsPDF || mod.default || (mod.default && mod.default.jsPDF) || mod
}

/** يرجع دالة html2canvas بصرف النظر عن شكل التصدير. */
async function loadHtml2Canvas() {
  let mod
  try { mod = await import('html2canvas') }
  catch (e) { throw new Error('install_missing:html2canvas') }
  return mod.default || mod.html2canvas || mod
}

// حد مساحة الـ canvas في Safari/iOS ≈ ١٦.٧ مليون بكسل — نقيد الدقة (scale)
// لئلا يخرج كشف طويل بصورة بيضاء صامتة. نحسب أعلى scale آمن من حجم العنصر.
const CANVAS_MAX_PX = 16000000
function safeScale(element, desired = 2) {
  const w = element?.offsetWidth || element?.scrollWidth || 800
  const h = element?.scrollHeight || element?.offsetHeight || 1000
  if (!w || !h) return desired
  const maxScale = Math.sqrt(CANVAS_MAX_PX / (w * h))
  return Math.max(1, Math.min(desired, maxScale))
}

/** يلتقط عنصرا واحدا ويضيفه إلى pdf (مع تقسيم متعدد الصفحات للجداول الطويلة). */
async function captureToPdf(element, pdf, html2canvas) {
  const canvas = await html2canvas(element, {
    scale: safeScale(element, 2), useCORS: true, backgroundColor: '#ffffff', logging: false,
  })
  if (!canvas.width || !canvas.height) throw new Error('canvas_blank')
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const imgH = (canvas.height * pageW) / canvas.width
  const imgData = canvas.toDataURL('image/png')
  let heightLeft = imgH, position = 0
  pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH)
  heightLeft -= pageH
  while (heightLeft > 0) {
    position -= pageH
    pdf.addPage()
    pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH)
    heightLeft -= pageH
  }
}

function saveAs(pdf, filename) {
  pdf.save(filename.endsWith('.pdf') ? filename : filename + '.pdf')
}

/** يحول عنصر DOM إلى PDF (A4 رأسي) مع تقسيم تلقائي للصفحات الطويلة. */
export async function htmlToPdf(element, filename) {
  if (!element) throw new Error('no_element')
  try {
    const [jsPDF, html2canvas] = await Promise.all([loadJsPDF(), loadHtml2Canvas()])
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
    await captureToPdf(element, pdf, html2canvas)
    saveAs(pdf, filename)
  } catch (e) {
    throw friendly(e)
  }
}

/**
 * يحول عدة عناصر إلى PDF واحد — كل عنصر يبدأ في صفحة جديدة (مثالي
 * لكشف متعدد الباصات: ورقة لكل سائق).
 */
export async function htmlsToPdf(elements, filename) {
  const list = (elements || []).filter(Boolean)
  if (!list.length) throw new Error('no_element')
  try {
    const [jsPDF, html2canvas] = await Promise.all([loadJsPDF(), loadHtml2Canvas()])
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
    for (let i = 0; i < list.length; i++) {
      if (i > 0) pdf.addPage()
      await captureToPdf(list[i], pdf, html2canvas)
    }
    saveAs(pdf, filename)
  } catch (e) {
    throw friendly(e)
  }
}

/** يحول أخطاء التحميل/الـ Bundler إلى رسالة عربية واضحة. */
function friendly(e) {
  const msg = String(e?.message || e || '')
  if (msg.startsWith('install_missing:') || /failed to resolve|cannot find module|jspdf|html2canvas/i.test(msg)) {
    return new Error('مكتبات التصدير غير مثبتة. أوقف الـ dev server وشغل: npm install ثم npm run dev')
  }
  return e instanceof Error ? e : new Error(msg)
}

/** يلتقط عنصر DOM إلى Blob صورة PNG (للحفظ أو المشاركة عبر قائمة الجوال). */
export async function elementToPngBlob(element, { backgroundColor = null, scale = 2 } = {}) {
  if (!element) throw new Error('no_element')
  try {
    const html2canvas = await loadHtml2Canvas()
    const canvas = await html2canvas(element, { scale: safeScale(element, scale), useCORS: true, backgroundColor, logging: false })
    if (!canvas.width || !canvas.height) throw new Error('canvas_blank')
    const blob = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
    if (!blob) throw new Error('canvas_blob_failed')
    return blob
  } catch (e) {
    throw friendly(e)
  }
}
