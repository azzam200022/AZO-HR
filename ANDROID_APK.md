# إنشاء APK من GitHub Actions

- يبدأ بناء debug عند الدفع إلى `main` أو تشغيل workflow يدويًا؛ ويظهر كـ Artifact لمدة 30 يومًا.
- عند دفع tag يبدأ بـ `v`، يستخدم workflow أسرار التوقيع ويبني APK release، ثم ينشئ GitHub Release دائمًا حتى الحذف اليدوي.
- أضف أسرار المستودع التالية من Settings → Secrets and variables → Actions: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. لا ترفع ملف keystore إلى المستودع.
- لا تُستخدم أسرار التوقيع في تشغيلات Pull Request؛ يتحقق CI من إعداد release بمفتاح مؤقت خاص بالاختبار.
- يزيد `versionCode` تلقائيًا برقم تشغيل GitHub Actions، ويأخذ `versionName` اسم tag الإصدار.
- عنوان API الافتراضي هو خادم Render الحالي. لتغييره، أضف متغير Actions باسم `API_BASE_URL` بالقيمة الأساسية مثل `https://api.example.com` من دون `/api`.
- جلسة Capacitor تستخدم `https://localhost`; يرسل العميل credentials، ويقبل Android WebView cookies من نطاق API الآخر. الخادم يضبط `SameSite=None` لهذا origin فقط، ويبقي بقية العملاء على `SameSite=Lax`.
- إذا كنت قد ثبّت APK debug سابقًا، احذفه مرة واحدة قبل أول APK موقّع بالمفتاح الثابت؛ بعد ذلك يجب استخدام المفتاح نفسه لكل إصدار حتى تعمل التحديثات فوق التطبيق المثبت.
- احتفظ بنسخة احتياطية مشفّرة من keystore وكلمات مروره. فقدان المفتاح يمنع تحديث التطبيق المثبت بمفتاح جديد.
