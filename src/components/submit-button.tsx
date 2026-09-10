'use client';

import { useFormStatus } from 'react-dom';
import { clsx } from 'clsx';
import type { ComponentProps, ReactNode } from 'react';

type Props = ComponentProps<'button'> & {
  children: ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'lg';
  className?: string;
  confirm?: string;
};

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
} as const;

/**
 * Przycisk submit z obsługą stanu „w trakcie” (useFormStatus).
 *dzięki temu użytkownik widzi, że operacja trwa — a przycisk nie daje
 * fałszywego poczucia sukcesu.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  size,
  className,
  confirm,
  ...props
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) {
          event.preventDefault();
        }
      }}
      className={clsx(VARIANTS[variant], size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', className)}
    >
      {pending ? (pendingLabel ?? 'Przetwarzanie…') : children}
    </button>
  );
}
