# إنشاء ملفات Android من GitHub Actions

- يبدأ بناء debug عند الدفع إلى `main` أو تشغيل workflow يدويًا؛ ويظهر كـ Artifact لمدة 30 يومًا.
- يبدأ إصدار النشر عند دفع tag بصيغة `v*`؛ وينشئ AAB موقّعًا للنشر على Google Play وAPK موقّعًا للاختبار/التوزيع المباشر.
- يستهدف البناء Android API 36، وهو الحد المطلوب للتطبيقات الجديدة والتحديثات المرسلة إلى Google Play اعتبارًا من 31 أغسطس 2026.
- يطلب التطبيق إذن الإشعارات عند اختيار «تمكين إشعارات التطبيق». تصل تنبيهات FCM عند إغلاق التطبيق بعد إعداد Firebase والخادم كما هو موضح في `PUSH_AND_BACKGROUND_LOCATION.md`.
- بعد نجاح إصدار tag، ينشر GitHub Release ملفي `azo-vX.aab` و`azo-vX.apk`. ارفع ملف AAB إلى Play Console، وليس APK.
- أضف أسرار المستودع التالية من Settings → Secrets and variables → Actions: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. لا ترفع ملف keystore إلى المستودع.
- لا تُستخدم أسرار التوقيع في تشغيلات Pull Request؛ يتحقق CI من إعداد release بمفتاح مؤقت خاص بالاختبار.
- يزيد `versionCode` تلقائيًا برقم تشغيل GitHub Actions، ويأخذ `versionName` اسم tag الإصدار.
- عنوان API الافتراضي هو خادم Render الحالي. لتغييره، أضف متغير Actions باسم `API_BASE_URL` بالقيمة الأساسية مثل `https://api.example.com` من دون `/api`.
- لإرسال FCM، أضف سر Actions باسم `FIREBASE_GOOGLE_SERVICES_JSON`، واضبط `FIREBASE_SERVICE_ACCOUNT_JSON` كمتغير سري في بيئة الخادم. لا تحفظ أيًا منهما في Git.
- تتبع موقع الخلفية اختياري ويبدأه الموظف أثناء بصمة دوام نشطة؛ يظهر إشعار Android دائم ويتوقف عند الانصراف أو نهاية الوردية أو إيقافه يدويًا.
- جلسة Capacitor تستخدم `https://localhost`; يرسل العميل credentials، ويقبل Android WebView cookies من نطاق API الآخر. الخادم يضبط `SameSite=None` لهذا origin فقط، ويبقي بقية العملاء على `SameSite=Lax`.
- إذا كنت قد ثبّت APK debug سابقًا، احذفه مرة واحدة قبل أول APK موقّع بالمفتاح الثابت؛ بعد ذلك يجب استخدام المفتاح نفسه لكل إصدار حتى تعمل التحديثات فوق التطبيق المثبت.
- احتفظ بنسخة احتياطية مشفّرة من keystore وكلمات مروره. فقدان المفتاح يمنع تحديث التطبيق المثبت بمفتاح جديد.
