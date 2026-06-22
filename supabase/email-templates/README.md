# قوالب بريد ملبّيك + دليل SMTP المخصّص

استقلالٌ تامٌّ بهوية ملبّيك لإيميلات Supabase Auth: مُرسِلٌ من نطاقك، بلا «powered by Supabase»، بألوان زمرّدية وRTL.

## القوالب (٦ — جاهزة للّصق)
| النوع في Supabase | الملف | المتغيّرات المستخدمة |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `{{ .ConfirmationURL }}` |
| Reset Password | `reset-password.html` | `{{ .ConfirmationURL }}` |
| Magic Link | `magic-link.html` | `{{ .ConfirmationURL }}` |
| Invite user | `invite.html` | `{{ .ConfirmationURL }}` |
| Change Email Address | `change-email.html` | `{{ .Email }}` · `{{ .NewEmail }}` · `{{ .ConfirmationURL }}` |
| Reauthentication | `reauthentication-otp.html` | `{{ .Token }}` |

كلها: ٦٠٠px، table-based (آمنة لكل عملاء البريد)، خطوط نظام عربيّة (Tahoma)، تذييل «ملبّيك · mulabeek.com»، بلا «from» غريب.

## ١) لصق القوالب (Dashboard)
Supabase Dashboard → **Authentication → Emails → Templates** → لكلّ نوع: افتح، الصق محتوى ملفّه كاملًا في حقل الـHTML، واضبط **Subject** المقترح:
- Confirm signup: `أكّد بريدك · ملبّيك`
- Reset Password: `إعادة تعيين كلمة المرور · ملبّيك`
- Magic Link: `رابط الدخول إلى ملبّيك`
- Invite: `دعوة للانضمام إلى ملبّيك`
- Change Email: `تأكيد تغيير بريدك · ملبّيك`
- Reauthentication: `رمز التحقّق · ملبّيك`
احفظ كلّ قالب.

## ٢) ضبط Custom SMTP (الاستقلال + الهوية)
Supabase Dashboard → **Authentication → Emails → SMTP Settings** → فعّل **Enable Custom SMTP** واملأ:

| الحقل | القيمة |
|---|---|
| **Sender name** | `ملبّيك` |
| **Sender email** | `noreply@mulabeek.com` (أو `hello@mulabeek.com`) |
| **Host** | خادم SMTP لمزوّد بريد نطاقك |
| **Port** | `587` (STARTTLS) أو `465` (SSL) |
| **Username** | اسم مستخدم SMTP (غالبًا البريد نفسه) |
| **Password** | 🔒 **سرٌّ يُدخله أحمد بنفسه — لا يُكتب هنا ولا في git** |
| Minimum interval | اتركه افتراضيًّا |

### قيم شائعة حسب المزوّد (Host/Port)
- **Resend** (موصى به للتسليم): Host `smtp.resend.com` · Port `465`/`587` · Username `resend` · Password = مفتاح Resend API.
- **Amazon SES**: Host `email-smtp.<region>.amazonaws.com` · Port `587` · Username/Password = اعتمادات SES SMTP.
- **Brevo (Sendinblue)**: Host `smtp-relay.brevo.com` · Port `587`.
- **Google Workspace**: Host `smtp.gmail.com` · Port `587` (يتطلّب App Password).
- **بريد cPanel للنطاق** (نفس استضافتك): Host `mail.mulabeek.com` · Port `465`/`587` · Username `noreply@mulabeek.com`.

> اختر المزوّد الذي يدير بريد `mulabeek.com`. كلمة سرّ SMTP = كلمة سرّ ذلك الصندوق أو مفتاح API للمزوّد — **يُدخلها أحمد في الحقل مباشرةً.**

## ٣) DKIM/SPF/DMARC (مهمّ — استقلال + لا Spam)
في DNS نطاق `mulabeek.com` أضِف (من لوحة المزوّد):
- **SPF** (TXT): يسمح لخادم المزوّد بالإرسال نيابةً عنك. مثال Resend: `v=spf1 include:amazonses.com ~all` (يعطيك المزوّد القيمة الدقيقة).
- **DKIM** (CNAME/TXT): مفاتيح يوفّرها المزوّد — تُثبت أصالة الرسائل.
- **DMARC** (TXT على `_dmarc`): `v=DMARC1; p=quarantine; rua=mailto:hello@mulabeek.com`.
> بدون SPF/DKIM صحيحين قد تذهب الرسائل للـSpam. أغلب المزوّدين (Resend/SES) يعطونك السجلّات جاهزةً للنسخ.

## ٤) الاختبار بعد التفعيل
1. من التطبيق: اطلب **إعادة تعيين كلمة المرور** لبريدٍ مسجَّل (أو استعمل `supabase.auth.resetPasswordForEmail`).
2. **تحقّق من المُرسِل في صندوق الوارد:** يجب أن يظهر **«ملبّيك» <noreply@mulabeek.com>** لا `noreply@mail.app.supabase.io`، وبالقالب الزمرّديّ، بلا «powered by Supabase».
3. **سجلّ Supabase auth** (`get_logs` نوع auth) سيُظهر `mail.send` بـ`mail_from = noreply@mulabeek.com` (بدل `mail.app.supabase.io`) — هذا دليلُ نجاح الاستقلال. (أتولّى قراءة السجلّ لتأكيد المُرسِل بعد تفعيلك.)

## ما يحتاجه أحمد منه بالضبط (في Dashboard، لا أقدر عليه)
1. **لصق القوالب الستّة** + ضبط الـSubjects (الخطوة ١).
2. **Custom SMTP** (الخطوة ٢): Sender name=`ملبّيك` · Sender email=`noreply@mulabeek.com` · **Host + Port + Username** لمزوّد بريد نطاقك · **Password = سرّ تُدخله أنت.**
3. **سجلّات DNS** SPF/DKIM/DMARC (الخطوة ٣) من المزوّد.
4. أبلغني بعد التفعيل → أتحقّق من المُرسِل في السجلّ وأعيد تيست إعادة التعيين.
