import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:brightness-110 disabled:opacity-60",
  secondary: "bg-surface border border-border text-foreground hover:bg-neutral-50 disabled:opacity-60",
  ghost: "text-foreground hover:bg-neutral-100",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:opacity-60",
};
const btn = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(btn, variants[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(btn, variants[variant], className)} {...props} />;
}

export function Field({
  label,
  name,
  error,
  hint,
  className,
  ...props
}: ComponentProps<"input"> & { label: string; name: string; error?: string; hint?: ReactNode }) {
  const id = props.id ?? name;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cx(
          "block w-full min-w-0 rounded-lg border bg-surface px-3 py-2.5 text-base sm:text-sm outline-none transition focus:ring-2 focus:ring-brand/30",
          // Native date pickers (Safari especially) keep a narrow intrinsic width and center or
          // clip the value: make them a normal full-width, left-aligned box with room for "November 20, 2026".
          props.type === "date" && "min-h-11 min-w-48 appearance-none text-left [&::-webkit-date-and-time-value]:text-left",
          error ? "border-red-500" : "border-border focus:border-brand",
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border border-border bg-surface", className)} {...props} />;
}

export function Alert({ tone = "error", children }: { tone?: "error" | "info" | "success"; children: ReactNode }) {
  const tones = {
    error: "border-red-200 bg-red-50 text-red-800",
    info: "border-blue-200 bg-blue-50 text-blue-900",
    success: "border-green-200 bg-green-50 text-green-900",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-lg border px-3 py-2.5 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("font-semibold tracking-tight", className)}>
      sign<span className="text-brand">file</span>
    </span>
  );
}
