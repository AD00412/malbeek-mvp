import { describe, it, expect } from 'vitest'
import { parseTextTable } from './textTable.js'

describe('parseTextTable', () => {
  it('يكتشف الفاصلة تلقائيًّا', () => {
    expect(parseTextTable('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('يكتشف Tab (لصق Excel)', () => {
    expect(parseTextTable('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('يتعامل مع الحقول المقتبسة التي تحوي الفاصل', () => {
    expect(parseTextTable('"محمد, علي",05\n')).toEqual([['محمد, علي', '05']])
  })

  it('يفكّ الاقتباس المزدوج داخل حقلٍ مقتبس', () => {
    expect(parseTextTable('"a""b",c')).toEqual([['a"b', 'c']])
  })

  it('يتجاهل \\r ويُسقط الأسطر الفارغة', () => {
    expect(parseTextTable('a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('يحترم الفاصل الصريح إن مُرِّر', () => {
    expect(parseTextTable('a;b', ';')).toEqual([['a', 'b']])
  })
})
