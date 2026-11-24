import { MapPin, BellRing, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

const POINTS = [
  {
    icon: MapPin,
    text: "يجمع AZO HR موقعك الجغرافي لتسجيل الحضور والانصراف والتحقق من وجودك في موقع العمل أثناء الدوام، حتى عندما يكون التطبيق مغلقًا أو غير مستخدم.",
  },
  {
    icon: BellRing,
    text: "يبدأ التتبع فقط بعد تسجيل حضورك ويتوقف عند الانصراف، ويظهر إشعار دائم طوال مدة التتبع.",
  },
  {
    icon: ShieldCheck,
    text: "يُرسل الموقع إلى جهة عملك فقط، ولا يُباع ولا يُستخدم للإعلانات. يمكنك إيقاف التتبع في أي وقت من ملفك الشخصي.",
  },
];

export function LocationDisclosureDialog({
  open,
  onAccept,
  onDecline,
}: {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDecline()}>
      <DialogContent className="max-w-md" dir="rtl" data-testid="location-disclosure-dialog">
        <DialogTitle>استخدام موقعك أثناء الدوام</DialogTitle>
        <DialogDescription>قبل أن نطلب إذن الموقع، إليك ما نجمعه ولماذا.</DialogDescription>
        <ul className="space-y-3">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-3 text-sm leading-6 text-slate-700">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700">
                <Icon className="h-4 w-4" />
              </span>
              {text}
            </li>
          ))}
        </ul>
        <Link
          to="/privacy"
          className="text-xs font-semibold text-teal-700 underline-offset-4 hover:underline"
          data-testid="location-disclosure-privacy-link"
        >
          اقرأ سياسة الخصوصية كاملة
        </Link>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDecline} data-testid="location-disclosure-decline-btn">
            ليس الآن
          </Button>
          <Button type="button" onClick={onAccept} data-testid="location-disclosure-accept-btn">
            موافق، متابعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
