// تصدير PDF عبر html2canvas + jsPDF — يلتقط المظهر العربيّ كاملًا (الخطوط، الاتجاه، الختم).
// المكتبتان تُحمَّلان كسولًا عند أوّل تصديرٍ ليبقى البندل الأوّليّ خفيفًا.

/** يُرجع class jsPDF بصرف النظر عن شكل التصدير (default / named / namespace). */
async function loadJsPDF() {
  let mod
  try { mod = await import('jspdf') }
  catch (e) { throw new Error('install_missing:jspdf') }
  return mod.jsPDF || mod.default || (mod.default && mod.default.jsPDF) || mod
}

/** يُرجع دالّة html2canvas بصرف النظر عن شكل التصدير. */
async function loadHtml2Canvas() {
  let mod
  try { mod = await import('html2canvas') }
  catch (e) { throw new Error('install_missing:html2canvas') }
  return mod.default || mod.html2canvas || mod
}

/** يلتقط عنصرًا واحدًا ويضيفه إلى pdf (مع تقسيمٍ متعدّد الصفحات للجداول الطويلة). */
async function captureToPdf(element, pdf, html2canvas) {
  const canvas = await html2canvas(element, {
    scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false,
  })
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

/** يحوّل عنصر DOM إلى PDF (A4 رأسيّ) مع تقسيمٍ تلقائيٍّ للصفحات الطويلة. */
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
 * يحوّل عدّة عناصرٍ إلى PDF واحدٍ — كلّ عنصرٍ يبدأ في صفحةٍ جديدة (مثاليٌّ
 * لكشفٍ متعدّد الباصات: ورقةٌ لكلّ سائق).
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

/** يحوّل أخطاء التحميل/الـ Bundler إلى رسالةٍ عربيّةٍ واضحة. */
function friendly(e) {
  const msg = String(e?.message || e || '')
  if (msg.startsWith('install_missing:') || /failed to resolve|cannot find module|jspdf|html2canvas/i.test(msg)) {
    return new Error('مكتبات التصدير غير مثبّتة. أوقف الـ dev server وشغّل: npm install ثم npm run dev')
  }
  return e instanceof Error ? e : new Error(msg)
}
