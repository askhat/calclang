import type { Diagnostic } from "../src/errors/diagnostic.ts"
import { Evaluator, type RunResult } from "../src/eval/evaluator.ts"
import { isQuantity } from "../src/eval/value.ts"
import { tokenize } from "../src/lexer/lexer.ts"
import { parseProgram } from "../src/parser/parser.ts"
import type { Quantity } from "../src/units/quantity.ts"
import type { Unit } from "../src/units/unit.ts"

export type SeriesSummary = {
  name: string
  count: number
  /** Same unit as `count.unit` for display (null = dimensionless). */
  sumUnit: string | null
}

export type EngineRun = {
  source: string
  results: RunResult[]
  lexDiagnostics: Diagnostic[]
  parseDiagnostics: Diagnostic[]
  evalDiagnostics: Diagnostic[]
  /** All diagnostics, ordered by position, deduplicated by (line, col, message). */
  allDiagnostics: Diagnostic[]
  /** Ready variables for sidebar (name → quantity or boolean). */
  variables: Array<{ name: string; value: Quantity | boolean }>
  /** Registered units for sidebar. */
  units: Unit[]
  /** Ready series for sidebar. */
  series: SeriesSummary[]
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

    const series: SeriesSummary[] = []
    for (const [name, value] of ev.readySeries()) {
      const first = value.members[0]
      series.push({
        name,
        count: value.members.length,
        sumUnit: first?.unit?.name ?? null,
      })
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
