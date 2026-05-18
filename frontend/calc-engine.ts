import type { Diagnostic } from "../src/errors/diagnostic.ts"
import type { RangeValue } from "../src/eval/collection.ts"
import {
  Evaluator,
  computeAggregate,
  type RunResult,
} from "../src/eval/evaluator.ts"
import { isQuantity, type Value } from "../src/eval/value.ts"
import { tokenize } from "../src/lexer/lexer.ts"
import { parseProgram } from "../src/parser/parser.ts"
import type { Quantity } from "../src/units/quantity.ts"
import type { Unit } from "../src/units/unit.ts"

export type SeriesSummary = {
  name: string
  count: number
  /** null when the series is empty (no members to aggregate). */
  sum: Quantity | null
  avg: Quantity | null
  min: Quantity | null
  max: Quantity | null
}

export type RangeSummary = {
  name: string
  /** Source endpoints, for display ("1..10", "1...10"). */
  start: Quantity
  end: Quantity
  inclusive: boolean
  count: number
  sum: Quantity | null
  avg: Quantity | null
  min: Quantity | null
  max: Quantity | null
}

export type FunctionSummary = {
  name: string
  params: string[]
}

export type EngineRun = {
  source: string
  results: RunResult[]
  lexDiagnostics: Diagnostic[]
  parseDiagnostics: Diagnostic[]
  evalDiagnostics: Diagnostic[]
  /** All diagnostics, ordered by position, deduplicated by (line, col, message). */
  allDiagnostics: Diagnostic[]
  /** Ready variables for sidebar (name → value). */
  variables: Array<{ name: string; value: Value }>
  /** Registered units for sidebar. */
  units: Unit[]
  /** Ready series for sidebar. */
  series: SeriesSummary[]
  /** Ready ranges for sidebar. */
  ranges: RangeSummary[]
  /** Declared functions for sidebar. */
  functions: FunctionSummary[]
}

/**
 * Runs the full pipeline on a source string. Pure — no DOM, no side effects.
 * Catches unexpected exceptions defensively (in case a bug in the engine
 * would otherwise blank the page).
 */
export function runPipeline(source: string): EngineRun {
  try {
    const { tokens, diagnostics: lexDiagnostics } = tokenize(source)
    const { program, diagnostics: parseDiagnostics } = parseProgram(tokens)
    const ev = new Evaluator()
    const results = ev.feed(program)
    const evalDiagnostics = [...ev.diagnostics]

    const variables: EngineRun["variables"] = []
    for (const [name, value] of ev.readyVariables()) {
      variables.push({ name, value })
    }

    const units = [...ev.registry.all()]

    const aggregatePos = { line: 0, col: 0 }
    const aggregateOf =
      <T extends { members: readonly Quantity[] }>(value: T) =>
      (method: "sum" | "avg" | "min" | "max"): Quantity | null => {
        if (value.members.length === 0) return null
        try {
          const v = computeAggregate(value as never, method, aggregatePos)
          return isQuantity(v) ? v : null
        } catch {
          return null
        }
      }

    const series: SeriesSummary[] = []
    for (const [name, value] of ev.readySeries()) {
      const agg = aggregateOf(value)
      series.push({
        name,
        count: value.members.length,
        sum: agg("sum"),
        avg: agg("avg"),
        min: agg("min"),
        max: agg("max"),
      })
    }

    const ranges: RangeSummary[] = []
    for (const [name, value] of ev.readyRanges()) {
      const agg = aggregateOf(value)
      ranges.push({
        name,
        start: value.start,
        end: value.end,
        inclusive: value.inclusive,
        count: value.members.length,
        sum: agg("sum"),
        avg: agg("avg"),
        min: agg("min"),
        max: agg("max"),
      })
    }

    const functions: FunctionSummary[] = []
    for (const fn of ev.functions()) {
      functions.push({ name: fn.name, params: fn.params })
    }

    const allDiagnostics = dedupeAndSort([
      ...lexDiagnostics,
      ...parseDiagnostics,
      ...evalDiagnostics,
    ])

    return {
      source,
      results,
      lexDiagnostics,
      parseDiagnostics,
      evalDiagnostics,
      allDiagnostics,
      variables,
      units,
      series,
      ranges,
      functions,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      source,
      results: [],
      lexDiagnostics: [],
      parseDiagnostics: [],
      evalDiagnostics: [],
      allDiagnostics: [
        {
          severity: "error",
          message: `internal error: ${message}`,
          line: 1,
          col: 1,
        },
      ],
      variables: [],
      units: [],
      series: [],
      ranges: [],
      functions: [],
    }
  }
}

function dedupeAndSort(diags: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const d of diags) {
    const key = `${d.line}:${d.col}:${d.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  out.sort((a, b) => a.line - b.line || a.col - b.col)
  return out
}

// -- Result-by-line lookup helpers used by extensions --

export function resultByLine(run: EngineRun): Map<number, RunResult> {
  const map = new Map<number, RunResult>()
  for (const r of run.results) {
    map.set(r.stmt.pos.line, r)
  }
  return map
}

export function isQuantityValue(
  r: RunResult,
): r is RunResult & { value: Quantity } {
  return r.value !== null && isQuantity(r.value)
}
