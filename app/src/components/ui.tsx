import type { ButtonHTMLAttributes, ReactNode } from "react";
import { SYNC_CLASS_INFO } from "../lib/policy";
import { syndromeLabel } from "../lib/tagger";
import type { SyncClass, SyncStatus } from "../lib/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Bi({ hi, en, className }: { hi: string; en: string; className?: string }) {
  return (
    <span className={cx("inline-flex flex-col leading-tight", className)}>
      <span>{hi}</span>
      <span className="text-[0.72em] font-normal opacity-70">{en}</span>
    </span>
  );
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cx("rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70", onClick && "cursor-pointer active:bg-slate-50", className)}
    >
      {children}
    </div>
  );
}

export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-600">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

type Tone = "teal" | "rose" | "amber" | "sky" | "slate" | "emerald" | "violet";
const TONES: Record<Tone, string> = {
  teal: "bg-teal-50 text-teal-800 ring-teal-200",
  rose: "bg-rose-50 text-rose-800 ring-rose-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  sky: "bg-sky-50 text-sky-800 ring-sky-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function Badge({ tone = "slate", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1", TONES[tone], className)}>{children}</span>;
}

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-teal-700 text-white active:bg-teal-800 disabled:bg-slate-300",
    secondary: "bg-white text-teal-800 ring-1 ring-teal-200 active:bg-teal-50 disabled:text-slate-400",
    danger: "bg-rose-600 text-white active:bg-rose-700 disabled:bg-slate-300",
    ghost: "text-teal-800 active:bg-teal-50",
  }[variant];
  return (
    <button {...props} className={cx("inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition", styles, className)}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid rounded-xl bg-slate-200/70 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx("min-h-10 rounded-lg px-2 text-sm font-medium", value === o.value ? "bg-white text-teal-800 shadow-sm" : "text-slate-600")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SyndromeBadges({ syndromes, danger }: { syndromes: string[]; danger?: boolean }) {
  if (!syndromes.length) return <Badge>सामान्य · routine</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {syndromes.map((s) => (
        <Badge key={s} tone={s.startsWith("danger") || danger ? "rose" : "amber"}>
          {syndromeLabel(s, "hi")}
        </Badge>
      ))}
    </span>
  );
}

export function SyncBadge({ cls, status }: { cls: SyncClass; status?: SyncStatus }) {
  const info = SYNC_CLASS_INFO[cls];
  const label = status === "synced" && cls !== "never" ? "भेजा गया · sent" : info.hi;
  return <Badge tone={status === "synced" ? "emerald" : (info.tone as Tone)}>{label}</Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: "rose" | "teal" | "amber" }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
      <div className={cx("text-2xl font-bold break-all", typeof value === "string" && value.length > 6 && "text-base", tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-700" : "text-teal-800")}>{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  );
}
