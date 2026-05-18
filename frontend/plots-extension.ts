import {
  type Extension,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state"
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view"
import type { PlotValue } from "../src/eval/plot.ts"
import { renderPlotSVG } from "./plot-svg.ts"
import { engineState } from "./state.ts"

class PlotWidget extends WidgetType {
  constructor(
    private readonly plot: PlotValue,
    private readonly key: string,
  ) {
    super()
  }

  override eq(other: PlotWidget): boolean {
    return other.key === this.key
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div")
    container.className = "cm-plot-widget"
    if (this.plot.shapes.length === 0) {
      const empty = document.createElement("div")
      empty.className = "cm-plot-empty"
      empty.textContent = "(empty plot)"
      container.appendChild(empty)
      return container
    }
    container.appendChild(renderPlotSVG(this.plot))
    return container
  }

  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * Build a stable identity key for a plot — used for `eq()` so CM doesn't
 * rebuild the SVG on every keystroke when the value is unchanged.
 */
function plotKey(name: string, plot: PlotValue): string {
  const parts = plot.shapes.map((s) => {
    switch (s.kind) {
      case "line":
        return `L${s.x1}|${s.y1}|${s.x2}|${s.y2}`
      case "rect":
        return `R${s.x}|${s.y}|${s.w}|${s.h}`
      case "circle":
        return `C${s.cx}|${s.cy}|${s.r}`
      case "point":
        return `P${s.x}|${s.y}`
    }
  })
  return `${name}::${parts.join(",")}`
}

function buildDecorations(state: {
  doc: { line: (n: number) => { to: number }; lines: number }
  field: <T>(f: StateField<T>) => T
}): DecorationSet {
  const run = state.field(engineState)
  // Defensive: a stale dev-server bundle may hand us a run without `plots`.
  if (!run.plots || run.plots.length === 0) return Decoration.none

  const lineByName = new Map<string, number>()
  for (const r of run.results) {
    if (r.stmt.type === "plotDecl") {
      lineByName.set(r.stmt.name, r.stmt.pos.line)
    }
  }

  const entries: Array<{ line: number; plot: PlotValue; name: string }> = []
  for (const p of run.plots) {
    const line = lineByName.get(p.name)
    if (line === undefined) continue
    entries.push({ line, plot: p.value, name: p.name })
  }
  entries.sort((a, b) => a.line - b.line)

  const builder = new RangeSetBuilder<Decoration>()
  for (const { line, plot, name } of entries) {
    if (line < 1 || line > state.doc.lines) continue
    const lineObj = state.doc.line(line)
    builder.add(
      lineObj.to,
      lineObj.to,
      Decoration.widget({
        widget: new PlotWidget(plot, plotKey(name, plot)),
        block: true,
        side: 1,
      }),
    )
  }
  return builder.finish()
}

/**
 * Block widgets need to come from a StateField, not a ViewPlugin — CM
 * enforces that at runtime ("Block decorations may not be specified via
 * plugins"). The field re-derives the decoration set from engineState on
 * every transaction.
 */
const plotsField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state as never)
  },
  update(value, tr) {
    const prev = tr.startState.field(engineState)
    const next = tr.state.field(engineState)
    if (!tr.docChanged && prev === next) return value
    return buildDecorations(tr.state as never)
  },
  provide: (f) => EditorView.decorations.from(f),
})

export const plotsExtension: Extension = [plotsField]
