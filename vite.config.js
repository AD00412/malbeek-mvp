/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom يلزم لاختبارات المكوّنات (DOM) — والدوالُّ الصِّرفة تعمل فيه أيضًا.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    css: false,
  },
  server: {
    port: 5173,
    host: true,           // ⇦ يَستمع على 0.0.0.0 فيَصل من iPhone/Android على نفس Wi-Fi
    strictPort: false,
    hmr: { overlay: true }
  },
  build: {
    rollupOptions: {
      output: {
        // فصل مكتبات الطرف الثالث في حزمٍ تُخزَّن طويلًا (cache) فتُحمَّل مرّةً
        // وتبقى عبر التحديثات — تحميلٌ أسرع للزيارات المتكرّرة.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react'
        },
      },
    },
  },
})
