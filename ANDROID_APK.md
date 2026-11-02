# إنشاء APK من GitHub Actions

- البناء يبدأ عند الدفع إلى `main`، أو من تبويب Actions عبر التشغيل اليدوي، أو عند دفع tag يبدأ بـ `v`.
- التشغيل اليدوي والدفع إلى `main` يحفظان APK كـ Artifact لمدة 30 يومًا.
- لإنشاء نسخة دائمة: ادفع tag جديدًا مثل `v1.0.0`؛ سيُنشأ GitHub Release ويُرفق به `azo-v1.0.0.apk`. يبقى ملف Release حتى حذفه يدويًا.
- عنوان API الافتراضي هو خادم Render الحالي. لتغييره، أضف متغير Actions باسم `API_BASE_URL` في إعدادات المستودع، بالقيمة الأساسية مثل `https://api.example.com` من دون `/api`.
- جلسة Capacitor تستخدم `https://localhost`; لذلك يرسل العميل credentials، ويستخدم Android WebView قبول cookies من النطاق الآخر. الخادم يضبط `SameSite=None` لهذا الـ origin فقط، ويبقي بقية الطلبات على `SameSite=Lax`.
- الـ APK الحالي debug-signed للتثبيت المباشر. مفتاح debug يتغير بين runners؛ لتحديث النسخة فوق تثبيت سابق دون إزالته، يلزم إعداد مفتاح إصدار ثابت في GitHub Secrets قبل نشر النسخ للمستخدمين.
- لا تضع ملف keystore أو كلمات مروره في المستودع أو المحادثة.
