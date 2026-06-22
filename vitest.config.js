import { defineConfig } from 'vitest/config'

// اختباراتُ وحداتٍ للوحدات الصافية (lib) — بيئةُ node سريعةٌ تكفي.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    globals: true,
  },
})
