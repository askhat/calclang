import {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language"
import { tags as t } from "@lezer/highlight"

// Top-level uppercase keywords (case-sensitive). Lowercase forms are plain
// identifiers — `unit`, `series`, `fn`, etc. stay as variable names.
const KEYWORDS = new Set([
  "UNIT",
  "SERIES",
  "RANGE",
  "FN",
  "PLOT",
  "as",
  "of",
  "if",
  "then",
  "else",
  "and",
  "or",
  "not",
])

type State = {
  /** Tokens we've seen on the current line, for tagging variable names vs idents. */
  lineTokens: number
  /** Last non-trivia token kind (to distinguish e.g. unit suffix after a number). */
  lastWasNumber: boolean
  /**
   * Tracks whether we're inside a PLOT block. Set when `PLOT` keyword opens
   * a line; cleared at blank lines and when another top-level keyword starts
   * a line. Drives the "first IDENT on a line is an opcode" rule.
   */
  lastTopKeyword: "plot" | null
}

/**
 * Stream-based highlighter for Calc. Approximate vs. the full lexer — it
 * mirrors the same token shapes but discards positional state, since the
 * editor doesn't need diagnostics from it (those come from the real
 * pipeline via the lint extension).
 */
const calcStream = StreamLanguage.define<State>({
  name: "calc",

  startState: () => ({
    lineTokens: 0,
    lastWasNumber: false,
    lastTopKeyword: null,
  }),

  token(stream, state) {
    // Reset per-line state at the start of every line so opcode highlighting
    // and unit-suffix heuristics work line-by-line. lastTopKeyword persists
    // across lines so block content (after `PLOT name`) can be coloured.
    if (stream.sol()) {
      state.lineTokens = 0
      state.lastWasNumber = false
    }
    // Skip whitespace
    if (stream.eatSpace()) return null

    // Comments to end of line
    if (stream.match(/^#.*$/)) {
      return "lineComment"
    }

    // Numbers: digit (digit|_)* (,|.) (digit|_)+ — but the lexer is locale-aware;
    // here we accept both forms loosely. Includes negatives only mid-expression
    // (handled by the parser); here we just match the number body.
    if (stream.match(/^\d[\d_]*(?:[,.]\d[\d_]*)?/)) {
      state.lastWasNumber = true
      state.lineTokens++
      return "number"
    }

    // Identifiers / keywords
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
      const word = stream.current()
      const prevWasNumber = state.lastWasNumber
      const isFirst = state.lineTokens === 0
      state.lastWasNumber = false
      state.lineTokens++
      if (KEYWORDS.has(word)) {
        // Top-level statement keywords reset the block scope: PLOT opens
        // one, anything else (UNIT/SERIES/RANGE/FN) closes it.
        if (isFirst) {
          state.lastTopKeyword = word === "PLOT" ? "plot" : null
        }
        return "keyword"
      }
      // First IDENT on a line inside a PLOT block is an opcode (LINE, RECT,
      // CIRCLE, POINT, F, R, L, ...). One-liner `PLOT name ref` is harmless
      // here because `ref` isn't the first token on its line.
      if (isFirst && state.lastTopKeyword === "plot") {
        return "tagName"
      }
      // Heuristic: an identifier immediately after a number is the unit
      // suffix in primary / variable_decl. Tag it differently so unit
      // mentions visually pop.
      if (prevWasNumber) return "typeName"
      // Capitalized identifiers are dimension names (per the new grammar):
      // `UNIT Currency usd`, `UNIT Mass kg`. Style them the same as unit
      // suffixes so the "type-level" reading is visually consistent.
      const first = word[0]
      if (first && first >= "A" && first <= "Z") return "typeName"
      return "variableName"
    }

    // Multi-char operators first
    if (stream.match("==") || stream.match("!=") || stream.match("<=") || stream.match(">=")) {
      state.lastWasNumber = false
      return "operator"
    }

    // Single-char operators and punctuation
    const c = stream.next()
    if (!c) return null
    state.lastWasNumber = false
    if (/[+\-*/^=<>!?:]/.test(c)) return "operator"
    if (/[()]/.test(c)) return "punctuation"
    return null
  },

  blankLine(state) {
    state.lineTokens = 0
    state.lastWasNumber = false
    state.lastTopKeyword = null
  },

  languageData: {
    commentTokens: { line: "#" },
    closeBrackets: { brackets: ["(", "[", "{"] },
  },
})

const calcHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--keyword)", fontWeight: "600" },
  { tag: t.number, color: "var(--number)" },
  { tag: t.variableName, color: "var(--ident)" },
  { tag: t.typeName, color: "var(--unit)", fontStyle: "italic" },
  // PLOT opcodes — same family as keywords (bold) but tinted to read as
  // in-block built-ins rather than statement-level keywords.
  { tag: t.tagName, color: "var(--unit)", fontWeight: "600" },
  { tag: t.operator, color: "var(--operator)" },
  { tag: t.punctuation, color: "var(--text-dim)" },
  { tag: t.lineComment, color: "var(--comment)", fontStyle: "italic" },
])

export function calcLanguage(): LanguageSupport {
  return new LanguageSupport(calcStream, [syntaxHighlighting(calcHighlight)])
}
