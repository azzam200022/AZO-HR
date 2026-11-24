import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export default function PublicLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-svh bg-slate-50 px-4 py-10" dir="rtl">
      <article className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
        <p className="text-xs font-bold tracking-widest text-teal-700">AZO HR</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900" data-testid="public-page-title">
          {title}
        </h1>
        <div className="mt-6 space-y-6 text-sm leading-7 text-slate-700">{children}</div>
        <nav className="mt-10 flex flex-wrap gap-4 border-t border-slate-100 pt-5 text-xs font-semibold text-teal-700">
          <Link to="/" data-testid="public-home-link">العودة إلى التطبيق</Link>
          <Link to="/privacy" data-testid="public-privacy-link">سياسة الخصوصية</Link>
          <Link to="/delete-account" data-testid="public-delete-link">حذف الحساب</Link>
        </nav>
      </article>
    </div>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-bold text-slate-900 md:text-lg">{heading}</h2>
      {children}
    </section>
  );
}
