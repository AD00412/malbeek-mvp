import { supabase } from './supabaseClient'

// مفتاحُ تخزين «النيّة» عبر إعادة توجيه OAuth — يُقرأ في /auth/callback بعد العودة.
const INTENT_KEY = 'mlk:oauth-intent'

/**
 * يبدأ تسجيل الدخول عبر Google.
 * يحفظ النيّة محليًّا (الدور/السياق) لأنّ OAuth لا يمرّر بياناتنا، ثمّ
 * يُكملها /auth/callback عبر RPCs آمنة بعد العودة.
 *
 * @param {object} intent  أحد:
 *   { kind:'login' }
 *   { kind:'subscriber', orgName }
 *   { kind:'customer', subscriberId, slug, fullName?, phone?, nationalId?, pickupLocation? }
 *   { kind:'staff-invite', token }
 */
export async function signInWithGoogle(intent = { kind: 'login' }) {
  try {
    localStorage.setItem(INTENT_KEY, JSON.stringify({ ...intent, ts: Date.now() }))
  } catch { /* تخزينٌ غير متاح — نكمل، الـcallback سيوجّه بالدور فقط */ }

  const redirectTo = `${window.location.origin}/auth/callback`
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, queryParams: { prompt: 'select_account' } },
  })
  if (error) {
    try { localStorage.removeItem(INTENT_KEY) } catch { /* noop */ }
    throw error
  }
}

/** يقرأ النيّة المخزّنة (أو null). لا يمسحها — المسح بعد الإكمال. */
export function readOAuthIntent() {
  try {
    const raw = localStorage.getItem(INTENT_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    // صلاحيّة ١٥ دقيقة — نيّةٌ قديمةٌ تُتجاهَل (تفادي سلوكٍ مفاجئ)
    if (v?.ts && Date.now() - v.ts > 15 * 60 * 1000) { clearOAuthIntent(); return null }
    return v
  } catch { return null }
}

export function clearOAuthIntent() {
  try { localStorage.removeItem(INTENT_KEY) } catch { /* noop */ }
}
