/**
 * Select — thin typed wrapper over the native <select className="field-input">
 * pattern. Keeps the native dropdown behavior; children are <option> elements.
 */

import type { SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={cn('field-input', className)} {...rest}>
      {children}
    </select>
  )
}
