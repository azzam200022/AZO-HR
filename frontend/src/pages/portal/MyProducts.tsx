import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, getApiOrigin } from "@/lib/api";
import { errorText, fmtDate, formatNumber } from "@/lib/format";
import { preparePhotoData } from "@/lib/photo-upload";
import BarcodeScannerDialog from "@/components/BarcodeScannerDialog";
import type {
  DeleteResult,
  EmployeeProduct,
  EmployeeProductUpdate,
  ProductExpiryStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardSection, EmptyState, FadeIn, LoadingBlock, PageHeader } from "@/components/shared";

function productPhotoUrl(productId: string) {
  return `${getApiOrigin()}/api/me/products/${encodeURIComponent(productId)}/photo`;
}

function prepareSelectedPhoto(
  event: ChangeEvent<HTMLInputElement>,
  onPrepared: (photoData: string) => void,
) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  input.value = "";
  void preparePhotoData(file)
    .then(onPrepared)
    .catch((error) =>
      toast.error(error instanceof Error ? error.message : "تعذر تجهيز الصورة"),
    );
}

const STATUS_LABEL: Record<ProductExpiryStatus, string> = {
  far: "بعيد",
  near: "قريب",
  expired: "منتهي",
};

const STATUS_STYLE: Record<ProductExpiryStatus, string> = {
  far: "border-emerald-200 bg-emerald-50 text-emerald-800",
  near: "border-amber-200 bg-amber-50 text-amber-800",
  expired: "border-rose-200 bg-rose-50 text-rose-800",
};

function remainingLabel(days: number) {
  if (days < 0) return `منتهي منذ ${formatNumber(Math.abs(days))} يوم`;
  if (days === 0) return "ينتهي اليوم";
  return `متبقي ${formatNumber(days)} يوم`;
}

function reminderDaysLabel(days: number) {
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومين";
  if (days >= 3 && days <= 10) return `${formatNumber(days)} أيام`;
  return `${formatNumber(days)} يومًا`;
}

type ProductExpiryBatch = EmployeeProduct["expiry_dates"][number];

function compareExpiryBatches(a: ProductExpiryBatch, b: ProductExpiryBatch) {
  const aIsUpcoming = a.days_remaining >= 0;
  const bIsUpcoming = b.days_remaining >= 0;
  if (aIsUpcoming !== bIsUpcoming) return aIsUpcoming ? -1 : 1;
  return aIsUpcoming
    ? a.expiry_date.localeCompare(b.expiry_date)
    : b.expiry_date.localeCompare(a.expiry_date);
}

function nearestExpiryBatch(expiryDates: ProductExpiryBatch[]) {
  const unhandledDates = expiryDates.filter((batch) => !batch.handled);
  const candidates = unhandledDates.length > 0 ? unhandledDates : expiryDates;
  return [...candidates].sort(compareExpiryBatches)[0];
}

function compareProductsByNearestExpiry(a: EmployeeProduct, b: EmployeeProduct) {
  const nearestA = nearestExpiryBatch(a.expiry_dates);
  const nearestB = nearestExpiryBatch(b.expiry_dates);
  if (!nearestA || !nearestB) return nearestA ? -1 : nearestB ? 1 : 0;
  return compareExpiryBatches(nearestA, nearestB);
}

/** An employee's own products, with each expiry date treated as a separate batch. */
export default function MyProducts() {
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [expiryDates, setExpiryDates] = useState([""]);
  const [customReminderDays, setCustomReminderDays] = useState("");
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editReminderDays, setEditReminderDays] = useState("");
  const [editPhotoData, setEditPhotoData] = useState<string | null | undefined>(undefined);
  const [newExpiryDate, setNewExpiryDate] = useState("");
  const [previewProduct, setPreviewProduct] = useState<EmployeeProduct | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"search" | "barcode">("search");
  const [visibleProductCount, setVisibleProductCount] = useState(24);
  const [scannerTarget, setScannerTarget] = useState<"add" | "search" | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setVisibleProductCount(24);
  }, [debouncedSearch]);

  const productsQuery = useQuery({
    queryKey: ["me", "products", searchMode, debouncedSearch],
    queryFn: () => {
      const parameter = searchMode === "barcode" ? "barcode" : "search";
      const query = debouncedSearch
        ? `?${parameter}=${encodeURIComponent(debouncedSearch)}`
        : "";
      return apiGet<EmployeeProduct[]>(`/me/products${query}`);
    },
  });

  const addProductMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      barcode: string | null;
      expiry_dates: string[];
      custom_reminder_days: number | null;
      photo_data: string;
    }) =>
      apiPost<EmployeeProduct>("/me/products", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "products"] });
      setName("");
      setBarcode("");
      setExpiryDates([""]);
      setCustomReminderDays("");
      setPhotoData(null);
      setSearch("");
      setDebouncedSearch("");
      setSearchMode("search");
      setVisibleProductCount(24);
      setAddDialogOpen(false);
      toast.success("تمت إضافة المادة وتواريخ انتهائها");
    },
    onError: (error, variables) => {
      toast.error(errorText(error));
      if (error instanceof ApiError && error.status === 409 && variables.barcode) {
        setAddDialogOpen(false);
        setSearch(variables.barcode);
        setDebouncedSearch(variables.barcode);
        setSearchMode("barcode");
        setVisibleProductCount(24);
      }
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: EmployeeProductUpdate }) =>
      apiPatch<EmployeeProduct>(`/me/products/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "products"] });
      setEditingProductId(null);
      setEditPhotoData(undefined);
      setNewExpiryDate("");
      toast.success("تم حفظ تعديلات المادة");
    },
    onError: (error, variables) => {
      toast.error(errorText(error));
      if (error instanceof ApiError && error.status === 409 && variables.payload.barcode) {
        setEditingProductId(null);
        setSearch(variables.payload.barcode);
        setDebouncedSearch(variables.payload.barcode);
        setSearchMode("barcode");
        setVisibleProductCount(24);
      }
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: string) => apiDelete<DeleteResult>(`/me/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "products"] });
      setEditingProductId(null);
      toast.success("تم حذف المادة");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const deleteExpiryDateMutation = useMutation({
    mutationFn: ({ productId, batchId }: { productId: string; batchId: string }) =>
      apiDelete<EmployeeProduct>(
        `/me/products/${encodeURIComponent(productId)}/expiry-dates/${encodeURIComponent(batchId)}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "products"] });
      toast.success("تم حذف تاريخ الصلاحية");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const handleExpiryDateMutation = useMutation({
    mutationFn: ({
      productId,
      batchId,
      handled,
    }: {
      productId: string;
      batchId: string;
      handled: boolean;
    }) =>
      apiPatch<EmployeeProduct>(
        `/me/products/${encodeURIComponent(productId)}/expiry-dates/${encodeURIComponent(batchId)}`,
        { handled },
      ),
    onSuccess: (_product, variables) => {
      queryClient.invalidateQueries({ queryKey: ["me", "products"] });
      toast.success(
        variables.handled ? "تم تسجيل معالجة تاريخ الصلاحية" : "تمت إعادة فتح تذكيرات الصلاحية",
      );
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const handleBarcodeDetected = (value: string) => {
    if (scannerTarget === "add") {
      setBarcode(value);
    } else {
      setSearch(value);
      setDebouncedSearch(value);
      setSearchMode("barcode");
      setVisibleProductCount(24);
    }
    setScannerTarget(null);
  };

  const products = useMemo(
    () => [...(productsQuery.data ?? [])].sort(compareProductsByNearestExpiry),
    [productsQuery.data],
  );
  const visibleProducts = products.slice(0, visibleProductCount);
  const editingProduct = products.find((product) => product.id === editingProductId);
  const editPhotoPreview =
    editPhotoData !== undefined
      ? editPhotoData
      : editingProduct?.has_photo
        ? productPhotoUrl(editingProduct.id)
        : null;

  const addExpiryDate = () => setExpiryDates((dates) => [...dates, ""]);
  const removeExpiryDate = (index: number) =>
    setExpiryDates((dates) => dates.filter((_, current) => current !== index));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error("أدخل اسم المادة");
      return;
    }
    if (expiryDates.some((value) => !value)) {
      toast.error("أدخل تاريخ انتهاء لكل دفعة");
      return;
    }
    if (new Set(expiryDates).size !== expiryDates.length) {
      toast.error("احذف تواريخ الانتهاء المكررة");
      return;
    }
    const reminderDays = customReminderDays ? Number(customReminderDays) : null;
    if (
      reminderDays !== null &&
      (!Number.isInteger(reminderDays) || reminderDays < 1 || reminderDays > 365)
    ) {
      toast.error("اجعل التنبيه الإضافي بين يوم واحد و365 يومًا");
      return;
    }
    addProductMutation.mutate({
      name: cleanName,
      barcode: barcode.trim() || null,
      expiry_dates: expiryDates,
      custom_reminder_days: reminderDays,
      photo_data: photoData ?? "",
    });
  };

  const beginEdit = (product: EmployeeProduct) => {
    setEditingProductId(product.id);
    setExpandedProductId(product.id);
    setEditName(product.name);
    setEditBarcode(product.barcode ?? "");
    setEditReminderDays(product.custom_reminder_days?.toString() ?? "");
    setEditPhotoData(undefined);
    setNewExpiryDate("");
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>, productId: string) => {
    event.preventDefault();
    const cleanName = editName.trim();
    if (!cleanName) {
      toast.error("أدخل اسم المادة");
      return;
    }

    const reminderDays = editReminderDays ? Number(editReminderDays) : null;
    if (
      reminderDays !== null &&
      (!Number.isInteger(reminderDays) || reminderDays < 1 || reminderDays > 365)
    ) {
      toast.error("اجعل التنبيه الإضافي بين يوم واحد و365 يومًا");
      return;
    }

    const payload: EmployeeProductUpdate = {
      name: cleanName,
      barcode: editBarcode.trim() || null,
      custom_reminder_days: reminderDays,
    };
    if (newExpiryDate) payload.add_expiry_date = newExpiryDate;
    if (editPhotoData !== undefined) payload.photo_data = editPhotoData;
    updateProductMutation.mutate({ id: productId, payload });
  };

  const deleteProduct = (product: EmployeeProduct) => {
    if (window.confirm(`هل تريد حذف «${product.name}» وكل تواريخ صلاحيتها؟`)) {
      deleteProductMutation.mutate(product.id);
    }
  };

  const deleteExpiryDate = (product: EmployeeProduct, batch: EmployeeProduct["expiry_dates"][number]) => {
    if (window.confirm(`هل تريد حذف تاريخ ${fmtDate(batch.expiry_date)} من «${product.name}»؟`)) {
      deleteExpiryDateMutation.mutate({ productId: product.id, batchId: batch.id });
    }
  };

  return (
    <FadeIn>
      <PageHeader
        title="المواد وتواريخ الانتهاء"
        description="سجّل المادة وتواريخ انتهاء دفعاتها، وسنرسل التذكيرات إلى حسابك."
        testid="my-products-title"
        action={
          <Button
            type="button"
            onClick={() => setAddDialogOpen(true)}
            data-testid="open-add-product-btn"
          >
            <Plus className="h-4 w-4" />
            إضافة مادة جديدة
          </Button>
        }
      />

      <div className="mt-4 space-y-4">
        <div
          className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-white p-3 text-center text-[11px] font-semibold"
          data-testid="product-expiry-legend"
        >
          <span className="rounded-lg bg-emerald-50 px-2 py-2 text-emerald-800">أخضر · بعيد</span>
          <span className="rounded-lg bg-amber-50 px-2 py-2 text-amber-800">أصفر · خلال 30 يومًا</span>
          <span className="rounded-lg bg-rose-50 px-2 py-2 text-rose-800">أحمر · منتهي</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSearchMode("search");
                setVisibleProductCount(24);
              }}
              placeholder="ابحث باسم المادة أو الباركود"
              aria-label="البحث عن مادة بالاسم أو الباركود"
              className="pr-9"
              data-testid="product-search-input"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setScannerTarget("search")}
            data-testid="scan-product-search-btn"
          >
            <Camera className="h-4 w-4" />
            مسح للبحث
          </Button>
        </div>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>إضافة مادة جديدة</DialogTitle>
              <DialogDescription>
                أدخل اسم المادة وتواريخ انتهاء دفعاتها لحفظها في قائمتك.
              </DialogDescription>
            </DialogHeader>
          <form className="space-y-4" onSubmit={submit} data-testid="my-product-form">
            <div className="space-y-2">
              <Label htmlFor="product-name">اسم المادة</Label>
              <Input
                id="product-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                placeholder="مثال: حليب"
                required
                data-testid="product-name-input"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-barcode">الباركود (اختياري)</Label>
              <div className="flex gap-2">
                <Input
                  id="product-barcode"
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                  maxLength={128}
                  dir="ltr"
                  placeholder="امسح الرمز أو أدخله يدويًا"
                  data-testid="product-barcode-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScannerTarget("add")}
                  aria-label="مسح باركود المادة بالكاميرا"
                  data-testid="scan-product-barcode-btn"
                >
                  <Camera className="h-4 w-4" />
                  مسح
                </Button>
              </div>
              <p className="text-[11px] leading-5 text-slate-500">
                لا يمكن تكرار الباركود ضمن مواد حسابك. عند التكرار ستظهر المادة المسجّلة.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-photo">صورة المادة من الاستديو (اختياري)</Label>
              <Input
                id="product-photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => prepareSelectedPhoto(event, setPhotoData)}
                data-testid="product-photo-input"
              />
              {photoData && (
                <div className="flex items-center gap-3">
                  <img
                    src={photoData}
                    alt={`معاينة صورة ${name || "المادة"}`}
                    className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
                    data-testid="product-photo-preview"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPhotoData(null)}
                    data-testid="remove-product-photo-btn"
                  >
                    إزالة الصورة
                  </Button>
                </div>
              )}
              <p className="text-[11px] leading-5 text-slate-500">
                تُضغط الصورة تلقائيًا قبل حفظها، ويمكن تغييرها لاحقًا.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-reminder-days">تنبيه إضافي قبل الانتهاء</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="product-reminder-days"
                  type="number"
                  min={1}
                  max={365}
                  value={customReminderDays}
                  onChange={(event) => setCustomReminderDays(event.target.value)}
                  placeholder="مثال: 5"
                  data-testid="product-reminder-days-input"
                />
                <span className="shrink-0 text-sm text-slate-500">يومًا</span>
              </div>
              <p className="text-[11px] leading-5 text-slate-500">
                اختياري، ويضاف إلى التذكيرات الافتراضية قبل شهر و15 و10 و7 أيام.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>تواريخ انتهاء الدفعات</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addExpiryDate}
                  disabled={expiryDates.length >= 50}
                  data-testid="add-expiry-date-btn"
                >
                  <Plus className="h-4 w-4" />
                  إضافة تاريخ
                </Button>
              </div>

              <div className="space-y-2">
                {expiryDates.map((expiryDate, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={expiryDate}
                      onChange={(event) =>
                        setExpiryDates((dates) =>
                          dates.map((current, currentIndex) =>
                            currentIndex === index ? event.target.value : current,
                          ),
                        )
                      }
                      required
                      aria-label={`تاريخ انتهاء الدفعة ${index + 1}`}
                      data-testid={`expiry-date-input-${index}`}
                    />
                    {expiryDates.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeExpiryDate(index)}
                        aria-label={`حذف تاريخ الدفعة ${index + 1}`}
                        data-testid={`remove-expiry-date-btn-${index}`}
                      >
                        <Trash2 className="h-4 w-4 text-slate-500" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] leading-5 text-slate-500">
                لكل تاريخ تذكير قبل شهر، ثم قبل 15 و10 و7 أيام.
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={addProductMutation.isPending}
              data-testid="save-product-btn"
            >
              حفظ المادة
            </Button>
          </form>
          </DialogContent>
        </Dialog>

        <BarcodeScannerDialog
          open={scannerTarget !== null}
          onOpenChange={(open) => {
            if (!open) setScannerTarget(null);
          }}
          onDetected={handleBarcodeDetected}
        />

        <CardSection title="المواد المسجّلة" testid="my-products-list-card">
          {productsQuery.isLoading ? (
            <LoadingBlock className="h-40" />
          ) : productsQuery.isError ? (
            <EmptyState title="تعذّر تحميل المواد" description="أعد المحاولة بعد تحديث الصفحة." />
          ) : products.length === 0 ? (
            <EmptyState
              title={debouncedSearch ? "لا توجد مادة مطابقة" : "لا توجد مواد مسجّلة"}
              description={
                debouncedSearch
                  ? "جرّب اسمًا أو باركودًا آخر."
                  : "أضف مادة وتاريخ انتهاء دفعتها لتظهر هنا."
              }
            />
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-500">
                عرض {formatNumber(visibleProducts.length)} من {formatNumber(products.length)} نتيجة.
                تظهر المواد على دفعات حتى تبقى القائمة سهلة التصفح.
              </p>
              <div className="space-y-3" data-testid="my-products-list">
                {visibleProducts.map((product) => {
                  const nearestExpiry = nearestExpiryBatch(product.expiry_dates);
                  const isExpanded = expandedProductId === product.id;
                  return (
                  <article
                    key={product.id}
                    className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5"
                    data-testid={`my-product-${product.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {product.has_photo ? (
                          <button
                            type="button"
                            onClick={() => setPreviewProduct(product)}
                            className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200 transition hover:ring-2 hover:ring-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                            aria-label={`تكبير صورة ${product.name}`}
                            data-testid={`product-photo-${product.id}`}
                          >
                            <img
                              src={productPhotoUrl(product.id)}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </button>
                        ) : (
                          <span
                            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200"
                            aria-hidden="true"
                          >
                            <ImagePlus className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <h2 className="text-sm font-bold text-slate-900">{product.name}</h2>
                          {product.barcode && (
                            <p className="mt-1 truncate text-[11px] text-slate-500" dir="ltr">
                              {product.barcode}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-slate-500">
                            {product.custom_reminder_days
                              ? `تنبيه إضافي قبل الانتهاء بـ ${reminderDaysLabel(product.custom_reminder_days)}`
                              : "التذكيرات الافتراضية فقط"}
                          </p>
                        </div>
                      </div>
                      {editingProductId !== product.id && (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => beginEdit(product)}
                            aria-label={`تعديل ${product.name}`}
                            data-testid={`edit-product-${product.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            تعديل
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon-sm"
                            onClick={() => deleteProduct(product)}
                            disabled={deleteProductMutation.isPending}
                            aria-label={`حذف ${product.name}`}
                            data-testid={`delete-product-${product.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {nearestExpiry ? (
                        <>
                          <span
                            className={`rounded-full border px-2 py-1 text-[10px] font-bold ${STATUS_STYLE[nearestExpiry.status]}`}
                          >
                            {STATUS_LABEL[nearestExpiry.status]}
                          </span>
                          <p className="text-xs font-semibold text-slate-700">
                            أقرب انتهاء: {fmtDate(nearestExpiry.expiry_date)} ·{" "}
                            {remainingLabel(nearestExpiry.days_remaining)}
                            {nearestExpiry.handled ? " · تم التعامل" : ""}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-slate-500">لا توجد تواريخ صلاحية مسجّلة.</p>
                      )}
                    </div>
                    {product.expiry_dates.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExpandedProductId(isExpanded ? null : product.id)
                        }
                        aria-expanded={isExpanded}
                        aria-controls={`product-expiries-${product.id}`}
                        data-testid={`toggle-product-expiries-${product.id}`}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {isExpanded
                          ? "إخفاء التواريخ"
                          : `عرض التواريخ (${formatNumber(product.expiry_dates.length)})`}
                      </Button>
                    )}
                  </div>

                    {editingProductId === product.id && (
                    <form
                      className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3"
                      onSubmit={(event) => submitEdit(event, product.id)}
                      data-testid={`edit-product-form-${product.id}`}
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-product-name-${product.id}`}>اسم المادة</Label>
                        <Input
                          id={`edit-product-name-${product.id}`}
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          maxLength={120}
                          required
                          data-testid={`edit-product-name-${product.id}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-product-barcode-${product.id}`}>الباركود</Label>
                        <Input
                          id={`edit-product-barcode-${product.id}`}
                          value={editBarcode}
                          onChange={(event) => setEditBarcode(event.target.value)}
                          maxLength={128}
                          dir="ltr"
                          placeholder="اختياري"
                          data-testid={`edit-product-barcode-${product.id}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-product-photo-${product.id}`}>صورة المادة</Label>
                        <Input
                          id={`edit-product-photo-${product.id}`}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(event) => prepareSelectedPhoto(event, setEditPhotoData)}
                          data-testid={`edit-product-photo-${product.id}`}
                        />
                        {editPhotoPreview && (
                          <div className="flex items-center gap-3">
                            <img
                              src={editPhotoPreview}
                              alt={`معاينة صورة ${product.name}`}
                              className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
                              data-testid={`edit-product-photo-preview-${product.id}`}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setEditPhotoData(null)}
                              data-testid={`remove-edit-product-photo-${product.id}`}
                            >
                              إزالة الصورة
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-expiry-date-${product.id}`}>إضافة تاريخ صلاحية</Label>
                        <Input
                          id={`edit-expiry-date-${product.id}`}
                          type="date"
                          value={newExpiryDate}
                          onChange={(event) => setNewExpiryDate(event.target.value)}
                          data-testid={`add-product-expiry-${product.id}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`edit-reminder-days-${product.id}`}>
                          تنبيه إضافي قبل الانتهاء بعدد الأيام
                        </Label>
                        <Input
                          id={`edit-reminder-days-${product.id}`}
                          type="number"
                          min={1}
                          max={365}
                          value={editReminderDays}
                          onChange={(event) => setEditReminderDays(event.target.value)}
                          placeholder="فارغ لإيقاف التنبيه الإضافي"
                          data-testid={`edit-reminder-days-${product.id}`}
                        />
                        <p className="text-[11px] leading-5 text-slate-500">
                          لا يؤثر ذلك في التذكيرات الافتراضية.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="submit"
                          size="sm"
                          disabled={updateProductMutation.isPending}
                          data-testid={`save-product-edit-${product.id}`}
                        >
                          حفظ التعديلات
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingProductId(null);
                            setEditPhotoData(undefined);
                          }}
                          data-testid={`cancel-product-edit-${product.id}`}
                        >
                          <X className="h-3.5 w-3.5" />
                          إلغاء
                        </Button>
                      </div>
                    </form>
                  )}

                    {isExpanded && (
                    <div
                      id={`product-expiries-${product.id}`}
                      className="mt-3 space-y-2"
                      data-testid={`product-expiries-${product.id}`}
                    >
                    {product.expiry_dates.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
                        لا توجد تواريخ صلاحية مسجّلة. يمكنك إضافة تاريخ من تعديل المادة.
                      </p>
                    ) : (
                      [...product.expiry_dates]
                        .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
                        .map((batch) => (
                          <div
                            key={batch.id}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 ${STATUS_STYLE[batch.status]}`}
                            data-testid={`product-expiry-${batch.id}`}
                          >
                            <div>
                              <p className="text-xs font-semibold">
                                تاريخ الانتهاء: {fmtDate(batch.expiry_date)}
                              </p>
                              <p className="mt-1 text-[11px]">
                                {remainingLabel(batch.days_remaining)}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-1">
                              <span className="text-[11px] font-bold">
                                {STATUS_LABEL[batch.status]}
                              </span>
                              {batch.handled && (
                                <span
                                  className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800"
                                  data-testid={`product-expiry-handled-${batch.id}`}
                                >
                                  تم التعامل
                                </span>
                              )}
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  handleExpiryDateMutation.mutate({
                                    productId: product.id,
                                    batchId: batch.id,
                                    handled: !batch.handled,
                                  })
                                }
                                disabled={handleExpiryDateMutation.isPending}
                                aria-label={
                                  batch.handled
                                    ? `إلغاء معالجة تاريخ ${fmtDate(batch.expiry_date)}`
                                    : `تسجيل معالجة تاريخ ${fmtDate(batch.expiry_date)}`
                                }
                                data-testid={`handle-product-expiry-${batch.id}`}
                              >
                                {batch.handled ? (
                                  <RotateCcw className="h-3 w-3" />
                                ) : (
                                  <Check className="h-3 w-3" />
                                )}
                                {batch.handled ? "تراجع" : "تم"}
                              </Button>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                onClick={() => deleteExpiryDate(product, batch)}
                                disabled={deleteExpiryDateMutation.isPending}
                                aria-label={`حذف تاريخ ${fmtDate(batch.expiry_date)} من ${product.name}`}
                                data-testid={`delete-product-expiry-${batch.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))
                    )}
                    </div>
                  )}
                  </article>
                  );
                })}
              </div>
              {products.length > visibleProductCount && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={() => setVisibleProductCount((count) => count + 24)}
                  data-testid="load-more-products-btn"
                >
                  عرض المزيد ({formatNumber(products.length - visibleProductCount)})
                </Button>
              )}
            </>
          )}
        </CardSection>
      </div>

      <Dialog
        open={previewProduct !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewProduct(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {previewProduct ? `صورة ${previewProduct.name}` : "صورة المادة"}
            </DialogTitle>
            <DialogDescription>صورة المادة المسجّلة.</DialogDescription>
          </DialogHeader>
          {previewProduct && (
            <img
              src={productPhotoUrl(previewProduct.id)}
              alt={`صورة ${previewProduct.name}`}
              className="mx-auto max-h-[70dvh] w-full rounded-xl object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </FadeIn>
  );
}
