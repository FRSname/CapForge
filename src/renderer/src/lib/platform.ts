/**
 * The renderer's platform check — the same `navigator.platform` test
 * `components/TitleBar/TitleBar.tsx` uses (no preload API exposes the
 * platform). Pure: the caller reads `navigator` and passes the string in, so
 * the node-environment tests pin every answer.
 */

/**
 * True on macOS. The library asks because only macOS can show one native
 * dialog that picks files and folders together; Electron shows a folder
 * picker for that combination on Windows and Linux.
 */
export function isMacPlatform(platform: string | null | undefined): boolean {
  return typeof platform === 'string' && platform.startsWith('Mac')
}
