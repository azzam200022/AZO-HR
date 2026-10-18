# مواردي (Mawaridi HR) — مواصفة التطبيق

تطبيق إدارة موارد بشرية عربي بالكامل (RTL) بدون تسجيل دخول — دورا «مدير» و«موظف» في نفس
التطبيق عبر مبدّل الأدوار في الشريط العلوي.

## الأدوار
- **مدير النظام** (افتراضي): لوحة تحكم `/`، الموظفون `/employees`، الحضور `/attendance`،
  الإجازات `/leaves`، الرواتب `/payroll`. صفحات المدير محمية بمحوّل (employee → /me).
- **بوابة الموظف** `/me`: اختيار «أنت تتصفح كـ» من القائمة، تسجيل الحضور/الانصراف بمؤقّت
  حيّ، طلب إجازة، ومسير الراتب الشهري. الخيار يُحفظ في localStorage (`my-employee-id`).
- الدور محفوظ في localStorage (`hr-role`)؛ التبديل من الشريط العلوي (role-switcher-*).

## الواجهة الخلفية (كلها تحت /api على api_router)
- `GET /employees` (`?status=`) · `POST /employees` · `GET/PUT/DELETE /employees/{id}`
  (الحذف يتسلسل لحذف حضور الموظف وإجازاته ورواتب)
- `GET /attendance` (`?date=&employee_id=`) · `POST /attendance` (يدوي، مكرر نفس اليوم → 409)
  · `POST /attendance/check-in` · `POST /attendance/check-out` (404/409 عند الخطأ)
  · `PATCH/DELETE /attendance/{id}`
- `GET /leaves` (`?status=&employee_id=`) · `POST /leaves` (end<start → 400)
  · `PATCH /leaves/{id}` (approved/rejected + manager_note) · `DELETE /leaves/{id}`
- `GET /payroll` (`?month=&employee_id=`) · `POST /payroll/generate {month}` (بنود مسوّدة
  للموظفين النشِطين الناقصين، idempotent) · `PATCH /payroll/{id}` (يعيد حساب net)
- `GET /locations` · `POST /locations` · `PUT /locations/{id}` · `DELETE /locations/{id}`
  (الحذف يُلغي ربط الموقع بالموظفين فيصبحون بلا تقييد)
- `GET /dashboard` (KPIs + اتجاه 7 أيام + توزيع الإجازات + أحدث الطلبات) ·
  `GET /today` → `{today, now_hhmm}` بتوقيت APP_TZ — الساعة الحية والمؤقّت في البوابة
  مثبّتان على وقت الخادم وليس المتصفح.

## السياج الجغرافي لتسجيل الحضور (Geofence)
- المدير يعرّف **مواقع عمل** في صفحة `/locations` (اسم + خط عرض/طول + نطاق سماح بالأمتار،
  وزر «استخدم موقعي الحالي» لجلب الإحداثيات)، ويربط كل موظف بموقع من نموذج الموظف
  (`employee-location-select`، أو «بدون تقييد جغرافي»).
- بوابة الموظف تطلب إحداثيات GPS من المتصفح قبل `POST /attendance/check-in` وترسل `lat`/`lng`.
- **التحقق على الخادم** (`routers/attendance.py` + `lib/geo.py` بمسافة haversine):
  - موظف مرتبط بموقع وبلا إحداثيات → **400** «تسجيل الحضور يتطلب تحديد موقعك الجغرافي»
  - خارج النطاق → **403** مع اسم الموقع والنطاق المسموح
  - داخل النطاق → **200** ويُخزَّن `location_id` و`distance_m` في سجل الحضور (يظهران في البوابة)
  - موظف بلا موقع (`location_id=""`) → لا تقييد، يُسجَّل الحضور كالسابق
- التقييد يسري على تسجيل **الحضور** فقط؛ الانصراف غير مقيّد جغرافياً.

## النموذج (Pydantic في backend/models/hr.py ↔ TS في frontend/src/lib/types.ts)
- Employee: id, name, job_title, email, phone, base_salary, allowances, hire_date, status(active/inactive), location_id
- WorkLocation: id, name, latitude, longitude, radius_m (≥10، افتراضي 150)
- AttendanceRecord: id, employee_id, date(YYYY-MM-DD), check_in/check_out(HH:MM، قد تكون فارغة), location_id, distance_m
- LeaveRequest: id, employee_id, leave_type(annual/sick/unpaid), start_date, end_date, reason, status(pending/approved/rejected), manager_note
- PayrollItem: id, employee_id, month(YYYY-MM), base_salary, allowances, deductions, net, status(draft/paid)
- المعرفات uuid4 نصية؛ التواريخ نصوص ISO؛ created_at تاريخ واعٍ UTC (يُطبَّع بـ `aware()` من lib/dates)

## بيانات التجزئة (backend/seed.py — idempotent)
- 5 موظفين: emp-1 أحمد المنصوري، emp-2 سارة القحطاني، emp-3 فيصل العتيبي، emp-4 نورة الشمري، emp-5 خالد الغامدي (كلهم نشِطون)
- موقعا عمل: loc-1 «المقر الرئيسي — طريق الملك فهد» (24.7136, 46.6753، نطاق 250م) لـ emp-1/2/3،
  و loc-2 «فرع العليا» (24.6941, 46.6834، نطاق 150م) لـ emp-4/5
- 25 سجل حضور لأيام العمل في آخر 8 أيام (عطلة الجمعة/السبت)؛ emp-1 له بصمة اليوم دون انصراف
- 4 طلبات إجازة: 2 معلقة (emp-2، emp-3)، 1 مقبولة (emp-5)، 1 مرفوضة (emp-4)
- مسير رواتب الشهر الحالي: 5 بنود (emp-1 مدفوع، الباقي مسوّدة)

## ملاحظات بيئية
- `APP_TZ="Asia/Riyadh"` في backend/.env (أُعيد تشغيل الخدمات بعده)؛ عطلة الأسبوع الجمعة/السبت
- رابط المعاينة العام: https://people-hub-152.preview.emergentagent.com
- بيانات اعتماد: لا يوجد تسجيل دخول — انظر memory/test_credentials.md
