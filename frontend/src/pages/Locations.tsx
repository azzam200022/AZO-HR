import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crosshair, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { errorText, formatNumber } from "@/lib/format";
import type { WorkLocation } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ConfirmDeleteDialog,
  EmptyState,
  FadeIn,
  LoadingBlock,
  PageHeader,
} from "@/components/shared";

interface LocationForm {
  name: string;
  latitude: string;
  longitude: string;
  radius_m: string;
}

const EMPTY_FORM: LocationForm = { name: "", latitude: "", longitude: "", radius_m: "150" };

export default function Locations() {
  const queryClient = useQueryClient();
  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["locations"],
    queryFn: () => apiGet<WorkLocation[]>("/locations"),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkLocation | null>(null);
  const [form, setForm] = useState<LocationForm>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<WorkLocation | null>(null);
  const [locating, setLocating] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (payload: LocationForm) => {
      const body = {
        name: payload.name,
        latitude: Number(payload.latitude),
        longitude: Number(payload.longitude),
        radius_m: Number(payload.radius_m) || 150,
      };
      return editing
        ? apiPut<WorkLocation>(`/locations/${editing.id}`, body)
        : apiPost<WorkLocation>("/locations", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setDialogOpen(false);
      toast.success(editing ? "تم تحديث موقع العمل" : "تمت إضافة موقع العمل");
      setEditing(null);
      setForm(EMPTY_FORM);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/locations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setDeleting(null);
      toast.success("تم حذف الموقع وإلغاء ربطه بالموظفين");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const position = Capacitor.isNativePlatform()
        ? await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 10_000,
          })
        : await new Promise<GeolocationPosition>((resolve, reject) => {
            if (!navigator.geolocation) {
              reject(new Error("المتصفح لا يدعم تحديد الموقع الجغرافي"));
              return;
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10_000,
            });
          });

      setForm((f) => ({
        ...f,
        latitude: position.coords.latitude.toFixed(6),
        longitude: position.coords.longitude.toFixed(6),
      }));
      toast.success("تم جلب إحداثيات موقعك الحالي");
    } catch (error) {
      const code = (error as { code?: number | string } | null)?.code;
      if (code === 1 || code === "OS-PLUG-GLOC-0003") {
        toast.error("لم يتم منح إذن الموقع. اسمح لتطبيق AZO HR بالوصول للموقع من إعدادات الجهاز.");
      } else if (code === "OS-PLUG-GLOC-0007") {
        toast.error("خدمات الموقع متوقفة. فعّل الموقع (GPS) ثم أعد المحاولة.");
      } else {
        toast.error("تعذر تحديد موقعك. تحقق من تشغيل GPS ومنح إذن الموقع.");
      }
    } finally {
      setLocating(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (loc: WorkLocation) => {
    setEditing(loc);
    setForm({
      name: loc.name,
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
      radius_m: String(loc.radius_m),
    });
    setDialogOpen(true);
  };

  const submit = () => {
    if (!form.name.trim()) {
      toast.error("اسم الموقع مطلوب");
      return;
    }
    if (
      form.latitude === "" ||
      form.longitude === "" ||
      Number.isNaN(Number(form.latitude)) ||
      Number.isNaN(Number(form.longitude))
    ) {
      toast.error("أدخل إحداثيات صحيحة (خط العرض والطول)");
      return;
    }
    saveMutation.mutate(form);
  };

  return (
    <FadeIn>
      <PageHeader
        title="مواقع العمل"
        description="النطاقات الجغرافية التي يُسمح للموظفين بتسجيل الحضور داخلها فقط."
        testid="locations-title"
        action={
          <Button onClick={openAdd} data-testid="add-location-btn">
            <Plus className="h-4 w-4" />
            إضافة موقع
          </Button>
        }
      />

      {isLoading ? (
        <LoadingBlock className="h-64" />
      ) : locations.length === 0 ? (
        <EmptyState
          title="لا توجد مواقع عمل"
          description="أضف موقعاً واربطه بالموظفين لتقييد التسجيل جغرافياً."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموقع</TableHead>
                <TableHead>الإحداثيات</TableHead>
                <TableHead>نطاق السماح</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((loc) => (
                <TableRow key={loc.id} data-testid={`location-row-${loc.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                        <MapPin className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{loc.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600" dir="ltr">
                    {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-slate-600">
                    {formatNumber(loc.radius_m)} متر
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openEdit(loc)}
                        data-testid={`edit-location-btn-${loc.id}`}
                        title="تعديل"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setDeleting(loc)}
                        data-testid={`delete-location-btn-${loc.id}`}
                        title="حذف"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `تعديل الموقع: ${editing.name}` : "إضافة موقع عمل"}</DialogTitle>
            <DialogDescription>
              يُسمح للموظفين المرتبطين بهذا الموقع بتسجيل الحضور داخل نطاقه فقط.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="loc-name">اسم الموقع *</Label>
              <Input
                id="loc-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثال: المقر الرئيسي"
                data-testid="location-name-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="loc-lat">خط العرض *</Label>
                <Input
                  id="loc-lat"
                  type="number"
                  step="any"
                  value={form.latitude}
                  onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                  placeholder="24.7136"
                  data-testid="location-lat-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loc-lng">خط الطول *</Label>
                <Input
                  id="loc-lng"
                  type="number"
                  step="any"
                  value={form.longitude}
                  onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                  placeholder="46.6753"
                  data-testid="location-lng-input"
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={useMyLocation}
              disabled={locating}
              data-testid="use-my-location-btn"
            >
              <Crosshair className="h-4 w-4" />
              {locating ? "جارٍ تحديد موقعك…" : "استخدم موقعي الحالي"}
            </Button>
            <div className="space-y-2">
              <Label htmlFor="loc-radius">نطاق السماح (متر)</Label>
              <Input
                id="loc-radius"
                type="number"
                min={10}
                value={form.radius_m}
                onChange={(e) => setForm({ ...form, radius_m: e.target.value })}
                data-testid="location-radius-input"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="location-cancel-btn">
              إلغاء
            </Button>
            <Button onClick={submit} disabled={saveMutation.isPending} data-testid="location-save-btn">
              {editing ? "حفظ التعديلات" : "إضافة الموقع"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`حذف الموقع: ${deleting?.name ?? ""}`}
        description="سيُلغى ربط هذا الموقع بالموظفين وسيتسنى لهم التسجيل دون تقييد جغرافي."
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        testId="confirm-delete-location-btn"
      />
    </FadeIn>
  );
}