import { keymap, type EditorView } from "@codemirror/view"
import Decimal from "decimal.js"

/**
 * Alt+↑ / Alt+↓ nudge the number under the cursor by the step appropriate
 * to its precision: `35,5` steps by `0,1`, `467,245543` by `0,000001`,
 * `1_000` by `1`. Underscores are preserved in the lexeme.
 */
export const numberNudgeKeymap = keymap.of([
  {
    key: "Alt-ArrowUp",
    run: (view) => nudge(view, +1),
  },
  {
    key: "Alt-ArrowDown",
    run: (view) => nudge(view, -1),
  },
])

function nudge(view: EditorView, direction: 1 | -1): boolean {
  const { state } = view
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  const localPos = pos - line.from
  const match = numberAt(line.text, localPos)
  if (!match) return false

  const stepped = bump(match.text, direction)
  if (stepped === null) return false

  view.dispatch({
    changes: {
      from: line.from + match.from,
      to: line.from + match.to,
      insert: stepped,
    },
    // Keep the cursor at the same relative spot inside the new number.
    selection: {
      anchor: line.from + match.from + Math.min(localPos - match.from, stepped.length),
    },
  })
  return true
}

function numberAt(
  text: string,
  pos: number,
): { from: number; to: number; text: string } | null {
  // Match the lexer's number shape (with either decimal separator), plus
  // an optional leading sign so MINUS NUMBER reads as a single -X.
  const re = /(?:^|[^A-Za-z0-9_])(-?\d[\d_]*(?:[,.]\d[\d_]*)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const lit = m[1]!
    const start = m.index + m[0].length - lit.length
    const end = start + lit.length
    if (pos >= start && pos <= end) return { from: start, to: end, text: lit }
  }
  return null
}

function bump(lexeme: string, direction: 1 | -1): string | null {
  const { sign, body, sep } = parseSign(lexeme)
  const dotIdx = body.indexOf(sep ?? ".")
  const fracLen = dotIdx === -1 ? 0 : body.length - dotIdx - 1 - (body.slice(dotIdx + 1).match(/_/g)?.length ?? 0)

  // Normalize to a Decimal value; strip underscores, swap decimal sep.
  const stripped = body.replaceAll("_", "")
  const dotted = sep === "," ? stripped.replace(",", ".") : stripped
  let value: Decimal
  try {
    value = new Decimal(`${sign}${dotted}`)
  } catch {
    return null
  }

  const step = new Decimal(10).pow(-fracLen)
  const next = value.plus(step.times(direction))

  return formatLike(next, lexeme, sep)
}

function parseSign(lex: string): { sign: "" | "-"; body: string; sep: "," | "." | null } {
  let i = 0
  let sign: "" | "-" = ""
  if (lex[0] === "-") {
    sign = "-"
    i = 1
  }
  const body = lex.slice(i)
  const sep = body.includes(",") ? "," : body.includes(".") ? "." : null
  return { sign, body, sep }
}

function formatLike(
  value: Decimal,
  template: string,
  sep: "," | "." | null,
): string {
  // We render to a fixed-decimal form, preserving the template's decimal
  // separator and (best-effort) underscore grouping in the integer part.
  const { sign: _sign, body } = parseSign(template)
  const dotIdx = body.indexOf(sep ?? ".")
  const fracLen = dotIdx === -1 ? 0 : body.length - dotIdx - 1 - (body.slice(dotIdx + 1).match(/_/g)?.length ?? 0)

  const fixed = value.toFixed(fracLen)
  const negative = fixed.startsWith("-")
  const absStr = negative ? fixed.slice(1) : fixed
  const [intPart, fracPart] = absStr.split(".")
  // Re-insert underscores in the integer part if the original had any.
  const underscored = templateUnderscores(intPart!, body, sep)
  const sepOut = sep ?? "."
  const result = fracPart
    ? `${underscored}${sepOut}${fracPart}`
    : underscored
  return negative ? `-${result}` : result
}

function templateUnderscores(
  intPart: string,
  template: string,
  sep: "," | "." | null,
): string {
  // If template has underscores in the integer portion, regroup to every-3
  // from the right; otherwise leave intPart alone.
  const tInt = sep === null ? template : template.slice(0, template.indexOf(sep))
  if (!tInt.includes("_")) return intPart
  // Insert _ every 3 digits from right
  const chars = [...intPart]
  for (let i = chars.length - 3; i > 0; i -= 3) chars.splice(i, 0, "_")
  return chars.join("")
}
