import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
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
