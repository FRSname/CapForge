/**
 * The pure half of `hooks/useConfirm.tsx`: what happens when a second confirm
 * is asked for while one is still on screen.
 *
 * Only one dialog is ever shown, so the older request has to be settled — as a
 * cancel, because the user never answered it. Deciding *which* request that is
 * lives here; actually resolving it stays with the provider, so this stays a
 * pure function with no side effects.
 */

export interface Pending<TOptions> {
  options: TOptions
  /** Settles the promise the caller of `confirm()` is awaiting. */
  resolve: (confirmed: boolean) => void
}

export interface QueuedRequest<TOptions> {
  /** The request that is now on screen. */
  pending: Pending<TOptions>
  /** The request it replaced, which the caller must settle as `false`. */
  superseded: Pending<TOptions> | null
}

export function queueRequest<TOptions>(
  pending: Pending<TOptions> | null,
  next: Pending<TOptions>
): QueuedRequest<TOptions> {
  return { pending: next, superseded: pending }
}
