-- ============================================================
--  ملبّيك — متجرُ الدفع المرن: التحويلُ البنكيّ   [P2]
--  يُضيف بياناتِ حسابٍ بنكيٍّ تُعرَض للمعتمر كوسيلةِ دفعٍ إضافيّةٍ
--  (تحويل + إثبات) إلى جانب رابط المتجر والدفع المستضاف القائمَين.
--  لا تدفّقَ ماليٌّ جديدٌ هنا — مجرّدُ بياناتٍ تُعرَض؛ الإثباتُ عبر آليّة
--  payment_proof_url القائمة، والبطاقة/مدى عبر create-payment القائمة.
--
--  guard_subscriber_columns يَسمح بهذه الأعمدة للمالك (يحمي plan/trial/owner فقط).
--  forward-only · idempotent · شغّله في Supabase SQL Editor.
-- ============================================================

alter table public.subscribers
  add column if not exists bank_account_name text,   -- اسمُ صاحب الحساب (كما في البنك)
  add column if not exists bank_name         text,   -- اسمُ البنك
  add column if not exists bank_iban         text;   -- الآيبان (يُطهَّر/يُتحقّق في الواجهة)
