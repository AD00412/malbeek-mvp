// إعداد بيئة الاختبار — يُحمَّل قبل كل ملف اختبار (vitest setupFiles).
// يضيف مُطابِقات jest-dom (toBeInTheDocument…) ويُنظّف DOM بعد كل اختبار.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
