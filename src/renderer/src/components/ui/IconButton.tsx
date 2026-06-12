/**
 * IconButton — wraps the existing .icon-btn class (28×28 square icon button,
 * globals.css). `aria-label` is required: icon-only buttons have no text for
 * assistive tech.
 */

import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
}

export function IconButton({ className, type = 'button', ...rest }: IconButtonProps) {
  return <button type={type} className={cn('icon-btn', className)} {...rest} />
}
