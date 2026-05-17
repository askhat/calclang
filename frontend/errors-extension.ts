import { linter, type Diagnostic as LintDiag } from "@codemirror/lint"
import type { EditorView } from "@codemirror/view"
import { engineState } from "./state.ts"

/**
 * Bridges Calc's Diagnostic list into CodeMirror's lint extension. Squiggles
 * are drawn under the column where the diagnostic points, spanning the
 * token-like neighborhood at that position.
 */
export const errorsExtension = linter((view: EditorView): LintDiag[] => {
  const run = view.state.field(engineState)
  const doc = view.state.doc
  const out: LintDiag[] = []
  for (const d of run.allDiagnostics) {
    if (d.line < 1 || d.line > doc.lines) continue
    const line = doc.line(d.line)
    // col is 1-based; clamp to within the line.
    const start = Math.min(line.from + d.col - 1, line.to)
    const end = endOfNeighborhood(doc.sliceString(start, line.to), start)
    out.push({
      from: start,
      to: end,
      severity: d.severity === "warning" ? "warning" : "error",
      message: d.hint ? `${d.message}\n${d.hint}` : d.message,
    })
  }
  return out
})

function endOfNeighborhood(text: string, start: number): number {
  // Pick the run of non-whitespace immediately following the position, or
  // a single char if we're sitting on whitespace.
  let i = 0
  while (i < text.length && !/[\s()]/.test(text[i]!)) i++
  return start + Math.max(i, 1)
}
