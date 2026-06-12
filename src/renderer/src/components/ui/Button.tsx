/**
 * Button — thin wrapper over the existing CSS button classes in globals.css
 * (.btn-primary / .btn-ghost / .btn-danger / .titlebar-btn). Pixel-identical
 * to the raw <button className="btn-…"> usage it replaces; call sites keep
 * adding layout classes via className.
 */

import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'titlebar'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  titlebar: 'titlebar-btn',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** Disables the button and marks it busy for assistive tech. */
  loading?: boolean
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(VARIANT_CLASS[variant], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  )
}
