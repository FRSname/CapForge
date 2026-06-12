/** Join class names, skipping falsy values. Tiny local alternative to clsx. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
