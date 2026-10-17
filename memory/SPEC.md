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
- `GET /dashboard` (KPIs + اتجاه 7 أيام + توزيع الإجازات + أحدث الطلبات) ·
  `GET /today` → `{today, now_hhmm}` بتوقيت APP_TZ — الساعة الحية والمؤقّت في البوابة
  مثبّتان على وقت الخادم وليس المتصفح.

## النموذج (Pydantic في backend/models/hr.py ↔ TS في frontend/src/lib/types.ts)
- Employee: id, name, job_title, email, phone, base_salary, allowances, hire_date, status(active/inactive)
- AttendanceRecord: id, employee_id, date(YYYY-MM-DD), check_in/check_out(HH:MM، قد تكون فارغة)
- LeaveRequest: id, employee_id, leave_type(annual/sick/unpaid), start_date, end_date, reason, status(pending/approved/rejected), manager_note
- PayrollItem: id, employee_id, month(YYYY-MM), base_salary, allowances, deductions, net, status(draft/paid)
- المعرفات uuid4 نصية؛ التواريخ نصوص ISO؛ created_at تاريخ واعٍ UTC (يُطبَّع بـ `aware()` من lib/dates)

## بيانات التجزئة (backend/seed.py — idempotent)
- 5 موظفين: emp-1 أحمد المنصوري، emp-2 سارة القحطاني، emp-3 فيصل العتيبي، emp-4 نورة الشمري، emp-5 خالد الغامدي (كلهم نشِطون)
- 25 سجل حضور لأيام العمل في آخر 8 أيام (عطلة الجمعة/السبت)؛ emp-1 له بصمة اليوم دون انصراف
- 4 طلبات إجازة: 2 معلقة (emp-2، emp-3)، 1 مقبولة (emp-5)، 1 مرفوضة (emp-4)
- مسير رواتب الشهر الحالي: 5 بنود (emp-1 مدفوع، الباقي مسوّدة)

## ملاحظات بيئية
- `APP_TZ="Asia/Riyadh"` في backend/.env (أُعيد تشغيل الخدمات بعده)؛ عطلة الأسبوع الجمعة/السبت
- رابط المعاينة العام: https://people-hub-152.preview.emergentagent.com
- بيانات اعتماد: لا يوجد تسجيل دخول — انظر memory/test_credentials.md
