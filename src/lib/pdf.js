// تصدير PDF عبر html2canvas + jsPDF — يلتقط المظهر العربيّ كاملًا (الخطوط، الاتجاه، الختم).
// المكتبتان تُحمَّلان كسولًا عند أوّل تصديرٍ ليبقى البندل الأوّليّ خفيفًا.

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

/**
 * يحوّل عنصر DOM إلى PDF (A4 رأسيّ) مع تقسيمٍ تلقائيٍّ للصفحات الطويلة.
 */
export async function htmlToPdf(element, filename) {
  if (!element) throw new Error('no_element')
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'), import('html2canvas'),
  ])
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  await captureToPdf(element, pdf, html2canvas)
  pdf.save(filename.endsWith('.pdf') ? filename : filename + '.pdf')
}

/**
 * يحوّل عدّة عناصرٍ إلى PDF واحدٍ — كلّ عنصرٍ يبدأ في صفحةٍ جديدة (مثاليٌّ
 * لكشفٍ متعدّد الباصات: ورقةٌ لكلّ سائق).
 */
export async function htmlsToPdf(elements, filename) {
  const list = (elements || []).filter(Boolean)
  if (!list.length) throw new Error('no_element')
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'), import('html2canvas'),
  ])
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  for (let i = 0; i < list.length; i++) {
    if (i > 0) pdf.addPage()
    await captureToPdf(list[i], pdf, html2canvas)
  }
  pdf.save(filename.endsWith('.pdf') ? filename : filename + '.pdf')
}
