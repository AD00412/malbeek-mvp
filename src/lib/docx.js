// تصدير Word (.docx) للكشوفات — قابل للتعديل لاحقا في Microsoft Word/Google Docs/LibreOffice.
// المكتبة تحمل كسولا عند أول تصدير.

/**
 * يبني مستند Word من جدول + ترويسة، يدعم RTL والعربية.
 * @param {object}   opts
 * @param {string}   opts.title       عنوان في صدر المستند
 * @param {string}   opts.subtitle    سطر فرعي (اختياري)
 * @param {string[]} opts.headers     رؤوس الأعمدة
 * @param {any[][]}  opts.rows        صفوف القيم (مصفوفة من المصفوفات)
 * @param {string[]} [opts.meta]      أسطر بيانات قبل الجدول (اختياري)
 * @param {string}   [opts.org]       اسم الحملة — يبيض المستند لها (بدل ملبّيك)
 * @param {string}   opts.filename    اسم الملف
 */
export async function tableToDocx({ title, subtitle, headers, rows, meta = [], org, filename }) {
  let docx
  try { docx = await import('docx') }
  catch (e) {
    throw new Error('مكتبة Word غير مثبتة. أوقف الـ dev server وشغل: npm install ثم npm run dev')
  }
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  } = docx.default || docx

  const FONT = 'Arial'  // متوفر في كل نظام، يدعم العربية بالكامل
  const NAVY = '063D2C'
  const GOLD = 'C49A45'

  const headerRun = (text) => new TextRun({ text: String(text ?? ''), bold: true, color: 'FFFFFF', font: FONT, rightToLeft: true })
  const cellRun   = (text) => new TextRun({ text: String(text ?? ''), font: FONT, rightToLeft: true })

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' },
      children: [new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, children: [headerRun(h)] })],
    })),
  })

  const bodyRows = rows.map((r, i) => new TableRow({
    children: r.map((v) => new TableCell({
      shading: i % 2 === 1 ? { type: ShadingType.CLEAR, fill: 'F3F7F5', color: 'auto' } : undefined,
      children: [new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, children: [cellRun(v)] })],
    })),
  }))

  const tbl = new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: true,
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: GOLD },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD },
      left:   { style: BorderStyle.SINGLE, size: 4, color: GOLD },
      right:  { style: BorderStyle.SINGLE, size: 4, color: GOLD },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'CDD8D2' },
      insideVertical:   { style: BorderStyle.SINGLE, size: 2, color: 'CDD8D2' },
    },
  })

  // تذييل مخصص للحملة عند تمرير org، وإلا تذييل المنصة (تقارير الإدارة).
  const footerText = org
    ? `كشف رسمي صادر عن ${org} — بتاريخ ${new Date().toLocaleDateString('ar-SA')}`
    : `صدر هذا الكشف من منصة ملبّيك بتاريخ ${new Date().toLocaleDateString('ar-SA')}`

  const doc = new Document({
    creator: org || 'ملبّيك',
    title: title || 'كشف',
    styles: { default: { document: { run: { font: FONT, rightToLeft: true } } } },
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: title || '', bold: true, color: NAVY, font: FONT, rightToLeft: true, size: 36 })],
        }),
        ...(subtitle ? [new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: subtitle, color: '8A6A1F', font: FONT, rightToLeft: true })],
        })] : []),
        ...meta.map((line) => new Paragraph({
          bidirectional: true, alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: line, font: FONT, rightToLeft: true })],
        })),
        new Paragraph({ children: [new TextRun({ text: '' })] }),  // فراغ
        tbl,
        new Paragraph({ children: [new TextRun({ text: '' })] }),
        new Paragraph({
          bidirectional: true, alignment: AlignmentType.LEFT,
          children: [new TextRun({
            text: footerText,
            italics: true, color: '7A8A82', font: FONT, rightToLeft: true, size: 18,
          })],
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.docx') ? filename : filename + '.docx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
