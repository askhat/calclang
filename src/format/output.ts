import Decimal from "decimal.js"
import type { RunResult } from "../eval/evaluator.ts"
import { isBoolean, isQuantity } from "../eval/value.ts"
import type { Quantity } from "../units/quantity.ts"

export type Locale = {
  decimalSeparator: "," | "."
}

export const DEFAULT_LOCALE: Locale = { decimalSeparator: "," }

/** Display precision for the result column. Internally values keep full Decimal precision. */
const DISPLAY_PLACES = 6

export function formatDecimal(d: Decimal, locale: Locale = DEFAULT_LOCALE): string {
  const rounded = d.toDecimalPlaces(DISPLAY_PLACES, Decimal.ROUND_HALF_EVEN)
  const str = rounded.toString()
  return locale.decimalSeparator === ","
    ? str.replace(".", ",")
    : str
}

export function formatQuantity(q: Quantity, locale: Locale = DEFAULT_LOCALE): string {
  const v = formatDecimal(q.value, locale)
  return q.unit ? `${v} ${q.unit.name}` : v
}

export function formatValue(
  v: boolean | Quantity,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (typeof v === "boolean") return v ? "true" : "false"
  return formatQuantity(v, locale)
}

/**
 * Returns the right-side annotation for a statement's result, or null when
 * no annotation should be shown (declarations, blank lines).
 */
export function annotation(
  r: RunResult,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (r.error) {
    const hint = r.error.hint ? ` (${r.error.hint})` : ""
    return `// error: ${r.error.message}${hint}`
  }
  if (r.value === null) return null
  switch (r.stmt.type) {
    case "unitDecl":
      return null
    case "variableDecl":
    case "exprAssignment":
    case "exprStatement":
      return `// = ${formatValue(r.value, locale)}`
  }
}

/**
 * Re-prints the source file with result annotations appended to the lines
 * that produced values. Empty lines and comment-only lines pass through.
 */
export function annotateSource(
  source: string,
  results: readonly RunResult[],
  locale: Locale = DEFAULT_LOCALE,
  minColumn = 50,
): string {
  const byLine = new Map<number, string>()
  for (const r of results) {
    const a = annotation(r, locale)
    if (a !== null) byLine.set(r.stmt.pos.line, a)
  }
  const lines = source.split("\n")
  return lines
    .map((line, i) => {
      const annot = byLine.get(i + 1)
      if (!annot) return line
      const padded = line.length < minColumn ? line.padEnd(minColumn) : `${line}  `
      return `${padded}${annot}`
    })
    .join("\n")
}
