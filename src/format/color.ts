/**
 * Tiny ANSI color helpers. Honors NO_COLOR (https://no-color.org/) and
 * FORCE_COLOR conventions; otherwise enables color only on a TTY stdout.
 * In `bun test` stdout is not a TTY, so test assertions see plain strings.
 */

const useColor: boolean = (() => {
  // In the browser there's no `process`; color codes would just clutter
  // the DOM since we style via CSS classes, so disabling here is correct.
  if (typeof process === "undefined") return false
  if (process.env?.["NO_COLOR"]) return false
  if (process.env?.["FORCE_COLOR"]) return true
  return Boolean(process.stdout?.isTTY)
})()

function wrap(text: string, code: number): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text
}

export const red = (s: string) => wrap(s, 31)
export const green = (s: string) => wrap(s, 32)
export const yellow = (s: string) => wrap(s, 33)
export const cyan = (s: string) => wrap(s, 36)
export const gray = (s: string) => wrap(s, 90)
export const bold = (s: string) => wrap(s, 1)
