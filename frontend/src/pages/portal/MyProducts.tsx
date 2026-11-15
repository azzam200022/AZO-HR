import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { errorText, fmtDate, formatNumber } from "@/lib/format";
import type { EmployeeProduct, ProductExpiryStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardSection, EmptyState, FadeIn, LoadingBlock, PageHeader } from "@/components/shared";

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

/** An employee's own products, with each expiry date treated as a separate batch. */
export default function MyProducts() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [expiryDates, setExpiryDates] = useState([""]);

  const productsQuery = useQuery({
    queryKey: ["me", "products"],
    queryFn: () => apiGet<EmployeeProduct[]>("/me/products"),
  });

  const addProductMutation = useMutation({
    mutationFn: (payload: { name: string; expiry_dates: string[] }) =>
      apiPost<EmployeeProduct>("/me/products", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "products"] });
      setName("");
      setExpiryDates([""]);
      toast.success("تمت إضافة المادة وتواريخ انتهائها");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const products = useMemo(
    () =>
      [...(productsQuery.data ?? [])].sort((a, b) => {
        const firstA = [...a.expiry_dates].sort((x, y) =>
          x.expiry_date.localeCompare(y.expiry_date),
        )[0]?.expiry_date ?? "";
        const firstB = [...b.expiry_dates].sort((x, y) =>
          x.expiry_date.localeCompare(y.expiry_date),
        )[0]?.expiry_date ?? "";
        return firstA.localeCompare(firstB);
      }),
    [productsQuery.data],
  );

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
    addProductMutation.mutate({ name: cleanName, expiry_dates: expiryDates });
  };

  return (
    <FadeIn>
      <PageHeader
        title="المواد وتواريخ الانتهاء"
        description="سجّل المادة وتواريخ انتهاء دفعاتها، وسنرسل التذكيرات إلى حسابك."
        testid="my-products-title"
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

        <CardSection title="إضافة مادة" testid="my-products-form-card">
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
        </CardSection>

        <CardSection title="المواد المسجّلة" testid="my-products-list-card">
          {productsQuery.isLoading ? (
            <LoadingBlock className="h-40" />
          ) : productsQuery.isError ? (
            <EmptyState title="تعذّر تحميل المواد" description="أعد المحاولة بعد تحديث الصفحة." />
          ) : products.length === 0 ? (
            <EmptyState
              title="لا توجد مواد مسجّلة"
              description="أضف مادة وتاريخ انتهاء دفعتها لتظهر هنا."
            />
          ) : (
            <div className="space-y-3" data-testid="my-products-list">
              {products.map((product) => (
                <article
                  key={product.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5"
                  data-testid={`my-product-${product.id}`}
                >
                  <h2 className="text-sm font-bold text-slate-900">{product.name}</h2>
                  <div className="mt-3 space-y-2">
                    {[...product.expiry_dates]
                      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
                      .map((batch) => (
                        <div
                          key={batch.id}
                          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${STATUS_STYLE[batch.status]}`}
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
                          <span className="shrink-0 text-[11px] font-bold">
                            {STATUS_LABEL[batch.status]}
                          </span>
                        </div>
                      ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardSection>
      </div>
    </FadeIn>
  );
}
