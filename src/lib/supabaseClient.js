import { createClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const anon   = import.meta.env.VITE_SUPABASE_ANON_KEY

// تشخيصٌ مبكرٌ لأخطاء التكوين الشائعة — يطبع في الكونسول قبل أي طلبٍ شبكي
if (!rawUrl || !anon) {
  // eslint-disable-next-line no-console
  console.error('⚠️ متغيرات Supabase ناقصة: تأكد من VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env')
}
if (rawUrl && /\/(rest|auth)\/v1\/?$/.test(rawUrl)) {
  // eslint-disable-next-line no-console
  console.error(
    '⚠️ خطأ في VITE_SUPABASE_URL: يجب أن يكون العنوان الأساسي فقط (بلا /rest/v1/ ولا /auth/v1/).\n' +
    '   الصحيح:  https://xxxxx.supabase.co\n' +
    '   الحالي:  ' + rawUrl + '\n' +
    '   صحّح .env ثم أعد تشغيل  npm run dev'
  )
}
if (rawUrl && rawUrl.includes('YOUR-PROJECT-REF')) {
  // eslint-disable-next-line no-console
  console.error('⚠️ VITE_SUPABASE_URL لا يزال على القيمة النموذجية. ضع رابط مشروعك من Supabase ▸ Project Settings ▸ API')
}

// نُزيل أي مسارٍ بعد .co احتياطًا (يحمي حتى لو نسي المستخدم تصحيح .env)
const url = (rawUrl || '').replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '')

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
