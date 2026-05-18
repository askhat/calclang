import { type EditorState, RangeSetBuilder } from "@codemirror/state"
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view"
import Decimal from "decimal.js"
import type { RunResult } from "../src/eval/evaluator.ts"
import { isQuantity } from "../src/eval/value.ts"
import { formatValue } from "../src/format/output.ts"
import {
  type EngineRun,
  isQuantityValue,
  resultByLine,
} from "./calc-engine.ts"
import { engineState, snapshotState } from "./state.ts"

class ResultWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly kind: "ok" | "error" | "up" | "down",
    private readonly delta: string | null,
  ) {
    super()
  }

  override eq(other: ResultWidget): boolean {
    return (
      other.text === this.text &&
      other.kind === this.kind &&
      other.delta === this.delta
    )
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span")
    span.className = `cm-result cm-result-${this.kind}`
    span.textContent = this.text
    if (this.delta) {
      const delta = document.createElement("span")
      delta.className = "cm-result-delta"
      delta.textContent = this.delta
      span.appendChild(delta)
    }
    return span
  }

  override ignoreEvent(): boolean {
    return false
  }
}

function describeDelta(
  current: RunResult,
  previous: RunResult | undefined,
): { kind: "ok" | "up" | "down"; delta: string | null } {
  if (!previous || !isQuantityValue(current) || !isQuantityValue(previous)) {
    return { kind: "ok", delta: null }
  }
  // Only compare if units match (else "delta" is nonsensical).
  const cu = current.value.unit?.name
  const pu = previous.value.unit?.name
  if (cu !== pu) return { kind: "ok", delta: null }
  const cmp = current.value.value.cmp(previous.value.value)
  if (cmp === 0) return { kind: "ok", delta: null }
  const diff = current.value.value.minus(previous.value.value)
  const sign = cmp > 0 ? "▲" : "▼"
  const rounded = diff.abs().toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toString()
  return {
    kind: cmp > 0 ? "up" : "down",
    delta: `${sign} ${rounded.replace(".", ",")}`,
  }
}

function formatResultText(r: RunResult): string | null {
  if (r.error) {
    const hint = r.error.hint ? ` (${r.error.hint})` : ""
    return `error: ${r.error.message}${hint}`
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
      return `= ${formatValue(r.value)}`
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const run = state.field(engineState)
  const snapshot = state.field(snapshotState)
  const previousByLine = snapshot ? resultByLine(snapshot) : null
  const builder = new RangeSetBuilder<Decoration>()
  for (const r of run.results) {
    const text = formatResultText(r)
    if (text === null) continue
    const line = state.doc.line(r.stmt.pos.line)
    let kind: "ok" | "error" | "up" | "down" = r.error ? "error" : "ok"
    let delta: string | null = null
    if (!r.error && previousByLine) {
      const before = previousByLine.get(r.stmt.pos.line)
      const d = describeDelta(r, before)
      kind = d.kind === "ok" ? "ok" : d.kind
      delta = d.delta
    }
    builder.add(
      line.to,
      line.to,
      Decoration.widget({
        widget: new ResultWidget(text, kind, delta),
        side: 1,
      }),
    )
  }
  return builder.finish()
}

export const resultsExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state)
    }
    update(update: ViewUpdate) {
      // Re-render decorations whenever the engine or snapshot state changes,
      // or the doc/viewport shifts — not on selection-only updates.
      const engChanged =
        update.startState.field(engineState) !==
        update.state.field(engineState)
      const snapChanged =
        update.startState.field(snapshotState) !==
        update.state.field(snapshotState)
      if (update.docChanged || update.viewportChanged || engChanged || snapChanged) {
        this.decorations = buildDecorations(update.state)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

// Re-export so the plugin module can be self-contained.
export type { EngineRun } from "./calc-engine.ts"
export { isQuantity }
