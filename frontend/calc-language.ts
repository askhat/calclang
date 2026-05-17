import {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language"
import { tags as t } from "@lezer/highlight"

const KEYWORDS = new Set([
  "declare",
  "base",
  "as",
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
}

/**
 * Stream-based highlighter for Calc. Approximate vs. the full lexer — it
 * mirrors the same token shapes but discards positional state, since the
 * editor doesn't need diagnostics from it (those come from the real
 * pipeline via the lint extension).
 */
const calcStream = StreamLanguage.define<State>({
  name: "calc",

  startState: () => ({ lineTokens: 0, lastWasNumber: false }),

  token(stream, state) {
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
      state.lastWasNumber = false
      state.lineTokens++
      if (KEYWORDS.has(word)) return "keyword"
      // Heuristic: an identifier immediately after a number is the unit
      // suffix in primary / variable_decl. Tag it differently so unit
      // mentions visually pop.
      if (prevWasNumber) return "typeName"
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
  { tag: t.operator, color: "var(--operator)" },
  { tag: t.punctuation, color: "var(--text-dim)" },
  { tag: t.lineComment, color: "var(--comment)", fontStyle: "italic" },
])

export function calcLanguage(): LanguageSupport {
  return new LanguageSupport(calcStream, [syntaxHighlighting(calcHighlight)])
}
