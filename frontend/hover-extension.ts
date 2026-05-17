import type { EditorView } from "@codemirror/view"
import { hoverTooltip } from "@codemirror/view"
import * as Dim from "../src/units/dimension.ts"
import { formatValue } from "../src/format/output.ts"
import { engineState } from "./state.ts"

/**
 * Hover an identifier to see its current value (for variables) or dimension
 * + factor (for units). Word boundaries are detected with a simple regex,
 * matching the lexer's identifier rule.
 */
export const hoverExtension = hoverTooltip(
  (view: EditorView, pos: number, side: -1 | 1) => {
    const word = wordAt(view, pos, side)
    if (!word) return null

    const run = view.state.field(engineState)
    const unit = run.units.find((u) => u.name === word.text)
    const variable = run.variables.find((v) => v.name === word.text)

    if (!unit && !variable) return null

    return {
      pos: word.from,
      end: word.to,
      above: true,
      create: () => {
        const dom = document.createElement("div")
        dom.className = "calc-hover"
        if (variable) {
          const title = document.createElement("div")
          title.className = "hover-title"
          title.textContent = `variable ${variable.name}`
          dom.appendChild(title)
          const value = document.createElement("div")
          value.className = "hover-line hover-value"
          value.textContent = formatValue(variable.value)
          dom.appendChild(value)
        }
        if (unit) {
          if (variable) {
            const sep = document.createElement("div")
            sep.className = "hover-line"
            sep.textContent = "—"
            dom.appendChild(sep)
          }
          const title = document.createElement("div")
          title.className = "hover-title"
          title.textContent = `unit ${unit.name}`
          dom.appendChild(title)
          const dim = document.createElement("div")
          dim.className = "hover-line"
          dim.textContent = `dimension: ${Dim.format(unit.dimension)}`
          dom.appendChild(dim)
          const factor = document.createElement("div")
          factor.className = "hover-line"
          factor.textContent = `factor: ${unit.factor.toString()}`
          dom.appendChild(factor)
        }
        return { dom }
      },
    }
  },
  { hoverTime: 250 },
)

function wordAt(view: EditorView, pos: number, side: -1 | 1):
  | { from: number; to: number; text: string }
  | null {
  const line = view.state.doc.lineAt(pos)
  const text = line.text
  const localPos = pos - line.from
  // Identifier characters: [A-Za-z0-9_]
  const re = /[A-Za-z_][A-Za-z0-9_]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index
    const end = start + m[0].length
    // Allow boundary hover (side -1 = before pos, side 1 = after)
    if (start <= localPos && localPos <= end) {
      // When hovering exactly at a boundary, side disambiguates.
      if (localPos === end && side === 1) continue
      if (localPos === start && side === -1) continue
      return { from: line.from + start, to: line.from + end, text: m[0] }
    }
  }
  return null
}
