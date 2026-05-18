import Decimal from "decimal.js"
import type { Diagnostic } from "../errors/diagnostic.ts"
import type { RangeValue } from "../eval/collection.ts"
import type { RunResult } from "../eval/evaluator.ts"
import type { PlotValue } from "../eval/plot.ts"
import {
  isBoolean,
  isPercent,
  isPlotValue,
  isRange,
  type Percent,
  type Value,
} from "../eval/value.ts"
import type { Quantity } from "../units/quantity.ts"
import { bold, gray, red, yellow } from "./color.ts"

export type Locale = {
  decimalSeparator: "," | "."
  /** Inserted between groups of 3 integer digits. "" disables grouping. */
  thousandsSeparator: string
}

export const DEFAULT_LOCALE: Locale = {
  decimalSeparator: ",",
  thousandsSeparator: " ",
}

/** Display precision for the result column; internal precision stays at 40. */
const DISPLAY_PLACES = 6

export function formatDecimal(d: Decimal, locale: Locale = DEFAULT_LOCALE): string {
  const rounded = d.toDecimalPlaces(DISPLAY_PLACES, Decimal.ROUND_HALF_EVEN)
  const str = rounded.toString()
  const negative = str.startsWith("-")
  const body = negative ? str.slice(1) : str
  const dotIdx = body.indexOf(".")
  const intPart = dotIdx === -1 ? body : body.slice(0, dotIdx)
  const fracPart = dotIdx === -1 ? "" : body.slice(dotIdx + 1)
  const groupedInt = groupThousands(intPart, locale.thousandsSeparator)
  const out =
    fracPart === ""
      ? groupedInt
      : `${groupedInt}${locale.decimalSeparator}${fracPart}`
  return negative ? `-${out}` : out
}

function groupThousands(intPart: string, sep: string): string {
  if (sep === "" || intPart.length <= 3) return intPart
  const groups: string[] = []
  let i = intPart.length
  while (i > 3) {
    groups.unshift(intPart.slice(i - 3, i))
    i -= 3
  }
  groups.unshift(intPart.slice(0, i))
  return groups.join(sep)
}

export function formatQuantity(q: Quantity, locale: Locale = DEFAULT_LOCALE): string {
  const v = formatDecimal(q.value, locale)
  return q.unit ? `${v} ${q.unit.name}` : v
}

export function formatRange(r: RangeValue, locale: Locale = DEFAULT_LOCALE): string {
  const sep = r.inclusive ? ".." : "..."
  const start = formatQuantity(r.start, locale)
  const end = formatQuantity(r.end, locale)
  const step = r.step.eq(1) ? "" : `/${formatDecimal(r.step, locale)}`
  return `${start}${sep}${end}${step} (n=${r.members.length})`
}

export function formatPercent(p: Percent, locale: Locale = DEFAULT_LOCALE): string {
  // Internal fraction (0,20) → displayed percentage (20%). The trailing
  // '%' is part of the value, not a separator.
  return `${formatDecimal(p.value.times(100), locale)}%`
}

export function formatPlot(p: PlotValue): string {
  const n = p.shapes.length
  return `plot (${n} shape${n === 1 ? "" : "s"})`
}

export function formatValue(
  v: Value,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (isBoolean(v)) return v ? "true" : "false"
  if (isRange(v)) return formatRange(v, locale)
  if (isPercent(v)) return formatPercent(v, locale)
  if (isPlotValue(v)) return formatPlot(v)
  return formatQuantity(v, locale)
}

/**
 * Right-side annotation for a statement, used in the file-mode output. Returns
 * null when no annotation should be shown (declarations, blank lines).
 */
export function annotation(
  r: RunResult,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (r.error) {
    const hint = r.error.hint ? ` (${r.error.hint})` : ""
    return red(`// error: ${r.error.message}${hint}`)
  }
  if (r.value === null) return null
  switch (r.stmt.type) {
    case "unitDecl":
    case "seriesDecl":
    case "functionDecl":
    case "rangeDecl":
      return null
    case "plotDecl":
    case "variableDecl":
    case "exprAssignment":
    case "exprStatement":
      return `// = ${formatValue(r.value, locale)}`
  }
}

/**
 * Concise per-result rendering for the REPL: '= value' or 'error: …', no
 * prefix slashes (the user's input is right above on the prompt line).
 */
export function replLine(
  r: RunResult,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (r.error) {
    const hint = r.error.hint ? ` (${r.error.hint})` : ""
    return red(`error: ${r.error.message}${hint}`)
  }
  if (r.value === null) return null
  switch (r.stmt.type) {
    case "unitDecl":
    case "seriesDecl":
    case "functionDecl":
    case "rangeDecl":
      return null
    case "plotDecl":
    case "variableDecl":
    case "exprAssignment":
    case "exprStatement":
      return `= ${formatValue(r.value, locale)}`
  }
}

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

/**
 * Colored single-line rendering of a Diagnostic for terminal output. Plain
 * `formatDiagnostic` from src/errors/diagnostic.ts is still available for
 * machine-readable contexts.
 */
export function formatDiagnosticColored(
  d: Diagnostic,
  sourceName = "<input>",
): string {
  const location = gray(`${sourceName}:${d.line}:${d.col}:`)
  const sev = d.severity === "error" ? red(`${d.severity}:`) : yellow(`${d.severity}:`)
  const head = `${location} ${sev} ${bold(d.message)}`
  return d.hint ? `${head}\n  ${gray("hint:")} ${d.hint}` : head
}
