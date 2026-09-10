/**
 * Komponenty interfejsu — mały, spójny zestaw elementów.
 * Server Components: brak zbędnego JS po stronie klienta.
 */
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { clsx } from 'clsx';

// --- Przyciski -------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
};

export function Button({
  variant = 'primary',
  size,
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: 'sm' | 'lg' }) {
  return (
    <button
      {...props}
      className={clsx(VARIANTS[variant], size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', className)}
    />
  );
}

export function ButtonLink({
  variant = 'primary',
  size,
  className,
  href,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: 'sm' | 'lg'; href: string }) {
  return (
    <Link
      {...props}
      href={href}
      className={clsx(VARIANTS[variant], size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', className)}
    />
  );
}

// --- Karty -----------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card', className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card-header">
      <div>
        <h2 className="section-title">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card-body', className)}>{children}</div>;
}

// --- Odznaki ---------------------------------------------------------------

const BADGE_TONES = {
  neutral: 'bg-ink-100 text-ink-700',
  info: 'bg-brand-50 text-brand-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
  purple: 'bg-violet-50 text-violet-700',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={clsx('badge', BADGE_TONES[tone], className)}>{children}</span>;
}

// --- Pola formularzy -------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  required,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('field', className)}>
      {label ? (
        <label className="label">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {hint && !error ? <p className="hint">{hint}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={clsx('input', className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={clsx('input min-h-[92px]', className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select {...props} className={clsx('input bg-white', className)}>
      {children}
    </select>
  );
}

// --- Komunikaty ------------------------------------------------------------

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
  } as const;
  return (
    <div className={clsx('rounded-lg border px-4 py-3 text-sm', tones[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon ? <div className="rounded-full bg-ink-100 p-3 text-ink-500">{icon}</div> : null}
      <div>
        <p className="font-medium text-ink-800">{title}</p>
        {description ? <p className="mt-1 max-w-md text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

// --- Statystyki ------------------------------------------------------------

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const toneClass = {
    neutral: 'text-ink-900',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    info: 'text-brand-600',
  }[tone];
  return (
    <div className="card px-5 py-4">
      <p className="stat-label">{label}</p>
      <p className={clsx('stat-value mt-1 tabular', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

// --- Sekcje ----------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumbs ? <div className="mb-2 text-xs text-ink-500">{breadcrumbs}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {description ? <p className="mt-1 text-sm text-ink-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
