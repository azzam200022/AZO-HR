# مواردي (Mawaridi HR) — مواصفة التطبيق

تطبيق إدارة موارد بشرية عربي بالكامل (RTL) بمصادقة حقيقية ودورين منفصلين:
**مدير النظام** (حساب واحد معتمد) و**الموظف** (دخول برمز يصدره المدير).

## المصادقة والصلاحيات
- **جلسة بكوكي httpOnly** (`hr_session`، صلاحية 14 يوماً) تُنشأ على الخادم وتُخزَّن في مجموعة
  `sessions`. الواجهة لا تحمل أي توكن ولا تقرر دوراً — `GET /api/auth/me` هو مصدر الحقيقة.
- **المدير**: بريد + كلمة مرور مُجزّأة bcrypt في مجموعة `users`. البريد المخوّل يأتي من
  `MANAGER_EMAIL` في `.env` — أي بريد آخر يُرفض 401 حتى لو طابقت كلمة المرور.
- **الموظف**: رمز دخول (`access_code`، مثل `MW-4821`) يُولَّد تلقائياً عند إنشاء الموظف،
  أو اختيارياً بريد + كلمة مرور بعد `POST /employees/{id}/set-password`.
- **الهوية تُشتق من الجلسة في كل طلب** مقابل مصدر الحقيقة: حذف الموظف، أو تعطيل دخوله
  (`can_login=false`)، أو إيقاف حالته، أو إعادة توليد رمزه → تسقط الجلسة فوراً (401).
- **بوابات الخادم** (`lib/auth.py`): `require_manager` على كل راوترات الإدارة، و`require_employee`
  على `/me/*`. المجهول → 401، والموظف على لوحة المدير → 403. حراس الواجهة تجميلية فقط.
- **منع IDOR بنيوياً**: مسارات `/me/*` تقرأ `employee_id` من الجلسة ولا تقبله من العميل إطلاقاً
  (`SelfPunch` و`SelfLeaveCreate` بلا حقل `employee_id`)، فلا يمكن لموظف بلوغ سجل زميله.

## الأدوار والصفحات
- **مدير النظام**: لوحة التحكم `/`، الموظفون `/employees` (إضافة/تعديل/حذف + عمود «رمز الدخول»
  للنسخ وإعادة التوليد وتعطيل الدخول)، الحضور `/attendance`، الإجازات `/leaves`،
  الرواتب `/payroll`، مواقع العمل `/locations`.
- **الموظف**: بوابته `/me` فقط — حضوره وإجازاته ومسير راتبه هو، وتسجيل حضور/انصراف، وطلب إجازة.
  لا يرى روابط الإدارة، وأي رابط إداري مباشر يعيده إلى بوابته.

## الواجهة الخلفية (كلها تحت /api على api_router)
- `POST /auth/manager-login` · `POST /auth/employee-login` (`access_code` أو `email`+`password`)
  · `GET /auth/me` (200 دائماً مع `authenticated`) · `POST /auth/logout`
- `/me/*` (موظف فقط): `GET /me/profile` · `GET /me/location` · `GET /me/attendance`
  · `POST /me/check-in` · `POST /me/check-out` · `GET /me/leaves` · `POST /me/leaves`
  · `GET /me/payroll?month=` · `GET /me/leave-balance` · `GET /me/report?month=`
- مدير فقط: `GET/POST /employees` · `GET/PUT/DELETE /employees/{id}` (الحذف يتسلسل للحضور
  والإجازات والرواتب والجلسات) · `POST /employees/{id}/regenerate-code` ·
  `POST /employees/{id}/set-password` · `GET /employees/{id}/report?month=`
- مدير فقط: `GET/POST /attendance` · `POST /attendance/check-in|check-out` · `PATCH/DELETE /attendance/{id}`
- مدير فقط: `GET/POST /leaves` · `PATCH /leaves/{id}` (approved/rejected + manager_note) · `DELETE /leaves/{id}`
- مدير فقط: `GET /payroll` · `POST /payroll/generate {month}` (idempotent) · `PATCH /payroll/{id}`
- مدير فقط: `GET/POST /locations` · `PUT/DELETE /locations/{id}` · `GET /dashboard`
- عام: `GET /today` → `{today, now_hhmm}` بتوقيت APP_TZ (الساعة الحية في البوابة مثبّتة على
  وقت الخادم لا المتصفح)

## السياج الجغرافي لتسجيل الحضور (Geofence)
- المدير يعرّف مواقع عمل (اسم + إحداثيات + نطاق بالأمتار، مع «استخدم موقعي الحالي») ويربط كل
  موظف بموقع أو يتركه «بدون تقييد».
- البوابة تطلب إحداثيات GPS قبل `POST /me/check-in`، والقاعدة تُفرض على الخادم
  (`lib/punch.py` + `lib/geo.py` بمسافة haversine): بلا إحداثيات → **400**، خارج النطاق → **403**،
  داخل النطاق → يُخزَّن `location_id` و`distance_m`. التقييد على الحضور فقط دون الانصراف.

## النموذج (Pydantic في backend/models ↔ TS في frontend/src/lib/types.ts)
- Employee: id, name, job_title, email, phone, base_salary, allowances, hire_date,
  status(active/inactive), location_id, access_code, can_login
- WorkLocation: id, name, latitude, longitude, radius_m (≥10)
- AttendanceRecord: id, employee_id, date, check_in/check_out (HH:MM), location_id, distance_m
- LeaveRequest: id, employee_id, leave_type(annual/sick/unpaid), start_date, end_date, reason,
  status(pending/approved/rejected), manager_note
- PayrollItem: id, employee_id, month(YYYY-MM), base_salary, allowances, deductions, net, status(draft/paid)
- SessionInfo: authenticated, role, email, name, employee_id

## بيانات التجزئة (backend/seed.py — idempotent)
- حساب المدير من `.env`، ورمز دخول لكل موظف ينقصه رمز (يُطبع في المخرجات)
- 5 موظفين أساسيين + سجلات حضور وإجازات ومسير الشهر الحالي
- موقعا عمل: «المقر الرئيسي» (24.7136, 46.6753، 250م) و«فرع العليا» (24.6941, 46.6834، 150م)

## حصة الإجازات الشهرية (دورة مرتبطة بتاريخ المباشرة)
- المدير يحدد `monthly_leave_quota` لكل موظف عند الإضافة أو التعديل (افتراضي 2)، ويظهر في
  عمود «إجازات/شهر» بجدول الموظفين.
- **الشهر يُحتسب من تاريخ المباشرة لا من التقويم** (`lib/leave_cycle.py`): مباشرة يوم 15 →
  دورات 15→14، مع ضبط الأيام الطويلة على الأشهر القصيرة (31 يناير → 28/29 فبراير).
- يُحتسب ضمن الحصة كل طلب حالته `pending` أو `approved` يبدأ داخل الدورة؛ المرفوض لا يُحتسب.
- عند نفاد الرصيد: `POST /me/leaves` يرد **409** برسالة توضح الدورة، وزر «طلب إجازة» في البوابة
  يصبح معطّلاً مع تنبيه. طلب بتاريخ خارج الدورة الحالية يرد **400**.
- `GET /me/leave-balance` يعيد `{cycle_start, cycle_end, quota, used, remaining}`.

## تخطيط بوابة الموظف (شريط تنقل سفلي بثلاث تبويبات)
- شريط سفلي ثابت (`components/layout/BottomNav.tsx`) يظهر للموظف فقط، وترتيبه RTL:
  **اليمين = الإجازات** (`/me/leaves`)، **الوسط = البصمة** (`/me`) بأيقونة بصمة في زر دائري
  مرتفع فوق الشريط، **اليسار = ملفي** (`/me/profile`). شريط الموظف العلوي بلا روابط.
- **تبويب البصمة** (`pages/portal/MyAttendance.tsx`): ساعة الخادم الحية، زر بصمة دائري كبير
  للحضور/الانصراف مع مؤقّت المدة وملخص بصمة اليوم والمسافة، ثم سجل حضور الشهر ومسير الراتب.
- **تبويب الإجازات** (`pages/portal/MyLeaves.tsx`): رصيد الدورة، زر الطلب (يُعطّل عند النفاد)،
  وكل الطلبات بحالاتها وأسبابها وملاحظات المدير.
- **تبويب ملفي** (`pages/portal/MyProfile.tsx`): مكوّن التقرير المشترك.
- التقرير (`components/EmployeeReportPanel.tsx`) يجمع الملخص **و سجلاً يومياً كاملاً**: جدول
  بأعمدة اليوم (اسم اليوم بالعربية) والتاريخ ووقت الحضور ووقت الانصراف ومدة العمل لكل يوم في
  الشهر المختار — يراه الموظف عن نفسه (`GET /me/report`) والمدير عن أي موظف
  (`GET /employees/{id}/report`).

## ملاحظات تنفيذية
- حارس `/me` خاص بالموظف: المدير الذي يفتح `/me` (أو يبقى العنوان من جلسة موظف سابقة على
  نفس المتصفح) يُعاد إلى لوحة التحكم بدل بوابة فارغة.
- نسبة الحضور في صفحة الحضور تُحتسب ليوم محدد فقط؛ بلا فلتر تاريخ تظهر «—».

## ملاحظات بيئية
- `.env`: `APP_TZ="Asia/Riyadh"`, `MANAGER_EMAIL`, `MANAGER_PASSWORD` (تهيئة أولية فقط)
- بيانات الدخول الفعلية في `memory/test_credentials.md`
- رابط المعاينة: https://people-hub-152.preview.emergentagent.com
