import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// إعداد ESLint (flat) — الهدف الأهمّ: `no-undef` يكسر البناء عند أيّ متغيّر/مرجع
// غير معرّف (مثل خطأ الإنتاج `load`). + قواعد react-hooks ومتغيّرات غير مستعملة.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'supabase/**', 'public/sw.js', 'coverage/**'] },

  // كود الواجهة (متصفّح + React + Vite)
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],   // catch {} نمطٌ مقصودٌ هنا                       // ★ يلتقط المراجع غير المعرّفة
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ملفّات الاختبار (Vitest — توابعها مستورَدة، + بيئة jsdom)
  {
    files: ['src/**/__tests__/**/*.{js,jsx}', 'src/**/*.test.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  // سكربتات Node
  {
    files: ['scripts/**/*.{js,mjs,cjs}', '*.config.js', 'vite.config.js', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],   // catch {} نمطٌ مقصودٌ هنا
      'no-unused-vars': 'warn',
    },
  },
]
